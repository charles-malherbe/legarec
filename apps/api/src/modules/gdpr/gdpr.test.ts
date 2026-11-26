import { gdprErasure, gdprExport, gdprRegistry } from '@legarec/contracts';
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

describe('the erasure asked by a debtor', () => {
  let debtor = '';
  let closed = '';
  let open = '';
  let request = '';
  const erasure = async () => gdprErasure.parse((await call('director', 'GET', `/gdpr/requests/${request}/erasure`)).body);
  const erase = async (as: string, expectedCases: number, key: string = randomUUID(), expectedDigest?: string) =>
    test.call('POST', `/staff/gdpr/requests/${request}/erasure`, {
      as,
      body: { expectedCases, expectedDigest: expectedDigest ?? (await erasure()).digest },
      headers: { 'idempotency-key': key },
    });

  beforeAll(async () => {
    const [creditor] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Effacement Delta') RETURNING id");
    [{ id: debtor }] = (await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'Hélène Faure') RETURNING id")) as [{ id: string }];
    // Perhaps the same person, followed for another creditor: never put together with her.
    await rows("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'HELENE  FAURE'), ('COMPANY', 'Hélène Faure')");
    // Two creditors, the same debtor: one case settled last year, one still under way.
    [{ id: closed }] = (await rows<{ id: string }>(
      `INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status, closed_on, debtor_address, contact_name)
       VALUES ('LGR-2025-90002', $1, $2, $3, 'SETTLED', '2025-06-01', '8 rue Haute', 'Hélène Faure') RETURNING id`,
      [creditor!.id, debtor, test.s.officerA],
    )) as [{ id: string }];
    [{ id: open }] = (await rows<{ id: string }>(
      "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status) VALUES ('LGR-2026-90003', $1, $2, $3, 'REMINDER') RETURNING id",
      [test.s.creditorB, debtor, test.s.officerB],
    )) as [{ id: string }];
    expect((await call('officerA', 'POST', '/gdpr/requests', { caseId: closed, kind: 'ERASURE', origin: 'Courriel du 25/11' })).status).toBe(204);
    [{ id: request }] = (await rows<{ id: string }>("SELECT id FROM gdpr_requests WHERE case_id = $1 AND kind = 'ERASURE'", [closed])) as [{ id: string }];
  });

  it('is refused, with its reason, while one of the cases of the debtor is open', async () => {
    expect(await erasure()).toEqual({
      cases: 2,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      blockers: ['OPEN_CASE'],
      homonyms: 1,
      warning: 'D’autres fiches au même nom existent : à vérifier.',
    });
    expect((await call('officerA', 'GET', `/gdpr/requests/${request}/erasure`)).status).toBe(403);
    expect(await erase('director', 2)).toMatchObject({ status: 409, body: { code: 'ERASURE_REFUSED', blockers: ['OPEN_CASE'] } });
    expect(await rows('SELECT name FROM debtors WHERE id = $1', [debtor])).toEqual([{ name: 'Hélène Faure' }]);
  });

  it('waits for a payment to be remitted to its creditor (legal obligation)', async () => {
    await rows("UPDATE cases SET status = 'LOST', closed_on = current_date WHERE id = $1", [open]);
    const [creditor] = await rows<{ creditor_id: string }>('SELECT creditor_id FROM cases WHERE id = $1', [closed]);
    const [payment] = await rows<{ id: string }>(
      `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, settled_at, cheque_number, bank, recorded_by)
         VALUES ($1, $2, 'CHEQUE', 5000, 'CASHED', '2025-05-02', '2025-05-05', '7654321', 'Banque', $3) RETURNING id)
       INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT $1, $2, p.id, 'OVERPAYMENT', 5000 FROM p RETURNING payment_id AS id`,
      [closed, creditor!.creditor_id, test.s.officerA],
    );
    expect(await erasure()).toMatchObject({ cases: 2, blockers: ['NOT_REMITTED'] });
    const [batch] = await rows<{ id: string }>(
      "INSERT INTO remittance_batches (covers_until, status, total_cents, transfers, validated_by, paid_on) VALUES ('2025-05-31', 'PAID', 4500, 1, $1, '2025-06-02') RETURNING id",
      [test.s.director],
    );
    const [remittance] = await rows<{ id: string }>(
      `INSERT INTO remittances (batch_id, creditor_id, state, payments, collected_cents, fee_net_cents, fee_vat_cents, fee_gross_cents, to_pay_cents)
       VALUES ($1, $2, 'PAID', 1, 5000, 400, 100, 500, 4500) RETURNING id`,
      [batch!.id, creditor!.creditor_id],
    );
    await rows(
      "INSERT INTO remittance_lines (remittance_id, case_id, creditor_id, kind, payment_id, amount_cents, fee_net_cents, fee_vat_cents) VALUES ($1, $2, $3, 'PAYMENT', $4, 5000, 400, 100)",
      [remittance!.id, closed, creditor!.creditor_id, payment!.id],
    );
    expect(await erasure()).toMatchObject({ cases: 2, blockers: [] });
  });

  it('erases only the number of cases shown, once, and keeps the pieces of accounting', async () => {
    // What the debtor did or said, and the trace of a payment (question 193).
    await rows(
      `INSERT INTO case_events (case_id, creditor_id, kind, title, detail, actor_kind, actor_label)
       SELECT id, creditor_id, k.kind, k.title, 'Texte saisi', 'STAFF', 'Alba' FROM cases, (VALUES ('DISPUTE_RAISED', 'Contestation du débiteur'), ('PAYMENT_RECORDED', 'Paiement enregistré')) AS k(kind, title)
       WHERE id = $1`,
      [closed],
    );
    expect(await erase('officerA', 2)).toMatchObject({ status: 403 });
    expect(await erase('director', 1)).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    // The same number, but not the cases that were shown.
    expect(await erase('director', 2, randomUUID(), '0'.repeat(64))).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    expect(await rows('SELECT name FROM debtors WHERE id = $1', [debtor])).toEqual([{ name: 'Hélène Faure' }]);
    const key = randomUUID();
    const { digest } = await erasure();
    expect((await erase('manager', 2, key, digest)).status).toBe(204);
    // The same confirmation again: the same answer, nothing more done; a new one: the request is answered.
    expect((await erase('manager', 2, key, digest)).status).toBe(204);
    expect(await erase('director', 0)).toMatchObject({ status: 409, body: { code: 'ERASURE_REFUSED', blockers: ['REQUEST_CLOSED'] } });

    expect(await rows('SELECT name, anonymized_at IS NOT NULL AS anonymized FROM debtors WHERE id = $1', [debtor])).toEqual([
      { name: 'Débiteur anonymisé', anonymized: true },
    ]);
    expect(
      await rows('SELECT contact_name, debtor_address, anonymized_at IS NOT NULL AS anonymized FROM cases WHERE debtor_id = $1 ORDER BY reference', [debtor]),
    ).toEqual([
      { contact_name: null, debtor_address: null, anonymized: true },
      { contact_name: null, debtor_address: null, anonymized: true },
    ]);
    // Asked by the debtor: of the history, the payments and the request alone stay, without what was typed (questions 169, 193).
    expect(await rows("SELECT kind, detail FROM case_events WHERE case_id = $1 AND kind IN ('DISPUTE_RAISED', 'PAYMENT_RECORDED')", [closed])).toEqual([
      { kind: 'PAYMENT_RECORDED', detail: null },
    ]);
    expect(
      await rows(
        "SELECT count(*)::int AS n FROM case_events WHERE case_id = $1 AND NOT (kind LIKE 'PAYMENT%' OR kind LIKE 'PLAN%' OR kind IN ('CASE_SETTLED', 'GDPR_REQUEST'))",
        [closed],
      ),
    ).toEqual([{ n: 0 }]);
    expect(await rows('SELECT reason FROM gdpr_requests WHERE id = $1', [request])).toEqual([
      { reason: expect.stringContaining('seule trace de ces paiements et échéanciers dans l’historique') },
    ]);
    expect(await rows('SELECT amount_cents FROM payments WHERE case_id = $1', [closed])).toEqual([{ amount_cents: 5000 }]);
    expect(await rows('SELECT status, origin, reason IS NOT NULL AS motivated FROM gdpr_requests WHERE id = $1', [request])).toEqual([
      { status: 'ANSWERED', origin: 'Demande anonymisée', motivated: true },
    ]);
    expect(await rows("SELECT params FROM audit_log WHERE action = 'GDPR_ERASED' AND entity_id = $1", [request])).toEqual([{ params: { count: 2 } }]);
    const { items } = gdprRegistry.parse((await call('director', 'GET', '/gdpr/requests')).body);
    expect(items.find((item) => item.id === request)).toMatchObject({ debtor: 'Débiteur anonymisé', status: 'ANSWERED' });
  });

  it('leaves nothing to be added to an anonymized case', async () => {
    const coordinate = { kind: 'PHONE', label: 'Mobile', value: '06 11 22 33 44', primary: false, replaces: null, source: 'CALL' };
    expect(await call('officerA', 'POST', `/cases/${closed}/coordinates`, coordinate)).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    const cheque = { method: 'CHEQUE', amount: 1000, chequeNumber: '1234560', bank: 'Banque', receivedOn: '2026-11-02', depositedOn: null };
    expect(await call('officerA', 'POST', `/cases/${closed}/payments`, cheque)).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    expect(await call('officerA', 'POST', '/gdpr/requests', { caseId: closed, kind: 'ACCESS', origin: 'Courrier' })).toMatchObject({ status: 409 });
    expect(await rows('SELECT count(*)::int AS n FROM case_contacts WHERE case_id = $1', [closed])).toEqual([{ n: 0 }]);
    expect(await rows('SELECT count(*)::int AS n FROM payments WHERE case_id = $1', [closed])).toEqual([{ n: 1 }]);
  });

  it('is asked of an erasure only, and never by a creditor', async () => {
    const { items } = gdprRegistry.parse((await call('director', 'GET', '/gdpr/requests')).body);
    const access = items.find((item) => item.kind === 'ACCESS')!;
    expect((await call('director', 'GET', `/gdpr/requests/${access.id}/erasure`)).status).toBe(404);
    expect((await test.call('GET', `/partner/gdpr/requests/${request}/erasure`, { as: 'partnerB' })).status).toBe(404);
    expect((await call('partnerB', 'GET', `/gdpr/requests/${request}/erasure`)).status).toBe(403);
  });
});
