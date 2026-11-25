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
  failures: new Map<string, number>(),
  readNotifications: new Set<string>(),
  priorities: new Map<string, boolean>(),
  preferences: new Map<string, Session['preferences']>(),
  delegations: ['TECHNICAL', 'ADMINISTRATIVE'] as Session['activeDelegations'],
  names: new Map<string, { firstName: string; lastName: string }>(),
};

export function setAccount(id: string | null) {
  state.accountId = id === 'none' ? null : id;
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
