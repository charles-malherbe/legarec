import type { DebtorIdentifier } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { deriveKey, Keyring } from '../../platform/crypto/keyring';
import type { Actor } from '../../platform/database/actor';
import { Database } from '../../platform/database/database';
import { ApiError } from '../../platform/errors/api-error';
import { cookies, isBackground, requestFacts } from '../../platform/http/context';
import { RateLimits } from '../../platform/limits/rate-limits';
import { bindingOf } from '../debtor-access/access-codes';
import { Vault } from '../vault/vault';
import { AuthKeys } from './keys';

const COOKIE = 'debtor';
/** 12 hours at most, 30 minutes without a request (in the database); « Se souvenir de moi » keeps the cookie 30 days. */
const LIFE_MS = 12 * 3600 * 1000;
const REMEMBERED_S = 30 * 24 * 3600;
/** Twenty tries an hour from one network (bloc /64 in IPv6), whatever the identifier. */
const TRIES = { name: 'debtor-access', max: 20, seconds: 3600 };
/** A code that no debtor has: what is compared when the identifier is unknown, for the same work. */
const NOBODY: Buffer = Buffer.from('----');

interface Found {
  debtor_id: string;
  code_cipher: Uint8Array;
  key_id: string | null;
  key_cipher: Uint8Array | null;
}
type Outcome =
  { kind: 'open'; token: string; debtorId: string } | { kind: 'invalid'; left: number } | { kind: 'locked'; minutes: number } | { kind: 'blocked' };

const normalized = (identifier: DebtorIdentifier) =>
  identifier.kind === 'SIREN' ? identifier.value.replace(/\s/gu, '') : identifier.value.trim().toUpperCase();

/**
 * The sign-in of a debtor: an identifier and the four letters of the code. The same answer, the same work and the same
 * time for an unknown identifier and for a wrong code; each try counted before it is checked.
 */
@Injectable()
export class DebtorSignIn {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(Vault) private readonly vault: Vault,
    @Inject(RateLimits) private readonly limits: RateLimits,
  ) {}

  /** The debtor of the session cookie, or null. */
  async current(): Promise<Actor | null> {
    const token = cookies().get(COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    for (const hash of this.keys.sessionHashes(token)) {
      const [row] = await this.database.run(
        { kind: 'anonymous' },
        (tx) => tx.$queryRaw<{ debtor: string | null }[]>`SELECT app.resume_debtor_session(decode(${hash}, 'hex'), ${!isBackground()}) AS debtor`,
      );
      if (row?.debtor) return { kind: 'debtor', debtorId: row.debtor };
    }
    return null;
  }

  async access(identifier: DebtorIdentifier, code: string, remember: boolean): Promise<string> {
    await this.limits.take(TRIES);
    const value = normalized(identifier);
    const attempt = this.keys.attempt('debtor', `${identifier.kind}:${value}`);
    // Written whatever the answer: a refusal is counted, and stays counted.
    const outcome = await this.database.run({ kind: 'anonymous' }, async (tx): Promise<Outcome> => {
      const [taken] = await tx.$queryRaw<{ state: string; attempts_left: number | null; minutes: number | null }[]>`
        SELECT * FROM app.debtor_attempt(${attempt})`;
      if (taken!.state === 'BLOCKED') return { kind: 'blocked' };
      if (taken!.state === 'LOCKED') return { kind: 'locked', minutes: taken!.minutes ?? 15 };
      const [found] = await tx.$queryRaw<Found[]>`SELECT * FROM app.debtor_for_access(${identifier.kind}, ${value})`;
      if (found) await tx.$executeRaw`SELECT app.mark_debtor_attempt(${attempt}, ${found.debtor_id}::uuid)`;
      const right = this.matches(found, code);
      if (right && found) {
        const token = randomBytes(32).toString('base64url');
        await tx.$executeRaw`SELECT app.open_debtor_session(${found.debtor_id}::uuid, ${attempt}, ${this.keys.sessionHash(token)}, ${remember},
          ${requestFacts().ip ?? null}::inet, ${new Date(Date.now() + LIFE_MS)}::timestamptz)`;
        return { kind: 'open', token, debtorId: found.debtor_id };
      }
      if (taken!.state === 'BLOCKS') {
        if (found) await tx.$executeRaw`SELECT app.note_debtor_blocked(${found.debtor_id}::uuid)`;
        return { kind: 'blocked' };
      }
      if (taken!.state === 'LOCKS') return { kind: 'locked', minutes: taken!.minutes ?? 15 };
      return { kind: 'invalid', left: taken!.attempts_left ?? 0 };
    });
    switch (outcome.kind) {
      case 'open':
        cookies().set(COOKIE, outcome.token, remember ? REMEMBERED_S : undefined);
        return outcome.debtorId;
      case 'invalid':
        throw new ApiError(401, 'INVALID', { attemptsLeft: outcome.left });
      case 'locked':
        throw new ApiError(423, 'LOCKED', { minutes: outcome.minutes });
      case 'blocked':
        throw new ApiError(423, 'BLOCKED');
    }
  }

  /** What follows, with the rights of the debtor who has just signed in. */
  asDebtor<T>(debtorId: string, work: () => Promise<T>): Promise<T> {
    return this.database.run({ kind: 'debtor', debtorId }, () => work());
  }

  async close(): Promise<void> {
    const token = cookies().get(COOKIE);
    if (token)
      for (const hash of this.keys.sessionHashes(token))
        await this.database.run({ kind: 'anonymous' }, (tx) => tx.$executeRaw`SELECT app.close_debtor_session(decode(${hash}, 'hex'))`);
    cookies().clear(COOKIE);
  }

  /** The code of that debtor, compared in constant time; a code that no key opens matches nothing. */
  private matches(found: Found | undefined, typed: string): boolean {
    let code: Buffer = NOBODY;
    if (found?.key_id && found.key_cipher) {
      try {
        const keys = (JSON.parse(this.vault.open(found.key_id, found.key_cipher)) as string[]).map((value) =>
          deriveKey(Buffer.from(value, 'base64'), 'ACCESS_CODE_KEY'),
        );
        code = new Keyring(keys[0]!, keys.slice(1)).decrypt(Buffer.from(found.code_cipher), bindingOf(found.debtor_id));
      } catch {
        code = NOBODY;
      }
    }
    const given = Buffer.from(typed.trim().toUpperCase().padEnd(4, '-').slice(0, 4));
    return timingSafeEqual(code.length === 4 ? code : NOBODY, given) && found !== undefined && code !== NOBODY;
  }
}
