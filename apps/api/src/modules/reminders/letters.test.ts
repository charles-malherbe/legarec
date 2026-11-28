import { firmGroups } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import type { FormClient } from '../../letters/mysendingbox';
import { letterNamed, trackOf } from '../../letters/mysendingbox';
import { postalOf, streetLinesOf } from '../../letters/postal';
import { sweepLetters } from './letter-events.jobs';
import { PLACEHOLDER } from '../../platform/pdf/pdf';
import { Vault } from '../vault/vault';

let test: TestApp;
let worker: MailWorker;
let reference = 70_000;
let siren = 553_100_000;
/** What MySendingBox was asked, and what it answers next. */
const asked: { url: string; headers: Record<string, string>; fields: Record<string, string>; file: Blob | null }[] = [];
let answer: () => Promise<{ status: number; json(): Promise<unknown> }> = () =>
  Promise.resolve({ status: 200, json: () => Promise.resolve({ _id: 'ltr_test_1', mode: 'test' }) });
const letters: FormClient = (url, init) => {
  const fields: Record<string, string> = {};
  let file: Blob | null = null;
  for (const [name, value] of init.body?.entries() ?? [])
    if (typeof value === 'string') fields[name] = value;
    else file = value;
  asked.push({ url, headers: init.headers, fields, file });
  return answer();
};
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const ADDRESS = 'Bâtiment B\n14 avenue des Tilleuls';

/** A case of a company with its postal address; without a first letter unless asked. */
const made = async (options: { firstLetter?: boolean; address?: string | null; debtor?: string } = {}) => {
  const { firstLetter = false, address = ADDRESS } = options;
  const [creditor] = await rows<{ id: string }>(
    "INSERT INTO creditors (name, address, postal_code, city) VALUES ($1, '3 rue du Port', '13002', 'Marseille') RETURNING id",
    [`Créancier ${(reference += 1)}`],
  );
  const debtor =
    options.debtor ??
    (
      await rows<{ id: string }>("INSERT INTO debtors (kind, name, siren) VALUES ('COMPANY', $1, $2) RETURNING id", [
        `Débiteur ${reference}`,
        String((siren += 1)),
      ])
    )[0]!.id;
  const [found] = await rows<{ id: string }>(
    `INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status, first_letter_reference, first_letter_on, debtor_address, debtor_postal_code, debtor_city)
     VALUES ($1, $2, $3, $4, 'REMINDER', $5, $6, $7, '69003', 'Lyon') RETURNING id`,
    [
      `LGR-2026-${reference}`,
      creditor!.id,
      debtor,
      test.s.officerA,
      firstLetter ? `LR-2026-${String(reference).slice(-4)}` : null,
      firstLetter ? '2026-09-15' : null,
      address,
    ],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-2026-0712', '2026-08-15', '2026-09-14', 1860000, 1860000)",
    [found!.id, creditor!.id],
  );
  return { id: found!.id, debtor };
};
const letter = (caseId: string, template = 'FRIENDLY') =>
  call('officerA', 'POST', `/cases/${caseId}/reminders`, { channel: 'REGISTERED_LETTER', template, recipient: 'Adresse postale du dossier' });
const lines = (caseId: string) =>
  rows<{ channel: string; template: string; status: string; simulated: boolean; provider_ref: string | null; failure: string | null; document: boolean }>(
    'SELECT channel, template, status, simulated, provider_ref, failure, document_id IS NOT NULL AS document FROM sendings WHERE case_id = $1 ORDER BY created_at',
    [caseId],
  );
const firstLetter = async (caseId: string) =>
  (
    await rows<{ reference: string | null; on: string | null }>(
      "SELECT first_letter_reference AS reference, to_char(first_letter_on, 'YYYY-MM-DD') AS on FROM cases WHERE id = $1",
      [caseId],
    )
  )[0]!;
const setFirm = (field: string, value: string) =>
  rows('INSERT INTO settings (key, value, updated_by) VALUES ($1, to_jsonb($2::text), $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [
    `firm.cabinet.${field}`,
    value,
    test.s.director,
  ]);
const storeKey = async (name: string, value: string) => {
  await rows('DELETE FROM vault_secrets WHERE name = $1', [name]);
  const id = randomUUID();
  await rows('INSERT INTO vault_secrets (id, name, value_cipher) VALUES ($1, $2, $3)', [id, name, new Vault(test.config).seal(id, value)]);
};
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());

