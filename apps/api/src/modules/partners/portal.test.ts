import { plansData, portalCase, portalCases, portalDashboard } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, path, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });

beforeAll(async () => {
  test = await startApp();
  // Beyond the references of the test set.
  await rows("INSERT INTO number_sequences (kind, year, last_value) VALUES ('CASE', extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int, 1000)");
});
afterAll(() => test.stop());

describe('the portal of the creditors', () => {
  it('shows its own cases only', async () => {
    const mine = portalCases.parse((await call('partnerA', 'GET', '/partner/portal/cases')).body);
    const ids = mine.items.map((item) => item.id);
    expect(ids).toContain(test.s.cases.ofA);
    expect(ids).not.toContain(test.s.cases.ofB);
    expect((await call('partnerA', 'GET', `/partner/portal/cases/${test.s.cases.ofB}`)).status).toBe(404);
    expect(portalCase.parse((await call('partnerB', 'GET', `/partner/portal/cases/${test.s.cases.ofB}`)).body).id).toBe(test.s.cases.ofB);
    portalDashboard.parse((await call('partnerA', 'GET', '/partner/portal/dashboard')).body);
  });

  it('a long plan goes from the officer to the manager, then to the creditor, then to the debtor', async () => {
    const caseId = test.s.cases.ofA;
    await rows(
      "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'P-1', '2026-09-01', '2026-10-01', 240000, 240000)",
      [caseId, test.s.creditorA],
    );
    const balance = ((await call('officerA', 'GET', `/staff/payment-plans/simulation/${caseId}`)).body as { balance: number }).balance;
    expect((await call('officerA', 'POST', '/staff/payment-plans', { caseId, months: 8, method: 'TRANSFER', expected: balance })).status).toBe(204);
    const request = plansData.parse((await call('manager', 'GET', '/staff/payment-plans')).body).requests[0]!;
    expect((await call('manager', 'PUT', `/staff/payment-plans/requests/${request.id}`, { decision: 'APPROVED', version: request.version })).status).toBe(204);
    const waiting = portalDashboard.parse((await call('partnerA', 'GET', '/partner/portal/dashboard')).body).approvals;
    expect(waiting).toContainEqual(expect.objectContaining({ id: request.id, status: 'PENDING', months: 8, total: balance }));
    expect(portalDashboard.parse((await call('partnerB', 'GET', '/partner/portal/dashboard')).body).approvals).toEqual([]);
    expect((await call('partnerB', 'POST', `/partner/portal/plans/${request.id}/decision`, { accepted: true })).status).toBe(404);
    expect(await call('partnerA', 'POST', `/partner/portal/plans/${request.id}/decision`, { accepted: false })).toMatchObject({
      status: 422,
      body: { code: 'REASON_REQUIRED' },
    });
    expect((await call('partnerA', 'POST', `/partner/portal/plans/${request.id}/decision`, { accepted: true })).status).toBe(204);
    expect((await call('partnerA', 'POST', `/partner/portal/plans/${request.id}/decision`, { accepted: true })).status).toBe(409);
    expect(await rows('SELECT status FROM payment_plans WHERE id = $1', [request.id])).toEqual([{ status: 'WAITING_DEBTOR' }]);
    expect(
      await rows('SELECT plan_decision FROM notifications WHERE plan_id = $1 AND user_id = $2 ORDER BY created_at', [request.id, test.s.officerA]),
    ).toEqual([{ plan_decision: 'APPROVED' }, { plan_decision: 'APPROVED' }]);
    expect(await rows("SELECT visible_to_creditor FROM case_events WHERE case_id = $1 AND kind = 'PLAN_CREDITOR_DECIDED'", [caseId])).toEqual([
      { visible_to_creditor: true },
    ]);
    expect(portalDashboard.parse((await call('partnerA', 'GET', '/partner/portal/dashboard')).body).approvals).toContainEqual(
      expect.objectContaining({ id: request.id, status: 'ACCEPTED' }),
    );
  });
});

describe('a claim deposited by a creditor', () => {
  const claim = (some: object = {}) => ({
    debtor: 'Menuiserie Arnal',
    siret: '512 334 871 00088',
    email: 'Compta@Arnal.example',
    phone: '04 76 00 00 21',
    address: '18 chemin des Scieurs, 38500 Voiron',
    attachments: [],
    invoices: [{ number: 'MA-1', issuedOn: '2026-08-28', dueOn: '2026-09-27', amount: 486_000 }],
    ...some,
  });

  it('opens a case held by nobody under the mandate in force, that the manager sees', async () => {
    expect(await call('partnerA', 'POST', '/partner/portal/claims', claim())).toMatchObject({ status: 409, body: { code: 'NO_MANDATE' } });
    await rows(
      `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
       VALUES ($1, '2026-01-01', 800, 1200, 6, 500, true, 'NONE', true, 5, 'BUSINESS')`,
      [test.s.creditorA],
    );
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
    const file = await test.call('POST', '/partner/portal/attachments', { as: 'partnerA', file: pdf, headers: { 'content-type': 'application/pdf' } });
    expect(file.status, JSON.stringify(file.body)).toBe(200);
    const { id: attachment } = file.body as { id: string };
    // Another creditor cannot take the file of A.
    expect((await call('partnerB', 'POST', '/partner/portal/claims', claim({ attachments: [attachment] }))).status).toBe(409);
    const deposited = await call('partnerA', 'POST', '/partner/portal/claims', claim({ attachments: [attachment] }));
    expect(deposited.status, JSON.stringify(deposited.body)).toBe(204);
    const [opened] = await rows<{ id: string; officer_id: string | null; status: string; reference: string }>(
      "SELECT c.id, c.officer_id, c.status, c.reference FROM cases c JOIN debtors d ON d.id = c.debtor_id WHERE d.siren = '512334871'",
    );
    expect(opened).toMatchObject({ officer_id: null, status: 'NEW' });
    expect(opened!.reference).toMatch(/^LGR-\d{4}-\d{5}$/u);
    expect(await rows('SELECT kind, status, source FROM case_contacts WHERE case_id = $1 ORDER BY kind', [opened!.id])).toEqual([
      { kind: 'PHONE', status: 'UNVERIFIED', source: 'CREDITOR' },
      { kind: 'EMAIL', status: 'UNVERIFIED', source: 'CREDITOR' },
    ]);
    expect(await rows('SELECT case_id FROM documents WHERE id = $1', [attachment])).toEqual([{ case_id: opened!.id }]);
    expect(((await call('manager', 'GET', `/staff/cases/${opened!.id}`)).body as { principal: number }).principal).toBe(486_000);
    expect(portalCases.parse((await call('partnerA', 'GET', '/partner/portal/cases')).body).items.some((item) => item.id === opened!.id)).toBe(true);
    expect(portalCases.parse((await call('partnerB', 'GET', '/partner/portal/cases')).body).items.some((item) => item.id === opened!.id)).toBe(false);
    // Twice, or under another name: refused.
    expect(await call('partnerA', 'POST', '/partner/portal/claims', claim())).toMatchObject({ status: 409, body: { code: 'CASE_EXISTS' } });
    await rows(
      `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
       VALUES ($1, '2026-01-01', 800, 1200, 6, 500, true, 'NONE', true, 5, 'BUSINESS')`,
      [test.s.creditorB],
    );
    expect(await call('partnerB', 'POST', '/partner/portal/claims', claim({ debtor: 'Autre Nom SARL' }))).toMatchObject({
      status: 409,
      body: { code: 'DEBTOR_MISMATCH' },
    });
  });
});
