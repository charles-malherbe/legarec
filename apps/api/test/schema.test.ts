import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../src/platform/database/migrate';
import { createTestDatabase, type TestDatabase } from './database';
import { readPrismaSchema } from './prisma-schema';

/** These rules hold for every table, those of the next lots included. */
let test: TestDatabase;
const rows = async <T extends object>(sql: string, values: unknown[] = []) => (await test.admin.query<T>(sql, values)).rows;
const TABLES = "c.relkind = 'r' AND n.nspname = 'public' AND c.relname <> '_prisma_migrations'";

beforeAll(async () => {
  test = await createTestDatabase();
});
afterAll(() => test.drop());

describe('row-level security', () => {
  it('is enabled and forced on every table, with at least one policy', async () => {
    const open = await rows(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${TABLES} AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`);
    expect(open).toEqual([]);
  });

  it('gives nothing to everyone, nor to the login roles', async () => {
    const granted = await rows(`
      SELECT n.nspname, c.relname, coalesce(r.rolname, 'PUBLIC') AS grantee
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
      WHERE n.nspname IN ('public', 'app') AND (a.grantee = 0 OR r.rolname IN ('legarec_app', 'legarec_jobs'))`);
    expect(granted).toEqual([]);
    const functions = await rows(`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.prokind = 'f' AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))`);
    // Trigger functions are never called directly.
    expect(functions.map((row) => (row as { proname: string }).proname).filter((name) => name !== 'refuse_change')).toEqual([]);
  });

  it.each(['app', 'jobs'] as const)('refuses everything to legarec_%s until it takes a role', async (role) => {
    const client = new pg.Client({ connectionString: test.url(role) });
    await client.connect();
    try {
      const tables = await rows<{ relname: string }>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${TABLES}`);
      expect(tables.length).toBeGreaterThan(10);
      for (const { relname } of tables) {
        for (const sql of [`SELECT * FROM public.${relname}`, `DELETE FROM public.${relname}`])
          await expect(client.query(sql)).rejects.toThrow(/permission denied/u);
      }
      await expect(client.query('SELECT app.log($1, NULL, NULL, $1)', ['X'])).rejects.toThrow(/permission denied/u);
      for (const forbidden of ['legarec_owner', 'legarec_definer', role === 'app' ? 'legarec_worker' : 'legarec_auth', 'legarec_admin']) {
        await expect(client.query(`SET ROLE ${forbidden}`)).rejects.toThrow(/permission denied|does not exist/u);
      }
    } finally {
      await client.end();
    }
  });

  it('cannot be bypassed by any role of the application', async () => {
    const roles = await rows(
      "SELECT rolname FROM pg_roles WHERE rolname LIKE 'legarec\\_%' AND rolname <> 'legarec_admin' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit OR rolreplication)",
    );
    expect(roles).toEqual([]);
  });
});

describe('tables of a case', () => {
  it('carry the creditor of the case, checked by a composite key without cascade', async () => {
    const tables = await rows<{ table_name: string }>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'case_id'",
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const { table_name } of tables) {
      const keys = await rows<{ definition: string; confupdtype: string; confdeltype: string }>(
        "SELECT pg_get_constraintdef(oid) AS definition, confupdtype, confdeltype FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'f' AND confrelid = 'cases'::regclass",
        [table_name],
      );
      expect(keys, table_name).toEqual([
        { definition: 'FOREIGN KEY (case_id, creditor_id) REFERENCES cases(id, creditor_id)', confupdtype: 'a', confdeltype: 'a' },
      ]);
      const optional = await rows("SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'case_id' AND is_nullable = 'YES'", [
        table_name,
      ]);
      if (optional.length) {
        const check = await rows(
          "SELECT 1 FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%case_id IS NULL%creditor_id IS NOT NULL%'",
          [table_name],
        );
        expect(check, `${table_name}: a case without its creditor`).toHaveLength(1);
      }
    }
  });

  it('never cascade a change nor a deletion, whatever the table', async () => {
    const cascades = await rows(
      "SELECT conrelid::regclass::text AS source, conname FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND (confupdtype <> 'a' OR confdeltype NOT IN ('a', 'r'))",
    );
    expect(cascades).toEqual([]);
  });
});

describe('functions that see more than their caller', () => {
  it('belong to a role without login, with a fixed search path', async () => {
    const wrong = await rows(`
      SELECT p.proname, r.rolname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
      WHERE n.nspname IN ('app', 'public') AND p.prosecdef AND ((r.rolname <> 'legarec_definer' AND NOT (r.rolname = 'legarec_forgetter' AND p.proname IN ('forget_case', 'forget_debtor', 'forget_remittances', 'forget_lone_invoices', 'forget_bounced_payments', 'forget_accounting_documents', 'forget_waiting_files', 'forget_case_story', 'forget_old_history'))) OR r.rolcanlogin OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp'])`);
    expect(wrong).toEqual([]);
  });
});

const rightsOf = async (role: string) =>
  (
    await rows<{ entry: string }>(
      `SELECT c.relname || ' ' || a.privilege_type || ' (*)' AS entry
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
       WHERE n.nspname = 'public' AND r.rolname = $1
       UNION ALL
       SELECT c.relname || ' ' || a.privilege_type || ' (' || string_agg(t.attname, ', ' ORDER BY t.attname) || ')'
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute t ON t.attrelid = c.oid CROSS JOIN LATERAL aclexplode(t.attacl) a JOIN pg_roles r ON r.oid = a.grantee
       WHERE n.nspname = 'public' AND r.rolname = $1 GROUP BY c.relname, a.privilege_type
       ORDER BY 1`,
      [role],
    )
  ).map((row) => row.entry);

const IDEMPOTENCY = [
  'idempotency_keys INSERT (actor, key, request_hash, route)',
  'idempotency_keys SELECT (actor, created_at, key, request_hash, result, route, status)',
  'idempotency_keys UPDATE (created_at, request_hash, result, route, status)',
];
const CASE_EVENTS =
  'case_events SELECT (actor_id, actor_kind, actor_label, case_id, creditor_id, detail, id, kind, occurred_at, on_behalf_of_id, title, tone, visible_to_creditor)';
const DEBTORS = 'debtors SELECT (anonymized_at, created_at, id, kind, legal_form_checked_at, legal_form_code, legal_form_source, name, name_confirmed, siren)';

const MONEY_OUTSIDE = [
  // Documents shared with them, clean and without the access code (policies).
  'documents SELECT (case_id, category, created_at, creditor_id, id, kind, original_name, size_bytes, title)',
  'installments SELECT (amount_cents, case_id, creditor_id, due_on, id, number, plan_id)',
  'payment_allocations SELECT (amount_cents, case_id, component, creditor_id, id, invoice_id, payment_id, reverses_id)',
  'payment_plans SELECT (accepted_at, case_id, creditor_id, first_due_on, id, method, months, status, total_cents)',
  'payments SELECT (amount_cents, case_id, creditor_id, id, method, received_on, status)',
];

