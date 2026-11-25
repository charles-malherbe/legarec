import { Redis } from 'ioredis';

export type Valkey = Redis;
export const VALKEY = Symbol('VALKEY');

/** `maxRetriesPerRequest: null` is required by BullMQ; the API prefers a quick refusal to a request that hangs. */
export function connectValkey(url: string, use: 'api' | 'jobs'): Valkey {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: use === 'jobs' ? null : 1,
    enableOfflineQueue: use === 'jobs',
    retryStrategy: (times) => Math.min(times * 200, 3_000),
  });
}
