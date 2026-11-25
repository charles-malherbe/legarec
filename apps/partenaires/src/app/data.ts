import { partnerSession, type PartnerSession } from '@legarec/contracts';
import { api, ApiError, onSessionLost } from '@legarec/platform';
import { useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { createContext, use, useEffect } from 'react';
import { z } from 'zod';

export const SESSION_KEY = ['session'];
const everythingElse = { predicate: ({ queryKey }: Query) => queryKey[0] !== SESSION_KEY[0] };

export function useApi<T extends z.ZodType>(schema: T, path: string) {
  return useQuery({ queryKey: [path], queryFn: () => api(schema, path) });
}
/** Runs a change on the API, then refreshes what could show it. */
export function useChange() {
  const client = useQueryClient();
  return async <T extends z.ZodType = z.ZodUndefined>(
    path: string,
    options: { method?: 'POST' | 'PUT' | 'DELETE'; body?: unknown; schema?: T } = {},
  ): Promise<z.infer<T>> => {
    const result = await api((options.schema ?? z.undefined()) as T, path, { method: options.method ?? 'POST', body: options.body });
    await client.invalidateQueries();
    return result;
  };
}
export function useSession() {
  const client = useQueryClient();
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<PartnerSession | null> => {
      const before = client.getQueryData<PartnerSession | null>(SESSION_KEY);
      try {
        const now = await api(partnerSession, '/auth/session');
        // Someone else signed in from another tab: nothing of what the former one was shown stays.
        if (before && before.userId !== now.userId) void client.resetQueries(everythingElse);
        return now;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}
/** Follows the end of the session, however it came: the screen goes back to the sign-in, and keeps nothing. */
export function useSessionEnd() {
  const client = useQueryClient();
  const { data } = useSession();
  useEffect(() => onSessionLost(() => void client.invalidateQueries({ queryKey: SESSION_KEY })), [client]);
  useEffect(() => {
    if (data === null) client.removeQueries(everythingElse);
  }, [client, data]);
}
/** Whoever the screen was opened for, until it is closed: never the gap between two sessions. */
export const CurrentPartner = createContext<PartnerSession | null>(null);
export function usePartner(): PartnerSession {
  const partner = use(CurrentPartner);
  if (!partner) throw new Error('No session');
  return partner;
}
