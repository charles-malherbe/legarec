import { loginResponse, setupDone, totpSetup } from '@legarec/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ORIGINS, startApp, type TestApp } from '../../../test/app';
import { Authenticator } from '../../../test/authenticator';
import { Browser, codeOf, emailOf, freezeClock, givePassword, newAccount, newAddress, setUpTotp } from '../../../test/browser';

let test: TestApp;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const staff = () => new Browser(test);
const signedIn = async (address: string) => {
  const browser = staff();
  await browser.login(address);
  return browser;
};
const actionsOf = async (id: string) =>
  (await rows<{ action: string }>('SELECT action FROM audit_log WHERE actor_id = $1 OR entity_id = $1 ORDER BY occurred_at, id', [id])).map(
    (row) => row.action,
  );
const TOTP = (code: string) => ({ method: 'TOTP', code });
const BACKUP = (code: string) => ({ method: 'BACKUP_CODE', code });

beforeAll(async () => {
  freezeClock();
  test = await startApp([], { sessions: true });
  await givePassword(test, test.s.developer, test.s.partnerA);
});
afterAll(async () => {
  vi.useRealTimers();
  await test.stop();
});

/** Account whose application is set up; `key` is what the telephone holds. */
const withTotp = async () => {
  const account = await newAccount(test);
  return { ...account, ...(await setUpTotp(await signedIn(account.email))) };
};
const withKey = async () => {
  const account = await newAccount(test);
  const browser = await signedIn(account.email);
  const authenticator = new Authenticator(ORIGINS.staff);
  const { challenge } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
  const answer = await browser.post('/account/two-factor/webauthn/verify', authenticator.register(challenge));
  expect(answer.status).toBe(200);
  return { ...account, authenticator, backupCodes: (answer.body as { backupCodes: string[] }).backupCodes };
};

describe('password alone', () => {
  it('opens nothing while a second factor is expected', async () => {
    const { email } = await withTotp();
    const browser = staff();
    expect(await browser.login(email)).toMatchObject({ status: 200, body: { status: 'TWO_FACTOR', methods: ['TOTP'] } });
    expect(browser.set).toHaveLength(1);
    for (const path of ['/auth/session', '/account', '/notifications']) expect((await browser.get(path)).status, path).toBe(401);
    expect((await browser.post('/account/two-factor/totp')).status).toBe(401);
    expect((await browser.delete('/account/two-factor')).status).toBe(401);
    // Nor does it set up another one.
    expect((await browser.post('/auth/setup/totp')).status).toBe(401);
    expect((await browser.post('/auth/setup/totp/verify', { code: '123456' })).status).toBe(401);
  });

  it('waits for ten minutes', async () => {
    const { id, email, key } = await withTotp();
    const browser = staff();
    await browser.login(email);
    const [row] = await rows<{ minutes: number }>(
      'SELECT round(extract(epoch FROM expires_at - created_at) / 60)::int AS minutes FROM user_sessions WHERE user_id = $1 AND second_factor_needed',
      [id],
    );
    expect(row).toEqual({ minutes: 10 });
    await rows("UPDATE user_sessions SET expires_at = now() - interval '1 hour' WHERE user_id = $1", [id]);
    expect(await browser.post('/auth/two-factor', TOTP(codeOf(key)))).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } });
  });
});

