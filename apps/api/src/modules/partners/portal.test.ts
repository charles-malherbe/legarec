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
    // Under another name: the same answer as for any SIREN, the name it gave on its case, a check asked of the team.
    expect((await call('partnerB', 'POST', '/partner/portal/claims', claim({ debtor: 'Autre Nom SARL' }))).status).toBe(204);
    const theirs = portalCases.parse((await call('partnerB', 'GET', '/partner/portal/cases')).body).items.find((item) => item.debtor === 'Autre Nom SARL');
    expect(theirs).toBeDefined();
    expect(await rows("SELECT visible_to_creditor FROM case_events WHERE case_id = $1 AND kind = 'DEPOSITED_NAME'", [theirs!.id])).toEqual([
      { visible_to_creditor: false },
    ]);
    // A debtor first named by a creditor: the team, opening under the confirmed name, replaces it.
    expect(await rows("SELECT name, name_confirmed FROM debtors WHERE siren = '512334871'")).toEqual([{ name: 'Menuiserie Arnal', name_confirmed: false }]);
  });
});

describe('an import of claims', () => {
  const send = (as: string, content: string | Uint8Array, type = 'text/csv') =>
    test.call('POST', '/partner/portal/imports', {
      as,
      file: typeof content === 'string' ? new TextEncoder().encode(content) : content,
      headers: { 'content-type': type },
    });
  const CSV = [
    '﻿debiteur;siret;email;telephone;adresse;numero_facture;date_emission;date_echeance;montant_ttc',
    'Garage Valmont;;compta@valmont.example;;45 route de Lyon, 38000 Grenoble;L-1;16/08/2026;16/09/2026;1 250,50',
    'Garage Valmont;;compta@valmont.example;;45 route de Lyon, 38000 Grenoble;L-2;16/09/2026;16/10/2026;"2 000,00"',
    'Studio Pixelia;;;;3 rue des Arts, 75011 Paris;SP-9;;12/10/2026;400',
    'Studio Pixelia;;;;3 rue des Arts, 75011 Paris;SP-10;01/10/2026;12/10/2026;1.2OO,00',
  ].join('\r\n');

  it('reads every line, creates nothing before the confirmation, then deposits each claim', async () => {
    const before = await rows<{ n: number }>('SELECT count(*)::int AS n FROM cases');
    const answer = await send('partnerA', CSV);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const report = answer.body as { id: string; lines: number; valid: number; total: number; errors: { line: number }[] };
    expect(report).toMatchObject({ lines: 4, valid: 2, total: 325_050 });
    expect(report.errors.map((error) => error.line)).toEqual([4, 5]);
    expect(await rows<{ n: number }>('SELECT count(*)::int AS n FROM cases')).toEqual(before);
    // Not that of another creditor.
    expect((await call('partnerB', 'POST', `/partner/portal/imports/${report.id}/confirm`)).status).toBe(404);
    const done = await call('partnerA', 'POST', `/partner/portal/imports/${report.id}/confirm`);
    expect(done).toMatchObject({ status: 200, body: { created: 2, pending: 2 } });
    expect(await rows("SELECT count(*)::int AS n FROM case_invoices WHERE number IN ('L-1', 'L-2')")).toEqual([{ n: 2 }]);
    expect((await call('partnerA', 'POST', `/partner/portal/imports/${report.id}/confirm`)).status).toBe(404);
  });

  it('refuses what is not a table of claims', async () => {
    expect((await send('partnerA', '<html><script>alert(1)</script></html>', 'text/html')).status).toBe(422);
    expect((await send('partnerA', new Uint8Array([0xff, 0xfe, 0x00]), 'text/csv')).status).toBe(422);
    const missing = (await send('partnerA', 'debiteur;montant\r\nX;10')).body as { errors: { message: string }[]; valid: number };
    expect(missing.valid).toBe(0);
    expect(missing.errors[0]?.message).toMatch(/^Colonnes manquantes/u);
  });
});
