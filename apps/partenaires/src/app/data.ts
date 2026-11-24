import { partnerSession, type PartnerSession } from '@legarec/contracts';
import { api, ApiError } from '@legarec/platform';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

export const SESSION_KEY = ['session'];

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
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<PartnerSession | null> => {
      try {
        return await api(partnerSession, '/auth/session');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}
export function usePartner(): PartnerSession {
  const { data } = useSession();
  if (!data) throw new Error('No session');
  return data;
}
