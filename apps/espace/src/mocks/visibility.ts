import type { Session } from '@legarec/contracts';
import { allNames, readable } from './routes/cases';

/**
 * Feeds and notifications only name debtors the role may read.
 * A text that names nobody known is kept for the roles that see the whole team.
 */
export const mayRead = (session: Session, text: string) => {
  if (session.role === 'DEVELOPER' || session.role === 'CREDITOR') return false;
  const names = allNames().filter((name) => text.includes(name));
  if (names.length === 0) return session.role !== 'CLAIMS_OFFICER';
  const own = new Set(readable(session).map((item) => item.name));
  return names.every((name) => own.has(name));
};
