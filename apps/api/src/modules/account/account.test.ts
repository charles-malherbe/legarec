import { accountData, backupCodes, NOTIFICATION_KINDS, totpSetup } from '@legarec/contracts';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ORIGINS, startApp, type TestApp } from '../../../test/app';
import { Authenticator } from '../../../test/authenticator';
import { Browser, codeOf, emailOf, freezeClock, givePassword, IPHONE, newAccount, newAddress, PASSWORD, setUpTotp } from '../../../test/browser';
import { startMailWorker, type MailWorker } from '../../../test/worker';

let test: TestApp;
let worker: MailWorker;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const NEXT = 'Un-nouveau-mot-de-passe-9';
const signedIn = async (email: string, options: { ip?: string; agent?: string } = {}) => {
  const browser = new Browser(test, 'staff', options);
  await browser.login(email);
  return browser;
};
const read = async (browser: Browser) => accountData.parse((await browser.get('/account')).body);
const actionsOf = async (id: string) =>
  (await rows<{ action: string }>('SELECT action FROM audit_log WHERE actor_id = $1 ORDER BY occurred_at, id', [id])).map((row) => row.action);

beforeAll(async () => {
  freezeClock();
  test = await startApp([], { sessions: true });
  worker = startMailWorker(test);
  await givePassword(test, test.s.director, test.s.manager, test.s.officerA, test.s.developer);
});
afterAll(async () => {
  vi.useRealTimers();
  await worker.stop();
  await test.stop();
});

