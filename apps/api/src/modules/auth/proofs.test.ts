import { SENSITIVE_ACTIONS, type SensitiveAction } from '@legarec/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHEAP, ORIGINS, startApp, type TestApp } from '../../../test/app';
import { Authenticator } from '../../../test/authenticator';
import { Browser, codeOf, emailOf, freezeClock, givePassword, newAccount, PASSWORD, setUpTotp } from '../../../test/browser';
import { routesOf } from '../../platform/access/routes';
import { requireProof } from '../../platform/access/proof';
import { ApiError } from '../../platform/errors/api-error';
import { Accounts } from './accounts';

/** What matters most asks for a proof again (questions 122 and 134). */
let test: TestApp;
let director: Browser;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
/** By the clock of the tests, which stands still. */
const age = (id: string, seconds: number) => rows('UPDATE user_sessions SET proved_at = $2 WHERE user_id = $1', [id, new Date(Date.now() - seconds * 1000)]);
const REQUIRED = { status: 403, body: { code: 'PROOF_REQUIRED' } };
const provedAt = async (id: string) =>
  (
    await rows<{ age: number }>('SELECT extract(epoch FROM now() - max(proved_at))::int AS age FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL', [
      id,
    ])
  )[0]!.age;
const signedIn = async (id: string, email?: string) => {
  const browser = new Browser(test);
  await browser.login(email ?? (await emailOf(test, id)));
  return browser;
};
/** A colleague with a password and one session. */
const colleague = async (role = 'CLAIMS_OFFICER') => {
  const account = await newAccount(test, { role });
  return { ...account, browser: await signedIn(account.id, account.email) };
};
const creditor = async () => (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Nouveau') RETURNING id"))[0]!.id;
const secret = async () => {
  await rows("DELETE FROM vault_secrets WHERE name = 'AI_API_KEY'");
  return (await rows<{ id: string }>("INSERT INTO vault_secrets (name, value_cipher) VALUES ('AI_API_KEY', '\\x00') RETURNING id"))[0]!.id;
};

beforeAll(async () => {
  freezeClock();
  test = await startApp([], { sessions: true });
  await givePassword(test, test.s.director);
  await rows(
    'INSERT INTO delegations (kind, granted_by) SELECT k, $1 FROM unnest(enum_range(NULL::delegation_kind)) k WHERE NOT EXISTS (SELECT 1 FROM delegations WHERE kind = k AND withdrawn_at IS NULL)',
    [test.s.director],
  );
  director = await signedIn(test.s.director);
});
beforeEach(async () => void (await rows('DELETE FROM lockouts')));
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  vi.useRealTimers();
  await test.stop();
});

describe('the list of the sensitive actions', () => {
  /** Decided with what is asked: each has its own test below. */
  const SOMETIMES: SensitiveAction[] = [
    'POST /account/two-factor/totp',
    'POST /account/two-factor/totp/verify',
    'POST /account/two-factor/webauthn',
    'POST /account/two-factor/webauthn/verify',
    'PUT /settings/:scope/:id',
  ];
  it('is the one of the routes: none is forgotten, none is added', () => {
    const always = routesOf(test.app)
      .filter((route) => route.proof)
      .map((route) => route.id.replace('/staff', ''));
    expect(always.sort()).toEqual(
      Object.keys(SENSITIVE_ACTIONS)
        .filter((key) => !SOMETIMES.includes(key as SensitiveAction))
        .sort(),
    );
  });
});

