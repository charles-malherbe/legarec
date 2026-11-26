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
    for (const years of [11, 9])
      await rows(
        `INSERT INTO gdpr_requests (case_id, creditor_id, debtor_id, kind, origin, received_on, due_on, created_by)
         VALUES ($1, $2, $3, 'ACCESS', 'Courrier', current_date - interval '${years} years', current_date, $4)`,
        [made!.id, creditor!.id, debtor!.id, s.manager],
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
      "INSERT INTO debtor_links (debtor_id, case_id, creditor_id, token_hash, channel, expires_at) VALUES ($1, $2, $3, $4, 'LETTER', now() + interval '1 day')",
      [debtor, id, creditor, hash()],
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
    for (const table of ['case_events', 'case_contacts', 'case_contact_events', 'portal_messages', 'planned_reminders', 'debtor_links'])
      expect(await count(table, old), table).toBe(0);
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
  });

  it('is done by the retention alone', async () => {
    const callers = await rows<{ role: string; anonymize: boolean; forget: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'app.anonymize_case()', 'EXECUTE') AS anonymize, has_function_privilege(r, 'app.forget_case(uuid)', 'EXECUTE') AS forget
       FROM unnest(ARRAY['legarec_staff', 'legarec_worker', 'legarec_partner', 'legarec_debtor', 'legarec_retention']) r`,
    );
    expect(callers.filter((row) => row.anonymize || row.forget)).toEqual([{ role: 'legarec_retention', anonymize: true, forget: false }]);
  });
});
