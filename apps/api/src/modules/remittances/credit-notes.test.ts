import { creditNotesData, remittanceBatch, remittanceDraft, type CorrectableInvoice } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
let reference = 70_000;
let chequeNumber = 4_000_000;
let manual = 9_000;
let siren = 0;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown, key: string = randomUUID()) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': key } });
const read = async (as = 'director') => {
  const answer = await call(as, 'GET', '/credit-notes');
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return creditNotesData.parse(answer.body);
};
const year = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 4);

/** A creditor at 8 %, with an opening fee of 50 € and a confirmed account. */
const creditorWith = async (name: string) => {
  const [creditor] = await rows<{ id: string }>(
    'INSERT INTO creditors (name, legal_name, address, postal_code, city, siren) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [name, `${name} SAS`, '14 rue des Tanneurs', '69007', 'Lyon', String(401_000_000 + (siren += 1))],
  );
  const [mandate] = await rows<{ id: string }>(
    `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, discount_max_bp,
       litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
     VALUES ($1, '2026-01-01', 800, 1200, 5000, 6, 500, true, 'ECB_PLUS_TEN', true, 5, 'BUSINESS') RETURNING id`,
    [creditor!.id],
  );
  await rows(
    `INSERT INTO creditor_bank_accounts (creditor_id, holder, iban_cipher, iban_masked, bic, confirmed_by, confirmed_at, confirmed_with, created_by)
     VALUES ($1, $2, '\\x00', 'FR76 •••• •••• 1234', 'BNPAFRPP', $3, now(), 'Mme Comptable', $3)`,
    [creditor!.id, name, test.s.manager],
  );
  return { creditor: creditor!.id, mandate: mandate!.id };
};
/** A case paid by cheques, cashed yesterday. */
const paidCase = async ({ creditor, mandate }: { creditor: string; mandate: string }, amounts: number[]) => {
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name, siren) VALUES ('COMPANY', 'Débiteur', $1) RETURNING id", [
    String(500_000_000 + reference),
  ]);
  const [made] = await rows<{ id: string }>(
    "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, mandate_id, status) VALUES ($1, $2, $3, $4, $5, 'OVERDUE') RETURNING id",
    [`LGR-2026-${(reference += 1)}`, creditor, debtor!.id, test.s.officerA, mandate],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', '2026-06-01', '2026-07-01', $3, $3)",
    [made!.id, creditor, amounts.reduce((sum, amount) => sum + amount, 0)],
  );
  for (const amount of amounts) {
    const body = { method: 'CHEQUE', amount, chequeNumber: String((chequeNumber += 1)), bank: 'Banque Rhône', receivedOn: '2026-11-02', depositedOn: null };
    expect((await call('officerA', 'POST', `/cases/${made!.id}/payments`, body)).status).toBe(204);
  }
  for (const { id, version } of await rows<{ id: string; version: number }>('SELECT id, version FROM payments WHERE case_id = $1', [made!.id]))
    expect((await call('officerA', 'PUT', `/cases/${made!.id}/payments/${id}`, { status: 'CASHED', version })).status).toBe(204);
  await rows("UPDATE payments SET settled_at = now() - interval '1 day' WHERE case_id = $1", [made!.id]);
};
/** Validates the batch as it is now, every READY creditor remitted. */
const remit = async () => {
  const shown = remittanceDraft.parse((await call('director', 'GET', '/remittances/draft')).body);
  const ready = shown.rows.filter((item) => item.state === 'READY');
  const done = await call('director', 'POST', '/remittances', {
    until: shown.until,
    expected: ready.map((item) => ({ creditorId: item.creditorId, toPay: item.toPay, accountId: item.accountId! })),
    retained: [],
  });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return remittanceBatch.parse((await call('director', 'GET', `/remittances/${(done.body as { id: string }).id}`)).body);
};
/** An invoice of the commission, settled by the remittance that retained it. */
const settledInvoice = async (name: string) => {
  const delta = await creditorWith(name);
  await paidCase(delta, [100_000, 50_000]);
  await remit();
  const invoice = (await read()).invoices.find((item) => item.client.id === delta.creditor)!;
  return { ...delta, invoice };
};
/** An invoice not settled (refacturation of costs, entered as the remittances do). */
const unsettledInvoice = async (name: string) => {
  const { creditor } = await creditorWith(name);
  const id = randomUUID();
  await rows(
    `INSERT INTO billing_documents (id, kind, number, creditor_id, issued_on, net_cents, vat_cents, gross_cents, created_by)
     VALUES ($1, 'INVOICE', $2, $3, current_date, 107000, 21400, 128400, $4)`,
    [id, `FA-${year()}-${(manual += 1)}`, creditor, test.s.director],
  );
  await rows("INSERT INTO billing_lines (document_id, label, net_cents, vat_cents, gross_cents) VALUES ($1, 'Frais de procédure', 107000, 21400, 128400)", [
    id,
  ]);
  return { creditor, invoice: (await read()).invoices.find((item) => item.id === id)! };
};
const issue = (invoice: CorrectableInvoice, change: Record<string, unknown> = {}, as = 'director', key?: string) =>
  call(
    as,
    'POST',
    '/credit-notes',
    {
      invoiceId: invoice.id,
      scope: 'PARTIAL',
      lines: [{ lineId: invoice.lines[0]!.id, net: 100 }],
      reason: 'Chèque revenu impayé après reversement (dossier LGR-2026-00188).',
      followUp: 'NEXT_REMITTANCE',
      expectedLeft: invoice.left,
      draftId: null,
      ...change,
    },
    key,
  );
