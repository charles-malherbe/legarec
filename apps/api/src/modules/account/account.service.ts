import { NOTIFICATION_KINDS, ROLE_LABELS, type AccountData } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { Audit } from '../../platform/audit/audit';
import { PASSWORDS, type Passwords } from '../../platform/crypto/passwords';
import type { Actor } from '../../platform/database/actor';
import { Database, type Transaction } from '../../platform/database/database';
import { ApiError, forbidden, invalid, notFound } from '../../platform/errors/api-error';
import { ago, dayOf } from '../../platform/format';
import { Accounts } from '../auth/accounts';
import { AuthKeys } from '../auth/keys';
import { refuseAddress } from '../auth/links';
import { SecondFactors } from '../auth/second-factors';
import { Sessions } from '../auth/sessions';
import { SignIn } from '../auth/sign-in';

export type StaffActor = Extract<Actor, { kind: 'staff' }>;
const OPEN = (now: Date) => ({
  revokedAt: null,
  expiresAt: { gt: now },
  lastSeenAt: { gt: new Date(now.getTime() - 30 * 60_000) },
  OR: [{ secondFactorNeeded: false }, { secondFactorAt: { not: null } }],
});
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : '');
const date = (value: string) => (value ? new Date(`${value}T00:00:00Z`) : null);
const name = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;

