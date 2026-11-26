import { documentsData, importedDocument } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { Database } from '../../platform/database/database';
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

describe('what a file may not hide', () => {
  const compressed = (inside: string) => {
    const stream = deflateSync(Buffer.from(inside, 'latin1'));
    return new Uint8Array([
      ...text('%PDF-1.7\n2 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ' + stream.length + ' >>\nstream\n'),
      ...stream,
      ...text('\nendstream\nendobj\n%%EOF\n'),
    ]);
  };
  /** A zip of one Word document, with the entries asked for. */
  const docx = (entries: Record<string, string>) => {
    const parts: Buffer[] = [];
    for (const [name, content] of Object.entries({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>', ...entries })) {
      const data = deflateRawSync(Buffer.from(content));
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(8, 8);
      head.writeUInt32LE(data.length, 18);
      head.writeUInt32LE(content.length, 22);
      head.writeUInt16LE(Buffer.byteLength(name), 26);
      parts.push(head, Buffer.from(name), data);
    }
    return new Uint8Array(Buffer.concat(parts));
  };
  const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it('opens the compressed objects of a PDF to look for code', () => {
    expect(checkFile(compressed('1 0 << /Type /Page >>'), 'application/pdf')).toBe('PDF');
    expect(checkFile(compressed('1 0 << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'), 'application/pdf')).toBeNull();
    expect(checkFile(compressed('1 0 << /AA << /O 3 0 R >> >>'), 'application/pdf')).toBeNull();
    // Objects that cannot be opened are not taken on trust.
    expect(checkFile(text('%PDF-1.7\n2 0 obj << /Type /ObjStm /Filter /FlateDecode >>\nstream\nnot zlib\nendstream\n%%EOF'), 'application/pdf')).toBeNull();
  });

  it('refuses a Word document with an embedded object, a macro or a link to the outside', () => {
    expect(checkFile(docx({}), WORD)).toBe('DOCX');
    expect(checkFile(docx({ 'word/embeddings/oleObject1.bin': 'x' }), WORD)).toBeNull();
    expect(checkFile(docx({ 'word/vbaProject.bin': 'x' }), WORD)).toBeNull();
    expect(checkFile(docx({ 'word/_rels/settings.xml.rels': '<Relationship Target="https://exemple.test/t.dotm" TargetMode="External"/>' }), WORD)).toBeNull();
  });

  it('never attaches a document by a number too short to tell', async () => {
    await makeCase(test.s.officerA, 'F-12');
    expect((await imported('officerA', PDF('(F-12) '))).status).toBe('TO_FILE');
  });

  it('is shared by PostgreSQL only: the team cannot write the share by hand', async () => {
    await makeCase(test.s.officerA, 'CH-2026-7777');
    const { id } = await imported('officerA', PDF('(CH-2026-7777) '));
    await worker.run();
    const officer = { kind: 'staff', userId: test.s.officerA, role: 'CLAIMS_OFFICER', delegations: [] } as const;
    await expect(
      test.app.get(Database).run(officer, (tx) => tx.$executeRaw`UPDATE documents SET shared_with_creditor_at = now() WHERE id = ${id}::uuid`),
    ).rejects.toThrow(/permission denied/u);
    expect((await share('officerA', id)).status).toBe(204);
    expect(await rows("SELECT action FROM audit_log WHERE action = 'DOCUMENT_SHARED' AND entity_id = $1", [id])).toHaveLength(1);
  });

  it('notes a download by the Director outside of their cases', async () => {
    await makeCase(test.s.officerA, 'CH-2026-8888');
    const { id } = await imported('officerA', PDF('(CH-2026-8888) '));
    await worker.run();
    expect((await test.call('GET', `/staff/documents/${id}/file`, { as: 'director' })).status).toBe(200);
    expect((await test.call('GET', `/staff/documents/${id}/file`, { as: 'officerA' })).status).toBe(200);
    expect(await rows("SELECT actor_id FROM audit_log WHERE action = 'DOCUMENT_DOWNLOADED' AND entity_id = $1", [id])).toEqual([{ actor_id: test.s.director }]);
  });
});
