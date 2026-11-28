import { randomBytes, randomUUID } from 'node:crypto';
import { AuthKeys } from '../src/modules/auth/keys';
import { storageFor } from '../src/platform/storage/storage';
import type { TestApp } from './app';

/** Callers of the test set. `managerAlone` has lost the delegation; `liar` announces rights the table does not give. */
export type Caller =
  'nobody' | 'director' | 'manager' | 'managerAlone' | 'developer' | 'officerA' | 'officerB' | 'liar' | 'partnerA' | 'partnerB' | 'debtorA' | 'debtorB';

export interface MatrixEntry {
  /** Real path, for a route with parameters. Computed for each caller: what one of them does changes nothing for the next. */
  path?: (test: TestApp) => string | Promise<string>;
  body?: () => unknown;
  /** A body that is a file (PDF). */
  file?: () => Uint8Array;
  expect: Record<Caller, number>;
}

const everyone = (status: number): Record<Caller, number> => ({
  nobody: status,
  director: status,
  manager: status,
  managerAlone: status,
  developer: status,
  officerA: status,
  officerB: status,
  liar: status,
  partnerA: status,
  partnerB: status,
  debtorA: status,
  debtorB: status,
});
type Some = Partial<Record<Caller, number>>;
/** Nobody signs in with the cookie of another portal. */
const elsewhere: Record<Caller, number> = { ...everyone(403), nobody: 401 };
/** The liar is a claims officer: what the guard lets through, PostgreSQL refuses. */
const staffOf = (status: number, some: Some = {}): Record<Caller, number> => ({
  ...elsewhere,
  ...{ director: status, manager: status, managerAlone: status, developer: status, officerA: status, officerB: status, liar: status },
  ...some,
});
const only = (some: Some): Record<Caller, number> => ({ ...elsewhere, ...some });
const administers = only({ director: 204, manager: 204 });
const supports = only({ director: 204, manager: 204, developer: 204 });

const token = randomBytes(32).toString('base64url');
const email = () => `${randomUUID()}@exemple.test`;
const member =
  (status: 'ACTIVE' | 'INVITED' | 'DISABLED', then = '', prepare?: (test: TestApp, id: string) => Promise<unknown>) =>
  async (test: TestApp) => {
    const { rows } = await test.database.admin.query<{ id: string }>(
      `INSERT INTO users (role, status, first_name, last_name, email, disabled_at)
     VALUES ('CLAIMS_OFFICER', $1::user_status, 'Nora', 'Test', $2, CASE WHEN $1::user_status = 'DISABLED' THEN now() END) RETURNING id`,
      [status, email()],
    );
    const { id } = rows[0]!;
    await prepare?.(test, id);
    return `/staff/members/${id}${then}`;
  };

const secret =
  (then: string, status = 'VALID') =>
  async (test: TestApp) => {
    await test.database.admin.query("DELETE FROM vault_secrets WHERE name = 'AI_API_KEY'");
    const { rows } = await test.database.admin.query<{ id: string }>(
      "INSERT INTO vault_secrets (name, value_cipher, status) VALUES ('AI_API_KEY', '\\x00', $1::secret_status) RETURNING id",
      [status],
    );
    return `/staff/secrets/${rows[0]!.id}/${then}`;
  };
const withCases = (status: number, some: Some = {}) =>
  only({ director: status, manager: status, managerAlone: status, officerA: status, officerB: status, liar: status, ...some });
/** The Director and the manager; the liar is let in by the guard, then shown nothing. */
const opens = (status: number) => only({ director: status, manager: status, managerAlone: status, liar: status });
let lastCreditor = '';
const newCreditor = async (test: TestApp, path: string) => {
  const { rows } = await test.database.admin.query<{ id: string }>("INSERT INTO creditors (name) VALUES ('Nouveau') RETURNING id");
  lastCreditor = rows[0]!.id;
  return path;
};
let caseNumber = 50_000;
/** Held by nobody. */
const newCase = async (test: TestApp) => {
  const debtor = await test.database.admin.query<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'X') RETURNING id");
  caseNumber += 1;
  const { rows } = await test.database.admin.query<{ id: string }>('INSERT INTO cases (reference, creditor_id, debtor_id) VALUES ($1, $2, $3) RETURNING id', [
    `LGR-2026-${caseNumber}`,
    test.s.creditorA,
    debtor.rows[0]!.id,
  ]);
  return { id: rows[0]!.id, creditorId: test.s.creditorA };
};

/** Held by nobody, with one invoice of 100 € left to pay: an individual, so no interest nor indemnity. */
const owingCase = async (test: TestApp) => {
  const made = await newCase(test);
  await test.database.admin.query(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', '2026-01-01', '2026-02-01', 10000, 10000)",
    [made.id, made.creditorId],
  );
  return made;
};
let gdprCase = '';
let reminderCase = '';
const plannedReminder = async (test: TestApp) => {
  const made = await newCase(test);
  const { rows } = await test.database.admin.query<{ id: string }>(
    "INSERT INTO planned_reminders (case_id, creditor_id, kind, due_on, title, created_by) VALUES ($1, $2, 'CALL', '2099-01-05', 'Appel', $3) RETURNING id",
    [made.id, made.creditorId, test.s.manager],
  );
  return `/staff/reminders/${rows[0]!.id}`;
};
let litigationCase = '';
let remindedCase = '';
/** A case held by nobody, already in litigation: its file, awaiting the agreement of the creditor or not. */
const litigationFile = (consent: 'NOT_NEEDED' | 'WAITING', suffix: string) => async (test: TestApp) => {
  const made = await newCase(test);
  await test.database.admin.query("UPDATE cases SET status = 'LITIGATION' WHERE id = $1", [made.id]);
  const { rows } = await test.database.admin.query<{ id: string }>(
    'INSERT INTO litigation_files (case_id, creditor_id, consent, created_by) VALUES ($1, $2, $3::litigation_consent, $4) RETURNING id',
    [made.id, made.creditorId, consent, test.s.manager],
  );
  return `/staff/litigation/${rows[0]!.id}${suffix}`;
};
const gdprRequest =
  (then: string, kind = 'ACCESS') =>
  async (test: TestApp) => {
    const made = await newCase(test);
    const { rows } = await test.database.admin.query<{ id: string }>(
      `INSERT INTO gdpr_requests (case_id, creditor_id, debtor_id, kind, origin, due_on, created_by)
     SELECT c.id, c.creditor_id, c.debtor_id, $3, 'Courrier', current_date + 30, $2 FROM cases c WHERE c.id = $1 RETURNING id`,
      [made.id, test.s.manager, kind],
    );
    return `/staff/gdpr/requests/${rows[0]!.id}${then}`;
  };
