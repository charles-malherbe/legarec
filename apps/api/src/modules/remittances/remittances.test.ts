import { remittanceBatch, remittanceDraft } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
let reference = 60_000;
let chequeNumber = 3_000_000;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const draft = async () => remittanceDraft.parse((await call('director', 'GET', '/remittances/draft')).body);

/** A creditor at 8 %, with an opening fee of 50 €, and a confirmed account unless said otherwise. */
const creditorWith = async (name: string, account = true) => {
  const [creditor] = await rows<{ id: string }>('INSERT INTO creditors (name) VALUES ($1) RETURNING id', [name]);
  const [mandate] = await rows<{ id: string }>(
    `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, discount_max_bp,
       litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
     VALUES ($1, '2026-01-01', 800, 1200, 5000, 6, 500, true, 'ECB_PLUS_TEN', true, 5, 'BUSINESS') RETURNING id`,
    [creditor!.id],
  );
  if (account)
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
    String(300_000_000 + reference),
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
  return made!.id;
};

beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

describe('a batch of remittances', () => {
  it('retains the commission with its tax and the opening fee once, invoices it, and remits the rest', async () => {
    const delta = await creditorWith('Reversement Delta');
    await paidCase(delta, [100_000, 50_000]);
    const row = (await draft()).rows.find((item) => item.creditorId === delta.creditor)!;
    // 8 % of 1 500 € and 50 € of opening, before tax; 20 % of tax.
    expect(row).toMatchObject({ state: 'READY', payments: 2, collected: 150_000, feesNet: 17_000, feesVat: 3_400, feesGross: 20_400, toPay: 129_600 });
    expect(row.account).toBe('FR76 •••• •••• 1234');
  });

  it('keeps out a creditor without a confirmed account, and one retained with its reason', async () => {
    const without = await creditorWith('Sans Compte', false);
    await paidCase(without, [20_000]);
    const kept = await creditorWith('Retenu Delta');
    await paidCase(kept, [30_000]);
    const shown = await draft();
    expect(shown.rows.find((item) => item.creditorId === without.creditor)?.state).toBe('NO_ACCOUNT');
    const keptRow = shown.rows.find((item) => item.creditorId === kept.creditor)!;
    const ready = shown.rows.filter((item) => item.state === 'READY' && item.creditorId !== kept.creditor);
    const expectedTotal = ready.reduce((sum, item) => sum + item.toPay, 0);
    const validate = (total: number) =>
      call('manager', 'POST', '/remittances', {
        until: shown.until,
        expectedTotal: total,
        expectedTransfers: ready.length,
        retained: [{ creditorId: kept.creditor, reason: 'Mandat en cours de renégociation' }],
      });
    // A batch changed since it was shown is refused.
    expect((await validate(expectedTotal + 1)).status).toBe(409);
    const done = await validate(expectedTotal);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const { id } = done.body as { id: string };
    const batch = remittanceBatch.parse((await call('director', 'GET', `/remittances/${id}`)).body);
    expect(batch).toMatchObject({ status: 'VALIDATED', total: expectedTotal, transfers: ready.length });
    expect(batch.rows.find((item) => item.creditorId === kept.creditor)).toMatchObject({
      state: 'RETAINED',
      reason: 'Mandat en cours de renégociation',
      invoice: null,
    });
    expect(batch.rows.find((item) => item.state === 'READY')?.invoice).toMatch(/^FA-\d{4}-\d{4}$/u);
    // Remitted payments are gone from the next batch; those retained or without account are still there.
    const next = await draft();
    expect(next.rows.map((item) => item.creditorId).sort()).toEqual([without.creditor, kept.creditor].sort());
    expect(next.rows.find((item) => item.creditorId === kept.creditor)?.toPay).toBe(keptRow.toPay);
    // The invoice never changes.
    await expect(rows("UPDATE billing_documents SET net_cents = 0 WHERE number LIKE 'FA-%'")).rejects.toThrow(/append-only/u);
    expect(await rows("SELECT 1 FROM audit_log WHERE action = 'REMITTANCES_VALIDATED' AND entity_id = $1", [id])).toHaveLength(1);

    const paid = (paidOn: string, total = expectedTotal) => call('director', 'POST', `/remittances/${id}/paid`, { paidOn, expectedTotal: total });
    expect((await paid('2099-01-01')).status).toBe(422);
    expect((await paid(shown.until, expectedTotal + 1)).status).toBe(409);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    expect((await paid(today)).status).toBe(204);
    expect(remittanceBatch.parse((await call('director', 'GET', `/remittances/${id}`)).body).status).toBe('PAID');
    expect((await paid(today)).status).toBe(409);
  });

  it('is for the Director and the manager acting for them only', async () => {
    expect((await call('officerA', 'GET', '/remittances/draft')).status).toBe(403);
    expect((await call('managerAlone', 'GET', '/remittances/draft')).status).toBe(403);
  });
});