describe('Mon compte', () => {
  it('shows what the screen expects, about oneself only', async () => {
    const { email } = await newAccount(test);
    const ip = newAddress();
    const data = await read(await signedIn(email, { ip }));
    expect(data).toMatchObject({
      signature: ['Nora Test', 'Gestionnaire de créances', email],
      absence: { substituteId: '', from: '', to: '', autoReply: false },
      twoFactor: { enabled: false, method: null, mandatory: false, since: null },
      sessions: [{ device: 'Chrome · Windows', meta: `${ip} · actuellement`, mobile: false, current: true }],
      dailySummary: true,
      quietHours: true,
    });
    expect(data.notifications).toEqual(NOTIFICATION_KINDS);
    // Those who handle cases, never oneself nor the Developer.
    expect(data.substitutes.map((person) => person.name)).toEqual(expect.arrayContaining(['Alba Test', 'Beno Test', 'Dora Test', 'Remi Test']) as unknown);
    expect(data.substitutes.map((person) => person.name)).not.toContain('Devon Test');
    expect(data.passwordChangedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('counts no second factor that is only being set up, and names the application before the key', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const none = { enabled: false, method: null, mandatory: false, since: null };
    await browser.post('/account/two-factor/totp');
    expect((await read(browser)).twoFactor).toEqual(none);
    expect((await browser.session()).body).toMatchObject({ twoFactorEnabled: false });
    const { challenge } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
    expect((await browser.post('/account/two-factor/webauthn/verify', new Authenticator(ORIGINS.staff).register(challenge))).status).toBe(200);
    await rows("UPDATE second_factors SET confirmed_at = '2026-01-14T10:00:00Z' WHERE user_id = $1 AND kind = 'WEBAUTHN'", [id]);
    expect((await read(browser)).twoFactor).toEqual({ ...none, enabled: true, method: 'WEBAUTHN', since: '2026-01-14' });
    await setUpTotp(browser);
    // Since the first of them.
    expect((await read(browser)).twoFactor).toEqual({ ...none, enabled: true, method: 'TOTP', since: '2026-01-14' });
  });

  it('dates the password from the creation of the account, until it is changed', async () => {
    const { id, email } = await newAccount(test);
    await rows("UPDATE users SET created_at = '2026-03-28T23:30:00Z', password_changed_at = NULL WHERE id = $1", [id]);
    const browser = await signedIn(email);
    // In Paris, the day after.
    expect((await read(browser)).passwordChangedOn).toBe('2026-03-29');
    await rows("UPDATE users SET password_changed_at = '2026-07-01T10:00:00Z' WHERE id = $1", [id]);
    expect((await read(browser)).passwordChangedOn).toBe('2026-07-01');
  });

  it('never proposes the cases’ notifications to the Developer', async () => {
    const browser = new Browser(test);
    await browser.login(await emailOf(test, test.s.developer));
    const { key } = (await browser.post('/auth/setup/totp')).body as { key: string };
    await browser.post('/auth/setup/totp/verify', { code: codeOf(key) });
    expect(await read(browser)).toMatchObject({ notifications: [], twoFactor: { enabled: true, method: 'TOTP', mandatory: true } });
  });

  it('changes the name, and nothing that the holder does not own', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const body = { firstName: ' Léa ', lastName: 'Martin', role: 'DIRECTOR', email: 'autre@exemple.test', status: 'DISABLED', creditorId: test.s.creditorA };
    expect((await browser.change('/account/profile', body)).status).toBe(204);
    expect(await rows('SELECT first_name, last_name, role::text, status::text, email::text, creditor_id FROM users WHERE id = $1', [id])).toEqual([
      { first_name: 'Léa', last_name: 'Martin', role: 'CLAIMS_OFFICER', status: 'ACTIVE', email, creditor_id: null },
    ]);
    // Noted once, without the name.
    expect((await browser.change('/account/profile', { firstName: 'Léa', lastName: 'Martin' })).status).toBe(204);
    expect(await rows("SELECT action, params FROM audit_log WHERE actor_id = $1 AND action = 'NAME_CHANGED'", [id])).toEqual([
      { action: 'NAME_CHANGED', params: {} },
    ]);
    expect(await browser.change('/account/profile', { firstName: ' ', lastName: 'M' })).toMatchObject({ status: 422, body: { fields: ['firstName'] } });
  });

  it('keeps the display chosen', async () => {
    const browser = await signedIn((await newAccount(test)).email);
    const chosen = { theme: 'dark', density: 'compact', lowVision: true, menuCollapsed: true, menuClosedGroups: ['rec', 'doc'] };
    expect((await browser.change('/auth/preferences', chosen)).status).toBe(204);
    expect((await browser.session()).body).toMatchObject({ preferences: chosen });
    expect((await browser.change('/auth/preferences', { ...chosen, theme: 'pink' })).status).toBe(422);
    // Groups by their key only, never a text of the page.
    expect((await browser.change('/auth/preferences', { ...chosen, menuClosedGroups: ['Dossier Bâtiplus'] })).status).toBe(422);
    // A page loaded before the menu was remembered keeps saving the display, without forgetting the menu.
    expect((await browser.change('/auth/preferences', { theme: 'light', density: 'compact', lowVision: true })).status).toBe(204);
    expect((await browser.session()).body).toMatchObject({ preferences: { ...chosen, theme: 'light' } });
  });

  it('keeps an absence, with a substitute who handles cases', async () => {
    const browser = await signedIn((await newAccount(test)).email);
    const absence = { substituteId: test.s.officerB, from: '2026-12-21', to: '2026-12-31', autoReply: true };
    expect((await browser.change('/account/absence', absence)).status).toBe(204);
    expect((await read(browser)).absence).toEqual(absence);
    const disabled = await newAccount(test, { status: 'DISABLED' });
    const me = ((await browser.session()).body as { userId: string }).userId;
    for (const substituteId of [me, test.s.developer, test.s.partnerA, disabled.id, 'x', '00000000-0000-0000-0000-000000000000'])
      expect(await browser.change('/account/absence', { ...absence, substituteId }), substituteId).toMatchObject({
        status: 422,
        body: { fields: ['substituteId'] },
      });
    expect((await browser.change('/account/absence', { ...absence, from: '2027-01-02' })).status).toBe(422);
    expect((await read(browser)).absence).toEqual(absence);
    await browser.change('/account/absence', { substituteId: '', from: '', to: '', autoReply: false });
    expect((await read(browser)).absence).toEqual({ substituteId: '', from: '', to: '', autoReply: false });
  });

  it('keeps the notifications chosen, of the list only', async () => {
    const browser = await signedIn((await newAccount(test)).email);
    const choice = (id: string) => ({ id, label: 'ignoré', detail: '', inApp: false, email: false });
    expect((await browser.change('/account/notifications', { notifications: [choice('payment')], quietHours: false })).status).toBe(204);
    expect((await browser.change('/account/notifications', { notifications: [{ ...choice('payment'), email: true }] })).status).toBe(204);
    const data = await read(browser);
    expect(data).toMatchObject({ dailySummary: true, quietHours: false });
    expect(data.notifications[0]).toEqual({ ...NOTIFICATION_KINDS[0], inApp: false, email: true });
    expect(data.notifications.slice(1)).toEqual(NOTIFICATION_KINDS.slice(1));
    expect((await browser.change('/account/notifications', { notifications: [choice('inconnu')] })).status).toBe(422);
  });
});

describe('password', () => {
  it('changes with the current one, and closes the other sessions', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const other = await signedIn(email);
    expect(await browser.change('/account/password', { current: 'faux', next: NEXT })).toMatchObject({ status: 422, body: { code: 'INVALID_CREDENTIALS' } });
    await browser.post('/auth/forgot-password', { email });
    const [link] = (await worker.run()).filter((mail) => mail.name === 'staff-password-reset');
    expect((await browser.change('/account/password', { current: PASSWORD, next: NEXT })).status).toBe(204);
    expect((await browser.session()).status).toBe(200);
    expect((await other.session()).status).toBe(401);
    expect((await new Browser(test).login(email)).status).toBe(401);
    expect((await new Browser(test).login(email, NEXT)).status).toBe(200);
    // A link asked for before is worth nothing any more.
    expect((await new Browser(test).get(`/auth/reset/${/reinitialisation\/([\w-]{43})/u.exec(link!.html)![1]}`)).status).toBe(410);
    expect(await actionsOf(id)).toContain('PASSWORD_CHANGED');
    expect((await read(browser)).passwordChangedOn).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()));
  });

  it('forgets the failures once it is changed: the fifth attempt may be the right one', async () => {
    const { email } = await newAccount(test);
    const browser = await signedIn(email);
    const attempt = (current: string, next: string) => browser.change('/account/password', { current, next });
    for (let round = 0; round < 2; round += 1) {
      const [now, then] = round ? [NEXT, PASSWORD] : [PASSWORD, NEXT];
      for (let i = 0; i < 4; i += 1) expect((await attempt('faux', then)).status).toBe(422);
      expect((await attempt(now, then)).status).toBe(204);
    }
    expect((await browser.session()).status).toBe(200);
  });

  it('counts the attempts made at the same time: five at most are checked', async () => {
    const { email } = await newAccount(test);
    const browsers: Browser[] = [];
    for (let i = 0; i < 8; i += 1) browsers.push(await signedIn(email));
    const answers = await Promise.all(browsers.map((browser) => browser.change('/account/password', { current: 'faux', next: NEXT })));
    expect(answers.filter((answer) => answer.status === 422)).toHaveLength(5);
    expect(answers.filter((answer) => answer.status === 423)).toHaveLength(3);
  });

  it('refuses what the screen refuses, and the address itself', async () => {
    const { email } = await newAccount(test);
    const browser = await signedIn(email);
    for (const next of ['court-1!', 'sans-chiffre-ici!', 'sansCaractereSpecial1', email, email.slice(0, 24)])
      expect((await browser.change('/account/password', { current: PASSWORD, next })).status, next).toBe(422);
  });

  it('closes the session of someone who does not know it, after five attempts', async () => {
    const { email } = await newAccount(test);
    const browser = await signedIn(email);
    const attempt = (current = 'faux') => browser.change('/account/password', { current, next: NEXT });
    const elsewhere = await signedIn(email);
    for (let i = 0; i < 4; i += 1) expect((await attempt()).status).toBe(422);
    expect((await browser.session()).status).toBe(200);
    expect((await attempt()).status).toBe(422);
    expect((await browser.session()).status).toBe(401);
    // That one only: the holder may be at another one, and the sign-in is not locked.
    expect((await elsewhere.session()).status).toBe(200);
    const again = await signedIn(email);
    expect(await again.change('/account/password', { current: PASSWORD, next: NEXT })).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
  });
});

