import type { Config } from '../../platform/config/config';
import type { Transaction } from '../../platform/database/database';
import type { AuthKeys } from './keys';

export type LinkPurpose = 'INVITATION' | 'RESET';
const HOURS: Record<LinkPurpose, number> = { INVITATION: 72, RESET: 1 };
const PATHS: Record<LinkPurpose, string> = { INVITATION: 'activation', RESET: 'reinitialisation' };

/** Records a link about to be given to its holder: its digest only, and the last one given is the only one that works. */
export async function drawLink(
  tx: Transaction,
  keys: AuthKeys,
  { purpose, userId, token }: { purpose: LinkPurpose; userId: string; token: string },
): Promise<void> {
  await tx.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  await tx.authToken.create({
    data: { purpose, userId, tokenHash: new Uint8Array(keys.linkHash(token)), expiresAt: new Date(Date.now() + HOURS[purpose] * 3_600_000) },
    select: { id: true },
  });
}

export const linkUrl = (portals: Pick<Config, 'STAFF_PORTAL_URL' | 'PARTNER_PORTAL_URL'>, role: string, purpose: LinkPurpose, token: string) =>
  `${role === 'CREDITOR' ? portals.PARTNER_PORTAL_URL : portals.STAFF_PORTAL_URL}/${PATHS[purpose]}/${token}`;