describe('limits by network', () => {
  it('stop the codes after thirty in ten minutes, on both portals and at every step', async () => {
    const ip = newAddress();
    const tries = [
      () => new Browser(test, 'staff', { ip }).post('/auth/two-factor', TOTP('000000')),
      () => new Browser(test, 'partner', { ip }).post('/auth/two-factor', BACKUP('0000-0000')),
      () => new Browser(test, 'staff', { ip }).post('/auth/setup/totp/verify', { code: '000000' }),
    ];
    const answers = await Promise.all(Array.from({ length: 33 }, (_, i) => tries[i % 3]!()));
    expect(answers.filter((answer) => answer.status === 401)).toHaveLength(30);
    expect(answers.filter((answer) => answer.status === 429 && (answer.body as { code: string }).code === 'TOO_MANY')).toHaveLength(3);
    // Before anything is checked or counted: the right code waits too, and is good from elsewhere.
    const { email, key } = await withTotp();
    const browser = new Browser(test, 'staff', { ip });
    await browser.login(email);
    for (let i = 0; i < 6; i += 1) expect((await browser.post('/auth/two-factor', TOTP(codeOf(key)))).status).toBe(429);
    expect(
      (
        await staff()
          .put('staff', browser.token!)
          .post('/auth/two-factor', TOTP(codeOf(key)))
      ).status,
    ).toBe(200);
  });

  it('stop the beginnings of a second factor after sixty', async () => {
    const ip = newAddress();
    const answers = await Promise.all(
      Array.from({ length: 62 }, (_, i) =>
        new Browser(test, i % 4 < 2 ? 'staff' : 'partner', { ip }).post(i % 2 ? '/auth/setup/totp' : '/auth/two-factor/webauthn'),
      ),
    );
    expect(answers.filter((answer) => answer.status === 401)).toHaveLength(60);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(2);
  });
});