interface Case {
  method: 'post' | 'change' | 'delete';
  path: () => string | Promise<string>;
  body?: unknown;
  /** What it is once the proof is given. */
  status: number;
  changed: () => Promise<unknown>;
}
const audited = (action: string) => async () => (await rows(`SELECT count(*)::int AS n FROM audit_log WHERE action = $1`, [action]))[0];
/** Those of one's own second factor have their own tests, below. */
type OwnFactor = Extract<SensitiveAction, `${string} /account/two-factor${string}`>;
const CASES: Record<Exclude<SensitiveAction, OwnFactor>, Case> = {
  'POST /members/:id/reset-2fa': {
    method: 'post',
    path: async () => {
      const { id } = await newAccount(test);
      await rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [id]);
      return `/members/${id}/reset-2fa`;
    },
    status: 204,
    changed: audited('SECOND_FACTOR_RESET'),
  },
  'PUT /members/:id/role': {
    method: 'change',
    path: async () => {
      await rows("UPDATE users SET role = 'CLAIMS_OFFICER' WHERE role = 'DEVELOPER'");
      return `/members/${(await newAccount(test)).id}/role`;
    },
    body: { role: 'DEVELOPER' },
    status: 204,
    changed: audited('MEMBER_ROLE_CHANGED'),
  },
  'PUT /delegations/:kind': {
    method: 'change',
    path: async () => {
      await rows(
        "INSERT INTO delegations (kind, granted_by) SELECT 'ADMINISTRATIVE', $1 WHERE NOT EXISTS (SELECT 1 FROM delegations WHERE kind = 'ADMINISTRATIVE' AND withdrawn_at IS NULL)",
        [test.s.director],
      );
      return '/delegations/administrative';
    },
    body: { active: false },
    status: 204,
    changed: audited('DELEGATION_WITHDRAWN'),
  },
  'PUT /settings/:scope/:id': {
    method: 'change',
    path: async () => {
      await rows('DELETE FROM settings');
      return '/settings/firm/cabinet?version=0';
    },
    body: { iban: 'GB82 WEST 1234 5698 7654 32' },
    status: 204,
    changed: audited('FIRM_IDENTITY_CHANGED'),
  },
  'POST /creditors/:id/bank-accounts': {
    method: 'post',
    path: async () => `/creditors/${await creditor()}/bank-accounts`,
    body: { replaces: null, account: { holder: 'X', iban: 'GB82 WEST 1234 5698 7654 32', bic: 'PSSTFRPPXXX', confirmedWith: '' } },
    status: 204,
    changed: audited('CREDITOR_ACCOUNT_CHANGED'),
  },
  'POST /creditors/:id/bank-accounts/:accountId/confirm': {
    method: 'post',
    path: async () => {
      const id = await creditor();
      const [account] = await rows<{ id: string }>(
        "INSERT INTO creditor_bank_accounts (creditor_id, holder, iban_cipher, iban_masked, bic, created_by) VALUES ($1, 'X', '\\x00', 'GB82 •••• •••• 5432', 'PSSTFRPPXXX', $2) RETURNING id",
        [id, test.s.director],
      );
      return `/creditors/${id}/bank-accounts/${account!.id}/confirm`;
    },
    body: { confirmedWith: 'Élodie Rivaud' },
    status: 204,
    changed: async () => rows('SELECT count(*)::int AS n FROM creditor_bank_accounts WHERE confirmed_at IS NOT NULL'),
  },
  'POST /secrets': {
    method: 'post',
    path: async () => {
      await rows("DELETE FROM vault_secrets WHERE name = 'AI_API_KEY'");
      return '/secrets';
    },
    body: { name: 'AI_API_KEY', value: 'valeur-fictive', rotation: 'MANUAL' },
    status: 204,
    changed: audited('SECRET_SAVED'),
  },
  'POST /secrets/:id/rotate': {
    method: 'post',
    path: async () => `/secrets/${await secret()}/rotate`,
    body: { value: 'autre' },
    status: 204,
    changed: audited('SECRET_RENEWED'),
  },
  'POST /secrets/:id/revoke': { method: 'post', path: async () => `/secrets/${await secret()}/revoke`, status: 204, changed: audited('SECRET_REVOKED') },
};

