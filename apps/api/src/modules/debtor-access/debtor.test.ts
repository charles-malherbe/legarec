import { debtorCase, debtorSession } from '@legarec/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
/** The same database, for the team: its callers named by the header of the tests. */
let staff: TestApp;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
/** Each test from a network of its own: the limit by network is tested on its own. */
let network = '';
const access = (value: string, code: string, kind: 'SIREN' | 'REFERENCE' = 'SIREN', remember = false) =>
  test.call('POST', '/debtor/access', { body: { identifier: { kind, value }, code, remember }, headers: { 'x-forwarded-for': network } });
const cookieOf = (answer: { headers: Headers }) => /__Host-debtor=([^;]+)/u.exec(answer.headers.get('set-cookie') ?? '')?.[1];
const asDebtor = (cookie: string, path: string) =>
  test.call('GET', `/debtor${path}`, { headers: { cookie: `__Host-debtor=${cookie}`, 'x-forwarded-for': network } });
let reference = 95_000;
const siren = (): string => {
  for (;;) {
    reference += 1;
    const digits = String(700_000_000 + reference);
    const sum = [...digits].reverse().reduce((total, char, index) => {
      const value = Number(char) * (index % 2 === 1 ? 2 : 1);
      return total + (value > 9 ? value - 9 : value);
    }, 0);
    if (sum % 10 === 0) return digits;
  }
};
/** A company with a case announced, held by the manager; its code drawn as a colleague shows it. */
const debtorWithCode = async (kind: 'COMPANY' | 'INDIVIDUAL' = 'COMPANY', announced = true) => {
  const number = kind === 'COMPANY' ? siren() : null;
  const [creditor] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Matériaux Delta') RETURNING id");
  const [debtor] = await rows<{ id: string }>('INSERT INTO debtors (kind, name, siren) VALUES ($1, $2, $3) RETURNING id', [
    kind,
    `Débiteur ${reference}`,
    number,
  ]);
  reference += 1;
  const ref = `LGR-2026-${String(reference).padStart(5, '0')}`;
  const [made] = await rows<{ id: string }>(
    'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, first_letter_reference, first_letter_on) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [ref, creditor!.id, debtor!.id, test.s.officerA, announced ? 'LR-2026-0001' : null, announced ? '2026-11-02' : null],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', '2026-09-01', '2026-10-01', 120000, 120000)",
    [made!.id, creditor!.id],
  );
  const shown = await staff.call('GET', `/staff/cases/${made!.id}/access-code`, { as: 'officerA' });
  const { code, version } = shown.body as { code: string; version: number };
  return { caseId: made!.id, siren: number, reference: ref, code, version, debtorId: debtor!.id };
};
const wrong = (code: string) => (code === 'ABCD' ? 'ABCE' : 'ABCD');

beforeAll(async () => {
  test = await startApp([], { sessions: true });
  // The same keys: what one seals, the other opens.
  staff = await startApp([], { next: test, env: { VAULT_MASTER_KEY: test.config.VAULT_MASTER_KEY, SESSION_SIGNING_KEY: test.config.SESSION_SIGNING_KEY } });
});
afterAll(async () => {
  await staff.stop();
  await test.stop();
});

