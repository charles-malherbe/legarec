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
 * keeps its key: the API acts once and gives the same answer. Memory only, for an hour or until the session is closed,
 * and under a digest of the change: what was typed is not kept.
 */
const unknownOutcome = new Map<string, { key: string; until: number }>();
const MAX_UNKNOWN = 50;
const KEPT_MS = 60 * 60 * 1000;

/** One digest after the other: the changes leave in the order they were made, whatever their size. */
let previous: Promise<unknown> = Promise.resolve();
function digestOf(change: string): Promise<string> {
  const digest = previous.then(async () => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(change))).join());
  previous = digest.catch(() => undefined);
  return digest;
}

function keyOf(digest: string): string {
  const known = unknownOutcome.get(digest);
  const kept = known && known.until > Date.now() ? known : { key: crypto.randomUUID(), until: Date.now() + KEPT_MS };
  unknownOutcome.delete(digest);
  unknownOutcome.set(digest, kept);
  const oldest = unknownOutcome.keys().next().value;
  if (unknownOutcome.size > MAX_UNKNOWN && oldest !== undefined) unknownOutcome.delete(oldest);
  return kept.key;
}

/** Session travels in an httpOnly cookie: no token is ever readable here. */
export async function api<T extends z.ZodType>(schema: T, path: string, init: { method?: string; body?: unknown } = {}): Promise<z.infer<T>> {
  const method = init.method ?? 'GET';
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  if (path.endsWith('/logout')) unknownOutcome.clear();
  const digest = method === 'GET' ? null : await digestOf(`${method} ${path} ${body ?? ''}`);
  const response = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(digest === null ? {} : { 'idempotency-key': keyOf(digest) }),
    },
    body,
  });
  // After a failure of the API or of the proxy, nobody knows whether the change was made: the key is kept.
  if (digest !== null && response.status < 500) unknownOutcome.delete(digest);
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
