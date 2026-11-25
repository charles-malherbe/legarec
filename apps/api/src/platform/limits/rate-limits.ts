import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config/config';
import { deriveKey, digest } from '../crypto/keyring';
import { ApiError } from '../errors/api-error';
import { requestFacts } from '../http/context';
import { VALKEY, type Valkey } from '../queue/valkey';

/** Network of an address: the address itself, or the /64 block that IPv6 gives to one subscriber. */
export function networkOf(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0'), ...right];
  return groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group || '0', 16).toString(16))
    .join(':');
}

export interface RateLimit {
  name: string;
  max: number;
  seconds: number;
}

/** Counts by network and by window of time. No address is written in Valkey: its digest is keyed. */
@Injectable()
export class RateLimits {
  private readonly key: Buffer;

  constructor(
    @Inject(VALKEY) private readonly valkey: Valkey,
    @Inject(CONFIG) config: Config,
  ) {
    this.key = deriveKey(Buffer.from(config.SESSION_SIGNING_KEY, 'base64'), 'rate-limit');
  }

  /** Counts one request of this network, refused beyond the limit. Without Valkey, nothing is counted: refused too. */
  async take({ name, max, seconds }: RateLimit, of: string = networkOf(requestFacts().ip)): Promise<void> {
    const window = Math.floor(Date.now() / 1000 / seconds);
    const key = `limit:${name}:${window}:${digest(this.key, of).toString('base64url')}`;
    let count: unknown;
    try {
      const answers = await this.valkey.multi().incr(key).expire(key, seconds).exec();
      count = answers?.[0]?.[1];
    } catch {
      throw new ApiError(503, 'UNAVAILABLE');
    }
    if (typeof count !== 'number') throw new ApiError(503, 'UNAVAILABLE');
    if (count > max) throw new ApiError(429, 'TOO_MANY');
  }
}
