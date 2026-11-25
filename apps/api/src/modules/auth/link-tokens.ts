import type { Config } from '../../platform/config/config';
import type { Transaction } from '../../platform/database/database';
import { GiveUp } from '../../platform/queue/errors';
import type { AuthKeys } from './keys';

export type LinkPurpose = 'INVITATION' | 'RESET';
const HOURS: Record<LinkPurpose, number> = { INVITATION: 72, RESET: 1 };
const PATHS: Record<LinkPurpose, string> = { INVITATION: 'activation', RESET: 'reinitialisation' };

const OPEN = { INVITATION: 'INVITED', RESET: 'ACTIVE' } as const;

/**
 * Records a link about to be given to its holder: its digest only, and the last one given is the only one that works. The new
 * one first: it holds the account, as whatever closes it does, before its other links. Disabled meanwhile, it gets none.
 */
export async function drawLink(
  tx: Transaction,
  keys: AuthKeys,
  { purpose, userId, token }: { purpose: LinkPurpose; userId: string; token: string },
): Promise<void> {
  // Two links at the same time: the second one closes the first.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`link:${userId}`}, 0))`;
  const { id } = await tx.authToken.create({
    data: { purpose, userId, tokenHash: new Uint8Array(keys.linkHash(token)), expiresAt: new Date(Date.now() + HOURS[purpose] * 3_600_000) },
    select: { id: true },
  });
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (user?.status !== OPEN[purpose]) throw new GiveUp('ACCOUNT_CHANGED');
  await tx.authToken.updateMany({ where: { userId, purpose, usedAt: null, id: { not: id } }, data: { usedAt: new Date() } });
}

export const linkUrl = (portals: Pick<Config, 'STAFF_PORTAL_URL' | 'PARTNER_PORTAL_URL'>, role: string, purpose: LinkPurpose, token: string) =>
  `${role === 'CREDITOR' ? portals.PARTNER_PORTAL_URL : portals.STAFF_PORTAL_URL}/${PATHS[purpose]}/${token}`;
