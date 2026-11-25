import type { Delegation, Role } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { ActorResolver, Portal } from '../../platform/access/access';
import { newToken } from '../../platform/crypto/keyring';
import type { Actor } from '../../platform/database/actor';
import type { Transaction } from '../../platform/database/database';
import { cookies, isBackground, requestFacts, userAgent } from '../../platform/http/context';
import { Accounts } from './accounts';
import { deviceOf } from './devices';
import { AuthKeys } from './keys';

export type AccountPortal = 'staff' | 'partner';
export const PORTAL = { staff: 'STAFF', partner: 'PARTNER' } as const;
export const ownPortal = (role: string): AccountPortal => (role === 'CREDITOR' ? 'partner' : 'staff');
export const TOKEN = /^[\w-]{43}$/u;

/** Password accepted, second factor still expected. */
const PENDING_MS = 10 * 60_000;
/** However active it is: the next day starts with a sign-in. */
const LIFE_MS = 12 * 3_600_000;
const REMEMBERED_S = 30 * 86_400;
const DEVICE = 'device';

export interface CurrentSession {
  id: string;
  userId: string;
  role: Role;
  creditorId: string | null;
  /** The second factor was given, or is not expected. */
  complete: boolean;
  provedAt: Date;
  secondFactor: boolean;
  delegations: Delegation[];
}
interface Row {
  session_id: string;
  user_id: string;
  role: Role;
  creditor_id: string | null;
  complete: boolean;
  proved_at: Date;
  second_factor: boolean;
  delegations: Delegation[];
}

/** One cookie per portal, opaque, whose digest alone is stored. Thirty minutes without anything asked close it. */
@Injectable()
export class Sessions {
  constructor(
    @Inject(Accounts) private readonly accounts: Accounts,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
  ) {}

  current(portal: AccountPortal): Promise<CurrentSession | null> {
    return this.of(portal, cookies().get(portal) ?? '');
  }

  async of(portal: AccountPortal, token: string): Promise<CurrentSession | null> {
    if (!TOKEN.test(token)) return null;
    const hashes = this.keys.sessionHashes(token);
    const [row] = await this.accounts.nobody(
      (tx) => tx.$queryRaw<Row[]>`SELECT * FROM app.resume_session(${PORTAL[portal]}::account_portal, ${hashes}::text[], ${isBackground()})`,
    );
    if (!row) return null;
    const { session_id: id, user_id: userId, role, creditor_id: creditorId, complete, proved_at: provedAt, second_factor: secondFactor, delegations } = row;
    return { id, userId, role, creditorId, complete, provedAt, secondFactor, delegations };
  }

  /** Opened by the password; complete at once when no second factor is expected. */
  async open(
    tx: Transaction,
    portal: AccountPortal,
    userId: string,
    options: { needed: boolean; persistent: boolean },
  ): Promise<{ id: string; token: string; persistent: boolean }> {
    const token = newToken();
    const { label, mobile } = deviceOf(userAgent());
    const { id } = await tx.userSession.create({
      data: {
        userId,
        portal: PORTAL[portal],
        tokenHash: new Uint8Array(this.keys.sessionHash(token)),
        deviceLabel: label,
        mobile,
        ip: requestFacts().ip ?? null,
        secondFactorNeeded: options.needed,
        persistent: options.persistent,
        expiresAt: new Date(Date.now() + (options.needed ? PENDING_MS : LIFE_MS)),
      },
      select: { id: true },
    });
    return { id, token, persistent: options.persistent };
  }

  /** The second factor was given: another cookie, so that the one of the password opens nothing. Null when it was closed meanwhile. */
  async complete(tx: Transaction, id: string): Promise<{ token: string; persistent: boolean } | null> {
    const token = newToken();
    const now = new Date();
    const { count } = await tx.userSession.updateMany({
      where: { id, revokedAt: null, secondFactorAt: null, expiresAt: { gt: now } },
      data: {
        tokenHash: new Uint8Array(this.keys.sessionHash(token)),
        secondFactorAt: now,
        provedAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + LIFE_MS),
      },
    });
    if (!count) return null;
    const { persistent } = await tx.userSession.findUniqueOrThrow({ where: { id }, select: { persistent: true } });
    return { token, persistent };
  }

  /** Those that were opened without what now protects the account. */
  async closeOthers(tx: Transaction, userId: string, id: string | undefined): Promise<void> {
    await tx.userSession.updateMany({ where: { userId, revokedAt: null, ...(id ? { id: { not: id } } : {}) }, data: { revokedAt: new Date() } });
  }

  /** Once the transaction is committed. */
  give(portal: AccountPortal, { token, persistent }: { token: string; persistent: boolean }): void {
    cookies().set(portal, token, persistent ? REMEMBERED_S : undefined);
  }

  /** True when this browser was already known of the account. It opens nothing. */
  async recognise(tx: Transaction, userId: string): Promise<boolean> {
    const received = cookies().get(DEVICE) ?? '';
    const token = TOKEN.test(received) ? received : newToken();
    const tokenHash = new Uint8Array(this.keys.deviceHash(token));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REMEMBERED_S * 1000);
    const { label } = deviceOf(userAgent());
    // Forgotten after thirty days, whether or not its line has been removed.
    const device = await tx.userDevice.findFirst({ where: { userId, tokenHash }, select: { id: true, expiresAt: true } });
    if (device) await tx.userDevice.update({ where: { id: device.id }, data: { label, lastSeenAt: now, expiresAt }, select: { id: true } });
    else await tx.userDevice.create({ data: { userId, tokenHash, label, expiresAt }, select: { id: true } });
    cookies().set(DEVICE, token, REMEMBERED_S);
    return device !== null && device.expiresAt > now;
  }

  async close(portal: AccountPortal): Promise<void> {
    const session = await this.current(portal);
    if (session)
      await this.accounts.as(
        session.userId,
        async (tx) => void (await tx.userSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } })),
        () => undefined,
      );
    cookies().clear(portal);
  }
}

export function actorOf(session: CurrentSession): Actor | null {
  const { id, provedAt, secondFactor, userId, role, creditorId, delegations, complete } = session;
  if (!complete) return null;
  const facts = { id, provedAt, secondFactor };
  if (role !== 'CREDITOR') return { kind: 'staff', userId, role, delegations, session: facts };
  return creditorId ? { kind: 'partner', userId, creditorId, session: facts } : null;
}

/** Who is calling: the holder of the cookie of that portal, with the rights of their account as it is now. */
@Injectable()
export class SessionResolver implements ActorResolver {
  constructor(@Inject(Sessions) private readonly sessions: Sessions) {}

  async resolve(portal: Portal): Promise<Actor | null> {
    // The debtors and the service accounts have their own proofs, not written yet: nobody.
    if (portal !== 'staff' && portal !== 'partner') return null;
    const session = await this.sessions.current(portal);
    return session && actorOf(session);
  }
}