describe('the access of a debtor', () => {
  it('opens with the right code, and shows their cases only', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code, caseId } = await debtorWithCode();
    const answer = await access(value!, code.toLowerCase());
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const session = debtorSession.parse(answer.body);
    expect(session.cases).toHaveLength(1);
    expect(session.cases[0]).toMatchObject({ id: caseId, creditor: 'Matériaux Delta', balance: expect.any(Number) as number });
    const cookie = cookieOf(answer)!;
    expect(answer.headers.get('set-cookie')).not.toMatch(/Max-Age/u);
    expect(debtorSession.parse((await asDebtor(cookie, '/session')).body).cases[0]?.id).toBe(caseId);
    const detail = debtorCase.parse((await asDebtor(cookie, `/cases/${caseId}`)).body);
    expect(detail).toMatchObject({ principal: 120_000, invoices: [{ number: 'F-1', amount: 120_000 }], plan: null });
    // Someone else's case does not exist.
    expect((await asDebtor(cookie, `/cases/${test.s.cases.ofA}`)).status).toBe(404);
    // Closed: the cookie opens nothing more.
    await test.call('POST', '/debtor/logout', { headers: { cookie: `__Host-debtor=${cookie}`, origin: 'http://localhost:5175' } });
    expect((await asDebtor(cookie, '/session')).status).toBe(401);
  });

  it('answers the same to an unknown identifier and to a wrong code', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code } = await debtorWithCode();
    const unknown = await access(siren(), 'ABCD');
    const mistaken = await access(value!, wrong(code));
    expect([unknown.status, unknown.body]).toEqual([401, { code: 'INVALID', attemptsLeft: 4 }]);
    expect([mistaken.status, mistaken.body]).toEqual([401, { code: 'INVALID', attemptsLeft: 4 }]);
  });

  it('never opens a case not announced yet, nor a company by the reference of its case', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const silent = await debtorWithCode('COMPANY', false);
    expect((await access(silent.siren!, silent.code)).status).toBe(401);
    const company = await debtorWithCode();
    expect((await access(company.reference, company.code, 'REFERENCE')).status).toBe(401);
    const person = await debtorWithCode('INDIVIDUAL');
    expect((await access(person.reference, person.code, 'REFERENCE')).status).toBe(200);
  });

  it('five wrong codes lock it 15 minutes, ten block it, the right one too, until a colleague renews the code', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code, caseId, version, debtorId } = await debtorWithCode();
    const opened = cookieOf(await access(value!, code))!;
    for (let attempt = 1; attempt <= 4; attempt += 1) expect((await access(value!, wrong(code))).body).toEqual({ code: 'INVALID', attemptsLeft: 5 - attempt });
    expect(await access(value!, wrong(code))).toMatchObject({ status: 423, body: { code: 'LOCKED', minutes: 15 } });
    expect(await access(value!, code)).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
    // Fifteen minutes later.
    await rows("UPDATE lockouts SET locked_until = now() - interval '1 second' WHERE debtor_id = $1", [debtorId]);
    for (let attempt = 6; attempt <= 9; attempt += 1) expect((await access(value!, wrong(code))).body).toEqual({ code: 'INVALID', attemptsLeft: 10 - attempt });
    expect(await access(value!, wrong(code))).toMatchObject({ status: 423, body: { code: 'BLOCKED' } });
    expect(await access(value!, code)).toMatchObject({ status: 423, body: { code: 'BLOCKED' } });
    // Told to the officer, in the history of the case.
    expect(
      await rows("SELECT kind FROM notifications WHERE user_id = $1 AND kind = 'DEBTOR_BLOCKED' AND case_id = $2", [test.s.officerA, caseId]),
    ).toHaveLength(1);
    expect(await rows("SELECT kind FROM case_events WHERE case_id = $1 AND kind = 'DEBTOR_ACCESS_BLOCKED'", [caseId])).toHaveLength(1);
    const renewed = await staff.call('POST', `/staff/cases/${caseId}/access-code/regenerate`, {
      as: 'officerA',
      body: { version },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(renewed.status).toBe(204);
    // The old session is closed, the old code opens nothing, the new one does.
    expect((await asDebtor(opened, '/session')).status).toBe(401);
    expect((await access(value!, code)).status).toBe(401);
    const { code: next } = (await staff.call('GET', `/staff/cases/${caseId}/access-code`, { as: 'officerA' })).body as { code: string };
    expect((await access(value!, next)).status).toBe(200);
  });

  it('keeps the cookie 30 days when asked, never more than the session', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code } = await debtorWithCode();
    const answer = await access(value!, code, 'SIREN', true);
    expect(answer.headers.get('set-cookie')).toMatch(/Max-Age=2592000/u);
    expect(await rows("SELECT persistent, expires_at < now() + interval '13 hours' AS short FROM debtor_sessions ORDER BY created_at DESC LIMIT 1")).toEqual([
      { persistent: true, short: true },
    ]);
  });

  it('refuses beyond twenty tries an hour from one network', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    for (let attempt = 0; attempt < 20; attempt += 1) await access(siren(), 'ABCD');
    expect(await access(siren(), 'ABCD')).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
  });

  it('a session idle for 30 minutes opens nothing more', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code } = await debtorWithCode();
    const cookie = cookieOf(await access(value!, code))!;
    await rows("UPDATE debtor_sessions SET last_seen_at = now() - interval '31 minutes'");
    expect((await asDebtor(cookie, '/session')).status).toBe(401);
  });
});
