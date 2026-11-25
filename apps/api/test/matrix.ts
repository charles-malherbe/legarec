import { randomBytes, randomUUID } from 'node:crypto';
import { AuthKeys } from '../src/modules/auth/keys';
import type { TestApp } from './app';

/** Callers of the test set. `managerAlone` has lost the delegation; `liar` announces rights the table does not give. */
export type Caller =
  'nobody' | 'director' | 'manager' | 'managerAlone' | 'developer' | 'officerA' | 'officerB' | 'liar' | 'partnerA' | 'partnerB' | 'debtorA' | 'debtorB';

export interface MatrixEntry {
  /** Real path, for a route with parameters. Computed for each caller: what one of them does changes nothing for the next. */
  path?: (test: TestApp) => string | Promise<string>;
  body?: () => unknown;
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
const withCases = (status: number) => only({ director: status, manager: status, managerAlone: status, officerA: status, officerB: status, liar: status });
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
let assigned: unknown;
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
    [id, test.s.director],
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
const ACCOUNT = { holder: 'X', iban: 'GB82 WEST 1234 5698 7654 32', bic: 'PSSTFRPPXXX', confirmedWith: '' };

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
    expect: { ...withCases(200), officerB: 404 },
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
    expect: only({ director: 403, manager: 204, managerAlone: 204, officerA: 404, officerB: 404, liar: 404 }),
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
    path: () => '/staff/settings/firm/relances',
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
  'GET /staff/notifications': { expect: staffOf(200) },
  'PUT /staff/notifications': { body: () => ({ ids: [randomUUID()], unread: false }), expect: staffOf(204) },
  'POST /staff/notifications/read': { body: () => ({ ids: [] }), expect: staffOf(204) },
};