const cheque = () => ({
  method: 'CHEQUE',
  amount: 1000,
  chequeNumber: String(1_000_000 + Math.floor(Math.random() * 8_999_999)),
  bank: 'Banque',
  receivedOn: '2026-11-02',
  depositedOn: null,
});
/** A cheque received on a case held by nobody, allocated as an overpayment. */
const paymentPath = async (test: TestApp) => {
  const { id, creditorId } = await newCase(test);
  const { rows } = await test.database.admin.query<{ id: string }>(
    `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, cheque_number, bank, recorded_by)
       VALUES ($1, $2, 'CHEQUE', 1000, 'RECEIVED', '2026-11-02', '1234567', 'Banque', $3) RETURNING id)
     INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT $1, $2, p.id, 'OVERPAYMENT', 1000 FROM p RETURNING payment_id AS id`,
    [id, creditorId, test.s.manager],
  );
  return `/staff/cases/${id}/payments/${rows[0]!.id}`;
};
/** A long plan asked on a case held by nobody, waiting for the manager. */
const pendingPlan = async (test: TestApp) => {
  const { id, creditorId } = await owingCase(test);
  const { rows } = await test.database.admin.query<{ id: string }>(
    `WITH p AS (INSERT INTO payment_plans (case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by)
       VALUES ($1, $2, 10000, 8, 'TRANSFER', '2026-12-15', 'PENDING_MANAGER', 6, false, $3) RETURNING id)
     INSERT INTO plan_approvals (case_id, creditor_id, plan_id, step) SELECT $1, $2, p.id, 'COLLECTION_MANAGER' FROM p RETURNING plan_id AS id`,
    [id, creditorId, test.s.officerA],
  );
  return `/staff/payment-plans/requests/${rows[0]!.id}`;
};

/** A PDF of nothing, which ClamAV finds clean. */
const PDF = () => new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
/** A document of a case held by nobody, scanned and clean. */
const documentPath = async (test: TestApp, then: string) => {
  const { id, creditorId } = await newCase(test);
  const { rows } = await test.database.admin.query<{ id: string }>(
    `INSERT INTO documents (case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, author_id, scan_status, scanned_at)
     VALUES ($1, $2, 'EVIDENCE', 'PDF', 'Pièce', 'piece.pdf', gen_random_uuid()::text, 10, repeat('0', 64), 'UPLOAD', $3, 'CLEAN', now()) RETURNING id`,
    [id, creditorId, test.s.manager],
  );
  return `/staff/documents/${rows[0]!.id}${then}`;
};

/** A version of a template in the state asked for, alone of its kind. */
const templateIn = (code: string, state: 'CANCELLED' | 'IMPORTED' | 'WAITING', then: string) => async (test: TestApp) => {
  await test.database.admin.query(
    "UPDATE template_versions SET state = 'REJECTED' WHERE template_code = $1 AND state IN ('IMPORTED', 'RESTORED', 'WAITING', 'CANCELLED')",
    [code],
  );
  await test.database.admin.query(
    `INSERT INTO template_versions (template_code, source, file_name, accepted, checks, has_warnings, state, imported_by) VALUES ($1, '<p>x</p>', 'x.html', true, '[]', false, $2, $3)`,
    [code, state, test.s.manager],
  );
  return `/staff/templates/${code}${then}`;
};
const TEMPLATE_SOURCE =
  '<!doctype html>\n<html lang="fr">\n<body>\n  {{> en_tete}}\n  <p>Bonjour {{debiteur.raison_sociale}}</p>\n  {{> mentions_recouvrement}}\n</body>\n</html>\n';
let sirens = 900_000_000;
/** A valid SIREN (Luhn) that names nobody, another one each time. */
const unknownSiren = (): string => {
  for (;;) {
    sirens += 1;
    const digits = String(sirens);
    const sum = [...digits].reverse().reduce((total, char, index) => {
      const value = Number(char) * (index % 2 === 1 ? 2 : 1);
      return total + (value > 9 ? value - 9 : value);
    }, 0);
    if (sum % 10 === 0) return digits;
  }
};

/** A PDF really written, shown to the debtor of the case of debtor A. */
const debtorDocument = async (test: TestApp, category: 'PAYMENT_PLAN' | 'RECEIPT') => {
  const stored = await storageFor(test.config).put(Buffer.from(PDF()));
  const { rows } = await test.database.admin.query<{ id: string }>(
    `INSERT INTO documents (case_id, creditor_id, category, kind, title, original_name, storage_key, size_bytes, sha256, source, visible_to_debtor, scan_status, scanned_at)
     SELECT c.id, c.creditor_id, $2, 'PDF', 'Document', 'document.pdf', $3, $4, $5, 'GENERATED', true, 'CLEAN', now() FROM cases c WHERE c.id = $1 RETURNING id`,
    [test.s.cases.ofA, category, stored.key, stored.size, stored.sha256],
  );
  return rows[0]!.id;
};
const PLAN_FINGERPRINT = 'a'.repeat(64);
/** A plan proposed to debtor A, its PDF written: the plans left open on the case before are cancelled. */
const debtorPlan = async (test: TestApp, then: string) => {
  const caseId = test.s.cases.ofA;
  await test.database.admin.query(
    "UPDATE payment_plans SET status = 'CANCELLED' WHERE case_id = $1 AND status IN ('PENDING_MANAGER', 'WAITING_CREDITOR', 'WAITING_DEBTOR', 'ACTIVE')",
    [caseId],
  );
  const document = await debtorDocument(test, 'PAYMENT_PLAN');
  await test.database.admin.query(
    `WITH p AS (INSERT INTO payment_plans (case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by, document_id, document_sha256)
       SELECT c.id, c.creditor_id, 10000, 2, 'TRANSFER', current_date + 30, 'WAITING_DEBTOR', 6, false, $2, $3, $4 FROM cases c WHERE c.id = $1 RETURNING id, case_id, creditor_id)
     INSERT INTO plan_approvals (case_id, creditor_id, plan_id, step) SELECT p.case_id, p.creditor_id, p.id, 'DEBTOR' FROM p`,
    [caseId, test.s.officerA, document, PLAN_FINGERPRINT],
  );
  return `/debtor/cases/${caseId}${then}`;
};
let receipts = 90_000;
/** A receipt of a cheque cashed on the case of debtor A, its PDF written. */
const debtorReceipt = async (test: TestApp) => {
  const caseId = test.s.cases.ofA;
  const document = await debtorDocument(test, 'RECEIPT');
  receipts += 1;
  const { rows } = await test.database.admin.query<{ id: string }>(
    `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, settled_at, cheque_number, bank, recorded_by)
       SELECT c.id, c.creditor_id, 'CHEQUE', 100, 'CASHED', current_date, now(), $5, 'Banque', $2 FROM cases c WHERE c.id = $1 RETURNING id, case_id, creditor_id),
     a AS (INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT p.case_id, p.creditor_id, p.id, 'OVERPAYMENT', 100 FROM p)
     INSERT INTO receipts (case_id, creditor_id, payment_id, number, document_id) SELECT p.case_id, p.creditor_id, p.id, $3, $4 FROM p RETURNING id`,
    [caseId, test.s.manager, `Q-2026-${receipts}`, document, String(receipts).padStart(7, '0')],
  );
  return `/debtor/cases/${caseId}/receipts/${rows[0]!.id}/file`;
};

