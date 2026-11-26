import { z } from 'zod';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

const lost = new Set<() => void>();
/** Told when the API knows nobody any more: the session has ended, by itself, elsewhere or by someone else. */
export function onSessionLost(listener: () => void): () => void {
  lost.add(listener);
  return () => void lost.delete(listener);
}

/** Asks whoever is there for a proof of identity; false when they give none. */
type ProofAsker = (method: string, path: string) => Promise<boolean>;
let prover: ProofAsker | null = null;
/** What the API asks before what matters most. One screen at a time. */
export function onProofRequired(asker: ProofAsker): () => void {
  prover = asker;
  return () => {
    if (prover === asker) prover = null;
  };
}
const needsProof = ({ status, body }: ApiError) => status === 403 && (body as { code?: unknown } | undefined)?.code === 'PROOF_REQUIRED';

async function read<T extends z.ZodType>(schema: T, response: Response, path: string): Promise<z.infer<T>> {
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (response.ok) return schema.parse(body);
  // The sign-in itself answers for the proof that it was given.
  if (response.status === 401 && !path.startsWith('/auth/')) for (const tell of lost) tell();
  throw new ApiError(response.status, body);
}

/**
 * Keys of the changes whose outcome is unknown. Clicked twice, or cut by the network then tried again, a change
 * keeps its key: the API acts once and gives the same answer. Memory only, for an hour or until the session is closed,
 * and under a print of the change: what was typed is not kept.
 */
const unknownOutcome = new Map<string, { key: string; until: number }>();
const MAX_UNKNOWN = 50;
const KEPT_MS = 60 * 60 * 1000;

const [SEED = 0] = crypto.getRandomValues(new Uint32Array(1));
/**
 * 64 bits, drawn differently by each page: enough to recognise a change among fifty (the API compares the whole body).
 * Computed at once, unlike a digest of the browser: the changes leave in the order they were made, whatever their size.
 */
function printOf(change: string): string {
  let a = 0xdeadbeef ^ SEED;
  let b = 0x41c6ce57 ^ SEED;
  for (let i = 0; i < change.length; i += 1) {
    const code = change.charCodeAt(i);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return `${a >>> 0}-${b >>> 0}`;
}

function keyOf(print: string): string {
  const known = unknownOutcome.get(print);
  const kept = known && known.until > Date.now() ? known : { key: crypto.randomUUID(), until: Date.now() + KEPT_MS };
  unknownOutcome.delete(print);
  unknownOutcome.set(print, kept);
  const oldest = unknownOutcome.keys().next().value;
  if (unknownOutcome.size > MAX_UNKNOWN && oldest !== undefined) unknownOutcome.delete(oldest);
  return kept.key;
}

export interface ApiInit {
  method?: string;
  body?: unknown;
  /** Asked by the screen itself, at regular intervals: it does not keep the session open. */
  background?: boolean;
}

/** Session travels in an httpOnly cookie: no token is ever readable here. */
export async function api<T extends z.ZodType>(schema: T, path: string, init: ApiInit = {}): Promise<z.infer<T>> {
  const method = init.method ?? 'GET';
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const send = async (): Promise<z.infer<T>> => {
    if (path.endsWith('/logout')) unknownOutcome.clear();
    const print = method === 'GET' ? null : printOf(`${method} ${path} ${body ?? ''}`);
    const response = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(print === null ? {} : { 'idempotency-key': keyOf(print) }),
        ...(init.background ? { 'x-background': '1' } : {}),
      },
      body,
    });
    // After a failure of the API or of the proxy, nobody knows whether the change was made: the key is kept.
    if (print !== null && response.status < 500) unknownOutcome.delete(print);
    return read(schema, response, path);
  };
  try {
    return await send();
  } catch (error) {
    // Refused before anything was done: asked once, then sent again as it was.
    if (!(error instanceof ApiError) || !needsProof(error) || !prover || !(await prover(method, path))) throw error;
    return send();
  }
}

/** A file given by the API (a document once ClamAV found it clean), under the neutral name it gives. */
export async function download(path: string): Promise<{ blob: Blob; name: string }> {
  const response = await fetch(BASE + path, { credentials: 'include' });
  if (!response.ok) await read(z.unknown(), response, path);
  const name = /filename="([^"]+)"/u.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'document';
  return { blob: await response.blob(), name };
}

/** Sends a file as is: the API checks and analyses it. Its name never goes into the URL nor a header. */
export async function upload<T extends z.ZodType>(schema: T, path: string, file: File): Promise<z.infer<T>> {
  const response = await fetch(BASE + path, {
    method: 'POST',
    credentials: 'include',
    // A key of its own: sent again after a cut, the same file is received once.
    headers: { 'content-type': file.type || 'application/octet-stream', 'idempotency-key': crypto.randomUUID() },
    body: await file.arrayBuffer(),
  });
  return read(schema, response, path);
}
