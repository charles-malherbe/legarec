import { hasDelegation, ROLE_LABELS, UNIQUE_ROLES, type Member, type Role } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { newMember } from '@legarec/contracts';
import { auditSentence, type AuditAction } from '../../platform/audit/actions';
import { Audit } from '../../platform/audit/audit';
import { Database } from '../../platform/database/database';
import { conflict, forbidden, invalid, notFound } from '../../platform/errors/api-error';
import { ago, capitalized } from '../../platform/format';
import { RateLimits } from '../../platform/limits/rate-limits';
import { Outbox } from '../../platform/queue/outbox';
import type { StaffActor } from '../account/account.service';
import { AuthKeys } from '../auth/keys';
import { LINKS_BY_ADDRESS } from '../auth/sign-in';

export type SupportAction = 'RESET_LINK' | 'SECOND_FACTOR_REQUIRED' | 'SECOND_FACTOR_RESET' | 'ACCOUNT_UNLOCKED';
const NOTED: Record<SupportAction, AuditAction> = {
  RESET_LINK: 'RESET_LINK_SENT',
  SECOND_FACTOR_REQUIRED: 'SECOND_FACTOR_REQUIRED',
  SECOND_FACTOR_RESET: 'SECOND_FACTOR_RESET',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
};
const ONLINE_MS = 5 * 60_000;

interface Target {
  id: string;
  role: Role;
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  email: string;
}

