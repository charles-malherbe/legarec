import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './api';

export function useApi<T extends z.ZodType>(schema: T, path: string, options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: [path], queryFn: () => api(schema, path), ...options });
}

/** Runs a change on the API, then refreshes every list that could show it. */
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
