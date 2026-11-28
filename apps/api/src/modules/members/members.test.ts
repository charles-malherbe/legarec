import { membersData, notificationItem, ROLE_LABELS, type Member } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startApp, type TestApp } from '../../../test/app';
import { Browser, emailOf, givePassword, newAccount } from '../../../test/browser';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import { AuthKeys } from '../auth/keys';

let test: TestApp;
let real: TestApp;
let worker: MailWorker;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
type As = 'director' | 'manager' | 'managerAlone' | 'developer' | 'officerA' | 'liar' | 'partnerA';
const call = (as: As, method: string, path: string, body?: unknown, key: string = randomUUID()) =>
  test.call(method, `/staff/members${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': key } });
const list = async (as: As) => membersData.parse((await call(as, 'GET', '')).body);
const find = async (id: string, as: As = 'director') => (await list(as)).members.find((member) => member.id === id) as Member;
const audited = (action: string, id: string) =>
  rows<{ actor_id: string; on_behalf_of_id: string | null; params: unknown }>(
    'SELECT actor_id, on_behalf_of_id, params FROM audit_log WHERE action = $1 AND entity_id = $2 ORDER BY occurred_at, id',
    [action, id],
  );
const told = (id: string) =>
  rows<{ user_id: string; action: string; actor_id: string }>(
    'SELECT user_id, action::text, actor_id FROM notifications WHERE target_id = $1 ORDER BY created_at, id',
    [id],
  );
const address = (domain = 'legarec.fr') => `m${randomUUID().slice(0, 12)}@${domain}`;
const newMember = (some: object = {}) => ({ firstName: 'Iris', lastName: 'Test', role: 'CLAIMS_OFFICER', email: address(), ...some });
const idOf = async (email: string) => (await rows<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]))[0]?.id;
let number = 900;
const newCase = async (officer: string) => {
  number += 1;
  const { s } = test;
  const [row] = await rows<{ id: string }>('INSERT INTO cases (reference, creditor_id, debtor_id, officer_id) VALUES ($1, $2, $3, $4) RETURNING id', [
    `LGR-2026-${String(number).padStart(5, '0')}`,
    s.creditorA,
    (await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'Débiteur') RETURNING id"))[0]!.id,
    officer,
  ]);
  return row!.id;
};

beforeAll(async () => {
  test = await startApp();
  // The same people, with real sessions: what is done to an account shows there.
  real = await startApp([], {
    sessions: true,
    next: test,
    env: { VAULT_MASTER_KEY: test.config.VAULT_MASTER_KEY, SESSION_SIGNING_KEY: test.config.SESSION_SIGNING_KEY },
  });
  worker = startMailWorker(test);
  await givePassword(test, test.s.director, test.s.manager, test.s.developer, test.s.officerA, test.s.officerB, test.s.partnerA);
});
beforeEach(async () => {
  await rows('DELETE FROM notifications');
  await rows('DELETE FROM lockouts');
  // Ended by a test, or by a delegate.
  await rows(
    "INSERT INTO delegations (kind, granted_by) SELECT 'TECHNICAL', $1 WHERE NOT EXISTS (SELECT 1 FROM delegations WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL)",
    [test.s.director],
  );
});
afterAll(async () => {
  await worker.stop();
  await real.stop();
  await test.stop();
});
const signedIn = async (email: string, portal: 'staff' | 'partner' = 'staff') => {
  const browser = new Browser(real, portal);
  expect((await browser.login(email)).body).toMatchObject({ status: 'OK' });
  return browser;
};

describe('team', () => {
  it('shows each role what it may see, and do', async () => {
    const { s } = test;
    const director = await list('director');
    expect(director).toMatchObject({ canInvite: true, canDisable: true, canSupport: true, canEditExtension: false });
    expect(director.creditors.map((creditor) => creditor.name)).toEqual(['Créancier ALPHA-MARK', 'Créancier BETA-MARK']);
    expect(await list('manager')).toMatchObject({ canInvite: true, canDisable: true, canSupport: true, canEditExtension: false });
    expect(await list('managerAlone')).toMatchObject({ canInvite: false, canDisable: false, canSupport: false, canEditExtension: false, creditors: [] });
    const developer = await list('developer');
    expect(developer).toMatchObject({ canInvite: false, canDisable: false, canSupport: true, canEditExtension: true, creditors: [] });
    const ids = (data: typeof director) => data.members.map((member) => member.id);
    expect(ids(director)).toEqual(expect.arrayContaining([s.director, s.manager, s.developer, s.officerA, s.officerB, s.partnerA, s.partnerB]) as unknown);
    expect(ids(developer)).toEqual(expect.arrayContaining([s.director, s.manager, s.developer, s.officerA, s.officerB]) as unknown);
    for (const creditor of [s.partnerA, s.partnerB]) expect(ids(developer)).not.toContain(creditor);
    expect(JSON.stringify(developer)).not.toMatch(/ALPHA-MARK|BETA-MARK/u);
  });

  it('counts the cases for those who may read them: none for the Developer', async () => {
    const { s } = test;
    expect((await find(s.officerA)).cases).toBe(1);
    expect((await find(s.officerA, 'manager')).cases).toBe(1);
    // Those of the Director are not read by the manager.
    expect((await find(s.director)).cases).toBe(1);
    expect((await find(s.director, 'manager')).cases).toBe(0);
    expect((await find(s.officerA, 'developer')).cases).toBe(0);
  });

  it('shows second factor, sessions and lock', async () => {
    const { id, email } = await newAccount(test);
    expect(await find(id)).toMatchObject({ twoFactor: false, sessions: 0, locked: false, lastSeen: 'Aucune connexion', status: 'ACTIVE' });
    await signedIn(email);
    await signedIn(email);
    expect(await find(id)).toMatchObject({ sessions: 2, lastSeen: 'En ligne' });
    for (let i = 0; i < 5; i += 1) await new Browser(real).login(email, 'faux-mot-de-passe');
    expect(await find(id)).toMatchObject({ locked: true });
    expect(await find(test.s.officerB)).toMatchObject({ locked: false });
    await rows("UPDATE user_sessions SET last_seen_at = now() - interval '31 minutes' WHERE user_id = $1", [id]);
    await rows("UPDATE users SET last_seen_at = now() - interval '31 minutes' WHERE id = $1", [id]);
    expect(await find(id)).toMatchObject({ sessions: 0, lastSeen: 'Il y a 31 min' });
  });

  it('says when each was last seen: online with an open session only', async () => {
    const { id, email } = await newAccount(test);
    const seen = async () => (await find(id)).lastSeen;
    const browser = await signedIn(email);
    expect(await seen()).toBe('En ligne');
    await rows("UPDATE users SET last_seen_at = now() - interval '6 minutes' WHERE id = $1", [id]);
    expect(await seen()).toBe('Il y a 6 min');
    await rows('UPDATE users SET last_seen_at = now() WHERE id = $1', [id]);
    expect(await seen()).toBe('En ligne');
    // Gone a moment ago.
    await browser.post('/auth/logout');
    expect(await seen()).toBe('À l’instant');
    await rows("UPDATE users SET status = 'INVITED', invited_at = NULL WHERE id = $1", [id]);
    expect(await seen()).toBe('Invitation en attente');
    await rows("UPDATE users SET invited_at = now() - interval '3 minutes' WHERE id = $1", [id]);
    expect(await seen()).toBe('Invitation : il y a 3 min');
  });

  it('shows the lock of the second factor as that of the password, and no session that is not complete', async () => {
    const { id, email } = await newAccount(test);
    await rows("INSERT INTO second_factors (user_id, kind, secret_cipher) VALUES ($1, 'TOTP', '\\x00')", [id]);
    // Being set up: not yet a second factor.
    expect(await find(id)).toMatchObject({ twoFactor: false, locked: false });
    await rows('UPDATE second_factors SET confirmed_at = now() WHERE user_id = $1', [id]);
    expect((await new Browser(real).login(email)).body).toMatchObject({ status: 'TWO_FACTOR' });
    expect(await find(id)).toMatchObject({ twoFactor: true, sessions: 0, lastSeen: 'Aucune connexion' });
    const lock = (until: string) =>
      rows(
        `INSERT INTO lockouts (key_hash, scope, failures, locked_until) VALUES ($1, 'SECOND_FACTOR', 5, ${until}) ON CONFLICT (key_hash) DO UPDATE SET locked_until = ${until}`,
        [new AuthKeys(test.config).attempt('second-factor', id)],
      );
    await lock("now() + interval '1 minute'");
    expect(await find(id)).toMatchObject({ locked: true });
    await lock("now() - interval '1 minute'");
    expect(await find(id)).toMatchObject({ locked: false });
  });

  it('proposes the creditors under mandate only, to those who invite', async () => {
    await rows("UPDATE creditors SET status = 'ENDED' WHERE id = $1", [test.s.creditorB]);
    try {
      for (const as of ['director', 'manager'] as const) expect((await list(as)).creditors.map((creditor) => creditor.name)).toEqual(['Créancier ALPHA-MARK']);
      for (const as of ['managerAlone', 'developer'] as const) expect((await list(as)).creditors).toEqual([]);
    } finally {
      await rows("UPDATE creditors SET status = 'ACTIVE' WHERE id = $1", [test.s.creditorB]);
    }
  });

  it('shows three actions of each at most, the latest first', async () => {
    const { id, email } = await newAccount(test);
    for (let i = 0; i < 4; i += 1) await signedIn(email);
    // What a stranger tried is not an action of the account.
    await new Browser(real).login(email, 'faux-mot-de-passe');
    const activity = async () => (await find(id)).activity.map((entry) => entry.what);
    expect(await activity()).toEqual(['Connexion réussie', 'Connexion réussie', 'Connexion réussie']);
    await (await signedIn(email)).delete('/account/sessions');
    expect(await activity()).toEqual(['Sessions fermées : 4', 'Connexion réussie', 'Connexion réussie']);
  });

  it('shows the last actions of each to the Director and the Developer, as sentences, and to nobody else', async () => {
    const { id, email } = await newAccount(test);
    await signedIn(email);
    const expected = [{ what: 'Connexion réussie', when: 'À l’instant' }];
    expect((await find(id)).activity).toEqual(expected);
    expect((await find(id, 'developer')).activity).toEqual(expected);
    expect((await find(id, 'manager')).activity).toEqual([]);
  });

  it('leaves out an account that is nobody any more', async () => {
    const { id } = await newAccount(test, { status: 'DISABLED' });
    expect(await find(id)).toMatchObject({ status: 'DISABLED' });
    await rows('UPDATE users SET anonymized_at = now() WHERE id = $1', [id]);
    expect(await find(id)).toBeUndefined();
  });

  it('is out of reach of a creditor, and believes no announced role', async () => {
    expect((await call('partnerA', 'GET', '')).status).toBe(403);
    expect((await call('officerA', 'GET', '')).status).toBe(403);
    const liar = await list('liar');
    // PostgreSQL knows a claims officer: neither state nor journal, and the creditors of their own cases only.
    expect(liar.members.every((member) => !member.twoFactor && member.sessions === 0 && member.activity.length === 0)).toBe(true);
    expect(JSON.stringify(liar)).not.toContain('BETA-MARK');
  });
});

describe('invitation', () => {
  it('creates the account, notes it, and for the manager on behalf of the Director', async () => {
    const { s } = test;
    const body = newMember();
    expect((await call('director', 'POST', '', body)).status).toBe(204);
    const id = (await idOf(body.email))!;
    expect(await find(id)).toMatchObject({ status: 'INVITED', role: 'CLAIMS_OFFICER', lastSeen: 'Invitation : à l’instant', creditor: null });
    expect(await audited('MEMBER_INVITED', id)).toEqual([{ actor_id: s.director, on_behalf_of_id: null, params: { role: 'CLAIMS_OFFICER' } }]);
    const other = newMember();
    expect((await call('manager', 'POST', '', other)).status).toBe(204);
    expect(await audited('MEMBER_INVITED', (await idOf(other.email))!)).toEqual([
      { actor_id: s.manager, on_behalf_of_id: s.director, params: { role: 'CLAIMS_OFFICER' } },
    ]);
  });

  it('ties a creditor account to its creditor', async () => {
    const body = newMember({ role: 'CREDITOR', email: address('client.test'), creditorId: test.s.creditorB });
    expect((await call('director', 'POST', '', body)).status).toBe(204);
    expect(await find((await idOf(body.email))!)).toMatchObject({ role: 'CREDITOR', creditor: 'Créancier BETA-MARK' });
    for (const creditorId of [randomUUID(), 'x'])
      expect((await call('director', 'POST', '', newMember({ role: 'CREDITOR', email: address('client.test'), creditorId }))).status, creditorId).toBeOneOf([
        404, 422,
      ]);
  });

  it('is sent once, however many clicks', async () => {
    const body = newMember();
    const key = randomUUID();
    const answers = await Promise.all([1, 2, 3].map(() => call('director', 'POST', '', body, key)));
    expect(answers.map((answer) => answer.status)).toEqual([204, 204, 204]);
    expect(await rows('SELECT 1 FROM users WHERE email = $1', [body.email])).toHaveLength(1);
  });

  it('refuses an address already taken, whatever its case, and whoever holds it', async () => {
    const email = await emailOf(test, test.s.officerA);
    const twice = newMember({ role: 'CREDITOR', email, creditorId: test.s.creditorA });
    expect(await call('director', 'POST', '', twice)).toMatchObject({ status: 409, body: { code: 'EMAIL_TAKEN' } });
    expect(await call('director', 'POST', '', { ...twice, email: email.toUpperCase() })).toMatchObject({ status: 409, body: { code: 'EMAIL_TAKEN' } });
    const same = newMember();
    const answers = await Promise.all([call('director', 'POST', '', same), call('manager', 'POST', '', same)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 409]);
  });

  it.each(['DIRECTOR', 'COLLECTION_MANAGER', 'DEVELOPER'] as const)('refuses a second %s, and names the one in place', async (role) => {
    const holder = { DIRECTOR: 'Dora Test', COLLECTION_MANAGER: 'Remi Test', DEVELOPER: 'Devon Test' }[role];
    expect(await call('director', 'POST', '', newMember({ role }))).toMatchObject({
      status: 409,
      body: { code: 'ROLE_TAKEN', role: ROLE_LABELS[role], holder },
    });
  });

  it('gives a unique role to one of those invited at the same time', async () => {
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.developer]);
    try {
      const answers = await Promise.all([1, 2, 3, 4].map(() => call('director', 'POST', '', newMember({ role: 'DEVELOPER' }))));
      expect(answers.map((answer) => answer.status).sort()).toEqual([204, 409, 409, 409]);
      const [invited] = await rows<{ id: string; two_factor_required: boolean }>(
        "SELECT id, two_factor_required FROM users WHERE role = 'DEVELOPER' AND status = 'INVITED'",
      );
      expect(invited!.two_factor_required).toBe(true);
      expect((await call('director', 'DELETE', `/${invited!.id}`)).status).toBe(204);
    } finally {
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [test.s.developer]);
    }
  });

  it.each(['recouvrement@legarec.fr', 'RECOUVREMENT@legarec.fr', 'x@autre.fr', 'x@legarec.fr.autre.fr', 'pas-une-adresse'])(
    'refuses to a collaborator the address %s',
    async (email) => {
      expect(await call('director', 'POST', '', newMember({ email }))).toMatchObject({ status: 422, body: { code: 'INVALID', fields: ['email'] } });
    },
  );

  it('is cancelled without leaving anything', async () => {
    const body = newMember();
    await call('director', 'POST', '', body);
    const id = (await idOf(body.email))!;
    expect((await call('manager', 'DELETE', `/${id}`)).status).toBe(204);
    expect(await rows('SELECT 1 FROM users WHERE id = $1 UNION ALL SELECT 1 FROM mailbox_requests WHERE user_id = $1', [id])).toEqual([]);
    expect(await audited('INVITATION_CANCELLED', id)).toEqual([
      { actor_id: test.s.manager, on_behalf_of_id: test.s.director, params: { role: 'CLAIMS_OFFICER' } },
    ]);
    for (const other of [id, test.s.officerA, randomUUID(), 'x']) expect((await call('director', 'DELETE', `/${other}`)).status, other).toBe(404);
    // The address may be invited again.
    expect((await call('director', 'POST', '', body)).status).toBe(204);
  });
});

describe('disabling', () => {
  const disable = (as: As, id: string, cases = 0) => call(as, 'POST', `/${id}/disable`, { reason: 'Départ du cabinet', cases });

  it('closes what is open, releases the cases, and tells the history', async () => {
    const { s } = test;
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const [first, second] = [await newCase(id), await newCase(id)];
    await rows('UPDATE users SET substitute_id = $1 WHERE id = $2', [id, s.officerB]);
    await rows('UPDATE users SET recent_case_ids = $1 WHERE id = $2', [[first, second], id]);
    expect((await disable('manager', id, 2)).status).toBe(204);
    expect((await browser.session()).status).toBe(401);
    expect((await new Browser(real).login(email)).status).toBe(401);
    expect(await rows('SELECT status::text, disabled_by, disabled_reason FROM users WHERE id = $1', [id])).toEqual([
      { status: 'DISABLED', disabled_by: s.manager, disabled_reason: 'Départ du cabinet' },
    ]);
    expect(await rows('SELECT officer_id FROM cases WHERE id = ANY ($1::uuid[])', [[first, second]])).toEqual([{ officer_id: null }, { officer_id: null }]);
    expect(await rows('SELECT kind, title, actor_label, on_behalf_of_id, visible_to_creditor FROM case_events WHERE case_id = $1', [first])).toEqual([
      { kind: 'CASE_RELEASED', title: 'Dossier sans gestionnaire', actor_label: 'Remi Test', on_behalf_of_id: s.director, visible_to_creditor: false },
    ]);
    expect(await rows('SELECT substitute_id FROM users WHERE id = $1', [s.officerB])).toEqual([{ substitute_id: null }]);
    // The last cases it opened go with it (DECISIONS.md, 28/11/2026).
    expect(await rows('SELECT cardinality(recent_case_ids) AS kept FROM users WHERE id = $1', [id])).toEqual([{ kept: 0 }]);
    expect(await audited('MEMBER_DISABLED', id)).toEqual([{ actor_id: s.manager, on_behalf_of_id: s.director, params: { role: 'CLAIMS_OFFICER' } }]);
    // The reason stays with the account, out of the journal and of the list.
    expect(JSON.stringify([await list('director'), await rows('SELECT * FROM audit_log')])).not.toContain('Départ du cabinet');
    expect((await disable('director', id)).status).toBe(404);
  });

  it('does nothing when the number of cases has changed since the confirmation', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const held = await newCase(id);
    expect(await disable('director', id, 0)).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    expect(await rows('SELECT officer_id FROM cases WHERE id = $1', [held])).toEqual([{ officer_id: id }]);
    expect(await rows('SELECT 1 FROM case_events WHERE case_id = $1', [held])).toEqual([]);
    expect((await browser.session()).status).toBe(200);
    expect(await audited('MEMBER_DISABLED', id)).toEqual([]);
    expect((await disable('director', id, 1)).status).toBe(204);
  });

  it('never applies to the Director, to oneself, nor without the right', async () => {
    const { s } = test;
    const { id } = await newAccount(test);
    for (const [as, target] of [
      ['manager', s.director],
      ['director', s.director],
      ['manager', s.manager],
      ['managerAlone', id],
      ['developer', id],
      ['officerA', id],
      ['liar', id],
    ] as const)
      expect((await disable(as, target)).status, `${as} ${target}`).toBe(403);
    expect(await rows("SELECT 1 FROM users WHERE status = 'DISABLED' AND id = ANY ($1::uuid[])", [[s.director, s.manager, id]])).toEqual([]);
    expect((await disable('director', randomUUID())).status).toBe(404);
    expect((await call('director', 'POST', `/${id}/disable`, { reason: ' ', cases: 0 })).status).toBe(422);
  });

  it('is done once, by one of those who ask at the same time', async () => {
    const { id } = await newAccount(test);
    const held = await newCase(id);
    const answers = await Promise.all([disable('director', id, 1), disable('manager', id, 1), disable('director', id, 1)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 404, 404]);
    expect(await audited('MEMBER_DISABLED', id)).toHaveLength(1);
    expect(await rows('SELECT 1 FROM case_events WHERE case_id = $1', [held])).toHaveLength(1);
    const back = await Promise.all([1, 2, 3].map(() => call('director', 'POST', `/${id}/enable`)));
    expect(back.filter((answer) => answer.status === 204)).toHaveLength(1);
    expect(await audited('MEMBER_ENABLED', id)).toHaveLength(1);
  });

  it('closes for good: nothing that was open comes back with the account', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    await new Browser(real).post('/auth/forgot-password', { email });
    const [mail] = (await worker.run()).filter((item) => item.name === 'staff-password-reset' && item.to === email);
    const token = /\/reinitialisation\/([\w-]{43})/u.exec(mail!.html)![1]!;
    expect((await new Browser(real).get(`/auth/reset/${token}`)).status).toBe(200);
    expect((await disable('director', id)).status).toBe(204);
    expect((await call('director', 'POST', `/${id}/enable`)).status).toBe(204);
    expect((await browser.session()).status).toBe(401);
    expect((await new Browser(real).get(`/auth/reset/${token}`)).status).toBe(410);
    expect(await rows('SELECT 1 FROM user_devices WHERE user_id = $1', [id])).toEqual([]);
    await signedIn(email);
  });

  it('closes the portal of a creditor account', async () => {
    const account = await newAccount(test, { role: 'CREDITOR', creditorId: test.s.creditorA });
    const browser = await signedIn(account.email, 'partner');
    expect((await disable('director', account.id)).status).toBe(204);
    expect((await browser.session()).status).toBe(401);
  });

  it('is undone without the former cases', async () => {
    const { id, email } = await newAccount(test);
    await newCase(id);
    await disable('director', id, 1);
    expect((await call('manager', 'POST', `/${id}/enable`)).status).toBe(204);
    expect(await find(id)).toMatchObject({ status: 'ACTIVE', cases: 0 });
    expect(await rows('SELECT disabled_at, disabled_by, disabled_reason FROM users WHERE id = $1', [id])).toEqual([
      { disabled_at: null, disabled_by: null, disabled_reason: null },
    ]);
    await signedIn(email);
    expect(await audited('MEMBER_ENABLED', id)).toHaveLength(1);
    expect((await call('director', 'POST', `/${id}/enable`)).status).toBe(403);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now(), anonymized_at = now() WHERE id = $1", [id]);
    expect((await call('director', 'POST', `/${id}/enable`)).status).toBe(404);
  });

  it('is undone neither when the role has been taken, nor twice', async () => {
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.developer]);
    const next = await newAccount(test, { role: 'DEVELOPER' });
    try {
      expect(await call('director', 'POST', `/${test.s.developer}/enable`)).toMatchObject({ status: 409, body: { code: 'ROLE_TAKEN', holder: 'Nora Test' } });
    } finally {
      await rows('DELETE FROM users WHERE id = $1', [next.id]);
      expect((await call('director', 'POST', `/${test.s.developer}/enable`)).status).toBe(204);
    }
  });

  it('sends nothing when it is undone for a collaborator, nor for an account that was open', async () => {
    const never = newMember();
    await call('director', 'POST', '', never);
    const open = await newAccount(test, { role: 'CREDITOR', creditorId: test.s.creditorA });
    await worker.run();
    for (const id of [(await idOf(never.email))!, open.id]) {
      await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
      expect((await call('director', 'POST', `/${id}/enable`)).status).toBe(204);
    }
    expect(await find((await idOf(never.email))!)).toMatchObject({ status: 'INVITED' });
    expect(await find(open.id)).toMatchObject({ status: 'ACTIVE' });
    expect(await worker.run()).toEqual([]);
  });

  it('is undone by a new invitation when the account had never been opened', async () => {
    const body = newMember({ role: 'CREDITOR', email: address('client.test'), creditorId: test.s.creditorA });
    await call('director', 'POST', '', body);
    await worker.run();
    const id = (await idOf(body.email))!;
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
    expect((await call('director', 'POST', `/${id}/enable`)).status).toBe(204);
    expect(await find(id)).toMatchObject({ status: 'INVITED' });
    expect((await worker.run()).map((mail) => [mail.name, mail.to])).toEqual([['creditor-invitation', body.email]]);
  });
});

describe('role', () => {
  const change = (as: As, id: string, role: string) => call(as, 'PUT', `/${id}/role`, { role });

  it('changes with everything that went with the former one', async () => {
    const { s } = test;
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.developer]);
    const { id, email } = await newAccount(test);
    const held = await newCase(id);
    const browser = await signedIn(email);
    try {
      expect((await change('manager', id, 'DEVELOPER')).status).toBe(204);
      expect((await browser.session()).status).toBe(401);
      expect(await rows('SELECT officer_id FROM cases WHERE id = $1', [held])).toEqual([{ officer_id: null }]);
      expect(await find(id)).toMatchObject({ role: 'DEVELOPER', twoFactorRequired: true, cases: 0 });
      expect(await audited('MEMBER_ROLE_CHANGED', id)).toEqual([
        { actor_id: s.manager, on_behalf_of_id: s.director, params: { from: 'CLAIMS_OFFICER', to: 'DEVELOPER' } },
      ]);
      expect((await new Browser(real).login(email)).body).toEqual({ status: 'SETUP_REQUIRED' });
      // The same role: nothing to do, nothing to note.
      expect((await change('director', id, 'DEVELOPER')).status).toBe(204);
      expect(await audited('MEMBER_ROLE_CHANGED', id)).toHaveLength(1);
      expect((await change('director', id, 'CLAIMS_OFFICER')).status).toBe(204);
    } finally {
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.developer]);
    }
  });

  it('never changes for the Director, a creditor, oneself, or an account that is not open', async () => {
    const { s } = test;
    const invited = await newAccount(test, { status: 'INVITED' });
    for (const [as, target] of [
      ['director', s.director],
      ['manager', s.director],
      ['director', s.partnerA],
      ['manager', s.manager],
      ['director', invited.id],
    ] as const)
      expect((await change(as, target, 'CLAIMS_OFFICER')).status, `${as} ${target}`).toBe(403);
    expect((await change('director', s.officerA, 'CREDITOR')).status).toBe(422);
    expect((await change('director', randomUUID(), 'CLAIMS_OFFICER')).status).toBe(404);
  });

  it('gives a unique role to one of those who receive it at the same time', async () => {
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.developer]);
    const accounts = await Promise.all([1, 2, 3].map(() => newAccount(test)));
    const ids = accounts.map((item) => item.id);
    try {
      const answers = await Promise.all(ids.map((id) => change('director', id, 'DEVELOPER')));
      expect(answers.map((answer) => answer.status).sort()).toEqual([204, 409, 409]);
      const holders = await rows<{ id: string; two_factor_required: boolean }>(
        "SELECT id, two_factor_required FROM users WHERE role = 'DEVELOPER' AND status = 'ACTIVE'",
      );
      expect(holders).toEqual([{ id: expect.toBeOneOf(ids) as string, two_factor_required: true }]);
      // Those who did not receive it keep everything of theirs, and nothing is noted.
      expect(await rows("SELECT 1 FROM audit_log WHERE action = 'MEMBER_ROLE_CHANGED' AND entity_id = ANY ($1::uuid[])", [ids])).toHaveLength(1);
    } finally {
      await rows("UPDATE users SET role = 'CLAIMS_OFFICER' WHERE id = ANY ($1::uuid[])", [ids]);
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [test.s.developer]);
    }
  });

  it('given again as it is, closes and releases nothing', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const held = await newCase(id);
    expect((await change('director', id, 'CLAIMS_OFFICER')).status).toBe(204);
    expect((await browser.session()).status).toBe(200);
    expect(await rows('SELECT officer_id FROM cases WHERE id = $1', [held])).toEqual([{ officer_id: id }]);
    expect(await audited('MEMBER_ROLE_CHANGED', id)).toEqual([]);
  });

  it('refuses a second holder, and the manager cannot make themselves Director', async () => {
    const { s } = test;
    for (const role of ['DIRECTOR', 'COLLECTION_MANAGER', 'DEVELOPER'])
      expect(await change('manager', s.officerB, role)).toMatchObject({ status: 409, body: { code: 'ROLE_TAKEN' } });
    expect(await change('manager', s.manager, 'DIRECTOR')).toMatchObject({ status: 403 });
    expect(await rows('SELECT role::text FROM users WHERE id = ANY ($1::uuid[]) ORDER BY 1', [[s.manager, s.officerB]])).toEqual([
      { role: 'CLAIMS_OFFICER' },
      { role: 'COLLECTION_MANAGER' },
    ]);
  });
});

describe('telephone extension', () => {
  const set = (as: As, id: string, extension: unknown) => call(as, 'PUT', `/${id}/extension`, { extension });

  it('is set by the Developer, on behalf of the Director', async () => {
    const { s } = test;
    expect((await set('developer', s.officerA, '118')).status).toBe(204);
    expect(await find(s.officerA)).toMatchObject({ extension: '118' });
    expect(await audited('MEMBER_EXTENSION_CHANGED', s.officerA)).toEqual([{ actor_id: s.developer, on_behalf_of_id: s.director, params: {} }]);
    expect((await set('developer', s.officerA, null)).status).toBe(204);
    expect(await find(s.officerA)).toMatchObject({ extension: null });
  });

  it('is refused to the others, to a creditor account, and out of format', async () => {
    const { s } = test;
    for (const as of ['director', 'manager', 'officerA', 'liar'] as const) expect((await set(as, s.officerB, '118')).status, as).toBe(403);
    expect((await set('developer', s.partnerA, '118')).status).toBe(404);
    for (const extension of ['1', '1234567', '11a', '', '+33']) expect((await set('developer', s.officerA, extension)).status, extension).toBe(422);
  });
});

describe('support', () => {
  const support = (as: As, id: string, action: string) => call(as, 'POST', `/${id}/${action}`);
  const ACTIONS = {
    'reset-link': 'RESET_LINK',
    'require-2fa': 'SECOND_FACTOR_REQUIRED',
    'reset-2fa': 'SECOND_FACTOR_RESET',
    unlock: 'ACCOUNT_UNLOCKED',
  } as const;
  type Target = 'director' | 'manager' | 'developer' | 'officerB' | 'partnerA';
  const all = Object.keys(ACTIONS);
  /** What each one may do for each account; whatever is not here is refused. */
  const allowed: Record<string, Partial<Record<Target, string[]>>> = {
    director: { manager: all, developer: all.filter((action) => action !== 'require-2fa'), officerB: all, partnerA: all },
    // The Developer: the whole team, Director included, but the account of a creditor and their own.
    developer: { director: ['reset-link', 'reset-2fa', 'unlock'], manager: all, officerB: all },
    // The manager: everyone but the Director; second factors are those of the creditors only.
    manager: { developer: ['reset-link', 'unlock'], officerB: ['reset-link', 'require-2fa', 'unlock'], partnerA: all },
    managerAlone: {},
    officerA: {},
    liar: {},
  };
  /** Something to unlock, something to reset, something to require. */
  const prepare = async (id: string) => {
    await rows(
      "INSERT INTO lockouts (key_hash, scope, failures, locked_until) VALUES ($1, 'SECOND_FACTOR', 5, now() + interval '15 minutes') ON CONFLICT DO NOTHING",
      [new AuthKeys(test.config).attempt('second-factor', id)],
    );
    await rows('DELETE FROM second_factors WHERE user_id = $1', [id]);
    await rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [id]);
    await rows('UPDATE users SET two_factor_required = false WHERE id = $1', [id]);
  };
  const cases = Object.keys(allowed).flatMap((as) =>
    (['director', 'manager', 'developer', 'officerB', 'partnerA'] as const).flatMap((target) => all.map((action) => [as as As, target, action] as const)),
  );
  it.each(cases)('%s, for %s: %s', async (as, target, action) => {
    const id = test.s[target];
    await prepare(id);
    const before = (await told(id)).length;
    const may = allowed[as]![target]?.includes(action) === true;
    // The accounts of the creditors do not exist for the Developer; what is always required of the latter is not required again.
    const refusal =
      as === 'developer' && target === 'partnerA'
        ? 404
        : target === 'developer' && action === 'require-2fa' && (as === 'director' || as === 'manager')
          ? 409
          : 403;
    expect((await support(as, id, action)).status).toBe(may ? 204 : refusal);
    const notices = (await told(id)).slice(before);
    const actorId = { director: test.s.director, manager: test.s.manager, developer: test.s.developer }[as as 'director'];
    // Told to the Director, in the application, whenever someone else does it.
    expect(notices).toEqual(may && as !== 'director' ? [{ user_id: test.s.director, action: ACTIONS[action as keyof typeof ACTIONS], actor_id: actorId }] : []);
    const noted = await rows<{ on_behalf_of_id: string | null }>(
      "SELECT on_behalf_of_id FROM audit_log WHERE entity_id = $1 AND actor_id = $2 AND occurred_at > now() - interval '5 seconds' ORDER BY occurred_at DESC, id DESC LIMIT 1",
      [id, actorId ?? randomUUID()],
    );
    if (may) expect(noted).toEqual([{ on_behalf_of_id: as === 'director' ? null : test.s.director }]);
    await rows('UPDATE users SET two_factor_required = (role = $1) WHERE id = $2', ['DEVELOPER', id]);
    await rows('DELETE FROM second_factors WHERE user_id = $1', [id]);
  });

  it('is refused for an account that is not open, or does not exist', async () => {
    for (const status of ['INVITED', 'DISABLED']) {
      const { id } = await newAccount(test, { status });
      for (const action of all) expect((await support('director', id, action)).status, `${status} ${action}`).toBe(403);
    }
    for (const id of [randomUUID(), 'x']) expect((await support('director', id, 'unlock')).status).toBe(404);
  });

  it('unlocks that account, and no other', async () => {
    const [first, second] = [await newAccount(test), await newAccount(test)];
    for (const { email } of [first, second]) for (let i = 0; i < 5; i += 1) await new Browser(real).login(email, 'faux-mot-de-passe');
    const keys = new AuthKeys(test.config);
    await rows("INSERT INTO lockouts (key_hash, scope, failures, locked_until) VALUES ($1, 'SECOND_FACTOR', 5, now() + interval '15 minutes')", [
      keys.attempt('second-factor', first.id),
    ]);
    expect((await new Browser(real).login(first.email)).status).toBe(423);
    expect((await support('developer', first.id, 'unlock')).status).toBe(204);
    await signedIn(first.email);
    expect((await new Browser(real).login(second.email)).status).toBe(423);
    expect(await rows('SELECT 1 FROM lockouts WHERE locked_until IS NOT NULL')).toHaveLength(1);
  });

  it('resets the second factor, which closes the sessions', async () => {
    const { id, email } = await newAccount(test);
    const browser = await signedIn(email);
    const keys = new AuthKeys(test.config);
    await rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', $2, now())", [
      id,
      keys.vault.encrypt('JBSWY3DPEHPK3PXP', { table: 'second_factors', id: randomUUID(), column: 'secret_cipher' }),
    ]);
    await rows("INSERT INTO backup_codes (user_id, code_hash) VALUES ($1, 'x')", [id]);
    expect((await new Browser(real).login(email)).body).toMatchObject({ status: 'TWO_FACTOR' });
    expect((await support('developer', id, 'reset-2fa')).status).toBe(204);
    expect((await browser.session()).status).toBe(401);
    expect(await rows('SELECT 1 FROM second_factors WHERE user_id = $1 UNION ALL SELECT 1 FROM backup_codes WHERE user_id = $1', [id])).toEqual([]);
    await signedIn(email);
  });

  it('requires the second factor from the next sign-in', async () => {
    const { id, email } = await newAccount(test);
    expect((await support('manager', id, 'require-2fa')).status).toBe(204);
    expect(await find(id)).toMatchObject({ twoFactorRequired: true });
    expect((await new Browser(real).login(email)).body).toEqual({ status: 'SETUP_REQUIRED' });
  });

  it('sends the link to the address of the account only, and not once the delegation is withdrawn', async () => {
    const { id, email } = await newAccount(test);
    await worker.run();
    await support('developer', id, 'reset-link');
    const mails = await worker.run();
    expect(mails.map(({ name, to }) => ({ name, to }))).toEqual([{ name: 'staff-password-reset', to: email }]);
    await support('developer', id, 'reset-link');
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL");
    expect(await worker.run()).toEqual([]);
    expect((await support('developer', id, 'unlock')).status).toBe(403);
  });

  it('is done once, however many clicks', async () => {
    const { id } = await newAccount(test);
    await prepare(id);
    const key = randomUUID();
    await Promise.all([1, 2, 3].map(() => call('developer', 'POST', `/${id}/unlock`, undefined, key)));
    expect(await told(id)).toHaveLength(1);
    expect(await audited('ACCOUNT_UNLOCKED', id)).toHaveLength(1);
    expect((await test.call('POST', `/staff/members/${id}/unlock`, { as: 'developer' })).status).toBe(400);
  });

  it('reads as a sentence to the Director, whose own account is named as such', async () => {
    const { id } = await newAccount(test);
    await prepare(id);
    await prepare(test.s.director);
    await support('developer', id, 'unlock');
    await support('developer', test.s.director, 'reset-2fa');
    const read = z.array(notificationItem).parse((await test.call('GET', '/staff/notifications', { as: 'director' })).body);
    expect(read.map((item) => item.text)).toEqual([
      'Devon Test (Développeur) a réinitialisé la double authentification de votre compte',
      'Devon Test (Développeur) a débloqué le compte de Nora Test',
    ]);
    expect(read[0]).toMatchObject({ kind: 'SYSTEM', unread: true, day: 'TODAY', meta: 'Support des comptes', cta: 'Voir le journal' });
    expect((await test.call('GET', '/staff/notifications', { as: 'manager' })).body).toEqual([]);
  });
});