describe('second factor', () => {
  it('is asked once it has been proved, not before', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const { key, uri } = totpSetup.parse((await browser.post('/account/two-factor/totp')).body);
    expect(key).toMatch(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/u);
    expect(new URL(uri).searchParams.get('secret')).toBe(key.replace(/ /gu, ''));
    expect((await new Browser(test).login(email)).body).toMatchObject({ status: 'OK' });
    expect(await browser.post('/account/two-factor/totp/verify', { code: '000000' })).toMatchObject({ status: 422, body: { code: 'INVALID_CODE' } });
    const codes = backupCodes.parse((await browser.post('/account/two-factor/totp/verify', { code: codeOf(key) })).body);
    expect(codes.backupCodes).toHaveLength(8);
    expect((await browser.session()).body).toMatchObject({ twoFactorEnabled: true });
    expect((await read(browser)).twoFactor).toMatchObject({ enabled: true, method: 'TOTP', mandatory: false });
    expect((await new Browser(test).login(email)).body).toEqual({ status: 'TWO_FACTOR', methods: ['TOTP'] });
    const [mail] = (await worker.run()).filter((item) => item.name === 'staff-2fa-enabled');
    expect(mail).toMatchObject({ to: email, data: { event: { method_label: 'Application d’authentification' }, recipient: { first_name: 'Nora' } } });
    expect(await actionsOf(id)).toContain('SECOND_FACTOR_ENABLED');
  });

  it('is replaced by a new application once that one is proved, not before', async () => {
    const { email } = await newAccount(test);
    const browser = await signedIn(email);
    const first = await setUpTotp(browser);
    const { key } = (await browser.post('/account/two-factor/totp')).body as { key: string };
    const enter = async (code: string) => (await (await signedIn(email)).post('/auth/two-factor', { method: 'TOTP', code })).status;
    expect(await enter(codeOf(first.key))).toBe(200);
    expect(await enter(codeOf(key))).toBe(401);
    // The backup codes stay those already shown.
    expect((await browser.post('/account/two-factor/totp/verify', { code: codeOf(key, -1) })).body).toEqual({ backupCodes: [] });
    expect(await enter(codeOf(first.key, 1))).toBe(401);
    expect(await enter(codeOf(key))).toBe(200);
  });

  it('may be a security key, next to the application', async () => {
    const { email } = await newAccount(test);
    const browser = await signedIn(email);
    await setUpTotp(browser);
    const authenticator = new Authenticator(ORIGINS.staff);
    const { challenge } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
    expect((await browser.post('/account/two-factor/webauthn/verify', { ...authenticator.register(challenge), id: 'x' })).status).toBe(422);
    const { challenge: again } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
    expect((await browser.post('/account/two-factor/webauthn/verify', authenticator.register(again))).body).toEqual({ backupCodes: [] });
    expect((await new Browser(test).login(email)).body).toEqual({ status: 'TWO_FACTOR', methods: ['TOTP', 'WEBAUTHN'] });
    const { body } = await browser.post('/account/two-factor/webauthn');
    expect((body as { excludeCredentials: unknown[] }).excludeCredentials).toHaveLength(1);
    expect((body as { rp: unknown }).rp).toEqual({ id: 'localhost', name: 'Legarec' });
  });

  it('forgets the wrong codes once the right one is given', async () => {
    const browser = await signedIn((await newAccount(test)).email);
    const { key } = (await browser.post('/account/two-factor/totp')).body as { key: string };
    const enter = async (code: string) => (await browser.post('/account/two-factor/totp/verify', { code })).status;
    for (let i = 0; i < 4; i += 1) expect(await enter('000000')).toBe(422);
    expect(await enter(codeOf(key))).toBe(200);
    for (let i = 0; i < 5; i += 1) expect(await enter('000000')).toBe(422);
    expect(await enter('000000')).toBe(423);
  });

  it('is told to its holder: an application, or a security key', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const { challenge } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
    await browser.post('/account/two-factor/webauthn/verify', new Authenticator(ORIGINS.staff).register(challenge));
    const told = async () => (await worker.run()).filter((mail) => mail.to === email && mail.name === 'staff-2fa-enabled');
    expect((await told()).map((mail) => (mail.data.event as { method_label: string }).method_label)).toEqual(['Clé de sécurité']);
    expect(await actionsOf(id)).toContain('SECOND_FACTOR_ENABLED');
    // Removed before the message leaves: nothing is told any more.
    await setUpTotp(browser);
    expect((await browser.delete('/account/two-factor')).status).toBe(204);
    expect(await told()).toEqual([]);
  });

  it('closes after five wrong codes', async () => {
    const browser = await signedIn((await newAccount(test)).email);
    const { key } = (await browser.post('/account/two-factor/totp')).body as { key: string };
    for (let i = 0; i < 5; i += 1) expect((await browser.post('/account/two-factor/totp/verify', { code: '000000' })).status).toBe(422);
    expect((await browser.post('/account/two-factor/totp/verify', { code: codeOf(key) })).status).toBe(423);
  });

  it('is removed by its holder, unless it is required', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const { backupCodes: codes } = await setUpTotp(browser);
    const { challenge } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
    expect((await browser.post('/account/two-factor/webauthn/verify', new Authenticator(ORIGINS.staff).register(challenge))).status).toBe(200);
    await rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]);
    expect(await browser.delete('/account/two-factor')).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    await rows('UPDATE users SET two_factor_required = false WHERE id = $1', [id]);
    expect((await browser.delete('/account/two-factor')).status).toBe(204);
    expect(await rows('SELECT 1 FROM second_factors WHERE user_id = $1 UNION ALL SELECT 1 FROM backup_codes WHERE user_id = $1', [id])).toEqual([]);
    expect((await new Browser(test).login(email)).body).toMatchObject({ status: 'OK' });
    expect(codes).toHaveLength(8);
    expect(await actionsOf(id)).toContain('SECOND_FACTOR_DISABLED');
  });
});

