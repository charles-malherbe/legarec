import { loginResponse, partnerSession, session as staffSession } from '@legarec/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHEAP, startApp, type TestApp } from '../../../test/app';
import { Browser, emailOf, givePassword, IPHONE, newAccount, newAddress, PASSWORD } from '../../../test/browser';

let test: TestApp;
let email: Record<'director' | 'manager' | 'developer' | 'officerA' | 'officerB' | 'partnerA' | 'partnerB', string>;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const refused = (attemptsLeft: number) => ({ code: 'INVALID_CREDENTIALS', attemptsLeft });
const staff = () => new Browser(test);
const partner = () => new Browser(test, 'partner');
const entries = (actorOrEntity: string) =>
  rows<{ action: string; actor_kind: string; actor_id: string | null; entity_id: string | null; ip: string | null }>(
    'SELECT action, actor_kind::text, actor_id, entity_id, host(ip) AS ip FROM audit_log WHERE actor_id = $1 OR entity_id = $1 ORDER BY occurred_at',
    [actorOrEntity],
  );

beforeAll(async () => {
  test = await startApp([], { sessions: true });
  const { s } = test;
  await givePassword(test, s.director, s.manager, s.developer, s.officerA, s.officerB, s.partnerA, s.partnerB);
  const names = ['director', 'manager', 'developer', 'officerA', 'officerB', 'partnerA', 'partnerB'] as const;
  email = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await emailOf(test, s[name])]))) as typeof email;
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => test.stop());

describe('password', () => {
  it('opens the portal of the team, with the session that the screens expect', async () => {
    const browser = staff();
    const answer = await browser.login(email.officerA);
    expect(answer.status).toBe(200);
    const body = loginResponse.parse(answer.body);
    expect(body).toEqual({
      status: 'OK',
      session: {
        userId: test.s.officerA,
        firstName: 'Alba',
        lastName: 'Test',
        email: email.officerA,
        role: 'CLAIMS_OFFICER',
        extension: null,
        activeDelegations: ['TECHNICAL', 'ADMINISTRATIVE'],
        directorName: 'Dora Test',
        twoFactorEnabled: false,
        preferences: { theme: 'light', density: 'comfortable', lowVision: false },
      },
    });
    const session = await browser.session();
    expect(session.status).toBe(200);
    expect(staffSession.parse(session.body)).toEqual(body.status === 'OK' && body.session);
  });

  it('tells the delegations in force and the Director in place, as they are now', async () => {
    const browser = staff();
    await browser.login(email.officerB);
    const read = async () => {
      const { activeDelegations, directorName } = staffSession.parse((await browser.session()).body);
      return { activeDelegations, directorName };
    };
    expect(await read()).toEqual({ activeDelegations: ['TECHNICAL', 'ADMINISTRATIVE'], directorName: 'Dora Test' });
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'TECHNICAL'");
    expect(await read()).toEqual({ activeDelegations: ['ADMINISTRATIVE'], directorName: 'Dora Test' });
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.director]);
    expect(await read()).toEqual({ activeDelegations: [], directorName: '' });
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [test.s.director]);
    await rows("UPDATE delegations SET withdrawn_at = NULL, withdrawn_by = NULL WHERE kind = 'TECHNICAL'");
    expect(await read()).toEqual({ activeDelegations: ['TECHNICAL', 'ADMINISTRATIVE'], directorName: 'Dora Test' });
  });

  it('opens the portal of the creditors', async () => {
    const browser = partner();
    const answer = await browser.login(email.partnerA);
    expect(answer).toMatchObject({ status: 200, body: { status: 'OK', session: null } });
    const session = await browser.session();
    expect(partnerSession.parse(session.body)).toEqual({
      userId: test.s.partnerA,
      firstName: 'Paula',
      lastName: 'Test',
      email: email.partnerA,
      creditor: { id: test.s.creditorA, name: 'Créancier ALPHA-MARK', initials: 'CA', siren: expect.stringMatching(/^900\s000\s001$/u) as string },
      officer: 'Remi Test',
      unread: 0,
    });
  });

  it('gives cookies that only this host receives, over HTTPS, out of reach of any script', async () => {
    const browser = staff();
    await browser.login(email.officerA);
    expect(browser.set).toHaveLength(2);
    expect(browser.set.find((line) => line.startsWith('__Host-staff='))).toMatch(/^__Host-staff=[\w-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict$/u);
    expect(browser.set.find((line) => line.startsWith('__Host-device='))).toMatch(
      /^__Host-device=[\w-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000$/u,
    );
  });

  it('« Rester connecté » keeps the cookie when the browser closes, and nothing else: twelve hours at most', async () => {
    const browser = staff();
    await browser.login(email.officerA, PASSWORD, true);
    expect(browser.set.find((line) => line.startsWith('__Host-staff='))).toContain('; Max-Age=2592000');
    const [row] = await rows<{ persistent: boolean; hours: number }>(
      'SELECT persistent, round(extract(epoch FROM expires_at - created_at) / 3600)::int AS hours FROM user_sessions WHERE user_id = $1 AND persistent',
      [test.s.officerA],
    );
    expect(row).toEqual({ persistent: true, hours: 12 });
  });

  it('stores neither the token, nor the password, nor anything that leads to them', async () => {
    const browser = staff();
    await browser.login(email.officerB);
    const dump = JSON.stringify([
      await rows('SELECT * FROM users'),
      await rows("SELECT *, encode(token_hash, 'escape') AS text, encode(token_hash, 'base64') AS base FROM user_sessions"),
      await rows("SELECT *, encode(token_hash, 'escape') AS text FROM user_devices"),
      await rows('SELECT * FROM audit_log'),
      await rows('SELECT * FROM outbox'),
    ]);
    const everywhere = [dump, ...test.logs, ...(await test.valkey.keys('*'))].join('\n');
    for (const secret of [browser.token!, browser.device!, PASSWORD]) expect(everywhere).not.toContain(secret);
    expect(test.logs.join('')).not.toContain(email.officerB);
  });

  it('is noted as the doing of the account, with the address it came from', async () => {
    const { id, email: address } = await newAccount(test);
    const ip = newAddress();
    await new Browser(test, 'staff', { ip }).login(address);
    expect(await entries(id)).toEqual([{ action: 'SIGNED_IN', actor_kind: 'STAFF', actor_id: id, entity_id: null, ip }]);
    const creditor = await newAccount(test, { role: 'CREDITOR', creditorId: test.s.creditorA });
    await partner().login(creditor.email);
    expect(await entries(creditor.id)).toMatchObject([{ action: 'SIGNED_IN', actor_kind: 'CREDITOR', actor_id: creditor.id }]);
  });

  it('recognises an address whatever its case', async () => {
    const { email: address } = await newAccount(test);
    expect(await staff().login(address.toUpperCase())).toMatchObject({ status: 200, body: { status: 'OK' } });
  });
});

