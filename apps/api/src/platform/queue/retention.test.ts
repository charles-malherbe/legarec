import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import { Database } from '../database/database';
import { createLogger } from '../logging/logger';
import { Storage } from '../storage/storage';
import { purge } from './maintenance';

let test: TestDatabase;
let s: Seed;
let jobs: Database;
const storage = new Storage(join(tmpdir(), `legarec-retention-${process.pid}`));
const logger = createLogger('debug', new Writable({ write: (_chunk, _encoding, done) => done() }));
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.admin.query<T>(sql, values)).rows;
const hash = () => randomBytes(32);

beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  jobs = new Database(test.url('jobs'));
});
afterAll(async () => {
  await jobs.close();
  await test.drop();
});

describe('sign-ins', () => {
  it('are forgotten 48 hours after their end', async () => {
    const session = (label: string, expires: string, seen: string, revoked = 'NULL') =>
      rows(
        `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at, last_seen_at, revoked_at)
         VALUES ($1, 'STAFF', $2, $3, false, now() + interval '${expires}', now() - interval '${seen}', ${revoked})`,
        [s.officerA, hash(), label],
      );
    await session('open', '1 hour', '1 minute');
    await session('closed a moment ago', '1 hour', '1 hour', "now() - interval '1 hour'");
    await session('closed for long', '1 hour', '50 hours', "now() - interval '49 hours'");
    await session('expired for long', '-49 hours', '1 minute');
    await session('expired a moment ago', '-47 hours', '47 hours');
    await session('silent for long', '1 hour', '49 hours');
    const link = (name: string, expires: string, used = 'NULL') =>
      rows(`INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at, used_at) VALUES ('RESET', $1, $2, now() + interval '${expires}', ${used})`, [
        s.officerA,
        Buffer.from(name),
      ]);
    await link('live', '1 hour');
    await link('used a moment ago', '1 hour', "now() - interval '1 hour'");
    await link('used for long', '1 hour', "now() - interval '49 hours'");
    await link('expired for long', '-49 hours');
    await rows(
      "INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ($1, $2, 'kept', now() + interval '1 day'), ($1, $3, 'gone', now() - interval '1 minute')",
      [s.officerA, hash(), hash()],
    );
    await rows(
      "INSERT INTO lockouts (key_hash, scope, failures, last_failure_at) VALUES ($1, 'SIGN_IN', 1, now() - interval '13 months'), ($2, 'SIGN_IN', 1, now() - interval '11 months')",
      [hash(), hash()],
    );
    expect(await purge(jobs, logger, storage)).toMatchObject({ 'sign-ins': 7 });
    expect((await rows<{ device_label: string }>('SELECT device_label FROM user_sessions ORDER BY 1')).map((row) => row.device_label)).toEqual([
      'closed a moment ago',
      'expired a moment ago',
      'open',
    ]);
    expect((await rows<{ name: string }>("SELECT convert_from(token_hash, 'UTF8') AS name FROM auth_tokens ORDER BY 1")).map((row) => row.name)).toEqual([
      'live',
      'used a moment ago',
    ]);
    expect(await rows('SELECT label FROM user_devices')).toEqual([{ label: 'kept' }]);
    expect(await rows('SELECT 1 FROM lockouts')).toHaveLength(1);
  });

  it('keep the session that a question of a security key still refers to', async () => {
    const [session] = await rows<{ id: string }>(
      `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at)
       VALUES ($1, 'STAFF', $2, 'asked', true, now() - interval '49 hours') RETURNING id`,
      [s.officerB, hash()],
    );
    await rows("INSERT INTO auth_tokens (purpose, user_id, session_id, token_hash, expires_at) VALUES ('WEBAUTHN', $1, $2, $3, now() - interval '47 hours')", [
      s.officerB,
      session!.id,
      hash(),
    ]);
    await purge(jobs, logger, storage);
    expect(await rows('SELECT 1 FROM user_sessions WHERE id = $1', [session!.id])).toHaveLength(1);
    await rows("UPDATE auth_tokens SET expires_at = now() - interval '49 hours' WHERE session_id = $1", [session!.id]);
    await purge(jobs, logger, storage);
    expect(await rows('SELECT 1 FROM user_sessions WHERE id = $1', [session!.id])).toEqual([]);
  });
});