beforeAll(async () => {
  test = await startApp();
  worker = startMailWorker(test, { letters });
  const fields = firmGroups()
    .flatMap((group) => group.items)
    .find((item) => item.id === 'cabinet')!
    .blocks.flatMap((block) => block.fields);
  const samples: Record<string, string> = { siren: '732829007', iban: 'FR7630001007941234567890185', bic: 'BDFEFRPP', address: 'Valeur du cabinet' };
  for (const field of fields.filter((item) => PLACEHOLDER.test(item.value ?? ''))) await setFirm(field.id, samples[field.id] ?? 'Valeur du cabinet');
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});

describe('an address as the post reads it', () => {
  it('is cut into lines of 45 characters at most, or refused', () => {
    expect(streetLinesOf('Bâtiment B, 14 avenue des Tilleuls')).toEqual(['Bâtiment B', '14 avenue des Tilleuls']);
    expect(streetLinesOf('  ')).toBeNull();
    expect(streetLinesOf('a, b, c, d')).toBeNull();
    expect(streetLinesOf('x'.repeat(46))).toBeNull();
    expect(postalOf('12 rue de la Paix, 75002 Paris')).toEqual({ lines: ['12 rue de la Paix'], postalCode: '75002', city: 'Paris' });
    expect(postalOf('12 rue de la Paix\n75002 Paris')).toEqual({ lines: ['12 rue de la Paix'], postalCode: '75002', city: 'Paris' });
    expect(postalOf('[ADRESSE DU CABINET]')).toBeNull();
    expect(postalOf('75002 Paris')).toBeNull();
  });
});

describe('a registered letter from a case (question 210)', () => {
  it('is refused with its reason: address of the case, first letter, address of the firm', async () => {
    const without = await made({ address: null });
    expect((await letter(without.id)).body).toEqual({ code: 'NO_ADDRESS' });
    const long = await made({ address: 'x'.repeat(60) });
    expect((await letter(long.id)).body).toEqual({ code: 'NO_ADDRESS' });
    // The firm letter and the formal notice quote the first one.
    const first = await made();
    expect((await letter(first.id, 'FIRM')).body).toEqual({ code: 'NO_FIRST_LETTER' });
    expect((await letter(first.id, 'FORMAL_NOTICE')).body).toEqual({ code: 'NO_FIRST_LETTER' });
    // The address of the firm has no postal code yet: the letter could not leave from it.
    expect((await letter(first.id)).body).toEqual({ code: 'FIRM_INCOMPLETE' });
    expect(await lines(first.id)).toEqual([]);
    await setFirm('address', '12 rue de la Paix, 75002 Paris');
  });

  it('is refused to whoever does not act on the case', async () => {
    const other = await made();
    expect(
      (await call('officerB', 'POST', `/cases/${other.id}/reminders`, { channel: 'REGISTERED_LETTER', template: 'FRIENDLY', recipient: '-' })).status,
    ).toBe(404);
    expect(await lines(other.id)).toEqual([]);
  });

  it('is written with the request, then leaves simulated without a key: kept in the case, it opens nothing', async () => {
    const found = await made();
    expect((await letter(found.id)).status).toBe(204);
    // One at a time per case.
    expect((await letter(found.id)).body).toEqual({ code: 'REMINDER_PENDING' });
    expect(await lines(found.id)).toEqual([
      { channel: 'REGISTERED_LETTER', template: 'FRIENDLY', status: 'QUEUED', simulated: false, provider_ref: null, failure: null, document: false },
    ]);
    await worker.run();
    expect(await lines(found.id)).toEqual([
      { channel: 'REGISTERED_LETTER', template: 'FRIENDLY', status: 'SENT', simulated: true, provider_ref: null, failure: null, document: true },
    ]);
    expect(asked).toEqual([]);
    // Simulated: no first letter, the e-mails stay closed.
    expect(await firstLetter(found.id)).toEqual({ reference: null, on: null });
    expect(await rows('SELECT title, detail FROM case_events WHERE case_id = $1 AND kind = $2', [found.id, 'REMINDER_SENT'])).toEqual([
      { title: 'Relance envoyée', detail: 'Courrier recommandé · relance amiable' },
    ]);
    expect(
      await rows(
        'SELECT d.category::text, d.title, d.source::text, d.visible_to_debtor, d.contains_access_code FROM documents d JOIN sendings s ON s.document_id = d.id WHERE s.case_id = $1',
        [found.id],
      ),
    ).toEqual([
      { category: 'REMINDER_LETTER', title: 'Relance amiable (recommandé)', source: 'GENERATED', visible_to_debtor: false, contains_access_code: false },
    ]);
    // The validated text, with the mentions of the article R. 124-4 and the address the post reads.
    const page = worker.letterPages.splice(0).at(-1)!;
    expect(page).toContain('Lettre recommandée avec accusé de réception');
    expect(page).toContain('Objet : Facture(s) impayée(s) – dossier LGR-2026-');
    expect(page).toContain('les factures F-2026-0712 émises par');
    expect(page).toMatch(/18\s600,00\s€/u);
    expect(page).toContain('14 avenue des Tilleuls<br>');
    expect(page).toContain('69003 Lyon');
    expect(page).toContain("article L111-8 du Code des procédures civiles d'exécution");
    expect(page).toContain('Créancier');
    expect(page).not.toContain('{{');
  });

  it('counts in the monthly cap of letters of the debtor, without any override', async () => {
    const one = await made();
    const two = await made({ debtor: one.debtor });
    const three = await made({ debtor: one.debtor });
    expect((await letter(one.id)).status).toBe(204);
    expect((await letter(two.id)).status).toBe(204);
    expect((await letter(three.id)).body).toEqual({ code: 'CONTACT_CAP' });
    await worker.run();
    worker.letterPages.splice(0);
  });
});