describe('rights of the roles that face the outside', () => {
  // Any addition shows here: it must be wanted.
  const expected: Record<string, string[]> = {
    // Sign-in: the credentials of one account at a time, which its policies choose.
    legarec_auth: [
      'auth_tokens INSERT (expires_at, purpose, session_id, token_hash, user_id)',
      'auth_tokens SELECT (created_at, expires_at, id, opened_at, purpose, session_id, token_hash, used_at, user_id)',
      'auth_tokens UPDATE (expires_at, opened_at, used_at)',
      'backup_codes DELETE (*)',
      'backup_codes INSERT (code_hash, user_id)',
      'backup_codes SELECT (code_hash, id, used_at, user_id)',
      'backup_codes UPDATE (used_at)',
      'second_factors DELETE (*)',
      'second_factors INSERT (confirmed_at, credential_id, id, kind, public_key, secret_cipher, sign_count, transports, user_id)',
      'second_factors SELECT (confirmed_at, created_at, credential_id, id, kind, last_step, last_used_at, public_key, secret_cipher, sign_count, transports, user_id)',
      'second_factors UPDATE (confirmed_at, last_step, last_used_at, secret_cipher, sign_count)',
      'user_devices INSERT (expires_at, label, token_hash, user_id)',
      'user_devices SELECT (expires_at, id, token_hash, user_id)',
      'user_devices UPDATE (expires_at, label, last_seen_at)',
      'user_sessions INSERT (device_label, expires_at, ip, mobile, persistent, portal, second_factor_at, second_factor_needed, token_hash, user_id)',
      'user_sessions SELECT (created_at, device_label, expires_at, id, ip, last_seen_at, mobile, persistent, portal, proved_at, revoked_at, second_factor_at, second_factor_needed, user_id)',
      'user_sessions UPDATE (expires_at, last_seen_at, proved_at, revoked_at, second_factor_at, token_hash)',
      'users SELECT (creditor_id, email, first_name, id, last_name, last_seen_at, password_hash, role, status, two_factor_required)',
      'users UPDATE (last_seen_at, password_changed_at, password_hash, status)',
    ],
    legarec_hook: ['webhook_events INSERT (id, provider, provider_event_id)', 'webhook_events SELECT (id, provider, provider_event_id)'],
    legarec_public: [],
    legarec_service: IDEMPOTENCY,
    legarec_partner: [
      'case_events SELECT (actor_kind, actor_label, case_id, creditor_id, detail, id, kind, occurred_at, title, tone, visible_to_creditor)',
      'cases SELECT (anonymized_at, closed_on, creditor_id, debtor_id, deposited_name, external_reference, id, opened_on, reference, status)',
      'creditors SELECT (id, name, siren, status)',
      'debtors SELECT (id, kind, name, siren)',
      ...IDEMPOTENCY,
      'users SELECT (creditor_id, email, first_name, id, last_name, role, status)',
      'case_invoices SELECT (case_id, claimed_cents, creditor_id, due_on, external_ref, id, issued_on, number, principal_cents, principal_paid_cents, state)',
      // The creditor step of a plan, and the payments of its cases: date, amount, means.
      ...MONEY_OUTSIDE.filter((entry) => !entry.startsWith('payment_plans')),
      // When a plan was asked, and beyond which length it needs the creditor.
      'payment_plans SELECT (accepted_at, case_id, created_at, creditor_id, first_due_on, id, method, months, status, threshold_months, total_cents)',
      'plan_approvals SELECT (case_id, creditor_id, decided_at, decision, id, plan_id, step)',
      // Its imports of claims, until it confirms them.
      'claim_imports INSERT (claims, creditor_id, errors, id, lines, status, total_cents, uploaded_by, valid)',
      'claim_imports SELECT (claims, confirmed_at, created_at, created_count, creditor_id, errors, expires_at, id, lines, status, total_cents, uploaded_by, valid)',
      'claim_imports UPDATE (claims, confirmed_at, created_count, errors, status)',
    ],
    legarec_debtor: [
      'cases SELECT (closed_on, creditor_id, debtor_id, formal_notice_on, id, mandate_id, opened_on, reference, status)',
      // What they owe, with its interest, and how to pay it: never the fees of the mandate, nor any other setting.
      'creditors SELECT (id, name)',
      'interest_rates SELECT (id, kind, rate_bp, valid_from)',
      'mandates SELECT (contract_rate_bp, creditor_id, fixed_indemnity, id, interest_mode)',
      'settings SELECT (key, value)',
      'payment_plans SELECT (accepted_at, case_id, created_at, creditor_id, first_due_on, id, method, months, status, total_cents)',
      'debtors SELECT (id, kind, name, siren)',
      ...IDEMPOTENCY,
      'case_invoices SELECT (case_id, claimed_cents, creditor_id, due_on, external_ref, id, issued_on, number, principal_cents, principal_paid_cents, state)',
      ...MONEY_OUTSIDE.filter((entry) => !entry.startsWith('payment_plans') && !entry.startsWith('documents')),
      'documents SELECT (case_id, category, created_at, creditor_id, id, kind, original_name, scan_status, size_bytes, source, title)',
      'portal_message_attachments SELECT (case_id, creditor_id, document_id, id, message_id)',
      'portal_messages SELECT (case_id, created_at, creditor_id, id, read_by_debtor_at, read_by_staff_at, request_kind, side, text)',
      'receipts SELECT (case_id, creditor_id, id, issued_at, number, payment_id)',
    ],
  };
  it.each(Object.entries(expected))('%s', async (role, rights) => {
    expect((await rightsOf(role)).sort()).toEqual([...rights].sort());
  });

  it('never let the team read a password, a token or an encrypted value', async () => {
    const readable = await rows(`
      SELECT c.relname, t.attname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute t ON t.attrelid = c.oid
      WHERE n.nspname = 'public' AND t.attnum > 0 AND t.attname ~ '(_hash|_cipher|_hmac)$' AND c.relkind = 'r'
        AND has_column_privilege('legarec_staff', c.oid, t.attname, 'SELECT') AND c.relname <> 'idempotency_keys'`);
    expect(readable).toEqual([]);
  });
});

