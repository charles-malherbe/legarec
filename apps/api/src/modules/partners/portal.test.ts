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
