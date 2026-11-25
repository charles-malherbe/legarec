import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api } from './http';

const sent: { method: string; key: string | null }[] = [];
let answer: () => Response | Promise<Response>;
const ok = () => new Response(null, { status: 204 });

beforeEach(() => {
  sent.length = 0;
  answer = ok;
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    sent.push({ method: init.method ?? 'GET', key: new Headers(init.headers).get('idempotency-key') });
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
    let release: (() => void)[] = [];
    answer = () => new Promise<Response>((resolve) => release.push(() => resolve(ok())));
    const both = [change(), change(), change({ text: 'Autre' })];
    for (const go of release) go();
    release = [];
    await Promise.all(both);
    expect(keys()[1]).toBe(keys()[0]);
    expect(keys()[2]).not.toBe(keys()[0]);
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
