import type { LoginResponse, TotpSetup } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Audit } from '../../platform/audit/audit';
import { CONFIG, type Config } from '../../platform/config/config';
import { PASSWORDS, type Passwords } from '../../platform/crypto/passwords';
import type { Transaction } from '../../platform/database/database';
import { ApiError } from '../../platform/errors/api-error';
import { RateLimits, type RateLimit } from '../../platform/limits/rate-limits';
import { Outbox } from '../../platform/queue/outbox';
import { Accounts } from './accounts';
import { AuthKeys } from './keys';
import { SecondFactors, type Proof } from './second-factors';
import { actorOf, ownPortal, Sessions, type AccountPortal, type CurrentSession } from './sessions';
import { SessionViews } from './views';

/** By network, whatever the accounts tried. */
const SIGN_INS: RateLimit = { name: 'sign-in', max: 30, seconds: 600 };
const CODES: RateLimit = { name: 'second-factor', max: 30, seconds: 600 };
const STARTS: RateLimit = { name: 'second-factor-start', max: 60, seconds: 600 };
const FORGOTTEN: RateLimit = { name: 'forgotten', max: 10, seconds: 3_600 };
/** By address. The support has its own count: a stranger who asks does not keep it from helping. */
const LINKS_BY_ADDRESS: RateLimit = { name: 'links', max: 3, seconds: 3_600 };

const locked = () => new ApiError(423, 'LOCKED');
/** The password has to be given again. */
const expired = () => new ApiError(401, 'UNAUTHORIZED');
const wrongCode = (left: number) => new ApiError(401, 'INVALID_CODE', { attemptsLeft: left });

