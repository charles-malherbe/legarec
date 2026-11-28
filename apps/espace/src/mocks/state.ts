import type { Session } from '@legarec/contracts';
import { ACCOUNTS } from './accounts';

const STORAGE = 'msw-demo-account';
const read = () => {
  try {
    return sessionStorage.getItem(STORAGE);
  } catch {
    return null;
  }
};

/** In-memory stand-in for the API session cookie. The storage only holds a demo account id, never a token. */
export const state = {
  accountId: (read() ?? 'cl') as string | null,
  pending: null as string | null,
  /** The account signing in already has a second factor. */
  setUp: true,
  wrongCodes: 0,
  /** Last proof of identity, and the wrong ones since. */
  provedAt: Date.now(),
  wrongProofs: 0,
  failures: new Map<string, number>(),
  readNotifications: new Set<string>(),
  priorities: new Map<string, boolean>(),
  preferences: new Map<string, Session['preferences']>(),
  delegations: ['TECHNICAL', 'ADMINISTRATIVE'] as Session['activeDelegations'],
  names: new Map<string, { firstName: string; lastName: string }>(),
  /** The last cases opened by each account, the latest first (as `users.recent_case_ids`). */
  recentCases: new Map<string, string[]>(),
};

/** As `app.note_recent_case`: the case opened goes first, and the sixth falls off. */
export function noteRecentCase(userId: string, caseId: string) {
  state.recentCases.set(userId, [caseId, ...(state.recentCases.get(userId) ?? []).filter((id) => id !== caseId)].slice(0, 5));
}

export function setAccount(id: string | null) {
  state.accountId = id === 'none' ? null : id;
  state.provedAt = Date.now();
  state.wrongProofs = 0;
  try {
    sessionStorage.setItem(STORAGE, id ?? 'none');
  } catch {
    /* storage unavailable */
  }
}
if (state.accountId === 'none') state.accountId = null;

export function currentSession(): Session | null {
  const account = ACCOUNTS.find((item) => item.userId === state.accountId);
  return account
    ? {
        ...account,
        ...state.names.get(account.userId),
        activeDelegations: state.delegations,
        preferences: state.preferences.get(account.userId) ?? account.preferences,
      }
    : null;
}