describe('Rédiger un courrier (question 210)', () => {
  const compose = (as: string, body: Record<string, unknown>) =>
    call(as, 'POST', '/documents/compose', {
      template: 'FRIENDLY',
      filters: null,
      expected: 1,
      channel: 'LETTER',
      delay: 8,
      months: 4,
      options: { table: true, pay: true, indemnity: true },
      ...body,
    });
  beforeAll(() => setFirm('address', '12 rue de la Paix, 75002 Paris'));

  it('lists the cases the caller acts on, with what the letter quotes', async () => {
    const found = await made({ firstLetter: true });
    const mine = (await call('officerA', 'GET', '/documents/compose')).body as {
      recipients: { caseId: string; address: string[]; invoices: { number: string; amount: number }[]; firstLetter: unknown; isIndividual: boolean }[];
      batch: unknown;
      firm: { name: string };
    };
    expect(mine.batch).toBeNull();
    expect(mine.recipients.find((item) => item.caseId === found.id)).toMatchObject({
      address: ['Bâtiment B', '14 avenue des Tilleuls', '69003 Lyon'],
      invoices: [{ number: 'F-2026-0712', amount: 1860000 }],
      firstLetter: { reference: expect.stringMatching(/^LR-2026-/u) as unknown },
      isIndividual: false,
    });
    const theirs = (await call('officerB', 'GET', '/documents/compose')).body as { recipients: { caseId: string }[] };
    expect(theirs.recipients.map((item) => item.caseId)).not.toContain(found.id);
  });

  it('posts a plain letter with the rules of the registered one, and the delay chosen', async () => {
    const found = await made();
    worker.letterPages.splice(0);
    expect((await compose('officerA', { caseIds: [found.id], delay: 15 })).status).toBe(204);
    await worker.run();
    expect(await lines(found.id)).toMatchObject([{ channel: 'LETTER', template: 'FRIENDLY', status: 'SENT', simulated: true, document: true }]);
    expect(await rows('SELECT title FROM documents WHERE case_id = $1', [found.id])).toEqual([{ title: 'Relance amiable (courrier simple)' }]);
    const limit = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(Date.now() + 15 * 86_400_000));
    expect(worker.letterPages.at(-1)).toContain(limit);
    expect(await rows("SELECT detail FROM case_events WHERE case_id = $1 AND kind = 'REMINDER_SENT'", [found.id])).toEqual([{ detail: 'Courrier · relance amiable' }]);
    // One letter at a time per case, whatever its channel.
    expect((await compose('officerA', { caseIds: [found.id], channel: 'REGISTERED_LETTER' })).status).toBe(204);
    expect((await compose('officerA', { caseIds: [found.id] })).body).toEqual({ code: 'REMINDER_PENDING' });
    await worker.run();
  });

  it('keeps the PDF alone in the case, sent to nobody', async () => {
    const found = await made();
    expect((await compose('officerA', { caseIds: [found.id], channel: 'DOWNLOAD' })).status).toBe(204);
    await worker.run();
    expect(await lines(found.id)).toEqual([]);
    expect(await rows('SELECT title, source FROM documents WHERE case_id = $1', [found.id])).toEqual([{ title: 'Relance amiable', source: 'GENERATED' }]);
    expect(await rows("SELECT title, detail FROM case_events WHERE case_id = $1 AND kind = 'DOCUMENT_ADDED'", [found.id])).toEqual([
      { title: 'Courrier généré', detail: 'Relance amiable · sans envoi' },
    ]);
    expect((await compose('officerA', { caseIds: [found.id], channel: 'DOWNLOAD', template: 'FIRM' })).body).toEqual({ code: 'NO_FIRST_LETTER' });
  });

  it('refuses what is not open yet, another selection, and whoever does not act on the case', async () => {
    const found = await made();
    expect((await compose('officerA', { caseIds: [found.id], channel: 'EMAIL_SIGNATURE' })).body).toEqual({ code: 'NOT_AVAILABLE' });
    expect((await compose('officerA', { caseIds: [found.id], template: 'PAYMENT_PLAN' })).body).toEqual({ code: 'NOT_AVAILABLE' });
    expect((await compose('manager', { caseIds: null, filters: { creditor: 'all', age: '31-60' }, expected: 3 })).body).toEqual({ code: 'NOT_AVAILABLE' });
    expect((await compose('officerA', { caseIds: [found.id], expected: 2 })).body).toEqual({ code: 'SELECTION_CHANGED' });
    expect((await compose('officerA', { caseIds: [found.id], delay: 10 })).status).toBe(422);
    expect((await compose('officerB', { caseIds: [found.id] })).status).toBe(404);
    expect((await compose('director', { caseIds: [found.id] })).status).toBe(403);
    expect((await call('officerA', 'POST', '/documents/compose/draft', { template: 'FRIENDLY', caseId: found.id })).body).toEqual({ code: 'NOT_AVAILABLE' });
    expect(await lines(found.id)).toEqual([]);
  });
});