describe('accounts', () => {
  const disabled = async (since: string) =>
    (
      await rows<{ id: string }>(
        `INSERT INTO users (role, status, first_name, last_name, email, extension, password_hash, disabled_at, disabled_by, disabled_reason)
         VALUES ('CLAIMS_OFFICER', 'DISABLED', 'Prénom-MARK', 'Nom-MARK', $1, '118', 'hash-MARK', now() - interval '${since}', $2, 'Motif-MARK') RETURNING id`,
        [`mark${Math.random().toString().slice(2)}@mark.test`, s.director],
      )
    )[0]!.id;

  it('disabled for two years are nobody any more, and leave everything that refers to them', async () => {
    const [old, recent] = [await disabled('25 months'), await disabled('23 months')];
    for (const id of [old, recent]) {
      await rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [id]);
      await rows("INSERT INTO backup_codes (user_id, code_hash) VALUES ($1, 'x')", [id]);
      await rows(
        "INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES ($1, 'STAFF', $2, 'x', false, now() + interval '1 hour')",
        [id, hash()],
      );
      await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', $1, $2, now() + interval '1 hour')", [id, hash()]);
      await rows("INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ($1, $2, 'x', now() + interval '1 day')", [id, hash()]);
      await rows("INSERT INTO notification_preferences (user_id, kind, in_app, email) VALUES ($1, 'payment', true, true)", [id]);
      await rows("INSERT INTO notifications (user_id, kind, action, actor_id, target_id) VALUES ($1, 'SUPPORT_ACTION', 'RESET_LINK', $2, $1)", [
        id,
        s.developer,
      ]);
      await rows("INSERT INTO mailbox_requests (user_id, local, requested_by) VALUES ($1, 'mark', $2)", [id, s.director]);
    }
    await rows(
      "INSERT INTO case_events (case_id, creditor_id, kind, title, actor_kind, actor_id, actor_label) VALUES ($1, $2, 'NOTE', 'Note', 'STAFF', $3, 'Prénom Nom')",
      [s.cases.ofA, s.creditorA, old],
    );
    await rows('UPDATE users SET substitute_id = $1 WHERE id = ANY ($2::uuid[])', [s.officerB, [old, recent]]);
    expect(await purge(jobs, logger, storage)).toMatchObject({ accounts: 1 });
    expect(await rows('SELECT substitute_id FROM users WHERE id = ANY ($1::uuid[]) ORDER BY id = $2', [[old, recent], recent])).toEqual([
      { substitute_id: null },
      { substitute_id: s.officerB },
    ]);
    const [user] = await rows(
      'SELECT status::text, first_name, last_name, email::text, extension, password_hash, disabled_reason, anonymized_at IS NOT NULL AS anonymized FROM users WHERE id = $1',
      [old],
    );
    expect(user).toEqual({
      status: 'DISABLED',
      first_name: 'Compte',
      last_name: 'anonymisé',
      email: `${old}@anonyme.invalid`,
      extension: null,
      password_hash: null,
      disabled_reason: null,
      anonymized: true,
    });
    for (const table of [
      'second_factors',
      'backup_codes',
      'user_sessions',
      'auth_tokens',
      'user_devices',
      'notification_preferences',
      'notifications',
      'mailbox_requests',
    ]) {
      expect(await rows(`SELECT 1 FROM ${table} WHERE user_id = $1`, [old]), table).toEqual([]);
      expect(await rows(`SELECT 1 FROM ${table} WHERE user_id = $1`, [recent]), table).toHaveLength(1);
    }
    expect(await rows('SELECT first_name FROM users WHERE id = $1', [recent])).toEqual([{ first_name: 'Prénom-MARK' }]);
    // The history of the case still knows that somebody wrote.
    expect(await rows('SELECT actor_id FROM case_events WHERE actor_id = $1', [old])).toHaveLength(1);
    // Once is enough, and nothing happens to the others.
    expect(await purge(jobs, logger, storage)).toMatchObject({ accounts: 0 });
    expect(await rows("SELECT 1 FROM users WHERE status = 'ACTIVE' AND anonymized_at IS NOT NULL")).toEqual([]);
  });

  it('invited a year ago, and never opened, are removed', async () => {
    const invited = async (email: string, since: string, hash: string | null = null) =>
      (
        await rows<{ id: string }>(
          `INSERT INTO users (role, status, first_name, last_name, email, invited_at, password_hash) VALUES ('CLAIMS_OFFICER', 'INVITED', 'A', 'B', $1, now() - interval '${since}', $2) RETURNING id`,
          [email, hash],
        )
      )[0]!.id;
    const [old, recent, opened] = [
      await invited('old@mark.test', '13 months'),
      await invited('recent@mark.test', '11 months'),
      await invited('opened@mark.test', '13 months', 'hash'),
    ];
    for (const id of [old, recent]) {
      await rows("INSERT INTO mailbox_requests (user_id, local, requested_by) VALUES ($1, 'x', $2)", [id, s.director]);
      await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('INVITATION', $1, $2, now() + interval '1 hour')", [id, hash()]);
    }
    expect(await purge(jobs, logger, storage)).toMatchObject({ accounts: 1 });
    expect(
      (await rows<{ id: string }>('SELECT id FROM users WHERE id = ANY ($1::uuid[]) ORDER BY email', [[old, recent, opened]])).map((row) => row.id),
    ).toEqual([opened, recent]);
    expect(await rows('SELECT 1 FROM mailbox_requests WHERE user_id = $1 UNION ALL SELECT 1 FROM auth_tokens WHERE user_id = $1', [old])).toEqual([]);
    await rows("DELETE FROM users WHERE email IN ('opened@mark.test')");
  });

  it('of someone who came back are kept', async () => {
    const id = await disabled('25 months');
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = $1", [id]);
    expect(await purge(jobs, logger, storage)).toMatchObject({ accounts: 0 });
  });

  it('opened again while they are being forgotten are kept whole', async () => {
    const id = await disabled('25 months');
    const other = new pg.Client({ connectionString: test.adminUrl });
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query("UPDATE users SET status = 'ACTIVE', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = $1", [id]);
      expect(await purge(jobs, logger, storage)).toMatchObject({ accounts: 0 });
      await other.query('COMMIT');
    } finally {
      await other.end();
    }
    expect(await rows('SELECT status, last_name, anonymized_at FROM users WHERE id = $1', [id])).toEqual([
      { status: 'ACTIVE', last_name: 'Nom-MARK', anonymized_at: null },
    ]);
  });
});

describe('notifications and questions to the support', () => {
  it('are kept for two years', async () => {
    await rows('DELETE FROM notifications');
    for (const [number, age] of [
      ['2024-0001', '25 months'],
      ['2025-0001', '23 months'],
    ] as const) {
      const [ticket] = await rows<{ id: string }>(
        `INSERT INTO support_tickets (number, user_id, subject, message, created_at) VALUES ($1, $2, 'Sujet', 'Une question.', now() - interval '${age}') RETURNING id`,
        [number, s.officerA],
      );
      await rows(
        `INSERT INTO notifications (user_id, kind, ticket_id, actor_id, created_at) VALUES ($1, 'SUPPORT_TICKET', $2, $3, now() - interval '${age}')`,
        [s.developer, ticket!.id, s.officerA],
      );
    }
    expect(await purge(jobs, logger, storage)).toMatchObject({ notifications: 1, 'support-tickets': 1 });
    expect(await rows('SELECT number FROM support_tickets')).toEqual([{ number: '2025-0001' }]);
  });
});