/** Accounts of the firm and of the creditors. PostgreSQL checks again who may do what, and tells the Director. */
@Injectable()
export class MembersService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(RateLimits) private readonly limits: RateLimits,
  ) {}

  async list(actor: StaffActor) {
    const { tx } = this.database;
    const who = { role: actor.role, activeDelegations: [...actor.delegations], userId: actor.userId };
    const administers = actor.role === 'DIRECTOR' || hasDelegation(who, 'ADMINISTRATIVE');
    const users = await tx.user.findMany({
      where: { anonymizedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        extension: true,
        status: true,
        lastSeenAt: true,
        invitedAt: true,
        disabledAt: true,
        twoFactorRequired: true,
        creditor: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const ids = users.map((user) => user.id);
    const states = await tx.$queryRaw<{ user_id: string; second_factor: boolean; sessions: number }[]>`SELECT * FROM app.account_states()`;
    const stateOf = new Map(states.map((state) => [state.user_id, state]));
    const held = await tx.case.groupBy({ by: ['officerId'], _count: { _all: true }, where: { officerId: { in: ids } } });
    const heldBy = new Map(held.map((row) => [row.officerId, row._count._all]));
    const keysOf = new Map(users.map((user) => [user.id, this.attempts(user)]));
    const locks = await tx.$queryRaw<{ key: string }[]>`SELECT app.locked(${[...keysOf.values()].flat()}::text[]) AS key`;
    const locked = new Set(locks.map((row) => row.key));
    // Read by the Director and the Developer only: the others see nothing here.
    const entries = await tx.$queryRaw<{ actor_id: string; action: string; params: Record<string, unknown>; occurred_at: Date }[]>`
      SELECT last.* FROM unnest(${ids}::uuid[]) AS member (id)
      CROSS JOIN LATERAL (
        SELECT actor_id, action, params, occurred_at FROM audit_log WHERE actor_id = member.id ORDER BY occurred_at DESC LIMIT 3
      ) AS last ORDER BY last.occurred_at DESC`;
    const now = new Date();
    const members: Member[] = users.map(({ lastSeenAt, invitedAt, disabledAt, creditor, ...user }) => ({
      ...user,
      twoFactor: stateOf.get(user.id)?.second_factor ?? false,
      sessions: stateOf.get(user.id)?.sessions ?? 0,
      cases: heldBy.get(user.id) ?? 0,
      locked: keysOf.get(user.id)!.some((key) => locked.has(key)),
      creditor: creditor?.name ?? null,
      lastSeen: this.lastSeen({ status: user.status, lastSeenAt, invitedAt, disabledAt, sessions: stateOf.get(user.id)?.sessions ?? 0 }, now),
      activity: entries
        .filter((entry) => entry.actor_id === user.id)
        .map((entry) => ({ what: auditSentence(entry.action, entry.params), when: capitalized(ago(entry.occurred_at, now)) })),
    }));
    return {
      members,
      canInvite: administers,
      canDisable: administers,
      canSupport: administers || hasDelegation(who, 'TECHNICAL'),
      canEditExtension: hasDelegation(who, 'TECHNICAL'),
      creditors: administers ? await tx.creditor.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
    };
  }

  async invite(body: z.infer<typeof newMember>): Promise<void> {
    const { tx } = this.database;
    const creditorId = body.role === 'CREDITOR' ? body.creditorId : null;
    // One of those proposed.
    if (creditorId && !(await tx.creditor.findFirst({ where: { id: creditorId, status: 'ACTIVE' }, select: { id: true } })))
      throw invalid({ fields: ['creditorId'] });
    if (await tx.user.findUnique({ where: { email: body.email }, select: { id: true } })) throw conflict('EMAIL_TAKEN');
    await this.refuseTaken(body.role);
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT app.invite_member(${body.role}::user_role, ${body.firstName}, ${body.lastName}, ${body.email}::citext, ${creditorId}::uuid) AS id`;
    const { id } = row!;
    await this.audit.log({ action: 'MEMBER_INVITED', entity: { type: 'user', id }, params: { role: body.role } });
    // A collaborator is written to once their mailbox exists.
    if (creditorId) await this.outbox.add({ queue: 'email', name: 'invitation', payload: { userId: id } });
  }

  async cancelInvitation(id: string): Promise<void> {
    const target = await this.target(id);
    if (target.status !== 'INVITED') throw notFound();
    await this.database.tx.$executeRaw`SELECT app.cancel_invitation(${id}::uuid)`;
    await this.audit.log({ action: 'INVITATION_CANCELLED', entity: { type: 'user', id }, params: { role: target.role } });
  }

  async disable(actor: StaffActor, id: string, { reason, cases }: { reason: string; cases: number }): Promise<void> {
    const target = await this.target(id);
    if (target.status !== 'ACTIVE') throw notFound();
    if (target.role === 'DIRECTOR' || id === actor.userId) throw forbidden();
    await this.database.tx.$executeRaw`SELECT app.disable_member(${id}::uuid, ${reason}, ${cases}::integer)`;
    await this.audit.log({ action: 'MEMBER_DISABLED', entity: { type: 'user', id }, params: { role: target.role } });
  }

  async enable(id: string): Promise<void> {
    const target = await this.target(id);
    if (target.status !== 'DISABLED') throw forbidden();
    await this.refuseTaken(target.role);
    const [row] = await this.database.tx.$queryRaw<{ status: string }[]>`SELECT app.enable_member(${id}::uuid)::text AS status`;
    await this.audit.log({ action: 'MEMBER_ENABLED', entity: { type: 'user', id }, params: { role: target.role } });
    if (row?.status === 'INVITED' && target.role === 'CREDITOR') await this.outbox.add({ queue: 'email', name: 'invitation', payload: { userId: id } });
  }

  async changeRole(actor: StaffActor, id: string, role: Exclude<Role, 'CREDITOR'>): Promise<void> {
    const target = await this.target(id);
    if (id === actor.userId || target.role === 'CREDITOR' || target.role === 'DIRECTOR' || target.status !== 'ACTIVE') throw forbidden();
    if (target.role === role) return;
    await this.refuseTaken(role, id);
    await this.database.tx.$executeRaw`SELECT app.set_member_role(${id}::uuid, ${role}::user_role)`;
    await this.audit.log({ action: 'MEMBER_ROLE_CHANGED', entity: { type: 'user', id }, params: { from: target.role, to: role } });
  }

  async setExtension(id: string, extension: string | null): Promise<void> {
    const target = await this.target(id);
    if (target.role === 'CREDITOR' || target.status !== 'ACTIVE') throw notFound();
    await this.database.tx.$executeRaw`SELECT app.set_extension(${id}::uuid, ${extension})`;
    await this.audit.log({ action: 'MEMBER_EXTENSION_CHANGED', entity: { type: 'user', id } });
  }

  async support(actor: StaffActor, id: string, action: SupportAction): Promise<void> {
    const target = await this.target(id);
    if (!this.maySupport(actor, target, action)) throw forbidden();
    await this.database.tx.$executeRaw`SELECT app.support(${id}::uuid, ${action}::support_action, ${this.attempts(target)}::text[])`;
    await this.audit.log({ action: NOTED[action], entity: { type: 'user', id } });
    if (action !== 'RESET_LINK') return;
    // Beyond, nothing of the above stays.
    await this.limits.take(LINKS_BY_ADDRESS, target.email.toLowerCase());
    await this.outbox.add({ queue: 'email', name: 'reset-link', payload: { userId: id } });
  }

  /** Same rules as app.support(), so that a refusal is an answer and not an incident. */
  private maySupport({ role, userId }: StaffActor, target: Target, action: SupportAction): boolean {
    if (target.status !== 'ACTIVE' || target.id === userId) return false;
    if (role === 'DEVELOPER' && target.role === 'CREDITOR') return false;
    if (role === 'COLLECTION_MANAGER' && target.role === 'DIRECTOR') return false;
    if (action === 'SECOND_FACTOR_REQUIRED') return target.role !== 'DIRECTOR';
    if (action !== 'SECOND_FACTOR_RESET' || role === 'DIRECTOR') return true;
    return role === 'COLLECTION_MANAGER' ? target.role === 'CREDITOR' : target.role !== 'DEVELOPER';
  }

  /** Counters of the failures of that account: by address when signing in, by account for the second factor and in Mon compte. */
  private attempts({ id, email }: { id: string; email: string }): string[] {
    return [this.keys.attempt('sign-in', email), this.keys.attempt('second-factor', id), this.keys.attempt('password', id)].map((key) => key.toString('hex'));
  }

  private async target(id: string): Promise<Target> {
    const found = await this.database.tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, email: true } });
    if (!found) throw notFound();
    return found;
  }

  private async refuseTaken(role: Role, except?: string): Promise<void> {
    if (!UNIQUE_ROLES.includes(role)) return;
    const holder = await this.database.tx.user.findFirst({
      where: { role, status: { not: 'DISABLED' }, ...(except ? { id: { not: except } } : {}) },
      select: { firstName: true, lastName: true },
    });
    if (holder) throw conflict('ROLE_TAKEN', { role: ROLE_LABELS[role], holder: `${holder.firstName} ${holder.lastName}` });
  }

  private lastSeen(member: { status: string; lastSeenAt: Date | null; invitedAt: Date | null; disabledAt: Date | null; sessions: number }, now: Date): string {
    const { status, lastSeenAt, invitedAt } = member;
    if (status === 'INVITED') return invitedAt ? `Invitation : ${ago(invitedAt, now)}` : 'Invitation en attente';
    if (!lastSeenAt) return 'Aucune connexion';
    if (status === 'ACTIVE' && member.sessions > 0 && now.getTime() - lastSeenAt.getTime() < ONLINE_MS) return 'En ligne';
    return capitalized(ago(lastSeenAt, now));
  }
}