/** Password, then second factor. Nothing tells an unknown address from a wrong password: neither the answer nor its time. */
@Injectable()
export class SignIn {
  constructor(
    @Inject(Accounts) private readonly accounts: Accounts,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(SecondFactors) private readonly factors: SecondFactors,
    @Inject(SessionViews) private readonly views: SessionViews,
    @Inject(PASSWORDS) private readonly passwords: Passwords,
    @Inject(RateLimits) private readonly limits: RateLimits,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async login(portal: AccountPortal, { email, password, remember }: { email: string; password: string; remember: boolean }): Promise<LoginResponse> {
    await this.limits.take(SIGN_INS);
    // Before anything is counted: what will not be checked is not a failure.
    this.passwords.refuseIfFull();
    const key = this.keys.attempt('sign-in', email);
    const attempt = await this.accounts.takeAttempt(key, 'SIGN_IN');
    if (!attempt.allowed) throw locked();
    const id = await this.accounts.find(email);
    // The same steps for an account that does not exist.
    const subject = id ?? randomUUID();
    const account = await this.accounts.about(subject, (tx) =>
      tx.user.findUnique({ where: { id: subject }, select: { role: true, passwordHash: true, twoFactorRequired: true } }),
    );
    const wrong = async () => {
      await this.refused(id, attempt.left === 0 ? 'ACCOUNT_LOCKED' : 'SIGN_IN_REFUSED');
      return attempt.left === 0 ? locked() : new ApiError(401, 'INVALID_CREDENTIALS', { attemptsLeft: attempt.left });
    };
    if (!(await this.passwords.verify(account?.passwordHash, password)) || !account) throw await wrong();
    const own = ownPortal(account.role);
    const opened = await this.accounts.as(
      subject,
      async (tx) => {
        // Reset, changed or disabled while it was being checked: what was typed is no longer its password.
        const now = await tx.user.findUnique({ where: { id: subject }, select: { passwordHash: true, role: true, status: true, twoFactorRequired: true } });
        if (now?.passwordHash !== account.passwordHash || now?.role !== account.role || now.status !== 'ACTIVE') return 'CHANGED' as const;
        await this.accounts.clearAttempts(tx, key);
        if (own !== portal) {
          await this.audit.log({ action: 'WRONG_PORTAL' });
          return null;
        }
        const methods = await this.factors.methods(tx, subject);
        const needed = methods.length > 0 || now.twoFactorRequired;
        const session = await this.sessions.open(tx, portal, subject, { needed, persistent: remember });
        if (needed) await this.audit.log({ action: 'PASSWORD_ACCEPTED' });
        else await this.welcome(tx, subject, session.id, account.role);
        return { session, methods, needed };
      },
      () => 'CHANGED' as const,
    );
    if (opened === 'CHANGED') throw await wrong();
    if (!opened)
      return {
        status: 'WRONG_PORTAL',
        portal: own === 'staff' ? 'espace' : 'partenaires',
        url: own === 'staff' ? this.config.STAFF_PORTAL_URL : this.config.PARTNER_PORTAL_URL,
      };
    this.sessions.give(portal, opened.session);
    if (!opened.needed) return this.accepted(portal, opened.session.token);
    return opened.methods.length ? { status: 'TWO_FACTOR', methods: opened.methods } : { status: 'SETUP_REQUIRED' };
  }

  async secondFactor(portal: AccountPortal, proof: Proof): Promise<LoginResponse> {
    await this.limits.take(CODES);
    const pending = await this.pending(portal, true);
    const attempt = await this.accounts.takeAttempt(this.keys.attempt('second-factor', pending.userId), 'SECOND_FACTOR');
    if (!attempt.allowed) return this.giveUp(portal);
    const given = await this.accounts.as(pending.userId, async (tx) => {
      if (!(await this.factors.accepts(tx, portal, pending, proof))) return null;
      await this.accounts.clearAttempts(tx, this.keys.attempt('second-factor', pending.userId));
      const session = await this.sessions.complete(tx, pending.id);
      if (!session) throw expired();
      if (proof.method === 'BACKUP_CODE') await this.audit.log({ action: 'BACKUP_CODE_USED' });
      await this.welcome(tx, pending.userId, pending.id, pending.role);
      return session;
    });
    if (!given) {
      await this.refused(pending.userId, attempt.left === 0 ? 'ACCOUNT_LOCKED' : 'SECOND_FACTOR_REFUSED');
      if (attempt.left === 0) return this.giveUp(portal);
      throw wrongCode(attempt.left);
    }
    this.sessions.give(portal, given);
    return this.accepted(portal, given.token);
  }

  async keyOptions(portal: AccountPortal) {
    await this.limits.take(STARTS);
    const pending = await this.pending(portal, true);
    return this.accounts.as(pending.userId, (tx) => this.factors.authenticationOptions(tx, portal, pending.userId, pending.id));
  }

  // ---------------------------------------------------------------- Required, and not set up yet

  async startSetup(portal: AccountPortal): Promise<TotpSetup> {
    await this.limits.take(STARTS);
    const { userId } = await this.pending(portal, false);
    return this.accounts.as(userId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } });
      return this.factors.startTotp(tx, user);
    });
  }

  async finishSetup(portal: AccountPortal, code: string): Promise<{ session: Extract<LoginResponse, { status: 'OK' }>['session']; backupCodes: string[] }> {
    await this.limits.take(CODES);
    const pending = await this.pending(portal, false);
    const key = this.keys.attempt('second-factor', pending.userId);
    const attempt = await this.accounts.takeAttempt(key, 'SECOND_FACTOR');
    if (!attempt.allowed) return this.giveUp(portal);
    const done = await this.accounts.as(pending.userId, async (tx) => {
      const factor = await this.factors.confirmTotp(tx, pending.userId, code);
      if (!factor) return null;
      await this.accounts.clearAttempts(tx, key);
      const backupCodes = await this.factors.issueBackupCodes(tx, pending.userId);
      const session = await this.sessions.complete(tx, pending.id);
      if (!session) throw expired();
      await this.sessions.closeOthers(tx, pending.userId, pending.id);
      await this.enabled(factor, pending.role);
      await this.welcome(tx, pending.userId, pending.id, pending.role);
      return { session, backupCodes };
    });
    if (!done) {
      await this.refused(pending.userId, attempt.left === 0 ? 'ACCOUNT_LOCKED' : 'SECOND_FACTOR_REFUSED');
      if (attempt.left === 0) return this.giveUp(portal);
      throw wrongCode(attempt.left);
    }
    this.sessions.give(portal, done.session);
    const { session } = await this.accepted(portal, done.session.token);
    return { session, backupCodes: done.backupCodes };
  }

  /** Noted, and told to the holder by e-mail. Inside the transaction of the account. */
  async enabled(factorId: string, role: string): Promise<void> {
    await this.audit.log({ action: 'SECOND_FACTOR_ENABLED' });
    if (role !== 'CREDITOR') await this.outbox.add({ queue: 'email', name: 'second-factor-enabled', payload: { factorId } });
  }

  // ---------------------------------------------------------------- Forgotten password

  /** Always the same answer, after the same work. The link is drawn by the worker when it sends it: it is written nowhere else. */
  async forgot(email: string): Promise<void> {
    await this.limits.take(FORGOTTEN);
    await this.limits.take(LINKS_BY_ADDRESS, email.trim().toLowerCase());
    const id = await this.accounts.find(email);
    const subject = id ?? randomUUID();
    await this.accounts.about(subject, async () => {
      // To nobody, for an address that has no account: the task finds no one.
      await this.outbox.add({ queue: 'email', name: 'reset-link', payload: { userId: subject } });
      await this.audit.log({ action: 'PASSWORD_RESET_ASKED', ...(id ? { entity: { type: 'user', id } } : {}) });
    });
  }

  // ---------------------------------------------------------------- Steps shared by the above

  /** Session whose password was accepted and whose second factor is expected: already set up, or to be set up. */
  private async pending(portal: AccountPortal, setUp: boolean): Promise<CurrentSession> {
    const session = await this.sessions.current(portal);
    if (!session || session.complete || session.secondFactor !== setUp) throw expired();
    return session;
  }

  private async giveUp(portal: AccountPortal): Promise<never> {
    await this.sessions.close(portal);
    throw locked();
  }

  refused(id: string | null, action: 'ACCOUNT_LOCKED' | 'SIGN_IN_REFUSED' | 'SECOND_FACTOR_REFUSED'): Promise<void> {
    return this.accounts.about(id ?? randomUUID(), () => this.audit.log({ action, ...(id ? { entity: { type: 'user', id } } : {}) }));
  }

  private async welcome(tx: Transaction, userId: string, sessionId: string, role: string): Promise<void> {
    await this.audit.log({ action: 'SIGNED_IN' });
    const { lastSeenAt } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { lastSeenAt: true } });
    await tx.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() }, select: { id: true } });
    const known = await this.sessions.recognise(tx, userId);
    // Told of every browser but the first one. The kit has no such message for a creditor.
    if (!known && lastSeenAt !== null && role !== 'CREDITOR') await this.outbox.add({ queue: 'email', name: 'new-device', payload: { sessionId } });
  }

  private async accepted(portal: AccountPortal, token: string): Promise<Extract<LoginResponse, { status: 'OK' }>> {
    const session = await this.sessions.of(portal, token);
    const actor = session && actorOf(session);
    if (!actor) throw new ApiError(401, 'UNAUTHORIZED');
    return { status: 'OK', session: actor.kind === 'staff' ? await this.views.staff(actor) : null };
  }
}