describe('rights of the roles inside', () => {
  // Any addition shows here too: the team reads, and writes by the functions; only the purge erases.
  const expected: Record<string, string[]> = {
    legarec_staff: [
      'audit_log SELECT (action, actor_id, actor_kind, actor_label, entity_id, entity_type, id, ip, occurred_at, on_behalf_of_id, params, request_id)',
      CASE_EVENTS,
      'cases UPDATE (closed_on, external_reference, status, version)',
      DEBTORS,
      'delegations SELECT (granted_at, granted_by, id, kind, withdrawn_at, withdrawn_by)',
      ...IDEMPOTENCY,
      'mailbox_requests SELECT (created_at, decided_at, decided_by, id, local, requested_by, status, user_id)',
      'notification_preferences INSERT (email, in_app, kind, user_id)',
      'notification_preferences SELECT (email, in_app, kind, user_id)',
      'notification_preferences UPDATE (email, in_app)',
      'notifications UPDATE (read_at)',
      'retention_runs SELECT (id, kind, ran_at, removed)',
      'support_tickets SELECT (created_at, id, message, number, status, subject, user_id)',
      'users SELECT (absent_from, absent_until, anonymized_at, auto_reply, created_at, creditor_id, daily_summary, density, disabled_at, email, extension, first_name, id, invited_at, last_name, last_seen_at, low_vision, password_changed_at, quiet_hours, role, status, substitute_id, theme, two_factor_required)',
      // One's own line: never the role, the address, the status nor the credentials.
      'users UPDATE (absent_from, absent_until, auto_reply, daily_summary, density, first_name, last_name, low_vision, quiet_hours, substitute_id, theme)',
      'vault_secrets SELECT (created_at, decided_by, id, kind, last_used_at, name, requested_by, rotated_at, rotation, status)',
      'setting_versions SELECT (changed_at, changed_by, id, key, on_behalf_of_id)',
      'settings SELECT (key, on_behalf_of_id, updated_at, updated_by, value, version)',
      'creditor_bank_accounts INSERT (bic, confirmed_at, confirmed_by, confirmed_with, created_by, creditor_id, holder, iban_cipher, iban_masked, id, on_behalf_of_id)',
      'creditor_bank_accounts SELECT (bic, confirmed_at, confirmed_by, confirmed_with, created_by, creditor_id, holder, iban_masked, id, on_behalf_of_id, valid_from, valid_until)',
      'creditor_bank_accounts UPDATE (confirmed_at, confirmed_by, confirmed_with, valid_until)',
      'creditor_contacts DELETE (*)',
      'creditor_contacts INSERT (created_at, creditor_id, email, id, is_main, name, phone, title)',
      'creditor_contacts SELECT (created_at, creditor_id, email, id, is_main, name, phone, title)',
      'creditors INSERT (address, city, created_at, id, legal_name, manager_id, name, portal_enabled, postal_code, sector, siren, status, updated_at, updated_by, vat_number, version)',
      'creditors SELECT (address, city, created_at, id, legal_name, manager_id, name, portal_enabled, postal_code, sector, siren, status, updated_at, updated_by, vat_number, version)',
      'creditors UPDATE (address, city, legal_name, manager_id, name, portal_enabled, postal_code, sector, updated_at, updated_by, vat_number, version)',
      'mandates INSERT (amends_id, amicable_rate_bp, contract_rate_bp, created_at, created_by, creditor_id, defer_small_remittances, discount_max_bp, ends_on, fixed_indemnity, id, interest_mode, litigation_needs_consent, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, reporting_day, scenario, starts_on)',
      'mandates SELECT (amends_id, amicable_rate_bp, contract_rate_bp, created_at, created_by, creditor_id, defer_small_remittances, discount_max_bp, ends_on, fixed_indemnity, id, interest_mode, litigation_needs_consent, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, reporting_day, scenario, starts_on)',
      'mandates UPDATE (ends_on)',
      'case_contact_events SELECT (actor_id, actor_label, case_id, contact_id, creditor_id, id, occurred_at, what)',
      'case_contacts INSERT (case_id, created_at, created_by, creditor_id, id, is_primary, kind, label, source, status, value, value_normalized)',
      'case_contacts SELECT (case_id, created_at, created_by, creditor_id, id, invalidated_at, is_primary, kind, label, replaced_by_id, source, status, value, value_normalized)',
      'case_contacts UPDATE (invalidated_at, is_primary, replaced_by_id, status)',
      'case_invoices INSERT (case_id, claimed_cents, created_at, created_by, creditor_id, due_on, external_ref, id, issued_on, number, principal_cents, principal_paid_cents, state)',
      'case_invoices SELECT (case_id, claimed_cents, created_at, created_by, creditor_id, due_on, external_ref, id, issued_on, number, principal_cents, principal_paid_cents, state)',
      'cases INSERT (contact_name, contact_title, created_at, created_by, creditor_id, debtor_address, debtor_city, debtor_id, debtor_postal_code, debtor_siret, external_reference, id, mandate_id, officer_id, opened_on, reference, scenario, status, version)',
      'cases SELECT (anonymized_at, closed_on, contact_name, contact_title, created_at, created_by, creditor_id, debtor_address, debtor_city, debtor_id, debtor_postal_code, debtor_siret, deposited_name, external_reference, first_letter_on, first_letter_reference, formal_notice_on, id, mandate_id, officer_id, opened_on, purge_after, reference, scenario, status, version)',
      'notifications SELECT (action, actor_id, case_count, case_id, created_at, creditor_id, id, kind, plan_decision, plan_id, read_at, sending_id, target_id, ticket_id, user_id)',
      // Documents: received in one's own name, never scanned nor filed by hand.
      'documents INSERT (author_id, case_id, category, contains_access_code, creditor_id, id, kind, original_name, scan_status, sha256, size_bytes, source, storage_key, title, visible_to_debtor)',
      'documents SELECT (author_id, case_id, category, contains_access_code, created_at, creditor_id, id, kind, original_name, purged_at, retention_class, scan_status, scanned_at, sha256, shared_by, shared_with_creditor_at, size_bytes, source, storage_key, title, uploaded_by_creditor, uploaded_by_debtor, visible_to_debtor)',
      'documents UPDATE (category, title)',
      'claim_deposits SELECT (address, created_at, creditor_id, debtor_name, decided_at, decided_by, deposited_by, email, files, id, invoice_count, invoices, on_behalf_of_id, opened_case, phone, reason, siret, status, total_cents)',
      'claim_imports SELECT (confirmed_at, created_at, created_count, creditor_id, id, lines, status, total_cents, uploaded_by, valid)',
      // The journal of the assistant: read with the case; the decision said by whoever acts on it.
      'ai_suggestions SELECT (case_id, created_at, creditor_id, decision, events, feature, id, model, outcome, output, prompt_version)',
      'ai_suggestions UPDATE (decision)',
      // Reminders planned in the agenda: those of the cases one reads; planned and changed on those one acts on.
      'planned_reminders DELETE (*)',
      'planned_reminders INSERT (case_id, creditor_id, due_on, due_time, kind, title, warning)',
      'planned_reminders SELECT (case_id, created_at, created_by, creditor_id, done_at, due_on, due_time, id, kind, title, warning)',
      'planned_reminders UPDATE (done_at, due_on, due_time)',
      // What leaves for a debtor (lot Q): started by whoever acts on the case; only the worker says what left. Neither the text typed nor the reference of the provider is read back.
      'sendings INSERT (case_id, channel, contact_id, creditor_id, level, template)',
      'sendings SELECT (case_id, channel, contact_id, created_at, created_by, creditor_id, document_id, failure, id, level, on_behalf_of_id, sent_at, simulated, status, template)',
      // Litigation: read with the cases; opened and followed on those one acts on, the dates and the author set by PostgreSQL.
      'litigation_files INSERT (case_id, consent, creditor_id, stage, version)',
      'litigation_files SELECT (case_id, consent, consent_noted_at, consent_noted_by, court, created_at, created_by, creditor_id, id, on_behalf_of_id, partner_name, stage, stage_since, title_on, version)',
      'litigation_files UPDATE (consent, court, partner_name, stage, version)',
      // What each one marked done on their dashboard: their own lines only.
      'task_marks DELETE (*)',
      'task_marks INSERT (key, user_id)',
      'task_marks SELECT (done_at, key, user_id)',
      // Links of the letters and messages without a code: the manager reads the latter.
      'debtor_links SELECT (case_id, channel, created_at, creditor_id, debtor_id, expires_at, id, revoked_at, uses)',
      'limited_messages SELECT (claimed_reference, created_at, id, read_at, sender_email, sender_name, text)',
      'limited_messages UPDATE (read_at)',
      // Messages of the space of the debtor: read; written by their functions.
      'portal_message_attachments SELECT (case_id, creditor_id, document_id, id, message_id)',
      'portal_messages SELECT (author_id, case_id, created_at, creditor_id, id, read_by_debtor_at, read_by_staff_at, request_data, request_kind, side, text)',
      // Templates: every version read; written by their functions.
      'template_versions SELECT (accepted, checks, created_at, file_name, has_warnings, id, imported_by, number, on_behalf_of_id, published_at, review_reason, reviewed_by, source, state, submitted_by, template_code, updated_at)',
      // Money: read only; written by the functions of the money.
      'installments SELECT (amount_cents, case_id, creditor_id, due_on, id, number, plan_id)',
      'interest_rates SELECT (entered_by, id, kind, on_behalf_of_id, rate_bp, updated_at, valid_from)',
      'payment_allocations SELECT (amount_cents, case_id, component, created_at, creditor_id, id, invoice_id, payment_id, reverses_id)',
      'payment_plans SELECT (accepted_at, case_id, created_at, creditor_id, document_id, first_due_on, id, method, months, on_behalf_of_id, owned_by_director, requested_by, status, threshold_months, total_cents, version)',
      'payments SELECT (amount_cents, bank, bounce_reason, bounced_at, case_id, cheque_number, created_at, creditor_id, deposited_on, id, label, method, on_behalf_of_id, received_on, recorded_by, settled_at, status, version)',
      'plan_approvals SELECT (case_id, creditor_id, decided_at, decided_by, decision, id, on_behalf_of_id, plan_id, reason, step)',
      'receipts SELECT (case_id, creditor_id, document_id, id, issued_at, number, payment_id)',
    ],
    legarec_worker: [
      // The links leave with the e-mails that it sends, and are kept nowhere.
      'auth_tokens INSERT (expires_at, purpose, token_hash, user_id)',
      'auth_tokens SELECT (id, purpose, used_at, user_id)',
      'auth_tokens UPDATE (used_at)',
      CASE_EVENTS,
      // The first letter opens the reminders and the portal of the debtor: only the worker that sent it records it.
      'cases UPDATE (closed_on, external_reference, first_letter_on, first_letter_reference, formal_notice_on, status, version)',
      DEBTORS,
      'delegations SELECT (granted_at, granted_by, id, kind, withdrawn_at, withdrawn_by)',
      'outbox SELECT (acting_for, actor_id, actor_kind, claimed_at, created_at, done_at, failed_at, failure, id, name, payload, published_at, queue, run_at, started_at)',
      'outbox UPDATE (claimed_at, done_at, failed_at, failure, published_at, started_at)',
      'second_factors SELECT (confirmed_at, id, kind, user_id)',
      'support_tickets SELECT (created_at, id, message, number, subject, user_id)',
      'user_sessions SELECT (created_at, device_label, id, ip, user_id)',
      'users SELECT (creditor_id, email, first_name, id, invited_by, last_name, role, status, two_factor_required)',
      'webhook_events SELECT (id, processed_at, provider, provider_event_id, received_at, status)',
      'webhook_events UPDATE (processed_at, status)',
      'settings SELECT (key, value)',
      'creditor_contacts SELECT (creditor_id, email, id, is_main, name, phone, title)',
      'creditors SELECT (address, city, created_at, id, legal_name, name, portal_enabled, postal_code, siren, status)',
      'mandates SELECT (amends_id, amicable_rate_bp, contract_rate_bp, created_at, created_by, creditor_id, defer_small_remittances, discount_max_bp, ends_on, fixed_indemnity, id, interest_mode, litigation_needs_consent, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, reporting_day, scenario, starts_on)',
      'case_contacts SELECT (case_id, creditor_id, id, is_primary, kind, label, status, value, value_normalized)',
      'case_invoices SELECT (case_id, claimed_cents, created_at, creditor_id, due_on, external_ref, id, issued_on, number, principal_cents, principal_paid_cents, state)',
      'cases SELECT (anonymized_at, closed_on, contact_name, contact_title, created_at, created_by, creditor_id, debtor_address, debtor_city, debtor_id, debtor_postal_code, debtor_siret, deposited_name, external_reference, first_letter_on, first_letter_reference, formal_notice_on, id, mandate_id, officer_id, opened_on, purge_after, reference, scenario, status, version)',
      'debtor_access_codes SELECT (code_cipher, debtor_id)',
      'debtor_access_codes UPDATE (code_cipher)',
      'interest_rates SELECT (kind, rate_bp, valid_from)',
      'installments SELECT (amount_cents, case_id, creditor_id, due_on, id, number, plan_id)',
      'payment_allocations SELECT (amount_cents, case_id, component, creditor_id, id, invoice_id, payment_id, reverses_id)',
      'payment_plans SELECT (accepted_at, case_id, creditor_id, first_due_on, id, method, months, status, total_cents, version)',
      'payments SELECT (amount_cents, bounced_at, case_id, creditor_id, deposited_on, id, method, received_on, settled_at, status)',
      'plan_approvals SELECT (case_id, creditor_id, decided_at, decision, id, plan_id, step)',
      // The verdict of ClamAV, and the documents it generates.
      'documents INSERT (case_id, category, contains_access_code, creditor_id, id, kind, original_name, scan_status, scanned_at, sha256, size_bytes, source, storage_key, title, visible_to_debtor)',
      'documents SELECT (author_id, case_id, category, contains_access_code, created_at, creditor_id, id, kind, original_name, purged_at, retention_class, scan_status, scanned_at, sha256, shared_with_creditor_at, size_bytes, source, storage_key, title, uploaded_by_creditor, uploaded_by_debtor, visible_to_debtor)',
      'documents UPDATE (scan_status, scanned_at)',
      'portal_message_attachments SELECT (case_id, creditor_id, document_id, id, message_id)',
      'portal_messages SELECT (author_id, case_id, created_at, creditor_id, id, read_by_debtor_at, read_by_staff_at, request_data, request_kind, side, text)',
      // The templates in force, for the letters.
      'template_versions SELECT (id, number, source, state, template_code)',
      // The suggestions of the assistant it writes, and what the month has cost.
      'ai_suggestions INSERT (asked_by, case_id, cost_micro, creditor_id, decision, events, feature, input_summary, input_tokens, model, outcome, output, output_tokens, prompt_version)',
      'ai_suggestions SELECT (case_id, cost_micro, created_at, creditor_id, decision, events, feature, id, outcome)',
      // The reminders it will send (lot Q).
      'planned_reminders SELECT (case_id, creditor_id, done_at, due_on, due_time, id, kind, title)',
      // What it sends, and what happened to it.
      'sendings SELECT (case_id, channel, contact_id, created_at, created_by, creditor_id, document_id, failure, id, level, provider_ref, sent_at, simulated, status, template)',
      'sendings UPDATE (document_id, failure, provider_ref, sent_at, simulated, status)',
      // The links of the letters it sends (lot Q).
      'debtor_links INSERT (case_id, channel, creditor_id, debtor_id, expires_at, token_hash)',
      'debtor_links SELECT (case_id, channel, creditor_id, debtor_id, expires_at, id, revoked_at, uses)',
      // The PDF of a receipt (lot N).
      'receipts SELECT (case_id, creditor_id, document_id, id, issued_at, number, payment_id)',
      'receipts UPDATE (document_id)',
    ],
    legarec_retention: [
      // The journal of the assistant, after a year.
      'ai_suggestions DELETE (*)',
      'ai_suggestions SELECT (created_at, id)',
      // Imports never confirmed, after 30 days; messages without a code, after 6 months.
      'limited_messages DELETE (*)',
      'limited_messages SELECT (created_at, id)',
      // The registry of the RGPD, after 10 years.
      'gdpr_requests DELETE (*)',
      'gdpr_requests SELECT (answered_at, id, received_on)',
      // Marks of the dashboard, after 2 years.
      'task_marks DELETE (*)',
      'task_marks SELECT (done_at)',
      'claim_deposits DELETE (*)',
      'claim_deposits SELECT (decided_at, id, status)',
      'claim_imports DELETE (*)',
      'claim_imports SELECT (expires_at, id, status)',
      // Drafts of credit notes left aside, after 30 days.
      'credit_note_drafts DELETE (*)',
      'credit_note_drafts SELECT (id, updated_at)',
      'idempotency_keys DELETE (*)',
      'idempotency_keys SELECT (created_at)',
      'notifications DELETE (*)',
      'notifications SELECT (created_at)',
      'outbox DELETE (*)',
      'outbox SELECT (done_at, failed_at, id)',
      'retention_runs INSERT (kind, removed)',
      'support_tickets DELETE (*)',
      'support_tickets SELECT (created_at)',
      'task_keys DELETE (*)',
      'task_keys SELECT (created_at, task_id)',
      'webhook_events DELETE (*)',
      'webhook_events SELECT (id, received_at, status)',
      // The files of the documents erased with their case, removed from the disk.
      'documents SELECT (id, purged_at, storage_key)',
    ],
    legarec_definer: [
      'audit_log DELETE (*)',
      'audit_log INSERT (*)',
      'audit_log SELECT (id, occurred_at)',
      'auth_tokens DELETE (*)',
      'auth_tokens SELECT (expires_at, id, opened_at, purpose, session_id, token_hash, used_at, user_id)',
      'auth_tokens UPDATE (used_at)',
      'backup_codes DELETE (*)',
      'backup_codes SELECT (user_id)',
      'case_events INSERT (*)',
      'case_events SELECT (actor_id, case_id, creditor_id, kind, occurred_at, title)',
      'cases UPDATE (closed_on, officer_id, status, version)',
      'claim_deposits INSERT (*)',
      'claim_deposits SELECT (*)',
      'claim_deposits UPDATE (*)',
      'creditors SELECT (address, city, id, legal_name, name, portal_enabled, postal_code, siren, vat_number)',
      'delegations INSERT (granted_by, kind)',
      'delegations SELECT (*)',
      'delegations UPDATE (withdrawn_at, withdrawn_by)',
      'lockouts DELETE (*)',
      'lockouts INSERT (*)',
      'lockouts SELECT (*)',
      'lockouts UPDATE (*)',
      'mailbox_requests DELETE (*)',
      'mailbox_requests INSERT (local, requested_by, user_id)',
      'mailbox_requests SELECT (user_id)',
      'notification_preferences DELETE (*)',
      'notification_preferences SELECT (user_id)',
      'notifications DELETE (*)',
      'notifications SELECT (case_id, created_at, kind, read_at, sending_id, user_id)',
      'number_sequences INSERT (*)',
      'number_sequences SELECT (*)',
      'number_sequences UPDATE (*)',
      'outbox INSERT (*)',
      // Closes, never gives: no secret, no key of a security key, no code is read by a function.
      'second_factors DELETE (*)',
      'second_factors SELECT (confirmed_at, user_id)',
      'setting_versions INSERT (changed_by, id, key, on_behalf_of_id, previous_cipher)',
      'settings INSERT (key, on_behalf_of_id, updated_by, value)',
      'settings SELECT (key, on_behalf_of_id, updated_by, value, version)',
      'settings UPDATE (on_behalf_of_id, updated_at, updated_by, value, version)',
      'support_tickets INSERT (id, message, number, subject, user_id)',
      'support_tickets SELECT (id, user_id)',
      'task_keys INSERT (*)',
      'task_keys SELECT (key, name, owner)',
      'user_devices DELETE (*)',
      'user_devices SELECT (expires_at, user_id)',
      'user_sessions DELETE (*)',
      'user_sessions SELECT (expires_at, id, last_seen_at, portal, proved_at, revoked_at, second_factor_at, second_factor_needed, token_hash, user_id)',
      'user_sessions UPDATE (last_seen_at, revoked_at)',
      'users DELETE (*)',
      'users INSERT (creditor_id, email, first_name, invited_at, invited_by, last_name, role)',
      'users UPDATE (anonymized_at, disabled_at, disabled_by, disabled_reason, email, extension, first_name, invited_at, last_name, last_seen_at, password_hash, role, status, substitute_id, two_factor_required)',
      // Written, never read.
      'vault_secrets INSERT (id, name, rotation, value_cipher)',
      'vault_secrets UPDATE (decided_by, requested_by, rotated_at, status, value_cipher)',
      'creditor_bank_accounts SELECT (confirmed_at, creditor_id, iban_cipher, iban_masked, id, valid_until)',
      'case_contact_events INSERT (actor_id, actor_label, case_id, contact_id, creditor_id, what)',
      'case_contacts SELECT (case_id, created_at, creditor_id, id, kind, label, status, value, value_normalized)',
      'debtors INSERT (id, kind, legal_form_checked_at, legal_form_code, legal_form_source, name, name_confirmed, siren)',
      'cases SELECT (anonymized_at, closed_on, contact_name, creditor_id, debtor_address, debtor_city, debtor_id, debtor_postal_code, first_letter_on, id, mandate_id, officer_id, opened_on, reference, status, version)',
      'debtor_access_codes INSERT (code_cipher, debtor_id, generated_by)',
      'debtor_retired_codes INSERT (code_hmac, debtor_id)',
      'debtor_retired_codes SELECT (code_hmac, debtor_id)',
      'vault_secrets SELECT (created_at, id, kind, name, rotated_at, status, value_cipher)',
      'notifications INSERT (action, actor_id, case_count, case_id, creditor_id, kind, plan_decision, plan_id, sending_id, target_id, ticket_id, user_id)',
      'users SELECT (absent_from, absent_until, anonymized_at, creditor_id, disabled_at, email, first_name, id, invited_at, invited_by, last_name, password_hash, role, status, substitute_id, two_factor_required)',
      'debtor_access_codes SELECT (code_cipher, code_hmac, debtor_id, version)',
      'debtor_access_codes UPDATE (code_cipher, code_hmac, generated_at, generated_by, version)',
      'debtors SELECT (anonymized_at, id, kind, name, name_confirmed, siren)',
      'debtors UPDATE (kind, name, name_confirmed)',
      // Access of the debtors: their sessions and the attempts counted on their identifiers.
      'debtor_sessions DELETE (*)',
      'debtor_sessions INSERT (*)',
      'debtor_sessions SELECT (*)',
      'debtor_sessions SELECT (expires_at, id, last_seen_at, revoked_at)',
      'debtor_sessions UPDATE (last_seen_at, revoked_at)',
      'lockouts INSERT (failures, key_hash, scope)',
      'lockouts SELECT (blocked_at, debtor_id, failures, key_hash, last_failure_at, locked_until, scope)',
      'lockouts UPDATE (blocked_at, debtor_id, failures, last_failure_at, locked_until)',
      // Templates: their steps, by their functions.
      'template_versions INSERT (accepted, checks, file_name, has_warnings, id, imported_by, on_behalf_of_id, source, state, template_code)',
      'template_versions SELECT (*)',
      'template_versions UPDATE (number, on_behalf_of_id, published_at, review_reason, reviewed_by, state, submitted_by, updated_at)',
      // Documents: shared by its function.
      'documents INSERT (category, id, kind, original_name, sha256, size_bytes, source, storage_key, title, uploaded_by_creditor, uploaded_by_debtor)',
      'documents SELECT (case_id, contains_access_code, created_at, creditor_id, id, purged_at, scan_status, shared_with_creditor_at, source, uploaded_by_creditor, uploaded_by_debtor)',
      'documents UPDATE (case_id, creditor_id, shared_by, shared_with_creditor_at)',
      'debtor_links SELECT (case_id, debtor_id, expires_at, id, revoked_at, token_hash, uses)',
      'ai_suggestions SELECT (asked_by, case_id, cost_micro, created_at, decided_by, decision, feature, id, input_summary, input_tokens, model, outcome, output_tokens, prompt_version)',
      'planned_reminders SELECT (case_id, done_at, due_on, id, kind)',
      // Counted for the caps of a debtor, whatever the creditor (app.sent_contacts); who asked, to be told of a failure.
      'sendings SELECT (case_id, channel, created_at, created_by, creditor_id, id, sent_at, status)',
      // Remittances and invoices of the firm: their functions only.
      'billing_documents INSERT (*)',
      'billing_documents SELECT (*)',
      'billing_lines INSERT (*)',
      'billing_lines SELECT (*)',
      'remittance_batches INSERT (*)',
      'remittance_batches SELECT (*)',
      'remittance_batches UPDATE (paid_by, paid_on, status)',
      'remittance_lines INSERT (*)',
      'remittance_lines SELECT (*)',
      'remittances INSERT (*)',
      'remittances SELECT (*)',
      'remittances UPDATE (state)',
      // Credit notes: their drafts and what the next remittance gives back, by their functions.
      'credit_note_drafts DELETE (*)',
      'credit_note_drafts INSERT (*)',
      'credit_note_drafts SELECT (*)',
      'credit_note_drafts UPDATE (follow_up, lines, reason, scope, updated_at)',
      'credit_note_refunds INSERT (*)',
      'credit_note_refunds SELECT (*)',
      'credit_note_refunds UPDATE (remittance_id)',
      // The registry of the RGPD: its functions only.
      'gdpr_requests INSERT (*)',
      'gdpr_requests SELECT (*)',
      'gdpr_requests UPDATE (answered_at, answered_by, reason, status)',
      'debtor_links UPDATE (uses)',
      'limited_messages INSERT (claimed_reference, sender_email, sender_name, text)',
      // Deposits of the creditors: a case held by nobody, its invoices and the coordinates it gives.
      'case_contacts INSERT (case_id, creditor_id, is_primary, kind, label, source, status, value, value_normalized)',
      'case_invoices INSERT (case_id, claimed_cents, creditor_id, due_on, issued_on, number, principal_cents)',
      'cases INSERT (creditor_id, debtor_address, debtor_id, debtor_siret, deposited_name, id, mandate_id, reference, scenario, status)',
      'portal_message_attachments INSERT (*)',
      'portal_message_attachments SELECT (*)',
      'portal_messages INSERT (*)',
      'portal_messages SELECT (*)',
      'portal_messages UPDATE (read_by_debtor_at, read_by_staff_at)',
      // Money: written by its functions, which check again who acts and what it adds up to.
      'case_invoices SELECT (case_id, due_on, id, issued_on, number, principal_cents, principal_paid_cents, state)',
      'case_invoices UPDATE (principal_paid_cents, state)',
      'installments INSERT (amount_cents, case_id, creditor_id, due_on, number, plan_id)',
      'interest_rates INSERT (entered_by, kind, on_behalf_of_id, rate_bp, valid_from)',
      'interest_rates SELECT (entered_by, kind, on_behalf_of_id, rate_bp, valid_from)',
      'interest_rates UPDATE (entered_by, on_behalf_of_id, rate_bp, updated_at)',
      'mandates SELECT (amicable_rate_bp, creditor_id, defer_small_remittances, ends_on, fixed_indemnity, id, litigation_rate_bp, opening_fee_cents, scenario, starts_on)',
      'payment_allocations INSERT (amount_cents, case_id, component, creditor_id, invoice_id, payment_id, reverses_id)',
      'payment_allocations SELECT (amount_cents, case_id, component, creditor_id, id, invoice_id, payment_id, reverses_id)',
      'payment_plans INSERT (case_id, creditor_id, first_due_on, id, method, months, on_behalf_of_id, owned_by_director, requested_by, status, threshold_months, total_cents)',
      'payment_plans SELECT (case_id, creditor_id, id, months, requested_by, status, version)',
      'payment_plans UPDATE (status, version)',
      'payments INSERT (amount_cents, bank, case_id, cheque_number, creditor_id, deposited_on, id, label, method, on_behalf_of_id, received_on, recorded_by, settled_at, status)',
      'payments SELECT (amount_cents, case_id, creditor_id, id, method, received_on, settled_at, settled_in_litigation, status, version)',
      'payments UPDATE (bounce_reason, bounced_at, settled_at, status, version)',
      'plan_approvals INSERT (case_id, creditor_id, plan_id, step)',
      'plan_approvals SELECT (decision, id, plan_id, step)',
      'plan_approvals UPDATE (decided_at, decided_by, decision, on_behalf_of_id, reason)',
      'receipts INSERT (case_id, creditor_id, id, number, payment_id)',
      'receipts SELECT (document_id, id, payment_id)',
    ],
    // What a case and its debtor hold, and the pieces of accounting ten years old: erased by the forget_* functions only.
    legarec_forgetter: [
      'ai_suggestions DELETE (*)',
      'ai_suggestions SELECT (case_id)',
      'billing_documents DELETE (*)',
      'billing_documents SELECT (corrected_id, id, issued_on, kind)',
      'billing_lines DELETE (*)',
      'billing_lines SELECT (document_id)',
      'case_contact_events DELETE (*)',
      'case_contact_events SELECT (case_id)',
      'case_contacts DELETE (*)',
      'case_contacts SELECT (case_id)',
      'case_events DELETE (*)',
      'case_events SELECT (case_id, id, kind, occurred_at, title)',
      'case_events UPDATE (detail, title)',
      'cases SELECT (anonymized_at, contact_name, debtor_id, deposited_name, id)',
      'cases UPDATE (anonymized_at, contact_name, contact_title, debtor_address, debtor_city, debtor_postal_code, debtor_siret, deposited_name, external_reference)',
      'claim_deposits SELECT (files, status)',
      'credit_note_drafts DELETE (*)',
      'credit_note_drafts SELECT (invoice_id, updated_at)',
      'credit_note_refunds DELETE (*)',
      'credit_note_refunds SELECT (credit_note_id, remittance_id)',
      'debtor_access_codes DELETE (*)',
      'debtor_access_codes SELECT (debtor_id)',
      'debtor_links DELETE (*)',
      'debtor_links SELECT (case_id, debtor_id)',
      'debtor_retired_codes DELETE (*)',
      'debtor_retired_codes SELECT (debtor_id)',
      'debtor_sessions DELETE (*)',
      'debtor_sessions SELECT (debtor_id)',
      'debtors SELECT (anonymized_at, id, name)',
      'debtors UPDATE (anonymized_at, legal_form_checked_at, legal_form_code, legal_form_source, name, siren)',
      'documents SELECT (case_id, created_at, id, purged_at, retention_class, source, uploaded_by_creditor, uploaded_by_debtor)',
      'documents UPDATE (original_name, purged_at, shared_by, shared_with_creditor_at, title, visible_to_debtor)',
      'gdpr_requests SELECT (debtor_id)',
      'gdpr_requests UPDATE (origin)',
      'litigation_files DELETE (*)',
      'litigation_files SELECT (case_id)',
      'payment_allocations DELETE (*)',
      'payment_allocations SELECT (payment_id)',
      'payment_plans SELECT (accepted_ip, case_id, document_id)',
      'payment_plans UPDATE (accepted_ip)',
      'payments DELETE (*)',
      'payments SELECT (bounce_reason, bounced_at, case_id, deposited_on, id, received_on, settled_at, status)',
      'payments UPDATE (bounce_reason)',
      'plan_approvals SELECT (case_id, reason)',
      'plan_approvals UPDATE (reason)',
      'planned_reminders DELETE (*)',
      'planned_reminders SELECT (case_id)',
      'sendings DELETE (*)',
      'sendings SELECT (case_id)',
      'portal_message_attachments DELETE (*)',
      'portal_message_attachments SELECT (case_id)',
      'portal_messages DELETE (*)',
      'portal_messages SELECT (case_id)',
      'receipts DELETE (*)',
      'receipts SELECT (document_id, issued_at, payment_id)',
      'remittance_batches DELETE (*)',
      'remittance_batches SELECT (id, paid_on, status, validated_at)',
      'remittance_lines DELETE (*)',
      'remittance_lines SELECT (case_id, payment_id, remittance_id)',
      'remittances DELETE (*)',
      'remittances SELECT (batch_id, id, invoice_id, state)',
    ],
  };
  it.each(Object.entries(expected))('%s', async (role, rights) => {
    expect((await rightsOf(role)).sort()).toEqual([...rights].sort());
  });

  it('close every table attached to a case once the case is anonymized, whenever the table was added', async () => {
    const open = await rows<{ table_name: string }>(
      `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
       WHERE c.table_schema = 'public' AND c.column_name = 'case_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'notifications'
         AND (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name
           AND p.policyname IN ('case_not_forgotten_add', 'case_not_forgotten_change') AND p.permissive = 'RESTRICTIVE') <> 2
       ORDER BY 1`,
    );
    expect(open).toEqual([]);
  });

  it('let nobody create anything, not even for the time of a session', async () => {
    const creators = await rows(`
      SELECT r.rolname FROM pg_roles r
      WHERE r.rolname LIKE 'legarec\\_%' AND r.rolname NOT IN ('legarec_admin', 'legarec_owner')
        AND (has_database_privilege(r.oid, current_database(), 'TEMP') OR has_database_privilege(r.oid, current_database(), 'CREATE')
          OR has_schema_privilege(r.oid, 'public', 'CREATE') OR has_schema_privilege(r.oid, 'app', 'CREATE'))`);
    expect(creators).toEqual([]);
  });

  it('can be taken by one connection each, without inheriting anything', async () => {
    const members = await rows<{ entry: string }>(`
      SELECT m.rolname || ' > ' || r.rolname || CASE WHEN am.inherit_option OR am.admin_option OR NOT am.set_option THEN ' !' ELSE '' END AS entry
      FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member WHERE m.rolname LIKE 'legarec\\_%' ORDER BY 1`);
    expect(members.map((row) => row.entry)).toEqual([
      'legarec_app > legarec_auth',
      'legarec_app > legarec_debtor',
      'legarec_app > legarec_hook',
      'legarec_app > legarec_partner',
      'legarec_app > legarec_public',
      'legarec_app > legarec_service',
      'legarec_app > legarec_staff',
      // A task runs with the rights of its author.
      'legarec_jobs > legarec_debtor',
      'legarec_jobs > legarec_partner',
      'legarec_jobs > legarec_retention',
      'legarec_jobs > legarec_service',
      'legarec_jobs > legarec_staff',
      'legarec_jobs > legarec_worker',
      'legarec_owner > legarec_definer',
      'legarec_owner > legarec_forgetter',
    ]);
  });
});

