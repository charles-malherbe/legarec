import { backupCodes, linkInfo, loginResponse, totpKey, type AutomaticEmail } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { Browser, codeOf, emailOf, freezeClock, givePassword, newAccount, newAddress, PASSWORD, setUpTotp } from '../../../test/browser';
import { createTestDatabase } from '../../../test/database';
import { startMailWorker, type Mail, type MailWorker } from '../../../test/worker';
import { newToken } from '../../platform/crypto/keyring';
import { Database } from '../../platform/database/database';
import { accountCommand, USAGE } from './account-command';
import type { AccountMail } from './account-mail';
import { accountJobs } from './auth.jobs';
import { AuthKeys } from './keys';

let test: TestApp;
let worker: MailWorker;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const staff = () => new Browser(test);
const partner = () => new Browser(test, 'partner');
const NEXT = 'Un-nouveau-mot-de-passe-9';
const actionsOf = async (id: string) =>
  (await rows<{ action: string }>('SELECT action FROM audit_log WHERE actor_id = $1 OR entity_id = $1 ORDER BY occurred_at, id', [id])).map(
    (row) => row.action,
  );
/** What each e-mail of the accounts does once its checks have passed. */
const mailBy =
  (send: (name: AutomaticEmail, to: string, data: unknown) => Promise<void>): AccountMail =>
  (to) =>
    Promise.resolve((name, data) => send(name, to, data));
const tokenIn = (mail: Mail | undefined) => /\/(?:reinitialisation|activation)\/([\w-]{43})/u.exec(mail?.html ?? '')![1]!;

beforeAll(async () => {
  freezeClock();
  test = await startApp([], { sessions: true });
  worker = startMailWorker(test);
  await givePassword(test, test.s.director, test.s.manager, test.s.partnerA);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  vi.useRealTimers();
  await worker.stop();
  await test.stop();
});

/** What was sent, but the notices of a new browser: the tests have many. */
const sent = async () => (await worker.run()).filter((mail) => mail.name !== 'staff-new-device' && mail.name !== 'staff-2fa-enabled');
const ask = (email: string, browser = staff()) => browser.post('/auth/forgot-password', { email });
/** Link of reset of that account, as received. */
const resetLink = async (email: string, browser = staff()) => {
  expect((await ask(email, browser)).status).toBe(204);
  return tokenIn((await sent()).find((mail) => mail.to === email));
};

describe('forgotten password', () => {
  it('answers the same thing whoever asks', async () => {
    const known = await newAccount(test);
    const invited = await newAccount(test, { status: 'INVITED' });
    const disabled = await newAccount(test, { status: 'DISABLED' });
    const answers = [await ask(known.email), await ask(invited.email), await ask(disabled.email), await ask('personne@exemple.test')];
    for (const { status, body, headers } of answers) {
      expect({ status, body }).toEqual({ status: 204, body: undefined });
      expect([...headers.keys()].sort()).toEqual([...answers[0]!.headers.keys()].sort());
    }
    expect((await sent()).map((mail) => mail.to)).toEqual([known.email]);
    expect(await actionsOf(known.id)).toEqual(['PASSWORD_RESET_ASKED']);
    expect(JSON.stringify(await rows('SELECT * FROM audit_log'))).not.toContain('personne@');
  });

  it('sends the link of the kit, on the portal of the account, whichever page it was asked from', async () => {
    const creditor = await newAccount(test, { role: 'CREDITOR', creditorId: test.s.creditorA });
    const officer = await newAccount(test);
    await ask(creditor.email, staff());
    await ask(officer.email, partner());
    const mails = await sent();
    expect(mails.map(({ name, to, data }) => ({ name, to, data }))).toEqual(
      expect.arrayContaining([
        {
          name: 'creditor-password-reset',
          to: creditor.email,
          data: expect.objectContaining({
            reset_url: expect.stringMatching(/^http:\/\/localhost:5174\/reinitialisation\/[\w-]{43}$/u) as string,
            expires_in: '1 heure',
          }) as object,
        },
        {
          name: 'staff-password-reset',
          to: officer.email,
          data: expect.objectContaining({ reset_url: expect.stringMatching(/^http:\/\/localhost:5173\/reinitialisation\/[\w-]{43}$/u) as string }) as object,
        },
      ]),
    );
    for (const mail of mails) expect(mail.html).toContain(mail.data.reset_url as string);
  });

  it('writes the link nowhere but in the message', async () => {
    const { email } = await newAccount(test);
    const token = await resetLink(email);
    const dump = JSON.stringify([
      await rows('SELECT * FROM auth_tokens'),
      await rows('SELECT * FROM outbox'),
      await rows('SELECT * FROM audit_log'),
      await rows('SELECT * FROM task_keys'),
    ]);
    const kept = await Promise.all((await worker.valkey.keys(`${worker.prefix}:*`)).map((key) => worker.valkey.dumpBuffer(key)));
    for (const place of [dump, test.logs.join(''), ...kept.map((value) => value?.toString('latin1') ?? '')]) {
      expect(place).not.toContain(token);
      expect(place).not.toContain(email);
    }
  });

  it('is limited by network and by address, known or not, with the same answer', async () => {
    const { email } = await newAccount(test);
    for (const address of [email, 'inconnue-encore@exemple.test']) {
      for (let i = 0; i < 3; i += 1) expect((await ask(address)).status).toBe(204);
      expect(await ask(address.toUpperCase())).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
    }
    const ip = newAddress();
    const answers = [];
    for (let i = 0; i < 11; i += 1) answers.push((await ask(`${i}@exemple.test`, new Browser(test, 'staff', { ip }))).status);
    expect(answers).toEqual([...Array<number>(10).fill(204), 429]);
    expect((await sent()).length).toBe(3);
  });
});