describe('with the test key of MySendingBox', () => {
  beforeAll(() => storeKey('MYSENDINGBOX_TEST_API_KEY', 'test_0123456789'));

  it('is rendered by MySendingBox, posts nothing, and opens nothing', async () => {
    const found = await made();
    asked.splice(0);
    expect((await letter(found.id)).status).toBe(204);
    await worker.run();
    expect(await lines(found.id)).toEqual([
      { channel: 'REGISTERED_LETTER', template: 'FRIENDLY', status: 'SENT', simulated: true, provider_ref: 'ltr_test_1', failure: null, document: true },
    ]);
    const [request] = asked.splice(0);
    expect(request!.url).toBe('https://api.mysendingbox.fr/letters');
    expect(request!.headers.authorization).toBe(`Basic ${Buffer.from('test_0123456789:').toString('base64')}`);
    expect(request!.headers['idempotency-key']).toMatch(/^sending\/[0-9a-f-]{36}$/u);
    expect(request!.fields).toMatchObject({
      'to.address_line1': 'Bâtiment B',
      'to.address_line2': '14 avenue des Tilleuls',
      'to.address_postalcode': '69003',
      'to.address_city': 'Lyon',
      'to.address_country': 'France',
      'from.address_line1': '12 rue de la Paix',
      'from.address_postalcode': '75002',
      'from.address_city': 'Paris',
      postage_type: 'lrar',
      address_placement: 'insert_blank_page',
      source_file_type: 'file',
    });
    expect(request!.fields['metadata[sending_id]']).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new TextDecoder().decode(new Uint8Array(await request!.file!.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    expect(await firstLetter(found.id)).toEqual({ reference: null, on: null });
  });

  it('never leaves with a key that posts, outside MYSENDINGBOX_ENV=production', async () => {
    await storeKey('MYSENDINGBOX_TEST_API_KEY', 'live_0123456789');
    const found = await made();
    asked.splice(0);
    expect((await letter(found.id)).status).toBe(204);
    await worker.run();
    expect(await lines(found.id)).toMatchObject([{ status: 'FAILED', failure: 'TEST_KEY_REQUIRED', document: false }]);
    expect(asked).toEqual([]);
    await storeKey('MYSENDINGBOX_TEST_API_KEY', 'test_0123456789');
  });
});

describe('posted for real (MYSENDINGBOX_ENV=production)', () => {
  beforeAll(async () => {
    await worker.stop();
    worker = startMailWorker(test, { letters, realLetters: true });
    await storeKey('MYSENDINGBOX_API_KEY', 'live_abcdefghij');
  });

  it('becomes the first letter of its case, once', async () => {
    const found = await made();
    answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ _id: 'ltr_live_1', mode: 'live' }) });
    asked.splice(0);
    expect((await letter(found.id)).status).toBe(204);
    await worker.run();
    expect(asked[0]!.headers.authorization).toBe(`Basic ${Buffer.from('live_abcdefghij:').toString('base64')}`);
    expect(await lines(found.id)).toMatchObject([{ status: 'SENT', simulated: false, provider_ref: 'ltr_live_1' }]);
    const first = await firstLetter(found.id);
    expect(first.reference).toMatch(new RegExp(`^LR-${today().slice(0, 4)}-\\d{4,}$`, 'u'));
    expect(first.on).toBe(today());
    // The next one quotes it, and changes nothing of it.
    answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ _id: 'ltr_live_2', mode: 'live' }) });
    expect((await letter(found.id, 'FIRM')).status).toBe(204);
    await worker.run();
    expect(await firstLetter(found.id)).toEqual(first);
    const page = worker.letterPages.splice(0).at(-1)!;
    expect(page).toContain(`Ce courrier fait suite à notre premier courrier ${first.reference}`);
    expect(await rows('SELECT detail FROM case_events WHERE case_id = $1 AND kind = $2 ORDER BY occurred_at', [found.id, 'REMINDER_SENT'])).toEqual([
      { detail: 'Courrier recommandé · relance amiable' },
      { detail: 'Courrier recommandé · relance ferme' },
    ]);
  });

  it('fails when MySendingBox refuses it, and stays uncertain when nothing clear came back', async () => {
    const refused = await made();
    answer = () => Promise.resolve({ status: 422, json: () => Promise.resolve({ error: { message: 'Adresse invalide : 14 avenue des Tilleuls' } }) });
    expect((await letter(refused.id)).status).toBe(204);
    await worker.run();
    expect(await lines(refused.id)).toMatchObject([{ status: 'FAILED', failure: 'PROVIDER_REFUSED', document: true }]);
    expect(await firstLetter(refused.id)).toEqual({ reference: null, on: null });
    const unclear = await made();
    answer = () => Promise.resolve({ status: 502, json: () => Promise.resolve({}) });
    expect((await letter(unclear.id)).status).toBe(204);
    await worker.run();
    expect(await lines(unclear.id)).toMatchObject([{ status: 'UNCERTAIN', failure: null, document: true }]);
    // Neither the address nor what MySendingBox said in the journals.
    for (const line of test.logs) expect(line).not.toContain('Tilleuls');
  });
  /** What MySendingBox says of the letter `ref` when asked. */
  const knows = (ref: string, events: { name: string; created_at: string }[], mode = 'live') => {
    answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ _id: ref, mode, events, to: { address_line1: '14 avenue des Tilleuls' } }) });
  };
  const hook = (body: unknown) =>
    test.call('POST', '/hooks/mysendingbox', { file: Buffer.from(JSON.stringify(body)), headers: { 'content-type': 'application/json' } });
  const sentLetter = async (ref: string) => {
    const found = await made();
    answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ _id: ref, mode: 'live' }) });
    expect((await letter(found.id)).status).toBe(204);
    await worker.run();
    return found;
  };
  const facts = (caseId: string) =>
    rows<{ posted: boolean; delivered: boolean; undelivered: string | null }>(
      'SELECT confirmed_at IS NOT NULL AS posted, delivered_at IS NOT NULL AS delivered, undelivered_reason AS undelivered FROM sendings WHERE case_id = $1',
      [caseId],
    );
  const tracked = async (caseId: string) =>
    (await rows<{ title: string; detail: string }>("SELECT title, detail FROM case_events WHERE case_id = $1 AND kind IN ('REMINDER_DELIVERED', 'REMINDER_UNDELIVERED') ORDER BY occurred_at", [caseId]));

  it('is followed by what MySendingBox says when asked, never by the body of a webhook', async () => {
    const found = await sentLetter('ltr_track_1');
    // The body says « distributed »; MySendingBox, asked, says only « sent ».
    knows('ltr_track_1', [
      { name: 'letter.created', created_at: new Date(Date.now() - 60_000).toISOString() },
      { name: 'letter.sent', created_at: new Date().toISOString() },
    ]);
    asked.splice(0);
    expect((await hook({ event: { name: 'letter.distributed', letter: 'ltr_track_1' }, letter: { _id: 'ltr_track_1' } })).status).toBe(204);
    await worker.run();
    expect(asked.map((call) => call.url)).toEqual(['https://api.mysendingbox.fr/letters/ltr_track_1']);
    expect(asked[0]!.headers.authorization).toBe(`Basic ${Buffer.from('live_abcdefghij:').toString('base64')}`);
    expect(await facts(found.id)).toEqual([{ posted: true, delivered: false, undelivered: null }]);
    expect(await tracked(found.id)).toEqual([]);
    // Then distributed, and asked by the clock: written once. Two webhooks of the same minute ask once (a minute may turn).
    knows('ltr_track_1', [
      { name: 'letter.sent', created_at: new Date(Date.now() - 30_000).toISOString() },
      { name: 'letter.distributed', created_at: new Date().toISOString() },
    ]);
    const before = (await rows<{ n: number }>("SELECT count(*)::int AS n FROM outbox WHERE name = 'letter-refresh'"))[0]!.n;
    for (let i = 0; i < 3; i += 1) expect((await hook({ event: { letter: 'ltr_track_1' } })).status).toBe(204);
    const after = (await rows<{ n: number }>("SELECT count(*)::int AS n FROM outbox WHERE name = 'letter-refresh'"))[0]!.n;
    // Once a minute at most for a letter: these three, and the first, ask once or twice.
    expect(after - before).toBeLessThanOrEqual(1);
    await worker.run();
    await sweepLetters(worker.asWorker, worker.letterTracking);
    expect(await facts(found.id)).toEqual([{ posted: true, delivered: true, undelivered: null }]);
    expect(await tracked(found.id)).toEqual([{ title: 'Courrier distribué', detail: 'Courrier recommandé · relance amiable' }]);
    // Delivered, it is no longer asked about by the clock.
    asked.splice(0);
    await sweepLetters(worker.asWorker, worker.letterTracking);
    expect(asked.filter((call) => call.url.endsWith('ltr_track_1'))).toEqual([]);
    for (const line of test.logs) expect(line).not.toContain('Tilleuls');
  });

  it('says when a letter came back, and leaves a letter it does not know, or of the other mode', async () => {
    const found = await sentLetter('ltr_track_2');
    knows('ltr_track_2', [
      { name: 'letter.sent', created_at: new Date(Date.now() - 60_000).toISOString() },
      { name: 'letter.returned_to_sender', created_at: new Date().toISOString() },
    ]);
    // Without any webhook: the clock asks the letters on their way.
    asked.splice(0);
    expect(await sweepLetters(worker.asWorker, worker.letterTracking)).toBeGreaterThanOrEqual(1);
    expect(asked.map((call) => call.url)).toContain('https://api.mysendingbox.fr/letters/ltr_track_2');
    expect(await facts(found.id)).toEqual([{ posted: true, delivered: false, undelivered: 'RETURNED' }]);
    expect(await tracked(found.id)).toEqual([{ title: 'Courrier non distribué', detail: 'Courrier recommandé · relance amiable · retourné à l’expéditeur' }]);
    // Unknown here: MySendingBox is not even asked. Nothing readable: 204 all the same.
    asked.splice(0);
    expect((await hook({ event: { letter: 'ltr_somebody_else' } })).status).toBe(204);
    expect((await test.call('POST', '/hooks/mysendingbox')).status).toBe(204);
    await worker.run();
    expect(asked).toEqual([]);
    // A test letter under one of our names changes nothing.
    const other = await sentLetter('ltr_track_3');
    knows('ltr_track_3', [{ name: 'letter.distributed', created_at: new Date().toISOString() }], 'test');
    expect((await hook({ event: { letter: 'ltr_track_3' } })).status).toBe(204);
    await worker.run();
    expect(await facts(other.id)).toEqual([{ posted: false, delivered: false, undelivered: null }]);
  });

  it('never makes a plain letter the first letter, even posted for real', async () => {
    const found = await made();
    answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ _id: 'ltr_plain_1', mode: 'live' }) });
    asked.splice(0);
    expect(
      (
        await call('officerA', 'POST', '/documents/compose', {
          template: 'FRIENDLY', caseIds: [found.id], filters: null, expected: 1, channel: 'LETTER', delay: 8, months: 4, options: { table: true, pay: true, indemnity: true },
        })
      ).status,
    ).toBe(204);
    await worker.run();
    expect(asked[0]!.fields.postage_type).toBe('prioritaire');
    expect(await lines(found.id)).toMatchObject([{ channel: 'LETTER', status: 'SENT', simulated: false, provider_ref: 'ltr_plain_1' }]);
    expect(await firstLetter(found.id)).toEqual({ reference: null, on: null });
  });

  it('dates the formal notice of its sending, then of its delivery (question 98)', async () => {
    const found = await made({ firstLetter: true });
    answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ _id: 'ltr_notice_1', mode: 'live' }) });
    await setFirm('address', '12 rue de la Paix, 75002 Paris');
    expect((await letter(found.id, 'FORMAL_NOTICE')).status).toBe(204);
    await worker.run();
    const day = async () =>
      (await rows<{ on: string | null }>("SELECT to_char(formal_notice_on, 'YYYY-MM-DD') AS on FROM cases WHERE id = $1", [found.id]))[0]!.on;
    expect(await day()).toBe(today());
    // Posted three days ago, distributed now: the interest runs from the delivery.
    // Past the guard of the lines, which never lets a date go back: for this test only.
    await test.database.admin.query(
      `BEGIN; SET LOCAL session_replication_role = replica;
       UPDATE sendings SET created_at = created_at - interval '3 days', sent_at = sent_at - interval '3 days' WHERE case_id = '${found.id}';
       UPDATE cases SET formal_notice_on = formal_notice_on - 3 WHERE id = '${found.id}'; COMMIT;`,
    );
    const earlier = await day();
    knows('ltr_notice_1', [{ name: 'letter.distributed', created_at: new Date().toISOString() }]);
    await sweepLetters(worker.asWorker, worker.letterTracking);
    expect(earlier).not.toBe(today());
    expect(await day()).toBe(today());
    expect(await tracked(found.id)).toEqual([{ title: 'Courrier distribué', detail: 'Courrier recommandé · mise en demeure' }]);
  });
});

