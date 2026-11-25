import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { randomInt, randomUUID } from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { CONFIG, type Config } from '../../platform/config/config';
import type { Transaction } from '../../platform/database/database';
import { AuthKeys } from './keys';
import type { AccountPortal } from './sessions';

export type FactorKind = 'TOTP' | 'WEBAUTHN';
export type Proof = { method: 'TOTP'; code: string } | { method: 'BACKUP_CODE'; code: string } | { method: 'WEBAUTHN'; response: unknown };

const ISSUER = 'Legarec';
const BACKUP_CODES = 8;
const CHALLENGE_MS = 5 * 60_000;
/** The codes are drawn at random: a lighter cost than for a chosen password is enough. */
const CODE_HASH = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const digits = (code: string) => code.replace(/\D/gu, '');
const grouped = (key: string) => key.replace(/(.{4})(?=.)/gu, '$1 ');
const binding = (id: string) => ({ table: 'second_factors', id, column: 'secret_cipher' });

/** Second factors of one account, inside the transaction that names it. */
@Injectable()
export class SecondFactors {
  private readonly sites: Record<AccountPortal, { origin: string; id: string }>;

  constructor(
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(CONFIG) config: Config,
  ) {
    const site = (origin: string) => ({ origin, id: new URL(origin).hostname });
    this.sites = { staff: site(config.STAFF_PORTAL_URL), partner: site(config.PARTNER_PORTAL_URL) };
  }

  async methods(tx: Transaction, userId: string): Promise<FactorKind[]> {
    const found = await tx.secondFactor.findMany({ where: { userId, confirmedAt: { not: null } }, select: { kind: true }, orderBy: { kind: 'asc' } });
    return [...new Set(found.map((factor) => factor.kind))];
  }

  // ---------------------------------------------------------------- Application

  /** Replaces the one that was being set up; the one in use stays until the new one is proved. */
  async startTotp(tx: Transaction, user: { id: string; email: string }): Promise<{ uri: string; key: string }> {
    const secret = generateSecret();
    const id = randomUUID();
    await tx.secondFactor.deleteMany({ where: { userId: user.id, kind: 'TOTP', confirmedAt: null } });
    await tx.secondFactor.create({
      data: { id, userId: user.id, kind: 'TOTP', secretCipher: new Uint8Array(this.keys.vault.encrypt(secret, binding(id))) },
      select: { id: true },
    });
    return { uri: generateURI({ issuer: ISSUER, label: user.email, secret }), key: grouped(secret) };
  }

  /** Number of the factor now in use; null when the code is wrong. */
  async confirmTotp(tx: Transaction, userId: string, code: string): Promise<string | null> {
    const pending = await tx.secondFactor.findFirst({ where: { userId, kind: 'TOTP', confirmedAt: null }, select: { id: true, secretCipher: true } });
    const step = pending && this.stepOf(pending.id, pending.secretCipher, code, null);
    if (!pending || step === null) return null;
    await tx.secondFactor.deleteMany({ where: { userId, kind: 'TOTP', confirmedAt: { not: null } } });
    await tx.secondFactor.update({ where: { id: pending.id }, data: { confirmedAt: new Date(), lastStep: step }, select: { id: true } });
    return pending.id;
  }

  private stepOf(id: string, cipher: Uint8Array | null, code: string, after: number | null): number | null {
    if (!cipher) return null;
    const secret = this.keys.vault.decrypt(cipher, binding(id)).toString();
    try {
      // The code of the minute before or after: the clocks of the telephones differ. Never the same one twice.
      const result = verifySync({ secret, token: digits(code), epochTolerance: 30, ...(after === null ? {} : { afterTimeStep: after }) });
      return result.valid && 'timeStep' in result ? result.timeStep : null;
    } catch {
      return null;
    }
  }

  private async acceptsTotp(tx: Transaction, userId: string, code: string): Promise<boolean> {
    const factor = await tx.secondFactor.findFirst({
      where: { userId, kind: 'TOTP', confirmedAt: { not: null } },
      select: { id: true, secretCipher: true, lastStep: true },
    });
    const step = factor && this.stepOf(factor.id, factor.secretCipher, code, factor.lastStep);
    if (!factor || step === null) return false;
    // Two requests with the same code at the same time: one of them only.
    const { count } = await tx.secondFactor.updateMany({
      where: { id: factor.id, OR: [{ lastStep: null }, { lastStep: { lt: step } }] },
      data: { lastStep: step, lastUsedAt: new Date(), ...this.renewed(factor.id, factor.secretCipher) },
    });
    return count === 1;
  }

  /** The same secret, under the current key: the previous one may be withdrawn once everyone has signed in. */
  private renewed(id: string, cipher: Uint8Array | null) {
    if (!cipher || !this.keys.vault.isOutdated(cipher)) return {};
    return { secretCipher: new Uint8Array(this.keys.vault.encrypt(this.keys.vault.decrypt(cipher, binding(id)), binding(id))) };
  }

  // ---------------------------------------------------------------- Security key

  async registrationOptions(tx: Transaction, portal: AccountPortal, user: { id: string; email: string; name: string }, sessionId: string | undefined) {
    const known = await tx.secondFactor.findMany({ where: { userId: user.id, kind: 'WEBAUTHN' }, select: { credentialId: true } });
    const options = await generateRegistrationOptions({
      rpName: ISSUER,
      rpID: this.sites[portal].id,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: known.map((factor) => ({ id: factor.credentialId! })),
      authenticatorSelection: { residentKey: 'discouraged', userVerification: 'discouraged' },
    });
    await this.keepChallenge(tx, user.id, sessionId, options.challenge);
    return options;
  }

