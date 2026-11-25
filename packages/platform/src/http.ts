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

async function read<T extends z.ZodType>(schema: T, response: Response): Promise<z.infer<T>> {
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(response.status, body);
  return schema.parse(body);
}

/**
 * Keys of the changes whose outcome is unknown. Clicked twice, or cut by the network then tried again, a change
 * keeps its key: the API acts once and gives the same answer. Memory only, never stored.
 */
const unknownOutcome = new Map<string, string>();
const MAX_UNKNOWN = 50;
/** Answered by the proxy rather than by the API: the change may have been made. */
const FROM_PROXY = new Set([502, 503, 504]);

function keyOf(signature: string): string {
  const key = unknownOutcome.get(signature) ?? crypto.randomUUID();
  unknownOutcome.delete(signature);
  unknownOutcome.set(signature, key);
  const oldest = unknownOutcome.keys().next().value;
  if (unknownOutcome.size > MAX_UNKNOWN && oldest !== undefined) unknownOutcome.delete(oldest);
  return key;
}

/** Session travels in an httpOnly cookie: no token is ever readable here. */
export async function api<T extends z.ZodType>(schema: T, path: string, init: { method?: string; body?: unknown } = {}): Promise<z.infer<T>> {
  const method = init.method ?? 'GET';
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const signature = method === 'GET' ? null : `${method} ${path} ${body ?? ''}`;
  const response = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(signature === null ? {} : { 'idempotency-key': keyOf(signature) }),
    },
    body,
  });
  if (signature !== null && !FROM_PROXY.has(response.status)) unknownOutcome.delete(signature);
  return read(schema, response);
}

/** Sends a file as is: the API checks and analyses it. Its name never goes into the URL nor a header. */
export async function upload<T extends z.ZodType>(schema: T, path: string, file: File): Promise<z.infer<T>> {
  const response = await fetch(BASE + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: await file.arrayBuffer(),
  });
  return read(schema, response);
}
