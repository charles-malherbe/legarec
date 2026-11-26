import { depositsData, plansData, portalCase, portalCases, portalDashboard, portalDocuments } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { xlsx, zip } from '../../../test/zip';

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

  const deposits = async (as = 'manager') => depositsData.parse((await call(as, 'GET', '/staff/deposits')).body);
  const pendingOf = async (name: string) => (await deposits()).items.find((item) => item.debtor === name)!;

  it('waits for the team before it becomes a case (question 155), then opens one held by nobody under the mandate in force', async () => {
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
    const before = await rows<{ cases: number; debtors: number }>(
      'SELECT (SELECT count(*)::int FROM cases) AS cases, (SELECT count(*)::int FROM debtors) AS debtors',
    );
    const deposited = await call('partnerA', 'POST', '/partner/portal/claims', claim({ attachments: [attachment] }));
    expect(deposited.status, JSON.stringify(deposited.body)).toBe(204);
    // Nothing of the debtor before the team: neither a case nor a debtor, and the file waits.
    expect(await rows('SELECT (SELECT count(*)::int FROM cases) AS cases, (SELECT count(*)::int FROM debtors) AS debtors')).toEqual(before);
    expect(await rows('SELECT case_id FROM documents WHERE id = $1', [attachment])).toEqual([{ case_id: null }]);
    // The same file cannot go with a second deposit that waits (the same answer as a file that is not its own).
    expect((await call('partnerA', 'POST', '/partner/portal/claims', claim({ debtor: 'Autre Débiteur', siret: '', attachments: [attachment] }))).status).toBe(
      409,
    );
    const waiting = await pendingOf('Menuiserie Arnal');
    // The liar, let in by the guard as a Director, reads none of them in PostgreSQL.
    expect(depositsData.parse((await call('liar', 'GET', '/staff/deposits')).body)).toEqual({ items: [], count: 0 });
    expect(waiting).toMatchObject({
      creditorId: test.s.creditorA,
      identifier: 'SIRET 512 334 871 00088',
      total: 486_000,
      files: 1,
      email: 'Compta@Arnal.example',
    });
    // Read by the Director and the manager alone; the creditor reads none of them.
    expect((await deposits('director')).items.some((item) => item.id === waiting.id)).toBe(true);
    for (const as of ['officerA', 'developer', 'partnerA']) expect((await call(as, 'GET', '/staff/deposits')).status, as).toBe(403);
    expect((await call('officerA', 'POST', `/staff/deposits/${waiting.id}/accept`, { expectedTotal: 486_000 })).status).toBe(403);
    // What was shown is what is opened.
    expect((await call('manager', 'POST', `/staff/deposits/${waiting.id}/accept`, { expectedTotal: 1 })).body).toEqual({ code: 'CHANGED' });
    const accepted = await call('manager', 'POST', `/staff/deposits/${waiting.id}/accept`, { expectedTotal: 486_000 });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const caseId = (accepted.body as { caseId: string }).caseId;
    expect((await call('manager', 'POST', `/staff/deposits/${waiting.id}/accept`, { expectedTotal: 486_000 })).body).toEqual({ code: 'CHANGED' });
    const [opened] = await rows<{ id: string; officer_id: string | null; status: string; reference: string }>(
      "SELECT c.id, c.officer_id, c.status, c.reference FROM cases c JOIN debtors d ON d.id = c.debtor_id WHERE d.siren = '512334871'",
    );
    expect(opened).toMatchObject({ id: caseId, officer_id: null, status: 'NEW' });
    expect(opened!.reference).toMatch(/^LGR-\d{4}-\d{5}$/u);
    expect(await rows('SELECT kind, status, source FROM case_contacts WHERE case_id = $1 ORDER BY kind', [caseId])).toEqual([
      { kind: 'PHONE', status: 'UNVERIFIED', source: 'CREDITOR' },
      { kind: 'EMAIL', status: 'UNVERIFIED', source: 'CREDITOR' },
    ]);
    expect(await rows('SELECT case_id FROM documents WHERE id = $1', [attachment])).toEqual([{ case_id: caseId }]);
    expect(((await call('manager', 'GET', `/staff/cases/${caseId}`)).body as { principal: number }).principal).toBe(486_000);
    expect(
      await rows(
        "SELECT title, visible_to_creditor FROM case_events WHERE case_id = $1 AND kind IN ('CASE_DEPOSITED', 'DEPOSIT_ACCEPTED') ORDER BY occurred_at",
        [caseId],
      ),
    ).toEqual([
      { title: 'Créance déposée par le créancier', visible_to_creditor: true },
      { title: 'Dossier ouvert par le cabinet', visible_to_creditor: true },
    ]);
    // Once decided, the deposit keeps nothing of the debtor.
    expect(await rows('SELECT status, debtor_name, siret, email, invoices, opened_case FROM claim_deposits WHERE id = $1', [waiting.id])).toEqual([
      { status: 'ACCEPTED', debtor_name: null, siret: null, email: null, invoices: null, opened_case: caseId },
    ]);
    expect(await rows("SELECT action FROM audit_log WHERE action LIKE 'DEPOSIT%' AND entity_id = $1", [caseId])).toEqual([{ action: 'DEPOSIT_ACCEPTED' }]);
    expect(portalCases.parse((await call('partnerA', 'GET', '/partner/portal/cases')).body).items.some((item) => item.id === caseId)).toBe(true);
    expect(portalCases.parse((await call('partnerB', 'GET', '/partner/portal/cases')).body).items.some((item) => item.id === caseId)).toBe(false);
    // Twice: refused, its own case being open.
    expect(await call('partnerA', 'POST', '/partner/portal/claims', claim())).toMatchObject({ status: 409, body: { code: 'CASE_EXISTS' } });
    await rows(
      `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
       VALUES ($1, '2026-01-01', 800, 1200, 6, 500, true, 'NONE', true, 5, 'BUSINESS')`,
      [test.s.creditorB],
    );
    // Under another name: the same answer as for any SIREN, the name it gave on its case, a check asked of the team.
    expect((await call('partnerB', 'POST', '/partner/portal/claims', claim({ debtor: 'Autre Nom SARL' }))).status).toBe(204);
    const other = await pendingOf('Autre Nom SARL');
    expect((await call('director', 'POST', `/staff/deposits/${other.id}/accept`, { expectedTotal: other.total })).status).toBe(200);
    // In their own name.
    expect(await rows('SELECT decided_by, on_behalf_of_id FROM claim_deposits WHERE id = $1', [other.id])).toEqual([
      { decided_by: test.s.director, on_behalf_of_id: null },
    ]);
    const theirs = portalCases.parse((await call('partnerB', 'GET', '/partner/portal/cases')).body).items.find((item) => item.debtor === 'Autre Nom SARL');
    expect(theirs).toBeDefined();
    expect(await rows("SELECT visible_to_creditor FROM case_events WHERE case_id = $1 AND kind = 'DEPOSITED_NAME'", [theirs!.id])).toEqual([
      { visible_to_creditor: false },
    ]);
    // A debtor first named by a creditor: the team, opening under the confirmed name, replaces it.
    expect(await rows("SELECT name, name_confirmed FROM debtors WHERE siren = '512334871'")).toEqual([{ name: 'Menuiserie Arnal', name_confirmed: false }]);
  });

  it('is refused with a reason, kept 30 days without what the creditor gave nor its files, and never in the audit', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n% refusée\n%%EOF\n');
    const file = await test.call('POST', '/partner/portal/attachments', { as: 'partnerA', file: pdf, headers: { 'content-type': 'application/pdf' } });
    expect(file.status, JSON.stringify(file.body)).toBe(200);
    const { id: attachment } = file.body as { id: string };
    const sent = await call('partnerA', 'POST', '/partner/portal/claims', claim({ debtor: 'Studio Refusé', siret: '', attachments: [attachment] }));
    expect(sent.status, JSON.stringify(sent.body)).toBe(204);
    const waiting = await pendingOf('Studio Refusé');
    expect(waiting.identifier).toBe('Particulier');
    expect((await call('manager', 'POST', `/staff/deposits/${waiting.id}/refuse`, { reason: 'non' })).status).toBe(422);
    const reason = 'Facture déjà réglée selon le créancier lui-même';
    expect((await call('manager', 'POST', `/staff/deposits/${waiting.id}/refuse`, { reason })).status).toBe(204);
    expect((await call('manager', 'POST', `/staff/deposits/${waiting.id}/refuse`, { reason })).body).toEqual({ code: 'CHANGED' });
    expect((await call('manager', 'POST', `/staff/deposits/${waiting.id}/accept`, { expectedTotal: waiting.total })).body).toEqual({ code: 'CHANGED' });
    expect((await call('manager', 'POST', `/staff/deposits/${randomUUID()}/refuse`, { reason })).status).toBe(404);
    expect(await rows('SELECT status, reason, debtor_name, invoices FROM claim_deposits WHERE id = $1', [waiting.id])).toEqual([
      { status: 'REFUSED', reason, debtor_name: null, invoices: null },
    ]);
    expect(JSON.stringify(await rows("SELECT params FROM audit_log WHERE action = 'DEPOSIT_REFUSED'"))).not.toContain('réglée');
    // Its file, without a case, goes 30 days after it was sent, with those never deposited.
    await rows("UPDATE documents SET created_at = now() - interval '31 days' WHERE id = $1", [attachment]);
    const { admin } = test.database;
    await admin.query('SET ROLE legarec_retention');
    try {
      expect((await admin.query<{ removed: number }>('SELECT app.purge_waiting_files() AS removed')).rows[0]!.removed).toBeGreaterThanOrEqual(1);
    } finally {
      await admin.query('RESET ROLE');
    }
    expect(await rows('SELECT purged_at IS NOT NULL AS purged, title FROM documents WHERE id = $1', [attachment])).toEqual([
      { purged: true, title: 'Pièce supprimée' },
    ]);
    expect((await deposits()).items.some((item) => item.id === waiting.id)).toBe(false);
    // Purged 30 days after the decision; one waiting stays.
    await rows("UPDATE claim_deposits SET decided_at = now() - interval '31 days' WHERE id = $1", [waiting.id]);
    await rows("DELETE FROM claim_deposits WHERE status <> 'PENDING' AND decided_at < now() - interval '30 days'");
    expect(await rows('SELECT id FROM claim_deposits WHERE id = $1', [waiting.id])).toEqual([]);
  });

  it('keeps to 500 a day for a creditor', async () => {
    await rows(
      `INSERT INTO claim_deposits (creditor_id, deposited_by, debtor_name, invoices, total_cents, invoice_count)
       SELECT $1, $2, 'X', '[{"number":"N","issuedOn":"2026-01-01","dueOn":"2026-02-01","amount":1}]'::jsonb, 1, 1 FROM generate_series(1, 500)`,
      [test.s.creditorB, test.s.partnerB],
    );
    const refused = await call('partnerB', 'POST', '/partner/portal/claims', claim({ debtor: 'Un de trop', siret: '' }));
    expect(refused.status, JSON.stringify(refused.body)).toBe(429);
    await rows("DELETE FROM claim_deposits WHERE creditor_id = $1 AND debtor_name = 'X'", [test.s.creditorB]);
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
    // Deposited, waiting for the team (question 155): no case before.
    expect(await rows("SELECT count(*)::int AS n FROM case_invoices WHERE number IN ('L-1', 'L-2')")).toEqual([{ n: 0 }]);
    expect(await rows("SELECT invoice_count, total_cents::int AS total FROM claim_deposits WHERE debtor_name = 'Garage Valmont'")).toEqual([
      { invoice_count: 2, total: 325_050 },
    ]);
    expect((await call('partnerA', 'POST', `/partner/portal/imports/${report.id}/confirm`)).status).toBe(404);
    // Confirmed, it keeps no copy of the debtors.
    expect(await rows('SELECT claims, errors FROM claim_imports WHERE id = $1', [report.id])).toEqual([{ claims: [], errors: [] }]);
  });

  it('reads an Excel workbook, and refuses one that would inflate beyond its ceiling', async () => {
    const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const head = ['debiteur', 'siret', 'email', 'telephone', 'adresse', 'numero_facture', 'date_emission', 'date_echeance', 'montant_ttc'];
    const book = xlsx([head, ['Atelier Brun', '', '', '', '2 rue Haute, 69001 Lyon', 'X-1', '01/09/2026', '01/10/2026', '980,00']]);
    const read = await send('partnerA', book, XLSX);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ lines: 1, valid: 1, total: 98_000 });
    const bomb = zip([{ name: 'xl/worksheets/sheet1.xml', data: '0'.repeat(25 * 1024 * 1024) }]);
    expect(await send('partnerA', bomb, XLSX)).toMatchObject({ status: 422, body: { code: 'UNREADABLE' } });
  });

  it('cuts a number too long in what it says of a line', async () => {
    const answer = await send(
      'partnerA',
      `debiteur;siret;email;telephone;adresse;numero_facture;date_emission;date_echeance;montant_ttc\r\nX;123;;;;${'9'.repeat(5000)};;;1`,
    );
    const { errors } = answer.body as { errors: { message: string }[] };
    expect(answer.status).toBe(200);
    expect(errors[0]!.message.length).toBeLessThan(80);
  });

  it('refuses what is not a table of claims', async () => {
    expect((await send('partnerA', '<html><script>alert(1)</script></html>', 'text/html')).status).toBe(422);
    expect((await send('partnerA', new Uint8Array([0xff, 0xfe, 0x00]), 'text/csv')).status).toBe(422);
    const missing = (await send('partnerA', 'debiteur;montant\r\nX;10')).body as { errors: { message: string }[]; valid: number };
    expect(missing.valid).toBe(0);
    expect(missing.errors[0]?.message).toMatch(/^Colonnes manquantes/u);
  });
});

