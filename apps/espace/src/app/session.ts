import { session as sessionSchema, type Session } from '@legarec/contracts';
import { finishSignOut, onSessionChanged, onSessionLost, tellSessionChanged } from '@legarec/platform';
import { useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { createContext, use, useEffect, useRef } from 'react';
import { z } from 'zod';
import { api, ApiError } from './api';

export const SESSION_KEY = ['session'];
const everythingElse = { predicate: ({ queryKey }: Query) => queryKey[0] !== SESSION_KEY[0] };

export function useSession() {
  const client = useQueryClient();
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<Session | null> => {
      const before = client.getQueryData<Session | null>(SESSION_KEY);
      if (!(await finishSignOut())) return null;
      try {
        const now = await api(sessionSchema, '/auth/session');
        // Someone else signed in from another tab: nothing of what the former one was shown stays.
        if (before && before.userId !== now.userId) void client.resetQueries(everythingElse);
        return now;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    // Without any answer yet, it is asked again until there is one.
    refetchInterval: (query) => (query.state.status === 'error' && query.state.data === undefined ? 10_000 : false),
  });
}

/** Follows the end of the session, however it came: the screen goes back to the sign-in, and keeps nothing. */
export function useSessionEnd() {
  const client = useQueryClient();
  const { data } = useSession();
  const known = useRef(false);
  useEffect(() => onSessionLost(() => void client.invalidateQueries({ queryKey: SESSION_KEY })), [client]);
  // Opened or closed from another tab: nothing stays on screen until the API has said who is there.
  useEffect(
    () =>
      onSessionChanged(() => {
        known.current = false;
        void client.resetQueries({ queryKey: SESSION_KEY });
        client.removeQueries(everythingElse);
      }),
    [client],
  );
  useEffect(() => {
    if (data === null) {
      client.removeQueries(everythingElse);
      if (known.current) tellSessionChanged();
    }
    known.current = !!data;
  }, [client, data]);
}

/** Whoever the screen was opened for, until it is closed: never the gap between two sessions. */
export const CurrentUser = createContext<Session | null>(null);
export function useCurrentUser(): Session {
  const user = use(CurrentUser);
  if (!user) throw new Error('No session');
  return user;
}

export function useUpdatePreferences() {
  const client = useQueryClient();
  return async (preferences: Partial<Session['preferences']>) => {
    const current = client.getQueryData<Session>(SESSION_KEY);
    if (!current) return;
    const next = { ...current, preferences: { ...current.preferences, ...preferences } };
    client.setQueryData(SESSION_KEY, next);
    await api(z.undefined(), '/auth/preferences', { method: 'PUT', body: next.preferences });
  };
}