describe('application', () => {
  it('is not given twice: a session already open has none to give, nor to set up', async () => {
    const { email, key } = await withTotp();
    const browser = await signedIn(email);
    expect((await browser.post('/auth/two-factor', TOTP(codeOf(key)))).status).toBe(200);
    const { token } = browser;
    for (const answer of [
      await browser.post('/auth/two-factor', TOTP(codeOf(key, 1))),
      await browser.post('/auth/two-factor/webauthn'),
      await browser.post('/auth/setup/totp'),
      await browser.post('/auth/setup/totp/verify', { code: codeOf(key, 1) }),
    ])
      expect(answer.status).toBe(401);
    expect(browser.token).toBe(token);
    expect((await browser.session()).status).toBe(200);
    // Nothing was counted against the account: the next sign-in has its five attempts.
    expect(await (await signedIn(email)).post('/auth/two-factor', TOTP('000000'))).toMatchObject({ body: { attemptsLeft: 4 } });
  });

  it('never accepts again the code that set it up', async () => {
    const { email } = await newAccount(test);
    const browser = await signedIn(email);
    const { key } = (await browser.post('/account/two-factor/totp')).body as { key: string };
    expect((await browser.post('/account/two-factor/totp/verify', { code: codeOf(key) })).status).toBe(200);
    const again = await signedIn(email);
    expect((await again.post('/auth/two-factor', TOTP(codeOf(key)))).status).toBe(401);
    expect((await again.post('/auth/two-factor', TOTP(codeOf(key, 1)))).status).toBe(200);
  });

  it('is the last one asked for, when it is set up twice', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const [first, second] = [(await browser.post('/account/two-factor/totp')).body, (await browser.post('/account/two-factor/totp')).body] as [
      { key: string },
      { key: string },
    ];
    expect((await browser.post('/account/two-factor/totp/verify', { code: codeOf(first.key) })).status).toBe(422);
    expect((await browser.post('/account/two-factor/totp/verify', { code: codeOf(second.key) })).status).toBe(200);
    expect(await rows('SELECT 1 FROM second_factors WHERE user_id = $1', [id])).toHaveLength(1);
  });

  it('opens with the right code at the fifth attempt', async () => {
    const { email, key } = await withTotp();
    const browser = await signedIn(email);
    for (const left of [4, 3, 2, 1]) expect((await browser.post('/auth/two-factor', TOTP('000000'))).body).toMatchObject({ attemptsLeft: left });
    expect((await browser.post('/auth/two-factor', TOTP(codeOf(key)))).status).toBe(200);
    expect((await browser.session()).status).toBe(200);
  });

  it('forgets the wrong codes once the right one is given', async () => {
    const { email, key } = await withTotp();
    const wrong = async () => ((await (await signedIn(email)).post('/auth/two-factor', TOTP('000000'))).body as { attemptsLeft: number }).attemptsLeft;
    expect([await wrong(), await wrong(), await wrong()]).toEqual([4, 3, 2]);
    expect((await (await signedIn(email)).post('/auth/two-factor', TOTP(codeOf(key)))).status).toBe(200);
    expect(await wrong()).toBe(4);
    // The password alone forgets nothing.
    await signedIn(email);
    expect(await wrong()).toBe(3);
  });

  it('is refused empty, too short, too long or made of anything else', async () => {
    const { email } = await withTotp();
    const browser = await signedIn(email);
    for (const code of ['', ' ', 'x'.repeat(21)]) expect((await browser.post('/auth/two-factor', TOTP(code))).status, code).toBe(422);
    expect(await browser.post('/auth/two-factor', { method: 'SMS', code: '123456' })).toMatchObject({ status: 422, body: { code: 'INVALID' } });
    // None of them was counted.
    for (const [code, left] of [
      ['12345', 4],
      ['1234567', 3],
      ['+33 12', 2],
      ['١٢٣٤٥٦', 1],
    ] as const)
      expect(await browser.post('/auth/two-factor', TOTP(code)), code).toMatchObject({ status: 401, body: { attemptsLeft: left } });
  });

  it('opens the session with its code, under another cookie', async () => {
    const { id, email, key } = await withTotp();
    const browser = staff();
    await browser.login(email, undefined, true);
    const pending = browser.token!;
    const answer = await browser.post('/auth/two-factor', TOTP(codeOf(key)));
    expect(loginResponse.parse(answer.body)).toMatchObject({ status: 'OK', session: { userId: id, twoFactorEnabled: true } });
    expect(browser.token).not.toBe(pending);
    expect(browser.set.find((line) => line.startsWith('__Host-staff='))).toContain('; Max-Age=2592000');
    expect((await browser.session()).status).toBe(200);
    expect((await staff().put('staff', pending).session()).status).toBe(401);
    expect(
      (
        await staff()
          .put('staff', pending)
          .post('/auth/two-factor', TOTP(codeOf(key, 1)))
      ).status,
    ).toBe(401);
    expect(await actionsOf(id)).toEqual(['SIGNED_IN', 'SECOND_FACTOR_ENABLED', 'PASSWORD_ACCEPTED', 'SIGNED_IN']);
  });

  it('accepts the code with its space, of the step before or after, and none further', async () => {
    const { email, key } = await withTotp();
    const enter = async (steps: number) => {
      const browser = staff();
      await browser.login(email);
      return (await browser.post('/auth/two-factor', TOTP(codeOf(key, steps).replace(/(...)/u, '$1 ')))).status;
    };
    for (const steps of [3, 2, -2, -3]) expect(await enter(steps), String(steps)).toBe(401);
    expect(await enter(0)).toBe(200);
    expect(await enter(1)).toBe(200);
    // A step already passed never comes back.
    expect(await enter(0)).toBe(401);
  });

  it('never accepts the same code twice, not even at the same time', async () => {
    const { email, key } = await withTotp();
    const browsers = await Promise.all(Array.from({ length: 4 }, () => signedIn(email)));
    const code = codeOf(key);
    const answers = await Promise.all(browsers.map((browser) => browser.post('/auth/two-factor', TOTP(code))));
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(1);
    expect(answers.filter((answer) => answer.status === 401)).toHaveLength(3);
  });

  it('closes after five wrong codes, even with the right one, whatever the number of sign-ins', async () => {
    const { id, email, key } = await withTotp();
    for (const left of [4, 3, 2]) {
      const browser = await signedIn(email);
      expect(await browser.post('/auth/two-factor', TOTP('000000'))).toMatchObject({ status: 401, body: { code: 'INVALID_CODE', attemptsLeft: left } });
    }
    const browser = await signedIn(email);
    expect((await browser.post('/auth/two-factor', TOTP('000000'))).body).toEqual({ code: 'INVALID_CODE', attemptsLeft: 1 });
    expect(await browser.post('/auth/two-factor', TOTP('000000'))).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
    // The session of the password is closed too.
    expect(browser.token).toBeUndefined();
    const again = await signedIn(email);
    expect((await again.post('/auth/two-factor', TOTP(codeOf(key)))).status).toBe(423);
    expect((await actionsOf(id)).filter((action) => action !== 'PASSWORD_ACCEPTED').slice(-5)).toEqual([
      ...Array<string>(4).fill('SECOND_FACTOR_REFUSED'),
      'ACCOUNT_LOCKED',
    ]);
    await rows("UPDATE lockouts SET locked_until = now() - interval '1 hour' WHERE locked_until IS NOT NULL");
    const later = await signedIn(email);
    expect((await later.post('/auth/two-factor', TOTP(codeOf(key)))).status).toBe(200);
  });

  it('keeps its secret encrypted, bound to its line', async () => {
    const { id, key } = await withTotp();
    const [factor] = await rows<{ id: string; secret_cipher: Buffer }>('SELECT id, secret_cipher FROM second_factors WHERE user_id = $1', [id]);
    const secret = key.replace(/ /gu, '');
    expect(factor!.secret_cipher.toString('latin1')).not.toContain(secret);
    expect(JSON.stringify(await rows('SELECT * FROM audit_log')) + test.logs.join('')).not.toContain(secret);
    // Put on another line, it is unreadable: the code is refused.
    const other = await withTotp();
    await rows('UPDATE second_factors SET secret_cipher = $2 WHERE user_id = $1', [other.id, factor!.secret_cipher]);
    const browser = await signedIn(other.email);
    expect((await browser.post('/auth/two-factor', TOTP(codeOf(key)))).status).toBe(500);
    await rows('DELETE FROM second_factors WHERE user_id = $1', [other.id]);
  });
});