describe('a sensitive action', () => {
  it.each(Object.entries(CASES))(
    '%s is refused ten minutes after the last proof, and done once it is given again',
    async (_name, { method, path, body, status, changed }) => {
      const ask = (to: string) => (method === 'delete' ? director.delete(to) : director[method](to, body));
      const at = await path();
      const before = await changed();
      await age(test.s.director, 601);
      expect(await ask(at)).toMatchObject(REQUIRED);
      expect(await changed()).toEqual(before);
      await age(test.s.director, 600);
      expect((await ask(at)).status).toBe(status);
      expect(await changed()).not.toEqual(before);
    },
  );

  it('of one’s own second factor too: removed, or added to another one', async () => {
    const { id, email, browser } = await colleague();
    const { key } = await setUpTotp(browser);
    await age(id, 660);
    const authenticator = new Authenticator(ORIGINS.staff);
    for (const ask of [
      () => browser.delete('/account/two-factor'),
      () => browser.post('/account/two-factor/totp'),
      () => browser.post('/account/two-factor/totp/verify', { code: codeOf(key) }),
      () => browser.post('/account/two-factor/webauthn'),
      () => browser.post('/account/two-factor/webauthn/verify', authenticator.register('x')),
    ])
      expect(await ask()).toMatchObject(REQUIRED);
    // Nothing was counted as a failure.
    expect(await rows('SELECT 1 FROM lockouts')).toEqual([]);
    expect(await rows('SELECT kind FROM second_factors WHERE user_id = $1 AND confirmed_at IS NOT NULL', [id])).toEqual([{ kind: 'TOTP' }]);
    expect((await browser.post('/auth/proof', { method: 'TOTP', code: codeOf(key) })).status).toBe(204);
    expect((await browser.delete('/account/two-factor')).status).toBe(204);
    expect((await signedIn(id, email)).token).toBeDefined();
  });

  it('is the first second factor too: an open screen does not become the proof of everything else', async () => {
    const { id, browser } = await colleague();
    await age(id, 7200);
    const authenticator = new Authenticator(ORIGINS.staff);
    for (const ask of [
      () => browser.post('/account/two-factor/totp'),
      () => browser.post('/account/two-factor/totp/verify', { code: '123456' }),
      () => browser.post('/account/two-factor/webauthn'),
      () => browser.post('/account/two-factor/webauthn/verify', authenticator.register('x')),
    ])
      expect(await ask()).toMatchObject(REQUIRED);
    expect((await browser.get('/auth/proof')).body).toEqual({ methods: ['PASSWORD'] });
    expect((await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).status).toBe(204);
    expect((await browser.post('/account/two-factor/totp')).status).toBe(200);
  });

  it('is not an ordinary setting', async () => {
    await rows('DELETE FROM settings');
    await age(test.s.director, 7200);
    expect((await director.change('/settings/firm/relances?version=0', { calls: '3' })).status).toBe(204);
    expect((await director.change('/settings/firm/cabinet?version=0', { name: 'LEGAREC SAS' })).status).toBe(204);
    expect(await director.change('/settings/firm/cabinet?version=1', { name: 'X', holder: 'LEGAREC' })).toMatchObject(REQUIRED);
  });

  it('is refused for a role before any proof is asked', async () => {
    const { id, browser } = await colleague();
    await age(id, 7200);
    expect(await browser.post('/secrets', { name: 'AI_API_KEY', value: 'x', rotation: 'MANUAL' })).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
  });

  it('is refused to whoever has proved nothing that is known', () => {
    expect(() => requireProof({ kind: 'staff', userId: 'x', role: 'DIRECTOR', delegations: [] })).toThrow();
    expect(() => requireProof({ kind: 'partner', userId: 'x', creditorId: 'x' })).toThrow();
  });
});

