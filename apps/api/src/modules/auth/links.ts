import type { LinkInfo } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { Audit } from '../../platform/audit/audit';
import { PASSWORDS, type Passwords } from '../../platform/crypto/passwords';
import type { Transaction } from '../../platform/database/database';
import { ApiError, invalid } from '../../platform/errors/api-error';
import { Accounts } from './accounts';
import { AuthKeys } from './keys';
import type { LinkPurpose } from './link-tokens';
import { SecondFactors } from './second-factors';
import { ownPortal, TOKEN, type AccountPortal } from './sessions';
import { SignIn } from './sign-in';

/** Once the password is chosen, time to set up the second factor. */
const SETUP_MS = 15 * 60_000;
const expired = () => new ApiError(410, 'EXPIRED');

/** Links of reset and of invitation: 256 bits, good once, whose digest alone is stored. */
@Injectable()
export class Links {
  constructor(
    @Inject(Accounts) private readonly accounts: Accounts,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(SecondFactors) private readonly factors: SecondFactors,
    @Inject(SignIn) private readonly signIn: SignIn,
    @Inject(PASSWORDS) private readonly passwords: Passwords,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  async info(portal: AccountPortal, purpose: LinkPurpose, token: string): Promise<LinkInfo> {
    const id = await this.holder(portal, purpose, token);
    return this.accounts.about(id, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id }, select: { email: true, firstName: true, role: true, twoFactorRequired: true } });
      const [inviter] = await tx.$queryRaw<{ name: string | null }[]>`SELECT app.inviter_name() AS name`;
      const { email, firstName, role, twoFactorRequired } = user;
      return { email, firstName, twoFactorRequired, ...(purpose === 'INVITATION' ? { invitedBy: inviter?.name ?? 'Legarec', role } : {}) };
    });
  }

  /** Every open session is closed, and a lock with them: the holder has shown that the address is theirs. */
  async reset(portal: AccountPortal, token: string, password: string): Promise<void> {
    const id = await this.holder(portal, 'RESET', token);
    const passwordHash = await this.passwords.hash(password);
    await this.accounts.as(id, async (tx) => {
      const now = new Date();
      await this.use(tx, id, 'RESET', token, { usedAt: now });
      const { email } = await this.choose(tx, id, password, passwordHash);
      await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.authToken.updateMany({ where: { userId: id, purpose: 'RESET', usedAt: null }, data: { usedAt: now } });
      await this.accounts.clearAttempts(tx, this.keys.attempt('sign-in', email), this.keys.attempt('password', id));
      await this.audit.log({ action: 'PASSWORD_RESET' });
      // Whoever reads the mailbox of a collaborator could have done it.
      await tx.$executeRaw`SELECT app.tell_reset()`;
    });
  }

  /** The account opens with its password; the second factor is offered at once. */
  async choosePassword(portal: AccountPortal, token: string, password: string): Promise<{ totpKey: string }> {
    const id = await this.holder(portal, 'INVITATION', token);
    const passwordHash = await this.passwords.hash(password);
    await this.accounts.as(id, async (tx) => {
      await this.use(tx, id, 'INVITATION', token, { openedAt: new Date(), expiresAt: new Date(Date.now() + SETUP_MS) }, false);
      await this.choose(tx, id, password, passwordHash);
      await this.audit.log({ action: 'ACCOUNT_ACTIVATED' });
    });
    const { key } = await this.accounts.as(id, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id }, select: { id: true, email: true } });
      return this.factors.startTotp(tx, user);
    });
    return { totpKey: key };
  }

  async verifyTotp(portal: AccountPortal, token: string, code: string): Promise<{ backupCodes: string[] }> {
    const id = await this.holder(portal, 'INVITATION', token);
    const key = this.keys.attempt('second-factor', id);
    const attempt = await this.accounts.takeAttempt(key, 'SECOND_FACTOR');
    if (!attempt.allowed) throw new ApiError(423, 'LOCKED');
    const backupCodes = await this.accounts.as(id, async (tx) => {
      const factor = await this.factors.confirmTotp(tx, id, code);
      if (!factor) return null;
      await this.use(tx, id, 'INVITATION', token, { usedAt: new Date() }, true);
      await this.accounts.clearAttempts(tx, key);
      const { role } = await tx.user.findUniqueOrThrow({ where: { id }, select: { role: true } });
      await this.signIn.enabled(factor, role);
      return this.factors.issueBackupCodes(tx, id);
    });
    if (!backupCodes) {
      await this.signIn.refused(id, attempt.left === 0 ? 'ACCOUNT_LOCKED' : 'SECOND_FACTOR_REFUSED');
      throw new ApiError(401, 'INVALID_CODE', { attemptsLeft: attempt.left });
    }
    return { backupCodes };
  }

  /** Account of a live link, on its own portal. */
  private async holder(portal: AccountPortal, purpose: LinkPurpose, token: string): Promise<string> {
    if (!TOKEN.test(token)) throw expired();
    const hashes = this.keys.linkHashes(token);
    const [row] = await this.accounts.nobody(
      (tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app.account_of_link(${purpose}::token_purpose, ${hashes}::text[]) AS id`,
    );
    const id = row?.id;
    if (!id) throw expired();
    const user = await this.accounts.about(id, (tx) => tx.user.findUnique({ where: { id }, select: { role: true } }));
    if (!user || ownPortal(user.role) !== portal) throw expired();
    return id;
  }

  /** Two requests with the same link at the same time: one of them only. */
  private async use(
    tx: Transaction,
    userId: string,
    purpose: LinkPurpose,
    token: string,
    data: { usedAt?: Date; openedAt?: Date; expiresAt?: Date },
    opened?: boolean,
  ): Promise<void> {
    const { count } = await tx.authToken.updateMany({
      where: {
        userId,
        purpose,
        tokenHash: { in: this.keys.linkHashes(token).map((hash) => new Uint8Array(Buffer.from(hash, 'hex'))) },
        usedAt: null,
        expiresAt: { gt: new Date() },
        ...(opened === undefined ? {} : { openedAt: opened ? { not: null } : null }),
      },
      data,
    });
    if (count !== 1) throw expired();
  }

  private async choose(tx: Transaction, id: string, password: string, passwordHash: string): Promise<{ email: string }> {
    const user = await tx.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
    refuseAddress(user.email, password);
    await tx.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: new Date(), status: 'ACTIVE' }, select: { id: true } });
    return user;
  }
}

/** « Différent de l'adresse e-mail », as the screen announces it. */
export function refuseAddress(email: string, password: string): void {
  if (email.toLowerCase().includes(password.toLowerCase())) throw invalid({ fields: ['password'] });
}