describe('backup codes', () => {
  it('are drawn again with the next second factor, once none is left, and only then', async () => {
    const { id, email, backupCodes: first } = await withTotp();
    const browser = await signedIn(email);
    expect((await browser.post('/auth/two-factor', BACKUP(first[0]!))).status).toBe(200);
    await rows(
      'UPDATE backup_codes SET used_at = now() WHERE user_id = $1 AND id <> (SELECT id FROM backup_codes WHERE user_id = $1 AND used_at IS NULL LIMIT 1)',
      [id],
    );
    expect((await setUpTotp(browser)).backupCodes).toEqual([]);
    await rows('UPDATE backup_codes SET used_at = now() WHERE user_id = $1', [id]);
    const { backupCodes: second } = await setUpTotp(browser);
    expect(second).toHaveLength(8);
    expect(await rows('SELECT 1 FROM backup_codes WHERE user_id = $1', [id])).toHaveLength(8);
    for (const [code, status] of [
      [first[1]!, 401],
      [second[0]!, 200],
    ] as const)
      expect((await (await signedIn(email)).post('/auth/two-factor', BACKUP(code))).status, code).toBe(status);
  });

  it('are eight, shown once, and open once each', async () => {
    const { id, email, backupCodes } = await withTotp();
    expect(backupCodes).toHaveLength(8);
    expect(new Set(backupCodes).size).toBe(8);
    for (const code of backupCodes) expect(code).toMatch(/^\d{4}-\d{4}$/u);
    const enter = async (code: string) => {
      const browser = await signedIn(email);
      return (await browser.post('/auth/two-factor', BACKUP(code))).status;
    };
    expect(await enter(backupCodes[3]!)).toBe(200);
    expect(await enter(backupCodes[3]!)).toBe(401);
    expect(await enter(backupCodes[5]!.replace('-', ' '))).toBe(200);
    expect(await enter('1234')).toBe(401);
    const stored = JSON.stringify(await rows('SELECT * FROM backup_codes'));
    for (const code of backupCodes) expect(stored).not.toContain(code.replace('-', ''));
    expect((await actionsOf(id)).filter((action) => action === 'BACKUP_CODE_USED')).toHaveLength(2);
    expect(await rows('SELECT 1 FROM backup_codes WHERE user_id = $1 AND used_at IS NULL', [id])).toHaveLength(6);
  });

  it('open a single session when the same one is used twice at the same time', async () => {
    const { email, backupCodes } = await withTotp();
    const browsers = await Promise.all(Array.from({ length: 3 }, () => signedIn(email)));
    const answers = await Promise.all(browsers.map((browser) => browser.post('/auth/two-factor', BACKUP(backupCodes[0]!))));
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(1);
  });

  it('are not those of another account', async () => {
    const mine = await withTotp();
    const other = await withTotp();
    const browser = await signedIn(mine.email);
    expect((await browser.post('/auth/two-factor', BACKUP(other.backupCodes[0]!))).status).toBe(401);
    expect((await browser.post('/auth/two-factor', TOTP(codeOf(other.key)))).status).toBe(401);
  });
});

