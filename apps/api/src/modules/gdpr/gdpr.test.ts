import { gdprExport, gdprRegistry } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
let caseId: string;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });

beforeAll(async () => {
  test = await startApp();
  const [creditor] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Registre Delta') RETURNING id");
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name, siren) VALUES ('COMPANY', 'Bâtiplus RGPD', '512334871') RETURNING id");
  [{ id: caseId }] = (await rows<{ id: string }>(
    "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id) VALUES ('LGR-2026-90001', $1, $2, $3) RETURNING id",
    [creditor!.id, debtor!.id, test.s.officerA],
  )) as [{ id: string }];
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-77', '2026-09-01', '2026-10-01', 50000, 50000)",
    [caseId, creditor!.id],
  );
});
afterAll(() => test.stop());

describe('the registry of the RGPD', () => {
  it('takes a request from whoever acts on the case, due within a month', async () => {
    expect((await call('officerB', 'POST', '/gdpr/requests', { caseId, kind: 'ACCESS', origin: 'Courrier' })).status).toBe(403);
    expect((await call('officerA', 'POST', '/gdpr/requests', { caseId, kind: 'ACCESS', origin: 'Courrier du 20/11' })).status).toBe(204);
    const { items } = gdprRegistry.parse((await call('director', 'GET', '/gdpr/requests')).body);
    const item = items.find((entry) => entry.caseId === caseId)!;
    expect(item).toMatchObject({ kind: 'ACCESS', debtor: 'Bâtiplus RGPD', status: 'OPEN', origin: 'Courrier du 20/11' });
    expect(item.daysLeft).toBeGreaterThanOrEqual(28);
    expect((await call('officerA', 'GET', '/gdpr/requests')).status).toBe(403);
  });

  it('exports what the firm holds on the debtor, never their access code, under the name of the request', async () => {
    const { items } = gdprRegistry.parse((await call('director', 'GET', '/gdpr/requests')).body);
    const { id } = items.find((entry) => entry.caseId === caseId)!;
    const file = gdprExport.parse((await call('director', 'POST', `/gdpr/requests/${id}/export`)).body);
    expect(file.fileName).toBe(`export-rgpd-${id}.json`);
    expect(JSON.stringify(file.content)).toContain('F-77');
    expect(JSON.stringify(file.content)).not.toMatch(/code/iu);
    expect(await rows("SELECT 1 FROM audit_log WHERE action = 'GDPR_EXPORTED' AND entity_id = $1", [id])).toHaveLength(1);
  });

  it('refuses only with a reason', async () => {
    const { items } = gdprRegistry.parse((await call('director', 'GET', '/gdpr/requests')).body);
    const { id } = items.find((entry) => entry.caseId === caseId)!;
    expect((await call('director', 'PUT', `/gdpr/requests/${id}`, { status: 'REFUSED' })).status).toBe(422);
    expect((await call('director', 'PUT', `/gdpr/requests/${id}`, { status: 'REFUSED', reason: 'Demande manifestement infondée' })).status).toBe(204);
    expect((await rows<{ status: string }>('SELECT status FROM gdpr_requests WHERE id = $1', [id]))[0]!.status).toBe('REFUSED');
  });
});