describe('link of reset', () => {
  it('shows its holder, changes the password, closes every session and every lock', async () => {
    const { id, email } = await newAccount(test);
    const open = staff();
    await open.login(email);
    for (let i = 0; i < 5; i += 1) await staff().login(email, 'faux-mot-de-passe');
    const token = await resetLink(email);
    const info = await staff().get(`/auth/reset/${token}`);
    expect(linkInfo.parse(info.body)).toEqual({ email, firstName: 'Nora', twoFactorRequired: false });
    expect((await staff().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(204);
    expect((await open.session()).status).toBe(401);
    expect((await staff().login(email)).status).toBe(401);
    expect((await staff().login(email, NEXT)).status).toBe(200);
    expect((await actionsOf(id)).filter((action) => action.startsWith('PASSWORD'))).toEqual(['PASSWORD_RESET_ASKED', 'PASSWORD_RESET']);
    const [user] = await rows<{ recent: boolean }>("SELECT password_changed_at > now() - interval '2 minutes' AS recent FROM users WHERE id = $1", [id]);
    expect(user).toEqual({ recent: true });
  });

  it('works once, for an hour, and only the last one', async () => {
    const { id, email } = await newAccount(test);
    const first = await resetLink(email);
    const second = await resetLink(email);
    expect(await staff().get(`/auth/reset/${first}`)).toMatchObject({ status: 410, body: { code: 'EXPIRED' } });
    expect((await staff().post(`/auth/reset/${first}`, { password: NEXT })).status).toBe(410);
    const [row] = await rows<{ minutes: number }>(
      'SELECT round(extract(epoch FROM expires_at - created_at) / 60)::int AS minutes FROM auth_tokens WHERE user_id = $1 AND used_at IS NULL',
      [id],
    );
    // The clock of the tests may be half a minute behind that of the database.
    expect(row!.minutes).toBeOneOf([59, 60]);
    expect((await staff().post(`/auth/reset/${second}`, { password: NEXT })).status).toBe(204);
    expect((await staff().get(`/auth/reset/${second}`)).status).toBe(410);
    expect((await staff().post(`/auth/reset/${second}`, { password: PASSWORD })).status).toBe(410);
    const third = await resetLink(email);
    await rows("UPDATE auth_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1 AND used_at IS NULL", [id]);
    expect((await staff().post(`/auth/reset/${third}`, { password: PASSWORD })).status).toBe(410);
  });

  it('works for one of those who use it at the same time', async () => {
    const { email } = await newAccount(test);
    const token = await resetLink(email);
    const answers = await Promise.all(Array.from({ length: 5 }, (_, i) => staff().post(`/auth/reset/${token}`, { password: `${NEXT}${i}` })));
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 410, 410, 410, 410]);
  });

  it('is refused on the other portal, as an invitation, to a disabled account, and invented', async () => {
    const { id, email } = await newAccount(test);
    const token = await resetLink(email);
    expect((await partner().get(`/auth/reset/${token}`)).status).toBe(410);
    expect((await partner().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(410);
    expect((await staff().get(`/auth/invitation/${token}`)).status).toBe(410);
    expect((await staff().post(`/auth/invitation/${token}/password`, { password: NEXT })).status).toBe(410);
    for (const invented of ['x', 'x'.repeat(43), '%00', `${token}x`, `${token}%20`])
      expect((await staff().get(`/auth/reset/${invented}`)).status).toBeOneOf([404, 410]);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
    expect((await staff().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(410);
  });

  it('is neither an invitation whose password is chosen, nor the question of a security key', async () => {
    const { id, email } = await newAccount(test);
    const keys = new AuthKeys(test.config);
    const opened = newToken();
    await rows(
      "INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at, opened_at) VALUES ('INVITATION', $1, $2, now() + interval '10 minutes', now())",
      [id, keys.linkHash(opened)],
    );
    const browser = staff();
    await browser.login(email);
    const { challenge } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
    // It has the shape of a link.
    expect(challenge).toMatch(/^[\w-]{43}$/u);
    for (const token of [opened, challenge]) {
      expect((await staff().get(`/auth/reset/${token}`)).status).toBe(410);
      expect((await staff().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(410);
    }
    for (const token of [challenge, browser.token!]) {
      expect((await staff().get(`/auth/invitation/${token}`)).status).toBe(410);
      expect((await staff().post(`/auth/invitation/${token}/password`, { password: NEXT })).status).toBe(410);
      expect((await staff().post(`/auth/invitation/${token}/totp`, { code: '000000' })).status).toBe(410);
    }
    expect((await staff().login(email)).status).toBe(200);
  });

  it('opens an account in the state for which it was made, and no other', async () => {
    const keys = new AuthKeys(test.config);
    const link = async (purpose: 'RESET' | 'INVITATION', id: string) => {
      const token = newToken();
      await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ($1::token_purpose, $2, $3, now() + interval '1 hour')", [
        purpose,
        id,
        keys.linkHash(token),
      ]);
      return token;
    };
    // An old invitation must not choose the password of an account that is open…
    const active = await newAccount(test);
    const invitation = await link('INVITATION', active.id);
    expect((await staff().get(`/auth/invitation/${invitation}`)).status).toBe(410);
    expect((await staff().post(`/auth/invitation/${invitation}/password`, { password: NEXT })).status).toBe(410);
    expect((await staff().login(active.email, NEXT)).status).toBe(401);
    expect((await staff().login(active.email)).status).toBe(200);
    // … nor a reset open one that was never activated, or that is closed.
    for (const status of ['INVITED', 'DISABLED']) {
      const account = await newAccount(test, { status });
      const reset = await link('RESET', account.id);
      expect((await staff().get(`/auth/reset/${reset}`)).status, status).toBe(410);
      expect((await staff().post(`/auth/reset/${reset}`, { password: NEXT })).status, status).toBe(410);
      expect(await rows('SELECT status::text FROM users WHERE id = $1', [account.id])).toEqual([{ status }]);
    }
    const closed = await newAccount(test, { status: 'DISABLED' });
    expect((await staff().post(`/auth/invitation/${await link('INVITATION', closed.id)}/password`, { password: NEXT })).status).toBe(410);
  });

  it('takes a password of twelve to two hundred characters, accents and spaces included', async () => {
    for (const password of ['x'.repeat(12), 'x'.repeat(200), 'été à Orléans…', ' trois mots et des espaces ']) {
      const { email } = await newAccount(test);
      expect((await staff().post(`/auth/reset/${await resetLink(email)}`, { password })).status, password).toBe(204);
      expect((await staff().login(email, password)).status, password).toBe(200);
    }
  });

  it('ends the other links of reset, and the sessions of every browser', async () => {
    const { id, email } = await newAccount(test);
    const browsers = [staff(), staff()];
    for (const browser of browsers) await browser.login(email);
    const token = await resetLink(email);
    const keys = new AuthKeys(test.config);
    const other = newToken();
    await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', $1, $2, now() + interval '1 hour')", [
      id,
      keys.linkHash(other),
    ]);
    expect((await staff().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(204);
    expect((await staff().post(`/auth/reset/${other}`, { password: PASSWORD })).status).toBe(410);
    for (const browser of browsers) expect((await browser.session()).status).toBe(401);
    expect((await staff().login(email, NEXT)).status).toBe(200);
  });

  it('waits for the portal of the creditor to be open', async () => {
    const { email } = await newAccount(test, { role: 'CREDITOR', creditorId: test.s.creditorB });
    const token = await resetLink(email, partner());
    await rows('UPDATE creditors SET portal_enabled = false WHERE id = $1', [test.s.creditorB]);
    expect((await partner().get(`/auth/reset/${token}`)).status).toBe(410);
    expect((await partner().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(410);
    await rows('UPDATE creditors SET portal_enabled = true WHERE id = $1', [test.s.creditorB]);
    expect((await partner().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(204);
  });

  it('refuses a password too short, or that is in the address, and stays good', async () => {
    const { email } = await newAccount(test);
    const token = await resetLink(email);
    for (const password of ['court', 'onze-lettre', email, email.toUpperCase(), email.slice(0, 20), 'x'.repeat(201)])
      expect(await staff().post(`/auth/reset/${token}`, { password }), password).toMatchObject({
        status: 422,
        body: { code: 'INVALID', fields: ['password'] },
      });
    expect((await staff().post(`/auth/reset/${token}`, { password: NEXT })).status).toBe(204);
  });

  it('leaves the second factor as it is', async () => {
    const { email } = await newAccount(test);
    const browser = staff();
    await browser.login(email);
    const { key } = await setUpTotp(browser);
    const token = await resetLink(email);
    await staff().post(`/auth/reset/${token}`, { password: NEXT });
    const again = staff();
    expect((await again.login(email, NEXT)).body).toEqual({ status: 'TWO_FACTOR', methods: ['TOTP'] });
    expect((await again.post('/auth/two-factor', { method: 'TOTP', code: codeOf(key) })).status).toBe(200);
  });
});

describe('an e-mail run again', () => {
  /** Its end was not recorded: Valkey delivers it a second time. */
  const again = (name: string, key: string, id: string) =>
    rows(`UPDATE outbox SET published_at = NULL, claimed_at = NULL, done_at = NULL WHERE name = $1 AND payload ->> '${key}' = $2`, [name, id]);
  const live = (id: string) => rows('SELECT 1 FROM auth_tokens WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()', [id]);

  it('is never sent twice: what may have left keeps its link, the task fails as uncertain', async () => {
    const { id, email } = await newAccount(test);
    const first = await resetLink(email);
    await again('reset-link', 'userId', id);
    expect(await sent()).toEqual([]);
    expect(await rows("SELECT failure FROM outbox WHERE name = 'reset-link' AND payload ->> 'userId' = $1", [id])).toEqual([{ failure: 'UNCERTAIN' }]);
    expect((await staff().get(`/auth/reset/${first}`)).status).toBe(200);
    expect(await live(id)).toHaveLength(1);
  });

  it('sends nothing once the account is closed, or activated, since', async () => {
    const { id, email } = await newAccount(test);
    await resetLink(email);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
    await again('reset-link', 'userId', id);
    expect(await sent()).toEqual([]);
    const creditor = await newAccount(test, { role: 'CREDITOR', creditorId: test.s.creditorA, status: 'INVITED' });
    await rows(
      "INSERT INTO outbox (queue, name, payload, actor_kind, actor_id) VALUES ('email', 'invitation', jsonb_build_object('userId', $1::text), 'STAFF', $2)",
      [creditor.id, test.s.director],
    );
    expect((await sent()).map((mail) => mail.name)).toEqual(['creditor-invitation']);
    await rows("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [creditor.id]);
    await again('invitation', 'userId', creditor.id);
    expect(await sent()).toEqual([]);
  });

  it('that could not leave is drawn again when asked again: what was lost opens nothing', async () => {
    const { id, email } = await newAccount(test);
    const jobs = new Database(test.database.url('jobs'), { poolSize: 2 });
    const leaving: { name: AutomaticEmail; to: string; token: string }[] = [];
    let cut = true;
    const send = (name: AutomaticEmail, to: string, data: unknown) => {
      leaving.push({ name, to, token: (data as { reset_url: string }).reset_url.split('/').at(-1)! });
      return cut ? Promise.reject(new Error('the provider does not answer')) : Promise.resolve();
    };
    const task = accountJobs({ keys: new AuthKeys(test.config), portals: test.config, mail: mailBy(send) })['reset-link']!;
    const run = () =>
      task.run({
        taskId: randomUUID(),
        payload: { userId: id },
        asAuthor: () => Promise.reject(new Error('nobody had signed in')),
        authorize: () => Promise.resolve((work) => jobs.run({ kind: 'worker', job: 'reset-link' }, work)),
      });
    try {
      await expect(run()).rejects.toThrow('does not answer');
      cut = false;
      await run();
    } finally {
      await jobs.close();
    }
    expect(leaving.map(({ name, to }) => [name, to])).toEqual(Array(2).fill(['staff-password-reset', email]));
    const [lost, received] = leaving.map(({ token }) => token);
    expect((await staff().get(`/auth/reset/${lost}`)).status).toBe(410);
    expect((await staff().get(`/auth/reset/${received}`)).status).toBe(200);
    expect(await live(id)).toHaveLength(1);
  });

  it('refuses a task that names nobody', async () => {
    const jobs = accountJobs({ keys: new AuthKeys(test.config), portals: test.config, mail: () => Promise.reject(new Error('sent')) });
    for (const [name, payload] of [
      ['invitation', {}],
      ['reset-link', { userId: 12 }],
      ['new-device', { sessionId: true }],
      ['second-factor-enabled', {}],
      ['delegation-changed', { active: true }],
      ['support-ticket', {}],
    ] as const) {
      const authorize = () =>
        Promise.resolve((work: (tx: never) => Promise<unknown>) =>
          work({ userSession: {}, secondFactor: {}, delegation: {}, supportTicket: {}, user: {} } as never),
        );
      await expect(jobs[name]!.run({ taskId: randomUUID(), payload, authorize, asAuthor: authorize } as never), name).rejects.toMatchObject({
        code: 'NO_IDENTIFIER',
      });
    }
  });

  it('carries what people are called as text, never as a page', async () => {
    const { id, email } = await newAccount(test);
    await rows("UPDATE users SET first_name = '<b>Léa</b> & « Co »' WHERE id = $1", [id]);
    await ask(email);
    const [mail] = await sent();
    expect(mail!.html).not.toContain('<b>Léa</b>');
    expect(mail!.html).toContain('&lt;b&gt;Léa&lt;/b&gt; &amp; « Co »');
  });
});

describe('invitation', () => {
  // Always the same browser, which is told to nobody.
  let known: Browser | undefined;
  const director = async () => {
    if (!known) await (known = staff()).login(await emailOf(test, test.s.director));
    return known;
  };
  const invite = async (body: object) => expect((await (await director()).post('/members', { firstName: 'Iris', lastName: 'Test', ...body })).status).toBe(204);
  const ofCreditor = async (email = `iris${Math.random().toString().slice(2)}@client.test`) => {
    await invite({ role: 'CREDITOR', email, creditorId: test.s.creditorA });
    const [mail] = await sent();
    return { email, mail: mail!, token: tokenIn(mail) };
  };

  it('reaches a creditor at once, and opens their account', async () => {
    const { email, mail, token } = await ofCreditor();
    expect(mail).toMatchObject({
      name: 'creditor-invitation',
      to: email,
      data: { creditor: { name: 'Créancier ALPHA-MARK' }, inviter: { name: 'Dora Test' }, recipient: { first_name: 'Iris' }, expires_in: '72 heures' },
    });
    expect(mail.data.invitation_url).toBe(`http://localhost:5174/activation/${token}`);
    expect((await partner().login(email)).status).toBe(401);
    expect(linkInfo.parse((await partner().get(`/auth/invitation/${token}`)).body)).toEqual({
      email,
      firstName: 'Iris',
      invitedBy: 'Dora Test',
      role: 'CREDITOR',
      twoFactorRequired: false,
    });
    const { totpKey: key } = totpKey.parse((await partner().post(`/auth/invitation/${token}/password`, { password: NEXT })).body);
    expect(await partner().post(`/auth/invitation/${token}/totp`, { code: '000000' })).toMatchObject({
      status: 401,
      body: { code: 'INVALID_CODE', attemptsLeft: 4 },
    });
    const codes = backupCodes.parse((await partner().post(`/auth/invitation/${token}/totp`, { code: codeOf(key) })).body);
    expect(codes.backupCodes).toHaveLength(8);
    // Good once.
    expect((await partner().get(`/auth/invitation/${token}`)).status).toBe(410);
    expect((await partner().post(`/auth/invitation/${token}/password`, { password: PASSWORD })).status).toBe(410);
    expect((await partner().post(`/auth/invitation/${token}/totp`, { code: codeOf(key, 1) })).status).toBe(410);
    const browser = partner();
    expect((await browser.login(email, NEXT)).body).toEqual({ status: 'TWO_FACTOR', methods: ['TOTP'] });
    expect((await browser.post('/auth/two-factor', { method: 'BACKUP_CODE', code: codes.backupCodes[0] })).status).toBe(200);
    expect((await browser.session()).status).toBe(200);
  });

  it('closes the second factor after five wrong codes, and not the account', async () => {
    const { email, token } = await ofCreditor();
    const { totpKey: key } = totpKey.parse((await partner().post(`/auth/invitation/${token}/password`, { password: NEXT })).body);
    const enter = (code: string) => partner().post(`/auth/invitation/${token}/totp`, { code });
    for (const left of [4, 3, 2, 1, 0]) expect(await enter('000000')).toMatchObject({ status: 401, body: { code: 'INVALID_CODE', attemptsLeft: left } });
    expect(await enter(codeOf(key))).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
    expect((await partner().login(email, NEXT)).body).toEqual({ status: 'OK', session: null });
    await rows("UPDATE lockouts SET locked_until = now() - interval '1 hour' WHERE locked_until IS NOT NULL");
    expect((await enter('000000')).body).toMatchObject({ attemptsLeft: 4 });
    expect((await enter(codeOf(key))).status).toBe(200);
    // Forgotten with the right one.
    const browser = partner();
    await browser.login(email, NEXT);
    expect((await browser.post('/auth/two-factor', { method: 'TOTP', code: '000000' })).body).toEqual({ code: 'INVALID_CODE', attemptsLeft: 4 });
  });

  it('gives its backup codes once, to one of those who prove the same code at the same time', async () => {
    const { email, token } = await ofCreditor();
    const { totpKey: key } = totpKey.parse((await partner().post(`/auth/invitation/${token}/password`, { password: NEXT })).body);
    const answers = await Promise.all(Array.from({ length: 4 }, () => partner().post(`/auth/invitation/${token}/totp`, { code: codeOf(key) })));
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(1);
    for (const { status } of answers) expect(status).toBeOneOf([200, 401, 404, 410]);
    expect(await rows('SELECT 1 FROM backup_codes b JOIN users u ON u.id = b.user_id WHERE u.email = $1', [email])).toHaveLength(8);
    expect(
      await rows('SELECT 1 FROM second_factors f JOIN users u ON u.id = f.user_id WHERE u.email = $1 AND f.confirmed_at IS NOT NULL', [email]),
    ).toHaveLength(1);
  });

  it('is noted at each step, and told of to a collaborator by e-mail', async () => {
    const { id, email } = await newAccount(test, { status: 'INVITED' });
    await rows('UPDATE users SET password_hash = NULL WHERE id = $1', [id]);
    const jobs = new Database(test.database.url('jobs'), { poolSize: 1 });
    try {
      const token = (await accountCommand({ database: jobs, keys: new AuthKeys(test.config), portals: test.config }, ['lien', email])).split('/').at(-1)!;
      const { totpKey: key } = totpKey.parse((await staff().post(`/auth/invitation/${token}/password`, { password: NEXT })).body);
      expect((await staff().post(`/auth/invitation/${token}/totp`, { code: codeOf(key) })).status).toBe(200);
    } finally {
      await jobs.close();
    }
    expect(await actionsOf(id)).toEqual(['LINK_DRAWN', 'ACCOUNT_ACTIVATED', 'SECOND_FACTOR_ENABLED']);
    expect((await worker.run()).filter((mail) => mail.to === email).map((mail) => mail.name)).toEqual(['staff-2fa-enabled']);
    expect(await rows('SELECT password_changed_at IS NOT NULL AS dated FROM users WHERE id = $1', [id])).toEqual([{ dated: true }]);
  });

  it('refuses a password that is in the address, and stays good', async () => {
    const { email, token } = await ofCreditor();
    for (const password of ['court', email, email.toUpperCase(), email.slice(0, 14)])
      expect(await partner().post(`/auth/invitation/${token}/password`, { password }), password).toMatchObject({
        status: 422,
        body: { code: 'INVALID', fields: ['password'] },
      });
    expect((await partner().get(`/auth/invitation/${token}`)).status).toBe(200);
    expect((await partner().post(`/auth/invitation/${token}/password`, { password: NEXT })).status).toBe(200);
  });

  it('may leave the second factor for later, within a quarter of an hour', async () => {
    const { email, token } = await ofCreditor();
    await partner().post(`/auth/invitation/${token}/password`, { password: NEXT });
    const browser = partner();
    expect((await browser.login(email, NEXT)).body).toEqual({ status: 'OK', session: null });
    // The password is chosen: never again with the same link.
    expect((await partner().post(`/auth/invitation/${token}/password`, { password: PASSWORD })).status).toBe(410);
    const [row] = await rows<{ minutes: number }>(
      'SELECT round(extract(epoch FROM expires_at - opened_at) / 60)::int AS minutes FROM auth_tokens WHERE opened_at IS NOT NULL AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
    );
    expect(row).toEqual({ minutes: 15 });
    await rows("UPDATE auth_tokens SET expires_at = now() - interval '1 hour' WHERE opened_at IS NOT NULL");
    expect((await partner().post(`/auth/invitation/${token}/totp`, { code: '000000' })).status).toBe(410);
  });

  it('waits for the mailbox of a collaborator, and is asked for with it', async () => {
    const email = `iris.${Math.random().toString().slice(2)}@legarec.fr`;
    await invite({ role: 'CLAIMS_OFFICER', email });
    expect(await sent()).toEqual([]);
    const [request] = await rows('SELECT r.local, r.status::text, r.requested_by FROM mailbox_requests r JOIN users u ON u.id = r.user_id WHERE u.email = $1', [
      email,
    ]);
    expect(request).toEqual({ local: email.split('@')[0], status: 'OPEN', requested_by: test.s.director });
    expect(await rows('SELECT 1 FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = $1', [email])).toEqual([]);
  });

  it('is drawn on the server meanwhile, and shown once', async () => {
    const email = `iris.${Math.random().toString().slice(2)}@legarec.fr`;
    await invite({ role: 'CLAIMS_OFFICER', email });
    const jobs = new Database(test.database.url('jobs'), { poolSize: 1 });
    const parts = { database: jobs, keys: new AuthKeys(test.config), portals: test.config };
    try {
      const url = await accountCommand(parts, ['lien', email]);
      const token = /^http:\/\/localhost:5173\/activation\/([\w-]{43})$/u.exec(url)![1]!;
      expect(linkInfo.parse((await staff().get(`/auth/invitation/${token}`)).body)).toMatchObject({ email, invitedBy: 'Dora Test', role: 'CLAIMS_OFFICER' });
      await staff().post(`/auth/invitation/${token}/password`, { password: NEXT });
      const reset = await accountCommand(parts, ['lien', email.toUpperCase()]);
      expect(reset).toMatch(/^http:\/\/localhost:5173\/reinitialisation\/[\w-]{43}$/u);
      expect((await staff().post(`/auth/reset/${reset.split('/').at(-1)!}`, { password: PASSWORD })).status).toBe(204);
      expect((await staff().login(email)).status).toBe(200);
      expect(await accountCommand(parts, ['lien', 'personne@legarec.fr'])).toBe('Aucun compte ouvert à cette adresse.');
      for (const wrong of [[], ['lien'], ['lien', 'pas-une-adresse'], ['autre', email], ['director', email], ['director', email, ' ', 'x']])
        expect(await accountCommand(parts, wrong)).toBe(USAGE);
      // There is a Director already.
      await expect(accountCommand(parts, ['director', 'autre@legarec.fr', 'Un', 'Autre'])).rejects.toThrow();
      const [entry] = await rows("SELECT actor_kind::text, actor_label, params FROM audit_log WHERE action = 'LINK_DRAWN' LIMIT 1");
      expect(entry).toEqual({ actor_kind: 'SYSTEM', actor_label: 'Application', params: {} });
    } finally {
      await jobs.close();
    }
  });

  it('of the first Director is drawn on the server, and opens the application with its delegations', async () => {
    const empty = await createTestDatabase();
    const jobs = new Database(empty.url('jobs'), { poolSize: 1 });
    const parts = { database: jobs, keys: new AuthKeys(test.config), portals: test.config };
    const { VAULT_MASTER_KEY, SESSION_SIGNING_KEY } = test.config;
    const fresh = await startApp([], { sessions: true, next: { ...test, database: empty }, env: { VAULT_MASTER_KEY, SESSION_SIGNING_KEY } });
    const firstDay = () => new Browser(fresh);
    try {
      const url = await accountCommand(parts, ['director', 'Dora.Premiere@legarec.fr', ' Dora ', ' Test ']);
      const first = /^http:\/\/localhost:5173\/activation\/([\w-]{43})$/u.exec(url)![1]!;
      expect((await empty.admin.query('SELECT role::text, status::text, first_name, last_name FROM users')).rows).toEqual([
        { role: 'DIRECTOR', status: 'INVITED', first_name: 'Dora', last_name: 'Test' },
      ]);
      // Once: the link may be drawn again, the account may not.
      await expect(accountCommand(parts, ['director', 'autre@legarec.fr', 'Un', 'Autre'])).rejects.toThrow();
      const token = (await accountCommand(parts, ['lien', 'dora.premiere@legarec.fr'])).split('/').at(-1)!;
      expect((await firstDay().get(`/auth/invitation/${first}`)).status).toBe(410);
      expect(linkInfo.parse((await firstDay().get(`/auth/invitation/${token}`)).body)).toEqual({
        email: 'Dora.Premiere@legarec.fr',
        firstName: 'Dora',
        invitedBy: 'Legarec',
        role: 'DIRECTOR',
        twoFactorRequired: false,
      });
      expect((await firstDay().post(`/auth/invitation/${token}/password`, { password: NEXT })).status).toBe(200);
      const browser = firstDay();
      const { body } = await browser.login('dora.premiere@legarec.fr', NEXT);
      expect(loginResponse.parse(body)).toMatchObject({
        status: 'OK',
        session: { role: 'DIRECTOR', directorName: 'Dora Test', activeDelegations: ['TECHNICAL', 'ADMINISTRATIVE'] },
      });
      expect((await browser.get('/delegations')).body).toEqual({
        technical: true,
        administrative: true,
        developer: 'aucun titulaire',
        manager: 'aucun titulaire',
      });
      const { rows: noted } = await empty.admin.query('SELECT action, actor_kind::text FROM audit_log ORDER BY occurred_at, id');
      expect(noted).toEqual([
        { action: 'DIRECTOR_CREATED', actor_kind: 'SYSTEM' },
        { action: 'LINK_DRAWN', actor_kind: 'SYSTEM' },
        { action: 'LINK_DRAWN', actor_kind: 'SYSTEM' },
        { action: 'ACCOUNT_ACTIVATED', actor_kind: 'STAFF' },
        { action: 'SIGNED_IN', actor_kind: 'STAFF' },
      ]);
    } finally {
      await fresh.stop();
      await jobs.close();
      await empty.drop();
    }
  });

  it('is not drawn on the server for an account that is closed', async () => {
    const { id, email } = await newAccount(test, { status: 'DISABLED' });
    const jobs = new Database(test.database.url('jobs'), { poolSize: 1 });
    try {
      expect(await accountCommand({ database: jobs, keys: new AuthKeys(test.config), portals: test.config }, ['lien', email])).toBe(
        'Aucun compte ouvert à cette adresse.',
      );
    } finally {
      await jobs.close();
    }
    expect(await rows('SELECT 1 FROM auth_tokens WHERE user_id = $1', [id])).toEqual([]);
    expect(await actionsOf(id)).toEqual([]);
  });

  it('is refused once cancelled, on the other portal, and to a second person at the same time', async () => {
    const cancelled = await ofCreditor();
    const [row] = await rows<{ id: string }>('SELECT id FROM users WHERE email = $1', [cancelled.email]);
    expect((await (await director()).delete(`/members/${row!.id}`)).status).toBe(204);
    expect((await partner().get(`/auth/invitation/${cancelled.token}`)).status).toBe(410);
    const { token } = await ofCreditor();
    expect((await staff().get(`/auth/invitation/${token}`)).status).toBe(410);
    expect((await staff().post(`/auth/invitation/${token}/password`, { password: NEXT })).status).toBe(410);
    expect((await partner().get(`/auth/reset/${token}`)).status).toBe(410);
    // Nothing is set up before the password is chosen.
    expect((await partner().post(`/auth/invitation/${token}/totp`, { code: '000000' })).status).toBe(401);
    const answers = await Promise.all(Array.from({ length: 4 }, (_, i) => partner().post(`/auth/invitation/${token}/password`, { password: `${NEXT}${i}` })));
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 410, 410, 410]);
  });

  it('cancelled before the message leaves, sends nothing', async () => {
    const email = `iris${Math.random().toString().slice(2)}@client.test`;
    await invite({ role: 'CREDITOR', email, creditorId: test.s.creditorA });
    const [row] = await rows<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    await (await director()).delete(`/members/${row!.id}`);
    expect(await sent()).toEqual([]);
  });

  it('stops with the delegation under which it was sent', async () => {
    const manager = staff();
    await manager.login(await emailOf(test, test.s.manager));
    const email = `iris${Math.random().toString().slice(2)}@client.test`;
    expect((await manager.post('/members', { firstName: 'Iris', lastName: 'Test', role: 'CREDITOR', email, creditorId: test.s.creditorA })).status).toBe(204);
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'ADMINISTRATIVE'");
    try {
      expect(await sent()).toEqual([]);
      expect(
        await rows(
          "SELECT failure FROM outbox WHERE name = 'invitation' AND failed_at IS NOT NULL AND payload ->> 'userId' = (SELECT id::text FROM users WHERE email = $1)",
          [email],
        ),
      ).toEqual([{ failure: 'AUTHOR_GONE' }]);
    } finally {
      await rows("UPDATE delegations SET withdrawn_at = NULL, withdrawn_by = NULL WHERE kind = 'ADMINISTRATIVE'");
    }
  });
});