describe('the documents of a creditor', () => {
  let count = 0;
  /** A file as the team keeps it, on a case or waiting for one. */
  const file = async (title: string, change: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      case_id: test.s.cases.ofA,
      creditor_id: test.s.creditorA,
      category: 'EVIDENCE',
      kind: 'PDF',
      title,
      original_name: `piece-${(count += 1)}.pdf`,
      storage_key: randomUUID(),
      size_bytes: 215_040,
      sha256: 'a'.repeat(64),
      source: 'UPLOAD',
      scan_status: 'CLEAN',
      scanned_at: new Date(),
      ...change,
    };
    const names = Object.keys(row);
    const [made] = await rows<{ id: string }>(
      `INSERT INTO documents (${names.join(', ')}) VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return made!.id;
  };
  const read = async (as: string) => {
    const answer = await call(as, 'GET', '/partner/portal/documents');
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return portalDocuments.parse(answer.body).items;
  };

  it('are those shared with it on its own cases, and never those of another creditor', async () => {
    const shared = { shared_with_creditor_at: new Date(), shared_by: test.s.manager };
    const ofA = await file('Mise en demeure du 02/11/2026', shared);
    const kept = await file('Note interne du gestionnaire');
    const ofB = await file('Quittance du 05/11/2026', { ...shared, case_id: test.s.cases.ofB, creditor_id: test.s.creditorB, kind: 'JPEG' });
    // Sent by the creditor itself, waiting for its claim: it reads the row, yet it is no document of the team.
    const waiting = await file('Pièce déposée', { case_id: null, creditor_id: null, source: 'CREDITOR', uploaded_by_creditor: test.s.creditorA });
    const erased = await file('Pièce effacée', { ...shared, purged_at: new Date() });

    const [reference] = await rows<{ reference: string }>('SELECT reference FROM cases WHERE id = $1', [test.s.cases.ofA]);
    const mine = await read('partnerA');
    expect(mine).toEqual([
      { id: ofA, name: 'Mise en demeure du 02/11/2026', meta: `PDF · 210 Ko · dossier ${reference!.reference}`, extension: 'PDF', available: false },
    ]);
    for (const id of [kept, ofB, waiting, erased]) expect(mine.map((item) => item.id)).not.toContain(id);
    const theirs = await read('partnerB');
    expect(theirs.map((item) => item.id)).toEqual([ofB]);
    expect(theirs[0]).toMatchObject({ extension: 'JPG' });
    // Neither the name of the file as it was sent, nor where it is kept.
    expect(JSON.stringify([mine, theirs])).not.toMatch(/piece-|storage|sha256/u);
  });

  it('are closed to the team and to who is not signed in', async () => {
    for (const as of ['director', 'manager', 'officerA', 'developer', 'debtorA'])
      expect((await call(as, 'GET', '/partner/portal/documents')).status, as).toBeGreaterThanOrEqual(401);
    expect((await test.call('GET', '/partner/portal/documents')).status).toBe(401);
  });
});