describe('refusal', () => {
  it('answers the same thing to an unknown address, a wrong password, and an account that may not sign in', async () => {
    const closed = await rows<{ id: string }>("INSERT INTO creditors (name, siren, portal_enabled) VALUES ('Fermé', '900000009', false) RETURNING id");
    const open = await newAccount(test);
    const invited = await newAccount(test, { status: 'INVITED' });
    const disabled = await newAccount(test, { status: 'DISABLED' });
    const silent = await newAccount(test);
    await rows('UPDATE users SET password_hash = NULL WHERE id = $1', [silent.id]);
    const shut = await newAccount(test, { role: 'CREDITOR', creditorId: closed[0]!.id });
    const answers = await Promise.all([
      staff().login('inconnu@exemple.test'),
      staff().login(open.email, 'un-autre-mot-de-passe'),
      staff().login(invited.email),
      staff().login(disabled.email),
      staff().login(silent.email),
      partner().login(shut.email),
    ]);
    for (const { status, body, headers } of answers) {
      expect({ status, body }).toEqual({ status: 401, body: refused(4) });
      expect(headers.getSetCookie()).toEqual([]);
      expect([...headers.keys()].sort()).toEqual([...answers[0]!.headers.keys()].sort());
    }
  });

  it('does the same work for an unknown address', async () => {
    const verify = vi.spyOn(CHEAP, 'verify');
    await staff().login('inconnue@exemple.test');
    await staff().login(email.officerB, 'un-autre-mot-de-passe');
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[0]![0]).toBeUndefined();
    expect(verify.mock.calls[1]![0]).toMatch(/^\$argon2id\$/u);
  });

  it.each(['connue', 'inconnue'])('closes after five failures, for fifteen minutes, an address %s', async (which) => {
    const known = await newAccount(test);
    const address = which === 'connue' ? known.email : 'personne@exemple.test';
    for (const left of [4, 3, 2, 1]) expect(await staff().login(address, 'faux-mot-de-passe')).toMatchObject({ status: 401, body: refused(left) });
    expect(await staff().login(address, 'faux-mot-de-passe')).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
    // The right password opens nothing any more, from anywhere.
    for (const portal of [staff(), partner()]) expect(await portal.login(address)).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
    expect(await staff().login(address.toUpperCase())).toMatchObject({ status: 423 });
    const [lock] = await rows<{ minutes: number }>(
      'SELECT round(extract(epoch FROM locked_until - last_failure_at) / 60)::int AS minutes FROM lockouts WHERE locked_until IS NOT NULL ORDER BY last_failure_at DESC LIMIT 1',
    );
    expect(lock).toEqual({ minutes: 15 });
    await rows("UPDATE lockouts SET locked_until = now() - interval '1 second' WHERE locked_until IS NOT NULL");
    expect(await staff().login(address, 'faux-mot-de-passe')).toMatchObject({ status: 401, body: refused(4) });
    expect((await staff().login(address)).status).toBe(which === 'connue' ? 200 : 401);
  });

  it('forgets the failures once the password is given, or after fifteen minutes without any', async () => {
    const { email: address } = await newAccount(test);
    const wrong = () => staff().login(address, 'faux-mot-de-passe');
    for (const left of [4, 3, 2]) expect((await wrong()).body).toEqual(refused(left));
    expect((await staff().login(address)).status).toBe(200);
    for (const left of [4, 3, 2]) expect((await wrong()).body).toEqual(refused(left));
    await rows("UPDATE lockouts SET last_failure_at = now() - interval '16 minutes'");
    expect((await wrong()).body).toEqual(refused(4));
  });

  it('opens with the right password at the fifth attempt, and forgets the four others', async () => {
    const { email: address } = await newAccount(test);
    for (let round = 0; round < 2; round += 1) {
      for (const left of [4, 3, 2, 1]) expect((await staff().login(address, 'faux-mot-de-passe')).body).toEqual(refused(left));
      expect(await staff().login(address)).toMatchObject({ status: 200, body: { status: 'OK' } });
    }
  });

  it('adds up failures that are fourteen minutes apart', async () => {
    const { email: address } = await newAccount(test);
    const wrong = () => staff().login(address, 'faux-mot-de-passe');
    for (const left of [4, 3, 2, 1]) {
      expect((await wrong()).body).toEqual(refused(left));
      await rows("UPDATE lockouts SET last_failure_at = now() - interval '14 minutes'");
    }
    expect(await wrong()).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
  });

  it('forgets the failures of one address only, once its password is given, on either portal', async () => {
    const { email: address } = await newAccount(test);
    const neighbour = await newAccount(test);
    const wrong = (which: string) => staff().login(which, 'faux-mot-de-passe');
    for (const left of [4, 3]) expect((await wrong(address)).body).toEqual(refused(left));
    expect((await wrong(neighbour.email)).body).toEqual(refused(4));
    expect((await partner().login(address)).body).toMatchObject({ status: 'WRONG_PORTAL' });
    expect((await wrong(address)).body).toEqual(refused(4));
    expect((await wrong(neighbour.email)).body).toEqual(refused(3));
  });

  it('counts the attempts made at the same time: never more than five proofs are checked', async () => {
    const { email: address } = await newAccount(test);
    const verify = vi.spyOn(CHEAP, 'verify');
    const answers = await Promise.all(Array.from({ length: 24 }, () => staff().login(address, 'faux-mot-de-passe')));
    expect(answers.filter((answer) => answer.status === 401)).toHaveLength(4);
    expect(answers.filter((answer) => answer.status === 423)).toHaveLength(20);
    expect(verify).toHaveBeenCalledTimes(5);
  });

  it('is noted as the doing of a stranger, about the account when there is one, without any address', async () => {
    const { id, email: address } = await newAccount(test);
    for (let i = 0; i < 5; i += 1) await staff().login(address, 'faux-mot-de-passe');
    const seen = await entries(id);
    expect(seen.map((entry) => entry.action)).toEqual([...Array<string>(4).fill('SIGN_IN_REFUSED'), 'ACCOUNT_LOCKED']);
    for (const entry of seen) expect(entry).toMatchObject({ actor_kind: 'ANONYMOUS', actor_id: null, entity_id: id });
    await staff().login('jamais-vu@exemple.test', 'faux-mot-de-passe');
    const [last] = await rows(
      'SELECT action, actor_kind::text, actor_id, entity_type, entity_id, params FROM audit_log ORDER BY occurred_at DESC, id DESC LIMIT 1',
    );
    expect(last).toEqual({ action: 'SIGN_IN_REFUSED', actor_kind: 'ANONYMOUS', actor_id: null, entity_type: null, entity_id: null, params: {} });
    expect(JSON.stringify(await rows('SELECT * FROM lockouts'))).not.toContain(address);
  });

  it('never quotes what was typed', async () => {
    const answer = await staff().post('/auth/login', { email: 'pas-une-adresse', password: PASSWORD, portal: 'espace' });
    expect(answer).toMatchObject({ status: 422, body: { code: 'INVALID', fields: ['email'] } });
    expect(JSON.stringify(answer.body) + test.logs.join('')).not.toContain(PASSWORD);
  });
});