/** One's own account. Credentials and sessions are read and changed by the transaction of the sign-in, never by that of the team. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Accounts) private readonly accounts: Accounts,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(SecondFactors) private readonly factors: SecondFactors,
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(SignIn) private readonly signIn: SignIn,
    @Inject(PASSWORDS) private readonly passwords: Passwords,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  async data(actor: StaffActor): Promise<AccountData> {
    const id = actor.userId;
    const own = await this.accounts.signedIn(actor, async (tx) => ({
      me: await tx.user.findUniqueOrThrow({
        where: { id },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          createdAt: true,
          passwordChangedAt: true,
          twoFactorRequired: true,
          substituteId: true,
          absentFrom: true,
          absentUntil: true,
          autoReply: true,
          dailySummary: true,
          quietHours: true,
        },
      }),
      substitutes: await this.substitutes(tx, id),
      chosen: await tx.notificationPreference.findMany({ where: { userId: id }, select: { kind: true, inApp: true, email: true } }),
    }));
    const now = new Date();
    const proofs = await this.accounts.about(id, async (tx) => ({
      factors: await tx.secondFactor.findMany({
        where: { userId: id, confirmedAt: { not: null } },
        select: { kind: true, confirmedAt: true },
        orderBy: { confirmedAt: 'asc' },
      }),
      sessions: await tx.userSession.findMany({
        where: { userId: id, portal: 'STAFF', ...OPEN(now) },
        select: { id: true, deviceLabel: true, mobile: true, ip: true, lastSeenAt: true },
        orderBy: { lastSeenAt: 'desc' },
      }),
    }));
    const { me, chosen } = own;
    const [first] = proofs.factors;
    const chosenFor = new Map(chosen.map(({ kind, inApp, email }) => [kind, { inApp, email }]));
    return {
      signature: [name(me), ROLE_LABELS[me.role], me.email],
      absence: { substituteId: me.substituteId ?? '', from: day(me.absentFrom), to: day(me.absentUntil), autoReply: me.autoReply },
      substitutes: own.substitutes,
      passwordChangedOn: dayOf(me.passwordChangedAt ?? me.createdAt),
      twoFactor: {
        enabled: first !== undefined,
        method: first ? (proofs.factors.some((factor) => factor.kind === 'TOTP') ? 'TOTP' : 'WEBAUTHN') : null,
        mandatory: me.twoFactorRequired,
        since: first?.confirmedAt ? dayOf(first.confirmedAt) : null,
      },
      sessions: proofs.sessions.map((session) => {
        const current = session.id === actor.session?.id;
        return {
          id: session.id,
          device: session.deviceLabel,
          meta: `${session.ip ?? 'Adresse inconnue'} · ${current ? 'actuellement' : ago(session.lastSeenAt, now)}`,
          mobile: session.mobile,
          current,
        };
      }),
      // All of them concern cases, which the Developer never reads.
      notifications: me.role === 'DEVELOPER' ? [] : NOTIFICATION_KINDS.map((kind) => ({ ...kind, ...chosenFor.get(kind.id) })),
      dailySummary: me.dailySummary,
      quietHours: me.quietHours,
    };
  }

  // ---------------------------------------------------------------- Profile, in the transaction of the request

  /** Noted: the journal and the histories show the name of whoever acts. */
  async saveProfile(actor: StaffActor, names: { firstName: string; lastName: string }): Promise<void> {
    const { count } = await this.database.tx.user.updateMany({ where: { id: actor.userId, NOT: names }, data: names });
    if (count) await this.audit.log({ action: 'NAME_CHANGED' });
  }

  async saveAbsence(actor: StaffActor, body: { substituteId: string; from: string; to: string; autoReply: boolean }): Promise<void> {
    const { tx } = this.database;
    if (body.substituteId && !(await this.substitutes(tx, actor.userId)).some((person) => person.id === body.substituteId))
      throw invalid({ fields: ['substituteId'] });
    await tx.user.update({
      where: { id: actor.userId },
      data: { substituteId: body.substituteId || null, absentFrom: date(body.from), absentUntil: date(body.to), autoReply: body.autoReply },
      select: { id: true },
    });
  }

  async savePreferences(
    actor: StaffActor,
    body: { notifications?: { id: string; inApp: boolean; email: boolean }[]; dailySummary?: boolean; quietHours?: boolean },
  ): Promise<void> {
    const { tx } = this.database;
    const { notifications = [], ...rest } = body;
    for (const { id: kind, inApp, email } of notifications) {
      if (!NOTIFICATION_KINDS.some((known) => known.id === kind)) throw invalid({ fields: ['notifications'] });
      const key = { userId: actor.userId, kind };
      await tx.notificationPreference.upsert({
        where: { userId_kind: key },
        create: { ...key, inApp, email },
        update: { inApp, email },
        select: { kind: true },
      });
    }
    if (Object.keys(rest).length) await tx.user.update({ where: { id: actor.userId }, data: rest, select: { id: true } });
  }

  /** Whoever handles cases, oneself apart. */
  private async substitutes(tx: Transaction, id: string): Promise<{ id: string; name: string }[]> {
    const found = await tx.user.findMany({
      where: { id: { not: id }, status: 'ACTIVE', role: { in: ['DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER'] } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return found.map((person) => ({ id: person.id, name: name(person) }));
  }

  // ---------------------------------------------------------------- Credentials

  async changePassword(actor: StaffActor, { current, next }: { current: string; next: string }): Promise<void> {
    const id = actor.userId;
    const user = await this.accounts.about(id, (tx) => tx.user.findUniqueOrThrow({ where: { id }, select: { email: true, passwordHash: true } }));
    refuseAddress(user.email, next);
    this.passwords.refuseIfFull();
    const key = this.keys.attempt('password', id);
    const attempt = await this.accounts.takeAttempt(key, 'PASSWORD');
    if (!attempt.allowed) throw new ApiError(423, 'LOCKED');
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      await this.accounts.as(id, () => this.audit.log({ action: 'PASSWORD_REFUSED' }));
      // Whoever does not know the password five times is not the holder.
      if (attempt.left === 0) await this.closeSessions(actor, { id: actor.session?.id ?? id });
      throw new ApiError(422, 'INVALID_CREDENTIALS');
    }
    const passwordHash = await this.passwords.hash(next);
    await this.accounts.as(id, async (tx) => {
      const now = new Date();
      // Reset or changed while it was being checked.
      const { passwordHash: before } = await tx.user.findUniqueOrThrow({ where: { id }, select: { passwordHash: true } });
      if (before !== user.passwordHash) throw new ApiError(422, 'INVALID_CREDENTIALS');
      await tx.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: now }, select: { id: true } });
      await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null, ...(actor.session ? { id: { not: actor.session.id } } : {}) },
        data: { revokedAt: now },
      });
      await tx.authToken.updateMany({ where: { userId: id, purpose: 'RESET', usedAt: null }, data: { usedAt: now } });
      await this.accounts.clearAttempts(tx, key);
      await this.audit.log({ action: 'PASSWORD_CHANGED' });
    });
  }

  startTotp(actor: StaffActor) {
    return this.accounts.as(actor.userId, async (tx) => this.factors.startTotp(tx, await this.holder(tx, actor)));
  }

  verifyTotp(actor: StaffActor, code: string): Promise<{ backupCodes: string[] }> {
    return this.enable(actor, (tx) => this.factors.confirmTotp(tx, actor.userId, code));
  }

  keyOptions(actor: StaffActor) {
    return this.accounts.as(actor.userId, async (tx) => this.factors.registrationOptions(tx, 'staff', await this.holder(tx, actor), actor.session?.id));
  }

  verifyKey(actor: StaffActor, response: unknown): Promise<{ backupCodes: string[] }> {
    return this.enable(actor, (tx) => this.factors.register(tx, 'staff', actor.userId, actor.session?.id, response));
  }

  async disable(actor: StaffActor): Promise<void> {
    await this.accounts.as(actor.userId, async (tx) => {
      const { twoFactorRequired } = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { twoFactorRequired: true } });
      if (twoFactorRequired) throw forbidden();
      await this.factors.removeAll(tx, actor.userId);
      await this.audit.log({ action: 'SECOND_FACTOR_DISABLED' });
    });
  }

  private async enable(actor: StaffActor, confirm: (tx: Transaction) => Promise<string | null>): Promise<{ backupCodes: string[] }> {
    const key = this.keys.attempt('second-factor', actor.userId);
    const attempt = await this.accounts.takeAttempt(key, 'SECOND_FACTOR');
    if (!attempt.allowed) throw new ApiError(423, 'LOCKED');
    const codes = await this.accounts.as(actor.userId, async (tx) => {
      const factor = await confirm(tx);
      if (!factor) return null;
      await this.accounts.clearAttempts(tx, key);
      await this.sessions.closeOthers(tx, actor.userId, actor.session?.id);
      await this.signIn.enabled(factor, actor.role);
      return this.factors.issueBackupCodes(tx, actor.userId);
    });
    if (!codes) {
      await this.accounts.as(actor.userId, () => this.audit.log({ action: attempt.left === 0 ? 'ACCOUNT_LOCKED' : 'SECOND_FACTOR_REFUSED' }));
      throw new ApiError(422, 'INVALID_CODE');
    }
    return { backupCodes: codes };
  }

  // ---------------------------------------------------------------- Sessions

  async closeSession(actor: StaffActor, id: string): Promise<void> {
    if (id === actor.session?.id) throw forbidden();
    if (!(await this.closeSessions(actor, { id }))) throw notFound();
  }

  closeOthers(actor: StaffActor): Promise<number> {
    return this.closeSessions(actor, actor.session ? { id: { not: actor.session.id } } : {});
  }

  private closeSessions(actor: StaffActor, which: { id?: string | { not: string } }): Promise<number> {
    return this.accounts.as(actor.userId, async (tx) => {
      const { count } = await tx.userSession.updateMany({ where: { userId: actor.userId, ...which, revokedAt: null }, data: { revokedAt: new Date() } });
      if (count) await this.audit.log({ action: 'SESSIONS_CLOSED', params: { count: Math.min(count, 999) } });
      return count;
    });
  }

  private async holder(tx: Transaction, { userId: id }: StaffActor): Promise<{ id: string; email: string; name: string }> {
    const user = await tx.user.findUniqueOrThrow({ where: { id }, select: { email: true, firstName: true, lastName: true } });
    return { id, email: user.email, name: name(user) };
  }
}
