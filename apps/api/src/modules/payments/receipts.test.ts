import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import { PLACEHOLDER } from '../../platform/pdf/pdf';

let test: TestApp;
let worker: MailWorker;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

beforeAll(async () => {
  test = await startApp();
  worker = startMailWorker(test);
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});

const caseWithTransfer = async () => {
  const [creditor] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Crédit Horizon') RETURNING id");
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'Paul Meunier') RETURNING id");
  const [made] = await rows<{ id: string }>(
    "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id) VALUES ('LGR-2026-90001', $1, $2, $3) RETURNING id",
    [creditor!.id, debtor!.id, test.s.officerA],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'CH-1', '2026-09-01', '2026-10-01', 21500, 21500)",
    [made!.id, creditor!.id],
  );
  const answer = await test.call('POST', `/staff/cases/${made!.id}/payments`, {
    as: 'officerA',
    body: { method: 'TRANSFER', amount: 21500, receivedOn: today, label: 'VIR MEUNIER', reconciled: true },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(answer.status).toBe(204);
  return made!.id;
};

describe('the PDF of a receipt', () => {
  it('waits while a value of the firm is between brackets, then is written once', async () => {
    const id = await caseWithTransfer();
    await worker.run().catch(() => undefined);
    expect(await rows('SELECT document_id FROM receipts WHERE case_id = $1', [id])).toEqual([{ document_id: null }]);
    for (const [key, value] of [
      ['firm.cabinet.siren', '732829007'],
      ['firm.cabinet.address', '10 rue de la Paix, 75002 Paris'],
    ])
      await rows('INSERT INTO settings (key, value, updated_by) VALUES ($1, to_jsonb($2::text), $3)', [key, value, test.s.director]);
    await rows(
      "UPDATE outbox SET failed_at = NULL, failure = NULL, done_at = NULL, published_at = NULL, started_at = NULL, claimed_at = NULL, run_at = NULL WHERE name = 'receipt-pdf'",
    );
    await worker.run();
    const [receipt] = await rows<{ document_id: string | null }>('SELECT document_id FROM receipts WHERE case_id = $1', [id]);
    expect(receipt!.document_id).not.toBeNull();
    expect(await rows('SELECT category, source, scan_status, kind, case_id FROM documents WHERE id = $1', [receipt!.document_id])).toEqual([
      { category: 'RECEIPT', source: 'GENERATED', scan_status: 'CLEAN', kind: 'PDF', case_id: id },
    ]);
    const file = await test.call('GET', `/staff/documents/${receipt!.document_id}/file`, { as: 'officerA' });
    expect(file.status).toBe(200);
    expect(new TextDecoder().decode((file.body as Uint8Array).slice(0, 5))).toBe('%PDF-');
    await expect(rows('UPDATE receipts SET document_id = NULL WHERE case_id = $1', [id])).rejects.toThrow(/never changes/u);
  });

  it('knows a value between brackets', () => {
    for (const text of ['SIREN [SIREN]', '[ADRESSE DU CABINET]', '[HÉBERGEUR : nom, adresse, téléphone]']) expect(PLACEHOLDER.test(text), text).toBe(true);
    for (const text of ['Facture [x]', 'Quittance n° Q-2026-00001']) expect(PLACEHOLDER.test(text), text).toBe(false);
  });
});