describe('security key', () => {
  const challengeOf = async (browser: Browser) => ((await browser.post('/auth/two-factor/webauthn')).body as { challenge: string }).challenge;

  it('opens the session', async () => {
    const { email, authenticator, backupCodes } = await withKey();
    expect(backupCodes).toHaveLength(8);
    const browser = staff();
    expect((await browser.login(email)).body).toEqual({ status: 'TWO_FACTOR', methods: ['WEBAUTHN'] });
    const answer = await browser.post('/auth/two-factor', { method: 'WEBAUTHN', response: authenticator.authenticate(await challengeOf(browser)) });
    expect(answer).toMatchObject({ status: 200, body: { status: 'OK' } });
    expect((await browser.session()).status).toBe(200);
  });

  it('answers the question asked to that session, once', async () => {
    const { email, authenticator } = await withKey();
    const [first, second] = [await signedIn(email), await signedIn(email)];
    const answer = authenticator.authenticate(await challengeOf(first));
    expect((await second.post('/auth/two-factor', { method: 'WEBAUTHN', response: answer })).status).toBe(401);
    expect((await first.post('/auth/two-factor', { method: 'WEBAUTHN', response: answer })).status).toBe(200);
    // Heard by someone who also knows the password.
    expect((await second.post('/auth/two-factor', { method: 'WEBAUTHN', response: answer })).status).toBe(401);
    expect((await second.post('/auth/two-factor', { method: 'WEBAUTHN', response: authenticator.authenticate('inventé') })).status).toBe(401);
  });

  it('is refused from another site, after its time, with another key, or with a counter that goes back', async () => {
    const { id, email, authenticator } = await withKey();
    const browser = await signedIn(email);
    const enter = async (response: unknown) => (await browser.post('/auth/two-factor', { method: 'WEBAUTHN', response })).status;
    const elsewhere = new Authenticator('https://espace-legarec.example');
    Object.assign(elsewhere, { id: authenticator.id, key: (authenticator as unknown as { key: unknown }).key });
    expect(await enter(elsewhere.authenticate(await challengeOf(browser)))).toBe(401);
    const late = await challengeOf(browser);
    await rows("UPDATE auth_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1 AND purpose = 'WEBAUTHN'", [id]);
    expect(await enter(authenticator.authenticate(late))).toBe(401);
    const impostor = new Authenticator(ORIGINS.staff);
    Object.assign(impostor, { id: authenticator.id });
    expect(await enter(impostor.authenticate(await challengeOf(browser)))).toBe(401);
    await rows('UPDATE second_factors SET sign_count = 1000 WHERE user_id = $1', [id]);
    expect(await enter(authenticator.authenticate(await challengeOf(browser)))).toBe(401);
    for (const response of [{}, { id: 12 }, { id: 'x'.repeat(40), response: null }]) expect(await enter(response)).toBeOneOf([401, 423]);
  });

  it('is that of the account, made on its own portal', async () => {
    const mine = await withKey();
    const other = await withKey();
    const browser = await signedIn(mine.email);
    const enter = async (response: unknown) => (await browser.post('/auth/two-factor', { method: 'WEBAUTHN', response })).status;
    expect(await enter(other.authenticator.authenticate(await challengeOf(browser)))).toBe(401);
    const partner = new Authenticator(ORIGINS.partner);
    Object.assign(partner, { id: mine.authenticator.id, key: (mine.authenticator as unknown as { key: unknown }).key });
    expect(await enter(partner.authenticate(await challengeOf(browser)))).toBe(401);
    expect(await enter(mine.authenticator.authenticate(await challengeOf(browser)))).toBe(200);
  });

  it('keeps count of its uses, so that a copy of it is noticed', async () => {
    const { id, email, authenticator } = await withKey();
    const count = async () => Number((await rows<{ sign_count: string }>('SELECT sign_count FROM second_factors WHERE user_id = $1', [id]))[0]!.sign_count);
    const registered = await count();
    const browser = await signedIn(email);
    expect((await browser.post('/auth/two-factor', { method: 'WEBAUTHN', response: authenticator.authenticate(await challengeOf(browser)) })).status).toBe(200);
    expect(await count()).toBe(registered + 1);
    expect(authenticator.counter).toBe(await count());
    // The copy is one use behind.
    authenticator.counter -= 1;
    const again = await signedIn(email);
    expect((await again.post('/auth/two-factor', { method: 'WEBAUTHN', response: authenticator.authenticate(await challengeOf(again)) })).status).toBe(401);
  });

  it('is asked a question that lives for five minutes, and is closed with five wrong answers', async () => {
    const { id, email, authenticator } = await withKey();
    const browser = await signedIn(email);
    await challengeOf(browser);
    const [row] = await rows<{ seconds: number; same: boolean }>(
      `SELECT round(extract(epoch FROM t.expires_at - t.created_at))::int AS seconds, t.session_id = s.id AS same
       FROM auth_tokens t JOIN user_sessions s ON s.user_id = t.user_id AND s.second_factor_needed WHERE t.user_id = $1 AND t.purpose = 'WEBAUTHN' AND t.used_at IS NULL`,
      [id],
    );
    // The clock of the tests stands still, next to that of the database.
    expect(row!.seconds).toBeGreaterThan(150);
    expect(row!.seconds).toBeLessThan(330);
    expect(row!.same).toBe(true);
    for (const left of [4, 3, 2, 1])
      expect(await browser.post('/auth/two-factor', { method: 'WEBAUTHN', response: authenticator.authenticate('inventé') })).toMatchObject({
        status: 401,
        body: { attemptsLeft: left },
      });
    expect((await browser.post('/auth/two-factor', { method: 'WEBAUTHN', response: {} })).status).toBe(423);
    expect(browser.token).toBeUndefined();
  });

  it('is registered in answer to the question of that session, once, in time, and on that site', async () => {
    const { id, email } = await newAccount(test);
    const [first, second] = [await signedIn(email), await signedIn(email)];
    const question = async (browser: Browser) => ((await browser.post('/account/two-factor/webauthn')).body as { challenge: string }).challenge;
    const send = async (browser: Browser, answer: unknown) => (await browser.post('/account/two-factor/webauthn/verify', answer)).status;
    const authenticator = new Authenticator(ORIGINS.staff);
    expect(await send(second, authenticator.register(await question(first)))).toBe(422);
    const late = await question(first);
    await rows("UPDATE auth_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1", [id]);
    expect(await send(first, authenticator.register(late))).toBe(422);
    expect(await send(first, new Authenticator('https://espace-legarec.example').register(await question(first)))).toBe(422);
    const { email: stranger } = await newAccount(test);
    expect(await send(await signedIn(stranger), authenticator.register(await question(first)))).toBe(422);
    const asked = await question(first);
    expect(await send(first, authenticator.register(asked))).toBe(200);
    expect(await send(first, new Authenticator(ORIGINS.staff).register(asked))).toBe(422);
    expect(await rows("SELECT 1 FROM second_factors WHERE kind = 'WEBAUTHN' AND user_id = $1", [id])).toHaveLength(1);
  });

  it('is not registered twice, nor for another account', async () => {
    const { authenticator } = await withKey();
    const browser = await signedIn((await newAccount(test)).email);
    const { challenge } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
    expect((await browser.post('/account/two-factor/webauthn/verify', authenticator.register(challenge))).status).toBe(409);
  });
});

