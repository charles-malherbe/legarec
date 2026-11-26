import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
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

describe('sliding limit', () => {
  afterEach(() => vi.useRealTimers());
  const limit = { name: 'sliding', max: 3, seconds: 600, sliding: true };

  it('counts the last ten minutes, across the edge of a fixed window', async () => {
    const limits = new RateLimits(valkey, config());
    // One second before the edge of a fixed window of ten minutes.
    const edge = (Math.floor(Date.now() / 600_000) + 1) * 600_000;
    vi.useFakeTimers({ toFake: ['Date'], now: edge - 1_000 });
    for (let i = 0; i < 3; i += 1) await limits.take(limit, 'a');
    // A fixed window would start again here: the sliding one does not.
    vi.setSystemTime(edge + 1_000);
    await expect(limits.take(limit, 'a')).rejects.toMatchObject({ status: 429, code: 'TOO_MANY' });
    await limits.take(limit, 'b');
    // Ten minutes after the first three, room again; the refused one took none.
    vi.setSystemTime(edge - 1_000 + 600_000);
    await limits.take(limit, 'a');
    await limits.take(limit, 'a');
    await limits.take(limit, 'a');
    await expect(limits.take(limit, 'a')).rejects.toMatchObject({ status: 429 });
  });

  it('counts what comes at the same time', async () => {
    const limits = new RateLimits(valkey, config());
    const answers = await Promise.allSettled(Array.from({ length: 20 }, () => limits.take(limit, 'c')));
    expect(answers.filter((answer) => answer.status === 'fulfilled')).toHaveLength(3);
  });
});

describe('failures in all', () => {
  afterEach(() => vi.useRealTimers());
  const watch = { name: 'watched', max: 3, seconds: 3600, suspendSeconds: 900, least: 3 };

  it('tells an episode beyond the limit until it is told, and suspends 15 minutes the networks of three failures only', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const limits = new RateLimits(valkey, config());
    for (let i = 0; i < 3; i += 1) expect(await limits.failed(watch, 'a')).toBe(false);
    await limits.refuseSuspended(watch, 'a');
    // The fourth: an episode, to be told; the network of three failures is suspended, the one of one is not.
    expect(await limits.failed(watch, 'b')).toBe(true);
    await expect(limits.refuseSuspended(watch, 'a')).rejects.toMatchObject({ status: 429, code: 'TOO_MANY' });
    await limits.refuseSuspended(watch, 'b');
    // Not told yet (the alert could not be written): the next failure says it again.
    expect(await limits.failed(watch, 'c')).toBe(true);
    await limits.told(watch);
    // The same episode: a network is suspended at its third failure, nobody told again.
    expect(await limits.failed(watch, 'b')).toBe(false);
    await limits.refuseSuspended(watch, 'b');
    expect(await limits.failed(watch, 'b')).toBe(false);
    await expect(limits.refuseSuspended(watch, 'b')).rejects.toMatchObject({ status: 429 });
    await limits.refuseSuspended(watch, 'c');
    // A request without an address is everybody at once: counted, never suspended.
    for (let i = 0; i < 5; i += 1) await limits.failed(watch, 'unknown');
    await limits.refuseSuspended(watch, 'unknown');
    vi.setSystemTime(Date.now() + 900_000 + 1);
    for (const of of ['a', 'b']) await limits.refuseSuspended(watch, of);
    // An hour without a failure beyond the limit: the next one is a new episode, to be told again.
    vi.setSystemTime(Date.now() + 3_600_000);
    for (const of of ['a', 'b', 'c']) expect(await limits.failed(watch, of)).toBe(false);
    expect(await limits.failed(watch, 'd')).toBe(true);
  });

  it('keeps no address, and every key ends', async () => {
    const limits = new RateLimits(valkey, config());
    const name = `kept-${randomBytes(4).toString('hex')}`;
    for (let i = 0; i < 3; i += 1) await limits.failed({ ...watch, name, max: 1, least: 1 }, '203.0.113.98');
    const keys = await valkey.keys(`limit:${name}:*`);
    expect(keys.length).toBeGreaterThan(3);
    for (const key of keys) {
      expect(key).not.toContain('203.0.113.98');
      expect(await valkey.ttl(key)).toBeGreaterThan(0);
      if ((await valkey.type(key)) === 'zset') for (const member of await valkey.zrange(key, 0, -1)) expect(member).not.toContain('203.0.113');
    }
  });

  it('refuses when Valkey does not answer', async () => {
    const away = connectValkey('redis://127.0.0.1:1/0', 'api');
    away.on('error', () => undefined);
    const limits = new RateLimits(away, config());
    await expect(limits.refuseSuspended(watch, 'a')).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE' });
    await expect(limits.failed(watch, 'a')).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE' });
    await expect(limits.take({ name: 'x', max: 1, seconds: 60, sliding: true }, 'a')).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE' });
    away.disconnect();
  });
});
