import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORIGINS, startApp, type TestApp } from './app';
import { ElsewhereController, ForgottenController, SAMPLE_CONTROLLERS } from './sample.controller';

let test: TestApp;
beforeAll(async () => {
  test = await startApp(SAMPLE_CONTROLLERS);
});
afterAll(() => test.stop());
beforeEach(() => {
  test.logs.length = 0;
});

const keyed = (key: string = randomUUID()) => ({ headers: { 'idempotency-key': key } });
const rows = async <T extends object>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;

describe('access rules', () => {
  it('stop the API from starting without a rule, or outside the prefix of the portal', async () => {
    await expect(startApp([ForgottenController])).rejects.toThrow('GET /staff/forgotten');
    await expect(startApp([ElsewhereController])).rejects.toThrow('GET /partner/elsewhere');
  });

  it.each([
    ['nobody', undefined, 401],
    ['a creditor', 'partnerA', 403],
    ['a debtor', 'debtorA', 403],
    ['a collaborator', 'officerA', 200],
    ['the Developer', 'developer', 200],
  ])('answer %s on a staff route', async (_who, as, status) => {
    expect((await test.call('GET', '/staff/sample/cases', { as })).status).toBe(status);
  });
  it.each([
    ['/partner/sample/cases', 'officerA', 403],
    ['/partner/sample/cases', 'debtorA', 403],
    ['/partner/sample/cases', 'partnerA', 200],
    ['/debtor/sample/cases', 'partnerA', 403],
    ['/debtor/sample/cases', 'director', 403],
    ['/debtor/sample/cases', 'debtorA', 200],
    ['/public/sample', undefined, 200],
  ])('keep each portal apart: %s for %s', async (path, as, status) => {
    expect((await test.call('GET', path, { as })).status).toBe(status);
  });
  it('keep a role to its routes, and open the delegated ones to the delegate only', async () => {
    expect((await test.call('POST', '/staff/sample/number', { as: 'manager', ...keyed() })).status).toBe(403);
    expect((await test.call('POST', '/staff/sample/settings', { as: 'director' })).status).toBe(204);
    expect((await test.call('POST', '/staff/sample/settings', { as: 'manager' })).status).toBe(204);
    expect((await test.call('POST', '/staff/sample/settings', { as: 'managerAlone' })).status).toBe(403);
    expect((await test.call('POST', '/staff/sample/settings', { as: 'developer' })).status).toBe(403);
    const audit = await rows<{ actor_label: string; on_behalf_of_id: string | null }>(
      "SELECT actor_label, on_behalf_of_id FROM audit_log WHERE action = 'SETTING_CHANGED' ORDER BY occurred_at",
    );
    expect(audit).toEqual([
      { actor_label: 'Dora Test', on_behalf_of_id: null },
      { actor_label: 'Remi Test', on_behalf_of_id: test.s.director },
    ]);
  });
  it('never show a creditor the mark of another one', async () => {
    const a = JSON.stringify((await test.call('GET', '/partner/sample/cases', { as: 'partnerA' })).body);
    const b = JSON.stringify((await test.call('GET', '/partner/sample/cases', { as: 'partnerB' })).body);
    expect(a).toContain('ALPHA-MARK');
    expect(a).not.toContain('BETA-MARK');
    expect(b).not.toContain('ALPHA-MARK');
  });
  it('believe the table rather than the announced role', async () => {
    expect((await test.call('GET', '/staff/sample/cases', { as: 'liar' })).body).toHaveLength(1);
  });
  it('answer 404 for the case of someone else, as for an unknown one', async () => {
    const other = await test.call('GET', `/staff/sample/cases/${test.s.cases.ofB}`, { as: 'officerA' });
    const unknown = await test.call('GET', `/staff/sample/cases/${randomUUID()}`, { as: 'officerA' });
    expect([other.status, other.body]).toEqual([unknown.status, unknown.body]);
    expect(other.status).toBe(404);
  });
});