describe('the proof', () => {
  it('is the password without a second factor, and then the second factor alone', async () => {
    const { id, browser } = await colleague();
    expect((await browser.get('/auth/proof')).body).toEqual({ methods: ['PASSWORD'] });
    await age(id, 3600);
    expect((await browser.post('/auth/proof', { method: 'TOTP', code: '123456' })).status).toBe(422);
    expect((await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).status).toBe(204);
    expect(await provedAt(id)).toBeLessThan(60);
    await setUpTotp(browser);
    expect((await browser.get('/auth/proof')).body).toEqual({ methods: ['TOTP'] });
    await age(id, 3600);
    expect((await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).status).toBe(422);
    expect(await provedAt(id)).toBeGreaterThan(3000);
  });

  it('is that of this session alone, and prolongs nothing else', async () => {
    const { id, email, browser } = await colleague();
    const other = await signedIn(id, email);
    const before = await rows('SELECT token_hash, expires_at FROM user_sessions WHERE user_id = $1 ORDER BY id', [id]);
    await age(id, 3600);
    await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD });
    expect(await rows("SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1 AND proved_at > now() - interval '1 minute'", [id])).toEqual([{ n: 1 }]);
    expect(await rows('SELECT token_hash, expires_at FROM user_sessions WHERE user_id = $1 ORDER BY id', [id])).toEqual(before);
    expect((await other.session()).status).toBe(200);
  });

  it('is a backup code, once, or the code of the application, once', async () => {
    const { browser } = await colleague();
    const { key, backupCodes } = await setUpTotp(browser);
    const [code] = backupCodes;
    expect((await browser.post('/auth/proof', { method: 'BACKUP_CODE', code })).status).toBe(204);
    expect((await browser.post('/auth/proof', { method: 'BACKUP_CODE', code })).status).toBe(422);
    expect((await browser.post('/auth/proof', { method: 'TOTP', code: codeOf(key) })).status).toBe(204);
    expect((await browser.post('/auth/proof', { method: 'TOTP', code: codeOf(key) })).status).toBe(422);
  });

  it('is a security key, for a challenge of this session, once', async () => {
    const { browser } = await colleague();
    const authenticator = new Authenticator(ORIGINS.staff);
    const { challenge } = (await browser.post('/account/two-factor/webauthn')).body as { challenge: string };
    expect((await browser.post('/account/two-factor/webauthn/verify', authenticator.register(challenge))).status).toBe(200);
    const asked = (await browser.post('/auth/proof/webauthn')).body as { challenge: string };
    const response = authenticator.authenticate(asked.challenge);
    const stranger = (await colleague()).browser;
    expect((await stranger.post('/auth/proof', { method: 'WEBAUTHN', response })).status).toBe(422);
    expect((await browser.post('/auth/proof', { method: 'WEBAUTHN', response })).status).toBe(204);
    expect((await browser.post('/auth/proof', { method: 'WEBAUTHN', response })).status).toBe(422);
  });

  it('given wrong five times closes the session, and the account is not tried any more', async () => {
    const { id, email, browser } = await colleague();
    const wrong = () => browser.post('/auth/proof', { method: 'PASSWORD', password: 'faux' });
    for (const left of [4, 3, 2, 1]) expect(await wrong()).toMatchObject({ status: 422, body: { code: 'INVALID_PROOF', attemptsLeft: left } });
    expect(await wrong()).toMatchObject({ status: 423, body: { code: 'LOCKED', closed: true } });
    expect((await browser.session()).status).toBe(401);
    const again = await signedIn(id, email);
    expect(await again.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).toMatchObject({ status: 423, body: { closed: false } });
    // Locked by the failures, this one is not closed: the good password was given.
    expect((await again.session()).status).toBe(200);
    expect(await rows("SELECT action FROM audit_log WHERE actor_id = $1 AND action IN ('PROOF_REFUSED', 'ACCOUNT_LOCKED') ORDER BY occurred_at", [id])).toEqual(
      [...Array.from({ length: 4 }, () => ({ action: 'PROOF_REFUSED' })), { action: 'ACCOUNT_LOCKED' }],
    );
  });

  it('counts with the failures of the sign-in for a code', async () => {
    const { id, email, browser } = await colleague();
    const { key } = await setUpTotp(browser);
    const pending = new Browser(test);
    await pending.login(email);
    for (let i = 0; i < 3; i += 1) await pending.post('/auth/two-factor', { method: 'TOTP', code: '000000' });
    expect(await browser.post('/auth/proof', { method: 'TOTP', code: '000000' })).toMatchObject({ body: { attemptsLeft: 1 } });
    expect((await browser.post('/auth/proof', { method: 'TOTP', code: codeOf(key) })).status).toBe(204);
    expect(await rows('SELECT 1 FROM lockouts')).toEqual([]);
    expect(await provedAt(id)).toBeLessThan(60);
  });

  it('proves nothing for a password reset, or a second factor set up, meanwhile', async () => {
    const { id, email, browser } = await colleague();
    const verify = CHEAP.verify.bind(CHEAP);
    const meanwhile = (work: () => Promise<unknown>) =>
      vi.spyOn(CHEAP, 'verify').mockImplementationOnce(async (hash, password) => {
        const same = await verify(hash, password);
        await work();
        return same;
      });
    await age(id, 3600);
    meanwhile(() => rows("UPDATE users SET password_hash = 'other' WHERE id = $1", [id]));
    expect((await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).status).toBe(422);
    await givePassword(test, id);
    meanwhile(() => rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [id]));
    expect((await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).status).toBe(422);
    await rows('DELETE FROM second_factors WHERE user_id = $1', [id]);
    meanwhile(() => rows('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1', [id]));
    expect((await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).status).toBe(401);
    expect((await signedIn(id, email)).token).toBeDefined();
  });

  it('is asked of nobody who is not signed in, and is written nowhere', async () => {
    expect((await new Browser(test).post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).status).toBe(401);
    const { browser } = await colleague();
    await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD });
    const everywhere = JSON.stringify([await rows('SELECT * FROM audit_log'), await rows('SELECT * FROM lockouts')]) + test.logs.join('');
    expect(everywhere).not.toContain(PASSWORD);
  });
});

