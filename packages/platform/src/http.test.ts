import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api, ApiError, upload } from './http';

const sent: { method: string; key: string | null; init: RequestInit; url: string }[] = [];
let answer: () => Response | Promise<Response>;
const ok = () => new Response(null, { status: 204 });

beforeEach(() => {
  sent.length = 0;
  answer = ok;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({ method: init.method ?? 'GET', key: new Headers(init.headers).get('idempotency-key'), init, url });
    return Promise.resolve(answer());
  });
});
afterEach(() => vi.unstubAllGlobals());

const change = (body: unknown = { text: 'Bonjour' }) => api(z.undefined(), '/cases/demo/notes', { method: 'POST', body });
const keys = () => sent.map((item) => item.key);

describe('key of a change', () => {
  it('is a number drawn for each change, and absent from a reading', async () => {
    await change();
    await change();
    await api(z.undefined(), '/cases');
    expect(keys()[0]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(keys()[1]).not.toBe(keys()[0]);
    expect(keys()[2]).toBeNull();
  });

  it('is shared by a double click, not by another change', async () => {
    const release: (() => void)[] = [];
    answer = () => new Promise<Response>((resolve) => release.push(() => resolve(ok())));
    const both = [change(), change(), change({ text: 'Autre' })];
    // Already gone: a click leaves at once.
    expect(sent).toHaveLength(3);
    for (const go of release) go();
    await Promise.all(both);
    expect(keys()[1]).toBe(keys()[0]);
    expect(keys()[2]).not.toBe(keys()[0]);
  });

  it('does not change the order of the changes, whatever their size', async () => {
    const sizes = [900_000, 1, 100_000, 2];
    await Promise.all(sizes.map((size) => change({ text: 'x'.repeat(size) })));
    expect(sent.map(({ init }) => (JSON.parse(String(init.body)) as { text: string }).text.length)).toEqual(sizes);
  });

  it('survives a network failure and an answer of the proxy, until the API answers', async () => {
    answer = () => Promise.reject(new TypeError('network'));
    await change().catch(() => undefined);
    answer = () => new Response(null, { status: 502 });
    await change().catch(() => undefined);
    answer = ok;
    await change();
    await change();
    expect(new Set(keys().slice(0, 3)).size).toBe(1);
    expect(keys()[3]).not.toBe(keys()[0]);
  });

  it('is renewed after a refusal', async () => {
    answer = () => new Response('{"code":"INVALID"}', { status: 422 });
    await change().catch(() => undefined);
    await change().catch(() => undefined);
    expect(keys()[1]).not.toBe(keys()[0]);
  });
});

describe('keys kept in memory', () => {
  const offline = () => Promise.reject(new TypeError('network'));
  const lose = async (count: number, from = 0) => {
    answer = offline;
    sent.length = 0;
    for (let i = from; i < from + count; i += 1) await change({ number: i }).catch(() => undefined);
    const known = keys();
    sent.length = 0;
    return known;
  };
  /** Key of one more try of that change, still without any answer. */
  const again = async (number: number) => {
    sent.length = 0;
    await change({ number }).catch(() => undefined);
    return keys()[0];
  };

  it('are fifty at most: beyond, the oldest is forgotten, and that one only', async () => {
    const known = await lose(51);
    expect(new Set(known).size).toBe(51);
    // Number 1 to 50 are still known; 0 was the oldest.
    expect(await again(50)).toBe(known[50]);
    expect(await again(1)).toBe(known[1]);
    const renewed = await again(0);
    expect(renewed).toMatch(/^[0-9a-f-]{36}$/u);
    expect(known).not.toContain(renewed);
  });

  it('keep first the changes tried again lately', async () => {
    const known = await lose(50, 100);
    // The oldest one is tried again: it is now the most recent.
    expect(await again(100)).toBe(known[0]);
    await lose(1, 200);
    expect(await again(100)).toBe(known[0]);
    expect(await again(101)).not.toBe(known[1]);
  });

  it('are forgotten once the API has accepted or refused', async () => {
    for (const [index, status] of [200, 400, 401, 403, 404, 409, 413, 422, 429].entries()) {
      const [first] = await lose(1, 300 + index);
      answer = () => new Response('{}', { status });
      await api(z.unknown(), '/cases/demo/notes', { method: 'POST', body: { number: 300 + index } }).catch(() => undefined);
      expect(keys(), String(status)).toEqual([first]);
      answer = offline;
      expect(await again(300 + index), String(status)).not.toBe(first);
    }
  });

  it.each([500, 502, 503, 504])('are kept after a failure %s, of the API or of the proxy in its place', async (status) => {
    const [first] = await lose(1, 400 + status);
    answer = () => new Response('<html>', { status });
    await change({ number: 400 + status }).catch(() => undefined);
    answer = offline;
    expect(await again(400 + status)).toBe(first);
  });

  it('live an hour from the first try, even when tried again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const [first] = await lose(1, 500);
      vi.setSystemTime(Date.now() + 59 * 60_000);
      expect(await again(500)).toBe(first);
      vi.setSystemTime(Date.now() + 2 * 60_000);
      expect(await again(500)).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['/auth/logout', '/debtor/logout'])('do not outlive the session closed by %s', async (path) => {
    const [first, second] = await lose(2, 600);
    expect(await again(600)).toBe(first);
    answer = ok;
    await api(z.undefined(), path, { method: 'POST' });
    answer = offline;
    expect(await again(600)).not.toBe(first);
    expect(await again(601)).not.toBe(second);
  });

  it('are told apart by one character, at any place of a long change', async () => {
    answer = offline;
    const long = 'x'.repeat(5_000);
    const texts = [long, ...[0, 1, 2_500, 4_998, 4_999].map((at) => `${long.slice(0, at)}y${long.slice(at + 1)}`), `${long}x`, long.slice(1)];
    for (const text of texts) await change({ text }).catch(() => undefined);
    expect(new Set(keys()).size).toBe(texts.length);
    // Thousands of changes that look alike: no key is given twice.
    sent.length = 0;
    for (let i = 0; i < 3_000; i += 1) await change({ amount: 100_000 + i }).catch(() => undefined);
    expect(new Set(keys()).size).toBe(3_000);
  });

  it('are kept under a print: what was typed is nowhere', async () => {
    const written = vi.spyOn(Map.prototype, 'set');
    answer = offline;
    await api(z.undefined(), '/account/password', { method: 'PUT', body: { current: 'phrase secrète', next: 'x' } }).catch(() => undefined);
    expect(written).toHaveBeenCalled();
    const kept = JSON.stringify(written.mock.calls);
    written.mockRestore();
    expect(kept).toContain(keys()[0]);
    expect(kept).not.toMatch(/phrase|secr|password/u);
  });

  it('differ from one path, one method and one body to the other', async () => {
    answer = offline;
    const tries: [string, { method: string; body?: unknown }][] = [
      ['/cases/a/notes', { method: 'POST', body: { text: 'x' } }],
      ['/cases/b/notes', { method: 'POST', body: { text: 'x' } }],
      ['/cases/a/notes', { method: 'PUT', body: { text: 'x' } }],
      ['/cases/a/notes', { method: 'POST', body: { text: 'y' } }],
      ['/cases/a/notes', { method: 'POST' }],
      ['/cases/a/notes', { method: 'DELETE' }],
    ];
    for (const [path, init] of [...tries, ...tries]) await api(z.undefined(), path, init).catch(() => undefined);
    expect(new Set(keys()).size).toBe(tries.length);
    expect(keys().slice(tries.length)).toEqual(keys().slice(0, tries.length));
  });

  it('say nothing of the change, and go nowhere but in their header', async () => {
    answer = offline;
    await api(z.undefined(), '/cases/demo/notes', { method: 'POST', body: { text: 'Bonjour' } }).catch(() => undefined);
    const [{ key, url, init }] = sent as [(typeof sent)[0]];
    expect(url).toBe('/api/cases/demo/notes');
    expect(init.body).toBe('{"text":"Bonjour"}');
    expect(`${url} ${String(init.body)}`).not.toContain(key);
    expect([localStorage.length, sessionStorage.length, document.cookie]).toEqual([0, 0, '']);
  });
});

describe('requests', () => {
  it('carry the cookie of the session, and no token', async () => {
    await api(z.undefined(), '/cases');
    await change();
    for (const { init } of sent) {
      expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).get('authorization')).toBeNull();
    }
  });

  it('announce JSON only when they carry a body', async () => {
    await api(z.undefined(), '/cases');
    await api(z.undefined(), '/cases/demo/read', { method: 'POST' });
    await change({});
    expect(sent.map(({ init }) => [new Headers(init.headers).get('content-type'), init.body])).toEqual([
      [null, undefined],
      [null, undefined],
      ['application/json', '{}'],
    ]);
  });

  it('give the answer the shape of its contract, or fail', async () => {
    answer = () => Response.json({ id: '1', more: true });
    expect(await api(z.object({ id: z.string() }), '/cases/1')).toEqual({ id: '1' });
    answer = () => Response.json({ id: 1 });
    await expect(api(z.object({ id: z.string() }), '/cases/1')).rejects.toBeInstanceOf(z.ZodError);
    answer = () => new Response('<html>');
    await expect(api(z.object({ id: z.string() }), '/cases/1')).rejects.toBeInstanceOf(z.ZodError);
  });

  it('give the status and the code of a refusal, and never its address in the message', async () => {
    answer = () => Response.json({ code: 'SELECTION_CHANGED', count: 3 }, { status: 409 });
    const refused = await api(z.undefined(), '/cases/demo?name=x', { method: 'POST' }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 409, body: { code: 'SELECTION_CHANGED', count: 3 }, message: 'API error 409' });
    answer = () => new Response('<html>', { status: 502 });
    expect(await api(z.undefined(), '/cases').catch((error: unknown) => error)).toMatchObject({ status: 502, body: undefined });
  });

  it('send a file as it is: its name goes nowhere', async () => {
    answer = () => Response.json({ id: 'f1' });
    const file = new File(['contenu'], 'facture Jean Martin.pdf', { type: 'application/pdf' });
    expect(await upload(z.object({ id: z.string() }), '/portal/attachments', file)).toEqual({ id: 'f1' });
    const [{ url, init, method }] = sent as [(typeof sent)[0]];
    expect([method, url, init.credentials]).toEqual(['POST', '/api/portal/attachments', 'include']);
    expect(JSON.stringify([url, [...new Headers(init.headers)]])).not.toMatch(/Jean|Martin|facture/u);
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('contenu');
    await upload(z.object({ id: z.string() }), '/portal/attachments', new File(['x'], 'sans-type'));
    expect(new Headers(sent[1]!.init.headers).get('content-type')).toBe('application/octet-stream');
  });
});