describe('origin of the request', () => {
  it.each([
    ['another portal', ORIGINS.partner],
    ['another site', 'https://exemple.test'],
    ['a look-alike', `${ORIGINS.staff}.exemple.test`],
    ['a file', 'null'],
  ])('refuses %s', async (_who, origin) => {
    const answer = await test.call('GET', '/staff/sample/cases', { as: 'officerA', headers: { origin } });
    expect(answer.status).toBe(403);
    expect(answer.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('refuses a change without any origin, and accepts the exact one', async () => {
    const base = await test.app.getUrl();
    const change = (headers: Record<string, string>) =>
      fetch(`${base}/staff/sample/settings`, { method: 'POST', headers: { 'x-test-actor': 'director', ...headers } });
    expect((await change({})).status).toBe(403);
    expect((await change({ origin: ORIGINS.staff })).status).toBe(204);
  });
  it('answers the preflight of its own portal only', async () => {
    const own = await test.call('OPTIONS', '/staff/sample/settings');
    expect(own.status).toBe(204);
    expect(own.headers.get('access-control-allow-origin')).toBe(ORIGINS.staff);
    expect(own.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
    expect((await test.call('OPTIONS', '/staff/sample/settings', { headers: { origin: ORIGINS.debtor } })).status).toBe(403);
  });
});

describe('bodies', () => {
  const post = (body: string, type: string) =>
    test.app.getUrl().then((base) =>
      fetch(`${base}/staff/sample/cases/${test.s.cases.ofA}/notes`, {
        method: 'POST',
        headers: { origin: ORIGINS.staff, 'x-test-actor': 'officerA', 'content-type': type, 'idempotency-key': randomUUID() },
        body,
      }),
    );
  it('must be JSON', async () => {
    expect((await post('text=x', 'application/x-www-form-urlencoded')).status).toBe(415);
    expect((await post('{"text":"x"}', 'text/plain')).status).toBe(415);
    expect((await post('{"text":', 'application/json')).status).toBe(400);
  });
  it('must match the contract; the answer names the fields, never what was typed', async () => {
    const answer = await test.call('POST', `/staff/sample/cases/${test.s.cases.ofA}/notes`, {
      as: 'officerA',
      body: { text: 'beaucoup trop long pour ce champ' },
      ...keyed(),
    });
    expect(answer).toMatchObject({ status: 422, body: { code: 'INVALID', fields: ['text'] } });
    expect(JSON.stringify(answer.body)).not.toContain('beaucoup');
  });
  it('are limited in size', async () => {
    expect((await post(JSON.stringify({ text: 'x'.repeat(1_200_000) }), 'application/json')).status).toBe(413);
  });
});

describe('repeated requests', () => {
  const add = (key: string, text = 'Bonjour') =>
    test.call('POST', `/staff/sample/cases/${test.s.cases.ofA}/notes`, { as: 'officerA', body: { text }, ...keyed(key) });
  const notes = async () => (await rows("SELECT 1 FROM case_events WHERE case_id = $1 AND kind = 'NOTE'", [test.s.cases.ofA])).length;

  it('need a key to commit anything', async () => {
    const path = `/staff/sample/cases/${test.s.cases.ofA}/notes`;
    expect(await test.call('POST', path, { as: 'officerA', body: { text: 'x' } })).toMatchObject({ status: 400, body: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    expect((await test.call('POST', path, { as: 'officerA', body: { text: 'x' }, headers: { 'idempotency-key': '1' } })).status).toBe(400);
  });
  it('have a single effect, one after the other or together', async () => {
    const before = await notes();
    const key = randomUUID();
    const answers = await Promise.all([add(key), add(key), add(key), add(key)]);
    answers.push(await add(key));
    expect(answers.map((answer) => answer.status)).toEqual([204, 204, 204, 204, 204]);
    expect(await notes()).toBe(before + 1);
  });
  it('give back the same answer', async () => {
    const key = randomUUID();
    const first = await test.call('POST', '/staff/sample/number', { as: 'director', ...keyed(key) });
    expect((await test.call('POST', '/staff/sample/number', { as: 'director', ...keyed(key) })).body).toEqual(first.body);
  });
  it('refuse the same key for something else', async () => {
    const key = randomUUID();
    await add(key);
    expect(await add(key, 'Autre')).toMatchObject({ status: 422, body: { code: 'IDEMPOTENCY_MISMATCH' } });
  });
  it('never share a key between two people', async () => {
    const key = randomUUID();
    await add(key);
    const other = await test.call('POST', `/staff/sample/cases/${test.s.cases.ofB}/notes`, { as: 'officerB', body: { text: 'Bonjour' }, ...keyed(key) });
    expect(other.status).toBe(204);
  });
  it('never keep a value shown once', async () => {
    const key = randomUUID();
    const first = await test.call('POST', '/staff/sample/password', { as: 'developer', ...keyed(key) });
    expect(first.body).toEqual({ password: 'mot-de-passe-affiche-une-fois' });
    expect(await test.call('POST', '/staff/sample/password', { as: 'developer', ...keyed(key) })).toMatchObject({
      status: 409,
      body: { code: 'ALREADY_DONE' },
    });
    expect(JSON.stringify(await rows('SELECT * FROM idempotency_keys'))).not.toContain('affiche');
  });
  it('can be tried again after a failure', async () => {
    const key = randomUUID();
    const path = '/staff/sample/fail';
    expect((await test.call('POST', path, { as: 'officerA', body: { text: 'x' }, ...keyed(key) })).status).toBe(500);
    expect((await rows('SELECT 1 FROM idempotency_keys WHERE key = $1', [key])).length).toBe(0);
  });
});

describe('transaction of the request', () => {
  it('keeps nothing of a request that fails', async () => {
    await test.call('POST', '/staff/sample/fail', { as: 'officerA', body: { text: 'x' }, ...keyed() });
    expect(await rows("SELECT 1 FROM audit_log WHERE action = 'SECRET_SAVED'")).toEqual([]);
  });
  it('gives consecutive numbers, without gap, to concurrent requests', async () => {
    const answers = await Promise.all(Array.from({ length: 12 }, () => test.call('POST', '/staff/sample/number', { as: 'director', ...keyed() })));
    const numbers = answers.map((answer) => (answer.body as { number: number }).number).sort((left, right) => left - right);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, index) => numbers[0]! + index));
  });
  it('refuses what PostgreSQL refuses, without any detail', async () => {
    const answer = await test.call('POST', '/staff/sample/refused', { as: 'officerA' });
    expect(answer).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    expect(test.logs.join('')).toContain('refused by PostgreSQL');
  });
});

describe('history and audit', () => {
  it('note that the Director read a case of someone else, and only then', async () => {
    const viewed = (id: string) => rows<{ actor_label: string }>("SELECT actor_label FROM case_events WHERE case_id = $1 AND kind = 'CASE_VIEWED'", [id]);
    await test.call('GET', `/staff/sample/cases/${test.s.cases.ofA}`, { as: 'director' });
    await test.call('GET', `/staff/sample/cases/${test.s.cases.ofDirector}`, { as: 'director' });
    await test.call('GET', `/staff/sample/cases/${test.s.cases.ofA}`, { as: 'officerA' });
    expect(await viewed(test.s.cases.ofA)).toEqual([{ actor_label: 'Dora Test' }]);
    expect(await viewed(test.s.cases.ofDirector)).toEqual([]);
  });
  it('refuse the Director any other line on a case of someone else', async () => {
    expect((await test.call('POST', `/staff/sample/cases/${test.s.cases.ofA}/notes`, { as: 'director', body: { text: 'x' }, ...keyed() })).status).toBe(403);
  });
  it('know who, from where and for which request', async () => {
    const answer = await test.call('POST', `/staff/sample/cases/${test.s.cases.ofA}/notes`, { as: 'officerA', body: { text: 'x' }, ...keyed() });
    const [line] = await rows<Record<string, unknown>>(
      'SELECT actor_kind, actor_id, actor_label, entity_id, host(ip) AS ip, request_id FROM audit_log ORDER BY occurred_at DESC LIMIT 1',
    );
    expect(line).toEqual({
      actor_kind: 'STAFF',
      actor_id: test.s.officerA,
      actor_label: 'Alba Test',
      entity_id: test.s.cases.ofA,
      ip: '127.0.0.1',
      request_id: answer.headers.get('x-request-id'),
    });
  });
  it('take the address of the caller from the proxy, one hop only', async () => {
    await test.call('POST', '/staff/sample/settings', { as: 'director', headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' } });
    const [line] = await rows<{ ip: string }>('SELECT host(ip) AS ip FROM audit_log ORDER BY occurred_at DESC LIMIT 1');
    expect(line).toEqual({ ip: '198.51.100.7' });
  });
  it('refuse anything that is not an identifier, a date, a role, a technical name or a short number', async () => {
    expect((await test.call('POST', '/staff/sample/leak', { as: 'officerA' })).status).toBe(500);
    expect(await rows("SELECT 1 FROM audit_log WHERE action = 'PLAN_APPROVED'")).toEqual([]);
  });
  it('can be neither changed, emptied nor deleted, even by the owner of the tables', async () => {
    for (const table of ['audit_log', 'case_events']) {
      for (const sql of [`UPDATE ${table} SET actor_label = 'x'`, `DELETE FROM ${table}`, `TRUNCATE ${table}`]) {
        await expect(test.database.admin.query(sql)).rejects.toThrow(/append-only/u);
      }
    }
  });
});

describe('logs', () => {
  it('hold the model of the route, and nothing of the request', async () => {
    const secret = 'zz-secret-zz';
    await test.call('POST', `/staff/sample/cases/${test.s.cases.ofA}/notes?token=${secret}`, {
      as: 'officerA',
      body: { text: secret, password: secret },
      headers: { 'idempotency-key': randomUUID(), cookie: `a=${secret}`, authorization: secret },
    });
    await test.call('POST', '/staff/sample/fail', { as: 'officerA', body: { text: secret }, ...keyed() });
    const text = test.logs.join('');
    expect(text).toContain('/staff/sample/cases/:id/notes');
    for (const hidden of [secret, test.s.cases.ofA, test.s.officerA, '127.0.0.1', 'Alba']) expect(text).not.toContain(hidden);
  });
  it('give an unexpected error its number, the same as the answer', async () => {
    const answer = await test.call('POST', '/staff/sample/fail', { as: 'officerA', body: { text: 'x' }, ...keyed() });
    expect(answer).toMatchObject({ status: 500, body: { code: 'INTERNAL', requestId: answer.headers.get('x-request-id') } });
    expect(test.logs.join('')).toContain(String(answer.headers.get('x-request-id')));
  });
});

describe('outbox', () => {
  it('keeps the author of a task, and identifiers only', async () => {
    await test.call('POST', `/staff/sample/cases/${test.s.cases.ofA}/notes`, { as: 'officerA', body: { text: 'x' }, ...keyed() });
    const [task] = await rows<Record<string, unknown>>(
      "SELECT actor_kind, actor_id, acting_for, payload FROM outbox WHERE name = 'sample' ORDER BY created_at DESC LIMIT 1",
    );
    expect(task).toEqual({ actor_kind: 'STAFF', actor_id: test.s.officerA, acting_for: null, payload: { caseId: test.s.cases.ofA } });
  });
  it.each(['KXPM', 'CODE_KXPM', 'DUPONT', 'jean@exemple.test', '06 12 34 56 78', 'Atelier Mistral', '800000001', 'FR7630006000011234567890189', 123456])(
    'refuses %s in a payload',
    async (value) => {
      await expect(
        test.database.admin.query("INSERT INTO outbox (queue, name, actor_kind, payload) VALUES ('sms', 'x-x', 'SYSTEM', $1)", [JSON.stringify({ v: value })]),
      ).rejects.toThrow(/outbox_payload_check/u);
    },
  );
});
