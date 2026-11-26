import { billingData, formatCents, remittanceDraft } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import type { Actor } from '../../platform/database/actor';
import { databaseCode } from '../../platform/database/codes';
import { Database, type Transaction } from '../../platform/database/database';

let test: TestApp;
let reference = 80_000;
let chequeNumber = 5_000_000;
let manual = 9_500;
let siren = 0;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const read = async (as = 'director') => {
  const answer = await call(as, 'GET', '/billing');
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return billingData.parse(answer.body);
};
const year = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 4);
const written = async () =>
  (await rows<{ documents: string; numbers: string }>(
    "SELECT (SELECT count(*) FROM billing_documents) AS documents, (SELECT coalesce(sum(last_value), 0) FROM number_sequences WHERE kind <> 'CASE') AS numbers",
  ))[0]!;

/** A creditor at 8 %, with an opening fee of 50 € and a confirmed account. */
const creditorWith = async (name: string) => {
  const [creditor] = await rows<{ id: string }>(
    'INSERT INTO creditors (name, legal_name, address, postal_code, city, siren) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [name, `${name} SAS`, '14 rue des Tanneurs', '69007', 'Lyon', String(402_000_000 + (siren += 1))],
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
  return { creditor: creditor!.id, mandate: mandate!.id, siren: String(402_000_000 + siren) };
};
/** A case paid by a cheque cashed yesterday, then remitted: the invoice of the commission is made by the validation. */
const remitted = async (name: string) => {
  const made = await creditorWith(name);
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name, siren) VALUES ('COMPANY', 'Débiteur', $1) RETURNING id", [
    String(510_000_000 + reference),
  ]);
  const [opened] = await rows<{ id: string }>(
    "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, mandate_id, status) VALUES ($1, $2, $3, $4, $5, 'OVERDUE') RETURNING id",
    [`LGR-2026-${(reference += 1)}`, made.creditor, debtor!.id, test.s.officerA, made.mandate],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', '2026-06-01', '2026-07-01', 150000, 150000)",
    [opened!.id, made.creditor],
  );
  const cheque = { method: 'CHEQUE', amount: 150_000, chequeNumber: String((chequeNumber += 1)), bank: 'Banque Rhône', receivedOn: '2026-11-02', depositedOn: null };
  expect((await call('officerA', 'POST', `/cases/${opened!.id}/payments`, cheque)).status).toBe(204);
  for (const { id, version } of await rows<{ id: string; version: number }>('SELECT id, version FROM payments WHERE case_id = $1', [opened!.id]))
    expect((await call('officerA', 'PUT', `/cases/${opened!.id}/payments/${id}`, { status: 'CASHED', version })).status).toBe(204);
  await rows("UPDATE payments SET settled_at = now() - interval '1 day' WHERE case_id = $1", [opened!.id]);
  const shown = remittanceDraft.parse((await call('director', 'GET', '/remittances/draft')).body);
  const ready = shown.rows.filter((item) => item.state === 'READY');
  const done = await call('director', 'POST', '/remittances', {
    until: shown.until,
    expected: ready.map((item) => ({ creditorId: item.creditorId, toPay: item.toPay, accountId: item.accountId! })),
    retained: [],
  });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return made;
};
/** An invoice that no remittance settled, entered as the remittances write theirs. */
const lone = async (creditor: string, net: number) => {
  const id = randomUUID();
  const vat = Math.round(net * 0.2);
  await rows(
    `INSERT INTO billing_documents (id, kind, number, creditor_id, issued_on, net_cents, vat_cents, gross_cents, created_by)
     VALUES ($1, 'INVOICE', $2, $3, (now() AT TIME ZONE 'Europe/Paris')::date, $4, $5, $6, $7)`,
    [id, `FA-${year()}-${(manual += 1)}`, creditor, net, vat, net + vat, test.s.director],
  );
  await rows("INSERT INTO billing_lines (document_id, label, net_cents, vat_cents, gross_cents) VALUES ($1, 'Frais de procédure', $2, $3, $4)", [
    id,
    net,
    vat,
    net + vat,
  ]);
  return id;
};
/** A credit note on an invoice, as `app.issue_credit_note` writes it. */
const credit = async (invoice: string, creditor: string, net: number) => {
  const vat = Math.round(net * 0.2);
  await rows(
    `INSERT INTO billing_documents (kind, number, creditor_id, issued_on, net_cents, vat_cents, gross_cents, corrected_id, reason, scope, follow_up, created_by)
     VALUES ('CREDIT_NOTE', $1, $2, (now() AT TIME ZONE 'Europe/Paris')::date, $3, $4, $5, $6, 'Erreur de taux', 'PARTIAL', 'DEDUCTED', $7)`,
    [`AV-${year()}-${(manual += 1)}`, creditor, net, vat, net + vat, invoice, test.s.director],
  );
};

beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

describe('the billing of the firm', () => {
  it('is read by the Director and by the manager acting for them, and by nobody else', async () => {
    for (const as of ['director', 'manager']) expect((await call(as, 'GET', '/billing')).status, as).toBe(200);
    const body = { type: 'INVOICE', templateId: 'forfait', clientId: test.s.creditorA, lines: [{ label: 'Forfait', quantity: 1, unitPrice: 45_000 }], terms: [], draft: false };
    for (const as of ['officerA', 'officerB', 'developer']) {
      expect(await call(as, 'GET', '/billing'), as).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
      expect(await call(as, 'POST', '/billing', body), as).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    }
    for (const as of ['partnerA', 'debtorA']) expect((await call(as, 'GET', '/billing')).status, as).toBeGreaterThanOrEqual(401);
    expect((await test.call('GET', '/staff/billing')).status).toBe(401);
  });

  it('shows nothing that does not exist: no invoice yet, no quote, no contract, and the number the first invoice would take', async () => {
    const data = await read();
    expect(data.documents).toEqual([]);
    expect(data.nextNumbers).toEqual({ INVOICE: `FA-${year()}-0001` });
    expect(data.stats.map((item) => item.value)).toEqual([`${formatCents(0)} HT`, `${formatCents(0)} HT`, formatCents(0)]);
    expect(data.stats.map((item) => item.label)).toEqual([`Facturé en ${year()}`, expect.stringMatching(/^Facturé en \p{L}+$/u), 'À encaisser']);
    // The clients are the creditors in activity, as they are recorded.
    expect(data.clients.map((item) => item.id)).toEqual(expect.arrayContaining([test.s.creditorA, test.s.creditorB]));
    // The identity of the firm comes from the settings, brackets included.
    expect(data.firm).toMatchObject({ name: 'LEGAREC', siren: '[SIREN]', vat: '[N° TVA]' });
  });

  it('lists the invoices issued, with the status the remittance and the credit notes give them', async () => {
    const delta = await remitted('Matériaux Delta');
    await rows("INSERT INTO creditor_contacts (creditor_id, name, title, email, is_main) VALUES ($1, 'Hélène Brun', 'Directrice financière', 'hb@delta.test', true)", [
      delta.creditor,
    ]);
    const issued = await lone(delta.creditor, 100_000);
    const partly = await lone(delta.creditor, 50_000);
    await credit(partly, delta.creditor, 10_000);
    const cancelled = await lone(delta.creditor, 20_000);
    await credit(cancelled, delta.creditor, 20_000);

    const data = await read('manager');
    const mine = data.documents.filter((item) => item.client === 'Matériaux Delta');
    expect(mine).toHaveLength(4);
    expect(mine.every((item) => item.type === 'INVOICE' && item.duration === null && item.idLine === `SIREN ${delta.siren.replace(/(\d{3})(?=\d)/gu, '$1 ')}`)).toBe(true);
    const commission = mine.find((item) => !([issued, partly, cancelled] as string[]).includes(item.id))!;
    // 8 % of 1 500 € and the opening fee of 50 €, with VAT.
    expect(commission).toMatchObject({
      number: `FA-${year()}-0001`,
      subject: 'Honoraires de recouvrement · Frais d’ouverture de dossier',
      amount: 20_400,
      status: 'Déduite du reversement',
      tone: 'success',
    });
    expect(mine.find((item) => item.id === issued)).toMatchObject({ subject: 'Frais de procédure', amount: 120_000, status: 'Émise', tone: 'marine' });
    expect(mine.find((item) => item.id === partly)).toMatchObject({ status: 'Avoir partiel', tone: 'warning' });
    expect(mine.find((item) => item.id === cancelled)).toMatchObject({ status: 'Annulée par avoir', tone: 'neutral' });
    expect(data.nextNumbers).toEqual({ INVOICE: `FA-${year()}-0002` });
    expect(data.clients.find((item) => item.id === delta.creditor)).toEqual({
      id: delta.creditor,
      name: 'Matériaux Delta',
      legal: 'Matériaux Delta SAS',
      siren: delta.siren.replace(/(\d{3})(?=\d)/gu, '$1 '),
      address: '14 rue des Tanneurs, 69007 Lyon',
      signer: 'Hélène Brun, Directrice financière',
    });
    // Invoiced before VAT, credit notes taken off; to collect: what no remittance settled, less the credit notes, with VAT.
    const net = 17_000 + 100_000 + 50_000 + 20_000 - 10_000 - 20_000;
    expect(data.stats[0]).toMatchObject({ value: `${formatCents(net)} HT`, sub: '4 factures, avoirs déduits' });
    expect(data.stats[2]).toMatchObject({ value: formatCents(120_000 + 48_000), sub: '2 factures non réglées', tone: 'warning' });
  });

  it('creates nothing from a template yet: no number is drawn, nothing is written', async () => {
    const before = await written();
    const body = { templateId: 'forfait', clientId: test.s.creditorA, lines: [{ label: 'Forfait', quantity: 1, unitPrice: 45_000 }], terms: [], draft: false };
    for (const type of ['INVOICE', 'QUOTE', 'CONTRACT'])
      for (const draft of [false, true])
        for (const as of ['director', 'manager'])
          expect(await call(as, 'POST', '/billing', { ...body, type, draft }), `${type} ${as}`).toMatchObject({
            status: 409,
            body: { code: 'NOT_AVAILABLE', type },
          });
    expect((await call('director', 'POST', '/billing', { ...body, type: 'CREDIT_NOTE' })).status).toBe(422);
    expect(await written()).toEqual(before);
  });

  it('is refused by PostgreSQL itself, whatever the route let through', async () => {
    const jobs = new Database(test.database.url('jobs'));
    const staff = (userId: string, role: 'DIRECTOR' | 'COLLECTION_MANAGER' | 'CLAIMS_OFFICER' | 'DEVELOPER', delegations: ('TECHNICAL' | 'ADMINISTRATIVE')[] = []) =>
      ({ kind: 'staff', userId, role, delegations }) satisfies Actor;
    const callers: [string, Database, Actor, string][] = [
      ['director', test.pool, staff(test.s.director, 'DIRECTOR'), 'object'],
      ['manager acting for the Director', test.pool, { ...staff(test.s.manager, 'COLLECTION_MANAGER', ['ADMINISTRATIVE']), actingFor: 'ADMINISTRATIVE' }, 'object'],
      // The delegation held, but not the one acted under.
      ['manager not acting', test.pool, staff(test.s.manager, 'COLLECTION_MANAGER', ['ADMINISTRATIVE']), '42501'],
      ['manager alone', test.pool, staff(test.s.manager, 'COLLECTION_MANAGER'), '42501'],
      ['claims officer', test.pool, staff(test.s.officerA, 'CLAIMS_OFFICER'), '42501'],
      ['developer', test.pool, staff(test.s.developer, 'DEVELOPER', ['TECHNICAL']), '42501'],
      // A role and delegations the tables do not give.
      ['liar', test.pool, { ...staff(test.s.officerA, 'CLAIMS_OFFICER', ['ADMINISTRATIVE']), actingFor: 'ADMINISTRATIVE' }, '42501'],
      ['creditor', test.pool, { kind: 'partner', userId: test.s.partnerA, creditorId: test.s.creditorA }, '42501'],
      ['debtor', test.pool, { kind: 'debtor', debtorId: test.s.debtorA }, '42501'],
      ['worker', jobs, { kind: 'worker', job: 'email' }, '42501'],
    ];
    try {
      const readings: [string, (tx: Transaction) => Promise<{ data: unknown }[]>][] = [
        ['billing_overview', (tx) => tx.$queryRaw<{ data: unknown }[]>`SELECT app.billing_overview() AS data`],
        ['credit_notes', (tx) => tx.$queryRaw<{ data: unknown }[]>`SELECT app.credit_notes() AS data`],
      ];
      for (const [name, reading] of readings)
        for (const [who, pool, actor, expected] of callers) {
          const answer = await pool
            .run(actor, async (tx) => typeof (await reading(tx))[0]?.data)
            .catch((error: unknown) => databaseCode(error) ?? String(error));
          expect(answer, `${name} for ${who}`).toBe(expected);
        }
    } finally {
      await jobs.close();
    }
  });
});
