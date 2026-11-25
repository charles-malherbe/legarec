import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../platform/errors/api-error';
import { CHEAP, startApp, type TestApp } from '../../../test/app';
import { Browser, codeOf, freezeClock, givePassword, newAccount, PASSWORD, setUpTotp } from '../../../test/browser';
import { startMailWorker, type MailWorker } from '../../../test/worker';

/** Second look at the sign-in: what a patient stranger, or an unlucky holder, would meet. */
let test: TestApp;
let worker: MailWorker;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const staff = () => new Browser(test);
const signedIn = async (email: string) => {
  const browser = staff();
  await browser.login(email);
  return browser;
};
const actionsOf = async (id: string) =>
  (await rows<{ action: string }>('SELECT action FROM audit_log WHERE actor_id = $1 OR entity_id = $1 ORDER BY occurred_at, id', [id])).map(
    (row) => row.action,
  );

beforeAll(async () => {
  freezeClock();
  test = await startApp([], { sessions: true });
  worker = startMailWorker(test);
  await givePassword(test, test.s.partnerA);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  vi.useRealTimers();
  await worker.stop();
  await test.stop();
});

describe('forgotten password', () => {
  it('does the same work for an address that has no account: a task that finds nobody', async () => {
    const ask = (email: string) => staff().post('/auth/forgot-password', { email });
    const count = async () => (await rows("SELECT 1 FROM outbox WHERE name = 'reset-link'")).length;
    const { email } = await newAccount(test);
    const before = await count();
    await ask(email);
    expect(await count()).toBe(before + 1);
    await ask('personne-du-tout@exemple.test');
    expect(await count()).toBe(before + 2);
    expect((await worker.run()).filter((mail) => mail.name.endsWith('password-reset')).map((mail) => mail.to)).toEqual([email]);
    expect(await rows("SELECT 1 FROM outbox WHERE name = 'reset-link' AND failed_at IS NOT NULL")).toEqual([]);
  });
});

describe('overload', () => {
  it('is not a failure of the holder, neither at the sign-in nor in their account', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    vi.spyOn(CHEAP, 'refuseIfFull').mockImplementation(() => {
      throw new ApiError(503, 'UNAVAILABLE');
    });
    for (let i = 0; i < 6; i += 1) {
      expect(await staff().login(email)).toMatchObject({ status: 503, body: { code: 'UNAVAILABLE' } });
      expect((await browser.change('/account/password', { current: PASSWORD, next: 'Un-nouveau-mot-de-passe-9!' })).status).toBe(503);
    }
    vi.restoreAllMocks();
    expect((await staff().login(email)).status).toBe(200);
    expect((await browser.change('/account/password', { current: PASSWORD, next: 'Un-nouveau-mot-de-passe-9!' })).status).toBe(204);
    expect(await actionsOf(id)).not.toContain('SIGN_IN_REFUSED');
  });
});

describe('journal', () => {
  it('keeps what a password opened, even when it opened nothing', async () => {
    const { id, email } = await newAccount(test);
    await rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]);
    await staff().login(email);
    await new Browser(test, 'partner').login(email);
    expect(await actionsOf(id)).toEqual(['PASSWORD_ACCEPTED', 'WRONG_PORTAL']);
  });

  it('keeps what is refused once signed in', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    await browser.change('/account/password', { current: 'faux', next: 'Un-nouveau-mot-de-passe-9!' });
    await browser.post('/account/two-factor/totp');
    await browser.post('/account/two-factor/totp/verify', { code: '000000' });
    expect(await actionsOf(id)).toEqual(['SIGNED_IN', 'PASSWORD_REFUSED', 'SECOND_FACTOR_REFUSED']);
  });

  it('counts no failure for a new password that is not acceptable', async () => {
    const { email } = await newAccount(test);
    const browser = await signedIn(email);
    for (let i = 0; i < 6; i += 1) expect((await browser.change('/account/password', { current: PASSWORD, next: email })).status).toBe(422);
    expect((await browser.change('/account/password', { current: PASSWORD, next: 'Un-nouveau-mot-de-passe-9!' })).status).toBe(204);
  });
});

describe('browsers', () => {
  const told = async (id: string) =>
    (await rows("SELECT 1 FROM outbox o JOIN user_sessions s ON s.id = (o.payload ->> 'sessionId')::uuid WHERE o.name = 'new-device' AND s.user_id = $1", [id]))
      .length;

  it('signs in a browser that was forgotten, before its line is removed, and tells its holder again', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    expect(await told(id)).toBe(0);
    await rows("UPDATE user_devices SET expires_at = now() - interval '1 hour' WHERE user_id = $1", [id]);
    expect((await browser.closed().login(email)).status).toBe(200);
    expect(await told(id)).toBe(1);
    expect((await browser.closed().login(email)).status).toBe(200);
    expect(await told(id)).toBe(1);
  });

  it('tells of an unknown one after a long absence, when none is remembered any more', async () => {
    const { id, email } = await newAccount(test);
    await signedIn(email);
    await rows('DELETE FROM user_devices WHERE user_id = $1', [id]);
    await signedIn(email);
    expect(await told(id)).toBe(1);
  });
});

describe('second factor', () => {
  it('closes the sessions that were opened without it', async () => {
    const { email } = await newAccount(test);
    const [first, other] = [await signedIn(email), await signedIn(email)];
    await setUpTotp(first);
    expect((await first.session()).status).toBe(200);
    expect((await other.session()).status).toBe(401);
  });

  it('closes them too when it is set up at the sign-in', async () => {
    const { id, email } = await newAccount(test);
    const other = await signedIn(email);
    await rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]);
    const browser = staff();
    await browser.login(email);
    const { key } = (await browser.post('/auth/setup/totp')).body as { key: string };
    expect((await browser.post('/auth/setup/totp/verify', { code: codeOf(key) })).status).toBe(200);
    expect((await browser.session()).status).toBe(200);
    expect((await other.session()).status).toBe(401);
  });

  it('is written again under the new key as its holder signs in, so that the old one may be withdrawn', async () => {
    const { id, email } = await newAccount(test);
    const { key } = await setUpTotp(await signedIn(email));
    const cipher = async () =>
      (await rows<{ secret_cipher: Buffer }>('SELECT secret_cipher FROM second_factors WHERE user_id = $1', [id]))[0]!.secret_cipher.toString('hex');
    const before = await cipher();
    const { SESSION_SIGNING_KEY, VAULT_MASTER_KEY } = test.config;
    const renewed = { SESSION_SIGNING_KEY, VAULT_MASTER_KEY: randomBytes(32).toString('base64') };
    const during = await startApp([], { sessions: true, next: test, env: { ...renewed, VAULT_MASTER_KEY_PREVIOUS: VAULT_MASTER_KEY } });
    const after = await startApp([], { sessions: true, next: test, env: renewed });
    try {
      const enter = async (app: TestApp, steps: number) => {
        const browser = new Browser(app);
        await browser.login(email);
        return (await browser.post('/auth/two-factor', { method: 'TOTP', code: codeOf(key, steps) })).status;
      };
      expect(await enter(during, 0)).toBe(200);
      expect(await cipher()).not.toBe(before);
      expect(await enter(after, 1)).toBe(200);
    } finally {
      await during.stop();
      await after.stop();
    }
  });
});

describe('passwords', () => {
  it.each(['            ', `${' '.repeat(11)}x`, `x${' '.repeat(40)}`])('made of spaces are too short: %j', async (password) => {
    const browser = staff();
    expect(await browser.post(`/auth/reset/${'x'.repeat(43)}`, { password })).toMatchObject({ status: 422, body: { fields: ['password'] } });
  });
});