describe('what tonight’s lots keep', () => {
  it('forgets messages without a code after 6 months, marks after 2 years, the registry of the RGPD after 10', async () => {
    for (const age of ['7 months', '5 months'])
      await rows(`INSERT INTO limited_messages (sender_name, text, created_at) VALUES ('Jean', 'Bonjour', now() - interval '${age}')`);
    const [creditor] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Purge Delta') RETURNING id");
    const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'X') RETURNING id");
    const [made] = await rows<{ id: string }>("INSERT INTO cases (reference, creditor_id, debtor_id) VALUES ('LGR-2026-99001', $1, $2) RETURNING id", [
      creditor!.id,
      debtor!.id,
    ]);
    // Ten years from the close of the request, counted from the end of its year: closed on the last day of the year eleven
    // years ago, it goes; on the first day of the year ten years ago, or still open, it stays.
    const [{ year }] = (await rows<{ year: number }>("SELECT extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int AS year")) as [{ year: number }];
    for (const [received, answered] of [
      [`${year - 12}-03-01`, `${year - 11}-12-31`],
      [`${year - 11}-03-01`, `${year - 10}-01-01`],
      [`${year - 12}-03-01`, null],
    ])
      await rows(
        `INSERT INTO gdpr_requests (case_id, creditor_id, debtor_id, kind, origin, received_on, due_on, status, answered_at, created_by)
         VALUES ($1, $2, $3, 'ACCESS', 'Courrier', $4::date, $4::date, $5, ($6::date + time '12:00') AT TIME ZONE 'Europe/Paris', $7)`,
        [made!.id, creditor!.id, debtor!.id, received, answered === null ? 'OPEN' : 'ANSWERED', answered, s.manager],
      );
    await rows(`INSERT INTO task_marks (user_id, key, done_at) VALUES ($1, $2, now() - interval '25 months'), ($1, $3, now())`, [
      s.officerA,
      `call:${made!.id}`,
      `dispute:${made!.id}`,
    ]);
    // Drafts of credit notes left aside for more than 30 days.
    const [invoice] = await rows<{ id: string }>(
      `INSERT INTO billing_documents (kind, number, creditor_id, issued_on, net_cents, vat_cents, gross_cents, created_by)
       VALUES ('INVOICE', 'FA-2026-9901', $1, current_date, 100, 20, 120, $2) RETURNING id`,
      [creditor!.id, s.director],
    );
    for (const age of ['31 days', '29 days'])
      await rows(
        `INSERT INTO credit_note_drafts (invoice_id, scope, lines, reason, created_by, updated_at) VALUES ($1, 'TOTAL', '[]', '', $2, now() - interval '${age}')`,
        [invoice!.id, s.director],
      );
    expect(await purge(jobs, logger, storage)).toMatchObject({
      'limited-messages': 1,
      'gdpr-requests': 1,
      'task-marks': 1,
      'claim-imports': 0,
      'credit-note-drafts': 1,
    });
    expect(await rows('SELECT count(*)::int AS n FROM credit_note_drafts')).toEqual([{ n: 1 }]);
    expect(await rows('SELECT status::text FROM gdpr_requests WHERE case_id = $1 ORDER BY status', [made!.id])).toEqual([
      { status: 'ANSWERED' },
      { status: 'OPEN' },
    ]);
    expect(await rows('SELECT count(*)::int AS n FROM limited_messages')).toEqual([{ n: 1 }]);
    expect(await rows('SELECT key FROM task_marks')).toEqual([{ key: `dispute:${made!.id}` }]);
  });
});

