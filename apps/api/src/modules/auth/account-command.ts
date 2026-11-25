import { z } from 'zod';
import type { Config } from '../../platform/config/config';
import { newToken } from '../../platform/crypto/keyring';
import type { Database, Transaction } from '../../platform/database/database';
import type { AuthKeys } from './keys';
import { drawLink, linkUrl } from './link-tokens';

export const USAGE = 'Usage : director <adresse> <prénom> <nom> | lien <adresse>';

interface Parts {
  database: Database;
  keys: AuthKeys;
  portals: Pick<Config, 'STAFF_PORTAL_URL' | 'PARTNER_PORTAL_URL'>;
}

const log = (tx: Transaction, action: 'DIRECTOR_CREATED' | 'LINK_DRAWN', id: string) =>
  tx.$executeRaw`SELECT app.log(${action}, 'user', ${id}::uuid, '{}'::jsonb)`;

/** On the server, by its administrator: first Director, or a link when no e-mail can arrive. Answers the line to show, once. */
export async function accountCommand({ database, keys, portals }: Parts, [command, email, ...names]: string[]): Promise<string> {
  const [first, last] = names.map((name) => name.trim());
  const director = command === 'director';
  if (!z.email().safeParse(email).success || (director ? !first || !last : command !== 'lien')) return USAGE;
  return database.run({ kind: 'worker', job: 'account-command' }, async (tx) => {
    if (director) {
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT app.create_director(${first!}, ${last!}, ${email!}::citext) AS id`;
      await log(tx, 'DIRECTOR_CREATED', row!.id);
    }
    const user = await tx.user.findUnique({ where: { email: email! }, select: { id: true, status: true, role: true } });
    if (!user || user.status === 'DISABLED') return 'Aucun compte ouvert à cette adresse.';
    const purpose = user.status === 'INVITED' ? 'INVITATION' : 'RESET';
    const token = newToken();
    await drawLink(tx, keys, { purpose, userId: user.id, token });
    await log(tx, 'LINK_DRAWN', user.id);
    return linkUrl(portals, user.role, purpose, token);
  });
}
