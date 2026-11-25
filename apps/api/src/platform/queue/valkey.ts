import { Redis } from 'ioredis';

export type Valkey = Redis;
export const VALKEY = Symbol('VALKEY');

/** Waits for Valkey for as long as it takes; the client tries again by itself. */
export async function whenReady(link: Valkey): Promise<void> {
  if (link.status === 'ready') return;
  const ready = new Promise<void>((resolve) => link.once('ready', resolve));
  if (link.status === 'wait') link.connect().catch(() => undefined);
  await ready;
}

/** `maxRetriesPerRequest: null` is required by BullMQ; the API prefers a quick refusal to a request that hangs. */
export function connectValkey(url: string, use: 'api' | 'jobs'): Valkey {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: use === 'jobs' ? null : 1,
    enableOfflineQueue: use === 'jobs',
    retryStrategy: (times) => Math.min(times * 200, 3_000),
  });
}