describe('cases closed for more than five years', () => {
  const today = "(now() AT TIME ZONE 'Europe/Paris')::date";
  let creditor = '';
  let reference = 99100;
  /** A case closed `age` ago (an interval), or still open, with what a case holds. */
  const closedCase = async (debtor: string, age: string | null) => {
    reference += 1;
    const closed = age === null ? 'NULL' : `(${today} - interval '${age}')::date`;
    const [made] = await rows<{ id: string }>(
      `INSERT INTO cases (reference, creditor_id, debtor_id, status, closed_on, debtor_address, debtor_postal_code, debtor_city, contact_name, external_reference)
       VALUES ($1, $2, $3, ${age === null ? "'REMINDER'" : "'SETTLED'"}, ${closed}, '3 rue des Lilas', '75011', 'Paris', 'Jeanne Martin', 'CLI-42') RETURNING id`,
      [`LGR-2021-${reference}`, creditor, debtor],
    );
    const id = made!.id;
    await rows(
      "INSERT INTO case_events (case_id, creditor_id, kind, title, detail, actor_kind, actor_label) VALUES ($1, $2, 'CALL_DONE', 'Appel à Jeanne Martin', 'Promet de payer', 'STAFF', 'Alba')",
      [id, creditor],
    );
    const [contact] = await rows<{ id: string }>(
      "INSERT INTO case_contacts (case_id, creditor_id, kind, label, value, value_normalized, source) VALUES ($1, $2, 'PHONE', 'Mobile', '06 12 34 56 78', '0612345678', 'CALL') RETURNING id",
      [id, creditor],
    );
    await rows("INSERT INTO case_contact_events (case_id, creditor_id, contact_id, actor_label, what) VALUES ($1, $2, $3, 'Alba', 'ADDED')", [
      id,
      creditor,
      contact!.id,
    ]);
    await rows("INSERT INTO portal_messages (case_id, creditor_id, side, text) VALUES ($1, $2, 'DEBTOR', 'Je paierai fin du mois')", [id, creditor]);
    await rows(
      "INSERT INTO planned_reminders (case_id, creditor_id, kind, due_on, title, created_by) VALUES ($1, $2, 'CALL', '2099-01-05', 'Rappeler Jeanne', $3)",
      [id, creditor, s.manager],
    );
    await rows(
      "INSERT INTO sendings (case_id, creditor_id, channel, template, level, contact_id, created_by) VALUES ($1, $2, 'EMAIL', 'FRIENDLY', 1, $3, $4)",
      [id, creditor, contact!.id, s.manager],
    );
    await rows(
      "INSERT INTO debtor_links (debtor_id, case_id, creditor_id, token_hash, channel, expires_at) VALUES ($1, $2, $3, $4, 'LETTER', now() + interval '1 day')",
      [debtor, id, creditor, hash()],
    );
    await rows(
      "INSERT INTO litigation_files (case_id, creditor_id, consent, court, partner_name, created_by) VALUES ($1, $2, 'NOT_NEEDED', 'Tribunal de commerce de Lyon', 'Me Durieux', $3)",
      [id, creditor, s.manager],
    );
    return id;
  };
  const document = async (id: string, category: string) => {
    const stored = await storage.put(new TextEncoder().encode('%PDF-1.4 Jeanne Martin'));
    const [made] = await rows<{ id: string }>(
      `INSERT INTO documents (case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, scan_status, scanned_at, shared_with_creditor_at)
       VALUES ($1, $2, $3, 'PDF', 'Facture Jeanne Martin', 'martin.pdf', $4, $5, $6, 'UPLOAD', 'CLEAN', now(), now()) RETURNING id`,
      [id, creditor, category, stored.key, stored.size, stored.sha256],
    );
    return { id: made!.id, key: stored.key };
  };
  let siren = 412_345_000;
  const debtor = async (name: string) =>
    (await rows<{ id: string }>("INSERT INTO debtors (kind, name, siren) VALUES ('SOLE_TRADER', $1, $2) RETURNING id", [name, String((siren += 1))]))[0]!.id;
  const count = async (table: string, id: string) => (await rows<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE case_id = $1`, [id]))[0]!.n;

  beforeAll(async () => {
    [{ id: creditor }] = (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Purge Cinq Ans') RETURNING id")) as [{ id: string }];
  });

  it('anonymizes the case closed 5 years and a day ago, not the one closed 4 years and 364 days ago, nor 5 years to the day', async () => {
    const oldDebtor = await debtor('Jeanne Martin');
    const youngDebtor = await debtor('Paul Durand');
    const old = await closedCase(oldDebtor, '5 years 1 day');
    const young = await closedCase(youngDebtor, '4 years 364 days');
    const exact = await closedCase(await debtor('Paul Durand'), '5 years');
    await rows('INSERT INTO debtor_access_codes (debtor_id, code_cipher) VALUES ($1, $2)', [oldDebtor, hash()]);
    // A title naming the debtor, written otherwise, and one that names nobody (question 169).
    await rows(
      `INSERT INTO case_events (case_id, creditor_id, kind, title, actor_kind, actor_label)
       VALUES ($1, $2, 'LETTER_SENT', 'Courrier à JEANNE-MARTIN', 'STAFF', 'Alba'), ($1, $2, 'REMINDER_DONE', 'Relance faite', 'STAFF', 'Alba')`,
      [old, creditor],
    );
    // A line eleven years old: past the time of the pieces of accounting (question 192).
    await rows(
      "INSERT INTO case_events (case_id, creditor_id, kind, title, actor_kind, actor_label, occurred_at) VALUES ($1, $2, 'CASE_OPENED', 'Dossier ouvert', 'STAFF', 'Alba', now() - interval '11 years')",
      [old, creditor],
    );
    const evidence = await document(old, 'EVIDENCE');
    // A receipt, its payment and its PDF: ten years.
    const receipt = await document(old, 'RECEIPT');
    const [payment] = await rows<{ id: string }>(
      `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, settled_at, cheque_number, bank, recorded_by)
         VALUES ($1, $2, 'CHEQUE', 1000, 'CASHED', '2021-01-04', '2021-01-05', '1234567', 'Banque', $3) RETURNING id)
       INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT $1, $2, p.id, 'OVERPAYMENT', 1000 FROM p RETURNING payment_id AS id`,
      [old, creditor, s.officerA],
    );
    await rows("INSERT INTO receipts (case_id, creditor_id, payment_id, number, document_id) VALUES ($1, $2, $3, 'Q-2021-00001', $4)", [
      old,
      creditor,
      payment!.id,
      receipt.id,
    ]);

    expect(await purge(jobs, logger, storage)).toMatchObject({ cases: 1, 'document-files': 1 });

    expect(
      await rows(
        'SELECT reference, status, debtor_address, debtor_city, contact_name, external_reference, anonymized_at IS NOT NULL AS anonymized FROM cases WHERE id = $1',
        [old],
      ),
    ).toEqual([
      {
        reference: 'LGR-2021-99101',
        status: 'SETTLED',
        debtor_address: null,
        debtor_city: null,
        contact_name: null,
        external_reference: null,
        anonymized: true,
      },
    ]);
    for (const table of ['case_contacts', 'case_contact_events', 'portal_messages', 'planned_reminders', 'sendings', 'debtor_links', 'litigation_files'])
      expect(await count(table, old), table).toBe(0);
    // The history stays without names (question 169): what was typed goes, a title naming the person to reach is replaced,
    // who of the team acted stays (question 132).
    expect(await rows('SELECT kind, title, detail, actor_label FROM case_events WHERE case_id = $1 ORDER BY kind', [old])).toEqual([
      { kind: 'CALL_DONE', title: 'Événement du dossier', detail: null, actor_label: 'Alba' },
      { kind: 'CASE_OPENED', title: 'Dossier ouvert', detail: null, actor_label: 'Alba' },
      { kind: 'LETTER_SENT', title: 'Événement du dossier', detail: null, actor_label: 'Alba' },
      { kind: 'REMINDER_DONE', title: 'Relance faite', detail: null, actor_label: 'Alba' },
    ]);
    // Each line then goes as the pieces of accounting, ten years after the end of its year (question 192).
    await rows('SET ROLE legarec_retention');
    try {
      expect((await rows<{ removed: number }>('SELECT app.purge_old_history() AS removed'))[0]!.removed).toBe(1);
    } finally {
      await rows('RESET ROLE');
    }
    expect((await rows<{ kind: string }>('SELECT kind FROM case_events WHERE case_id = $1 ORDER BY kind', [old])).map((row) => row.kind)).toEqual([
      'CALL_DONE',
      'LETTER_SENT',
      'REMINDER_DONE',
    ]);
    // The attachment: its line without its names, its file gone; the receipt untouched.
    expect(
      await rows('SELECT title, original_name, shared_with_creditor_at, purged_at IS NOT NULL AS purged FROM documents WHERE id = $1', [evidence.id]),
    ).toEqual([{ title: 'Pièce supprimée', original_name: 'piece-supprimee', shared_with_creditor_at: null, purged: true }]);
    await expect(storage.read(evidence.key)).rejects.toThrow();
    // No function shares it again: it is out of reach, even of their owner.
    await rows('BEGIN');
    try {
      await rows('SET LOCAL ROLE legarec_definer');
      expect((await test.admin.query('UPDATE documents SET shared_with_creditor_at = now() WHERE id = $1', [evidence.id])).rowCount).toBe(0);
    } finally {
      await rows('ROLLBACK');
    }
    expect(await rows('SELECT title, purged_at FROM documents WHERE id = $1', [receipt.id])).toEqual([{ title: 'Facture Jeanne Martin', purged_at: null }]);
    expect((await storage.read(receipt.key)).byteLength).toBeGreaterThan(0);
    for (const table of ['receipts', 'payments', 'payment_allocations']) expect(await count(table, old), table).toBe(1);
    // Its debtor had no other case: their line stays, without name, SIREN nor access code.
    expect(await rows('SELECT name, siren, anonymized_at IS NOT NULL AS anonymized FROM debtors WHERE id = $1', [oldDebtor])).toEqual([
      { name: 'Débiteur anonymisé', siren: null, anonymized: true },
    ]);
    expect(await rows('SELECT 1 FROM debtor_access_codes WHERE debtor_id = $1', [oldDebtor])).toEqual([]);
    // Too young, or five years to the day: nothing changes.
    for (const kept of [young, exact]) {
      expect(await rows('SELECT contact_name, anonymized_at FROM cases WHERE id = $1', [kept])).toEqual([
        { contact_name: 'Jeanne Martin', anonymized_at: null },
      ]);
      expect(await count('case_events', kept)).toBe(1);
    }
    expect(await rows('SELECT name FROM debtors WHERE id = $1', [youngDebtor])).toEqual([{ name: 'Paul Durand' }]);
    expect(await rows("SELECT removed FROM retention_runs WHERE kind = 'cases' ORDER BY ran_at DESC LIMIT 1")).toEqual([{ removed: 1 }]);
  });

  it('does nothing twice, and erases the files again after a restoration of the disk', async () => {
    const id = await closedCase(await debtor('Luc Petit'), '6 years');
    const file = await document(id, 'EVIDENCE');
    expect(await purge(jobs, logger, storage)).toMatchObject({ cases: 1, 'document-files': 1 });
    expect(await purge(jobs, logger, storage)).toMatchObject({ cases: 0, 'document-files': 0 });
    // The disk restored from a backup: the file is back, and erased again.
    const restored = await storage.put(new TextEncoder().encode('%PDF-1.4'));
    await rows('UPDATE documents SET storage_key = $1 WHERE id = $2', [restored.key, file.id]);
    expect(await purge(jobs, logger, storage)).toMatchObject({ cases: 0, 'document-files': 1 });
  });

  it('anonymizes a debtor shared by several cases only with the last of them', async () => {
    const shared = await debtor('Marc Leroy');
    const [{ siren: known }] = (await rows<{ siren: string }>('SELECT siren FROM debtors WHERE id = $1', [shared])) as [{ siren: string }];
    const first = await closedCase(shared, '6 years');
    const second = await closedCase(shared, null);
    expect(await purge(jobs, logger, storage)).toMatchObject({ cases: 1 });
    expect(await rows('SELECT id, anonymized_at IS NOT NULL AS anonymized FROM cases WHERE id IN ($1, $2)', [first, second])).toEqual(
      expect.arrayContaining([
        { id: first, anonymized: true },
        { id: second, anonymized: false },
      ]),
    );
    expect(await rows('SELECT name, siren FROM debtors WHERE id = $1', [shared])).toEqual([{ name: 'Marc Leroy', siren: known }]);
    // The other one closes, and five years go by.
    await rows(`UPDATE cases SET status = 'LOST', closed_on = (${today} - interval '5 years 2 days')::date WHERE id = $1`, [second]);
    expect(await purge(jobs, logger, storage)).toMatchObject({ cases: 1 });
    expect(await rows('SELECT name, siren FROM debtors WHERE id = $1', [shared])).toEqual([{ name: 'Débiteur anonymisé', siren: null }]);
  });

  it('keeps the signed payment plan ten years, and forgets why a cheque bounced', async () => {
    const id = await closedCase(await debtor('Anne Roux'), '6 years');
    const plan = await document(id, 'PAYMENT_PLAN');
    // A free text about the debtor, left in the line of a payment.
    await rows(
      `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, settled_at, cheque_number, bank, recorded_by, bounce_reason)
         VALUES ($1, $2, 'CHEQUE', 1000, 'CASHED', '2020-01-04', '2020-01-09', '7654320', 'Banque', $3, 'Provision insuffisante, Mme Roux au chômage') RETURNING id)
       INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT $1, $2, p.id, 'OVERPAYMENT', 1000 FROM p`,
      [id, creditor, s.officerA],
    );
    expect(await purge(jobs, logger, storage)).toMatchObject({ cases: 1, 'document-files': 0 });
    expect(await rows('SELECT retention_class, purged_at FROM documents WHERE id = $1', [plan.id])).toEqual([
      { retention_class: 'ACCOUNTING', purged_at: null },
    ]);
    expect((await storage.read(plan.key)).byteLength).toBeGreaterThan(0);
    expect(await rows('SELECT amount_cents, bounce_reason FROM payments WHERE case_id = $1', [id])).toEqual([{ amount_cents: 1000, bounce_reason: null }]);
  });

  it('forgets nothing for a session that only says it is forgetting', async () => {
    const id = await closedCase(await debtor('Rose Blanc'), null);
    for (const role of ['legarec_staff', 'legarec_definer', 'legarec_worker']) {
      await rows('BEGIN');
      try {
        await rows(`SET LOCAL ROLE ${role}`);
        await rows("SELECT set_config('app.forgetting', 'on', true), set_config('app.purging', 'case_events', true)");
        // The definer calls it from its own functions only; no session takes its role.
        if (role !== 'legarec_definer') await expect(test.admin.query('SELECT app.forget_case($1)', [id]), role).rejects.toThrow(/permission denied/u);
      } finally {
        await rows('ROLLBACK');
      }
      await rows('BEGIN');
      try {
        await rows(`SET LOCAL ROLE ${role}`);
        await rows("SELECT set_config('app.forgetting', 'on', true)");
        await expect(test.admin.query('DELETE FROM case_events WHERE case_id = $1', [id]), role).rejects.toThrow(/permission denied/u);
      } finally {
        await rows('ROLLBACK');
      }
    }
    expect(await count('case_events', id)).toBe(1);
    // Nobody empties the history by hand; the forgetter itself changes its title and its text only (question 169).
    for (const role of ['legarec_staff', 'legarec_definer', 'legarec_worker']) {
      await rows('BEGIN');
      try {
        await rows(`SET LOCAL ROLE ${role}`);
        await expect(test.admin.query('UPDATE case_events SET detail = NULL WHERE case_id = $1', [id]), role).rejects.toThrow(/permission denied|append-only/u);
      } finally {
        await rows('ROLLBACK');
      }
    }
    // The trigger itself, beyond the rights: even given another column for a moment, the forgetter changes nothing else.
    await rows('BEGIN');
    try {
      await rows('GRANT UPDATE (visible_to_creditor) ON case_events TO legarec_forgetter');
      await rows('SET LOCAL ROLE legarec_forgetter');
      await expect(test.admin.query('UPDATE case_events SET visible_to_creditor = true WHERE case_id = $1', [id])).rejects.toThrow(/append-only/u);
    } finally {
      await rows('ROLLBACK');
    }
    expect(await rows('SELECT detail FROM case_events WHERE case_id = $1', [id])).toEqual([{ detail: 'Promet de payer' }]);
  });

  it('is done by the retention alone', async () => {
    const callers = await rows<{ role: string; anonymize: boolean; forget: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'app.anonymize_case()', 'EXECUTE') AS anonymize, has_function_privilege(r, 'app.forget_case(uuid)', 'EXECUTE') AS forget
       FROM unnest(ARRAY['legarec_staff', 'legarec_worker', 'legarec_partner', 'legarec_debtor', 'legarec_retention']) r`,
    );
    expect(callers.filter((row) => row.anonymize || row.forget)).toEqual([{ role: 'legarec_retention', anonymize: true, forget: false }]);
  });
});