describe('portal', () => {
  it('tells an account of the other portal where to go, once the password is proved, without opening anything', async () => {
    const browser = staff();
    expect(await browser.login(email.partnerB)).toMatchObject({
      status: 200,
      body: { status: 'WRONG_PORTAL', portal: 'partenaires', url: test.config.PARTNER_PORTAL_URL },
    });
    expect(browser.set).toEqual([]);
    expect(await partner().login(email.officerB)).toMatchObject({ body: { status: 'WRONG_PORTAL', portal: 'espace', url: test.config.STAFF_PORTAL_URL } });
    expect((await staff().login(email.partnerB, 'faux-mot-de-passe')).body).toEqual(refused(4));
    expect(await rows('SELECT 1 FROM user_sessions WHERE user_id = $1', [test.s.partnerB])).toEqual([]);
  });

  it('does not read the cookie of the other one', async () => {
    const mine = staff();
    await mine.login(email.officerA);
    const stolen = partner().put('partner', mine.token!).put('staff', mine.token!);
    expect((await stolen.session()).status).toBe(401);
    expect((await staff().put('partner', mine.token!).session()).status).toBe(401);
    expect((await staff().put('staff', mine.token!).session()).status).toBe(200);
  });
});

describe('limits by network', () => {
  it('stop a network after thirty attempts in ten minutes, whatever the accounts, and no other', async () => {
    const ip = newAddress();
    const attempt = (address: string) => new Browser(test, 'staff', { ip: address }).login(`${Math.random()}@exemple.test`);
    const answers = await Promise.all(Array.from({ length: 33 }, () => attempt(ip)));
    expect(answers.filter((answer) => answer.status === 401)).toHaveLength(30);
    expect(answers.filter((answer) => answer.status === 429 && (answer.body as { code: string }).code === 'TOO_MANY')).toHaveLength(3);
    expect((await attempt(newAddress())).status).toBe(401);
    // Before the password, so that even the right one waits.
    expect((await new Browser(test, 'staff', { ip }).login(email.officerA)).status).toBe(429);
  });

  it('do not believe an address that the caller writes itself', async () => {
    const spoofed = (i: number) =>
      staff().post('/auth/login', { email: `${Math.random()}@exemple.test`, password: 'x', portal: 'espace' }, { 'x-forwarded-for': `1.2.3.${i}, 10.9.9.9` });
    const answers = await Promise.all(Array.from({ length: 32 }, (_, i) => spoofed(i)));
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(2);
  });

  it('add up the attempts on both portals', async () => {
    const ip = newAddress();
    const attempt = (portal: 'staff' | 'partner') => new Browser(test, portal, { ip }).login(`${Math.random()}@exemple.test`);
    const answers = await Promise.all(Array.from({ length: 32 }, (_, i) => attempt(i % 2 ? 'staff' : 'partner')));
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(2);
  });

  it('refuse everything without Valkey, rather than counting nothing', async () => {
    const opened = staff();
    await opened.login(email.officerA);
    const [before] = await rows<{ n: number }>('SELECT count(*)::int AS n FROM lockouts');
    vi.spyOn(test.valkey, 'multi').mockImplementation(() => {
      throw new Error('away');
    });
    for (const answer of [
      await staff().login(email.officerA),
      await partner().login(email.partnerA),
      await staff().post('/auth/two-factor', { method: 'TOTP', code: '000000' }),
      await staff().post('/auth/two-factor/webauthn'),
      await staff().post('/auth/setup/totp'),
      await staff().post('/auth/setup/totp/verify', { code: '000000' }),
      await staff().post('/auth/forgot-password', { email: email.officerA }),
    ])
      expect(answer).toMatchObject({ status: 503, body: { code: 'UNAVAILABLE' } });
    // Nobody is locked by what was not checked, and those who are already in stay in.
    expect((await rows<{ n: number }>('SELECT count(*)::int AS n FROM lockouts'))[0]).toEqual(before);
    expect((await opened.session()).status).toBe(200);
    expect((await opened.post('/auth/logout')).status).toBe(204);
  });
});