describe('the events of a letter', () => {
  it('give each fact on the date of its first event, a delivery winning over a return', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute));
    expect(trackOf([])).toEqual({});
    expect(trackOf([{ name: 'letter.created', at: at(0) }, { name: 'letter.accepted', at: at(1) }])).toEqual({});
    expect(trackOf([{ name: 'letter.in_transit', at: at(5) }, { name: 'letter.sent', at: at(2) }, { name: 'letter.lost', at: at(9) }])).toEqual({
      posted: at(2),
      undelivered: { at: at(9), reason: 'LOST' },
    });
    expect(trackOf([{ name: 'letter.sent', at: at(2) }, { name: 'letter.returned_to_sender', at: at(4) }, { name: 'letter.distributed', at: at(3) }])).toEqual({
      posted: at(2),
      delivered: at(3),
    });
  });
  it('name a letter from the event or the letter of a webhook, and nothing else', () => {
    const body = (value: unknown) => Buffer.from(JSON.stringify(value));
    expect(letterNamed(body({ event: { letter: 'SkyVo5yIZ' } }))).toBe('SkyVo5yIZ');
    expect(letterNamed(body({ letter: { _id: 'SkyVo5yIZ' } }))).toBe('SkyVo5yIZ');
    expect(letterNamed(body({ event: { letter: '../accounts' } }))).toBeNull();
    expect(letterNamed(Buffer.from('not json'))).toBeNull();
    expect(letterNamed(new Uint8Array())).toBeNull();
  });
});