describe('rights on the functions', () => {
  const callers = async (name: string) =>
    (
      await rows<{ role: string }>(
        `SELECT replace(r.rolname, 'legarec_', '') AS role FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
         WHERE n.nspname = 'app' AND p.proname = $1 AND a.privilege_type = 'EXECUTE' AND r.rolname NOT IN ('legarec_owner', 'legarec_definer') ORDER BY 1`,
        [name],
      )
    ).map((row) => row.role);
  // Those that act, or that tell something about someone else.
  it.each([
    ['add_case_event', ['debtor', 'partner', 'staff', 'worker']],
    ['note_consultation', ['staff']],
    ['assign_cases', ['staff']],
    ['next_number', ['staff', 'worker']],
    ['purge_audit', ['retention']],
    ['purge_sign_ins', ['retention']],
    ['anonymize_accounts', ['retention']],
    ['anonymize_case', ['retention']],
    ...['purge_remittances', 'purge_invoices', 'purge_payments', 'purge_accounting_documents', 'purge_waiting_files', 'purge_old_history'].map(
      (name) => [name, ['retention']] as [string, string[]],
    ),
    // Owned by the forgetter, called by the functions of the definer only, or by its own.
    ...[
      'forget_case',
      'forget_debtor',
      'forget_remittances',
      'forget_lone_invoices',
      'forget_bounced_payments',
      'forget_accounting_documents',
      'forget_waiting_files',
      'forget_case_story',
      'forget_old_history',
    ].map((name) => [name, ['forgetter']] as [string, string[]]),
    ...['forget_payments', 'forget_invoices', 'invoice_batches', 'accounting_cutoff'].map((name) => [name, ['forgetter']] as [string, string[]]),
    ...['erasure_blockers', 'erasure_digest'].map((name) => [name, []] as [string, string[]]),
    ['case_writable', ['debtor', 'partner', 'staff', 'worker']],
    // The sign-in.
    ...['account_of', 'account_of_link', 'inviter_name', 'resume_session', 'take_attempt', 'clear_attempts', 'subject', 'proved_subject', 'tell_reset'].map(
      (name) => [name, ['auth']] as [string, string[]],
    ),
    // The accounts of the others: each function checks who is acting.
    ...[
      ...['invite_member', 'cancel_invitation', 'disable_member', 'enable_member', 'set_member_role', 'set_extension', 'support'],
      ...['account_states', 'locked', 'set_delegation', 'open_ticket', 'acts_as_director'],
    ].map((name) => [name, ['staff']] as [string, string[]]),
    ...['save_secret', 'renew_secret', 'revoke_secret', 'keep_secret', 'save_setting', 'creditor_iban', 'open_debtor', 'note_contact'].map(
      (name) => [name, ['staff']] as [string, string[]],
    ),
    ...['renew_internal_key', 'access_code', 'first_access_code', 'renew_access_code'].map((name) => [name, ['staff']] as [string, string[]]),
    // What they read is encrypted with a key that is not in the database.
    ...['internal_key', 'first_internal_key'].map((name) => [name, ['staff', 'worker']] as [string, string[]]),
    // The two keys of the bucket of the documents, for whoever handles a file.
    ['storage_keys', ['debtor', 'partner', 'staff', 'worker']],
    ['portal_officer', ['partner']],
    ['create_director', ['worker']],
    ['ticket_reader', ['worker']],
    // Read by the forgetter to find a name in the titles of the history (question 169).
    ['plain_name', ['forgetter']],
    // Called by the functions above only.
    ...['close_account', 'release_cases', 'digests', 'refuse', 'tell_director', 'end_technical_delegation', 'take_with_substituted'].map(
      (name) => [name, []] as [string, string[]],
    ),
    // Triggers.
    ['open_delegations', []],
    ['keep_account_history', []],
    ['require_for_developer', []],
    ['can_read_case', ['staff']],
    ['can_act_on_case', ['staff']],
    ['accept_deposit', ['staff']],
    ['refuse_deposit', ['staff']],
    ['case_exists', ['staff']],
    ['correct_debtor', ['staff']],
    ['is_claims_officer', ['staff']],
    ['director_id', ['staff']],
    ...['save_interest_rate', 'decide_plan', 'record_payment', 'change_payment', 'ask_plan'].map((name) => [name, ['staff']] as [string, string[]]),
    // Called by the functions of the money, and its triggers.
    ['share_document', ['staff']],
    ...['import_template', 'cancel_template', 'submit_template', 'review_template'].map((name) => [name, ['staff']] as [string, string[]]),
    ['template_editor', []],
    ...['debtor_sign_in', 'resume_debtor_session', 'close_debtor_session', 'debtor_access_alert'].map((name) => [name, ['auth']] as [string, string[]]),
    ...['forget_debtor_access', 'set_code_hmac'].map((name) => [name, ['staff']] as [string, string[]]),
    ...['own_access_code', 'debtor_upload', 'debtor_message'].map((name) => [name, ['debtor']] as [string, string[]]),
    ['read_portal_messages', ['debtor', 'staff']],
    ['staff_message', ['staff']],
    ...['debtor_link', 'ask_code_by_sms', 'firm_payment_settings', 'limited_message'].map((name) => [name, ['auth']] as [string, string[]]),
    ...['gdpr_request', 'gdpr_keeper', 'gdpr_registry', 'gdpr_answer', 'gdpr_export', 'gdpr_erasure', 'gdpr_erase'].map(
      (name) => [name, ['staff']] as [string, string[]],
    ),
    ...['remittance_draft', 'validate_remittances', 'mark_remittances_paid', 'remittance_batches', 'remittance_batch'].map(
      (name) => [name, ['staff']] as [string, string[]],
    ),
    ['creditor_payouts', ['partner']],
    ...['billing_overview', 'credit_notes', 'save_credit_note_draft', 'delete_credit_note_draft', 'issue_credit_note'].map(
      (name) => [name, ['staff']] as [string, string[]],
    ),
    ...['invoice_lines_left', 'invoice_left', 'invoice_settled_on', 'check_credit_lines'].map((name) => [name, []] as [string, string[]]),
    ['planned_contacts', ['staff']],
    ['sent_contacts', ['staff']],
    ['service_ready', ['staff']],
    ['service_key', ['worker']],
    ['tell_sending_failed', ['worker']],
    ['note_ai_decision', []],
    ...['ai_key', 'ai_spent', 'ai_budget_alert'].map((name) => [name, ['worker']] as [string, string[]]),
    ...['ai_journal', 'ai_journal_totals'].map((name) => [name, ['staff']] as [string, string[]]),
    ['keep_done_reminder', []],
    ['litigation_rules', []],
    ...['remittance_core', 'remittance_sources', 'remittance_summary', 'note_settlement'].map((name) => [name, []] as [string, string[]]),
    ...['creditor_decide_plan', 'creditor_upload', 'creditor_deposit'].map((name) => [name, ['partner']] as [string, string[]]),
    ...['money_case', 'issue_receipt', 'follow_allocation', 'check_allocations', 'keep_receipt', 'keep_sending'].map(
      (name) => [name, []] as [string, string[]],
    ),
    // Tools of the migrations.
    ['secure', []],
    ['secure_case_table', []],
    ['append_only', []],
    ['refuse_change', []],
    // Everyone but the pages without any account.
    ...['log', 'enqueue', 'staff_role', 'has_delegation', 'partner_creditor', 'on_behalf_of', 'actor_kind', 'actor_label', 'actor_id', 'actor_key'].map(
      (name) => [name, ['auth', 'debtor', 'hook', 'partner', 'retention', 'service', 'staff', 'worker']] as [string, string[]],
    ),
  ] as [string, string[]][])('%s: %j', async (name, expected) => {
    expect(await callers(name)).toEqual(expected);
  });

  it('are all listed above, but those that read the context of the caller only', async () => {
    const listed = [
      'add_case_event note_consultation assign_cases next_number purge_audit can_read_case can_act_on_case is_claims_officer director_id secure secure_case_table append_only refuse_change',
      'log enqueue staff_role has_delegation partner_creditor on_behalf_of actor_kind actor_label actor_id actor_key',
      'purge_sign_ins anonymize_accounts account_of account_of_link inviter_name resume_session take_attempt clear_attempts subject proved_subject tell_reset',
      'invite_member cancel_invitation disable_member enable_member set_member_role set_extension support account_states locked set_delegation open_ticket acts_as_director',
      'save_secret renew_secret revoke_secret keep_secret save_setting creditor_iban open_debtor note_contact',
      'internal_key first_internal_key renew_internal_key access_code first_access_code renew_access_code storage_keys',
      'portal_officer create_director ticket_reader close_account release_cases digests refuse tell_director end_technical_delegation take_with_substituted open_delegations require_for_developer plain_name keep_account_history',
      'uuid_v7 setting user_id creditor_id debtor_id only_identifiers audit_params',
      'save_interest_rate decide_plan follow_allocation check_allocations record_payment change_payment ask_plan money_case issue_receipt keep_receipt share_document',
      'import_template cancel_template submit_template review_template template_editor',
      'debtor_sign_in resume_debtor_session close_debtor_session debtor_access_alert forget_debtor_access set_code_hmac',
      'own_access_code debtor_upload debtor_message read_portal_messages staff_message creditor_decide_plan creditor_upload creditor_deposit',
      'debtor_link ask_code_by_sms firm_payment_settings limited_message',
      'gdpr_request gdpr_keeper gdpr_registry gdpr_answer gdpr_export gdpr_erasure gdpr_erase',
      'anonymize_case forget_case forget_debtor erasure_blockers erasure_digest case_writable',
      'note_ai_decision ai_key ai_spent ai_budget_alert ai_journal ai_journal_totals planned_contacts sent_contacts service_ready service_key tell_sending_failed keep_sending keep_done_reminder litigation_rules case_exists correct_debtor accept_deposit refuse_deposit remittance_core creditor_payouts remittance_sources remittance_summary note_settlement remittance_draft validate_remittances mark_remittances_paid remittance_batches remittance_batch',
      'billing_overview credit_notes save_credit_note_draft delete_credit_note_draft issue_credit_note invoice_lines_left invoice_left invoice_settled_on check_credit_lines',
      'purge_remittances purge_invoices purge_payments purge_accounting_documents forget_remittances forget_lone_invoices forget_bounced_payments forget_accounting_documents',
      'purge_waiting_files forget_waiting_files purge_old_history forget_case_story forget_old_history',
      'forget_payments forget_invoices invoice_batches accounting_cutoff',
    ].flatMap((names) => names.split(' '));
    const found = await rows<{ proname: string }>(
      "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' ORDER BY 1",
    );
    expect(found.map((row) => row.proname)).toEqual(listed.sort());
  });

  it('let the definer change a debtor in two functions only (question 138): its policy for the correction trusts them', async () => {
    const found = await rows<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND pg_get_userbyid(p.proowner) = 'legarec_definer' AND p.prosrc ~* 'update\\s+public\\.debtors' ORDER BY 1`,
    );
    expect(found.map((row) => row.proname)).toEqual(['correct_debtor', 'open_debtor']);
  });
});

describe('database', () => {
  it('lets nobody connect but the two programs, as the migrations leave it', async () => {
    const [row] = await rows<{ datacl: string }>('SELECT datacl::text FROM pg_database WHERE datname = $1', [inject('template')]);
    // `=Tc/` would be the right of everyone to connect and to create temporary objects.
    expect(row!.datacl).not.toMatch(/[{,]=/u);
    expect(row!.datacl.match(/legarec_(?:app|jobs)=\w+/gu)?.sort()).toEqual(['legarec_app=c', 'legarec_jobs=c']);
  });

  it('stops what runs, waits or stays open for too long', async () => {
    const settings = await rows<{ rolname: string; setting: string[] }>(
      "SELECT rolname, rolconfig AS setting FROM pg_roles WHERE rolname IN ('legarec_app', 'legarec_jobs') ORDER BY 1",
    );
    for (const { setting } of settings)
      for (const name of ['statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout'])
        expect(setting.some((value) => value.startsWith(`${name}=`))).toBe(true);
    expect(settings).toHaveLength(2);
  });
});

describe('schema', () => {
  const announced = readPrismaSchema(fileURLToPath(new URL('../prisma/schema', import.meta.url)));

  it('has the same tables and columns in Prisma and in the migrations', async () => {
    const columns = await rows<{ relname: string; attname: string; type: string; nullable: boolean }>(`
      SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${TABLES} AND a.attnum > 0 AND NOT a.attisdropped`);
    const found: Record<string, Record<string, unknown>> = {};
    for (const { relname, attname, type, nullable } of columns) (found[relname] ??= {})[attname] = { type, nullable };
    expect(announced.tables).toEqual(found);
  });

  it('has the same keys', async () => {
    const keys = await rows<{ relname: string; columns: string[] }>(`
      SELECT c.relname, array_agg(a.attname::text ORDER BY k.position) AS columns
      FROM pg_constraint p JOIN pg_class c ON c.oid = p.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY AS k(number, position) JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.number
      WHERE ${TABLES} AND p.contype = 'p' GROUP BY c.relname`);
    expect(announced.keys).toEqual(Object.fromEntries(keys.map((row) => [row.relname, row.columns])));
  });

  it('has the same lists of values', async () => {
    const enums = await rows<{ typname: string; labels: string[] }>(
      'SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname',
    );
    expect(announced.enums).toEqual(Object.fromEntries(enums.map((row) => [row.typname, row.labels])));
  });
});

describe('migrations', () => {
  const directory = fileURLToPath(new URL('../prisma/migrations', import.meta.url));

  it('refuse a database whose rights they cannot close, rather than leave it open', async () => {
    const name = `${inject('testPrefix')}foreign`;
    // As the official image creates it, for its superuser, with just enough rights for the migrations to run.
    await test.admin.query(`CREATE DATABASE ${name}`);
    await test.admin.query(`GRANT CREATE ON DATABASE ${name} TO legarec_owner`);
    const own = new pg.Client({ connectionString: Object.assign(new URL(test.adminUrl), { pathname: `/${name}` }).href });
    await own.connect();
    await own.query('GRANT ALL ON SCHEMA public TO legarec_owner');
    const url = Object.assign(new URL(test.url('owner')), { pathname: `/${name}` });
    await expect(migrate(url.href, directory)).rejects.toThrow(`database ${name} must belong to legarec_owner`);
    // The bootstrap, run in that database, gives it to its owner.
    await own.query(readFileSync(fileURLToPath(new URL('../prisma/bootstrap.sql', import.meta.url)), 'utf8'));
    await own.end();
    expect(await migrate(url.href, directory)).toEqual(readdirSync(directory).filter((entry) => entry !== 'migration_lock.toml'));
    const [row] = await rows<{ datacl: string }>('SELECT datacl::text FROM pg_database WHERE datname = $1', [name]);
    expect(row!.datacl).not.toMatch(/[{,]=/u);
  });

  it('run once, and refuse one that changed after it was applied or that is missing', async () => {
    expect(await migrate(test.url('owner'), directory)).toEqual([]);
    await test.admin.query("UPDATE _prisma_migrations SET checksum = 'x'");
    await expect(migrate(test.url('owner'), directory)).rejects.toThrow('changed after it was applied');
    await test.admin.query("UPDATE _prisma_migrations SET migration_name = '20200101000000_gone'");
    await expect(migrate(test.url('owner'), directory)).rejects.toThrow('absent from the code');
  });
});