const fillFirm = () =>
  rows(
    `INSERT INTO settings (key, value, updated_by) SELECT k, to_jsonb(v), $1 FROM (VALUES ('firm.cabinet.address', '10 rue de la Paix, 75002 Paris'),
       ('firm.cabinet.siren', '732829007'), ('firm.cabinet.vat', 'FR44732829007'), ('firm.cabinet.rcs', 'SAS au capital de 10 000 €, RCS Paris 732 829 007')) AS x (k, v)
     ON CONFLICT (key) DO NOTHING`,
    [test.s.director],
  );

beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

describe('a credit note', () => {
  it('is refused while the identity of the firm is between brackets, and nothing is numbered', async () => {
    const { invoice } = await settledInvoice('Crochets Delta');
    const answer = await issue(invoice);
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'FIRM_INCOMPLETE', missing: expect.arrayContaining(['[SIREN]', '[ADRESSE DU CABINET]']) });
    expect(await rows("SELECT 1 FROM billing_documents WHERE kind = 'CREDIT_NOTE'")).toEqual([]);
    expect(await rows("SELECT 1 FROM number_sequences WHERE kind = 'CREDIT_NOTE'")).toEqual([]);
  });

  it('credits part of a settled invoice with its tax, numbered in its own continuous series, and gives it back with the next remittance', async () => {
    await fillFirm();
    const { creditor, invoice } = await settledInvoice('Matériaux Avoir');
    // 8 % of 1 500 € and 50 € of opening, with 20 % of tax; settled by its remittance.
    expect(invoice).toMatchObject({ net: 17_000, vat: 3_400, gross: 20_400, left: 20_400, credited: 0, client: { legalName: 'Matériaux Avoir SAS' } });
    expect(invoice.settledOn).not.toBeNull();
    const commission = invoice.lines.find((line) => line.label === 'Honoraires de recouvrement')!;
    expect(commission).toMatchObject({ net: 12_000, vat: 2_400, leftNet: 12_000, leftVat: 2_400 });
    // Settled: never deducted from the invoice.
    expect((await issue(invoice, { lines: [{ lineId: commission.id, net: 2_088 }], followUp: 'DEDUCTED' })).status).toBe(422);
    const first = await issue(invoice, { lines: [{ lineId: commission.id, net: 2_088 }] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((first.body as { number: string }).number).toBe(`AV-${year()}-0001`);
    const [made] = await rows<{ net_cents: string; vat_cents: string; gross_cents: string; corrected_id: string; scope: string; number: string }>(
      'SELECT net_cents, vat_cents, gross_cents, corrected_id, scope, number FROM billing_documents WHERE id = $1',
      [(first.body as { id: string }).id],
    );
    // The tax of the line, in proportion: 20 % of 20,88 €.
    expect(made).toMatchObject({ net_cents: '2088', vat_cents: '418', gross_cents: '2506', corrected_id: invoice.id, scope: 'PARTIAL' });
    const after = await read();
    expect(after.invoices.find((item) => item.id === invoice.id)).toMatchObject({ left: 20_400 - 2_506, credited: 1 });
    expect(after.items.find((item) => item.number === made!.number)).toMatchObject({
      invoice: invoice.number,
      invoiceStatus: 'PARTIAL',
      followUp: 'NEXT_REMITTANCE',
      gross: 2_506,
      remittedOn: null,
    });
    expect(after.nextNumber).toBe(`AV-${year()}-0002`);
    // The next remittance gives it back, once, even without anything collected.
    const draft = remittanceDraft.parse((await call('director', 'GET', '/remittances/draft')).body);
    expect(draft.rows.find((item) => item.creditorId === creditor)).toMatchObject({ state: 'READY', collected: 0, credits: 2_506, toPay: 2_506 });
    const batch = await remit();
    expect(batch.rows.find((item) => item.creditorId === creditor)).toMatchObject({ credits: 2_506, toPay: 2_506, invoice: null });
    expect((await read()).items.find((item) => item.number === made!.number)?.remittedOn).not.toBeNull();
    const next = remittanceDraft.parse((await call('director', 'GET', '/remittances/draft')).body);
    expect(next.rows.find((item) => item.creditorId === creditor)).toBeUndefined();
    // A second one follows in the same series, without a gap; the invoices keep theirs.
    const second = await issue(
      (await read()).invoices.find((item) => item.id === invoice.id)!,
      {
        lines: [{ lineId: commission.id, net: 100 }],
        followUp: 'TRANSFER',
      },
    );
    expect((second.body as { number: string }).number).toBe(`AV-${year()}-0002`);
    expect(invoice.number).toMatch(/^FA-\d{4}-\d{4}$/u);
  });

  it('credits a line at most of what it still bills, more than nothing, and refuses an invoice changed since it was shown', async () => {
    await fillFirm();
    const { invoice } = await settledInvoice('Plafond Delta');
    const line = invoice.lines[0]!;
    expect((await issue(invoice, { lines: [{ lineId: line.id, net: line.leftNet + 1 }] })).status).toBe(422);
    expect((await issue(invoice, { lines: [{ lineId: line.id, net: 0 }] })).status).toBe(422);
    expect((await issue(invoice, { lines: [] })).status).toBe(422);
    // A line of another invoice, or twice the same line.
    const other = await settledInvoice('Autre Delta');
    expect((await issue(invoice, { lines: [{ lineId: other.invoice.lines[0]!.id, net: 100 }] })).status).toBe(422);
    expect((await issue(invoice, { lines: [line, line].map((item) => ({ lineId: item.id, net: 100 })) })).status).toBe(422);
    expect((await issue(invoice, { reason: '   ' })).status).toBe(422);
    // Credited meanwhile: what was shown no longer holds.
    expect((await issue(invoice, { lines: [{ lineId: line.id, net: 100 }] })).status).toBe(200);
    const stale = await issue(invoice, { lines: [{ lineId: line.id, net: 100 }] });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ code: 'CHANGED' });
    expect((await call('director', 'POST', '/credit-notes', { ...invoiceBody(invoice), invoiceId: randomUUID() })).status).toBe(404);
  });

  it('cancels a whole invoice not settled, deducted from it; the invoice itself never changes', async () => {
    await fillFirm();
    const { invoice } = await unsettledInvoice('TransAlp Avoir');
    expect(invoice).toMatchObject({ settledOn: null, left: 128_400 });
    expect((await issue(invoice, { scope: 'TOTAL', lines: [], followUp: 'NEXT_REMITTANCE' })).status).toBe(422);
    expect((await issue(invoice, { lines: [{ lineId: invoice.lines[0]!.id, net: 21_400 }], followUp: 'DEDUCTED' })).status).toBe(200);
    const left = (await read()).invoices.find((item) => item.id === invoice.id)!;
    expect(left.left).toBe(128_400 - 25_680);
    // Total: every line in full, whatever was typed; the tax that is left with it.
    const total = await issue(left, { scope: 'TOTAL', lines: [{ lineId: invoice.lines[0]!.id, net: 1 }], followUp: 'DEDUCTED' });
    expect(total.status, JSON.stringify(total.body)).toBe(200);
    const after = await read();
    expect(after.invoices.find((item) => item.id === invoice.id)).toBeUndefined();
    const items = after.items.filter((item) => item.invoiceId === invoice.id);
    expect(items.map((item) => item.invoiceStatus)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(items.reduce((sum, item) => sum + item.gross, 0)).toBe(128_400);
    expect(items.find((item) => item.scope === 'TOTAL')).toMatchObject({ net: 85_600, vat: 17_120 });
    // Nothing more to credit; the invoice and the credit notes never change.
    expect((await issue(left, { scope: 'TOTAL', lines: [], followUp: 'DEDUCTED', expectedLeft: 0 })).status).toBe(409);
    expect(await rows('SELECT net_cents, gross_cents FROM billing_documents WHERE id = $1', [invoice.id])).toEqual([
      { net_cents: '107000', gross_cents: '128400' },
    ]);
    await expect(rows("UPDATE billing_documents SET reason = 'x' WHERE kind = 'CREDIT_NOTE'")).rejects.toThrow(/append-only/u);
    await expect(rows('DELETE FROM billing_lines WHERE corrected_line_id IS NOT NULL')).rejects.toThrow(/append-only/u);
  });

  it('is issued once for one key, with the double name of a delegation in the audit', async () => {
    await fillFirm();
    const { invoice } = await settledInvoice('Clé Delta');
    const key = randomUUID();
    const first = await issue(invoice, {}, 'manager', key);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = await issue(invoice, {}, 'manager', key);
    expect(again.body).toEqual(first.body);
    expect(await rows('SELECT 1 FROM billing_documents WHERE corrected_id = $1', [invoice.id])).toHaveLength(1);
    expect(
      await rows("SELECT actor_id, on_behalf_of_id FROM audit_log WHERE action = 'CREDIT_NOTE_ISSUED' AND entity_id = $1", [(first.body as { id: string }).id]),
    ).toEqual([{ actor_id: test.s.manager, on_behalf_of_id: test.s.director }]);
  });

  it('is first a draft without a number, changed or deleted, and leaves with its issuance', async () => {
    await fillFirm();
    const { invoice } = await settledInvoice('Brouillon Delta');
    const body = { invoiceId: invoice.id, scope: 'PARTIAL', lines: [{ lineId: invoice.lines[0]!.id, net: 500 }], reason: '', followUp: null };
    const made = await call('manager', 'POST', '/credit-notes/drafts', body);
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const { id } = made.body as { id: string };
    expect((await call('manager', 'PUT', `/credit-notes/drafts/${id}`, { ...body, reason: 'Erreur de taux', followUp: 'TRANSFER' })).status).toBe(204);
    expect((await read()).drafts.find((item) => item.id === id)).toMatchObject({
      invoice: invoice.number,
      reason: 'Erreur de taux',
      followUp: 'TRANSFER',
      lines: [{ lineId: invoice.lines[0]!.id, net: 500 }],
    });
    expect(await rows('SELECT 1 FROM billing_documents WHERE corrected_id = $1', [invoice.id])).toEqual([]);
    // Another invoice for the same draft, or a line of another invoice: refused.
    expect((await call('manager', 'PUT', `/credit-notes/drafts/${id}`, { ...body, invoiceId: randomUUID() })).status).toBe(404);
    expect((await call('manager', 'POST', '/credit-notes/drafts', { ...body, lines: [{ lineId: randomUUID(), net: 1 }] })).status).toBe(422);
    const deleted = await call('director', 'POST', '/credit-notes/drafts', body);
    const other = (deleted.body as { id: string }).id;
    expect((await call('director', 'DELETE', `/credit-notes/drafts/${other}`)).status).toBe(204);
    expect((await call('director', 'DELETE', `/credit-notes/drafts/${other}`)).status).toBe(404);
    expect((await issue(invoice, { followUp: 'TRANSFER', lines: body.lines, draftId: id })).status).toBe(200);
    expect((await read()).drafts.find((item) => item.id === id)).toBeUndefined();
  });

  it('is for the Director and the manager acting for them only', async () => {
    for (const as of ['officerA', 'managerAlone', 'developer']) {
      expect((await call(as, 'GET', '/credit-notes')).status, as).toBe(403);
      expect(
        (await call(as, 'POST', '/credit-notes/drafts', { invoiceId: randomUUID(), scope: 'TOTAL', lines: [], reason: '', followUp: null })).status,
        as,
      ).toBe(403);
    }
  });
});

const invoiceBody = (invoice: CorrectableInvoice) => ({
  invoiceId: invoice.id,
  scope: 'PARTIAL',
  lines: [{ lineId: invoice.lines[0]!.id, net: 100 }],
  reason: 'Erreur',
  followUp: 'NEXT_REMITTANCE',
  expectedLeft: invoice.left,
  draftId: null,
});
