import { documentsData, importedDocument } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import { checkFile } from './file-type';

let test: TestApp;
let worker: MailWorker;
let creditor: string;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const text = (value: string) => new TextEncoder().encode(value);
const PDF = (extra = '') => text(`%PDF-1.4\n1 0 obj << /Type /Catalog ${extra}>> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
/** As the portal sends it: the file alone, without its name. */
const send = (as: string, file: Uint8Array, type = 'application/pdf') =>
  test.call('POST', '/staff/documents/import', { as, file, headers: { 'content-type': type, 'idempotency-key': randomUUID() } });
const imported = async (as: string, file: Uint8Array) => {
  const answer = await send(as, file);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return importedDocument.parse(answer.body);
};
const list = async (as: string) => documentsData.parse((await test.call('GET', '/staff/documents', { as })).body);
const share = (as: string, id: string) => test.call('POST', `/staff/documents/${id}/share`, { as, headers: { 'idempotency-key': randomUUID() } });
let reference = 80_000;
const makeCase = async (officer: string | null, invoice: string) => {
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'Paul Meunier') RETURNING id");
  reference += 1;
  const [made] = await rows<{ id: string }>('INSERT INTO cases (reference, creditor_id, debtor_id, officer_id) VALUES ($1, $2, $3, $4) RETURNING id', [
    `LGR-2026-${reference}`,
    creditor,
    debtor!.id,
    officer,
  ]);
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, $3, '2026-09-01', '2026-10-01', 1000, 1000)",
    [made!.id, creditor, invoice],
  );
  return made!.id;
};

beforeAll(async () => {
  test = await startApp();
  worker = startMailWorker(test);
  creditor = (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Crédit Horizon') RETURNING id"))[0]!.id;
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});

describe('a file received', () => {
  it('goes with the case whose invoice number it carries, among those one acts on', async () => {
    const id = await makeCase(test.s.officerA, 'CH-2026-0871');
    const { id: document, status } = await imported('officerA', PDF('/Title (Facture CH-2026-0871 relance) '));
    expect(status).toBe('ATTACHED');
    expect(await rows('SELECT case_id, category, title, scan_status FROM documents WHERE id = $1', [document])).toEqual([
      { case_id: id, category: 'INVOICE', title: 'Document importé', scan_status: 'PENDING' },
    ]);
    // Someone else's case is never chosen.
    expect((await imported('officerB', PDF('(CH-2026-0871) '))).status).toBe('TO_FILE');
  });

  it('is to be filed otherwise, seen by its sender and the manager only', async () => {
    const { id, status } = await imported('officerA', PDF());
    expect(status).toBe('TO_FILE');
    expect((await rows<{ original_name: string }>('SELECT original_name FROM documents WHERE id = $1', [id]))[0]!.original_name).toMatch(
      /^Document importé le \d{2}\/\d{2}\/\d{4}\.pdf$/u,
    );
    expect((await list('officerA')).items.some((item) => item.id === id)).toBe(true);
    expect((await list('manager')).items.find((item) => item.id === id)).toMatchObject({ status: 'Analyse en cours', caseId: null });
    expect((await list('officerB')).items.some((item) => item.id === id)).toBe(false);
    expect((await list('director')).items.some((item) => item.id === id)).toBe(false);
  });

  it('is refused when its real type is not the one announced, or when a PDF carries code', async () => {
    for (const [file, type] of [
      [text('MZ\u0090\u0000 programme'), 'application/pdf'],
      [PDF(), 'image/png'],
      [PDF('/OpenAction << /S /JavaScript /JS (app.alert(1)) >> '), 'application/pdf'],
      [PDF('/J#61vaScript (x) '), 'application/pdf'],
      [text('texte'), 'text/plain'],
    ] as const) {
      expect((await send('officerA', file, type)).status).toBe(415);
    }
    expect((await send('officerA', new Uint8Array(0))).status).toBe(422);
    expect(
      (await test.call('POST', '/staff/documents/import', { as: 'officerA', body: { file: 'x' }, headers: { 'idempotency-key': randomUUID() } })).status,
    ).toBe(422);
    expect(checkFile(PDF('/URI (https://exemple.test) '), 'application/pdf')).toBe('PDF');
  });

  it('is read only once ClamAV found it clean, under a neutral name; infected, the file is erased', async () => {
    await makeCase(test.s.officerA, 'CH-2026-0999');
    const clean = await imported('officerA', PDF('(CH-2026-0999) '));
    const sick = await imported('officerA', text(`%PDF-1.4\n(CH-2026-0999)\n${EICAR}\n%%EOF`));
    expect((await test.call('GET', `/staff/documents/${clean.id}/file`, { as: 'officerA' })).status).toBe(409);
    await worker.run();
    const file = await test.call('GET', `/staff/documents/${clean.id}/file`, { as: 'officerA' });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="document.pdf"');
    expect(new TextDecoder().decode(file.body as Uint8Array)).toContain('%PDF-1.4');
    expect(await rows('SELECT scan_status FROM documents WHERE id = $1', [sick.id])).toEqual([{ scan_status: 'INFECTED' }]);
    expect((await test.call('GET', `/staff/documents/${sick.id}/file`, { as: 'officerA' })).status).toBe(409);
    expect((await test.call('GET', `/staff/documents/${clean.id}/file`, { as: 'officerB' })).status).toBe(404);
    expect((await list('officerA')).items.find((item) => item.id === sick.id)?.status).toBe('Bloqué par l’antivirus');
  });
});

describe('sharing with the creditor', () => {
  it('only a clean document of a case one acts on, without the access code', async () => {
    await makeCase(test.s.officerA, 'CH-2026-1234');
    const { id } = await imported('officerA', PDF('(CH-2026-1234) '));
    expect((await share('officerA', id)).status).toBe(409);
    await worker.run();
    expect((await share('director', id)).status).toBe(403);
    expect((await share('officerB', id)).status).toBe(404);
    expect((await share('officerA', id)).status).toBe(204);
    expect((await list('officerA')).items.find((item) => item.id === id)?.status).toBe('Partagé au créancier');
    await rows('UPDATE documents SET shared_with_creditor_at = NULL WHERE id = $1', [id]);
    await expect(rows('UPDATE documents SET contains_access_code = true, shared_with_creditor_at = now() WHERE id = $1', [id])).rejects.toThrow(
      /documents_shared/u,
    );
    await rows('UPDATE documents SET contains_access_code = true WHERE id = $1', [id]);
    expect(await share('officerA', id)).toMatchObject({ status: 409, body: { code: 'CONTAINS_ACCESS_CODE' } });
    const unfiled = await imported('manager', PDF());
    expect(await share('manager', unfiled.id)).toMatchObject({ status: 409, body: { code: 'TO_FILE' } });
  });
});