/** A long plan of a case of creditor A, approved by the manager, waiting for the creditor. */
const creditorPlan = async (test: TestApp) => {
  const { id, creditorId } = await owingCase(test);
  const { rows } = await test.database.admin.query<{ id: string }>(
    `WITH p AS (INSERT INTO payment_plans (case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by)
       VALUES ($1, $2, 10000, 8, 'TRANSFER', '2026-12-15', 'WAITING_CREDITOR', 6, false, $3) RETURNING id)
     INSERT INTO plan_approvals (case_id, creditor_id, plan_id, step) SELECT $1, $2, p.id, 'CREDITOR' FROM p RETURNING plan_id AS id`,
    [id, creditorId, test.s.officerA],
  );
  return `/partner/portal/plans/${rows[0]!.id}/decision`;
};
const INVOICE_OF_CLAIM = { number: 'F-1', issuedOn: '2026-09-01', dueOn: '2026-10-01', amount: 10000 };
let assigned: unknown;
let planned: unknown;
let rateTurn = 0;
const INVOICE = { number: 'F-1', externalRef: '', issuedOn: '2026-01-01', dueOn: '2026-02-01', amount: 100, left: 100 };
const CASE = {
  mandateId: 'x',
  externalReference: '',
  kind: 'INDIVIDUAL',
  number: '',
  name: 'X',
  nameConfirmed: true,
  legalForm: '',
  address: 'x',
  postalCode: '69000',
  city: 'Lyon',
  contactName: '',
  contactTitle: '',
  contacts: [],
  invoices: [INVOICE],
  scenario: 'CONSUMER',
  toMe: true,
  expected: { principal: 100, invoices: 1 },
};
let settingTurn = 0;
const technical = only({ director: 204, developer: 204 });
const hidden = { ...technical, liar: 404 };

const creditor =
  (then = '', prepare?: (test: TestApp, id: string) => Promise<string>) =>
  async (test: TestApp) => {
    const { rows } = await test.database.admin.query<{ id: string }>("INSERT INTO creditors (name) VALUES ('Nouveau') RETURNING id");
    const { id } = rows[0]!;
    return `/staff/creditors/${id}${then}${prepare ? await prepare(test, id) : ''}`;
  };
const bankAccount = (then: string) => async (test: TestApp, id: string) => {
  const { rows } = await test.database.admin.query<{ id: string }>(
    "INSERT INTO creditor_bank_accounts (creditor_id, holder, iban_cipher, iban_masked, bic, created_by) VALUES ($1, 'x', '\\x00', 'GB82 •••• •••• 5432', 'PSSTFRPPXXX', $2) RETURNING id",
    // Typed by someone else: whoever types it never confirms it (question 142).
    [id, test.s.officerA],
  );
  return `/bank-accounts/${rows[0]!.id}/${then}`;
};
const creditorBody = () => ({
  identity: { legalName: 'X', name: 'X', sector: '', vatNumber: '', address: 'x', postalCode: '69000', city: 'Lyon', managerId: null, portalEnabled: true },
  contacts: [{ name: 'X', title: '', email: email(), phone: '', isMain: true }],
});
const MANDATE = {
  startsOn: '2026-01-01',
  endsOn: null,
  amicableRateBp: 800,
  litigationRateBp: 1200,
  openingFeeCents: 0,
  planMonthsWithoutConsent: 6,
  discountMaxBp: 500,
  litigationNeedsConsent: true,
  deferSmallRemittances: false,
  interestMode: 'NONE',
  contractRateBp: null,
  fixedIndemnity: true,
  reportingDay: 5,
  scenario: 'BUSINESS',
};
const ACCOUNT = { holder: 'X', iban: 'GB82 WEST 1234 5698 7654 32', bic: 'PSSTFRPPXXX' };

/** The same sign-in on both portals, open to whoever is there: the answer does not depend on it. */
const signIn = (portal: 'staff' | 'partner'): Record<string, MatrixEntry> => {
  const code = () => ({ code: 'xxxxxx' });
  const password = () => ({ password: 'un-mot-de-passe-choisi' });
  return {
    [`POST /${portal}/auth/login`]: {
      body: () => ({ email: email(), password: 'un-mot-de-passe', portal: portal === 'staff' ? 'espace' : 'partenaires' }),
      expect: everyone(401),
    },
    [`POST /${portal}/auth/two-factor`]: { body: () => ({ method: 'TOTP', code: '000000' }), expect: everyone(401) },
    [`POST /${portal}/auth/two-factor/webauthn`]: { expect: everyone(401) },
    [`POST /${portal}/auth/setup/totp`]: { expect: everyone(401) },
    [`POST /${portal}/auth/setup/totp/verify`]: { body: code, expect: everyone(401) },
    [`POST /${portal}/auth/logout`]: { expect: everyone(204) },
    [`POST /${portal}/auth/forgot-password`]: { body: () => ({ email: email() }), expect: everyone(204) },
    [`GET /${portal}/auth/reset/:token`]: { path: () => `/${portal}/auth/reset/${token}`, expect: everyone(410) },
    [`POST /${portal}/auth/reset/:token`]: { path: () => `/${portal}/auth/reset/${token}`, body: password, expect: everyone(410) },
    [`GET /${portal}/auth/invitation/:token`]: { path: () => `/${portal}/auth/invitation/${token}`, expect: everyone(410) },
    [`POST /${portal}/auth/invitation/:token/password`]: { path: () => `/${portal}/auth/invitation/${token}/password`, body: password, expect: everyone(410) },
    [`POST /${portal}/auth/invitation/:token/totp`]: { path: () => `/${portal}/auth/invitation/${token}/totp`, body: code, expect: everyone(410) },
  };
};