describe('session', () => {
  const opened = async (address = email.officerA) => {
    const browser = staff();
    await browser.login(address);
    return browser;
  };
  const age = (browser: Browser, minutes: number) =>
    rows(
      'UPDATE user_sessions SET last_seen_at = now() - make_interval(mins => $1) WHERE id = (SELECT id FROM user_sessions ORDER BY created_at DESC, id DESC LIMIT 1) RETURNING id',
      [minutes],
    ).then(() => browser);
  const lastSeen = async () =>
    (
      await rows<{ minutes: number }>(
        'SELECT round(extract(epoch FROM now() - last_seen_at) / 60)::int AS minutes FROM user_sessions ORDER BY created_at DESC, id DESC LIMIT 1',
      )
    )[0]!.minutes;

  it.each(['', 'x', 'a'.repeat(43), `${'a'.repeat(42)}=`, `${'a'.repeat(43)}; role=DIRECTOR`, "' OR 1=1 --".padEnd(43, 'x')])(
    'is nobody with the token %j',
    async (token) => {
      expect((await staff().put('staff', token).session()).status).toBe(401);
    },
  );

  it('closes after thirty minutes without anything asked by its holder', async () => {
    expect((await (await age(await opened(), 29)).session()).status).toBe(200);
    expect(await lastSeen()).toBe(0);
    const late = await age(await opened(), 31);
    expect((await late.session()).status).toBe(401);
    expect(await lastSeen()).toBe(31);
  });

  it('is not kept open by what the screen asks by itself', async () => {
    const browser = await age(await opened(), 20);
    expect((await browser.get('/auth/session', { 'x-background': '1' })).status).toBe(200);
    expect(await lastSeen()).toBe(20);
    expect((await browser.session()).status).toBe(200);
    expect(await lastSeen()).toBe(0);
  });

  it('ends after twelve hours, however active', async () => {
    const browser = await opened();
    await rows("UPDATE user_sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [test.s.officerA]);
    expect((await browser.session()).status).toBe(401);
  });

  it('is read again at each request: role, status, portal, delegations', async () => {
    const { id, email: address } = await newAccount(test);
    const browser = await opened(address);
    const status = async (path = '/members') => (await browser.get(path)).status;
    expect(await status()).toBe(403);
    await rows("UPDATE users SET role = 'CLAIMS_OFFICER', status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
    expect(await status('/auth/session')).toBe(401);
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [id]);
    expect(await status('/auth/session')).toBe(200);

    const manager = await opened(email.manager);
    const invite = () =>
      manager.post('/members', { firstName: 'N', lastName: 'T', role: 'CLAIMS_OFFICER', email: `n${Math.random().toString().slice(2)}@legarec.fr` });
    expect((await invite()).status).toBe(204);
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'ADMINISTRATIVE'");
    expect((await invite()).status).toBe(403);
    await rows("UPDATE delegations SET withdrawn_at = NULL, withdrawn_by = NULL WHERE kind = 'ADMINISTRATIVE'");

    const creditor = partner();
    await creditor.login(email.partnerA);
    await rows('UPDATE creditors SET portal_enabled = false WHERE id = $1', [test.s.creditorA]);
    expect((await creditor.session()).status).toBe(401);
    await rows('UPDATE creditors SET portal_enabled = true WHERE id = $1', [test.s.creditorA]);
    expect((await creditor.session()).status).toBe(200);
  });

  it('is another one at each sign-in, and closing one leaves the others open', async () => {
    const browser = await opened();
    const first = browser.token!;
    await browser.login(email.officerA);
    expect(browser.token).not.toBe(first);
    // A token chosen by someone else is never taken over.
    const fixed = staff().put('staff', 'z'.repeat(43));
    await fixed.login(email.officerA);
    expect(fixed.token).not.toBe('z'.repeat(43));
    expect((await browser.post('/auth/logout')).status).toBe(204);
    expect((await fixed.session()).status).toBe(200);
  });

  it('ends with « Se déconnecter », for good', async () => {
    const browser = await opened();
    const stolen = staff().put('staff', browser.token!);
    expect((await browser.post('/auth/logout')).status).toBe(204);
    expect(browser.set).toEqual(['__Host-staff=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0']);
    expect((await stolen.session()).status).toBe(401);
    // Twice, or without any session: the same answer.
    expect((await stolen.post('/auth/logout')).status).toBe(204);
    expect((await staff().post('/auth/logout')).status).toBe(204);
  });

  it('answers « not signed in » on every route of the team without any session', async () => {
    for (const [method, path] of [
      ['GET', '/account'],
      ['GET', '/members'],
      ['PUT', '/auth/preferences'],
      ['DELETE', '/account/sessions'],
    ] as const)
      expect(await staff().call(method, path, method === 'PUT' ? { theme: 'dark', density: 'compact', lowVision: true } : undefined)).toMatchObject({
        status: 401,
        body: { code: 'UNAUTHORIZED' },
      });
  });

  it('survives the renewal of the signing key, until the previous one is withdrawn', async () => {
    const browser = await opened();
    const { SESSION_SIGNING_KEY, VAULT_MASTER_KEY } = test.config;
    const renewed = { VAULT_MASTER_KEY, SESSION_SIGNING_KEY: Buffer.alloc(32, 7).toString('base64') };
    const after = await startApp([], { sessions: true, next: test, env: { ...renewed, SESSION_SIGNING_KEY_PREVIOUS: SESSION_SIGNING_KEY } });
    const later = await startApp([], { sessions: true, next: test, env: renewed });
    try {
      expect((await new Browser(after).put('staff', browser.token!).session()).status).toBe(200);
      expect((await new Browser(later).put('staff', browser.token!).session()).status).toBe(401);
      // A lock holds, whatever the key.
      const { email: address } = await newAccount(test);
      for (let i = 0; i < 5; i += 1) await staff().login(address, 'faux-mot-de-passe');
      expect((await new Browser(later).login(address)).status).toBe(423);
    } finally {
      await after.stop();
      await later.stop();
    }
  });
});

describe('a browser that was never seen', () => {
  const told = (id: string) =>
    rows<{ session: string }>(
      "SELECT s.id AS session FROM outbox o JOIN user_sessions s ON s.id = (o.payload ->> 'sessionId')::uuid WHERE o.name = 'new-device' AND s.user_id = $1",
      [id],
    );

  it('is told to the holder, but the first one, and the same one again', async () => {
    const { id, email: address } = await newAccount(test);
    const first = staff();
    await first.login(address);
    expect(await told(id)).toEqual([]);
    await first.closed().login(address);
    expect(await told(id)).toEqual([]);
    const other = new Browser(test, 'staff', { agent: IPHONE });
    await other.login(address);
    const [session] = await rows<{ id: string; device_label: string; mobile: boolean }>(
      'SELECT id, device_label, mobile FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [id],
    );
    expect(session).toMatchObject({ device_label: 'Safari · iPhone', mobile: true });
    expect(await told(id)).toEqual([{ session: session!.id }]);
    await other.closed().login(address);
    expect(await told(id)).toHaveLength(1);
    // The cookie of someone else's browser, or an invented one, is not that of this account.
    const neighbour = await newAccount(test);
    await other.closed().login(neighbour.email);
    await staff().put('device', 'b'.repeat(43)).login(neighbour.email);
    expect(await told(neighbour.id)).toHaveLength(1);
  });

  it('is not told to a creditor', async () => {
    const { id, email: address } = await newAccount(test, { role: 'CREDITOR', creditorId: test.s.creditorA });
    await partner().login(address);
    await partner().login(address);
    expect(await told(id)).toEqual([]);
  });
});
