import type { z } from 'zod';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

/** Session travels in an httpOnly cookie: no token is ever readable here. */
export async function api<T extends z.ZodType>(schema: T, path: string, init: { method?: string; body?: unknown } = {}): Promise<z.infer<T>> {
  const response = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(response.status, body);
  return schema.parse(body);
}