describe('required, and not set up yet', () => {
  it('stops the Developer until it is set up', async () => {
    const id = test.s.developer;
    const email = await emailOf(test, id);
    const browser = staff();
    expect(await browser.login(email)).toMatchObject({ status: 200, body: { status: 'SETUP_REQUIRED' } });
    for (const path of ['/auth/session', '/members', '/account']) expect((await browser.get(path)).status, path).toBe(401);
    expect((await browser.post('/auth/two-factor', TOTP('000000'))).status).toBe(401);
    expect((await browser.post('/auth/two-factor/webauthn')).status).toBe(401);
    const { key, uri } = totpSetup.parse((await browser.post('/auth/setup/totp')).body);
    expect(decodeURIComponent(uri)).toContain(`Legarec:${email}`);
    expect(uri).toContain('issuer=Legarec');
    expect(await browser.post('/auth/setup/totp/verify', { code: '000000' })).toMatchObject({ status: 401, body: { code: 'INVALID_CODE', attemptsLeft: 4 } });
    const pending = browser.token!;
    const done = setupDone.parse((await browser.post('/auth/setup/totp/verify', { code: codeOf(key) })).body);
    expect(done.backupCodes).toHaveLength(8);
    expect(done.session).toMatchObject({ userId: id, role: 'DEVELOPER', twoFactorEnabled: true });
    expect((await browser.session()).status).toBe(200);
    expect((await staff().put('staff', pending).session()).status).toBe(401);
    expect(await actionsOf(id)).toEqual(['PASSWORD_ACCEPTED', 'SECOND_FACTOR_REFUSED', 'SECOND_FACTOR_ENABLED', 'SIGNED_IN']);
    expect(
      await rows(
        "SELECT 1 FROM outbox WHERE name = 'second-factor-enabled' AND payload ->> 'factorId' IN (SELECT id::text FROM second_factors WHERE user_id = $1)",
        [id],
      ),
    ).toHaveLength(1);
    expect((await staff().login(email)).body).toEqual({ status: 'TWO_FACTOR', methods: ['TOTP'] });
    // Once set up, it is not set up again by whoever knows the password.
    const other = await signedIn(email);
    expect((await other.post('/auth/setup/totp')).status).toBe(401);
  });

  it('closes after five wrong codes, whatever the number of sign-ins, and sets up nothing', async () => {
    const { id, email } = await newAccount(test);
    await rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]);
    const starting = async () => {
      const browser = await signedIn(email);
      return { browser, key: ((await browser.post('/auth/setup/totp')).body as { key: string }).key };
    };
    for (const left of [4, 3])
      expect(await (await starting()).browser.post('/auth/setup/totp/verify', { code: '000000' })).toMatchObject({
        status: 401,
        body: { code: 'INVALID_CODE', attemptsLeft: left },
      });
    const { browser } = await starting();
    for (const left of [2, 1])
      expect((await browser.post('/auth/setup/totp/verify', { code: '000000' })).body).toEqual({ code: 'INVALID_CODE', attemptsLeft: left });
    expect(await browser.post('/auth/setup/totp/verify', { code: '000000' })).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
    expect(browser.token).toBeUndefined();
    const again = await starting();
    expect((await again.browser.post('/auth/setup/totp/verify', { code: codeOf(again.key) })).status).toBe(423);
    expect(again.browser.token).toBeUndefined();
    expect(await rows('SELECT 1 FROM second_factors WHERE user_id = $1 AND confirmed_at IS NOT NULL', [id])).toEqual([]);
    expect((await actionsOf(id)).filter((action) => action !== 'PASSWORD_ACCEPTED')).toEqual([
      ...Array<string>(4).fill('SECOND_FACTOR_REFUSED'),
      'ACCOUNT_LOCKED',
    ]);
    await rows("UPDATE lockouts SET locked_until = now() - interval '1 hour' WHERE locked_until IS NOT NULL");
    const later = await starting();
    expect((await later.browser.post('/auth/setup/totp/verify', { code: '000000' })).body).toMatchObject({ attemptsLeft: 4 });
    expect((await later.browser.post('/auth/setup/totp/verify', { code: codeOf(later.key) })).status).toBe(200);
    // Forgotten with the right code.
    expect(await (await signedIn(email)).post('/auth/two-factor', TOTP('000000'))).toMatchObject({ body: { attemptsLeft: 4 } });
  });

  it('opens the session for half a day, with the cookie that was asked for', async () => {
    const { id, email } = await newAccount(test);
    await rows('UPDATE users SET two_factor_required = true, last_seen_at = NULL WHERE id = $1', [id]);
    const browser = staff();
    await browser.login(email, undefined, true);
    const seen = async () => (await rows<{ last_seen_at: Date | null }>('SELECT last_seen_at FROM users WHERE id = $1', [id]))[0]!.last_seen_at;
    expect(await seen()).toBeNull();
    const { key } = (await browser.post('/auth/setup/totp')).body as { key: string };
    expect((await browser.post('/auth/setup/totp/verify', { code: codeOf(key) })).status).toBe(200);
    expect(browser.set.find((line) => line.startsWith('__Host-staff='))).toContain('; Max-Age=2592000');
    expect(await seen()).not.toBeNull();
    const [session] = await rows<{ hours: number; given: boolean }>(
      'SELECT round(extract(epoch FROM expires_at - second_factor_at) / 3600)::int AS hours, proved_at = second_factor_at AND last_seen_at = second_factor_at AS given FROM user_sessions WHERE user_id = $1',
      [id],
    );
    expect(session).toEqual({ hours: 12, given: true });
  });

  it('applies to the next sign-in of an account, not to the session under way', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    await rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]);
    expect((await browser.session()).status).toBe(200);
    expect((await staff().login(email)).body).toEqual({ status: 'SETUP_REQUIRED' });
    expect((await browser.delete('/account/two-factor')).status).toBe(403);
  });

  it('is the same for a creditor', async () => {
    const id = test.s.partnerA;
    await rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]);
    const browser = new Browser(test, 'partner');
    expect((await browser.login(await emailOf(test, id))).body).toEqual({ status: 'SETUP_REQUIRED' });
    expect((await browser.session()).status).toBe(401);
    const { key } = (await browser.post('/auth/setup/totp')).body as { key: string };
    expect(await browser.post('/auth/setup/totp/verify', { code: codeOf(key) })).toMatchObject({ status: 200, body: { session: null } });
    expect((await browser.session()).status).toBe(200);
    // The kit has no such message for a creditor.
    expect(
      await rows(
        "SELECT 1 FROM outbox WHERE name = 'second-factor-enabled' AND payload ->> 'factorId' IN (SELECT id::text FROM second_factors WHERE user_id = $1)",
        [id],
      ),
    ).toEqual([]);
  });

  it('cannot be set up with the cookie of the other portal', async () => {
    const { id, email } = await newAccount(test);
    await rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]);
    const browser = await signedIn(email);
    expect((await new Browser(test, 'partner').put('partner', browser.token!).post('/auth/setup/totp')).status).toBe(401);
  });
});
