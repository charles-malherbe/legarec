import { session as sessionSchema, type Session } from '@legarec/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError } from './api';

export const SESSION_KEY = ['session'];

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<Session | null> => {
      try {
        return await api(sessionSchema, '/auth/session');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

export function useCurrentUser(): Session {
  const { data } = useSession();
  if (!data) throw new Error('No session');
  return data;
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