  async register(tx: Transaction, portal: AccountPortal, userId: string, sessionId: string | undefined, response: unknown): Promise<string | null> {
    const { registrationInfo } = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: (challenge) => this.takeChallenge(tx, userId, sessionId, challenge),
      expectedOrigin: this.sites[portal].origin,
      expectedRPID: this.sites[portal].id,
      requireUserVerification: false,
    }).catch(() => ({ registrationInfo: undefined }));
    if (!registrationInfo) return null;
    const { credential } = registrationInfo;
    const { id } = await tx.secondFactor.create({
      data: {
        userId,
        kind: 'WEBAUTHN',
        credentialId: credential.id,
        publicKey: credential.publicKey,
        signCount: credential.counter,
        transports: credential.transports?.join(',') ?? null,
        confirmedAt: new Date(),
      },
      select: { id: true },
    });
    return id;
  }

  async authenticationOptions(tx: Transaction, portal: AccountPortal, userId: string, sessionId: string | undefined) {
    const known = await tx.secondFactor.findMany({ where: { userId, kind: 'WEBAUTHN' }, select: { credentialId: true, transports: true } });
    const options = await generateAuthenticationOptions({
      rpID: this.sites[portal].id,
      userVerification: 'discouraged',
      allowCredentials: known.map(({ credentialId, transports }) => ({ id: credentialId!, ...(transports ? { transports: transports.split(',') } : {}) })),
    });
    await this.keepChallenge(tx, userId, sessionId, options.challenge);
    return options;
  }

  private async acceptsKey(tx: Transaction, portal: AccountPortal, userId: string, sessionId: string | undefined, response: unknown): Promise<boolean> {
    const credentialId = (response as { id?: unknown } | null)?.id;
    if (typeof credentialId !== 'string') return false;
    const factor = await tx.secondFactor.findFirst({
      where: { userId, kind: 'WEBAUTHN', credentialId },
      select: { id: true, publicKey: true, signCount: true },
    });
    if (!factor?.publicKey) return false;
    const result = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: (challenge) => this.takeChallenge(tx, userId, sessionId, challenge),
      expectedOrigin: this.sites[portal].origin,
      expectedRPID: this.sites[portal].id,
      requireUserVerification: false,
      credential: { id: credentialId, publicKey: new Uint8Array(factor.publicKey), counter: Number(factor.signCount ?? 0) },
    }).catch(() => null);
    if (!result?.verified) return false;
    await tx.secondFactor.update({
      where: { id: factor.id },
      data: { signCount: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
      select: { id: true },
    });
    return true;
  }

  /** Good once, for five minutes, for that session only. */
  private async keepChallenge(tx: Transaction, userId: string, sessionId: string | undefined, challenge: string): Promise<void> {
    await tx.authToken.create({
      data: {
        purpose: 'WEBAUTHN',
        userId,
        sessionId: sessionId ?? null,
        tokenHash: new Uint8Array(this.keys.linkHash(challenge)),
        expiresAt: new Date(Date.now() + CHALLENGE_MS),
      },
      select: { id: true },
    });
  }
  private async takeChallenge(tx: Transaction, userId: string, sessionId: string | undefined, challenge: string): Promise<boolean> {
    const { count } = await tx.authToken.updateMany({
      where: {
        userId,
        purpose: 'WEBAUTHN',
        sessionId: sessionId ?? null,
        tokenHash: new Uint8Array(this.keys.linkHash(challenge)),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  // ---------------------------------------------------------------- Backup codes, and the whole

  /** New ones when none is left; shown once. */
  async issueBackupCodes(tx: Transaction, userId: string): Promise<string[]> {
    if (await tx.backupCode.count({ where: { userId, usedAt: null } })) return [];
    const codes = Array.from({ length: BACKUP_CODES }, () => [0, 1].map(() => String(randomInt(10_000)).padStart(4, '0')).join('-'));
    await tx.backupCode.deleteMany({ where: { userId } });
    const hashes = await Promise.all(codes.map((code) => argon2.hash(digits(code), CODE_HASH)));
    await tx.backupCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) });
    return codes;
  }

  private async acceptsBackupCode(tx: Transaction, userId: string, code: string): Promise<boolean> {
    const typed = digits(code);
    if (typed.length !== 8) return false;
    for (const { id, codeHash } of await tx.backupCode.findMany({ where: { userId, usedAt: null }, select: { id: true, codeHash: true } })) {
      if (!(await argon2.verify(codeHash, typed).catch(() => false))) continue;
      const { count } = await tx.backupCode.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
      return count === 1;
    }
    return false;
  }

  accepts(tx: Transaction, portal: AccountPortal, session: { id: string; userId: string }, proof: Proof): Promise<boolean> {
    if (proof.method === 'TOTP') return this.acceptsTotp(tx, session.userId, proof.code);
    if (proof.method === 'BACKUP_CODE') return this.acceptsBackupCode(tx, session.userId, proof.code);
    return this.acceptsKey(tx, portal, session.userId, session.id, proof.response);
  }

  async removeAll(tx: Transaction, userId: string): Promise<void> {
    await tx.secondFactor.deleteMany({ where: { userId } });
    await tx.backupCode.deleteMany({ where: { userId } });
  }
}