/** Every route of the API, with the answer expected for every caller. A route missing here fails `pnpm verifier`. */
export const MATRIX: Record<string, MatrixEntry> = {
  'GET /health': { expect: everyone(200) },

  // Nobody signs in: without the signature of Resend, the same refusal for all (`resend-events.test.ts`).
  'POST /hooks/resend': { body: () => ({ type: 'email.delivered' }), expect: everyone(401) },
  ...signIn('staff'),
  ...signIn('partner'),
  'GET /staff/auth/session': { expect: staffOf(200) },
  'GET /partner/auth/session': { expect: only({ partnerA: 200, partnerB: 200 }) },
  'PUT /staff/auth/preferences': { body: () => ({ theme: 'dark', density: 'compact', lowVision: false }), expect: staffOf(204) },

  'GET /staff/account': { expect: staffOf(200) },
  'PUT /staff/account/profile': { body: () => ({ firstName: 'Nora', lastName: 'Test' }), expect: staffOf(204) },
  'PUT /staff/account/absence': { body: () => ({ substituteId: '', from: '', to: '', autoReply: false }), expect: staffOf(204) },
  'PUT /staff/account/notifications': { body: () => ({ dailySummary: false }), expect: staffOf(204) },
  'PUT /staff/account/password': { body: () => ({ current: 'inconnu', next: 'un-mot-de-passe-2026!' }), expect: staffOf(422) },
  'POST /staff/account/two-factor/totp': { expect: staffOf(200) },
  'POST /staff/account/two-factor/totp/verify': { body: () => ({ code: 'xxxxxx' }), expect: staffOf(422) },
  'POST /staff/account/two-factor/webauthn': { expect: staffOf(200) },
  'POST /staff/account/two-factor/webauthn/verify': { body: () => ({}), expect: staffOf(422) },
  // Always required of the Developer.
  'DELETE /staff/account/two-factor': { expect: staffOf(204, { developer: 403 }) },
  'DELETE /staff/account/sessions/:id': { path: () => `/staff/account/sessions/${randomUUID()}`, expect: staffOf(404) },
  'DELETE /staff/account/sessions': { expect: staffOf(204) },

  'GET /staff/members': { expect: staffOf(200, { officerA: 403, officerB: 403 }) },
  'POST /staff/members': {
    body: () => ({ firstName: 'Nora', lastName: 'Test', role: 'CLAIMS_OFFICER', email: `n${randomBytes(6).toString('hex')}@legarec.fr` }),
    expect: administers,
  },
  'DELETE /staff/members/:id': { path: member('INVITED'), expect: administers },
  'POST /staff/members/:id/disable': { path: member('ACTIVE', '/disable'), body: () => ({ reason: 'Départ', cases: 0 }), expect: administers },
  'POST /staff/members/:id/enable': { path: member('DISABLED', '/enable'), expect: administers },
  // The role is taken: what the test of the members proves otherwise.
  'PUT /staff/members/:id/role': {
    path: member('ACTIVE', '/role'),
    body: () => ({ role: 'DEVELOPER' }),
    expect: only({ director: 409, manager: 409, liar: 409 }),
  },
  'PUT /staff/members/:id/extension': { path: member('ACTIVE', '/extension'), body: () => ({ extension: '118' }), expect: only({ developer: 204 }) },
  'POST /staff/members/:id/reset-link': { path: member('ACTIVE', '/reset-link'), expect: supports },
  'POST /staff/members/:id/require-2fa': { path: member('ACTIVE', '/require-2fa'), expect: supports },
  // That of the team: the Director and the Developer.
  'POST /staff/members/:id/reset-2fa': {
    path: member('ACTIVE', '/reset-2fa', (test, id) =>
      test.database.admin.query("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [id]),
    ),
    expect: only({ director: 204, developer: 204 }),
  },
  'POST /staff/members/:id/unlock': {
    path: member('ACTIVE', '/unlock', (test, id) =>
      test.database.admin.query("INSERT INTO lockouts (key_hash, scope, failures, locked_until) VALUES ($1, 'SECOND_FACTOR', 5, now() + interval '1 hour')", [
        new AuthKeys(test.config).attempt('second-factor', id),
      ]),
    ),
    expect: supports,
  },

  'GET /staff/shell': { expect: staffOf(200) },
  'POST /staff/search': { body: () => ({ query: 'ALPHA' }), expect: staffOf(200) },
  'GET /staff/auth/proof': { expect: staffOf(200) },
  'POST /staff/auth/proof/webauthn': { expect: staffOf(200) },
  // No account of the test set has a password nor a second factor: refused, and counted.
  'POST /staff/auth/proof': { body: () => ({ method: 'TOTP', code: '123456' }), expect: staffOf(422) },
  'GET /staff/delegations': { expect: only({ director: 200, liar: 200 }) },
  'PUT /staff/delegations/:kind': { path: () => '/staff/delegations/technical', body: () => ({ active: true }), expect: only({ director: 204 }) },
  'POST /staff/support-tickets': { body: () => ({ subject: 'Question', message: 'Une question du banc de test.' }), expect: staffOf(200) },
  // The liar sees nothing of it.
  'POST /staff/cases/search': { body: () => ({ query: '' }), expect: withCases(200) },
  'GET /staff/cases/choices': { expect: opens(200) },
  // The liar sees no creditor but those of their cases: the one that is asked has none.
  'POST /staff/cases/check': {
    path: (test) => newCreditor(test, '/staff/cases/check'),
    body: () => ({ creditorId: lastCreditor, number: '' }),
    expect: { ...opens(200), liar: 404 },
  },
  'POST /staff/cases/assign': {
    path: async (test) => {
      assigned = { ids: [(await newCase(test)).id], officerId: test.s.director };
      return '/staff/cases/assign';
    },
    body: () => assigned,
    expect: only({ director: 204, manager: 204, liar: 403 }),
  },
  // Without a mandate: what the test of the cases proves otherwise.
  'POST /staff/cases': {
    path: (test) => newCreditor(test, '/staff/cases'),
    body: () => ({ ...CASE, creditorId: lastCreditor }),
    expect: { ...opens(409), liar: 404 },
  },
  'GET /staff/cases/:id': {
    path: (test) => `/staff/cases/${test.s.cases.ofA}`,
    // « Accès refusé » for a case of someone else (question 141).
    expect: { ...withCases(200), officerB: 403 },
  },
  // Held by nobody: the manager acts on it.
  'POST /staff/cases/:id/invoices': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/invoices`,
    body: () => ({ version: 1, invoices: [INVOICE], expected: { principal: 100, invoices: 1 } }),
    expect: only({ director: 403, manager: 204, managerAlone: 204, liar: 404 }),
  },
  'GET /staff/cases/:id/access-code': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/access-code`,
    expect: only({ director: 403, manager: 200, managerAlone: 200, officerA: 404, officerB: 404, liar: 404 }),
  },
  'POST /staff/cases/:id/access-code/regenerate': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/access-code/regenerate`,
    body: () => ({ version: 1 }),
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  // Claims deposited by creditors (question 155): the Director and the manager in their own right.
  'GET /staff/deposits': { path: () => '/staff/deposits', expect: only({ director: 200, manager: 200, managerAlone: 200, liar: 200 }) },
  'POST /staff/deposits/:id/accept': {
    path: () => `/staff/deposits/${randomUUID()}/accept`,
    body: () => ({ expectedTotal: 100 }),
    expect: only({ director: 404, manager: 404, managerAlone: 404, liar: 403 }),
  },
  'POST /staff/deposits/:id/refuse': {
    path: () => `/staff/deposits/${randomUUID()}/refuse`,
    body: () => ({ reason: 'Motif du refus' }),
    expect: only({ director: 404, manager: 404, managerAlone: 404, liar: 403 }),
  },
  'POST /staff/cases/:id/notes': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/notes`,
    body: () => ({ text: 'Rappeler après le 5.' }),
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  // The Director and the manager, from a case they act on (question 138): the Director holds no case of nobody. The name shown
  // is not the one known: refused once let in.
  'PUT /staff/cases/:id/debtor': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/debtor`,
    body: () => ({ kind: 'COMPANY', name: 'Nouveau nom', seen: 'Autre nom' }),
    expect: only({ director: 403, manager: 409, managerAlone: 409, liar: 404 }),
  },
  'POST /staff/cases/:id/coordinates': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/coordinates`,
    body: () => ({ kind: 'PHONE', label: 'x', value: '06 00 00 00 01', primary: false, replaces: null, source: 'CALL' }),
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  'PUT /staff/cases/:id/coordinates/:coordinateId': {
    path: async (test) => {
      const { id, creditorId } = await newCase(test);
      const { rows } = await test.database.admin.query<{ id: string }>(
        "INSERT INTO case_contacts (case_id, creditor_id, kind, label, value, value_normalized, source) VALUES ($1, $2, 'PHONE', 'x', '06 00 00 00 01', '0600000001', 'CALL') RETURNING id",
        [id, creditorId],
      );
      return `/staff/cases/${id}/coordinates/${rows[0]!.id}`;
    },
    body: () => ({ status: 'VERIFIED' }),
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  // An officer: the creditors of their cases. The liar is one.
  'GET /staff/creditors': { expect: only({ director: 200, manager: 200, managerAlone: 200, officerA: 200, officerB: 200, liar: 200 }) },
  'GET /staff/creditors/:id': {
    path: (test) => `/staff/creditors/${test.s.creditorA}`,
    expect: only({ director: 200, manager: 200, managerAlone: 200, officerA: 200, officerB: 404, liar: 200 }),
  },
  'GET /staff/creditors/choices': { expect: only({ director: 200, manager: 200, managerAlone: 200, liar: 200 }) },
  'GET /staff/creditors/:id/file': { path: creditor('/file'), expect: only({ director: 200, manager: 200, managerAlone: 200, liar: 404 }) },
  'POST /staff/creditors': {
    path: async (test) => {
      await test.database.admin.query("DELETE FROM mandates USING creditors c WHERE c.id = creditor_id AND c.siren = '732829320'");
      await test.database.admin.query("DELETE FROM creditor_contacts USING creditors c WHERE c.id = creditor_id AND c.siren = '732829320'");
      await test.database.admin.query("DELETE FROM creditors WHERE siren = '732829320'");
      return '/staff/creditors';
    },
    body: () => ({ siren: '732829320', ...creditorBody(), mandate: MANDATE }),
    expect: only({ director: 200, manager: 200, managerAlone: 200 }),
  },
  'PUT /staff/creditors/:id': {
    path: creditor(),
    body: () => ({ version: 1, ...creditorBody() }),
    expect: only({ director: 204, manager: 204, managerAlone: 204, liar: 404 }),
  },
  // Nothing to amend: what the test of the creditors proves otherwise.
  'POST /staff/creditors/:id/amendments': {
    path: creditor('/amendments'),
    body: () => ({ amends: randomUUID(), mandate: MANDATE }),
    expect: only({ director: 409, manager: 409, managerAlone: 409, liar: 404 }),
  },
  'POST /staff/creditors/:id/bank-accounts': {
    path: creditor('/bank-accounts'),
    body: () => ({ replaces: null, account: ACCOUNT }),
    expect: only({ director: 204, manager: 204, liar: 404 }),
  },
  'POST /staff/creditors/:id/bank-accounts/:accountId/confirm': {
    path: creditor('', bankAccount('confirm')),
    body: () => ({ confirmedWith: 'X' }),
    expect: only({ director: 204, manager: 204, liar: 409 }),
  },
  // Not encrypted with the key of the tests: refused to all but those who may read it.
  'POST /staff/creditors/:id/bank-accounts/:accountId/reveal': {
    path: creditor('', bankAccount('reveal')),
    expect: only({ director: 500, manager: 500, liar: 404 }),
  },
  'GET /staff/settings/:scope': { path: () => '/staff/settings/firm', expect: staffOf(200) },
  'GET /staff/settings/:scope/:id': { path: () => '/staff/settings/techniques/audit', expect: only({ director: 200, developer: 200, liar: 200 }) },
  'PUT /staff/settings/:scope/:id': {
    path: async (test) => {
      const { rows } = await test.database.admin.query<{ version: number }>(
        "SELECT coalesce(sum(version), 0)::int AS version FROM settings WHERE key LIKE 'firm.relances.%'",
      );
      return `/staff/settings/firm/relances?version=${rows[0]!.version}`;
    },
    // Each caller changes something.
    body: () => ({ calls: String(1 + (settingTurn++ % 2) * 2) }),
    expect: only({ director: 204, manager: 204 }),
  },
  'GET /staff/secrets': { expect: only({ director: 200, developer: 200, liar: 200 }) },
  'POST /staff/secrets': {
    path: async (test) => {
      await test.database.admin.query("DELETE FROM vault_secrets WHERE name = 'TCX_API_CLIENT_ID'");
      return '/staff/secrets';
    },
    body: () => ({ name: 'TCX_API_CLIENT_ID', value: 'valeur-fictive', rotation: 'MANUAL' }),
    expect: technical,
  },
  'POST /staff/secrets/:id/rotate': { path: secret('rotate'), body: () => ({ value: 'valeur-fictive' }), expect: hidden },
  'POST /staff/secrets/:id/revoke': { path: secret('revoke'), expect: hidden },
  'POST /staff/secrets/:id/keep': { path: secret('keep', 'REVOKE_PENDING'), expect: only({ director: 204, liar: 404 }) },
  // Dashboard: whoever reads cases; the Developer reads none. A case held by nobody: officers do not see it.
  'GET /staff/dashboard': { expect: withCases(200) },
  'PUT /staff/dashboard/priorities/:id': {
    path: async (test) => `/staff/dashboard/priorities/call:${(await newCase(test)).id}`,
    body: () => ({ done: true }),
    expect: withCases(404, { manager: 204, managerAlone: 204 }),
  },
  // Registry of the RGPD: written by whoever acts on the case, kept by the Director and their administrative delegate.
  'POST /staff/gdpr/requests': {
    path: async (test) => {
      gdprCase = (await newCase(test)).id;
      return '/staff/gdpr/requests';
    },
    body: () => ({ caseId: gdprCase, kind: 'ACCESS', origin: 'Courrier' }),
    expect: withCases(403, { manager: 204, managerAlone: 204 }),
  },
  'GET /staff/gdpr/requests': { expect: only({ director: 200, manager: 200 }) },
  'PUT /staff/gdpr/requests/:id': { path: gdprRequest(''), body: () => ({ status: 'ANSWERED', reason: 'Données envoyées' }), expect: administers },
  'POST /staff/gdpr/requests/:id/export': { path: gdprRequest('/export'), expect: only({ director: 200, manager: 200 }) },
  // Erasure: the Director or their administrative delegate; the case is still open, so it is refused with its reason.
  'GET /staff/gdpr/requests/:id/erasure': { path: gdprRequest('/erasure', 'ERASURE'), expect: only({ director: 200, manager: 200 }) },
  'POST /staff/gdpr/requests/:id/erasure': {
    path: gdprRequest('/erasure', 'ERASURE'),
    body: () => ({ expectedCases: 1, expectedDigest: '0'.repeat(64) }),
    expect: only({ director: 409, manager: 409 }),
  },
  // Remittances: the Director, or the manager acting for them; an empty batch is not validated.
  'GET /staff/remittances/draft': { expect: only({ director: 200, manager: 200 }) },
  'POST /staff/remittances': {
    body: () => ({ until: '2026-01-01', expected: [], retained: [] }),
    expect: only({ director: 409, manager: 409 }),
  },
  'GET /staff/remittances': { expect: only({ director: 200, manager: 200 }) },
  'GET /staff/remittances/:id': { path: () => `/staff/remittances/${randomUUID()}`, expect: only({ director: 404, manager: 404 }) },
  'POST /staff/remittances/:id/paid': {
    path: () => `/staff/remittances/${randomUUID()}/paid`,
    body: () => ({ paidOn: '2026-01-02', expectedTotal: 0 }),
    expect: only({ director: 409, manager: 409 }),
  },
  // Credit notes: as all of the billing, the Director or the manager acting for them; an unknown invoice or draft is nothing.
  'GET /staff/credit-notes': { expect: only({ director: 200, manager: 200 }) },
  'POST /staff/credit-notes': {
    body: () => ({ invoiceId: randomUUID(), scope: 'TOTAL', lines: [], reason: 'Erreur de taux', followUp: 'DEDUCTED', expectedLeft: 100, draftId: null }),
    // The identity of the firm is still between brackets in the test set: nothing is issued.
    expect: only({ director: 409, manager: 409 }),
  },
  'POST /staff/credit-notes/drafts': {
    body: () => ({ invoiceId: randomUUID(), scope: 'PARTIAL', lines: [], reason: '', followUp: null }),
    expect: only({ director: 404, manager: 404 }),
  },
  'PUT /staff/credit-notes/drafts/:id': {
    path: () => `/staff/credit-notes/drafts/${randomUUID()}`,
    body: () => ({ invoiceId: randomUUID(), scope: 'PARTIAL', lines: [], reason: '', followUp: null }),
    expect: only({ director: 404, manager: 404 }),
  },
  'DELETE /staff/credit-notes/drafts/:id': {
    path: () => `/staff/credit-notes/drafts/${randomUUID()}`,
    expect: only({ director: 404, manager: 404 }),
  },
  // The Facturation screen: as the credit notes. Nothing is created from a template yet (questions 195 and 196).
  'GET /staff/billing': { expect: only({ director: 200, manager: 200 }) },
  'POST /staff/billing': {
    body: () => ({ type: 'INVOICE', templateId: 'forfait', clientId: randomUUID(), lines: [], terms: [], draft: true }),
    expect: only({ director: 409, manager: 409 }),
  },
  // Reports: whoever reads cases, each on the cases they read. No scheduled report exists yet: none is found, by those who steer.
  'GET /staff/reports': { expect: withCases(200) },
  'PUT /staff/reports/scheduled/:id': {
    path: () => '/staff/reports/scheduled/r1',
    body: () => ({ active: false }),
    expect: only({ director: 404, manager: 404, managerAlone: 404, liar: 403 }),
  },
  // The activity of the team: those who steer, as PostgreSQL knows them.
  'GET /staff/team': { expect: only({ director: 200, manager: 200, managerAlone: 200, liar: 403 }) },
  // Agenda of the reminders: read with the cases; planned on a case one acts on (here held by nobody: the managers).
  'GET /staff/reminders': { expect: withCases(200) },
  'GET /staff/reminders/targets': { expect: withCases(200) },
  'POST /staff/reminders': {
    path: async (test) => {
      reminderCase = (await newCase(test)).id;
      return '/staff/reminders';
    },
    body: () => ({
      caseId: reminderCase,
      type: 'CALL',
      date: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
      time: '10:00',
      title: 'Point sur la promesse',
    }),
    expect: withCases(404, { director: 403, manager: 200, managerAlone: 200 }),
  },
  'PUT /staff/reminders/:id': {
    path: plannedReminder,
    body: () => ({ done: true }),
    expect: withCases(404, { director: 403, manager: 204, managerAlone: 204 }),
  },
  'DELETE /staff/reminders/:id': { path: plannedReminder, expect: withCases(404, { director: 403, manager: 204, managerAlone: 204 }) },
  // A reminder from a case one acts on (here held by nobody: the managers); its debtor is an individual, to whom no e-mail reminder goes.
  'POST /staff/cases/:id/reminders': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/reminders`,
    body: () => ({ channel: 'EMAIL', template: 'FRIENDLY', recipient: 'compta@exemple.test', message: 'Bonjour' }),
    expect: withCases(404, { director: 403, manager: 409, managerAlone: 409 }),
  },
  // Reminders from the list: all or nothing on the rights; then the individual is left out with its reason (200).
  'POST /staff/cases/reminders': {
    path: async (test) => {
      remindedCase = (await newCase(test)).id;
      return '/staff/cases/reminders';
    },
    body: () => ({ items: [{ id: remindedCase, template: 'FRIENDLY' }] }),
    expect: withCases(404, { director: 403, manager: 200, managerAlone: 200 }),
  },
  'POST /staff/cases/reminders/preview': {
    path: async (test) => {
      remindedCase = (await newCase(test)).id;
      return '/staff/cases/reminders/preview';
    },
    body: () => ({ ids: [remindedCase] }),
    expect: withCases(404, { director: 403, manager: 200, managerAlone: 200 }),
  },
  // Litigation: read with the cases; opened and followed on a case one acts on (here held by nobody: the managers).
  'GET /staff/litigation': { expect: withCases(200) },
  'POST /staff/cases/litigation': {
    path: async (test) => {
      litigationCase = (await newCase(test)).id;
      return '/staff/cases/litigation';
    },
    body: () => ({ ids: [litigationCase], reason: 'Promesses non tenues', consentReceived: false }),
    expect: withCases(404, { director: 403, manager: 204, managerAlone: 204 }),
  },
  'PUT /staff/litigation/:id': {
    path: litigationFile('NOT_NEEDED', ''),
    body: () => ({ court: 'Tribunal de commerce de Lyon', partnerName: 'Me Durieux', version: 1 }),
    expect: withCases(404, { director: 403, manager: 204, managerAlone: 204 }),
  },
  'POST /staff/litigation/:id/stage': {
    path: litigationFile('NOT_NEEDED', '/stage'),
    body: () => ({ stage: 'PAYMENT_ORDER', version: 1 }),
    expect: withCases(404, { director: 403, manager: 204, managerAlone: 204 }),
  },
  'POST /staff/litigation/:id/consent': {
    path: litigationFile('WAITING', '/consent'),
    body: () => ({ version: 1 }),
    expect: withCases(404, { director: 403, manager: 204, managerAlone: 204 }),
  },
  // The summary of the assistant: whoever acts on the case; off in the tests (409), nothing to report yet (404).
  'POST /staff/cases/:id/ai-summary': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/ai-summary`,
    expect: withCases(404, { director: 403, manager: 409, managerAlone: 409 }),
  },
  'POST /staff/cases/:id/ai-summary/report': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/ai-summary/report`,
    expect: withCases(404, { director: 403 }),
  },
  // The journal of the assistant: the Director and the Developer; PostgreSQL refuses the liar.
  'GET /staff/ai/journal': { expect: only({ director: 200, developer: 200, liar: 403 }) },
  'GET /staff/notifications': { expect: staffOf(200) },
  'PUT /staff/notifications': { body: () => ({ ids: [randomUUID()], unread: false }), expect: staffOf(204) },
  'POST /staff/notifications/read': { body: () => ({ ids: [] }), expect: staffOf(204) },
  // Money: whoever acts on the case; the Director reads it without acting.
  'POST /staff/cases/:id/payments': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/payments`,
    body: cheque,
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  'PUT /staff/cases/:id/payments/:paymentId': {
    path: paymentPath,
    body: () => ({ status: 'CASHED', version: 1 }),
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  'GET /staff/payment-plans': { expect: withCases(200) },
  'GET /staff/payment-plans/simulation/:id': {
    path: async (test) => `/staff/payment-plans/simulation/${(await owingCase(test)).id}`,
    expect: only({ director: 403, manager: 200, managerAlone: 200, officerA: 404, officerB: 404, liar: 404 }),
  },
  'POST /staff/payment-plans': {
    path: async (test) => {
      planned = { caseId: (await owingCase(test)).id, months: 3, method: 'TRANSFER', expected: 10000 };
      return '/staff/payment-plans';
    },
    body: () => planned,
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  // The manager only: the liar is let in by the guard, then refused by PostgreSQL.
  'PUT /staff/payment-plans/requests/:id': {
    path: pendingPlan,
    body: () => ({ decision: 'APPROVED', version: 1 }),
    expect: only({ manager: 204, managerAlone: 204 }),
  },
  'GET /staff/interest-rates': { expect: staffOf(200) },
  'PUT /staff/interest-rates': {
    // Each caller writes a semester of its own: the value shown is that of nobody.
    body: () => ({ kind: 'ECB', validFrom: `${2030 + (rateTurn++ % 40)}-01-01`, rateBp: 215, expected: null }),
    expect: only({ director: 204, manager: 204, liar: 403 }),
  },
  // Documents: the cases one reads; a file is read from the disk, which the test does not fill: 500 for whoever gets that far.
  'GET /staff/documents': { expect: withCases(200) },
  'POST /staff/documents/import': { file: PDF, expect: withCases(200) },
  'POST /staff/documents/:id/share': {
    path: (test) => documentPath(test, '/share'),
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  'GET /staff/documents/:id/file': {
    path: (test) => documentPath(test, '/file'),
    expect: only({ director: 500, manager: 500, managerAlone: 500, officerA: 404, officerB: 404, liar: 404 }),
  },
  // Templates: read by the team; imported, restored and submitted by the Director and the manager; published by the Director,
  // or the manager on their behalf. The liar is let in by the guard, then refused by PostgreSQL.
  'GET /staff/templates': { expect: staffOf(200) },
  'GET /staff/templates/:id': { path: () => '/staff/templates/amiable', expect: staffOf(200) },
  'POST /staff/templates/:id/import': {
    path: () => '/staff/templates/amiable/import',
    body: () => ({ source: TEMPLATE_SOURCE, fileName: 'amiable.html' }),
    expect: only({ director: 204, manager: 204, managerAlone: 204, liar: 403 }),
  },
  'DELETE /staff/templates/:id/import': {
    path: () => '/staff/templates/amiable/import',
    expect: only({ director: 204, manager: 204, managerAlone: 204, liar: 403 }),
  },
  'POST /staff/templates/:id/import/undo': {
    path: templateIn('ferme', 'CANCELLED', '/import/undo'),
    expect: only({ director: 204, manager: 204, managerAlone: 204, liar: 403 }),
  },
  'POST /staff/templates/:id/restore': {
    path: () => '/staff/templates/echeancier/restore',
    body: () => ({}),
    expect: only({ director: 204, manager: 204, managerAlone: 204, liar: 403 }),
  },
  'POST /staff/templates/:id/submit': {
    path: templateIn('attestation', 'IMPORTED', '/submit'),
    body: () => ({ acknowledged: true }),
    expect: only({ director: 204, manager: 204, managerAlone: 204, liar: 403 }),
  },
  'POST /staff/templates/:id/review': {
    path: templateIn('rappel', 'WAITING', '/review'),
    body: () => ({ approved: true }),
    expect: only({ director: 204, manager: 204, liar: 403 }),
  },
  // Debtors: no account; the sign-in answers the same to whoever is there.
  'POST /debtor/access': {
    // A SIREN known of nobody: refused alike, and counted on a key of its own each time.
    body: () => ({ identifier: { kind: 'SIREN', value: unknownSiren() }, code: 'ABCD', remember: false }),
    expect: everyone(401),
  },
  'POST /debtor/logout': { expect: everyone(204) },
  'GET /debtor/session': { expect: only({ debtorA: 200, debtorB: 200 }) },
  // A case announced to debtor A only.
  'GET /debtor/cases/:id': { path: (test) => `/debtor/cases/${test.s.cases.ofA}`, expect: only({ debtorA: 200, debtorB: 404 }) },
  'GET /debtor/cases/:id/messages': { path: (test) => `/debtor/cases/${test.s.cases.ofA}/messages`, expect: only({ debtorA: 200, debtorB: 404 }) },
  'POST /debtor/cases/:id/messages': {
    path: (test) => `/debtor/cases/${test.s.cases.ofA}/messages`,
    body: () => ({ text: 'Bonjour', attachmentKind: 'OTHER', attachments: [] }),
    expect: only({ debtorA: 204, debtorB: 404 }),
  },
  'POST /debtor/cases/:id/messages/read': { path: (test) => `/debtor/cases/${test.s.cases.ofA}/messages/read`, expect: only({ debtorA: 204, debtorB: 404 }) },
  'POST /debtor/cases/:id/requests': {
    path: (test) => `/debtor/cases/${test.s.cases.ofA}/requests`,
    body: () => ({ kind: 'CALLBACK', phone: '06 12 34 56 78', slot: 'MORNING' }),
    expect: only({ debtorA: 204, debtorB: 404 }),
  },
  'POST /debtor/attachments': { file: PDF, expect: only({ debtorA: 200, debtorB: 200 }) },
  // The plan proposed to debtor A, and its files: debtor B sees none of them.
  'POST /debtor/cases/:id/plan/acceptance': {
    path: (test) => debtorPlan(test, '/plan/acceptance'),
    body: () => ({ fingerprint: PLAN_FINGERPRINT, total: 10000, months: 2 }),
    expect: only({ debtorA: 204, debtorB: 404 }),
  },
  'GET /debtor/cases/:id/plan/file': { path: (test) => debtorPlan(test, '/plan/file'), expect: only({ debtorA: 200, debtorB: 404 }) },
  'GET /debtor/cases/:id/receipts/:receipt/file': { path: debtorReceipt, expect: only({ debtorA: 200, debtorB: 404 }) },
  // Held by nobody: the manager answers; the Director reads it without acting.
  'POST /staff/cases/:id/portal-messages': {
    path: async (test) => `/staff/cases/${(await newCase(test)).id}/portal-messages`,
    body: () => ({ text: 'Bonjour' }),
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
  },
  // Creditors: their own cases only; the cases of A are not those of B.
  'GET /partner/portal/dashboard': { expect: only({ partnerA: 200, partnerB: 200 }) },
  'GET /partner/portal/payouts': { expect: only({ partnerA: 200, partnerB: 200 }) },
  'GET /partner/portal/documents': { expect: only({ partnerA: 200, partnerB: 200 }) },
  'GET /partner/portal/cases': { expect: only({ partnerA: 200, partnerB: 200 }) },
  'GET /partner/portal/cases/:id': { path: (test) => `/partner/portal/cases/${test.s.cases.ofA}`, expect: only({ partnerA: 200, partnerB: 404 }) },
  'POST /partner/portal/plans/:id/decision': { path: creditorPlan, body: () => ({ accepted: true }), expect: only({ partnerA: 204, partnerB: 404 }) },
  // Without a mandate in force (the test set has none), a deposit is refused alike for both creditors.
  'POST /partner/portal/claims': {
    body: () => ({
      debtor: 'Bâtiplus SAS',
      siret: '',
      email: '',
      phone: '',
      address: '14 rue des Forges, 69007 Lyon',
      attachments: [],
      invoices: [INVOICE_OF_CLAIM],
    }),
    expect: only({ partnerA: 409, partnerB: 409 }),
  },
  'POST /partner/portal/attachments': { file: PDF, expect: only({ partnerA: 200, partnerB: 200 }) },
  // The file of the matrix is a PDF: unreadable as claims, alike for both creditors.
  'POST /partner/portal/imports': { file: PDF, expect: only({ partnerA: 422, partnerB: 422 }) },
  'POST /partner/portal/imports/:id/confirm': { path: () => `/partner/portal/imports/${randomUUID()}/confirm`, expect: only({ partnerA: 404, partnerB: 404 }) },
  // Before any code: open to whoever is there, and the same answer for all.
  'GET /debtor/links/:token': { path: () => `/debtor/links/${randomBytes(9).toString('base64url')}`, expect: everyone(404) },
  'POST /debtor/code-by-sms': { body: () => ({ kind: 'SIREN', value: unknownSiren() }), expect: everyone(200) },
  'GET /debtor/limited/payment': { expect: everyone(200) },
  'POST /debtor/limited/messages': {
    body: () => ({ name: 'Jean Martin', email: '', reference: '', text: 'Bonjour', attachments: [] }),
    expect: everyone(204),
  },
};
