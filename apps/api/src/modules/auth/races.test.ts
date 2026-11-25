import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHEAP, ORIGINS, startApp, type TestApp } from '../../../test/app';
import { Authenticator } from '../../../test/authenticator';
import { Browser, codeOf, emailOf, freezeClock, givePassword, newAccount, PASSWORD, setUpTotp } from '../../../test/browser';
import { newToken } from '../../platform/crypto/keyring';
import { Database } from '../../platform/database/database';
import { Accounts } from './accounts';
import { AuthKeys } from './keys';
import { drawLink } from './link-tokens';
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
    // The sessions of the others are closed by the first one.
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 401, 401]);
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

/** Once the guard of the route has let the request in, and before its account is taken. */
const beforeTaking = (work: () => Promise<unknown>) => {
  const takeAttempt = Accounts.prototype.takeAttempt;
  vi.spyOn(Accounts.prototype, 'takeAttempt').mockImplementationOnce(async function (this: Accounts, ...args) {
    await work();
    return takeAttempt.apply(this, args);
  });
};
const REFUSED_SESSION = { status: 401, body: { code: 'UNAUTHORIZED' } };
const director = async () => {
  const browser = staff();
  await browser.login(await emailOf(test, test.s.director));
  return browser;
};
const factorsOf = (id: string) => rows('SELECT kind FROM second_factors WHERE user_id = $1 AND confirmed_at IS NOT NULL', [id]);

