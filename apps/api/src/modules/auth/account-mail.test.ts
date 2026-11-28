import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { Browser, newAccount } from '../../../test/browser';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import type { HttpClient } from '../../emails/resend';
import { Vault } from '../vault/vault';

let test: TestApp;
let worker: MailWorker | undefined;
const KEY = 're_test_comptes_0123456789';
/** What the fake Resend was asked, and what it answers next. */
const asked: { url: string; headers: Record<string, string>; body: string }[] = [];
let answer: () => Promise<{ status: number; json(): Promise<unknown> }> = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ id: 'ref-1' }) });
const http: HttpClient = (url, init) => {
  asked.push({ url, headers: init.headers, body: init.body });
  return answer();
};
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const storeKey = async () => {
  const id = randomUUID();
  await rows("INSERT INTO vault_secrets (id, name, value_cipher) VALUES ($1, 'RESEND_API_KEY', $2)", [id, new Vault(test.config).seal(id, KEY)]);
};
const dropKey = () => rows("DELETE FROM vault_secrets WHERE name = 'RESEND_API_KEY'");
const start = async (options: { production?: boolean; real?: boolean } = {}) => {
  await worker?.stop();
  worker = startMailWorker(test, { http, ...options });
  return worker;
};
/** An active account, at an address Resend accepts for a test key when `test` says so. */
const account = async (atResend = false) => {
  const made = await newAccount(test);
  if (!atResend) return made;
  const email = `delivered+${randomUUID()}@resend.dev`;
  await rows('UPDATE users SET email = $2 WHERE id = $1', [made.id, email]);
  return { ...made, email };
};
const forgot = async (email: string) => expect((await new Browser(test).post('/auth/forgot-password', { email })).status).toBe(204);
/** The task of the reset link of that account, as the table keeps it. */
const task = async (userId: string) =>
  (
    await rows<{ id: string; started: boolean; done: boolean; failure: string | null }>(
      `SELECT id, started_at IS NOT NULL AS started, done_at IS NOT NULL AS done, failure FROM outbox
       WHERE queue = 'email' AND name = 'reset-link' AND payload ->> 'userId' = $1`,
      [userId],
    )
  )[0];
const links = async (userId: string) =>
  (await rows<{ count: number }>('SELECT count(*)::int AS count FROM auth_tokens WHERE user_id = $1', [userId]))[0]!.count;
const settle = (userId: string) => rows("UPDATE outbox SET done_at = now() WHERE queue = 'email' AND payload ->> 'userId' = $1", [userId]);

beforeAll(async () => {
  test = await startApp([], { sessions: true });
});
afterEach(async () => {
  asked.length = 0;
  answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ id: 'ref-1' }) });
  await dropKey();
});
afterAll(async () => {
  await worker?.stop();
  await test.stop();
});

describe('e-mails of the accounts', () => {
  it('are simulated without a key outside production: nothing reaches the provider', async () => {
    const worker = await start();
    const { id, email } = await account();
    await forgot(email);
    const mails = await worker.run();
    expect(mails.map(({ name, to }) => [name, to])).toEqual([['staff-password-reset', email]]);
    expect(asked).toEqual([]);
    expect(await task(id)).toMatchObject({ done: true, failure: null });
  });

  it('leave by Resend with the key of the reminders, once, under the identifier of their task', async () => {
    await storeKey();
    const worker = await start({ production: true, real: true });
    const { id, email } = await account();
    await forgot(email);
    expect(await worker.run()).toEqual([]);
    const { id: taskId } = (await task(id))!;
    expect(asked).toHaveLength(1);
    const [request] = asked;
    expect(request!.url).toBe('https://api.resend.com/emails');
    expect(request!.headers).toMatchObject({ authorization: `Bearer ${KEY}`, 'idempotency-key': `account/${taskId}` });
    const body = JSON.parse(request!.body) as { from: string; to: string[]; subject: string; html: string; reply_to?: string; tags?: unknown };
    expect(body).toMatchObject({ from: 'LEGAREC <ne-pas-repondre@mail.legarec.fr>', to: [email] });
    // No reply to an e-mail of the accounts, and no tag of a sending.
    expect(body.reply_to).toBeUndefined();
    expect(body.tags).toBeUndefined();
    const token = /\/reinitialisation\/([\w-]{43})/u.exec(body.html)![1]!;
    expect((await new Browser(test).get(`/auth/reset/${token}`)).status).toBe(200);
    expect(await task(id)).toMatchObject({ done: true, failure: null });
  });

  it('with a test key, leave only for a test address of Resend or one of the firm, whatever NODE_ENV says', async () => {
    await storeKey();
    const worker = await start({ production: true });
    const real = await account();
    const allowed = await account(true);
    await forgot(real.email);
    await forgot(allowed.email);
    await worker.run();
    expect(await task(real.id)).toMatchObject({ done: false, failure: 'DEV_RECIPIENT' });
    // Refused before a link is drawn: none was made for nothing.
    expect(await links(real.id)).toBe(0);
    expect(asked.map((request) => (JSON.parse(request.body) as { to: string[] }).to)).toEqual([[allowed.email]]);
    expect(await task(allowed.id)).toMatchObject({ done: true });
  });

  it('in production, wait for the key: nothing is simulated and no link is drawn', async () => {
    const worker = await start({ production: true, real: true });
    const { id, email } = await account();
    await forgot(email);
    await worker.run().catch(() => undefined);
    expect(asked).toEqual([]);
    expect(await task(id)).toMatchObject({ started: false, done: false, failure: null });
    expect(await links(id)).toBe(0);
    await settle(id);
  });

  it('refused by the provider, fail with our code and are never tried again', async () => {
    await storeKey();
    const worker = await start({ production: true, real: true });
    for (const [status, code] of [
      [422, 'PROVIDER_REFUSED'],
      [403, 'PROVIDER_KEY_REFUSED'],
      [500, 'UNCERTAIN'],
    ] as const) {
      answer = () => Promise.resolve({ status, json: () => Promise.resolve({ message: 'quelque chose de Resend' }) });
      const { id, email } = await account();
      await forgot(email);
      await worker.run();
      expect(await task(id), String(status)).toMatchObject({ done: false, failure: code });
    }
    // One call each: what may have left is never sent a second time.
    expect(asked).toHaveLength(3);
  });

  it('leave neither the address, nor the link, nor the key in the logs', async () => {
    await storeKey();
    const worker = await start({ production: true, real: true });
    const { email } = await account();
    const before = test.logs.length;
    await forgot(email);
    answer = () => Promise.resolve({ status: 422, json: () => Promise.resolve({ message: `invalid ${email}` }) });
    await worker.run();
    const sent = await account();
    answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ id: 'ref-2' }) });
    await forgot(sent.email);
    await worker.run();
    const token = /\/reinitialisation\/([\w-]{43})/u.exec((JSON.parse(asked.at(-1)!.body) as { html: string }).html)![1]!;
    const logs = test.logs.slice(before).join('\n');
    expect(logs).toContain('task abandoned');
    for (const secret of [email, sent.email, token, KEY, 'reinitialisation', 'quelque chose']) expect(logs).not.toContain(secret);
  });
});
