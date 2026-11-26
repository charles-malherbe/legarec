import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
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
  /** Counted over the last `seconds` rather than by fixed windows, which let twice the limit through across their edge. */
  sliding?: boolean;
}

/** Failures in all, from every network: beyond `max` over the last `seconds`, the networks in cause are suspended. */
export interface FailureWatch {
  name: string;
  max: number;
  seconds: number;
  suspendSeconds: number;
}

/** What tries the last `span` milliseconds kept, and the one that comes when there is room for it. */
const SLIDING = `
local now, span, max = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - span)
local count = redis.call('ZCARD', KEYS[1]) + 1
if count <= max then redis.call('ZADD', KEYS[1], now, ARGV[4]) end
redis.call('PEXPIRE', KEYS[1], span)
return count`;

/**
 * One failure more. Beyond the limit, an episode starts when none ran during the last `span`: every network that failed
 * in that time is suspended; during an episode, the network that fails again is. 1 when an episode starts, 0 otherwise.
 * The members are `<digest of the network>:<random>`: no address is written. The list stops growing at ten times the
 * limit; the episode goes on all the same.
 */
const FAILED = `
local now, span, max, suspend = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local network, prefix = ARGV[5], ARGV[6]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - span)
local count = redis.call('ZCARD', KEYS[1])
if count < max * 10 then
  redis.call('ZADD', KEYS[1], now, network .. ':' .. ARGV[7])
  count = count + 1
end
redis.call('PEXPIRE', KEYS[1], span)
if count <= max then return 0 end
local last = tonumber(redis.call('GET', KEYS[2]) or '-1')
redis.call('SET', KEYS[2], now, 'PX', span)
local starts = last < 0 or now - last >= span
local suspended = { [network] = true }
if starts then
  for _, member in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
    suspended[string.match(member, '^[^:]+')] = true
  end
end
for each in pairs(suspended) do redis.call('SET', prefix .. each, now + suspend, 'PX', suspend) end
if starts then return 1 end
return 0`;

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
  async take({ name, max, seconds, sliding = false }: RateLimit, of: string = networkOf(requestFacts().ip)): Promise<void> {
    if (sliding) {
      const key = `limit:${name}:sliding:${this.digest(of)}`;
      const count = await this.ask(() => this.valkey.eval(SLIDING, 1, key, Date.now(), seconds * 1000, max, `${Date.now()}:${randomBytes(8).toString('hex')}`));
      if (count > max) throw new ApiError(429, 'TOO_MANY');
      return;
    }
    const window = Math.floor(Date.now() / 1000 / seconds);
    const key = `limit:${name}:${window}:${this.digest(of)}`;
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

  /** Refused (429, as beyond a limit) while this network is suspended by `failed`; refused too without Valkey. */
  async refuseSuspended({ name }: FailureWatch, of: string = networkOf(requestFacts().ip)): Promise<void> {
    const until = await this.ask(async () => Number((await this.valkey.get(`limit:${name}:off:${this.digest(of)}`)) ?? 0));
    if (until > Date.now()) throw new ApiError(429, 'TOO_MANY');
  }

  /** Notes a failure of this network; true when it starts an episode beyond the limit, to be told once. */
  async failed({ name, max, seconds, suspendSeconds }: FailureWatch, of: string = networkOf(requestFacts().ip)): Promise<boolean> {
    // The keys of all networks are kept apart from those of another deployment (or another test) by the keyed digest.
    const all = this.digest(`all:${name}`);
    const answer = await this.ask(() =>
      this.valkey.eval(
        FAILED,
        2,
        `limit:${name}:all:${all}`,
        `limit:${name}:episode:${all}`,
        Date.now(),
        seconds * 1000,
        max,
        suspendSeconds * 1000,
        this.digest(of),
        `limit:${name}:off:`,
        randomBytes(8).toString('hex'),
      ),
    );
    return answer === 1;
  }

  /** The episode was not told after all (the alert could not be written): the next failure beyond the limit starts it again. */
  async untold({ name }: FailureWatch): Promise<void> {
    await this.valkey.del(`limit:${name}:episode:${this.digest(`all:${name}`)}`);
  }

  private digest(of: string): string {
    return digest(this.key, of).toString('base64url');
  }

  /** A number from Valkey, or 503: without it, nothing is counted and nothing goes through. */
  private async ask(question: () => Promise<unknown>): Promise<number> {
    let answer: unknown;
    try {
      answer = await question();
    } catch {
      throw new ApiError(503, 'UNAVAILABLE');
    }
    if (typeof answer !== 'number' || !Number.isFinite(answer)) throw new ApiError(503, 'UNAVAILABLE');
    return answer;
  }
}