describe('a session closed while it asks for something about its own account', () => {
  it('does not change the password, nor closes the session of the holder', async () => {
    const { email } = await newAccount(test);
    const [holder, thief] = [staff(), staff()];
    for (const browser of [holder, thief]) await browser.login(email);
    meanwhile(async () => expect((await holder.delete('/account/sessions')).status).toBe(204));
    expect(await thief.change('/account/password', { current: PASSWORD, next: NEXT })).toMatchObject(REFUSED_SESSION);
    expect((await holder.session()).status).toBe(200);
    expect((await staff().login(email)).status).toBe(200);
  });

  it('sets up no second factor once the password has been reset', async () => {
    const { id, email } = await newAccount(test);
    const thief = staff();
    await thief.login(email);
    const { key } = (await thief.post('/account/two-factor/totp')).body as { key: string };
    const token = await resetLink(id);
    beforeTaking(async () => expect((await staff().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(204));
    expect(await thief.post('/account/two-factor/totp/verify', { code: codeOf(key) })).toMatchObject(REFUSED_SESSION);
    expect(await factorsOf(id)).toEqual([]);
    expect((await staff().login(email, NEXT)).body).toMatchObject({ status: 'OK' });
  });

  it('registers no key once the support has reset the second factor', async () => {
    const support = await director();
    const { id, email } = await newAccount(test);
    const thief = staff();
    await thief.login(email);
    await setUpTotp(thief);
    const { challenge } = (await thief.post('/account/two-factor/webauthn')).body as { challenge: string };
    beforeTaking(async () => expect((await support.post(`/members/${id}/reset-2fa`)).status).toBe(204));
    expect(await thief.post('/account/two-factor/webauthn/verify', new Authenticator(ORIGINS.staff).register(challenge))).toMatchObject(REFUSED_SESSION);
    expect(await factorsOf(id)).toEqual([]);
    // Its challenge is closed too, whichever session would bring it.
    expect(await rows('SELECT 1 FROM auth_tokens WHERE user_id = $1 AND used_at IS NULL', [id])).toEqual([]);
  });

  it('writes nothing on an account disabled meanwhile', async () => {
    const support = await director();
    const { id, email } = await newAccount(test);
    const holder = staff();
    await holder.login(email);
    const { key } = (await holder.post('/account/two-factor/totp')).body as { key: string };
    beforeTaking(async () => expect((await support.post(`/members/${id}/disable`, { reason: 'Essai', cases: 0 })).status).toBe(204));
    const tasks = async () => (await rows<{ n: number }>("SELECT count(*)::int AS n FROM outbox WHERE name = 'second-factor-enabled'"))[0]!.n;
    const before = await tasks();
    expect(await holder.post('/account/two-factor/totp/verify', { code: codeOf(key) })).toMatchObject(REFUSED_SESSION);
    expect(await factorsOf(id)).toEqual([]);
    expect(await rows('SELECT 1 FROM backup_codes WHERE user_id = $1', [id])).toEqual([]);
    expect(await tasks()).toBe(before);
  });

  it.each<[string, (browser: Browser) => Promise<{ status: number }>]>([
    ['starts an application', (browser) => browser.post('/account/two-factor/totp')],
    ['starts a key', (browser) => browser.post('/account/two-factor/webauthn')],
    ['removes the second factor', (browser) => browser.delete('/account/two-factor')],
    ['closes the other sessions', (browser) => browser.delete('/account/sessions')],
  ])('never %s', async (_name, ask) => {
    const { id, email } = await newAccount(test);
    const [holder, thief] = [staff(), staff()];
    await holder.login(email);
    const { key } = await setUpTotp(holder);
    await thief.login(email);
    await thief.post('/auth/two-factor', { method: 'TOTP', code: codeOf(key) });
    expect((await thief.session()).status).toBe(200);
    // Between the guard and the account.
    const own = Accounts.prototype.own;
    vi.spyOn(Accounts.prototype, 'own').mockImplementationOnce(async function (this: Accounts, ...args) {
      await rows('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND second_factor_needed', [id]);
      return own.apply(this, args) as never;
    });
    expect(await ask(thief)).toMatchObject(REFUSED_SESSION);
    expect(await factorsOf(id)).toEqual([{ kind: 'TOTP' }]);
    expect(await live(id)).toHaveLength(1);
  });
});

describe('a link drawn by the worker', () => {
  it.each(['before', 'after'])('does not stop the account from being disabled just %s its new line is written', async (when) => {
    const support = await director();
    const jobs = new Database(test.database.url('jobs'));
    try {
      const { id } = await newAccount(test);
      await resetLink(id);
      let disabled: Promise<{ status: number }> | undefined;
      const disable = async () => {
        disabled = support.post(`/members/${id}/disable`, { reason: 'Essai', cases: 0 });
        await new Promise((done) => setTimeout(done, 300));
      };
      const drawn = jobs
        .run({ kind: 'worker', job: 'email' }, async (tx) => {
          const { create } = tx.authToken;
          vi.spyOn(tx.authToken, 'create').mockImplementationOnce((async (args: never) => {
            if (when === 'before') await disable();
            const made = await create.call(tx.authToken, args);
            if (when === 'after') await disable();
            return made;
          }) as never);
          await drawLink(tx, keys, { purpose: 'RESET', userId: id, token: newToken() });
        })
        .then(
          () => 'drawn',
          (error: Error) => error.message,
        );
      // Disabled first, it gets no link; otherwise its link is closed with the rest.
      expect(await drawn).toBe(when === 'before' ? 'ACCOUNT_CHANGED' : 'drawn');
      expect((await disabled!).status).toBe(204);
      expect(await rows('SELECT 1 FROM auth_tokens WHERE user_id = $1 AND used_at IS NULL', [id])).toEqual([]);
    } finally {
      await jobs.close();
    }
  });

  it('is drawn for nobody once the account is disabled, and once only otherwise', async () => {
    const jobs = new Database(test.database.url('jobs'));
    const one = (id: string) => jobs.run({ kind: 'worker', job: 'email' }, (tx) => drawLink(tx, keys, { purpose: 'RESET', userId: id, token: newToken() }));
    try {
      const closed = await newAccount(test, { status: 'DISABLED' });
      await expect(one(closed.id)).rejects.toThrow('ACCOUNT_CHANGED');
      expect(await rows('SELECT 1 FROM auth_tokens WHERE user_id = $1', [closed.id])).toEqual([]);
      const { id } = await newAccount(test);
      await Promise.all(Array.from({ length: 5 }, () => one(id)));
      expect(await rows('SELECT 1 FROM auth_tokens WHERE user_id = $1 AND used_at IS NULL', [id])).toHaveLength(1);
    } finally {
      await jobs.close();
    }
  });
});

describe('two people who replace each other', () => {
  it('leave at the same time without an incident', async () => {
    const support = await director();
    const [a, b] = [await newAccount(test), await newAccount(test)];
    await rows('UPDATE users SET substitute_id = CASE id WHEN $1 THEN $2::uuid ELSE $1::uuid END WHERE id IN ($1, $2)', [a.id, b.id]);
    await rows('UPDATE cases SET officer_id = CASE id WHEN $1 THEN $2::uuid ELSE $3::uuid END WHERE id IN ($1, $4)', [
      test.s.cases.ofA,
      a.id,
      b.id,
      test.s.cases.ofB,
    ]);
    // Both are under way, each past its own account, before either goes on.
    await rows('BEGIN');
    await rows('SELECT 1 FROM cases WHERE id = ANY ($1::uuid[]) FOR UPDATE', [[test.s.cases.ofA, test.s.cases.ofB]]);
    const leaving = [a, b].map(({ id }) => support.post(`/members/${id}/disable`, { reason: 'Essai', cases: 1 }));
    await new Promise((done) => setTimeout(done, 500));
    await rows('COMMIT');
    expect((await Promise.all(leaving)).map((answer) => answer.status)).toEqual([204, 204]);
  });
});

describe('an account disabled once it was found', () => {
  it('is never acted on: nothing runs, and nobody is told', async () => {
    const accounts = new Accounts(test.app.get(Database));
    const { id } = await newAccount(test, { status: 'DISABLED' });
    const work = vi.fn(() => Promise.resolve('done'));
    await expect(accounts.as(id, work)).rejects.toMatchObject({ status: 401 });
    expect(await accounts.as(id, work, () => 'gone')).toBe('gone');
    expect(work).not.toHaveBeenCalled();
  });
});
