import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHEAP, startApp, type TestApp } from '../../../test/app';
import { Browser, codeOf, emailOf, freezeClock, givePassword, newAccount, PASSWORD, setUpTotp } from '../../../test/browser';
import { newToken } from '../../platform/crypto/keyring';
import { AuthKeys } from './keys';
import { SecondFactors } from './second-factors';

/** What happens to an account while it is being proved. */
let test: TestApp;
let keys: AuthKeys;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const staff = () => new Browser(test);
const NEXT = 'Un-nouveau-mot-de-passe-9!';
const REFUSED = { status: 401, body: { code: 'INVALID_CREDENTIALS' } };
const live = (id: string) => rows('SELECT 1 FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL', [id]);
const resetLink = async (id: string) => {
  const token = newToken();
  await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', $1, $2, now() + interval '1 hour')", [
    id,
    keys.linkHash(token),
  ]);
  return token;
};
/** Between the moment the password is checked and the moment the session opens. */
const meanwhile = (work: () => Promise<unknown>) => {
  const verify = CHEAP.verify.bind(CHEAP);
  vi.spyOn(CHEAP, 'verify').mockImplementationOnce(async (hash, password) => {
    const same = await verify(hash, password);
    await work();
    return same;
  });
};

beforeAll(async () => {
  freezeClock();
  test = await startApp([], { sessions: true });
  keys = new AuthKeys(test.config);
  await givePassword(test, test.s.director, test.s.officerB);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  vi.useRealTimers();
  await test.stop();
});

describe('a sign-in under way', () => {
  it.each<[string, (id: string) => Promise<unknown>]>([
    ['reset by its link', async (id) => expect((await staff().post(`/auth/reset/${await resetLink(id)}`, { password: NEXT })).status).toBe(204)],
    ['changed', (id) => rows("UPDATE users SET password_hash = 'other' WHERE id = $1", [id])],
    ['removed', (id) => rows('UPDATE users SET password_hash = NULL WHERE id = $1', [id])],
    ['of an account disabled', (id) => rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id])],
    ['of an account put under another role', (id) => rows("UPDATE users SET role = 'CREDITOR', creditor_id = $2 WHERE id = $1", [id, test.s.creditorA])],
  ])('opens nothing with a password %s meanwhile', async (_name, change) => {
    const { id, email } = await newAccount(test);
    meanwhile(() => change(id));
    const browser = staff();
    expect(await browser.login(email)).toMatchObject(REFUSED);
    expect(browser.token).toBeUndefined();
    expect(await live(id)).toEqual([]);
  });

  it('asks for the second factor that was set up or required meanwhile', async () => {
    const { id, email } = await newAccount(test);
    meanwhile(() => rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]));
    expect((await staff().login(email)).body).toEqual({ status: 'SETUP_REQUIRED' });
  });

  it('never answers an incident, and leaves nothing open, when the account is reset at the same time', async () => {
    const { id, email } = await newAccount(test);
    let password = PASSWORD;
    for (let i = 0; i < 12; i += 1) {
      const token = await resetLink(id);
      const next = `${NEXT}${i}`;
      const [reset, ...logins] = await Promise.all([
        staff().post(`/auth/reset/${token}`, { password: next }),
        ...Array.from({ length: 3 }, () => staff().login(email, password)),
      ]);
      expect(reset.status).toBe(204);
      for (const { status } of logins) expect(status).toBeOneOf([200, 401]);
      // Whatever was opened with the former password is closed.
      expect(await live(id), `turn ${i}`).toEqual([]);
      password = next;
      await rows('DELETE FROM lockouts');
    }
  });
});

describe('a second factor under way', () => {
  it('opens nothing once its session has been closed', async () => {
    const { id, email } = await newAccount(test);
    const first = staff();
    await first.login(email);
    const { key } = await setUpTotp(first);
    const browser = staff();
    await browser.login(email);
    // While the code is being checked, not before.
    const accepts = SecondFactors.prototype.accepts;
    vi.spyOn(SecondFactors.prototype, 'accepts').mockImplementationOnce(async function (this: SecondFactors, ...args) {
      await rows('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND second_factor_needed', [id]);
      return accepts.apply(this, args);
    });
    expect(await browser.post('/auth/two-factor', { method: 'TOTP', code: codeOf(key) })).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } });
    expect((await browser.session()).status).toBe(401);
    // Nothing of it stays: the same code is still good.
    const again = staff();
    await again.login(email);
    expect((await again.post('/auth/two-factor', { method: 'TOTP', code: codeOf(key) })).status).toBe(200);
  });
});

describe('a password changed in two places', () => {
  it('is changed once, by one of those who knew it', async () => {
    const { email } = await newAccount(test);
    const browsers = [staff(), staff(), staff()];
    for (const browser of browsers) await browser.login(email);
    const answers = await Promise.all(browsers.map((browser, i) => browser.change('/account/password', { current: PASSWORD, next: `${NEXT}${i}` })));
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 422, 422]);
    const won = answers.findIndex((answer) => answer.status === 204);
    expect((await staff().login(email, `${NEXT}${won}`)).status).toBe(200);
  });
});

describe('sessions in use', () => {
  it('never answer an incident while their account is disabled, opened again, or reset', async () => {
    const { id, email } = await newAccount(test);
    const director = staff();
    await director.login(await emailOf(test, test.s.director));
    const browsers = [staff(), staff(), staff()];
    for (let i = 0; i < 8; i += 1) {
      for (const browser of browsers) await browser.login(email, PASSWORD);
      // Long enough ago for each request to write.
      await rows("UPDATE user_sessions SET last_seen_at = now() - interval '2 minutes' WHERE user_id = $1", [id]);
      const answers = await Promise.all([
        ...browsers.map((browser) => browser.session()),
        director.post(`/members/${id}/disable`, { reason: 'Essai', cases: 0 }),
        ...browsers.map((browser) => browser.session()),
      ]);
      for (const { status } of answers) expect(status).toBeOneOf([200, 204, 401]);
      for (const browser of browsers) expect((await browser.session()).status).toBe(401);
      expect((await director.post(`/members/${id}/enable`)).status).toBe(204);
    }
  });
});