describe('pieces of accounting, ten years after the end of their year', () => {
  let creditor = '';
  let year = 0;
  /** The last day of the year eleven years ago: gone. The first day of the year ten years ago: kept until 31 December. */
  let old = '';
  let young = '';
  let serial = 0;
  const next = () => (serial += 1);
  const one = async (sql: string, values: unknown[] = []) => (await rows<{ id: string }>(sql, values))[0]!.id;

  /** A case anonymized, or still open, with its debtor. */
  const caseOf = async (anonymized = true) => {
    const debtor = await one("INSERT INTO debtors (kind, name, anonymized_at) VALUES ('INDIVIDUAL', 'Débiteur anonymisé', now()) RETURNING id");
    return one(
      `INSERT INTO cases (reference, creditor_id, debtor_id, status, closed_on, anonymized_at)
       VALUES ($1, $2, $3, ${anonymized ? "'SETTLED', '2015-06-01', now()" : "'REMINDER', NULL, NULL"}) RETURNING id`,
      [`LGR-2014-${String(next()).padStart(5, '0')}`, creditor, debtor],
    );
  };
  const file = async (id: string | null, category: string, day: string) => {
    const stored = await storage.put(new TextEncoder().encode(`%PDF-1.4 ${next()}`));
    const made = await one(
      `INSERT INTO documents (case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, scan_status, scanned_at, created_at)
       VALUES ($1, $2, $3, 'PDF', 'Pièce', 'piece.pdf', $4, $5, $6, 'UPLOAD', 'CLEAN', now(), $7::date) RETURNING id`,
      [id, id === null ? null : creditor, category, stored.key, stored.size, stored.sha256, day],
    );
    return { id: made, key: stored.key };
  };
  /** A cheque cashed (or bounced) on `day`, with its receipt and the PDF of it. */
  const payment = async (id: string, day: string, status: 'CASHED' | 'BOUNCED' = 'CASHED') => {
    // The payment and its allocations in one statement: they add up at the end of it.
    const paid = await one(
      `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, settled_at, bounced_at, cheque_number, bank, recorded_by)
         VALUES ($1, $2, 'CHEQUE', 1000, $3, $4::date, ${status === 'CASHED' ? '$4::date' : 'NULL'}, ${status === 'BOUNCED' ? '$4::date' : 'NULL'}, $7, 'Banque', $5) RETURNING id),
       a AS (INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT $1, $2, p.id, 'OVERPAYMENT', 1000 FROM p RETURNING id, payment_id),
       b AS (INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents, reverses_id)
         SELECT $1, $2, a.payment_id, 'OVERPAYMENT', -1000, a.id FROM a WHERE $6::boolean)
       SELECT payment_id AS id FROM a`,
      [id, creditor, status, day, s.officerA, status === 'BOUNCED', String(2_000_000 + next())],
    );
    const pdf = await file(id, 'RECEIPT', day);
    await rows('INSERT INTO receipts (case_id, creditor_id, payment_id, number, document_id, issued_at) VALUES ($1, $2, $3, $4, $5, $6::date)', [
      id,
      creditor,
      paid,
      `Q-2015-${String(next()).padStart(5, '0')}`,
      pdf.id,
      day,
    ]);
    return { id: paid, receipt: pdf };
  };
  const invoice = async (day: string, number = `FA-2015-${String(next()).padStart(4, '0')}`) => {
    const made = await one(
      `INSERT INTO billing_documents (kind, number, creditor_id, issued_on, net_cents, vat_cents, gross_cents, created_by)
       VALUES ('INVOICE', $1, $2, $3::date, 100, 20, 120, $4) RETURNING id`,
      [number, creditor, day, s.director],
    );
    await rows("INSERT INTO billing_lines (document_id, label, net_cents, vat_cents, gross_cents) VALUES ($1, 'Commission', 100, 20, 120)", [made]);
    return made;
  };
  /** A credit note of the whole invoice, given back by `remittance` (null: waiting), or deducted. */
  const creditNote = async (corrected: string, day: string, refund: string | null | undefined = undefined) => {
    const made = await one(
      `INSERT INTO billing_documents (kind, number, creditor_id, issued_on, net_cents, vat_cents, gross_cents, corrected_id, reason, scope, follow_up, created_by)
       VALUES ('CREDIT_NOTE', $1, $2, $3::date, 100, 20, 120, $4, 'Erreur', 'TOTAL', $5, $6) RETURNING id`,
      [`AV-2015-${String(next()).padStart(4, '0')}`, creditor, day, corrected, refund === undefined ? 'DEDUCTED' : 'NEXT_REMITTANCE', s.director],
    );
    await rows(
      "INSERT INTO billing_lines (document_id, label, net_cents, vat_cents, gross_cents, corrected_line_id) SELECT $1, 'Commission', 100, 20, 120, l.id FROM billing_lines l WHERE l.document_id = $2",
      [made, corrected],
    );
    if (refund !== undefined)
      await rows('INSERT INTO credit_note_refunds (credit_note_id, creditor_id, amount_cents, remittance_id) VALUES ($1, $2, 120, $3)', [
        made,
        creditor,
        refund,
      ]);
    return made;
  };
  /** A batch paid on `day`, its remittance issuing an invoice of the same day, a line per payment. */
  const batch = async (day: string, payments: { case: string; id: string }[], paid = true) => {
    const made = await one(
      `INSERT INTO remittance_batches (covers_until, status, total_cents, transfers, validated_by, validated_at, paid_on)
       VALUES ($1::date, $3, 1000, 1, $2, $1::date, ${paid ? '$1::date' : 'NULL'}) RETURNING id`,
      [day, s.director, paid ? 'PAID' : 'VALIDATED'],
    );
    const issued = await invoice(day);
    const remittance = await one(
      `INSERT INTO remittances (batch_id, creditor_id, state, payments, collected_cents, fee_net_cents, fee_vat_cents, fee_gross_cents, to_pay_cents, invoice_id)
       VALUES ($1, $2, $5, $3, 1000, 100, 20, 120, 880, $4) RETURNING id`,
      [made, creditor, payments.length, issued, paid ? 'PAID' : 'READY'],
    );
    for (const paid of payments)
      await rows(
        "INSERT INTO remittance_lines (remittance_id, case_id, creditor_id, kind, payment_id, amount_cents, fee_net_cents, fee_vat_cents) VALUES ($1, $2, $3, 'PAYMENT', $4, 1000, 100, 20)",
        [remittance, paid.case, creditor, paid.id],
      );
    return { id: made, remittance, invoice: issued };
  };
  /** An invoice or a credit note dated back to the last day it may go: written once, so changed past its trigger. */
  const backdate = async (id: string) => {
    await rows('BEGIN');
    try {
      await rows('SET LOCAL session_replication_role = replica');
      await rows('UPDATE billing_documents SET issued_on = $1::date WHERE id = $2', [old, id]);
    } finally {
      await rows('COMMIT');
    }
  };
  const exists = async (table: string, id: string, column = 'id') => (await rows(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [id])).length === 1;
  const count = async (table: string, id: string) => (await rows<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE case_id = $1`, [id]))[0]!.n;
  const purged = async (id: string) =>
    (await rows<{ purged: boolean }>('SELECT purged_at IS NOT NULL AS purged FROM documents WHERE id = $1', [id]))[0]!.purged;

  beforeAll(async () => {
    creditor = await one("INSERT INTO creditors (name) VALUES ('Purge Dix Ans') RETURNING id");
    [{ year }] = (await rows<{ year: number }>("SELECT extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int AS year")) as [{ year: number }];
    old = `${year - 11}-12-31`;
    young = `${year - 10}-01-01`;
  });

  it('removes a batch of remittances once the latest of its pieces is ten years past the end of its year, with all it holds', async () => {
    const gone = await caseOf();
    const goneCash = await payment(gone, old);
    const goneBatch = await batch(old, [{ case: gone, id: goneCash.id }]);
    await rows(
      "INSERT INTO credit_note_drafts (invoice_id, scope, lines, reason, created_by, updated_at) VALUES ($1, 'TOTAL', '[]', '', $2, now() - interval '31 days')",
      [goneBatch.invoice, s.director],
    );
    // The same, but its payment came on the first day of the next year: ten years less a day after the close.
    const kept = await caseOf();
    const keptCash = await payment(kept, young);
    const keptBatch = await batch(old, [{ case: kept, id: keptCash.id }]);

    expect(await purge(jobs, logger, storage)).toMatchObject({ remittances: 1, invoices: 0, payments: 0, 'accounting-documents': 0, 'document-files': 1 });

    expect(await exists('remittance_batches', goneBatch.id)).toBe(false);
    expect(await exists('remittances', goneBatch.remittance)).toBe(false);
    expect(await exists('billing_documents', goneBatch.invoice)).toBe(false);
    expect(await exists('billing_lines', goneBatch.invoice, 'document_id')).toBe(false);
    expect(await exists('credit_note_drafts', goneBatch.invoice, 'invoice_id')).toBe(false);
    for (const table of ['payments', 'payment_allocations', 'receipts', 'remittance_lines']) expect(await count(table, gone), table).toBe(0);
    // The PDF of the receipt: its line without its names, its file erased.
    expect(await purged(goneCash.receipt.id)).toBe(true);
    await expect(storage.read(goneCash.receipt.key)).rejects.toThrow();
    // The case and its debtor keep their lines.
    expect(await rows('SELECT reference FROM cases WHERE id = $1', [gone])).toHaveLength(1);

    expect(await exists('remittance_batches', keptBatch.id)).toBe(true);
    expect(await exists('billing_documents', keptBatch.invoice)).toBe(true);
    for (const table of ['payments', 'payment_allocations', 'receipts', 'remittance_lines']) expect(await count(table, kept), table).toBeGreaterThan(0);
    expect(await purged(keptCash.receipt.id)).toBe(false);
    expect((await storage.read(keptCash.receipt.key)).byteLength).toBeGreaterThan(0);

    // Nothing more the next night: once is enough.
    expect(await purge(jobs, logger, storage)).toMatchObject({ remittances: 0, invoices: 0, payments: 0, 'accounting-documents': 0, 'document-files': 0 });
    expect(await rows("SELECT removed FROM retention_runs WHERE kind = 'remittances' ORDER BY ran_at DESC LIMIT 2")).toEqual([{ removed: 0 }, { removed: 1 }]);
  });

  it('keeps a batch while one of its cases is not anonymized, or still has a payment to remit', async () => {
    const open = await caseOf(false);
    const openBatch = await batch(old, [{ case: open, id: (await payment(open, old)).id }]);
    // Validated eleven years ago and never marked as paid: the creditor has not been paid.
    const unpaid = await caseOf();
    const unpaidCash = await payment(unpaid, old);
    const unpaidBatch = await batch(old, [{ case: unpaid, id: unpaidCash.id }], false);
    const owed = await caseOf();
    const owedBatch = await batch(old, [{ case: owed, id: (await payment(owed, old)).id }]);
    // Cashed, never remitted: the creditor is owed it, and the opening fee of the case would be taken again.
    await payment(owed, old);
    expect(await purge(jobs, logger, storage)).toMatchObject({ remittances: 0, payments: 0 });
    expect(await exists('remittance_batches', openBatch.id)).toBe(true);
    expect(await exists('remittance_batches', owedBatch.id)).toBe(true);
    expect(await exists('remittance_batches', unpaidBatch.id)).toBe(true);
    expect(await exists('payments', unpaidCash.id)).toBe(true);
    expect(await purged(unpaidCash.receipt.id)).toBe(false);
    expect(await count('payments', owed)).toBe(2);
  });

  it('keeps a batch paid while its case has a payment in a batch never marked as paid', async () => {
    const id = await caseOf();
    const remitted = await payment(id, old);
    const paidBatch = await batch(old, [{ case: id, id: remitted.id }]);
    // A second payment of the same case, in a remittance validated as long ago and never paid: not remitted yet.
    const waiting = await payment(id, old);
    const waitingBatch = await batch(old, [{ case: id, id: waiting.id }], false);
    expect(await purge(jobs, logger, storage)).toMatchObject({ remittances: 0 });
    for (const kept of [paidBatch.id, waitingBatch.id]) expect(await exists('remittance_batches', kept)).toBe(true);
    for (const cash of [remitted, waiting]) {
      expect(await exists('payments', cash.id)).toBe(true);
      expect(await exists('receipts', cash.id, 'payment_id')).toBe(true);
      expect(await purged(cash.receipt.id)).toBe(false);
    }
  });

  it('removes an invoice with its credit notes, when the latest of them may go, and batches tied by a refund together', async () => {
    const first = await caseOf();
    const firstBatch = await batch(old, [{ case: first, id: (await payment(first, old)).id }]);
    const second = await caseOf();
    const secondBatch = await batch(young, [{ case: second, id: (await payment(second, old)).id }]);
    // The invoice of the first batch is corrected, and given back by the second, ten years less a day ago.
    const note = await creditNote(firstBatch.invoice, old, secondBatch.remittance);
    expect(await purge(jobs, logger, storage)).toMatchObject({ remittances: 0 });
    expect(await exists('billing_documents', firstBatch.invoice)).toBe(true);
    expect(await exists('billing_documents', note)).toBe(true);
    // The second one ages a day: both go, the credit note and its refund with them.
    await rows('UPDATE remittance_batches SET validated_at = $1::date, paid_on = $1::date WHERE id = $2', [old, secondBatch.id]);
    await backdate(secondBatch.invoice);
    expect(await purge(jobs, logger, storage)).toMatchObject({ remittances: 2 });
    for (const id of [firstBatch.invoice, note, secondBatch.invoice]) expect(await exists('billing_documents', id)).toBe(false);
    expect(await exists('credit_note_refunds', note, 'credit_note_id')).toBe(false);

    // An invoice that no remittance holds: kept while its credit note is young, then gone with it.
    const lone = await invoice(old);
    const lateNote = await creditNote(lone, young);
    expect(await purge(jobs, logger, storage)).toMatchObject({ invoices: 0 });
    expect(await exists('billing_documents', lone)).toBe(true);
    await backdate(lateNote);
    // An invoice being corrected (a draft changed in the last 30 days): kept, the draft with it.
    const drafted = await invoice(old);
    await rows("INSERT INTO credit_note_drafts (invoice_id, scope, lines, reason, created_by) VALUES ($1, 'TOTAL', '[]', '', $2)", [drafted, s.director]);
    // A credit note waiting for the next remittance: money still owed, kept.
    const waiting = await invoice(old);
    await creditNote(waiting, old, null);
    expect(await purge(jobs, logger, storage)).toMatchObject({ invoices: 1 });
    expect(await exists('billing_documents', lone)).toBe(false);
    expect(await exists('billing_documents', lateNote)).toBe(false);
    expect(await exists('billing_documents', waiting)).toBe(true);
    expect(await exists('credit_note_drafts', drafted, 'invoice_id')).toBe(true);
  });

  it('removes a bounced payment never remitted, and the files an anonymized case kept for accounting', async () => {
    const id = await caseOf();
    const bounced = await payment(id, old, 'BOUNCED');
    const recent = await payment(id, young, 'BOUNCED');
    const plan = await file(id, 'PAYMENT_PLAN', old);
    const youngPlan = await file(id, 'PAYMENT_PLAN', young);
    const statement = await file(null, 'REMITTANCE', old);
    const living = await caseOf(false);
    const livingPlan = await file(living, 'PAYMENT_PLAN', old);
    expect(await purge(jobs, logger, storage)).toMatchObject({ payments: 1, 'accounting-documents': 1, 'document-files': 2 });
    expect(await exists('payments', bounced.id)).toBe(false);
    expect(await exists('payments', recent.id)).toBe(true);
    expect(await purged(bounced.receipt.id)).toBe(true);
    expect(await purged(recent.receipt.id)).toBe(false);
    // A statement without a case says nothing of whether its batch stays: kept.
    expect([await purged(plan.id), await purged(statement.id), await purged(youngPlan.id), await purged(livingPlan.id)]).toEqual([true, false, false, false]);
    await expect(storage.read(plan.key)).rejects.toThrow();
  });

  it('never draws a number again', async () => {
    await rows("INSERT INTO number_sequences (kind, year, last_value) VALUES ('INVOICE', $1, 7) ON CONFLICT (kind, year) DO UPDATE SET last_value = 7", [year]);
    const numbered = await invoice(old, `FA-${year}-0007`);
    expect(await purge(jobs, logger, storage)).toMatchObject({ invoices: 1 });
    expect(await exists('billing_documents', numbered)).toBe(false);
    await rows('BEGIN');
    try {
      await rows('SET LOCAL ROLE legarec_worker');
      expect(await rows("SELECT for_year, number FROM app.next_number('INVOICE')")).toEqual([{ for_year: year, number: 8 }]);
    } finally {
      await rows('ROLLBACK');
    }
    // Neither the retention nor the forgetter may touch a counter.
    expect(
      await rows(
        "SELECT r FROM unnest(ARRAY['legarec_retention', 'legarec_forgetter']) r WHERE has_table_privilege(r, 'number_sequences', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')",
      ),
    ).toEqual([]);
  });

  it('is done by the retention alone, through the forgetter', async () => {
    const roles = ['legarec_staff', 'legarec_worker', 'legarec_partner', 'legarec_debtor', 'legarec_retention', 'legarec_definer'];
    const callable = async (fn: string) =>
      (await rows<{ role: string }>(`SELECT r AS role FROM unnest($1::text[]) r WHERE has_function_privilege(r, $2, 'EXECUTE')`, [roles, fn])).map(
        (row) => row.role,
      );
    for (const name of ['purge_remittances', 'purge_invoices', 'purge_payments', 'purge_accounting_documents'])
      expect(await callable(`app.${name}()`), name).toEqual(['legarec_retention', 'legarec_definer']);
    for (const name of ['forget_remittances', 'forget_lone_invoices', 'forget_bounced_payments', 'forget_accounting_documents'])
      expect(await callable(`app.${name}()`), name).toEqual(['legarec_definer']);
    for (const name of ['forget_payments(uuid[])', 'forget_invoices(uuid[])']) expect(await callable(`app.${name}`), name).toEqual([]);
    // A receipt, a line of a remittance or an invoice: nobody else removes them, not even the owner of the tables' functions.
    for (const table of ['receipts', 'remittance_lines', 'billing_documents', 'payment_allocations']) {
      await rows('BEGIN');
      try {
        await rows('SET LOCAL ROLE legarec_definer');
        await rows("SELECT set_config('app.purging', 'nothing', true)");
        await expect(test.admin.query(`DELETE FROM ${table}`), table).rejects.toThrow(/append-only|permission denied/u);
      } finally {
        await rows('ROLLBACK');
      }
    }
  });
});