describe('what surrounds a proof', () => {
  it('limits it by network, whatever comes of it', async () => {
    const { browser } = await colleague();
    const give = () => browser.post('/auth/proof', { method: 'TOTP', code: '123456' });
    for (let turn = 0; turn < 30; turn += 1) expect((await give()).status).toBe(422);
    expect(await give()).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
    for (let turn = 0; turn < 60; turn += 1) expect((await browser.post('/auth/proof/webauthn')).status).toBe(200);
    expect((await browser.post('/auth/proof/webauthn')).status).toBe(429);
  });

  it('counts no failure for the wrong kind of proof, nor for a password that will not be checked', async () => {
    const { browser } = await colleague();
    const password = { method: 'PASSWORD', password: PASSWORD };
    expect(await browser.post('/auth/proof', { method: 'BACKUP_CODE', code: 'x' })).toMatchObject({
      status: 422,
      body: { code: 'INVALID', fields: ['method'] },
    });
    vi.spyOn(CHEAP, 'refuseIfFull').mockImplementationOnce(() => {
      throw new ApiError(503, 'UNAVAILABLE');
    });
    expect((await browser.post('/auth/proof', password)).status).toBe(503);
    await setUpTotp(browser);
    expect(await browser.post('/auth/proof', password)).toMatchObject({ status: 422, body: { code: 'INVALID', fields: ['method'] } });
    expect(await rows('SELECT 1 FROM lockouts')).toEqual([]);
  });

  it('counts a password with the failures of its change, and notes the one that is given', async () => {
    const { id, browser } = await colleague();
    for (let turn = 0; turn < 3; turn += 1) await browser.change('/account/password', { current: 'faux', next: 'Un-nouveau-mot-de-passe-9!' });
    expect(await browser.post('/auth/proof', { method: 'PASSWORD', password: 'faux' })).toMatchObject({ body: { attemptsLeft: 1 } });
    expect(await rows('SELECT DISTINCT scope FROM lockouts')).toEqual([{ scope: 'PASSWORD' }]);
    expect((await browser.post('/auth/proof', { method: 'PASSWORD', password: PASSWORD })).status).toBe(204);
    expect(await rows("SELECT action FROM audit_log WHERE actor_id = $1 AND action LIKE 'PROOF%' ORDER BY occurred_at", [id])).toEqual([
      { action: 'PROOF_REFUSED' },
      { action: 'PROOF_GIVEN' },
    ]);
  });

  it('asks for it again when another second factor was set up while the code was typed', async () => {
    const { id, browser } = await colleague();
    const { key } = (await browser.post('/account/two-factor/totp')).body as { key: string };
    await age(id, 3600);
    const accounts = test.app.get(Accounts);
    const take = accounts.takeAttempt.bind(accounts);
    vi.spyOn(accounts, 'takeAttempt').mockImplementationOnce(async (...of) => {
      await rows(
        "INSERT INTO second_factors (user_id, kind, credential_id, public_key, sign_count, confirmed_at) VALUES ($1, 'WEBAUTHN', 'x', '\\x01', 0, now())",
        [id],
      );
      return take(...of);
    });
    expect(await browser.post('/account/two-factor/totp/verify', { code: codeOf(key) })).toMatchObject(REQUIRED);
    expect(await rows("SELECT 1 FROM second_factors WHERE user_id = $1 AND kind = 'TOTP' AND confirmed_at IS NOT NULL", [id])).toEqual([]);
  });
});