describe('sessions', () => {
  it('lists those that are open, and closes the others', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const phone = await signedIn(email, { agent: IPHONE });
    const third = await signedIn(email);
    const silent = await signedIn(email);
    await rows(
      "UPDATE user_sessions SET last_seen_at = now() - interval '31 minutes' WHERE id = (SELECT id FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1)",
      [id],
    );
    const { sessions } = await read(browser);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    const mobile = sessions.find((session) => session.mobile)!;
    expect(mobile).toMatchObject({ device: 'Safari · iPhone', current: false });
    expect((await browser.delete(`/account/sessions/${mobile.id}`)).status).toBe(204);
    expect((await phone.session()).status).toBe(401);
    expect((await browser.delete(`/account/sessions/${mobile.id}`)).status).toBe(404);
    const current = sessions.find((session) => session.current)!;
    expect((await browser.delete(`/account/sessions/${current.id}`)).status).toBe(403);
    expect((await browser.delete('/account/sessions')).status).toBe(204);
    for (const closed of [third, silent]) expect((await closed.session()).status).toBe(401);
    expect((await browser.session()).status).toBe(200);
    expect((await read(browser)).sessions).toEqual([expect.objectContaining({ current: true })]);
    const [entry] = await rows("SELECT params FROM audit_log WHERE action = 'SESSIONS_CLOSED' AND actor_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1", [
      id,
    ]);
    expect(entry).toEqual({ params: { count: 2 } });
  });

  it('does not list what is closed, expired, silent, or without its second factor', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const add = (some: { needed?: boolean; given?: string; expires?: string; seen?: string; revoked?: string }) =>
      rows(
        `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, second_factor_at, expires_at, last_seen_at, revoked_at)
         VALUES ($1, 'STAFF', $2, 'x', ${some.needed ?? false}, ${some.given ?? 'NULL'}, ${some.expires ?? "now() + interval '1 hour'"}, ${some.seen ?? 'now()'}, ${some.revoked ?? 'NULL'})`,
        [id, randomBytes(32)],
      );
    await add({ revoked: 'now()' });
    await add({ expires: "now() - interval '1 hour'" });
    await add({ seen: "now() - interval '40 minutes'" });
    await add({ needed: true });
    expect((await read(browser)).sessions).toEqual([expect.objectContaining({ current: true, device: 'Chrome · Windows' })]);
    await add({ needed: true, given: 'now()' });
    expect((await read(browser)).sessions.map((session) => session.device).sort()).toEqual(['Chrome · Windows', 'x']);
  });

  it('closes a thousand of them at once', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    await rows(
      `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at)
       SELECT $1::uuid, 'STAFF', sha256(convert_to(n || ' of ' || $1::uuid, 'UTF8')), 'x', false, now() + interval '1 hour' FROM generate_series(1, 1200) AS n`,
      [id],
    );
    expect((await browser.delete('/account/sessions')).status).toBe(204);
    expect(await rows('SELECT 1 FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL', [id])).toHaveLength(1);
    // The journal keeps short numbers only.
    expect(await rows("SELECT params FROM audit_log WHERE action = 'SESSIONS_CLOSED' AND actor_id = $1", [id])).toEqual([{ params: { count: 999 } }]);
    // Nothing more to close, nothing more to note.
    expect((await browser.delete('/account/sessions')).status).toBe(204);
    expect(await actionsOf(id)).toEqual(['SIGNED_IN', 'SESSIONS_CLOSED']);
  });

  it('closes nothing of someone else', async () => {
    const mine = await signedIn((await newAccount(test)).email);
    const other = await newAccount(test);
    const theirs = await signedIn(other.email);
    const [{ id } = { id: '' }] = await rows<{ id: string }>('SELECT id FROM user_sessions WHERE user_id = $1', [other.id]);
    for (const wanted of [id, 'x', '%27', '00000000-0000-0000-0000-000000000000'])
      expect((await mine.delete(`/account/sessions/${wanted}`)).status, wanted).toBe(404);
    await mine.delete('/account/sessions');
    expect((await theirs.session()).status).toBe(200);
  });
});

describe('e-mails to the holder', () => {
  it('tell of a new browser, with its name, its address and the date', async () => {
    const { email } = await newAccount(test);
    await signedIn(email);
    const ip = newAddress();
    await signedIn(email, { agent: IPHONE, ip });
    const mails = (await worker.run()).filter((mail) => mail.to === email);
    expect(mails).toEqual([
      expect.objectContaining({
        name: 'staff-new-device',
        data: {
          device: { name: 'Safari · iPhone', ip, login_at: expect.stringMatching(/^\d{1,2} \S+ \d{4} à \d{2}:\d{2}$/u) as string },
          recipient: { first_name: 'Nora' },
          secure_url: 'http://localhost:5173/compte',
        },
      }),
    ]);
  });

  it('are given up when the account is closed before they leave', async () => {
    const { id, email } = await newAccount(test);
    await signedIn(email);
    await signedIn(email);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
    expect((await worker.run()).filter((mail) => mail.to === email)).toEqual([]);
    expect(await rows("SELECT failure FROM outbox WHERE name = 'new-device' AND actor_id = $1", [id])).toEqual([{ failure: 'AUTHOR_GONE' }]);
  });
});
