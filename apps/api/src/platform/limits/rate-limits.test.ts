import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Config } from '../config/config';
import { connectValkey, type Valkey } from '../queue/valkey';
import { networkOf, RateLimits } from './rate-limits';

let valkey: Valkey;
const config = () => ({ SESSION_SIGNING_KEY: randomBytes(32).toString('base64') }) as Config;
beforeAll(async () => {
  valkey = connectValkey(inject('valkeyUrl'), 'api');
  await valkey.connect();
});
afterAll(() => valkey.quit());

describe('network of an address', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    // One subscriber, whatever the addresses they draw.
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2'],
    ['2001:db8:1:2::1', '2001:db8:1:2'],
    ['2001:0db8:0001:0002::', '2001:db8:1:2'],
    ['2001:db8::1', '2001:db8:0:0'],
    ['2001:db8:0:0:0:0:0:1', '2001:db8:0:0'],
    ['::1', '0:0:0:0'],
    ['::', '0:0:0:0'],
    [undefined, 'unknown'],
  ])('of %s is %s', (ip, network) => expect(networkOf(ip)).toBe(network));
});

describe('limit', () => {
  const limit = { name: 'test', max: 3, seconds: 600 };

  it('stops beyond it, for that name and that origin only', async () => {
    const limits = new RateLimits(valkey, config());
    for (let i = 0; i < 3; i += 1) await limits.take(limit, 'a');
    await expect(limits.take(limit, 'a')).rejects.toMatchObject({ status: 429, code: 'TOO_MANY' });
    await limits.take(limit, 'b');
    await limits.take({ ...limit, name: 'other' }, 'a');
  });

  it('counts what comes at the same time', async () => {
    const limits = new RateLimits(valkey, config());
    const answers = await Promise.allSettled(Array.from({ length: 20 }, () => limits.take(limit, 'a')));
    expect(answers.filter((answer) => answer.status === 'fulfilled')).toHaveLength(3);
  });

  it('starts again with the next window, and leaves nothing behind', async () => {
    const limits = new RateLimits(valkey, config());
    const short = { ...limit, seconds: 1 };
    const until = Math.ceil(Date.now() / 1000) * 1000 + 20;
    await new Promise((resolve) => setTimeout(resolve, until - Date.now()));
    for (let i = 0; i < 3; i += 1) await limits.take(short, 'a');
    await expect(limits.take(short, 'a')).rejects.toMatchObject({ status: 429 });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await limits.take(short, 'a');
  });

  it('writes no address in Valkey, and every key ends', async () => {
    const limits = new RateLimits(valkey, config());
    const name = `kept-${randomBytes(4).toString('hex')}`;
    await limits.take({ ...limit, name }, '203.0.113.99');
    const keys = await valkey.keys(`limit:${name}:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('203.0.113.99');
      expect(await valkey.ttl(key)).toBeGreaterThan(0);
    }
  });

  it('refuses when Valkey does not answer, or answers something else', async () => {
    const away = connectValkey('redis://127.0.0.1:1/0', 'api');
    away.on('error', () => undefined);
    await expect(new RateLimits(away, config()).take(limit, 'a')).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE' });
    away.disconnect();
    const strange = { multi: () => ({ incr: () => ({ expire: () => ({ exec: () => Promise.resolve([[new Error('x'), null]]) }) }) }) } as unknown as Valkey;
    await expect(new RateLimits(strange, config()).take(limit, 'a')).rejects.toMatchObject({ status: 503 });
  });
});
