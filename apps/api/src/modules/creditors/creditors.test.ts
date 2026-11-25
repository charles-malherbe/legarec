import { creditorChoices, creditorDetail, creditorFile, creditorListItem, type MandateForm } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startApp, type TestApp } from '../../../test/app';
import { Database } from '../../platform/database/database';

/** Example IBANs of the international standard, not real accounts. */
const IBAN = 'GB82 WEST 1234 5698 7654 32';
const OTHER = 'DE89 3704 0044 0532 0130 00';
let test: TestApp;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path = '', body?: unknown) =>
  test.call(method, `/staff/creditors${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
/** Valid keys, unknown of the firm. */
let next = 0;
const SIRENS = [
  '732829007',
  '732829072',
  '732829148',
  '732829213',
  '732829288',
  '732829353',
  '732829429',
  '732829494',
  '732829569',
  '732829635',
  '732829700',
  '732829775',
  '732829841',
  '732829916',
  '732829981',
  '732830054',
  '732830120',
  '732830195',
  '732830260',
  '732830336',
  '732830401',
  '732830476',
  '732830542',
  '732830617',
  '732830682',
  '732830757',
  '732830823',
  '732830898',
  '732830963',
  '732831037',
];
const identity = {
  legalName: 'Boulangeries Rivaud SAS',
  name: 'Boulangeries Rivaud',
  sector: '',
  vatNumber: '',
  address: '6 rue du Four',
  postalCode: '69100',
  city: 'Villeurbanne',
  managerId: null,
  portalEnabled: true,
};
const contacts = [{ name: 'Élodie Rivaud', title: '', email: 'e.rivaud@exemple.test', phone: '04 72 00 00 10', isMain: true }];
const mandate = (some: Partial<MandateForm> = {}): MandateForm => ({
  startsOn: '2026-01-01',
  endsOn: null,
  amicableRateBp: 800,
  litigationRateBp: 1200,
  openingFeeCents: 1500,
  planMonthsWithoutConsent: 6,
  discountMaxBp: 500,
  litigationNeedsConsent: true,
  deferSmallRemittances: false,
  interestMode: 'ECB_PLUS_TEN',
  contractRateBp: null,
  fixedIndemnity: true,
  reportingDay: 5,
  scenario: 'BUSINESS',
  ...some,
});
const body = (some: object = {}) => ({ siren: SIRENS[next++]!, identity, contacts, mandate: mandate(), ...some });
const create = async (some: object = {}) => {
  const answer = await call('director', 'POST', '', body(some));
  expect(answer.status).toBe(200);
  return (answer.body as { id: string }).id;
};
const file = async (id: string, as = 'director') => creditorFile.parse((await call(as, 'GET', `/${id}/file`)).body);
const account = (iban = IBAN, confirmedWith = '') => ({ holder: 'Boulangeries Rivaud SAS', iban, bic: 'PSSTFRPPXXX', confirmedWith });
const actions = async (id: string) =>
  (await rows<{ action: string }>('SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at', [id])).map((row) => row.action);

beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

describe('a creditor', () => {
  it('is created whole, by the Director or the manager in their own right', async () => {
    const id = await create();
    const seen = await file(id);
    expect(seen).toMatchObject({ version: 1, identity, contacts, openCases: 0, bankAccess: 'EDIT', bankAccount: null });
    expect(seen.mandates).toEqual([{ ...mandate(), id: seen.mandates[0]!.id, state: 'CURRENT', hasContract: false }]);
    // Without any delegation.
    expect((await call('managerAlone', 'POST', '', body())).status).toBe(200);
    expect(await actions(id)).toEqual(['CREDITOR_CREATED']);
    expect(await rows('SELECT on_behalf_of_id FROM audit_log WHERE entity_id = $1', [id])).toEqual([{ on_behalf_of_id: null }]);
  });

  it('is created once for a SIREN, even at the same time', async () => {
    const same = body();
    const answers = await Promise.all([call('director', 'POST', '', same), call('manager', 'POST', '', same)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(await call('director', 'POST', '', same)).toMatchObject({ status: 409, body: { code: 'SIREN_TAKEN' } });
  });

  it.each<[string, object]>([
    ['a wrong SIREN', { siren: '123456789' }],
    ['no contact', { contacts: [] }],
    ['two main contacts', { contacts: [...contacts, ...contacts] }],
    ['no main contact', { contacts: [{ ...contacts[0], isMain: false }] }],
    ['a wrong postal code', { identity: { ...identity, postalCode: '6910' } }],
    ['an unknown manager', { identity: { ...identity, managerId: randomUUID() } }],
    ['an end before its start', { mandate: mandate({ endsOn: '2025-12-31' }) }],
    ['a contract without its rate', { mandate: mandate({ interestMode: 'CONTRACT' }) }],
    ['a rate without a contract', { mandate: mandate({ contractRateBp: 500 }) }],
    ['more than 100 %', { mandate: mandate({ amicableRateBp: 10_001 }) }],
    ['a 31st', { mandate: mandate({ reportingDay: 31 }) }],
  ])('is refused with %s, and nothing of it stays', async (_what, some) => {
    const before = await rows('SELECT count(*) FROM creditors');
    const sent = { ...body(), ...some };
    expect((await call('director', 'POST', '', sent)).status).toBe(422);
    expect(await rows('SELECT count(*) FROM creditors')).toEqual(before);
  });

  it('is never managed by a Developer nor by a disabled account', async () => {
    for (const managerId of [test.s.developer, test.s.partnerA])
      expect((await call('director', 'POST', '', { ...body(), identity: { ...identity, managerId } })).status).toBe(422);
  });

  it('changes with the version that was read, the contacts with it', async () => {
    const id = await create();
    const changed = { version: 1, identity: { ...identity, city: 'Lyon', managerId: test.s.officerA }, contacts: [{ ...contacts[0]!, name: 'Marc Teyssier' }] };
    expect((await call('manager', 'PUT', `/${id}`, changed)).status).toBe(204);
    expect(await call('director', 'PUT', `/${id}`, changed)).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    expect(await file(id)).toMatchObject({ version: 2, identity: { city: 'Lyon' }, contacts: [{ name: 'Marc Teyssier' }], updatedBy: 'Remi Test' });
    expect((await call('director', 'PUT', `/${randomUUID()}`, changed)).status).toBe(404);
  });
});

describe('who sees what', () => {
  it('an officer reads the creditors of their cases alone, without the account nor the form', async () => {
    const names = z
      .array(creditorListItem)
      .parse((await call('officerA', 'GET')).body)
      .map((item) => item.name);
    expect(names).toEqual(['Créancier ALPHA-MARK']);
    expect((await call('officerA', 'GET', `/${test.s.creditorB}`)).status).toBe(404);
    const detail = creditorDetail.parse((await call('officerA', 'GET', `/${test.s.creditorA}`)).body);
    expect(JSON.stringify(detail)).not.toContain('BETA-MARK');
    for (const path of [`/${test.s.creditorA}/file`, '/choices']) expect((await call('officerA', 'GET', path)).status).toBe(403);
  });

  it('counts the cases and the invoices that the person sees, and no other', async () => {
    const { s } = test;
    const add = (caseId: string, creditorId: string, number: string, cents: number) =>
      rows(
        "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, $3, '2026-01-01', '2026-02-01', $4, $4)",
        [caseId, creditorId, number, cents],
      );
    await add(s.cases.ofA, s.creditorA, 'A-1', 1000);
    await add(s.cases.unassigned, s.creditorA, 'A-2', 500);
    const of = async (as: string) =>
      z
        .array(creditorListItem)
        .parse((await call(as, 'GET')).body)
        .find((item) => item.id === s.creditorA)!;
    expect(await of('director')).toMatchObject({ debtors: 2, invoices: 2, outstanding: 1500 });
    expect(await of('officerA')).toMatchObject({ debtors: 1, invoices: 1, outstanding: 1000 });
    const { portfolio } = creditorDetail.parse((await call('officerA', 'GET', `/${s.creditorA}`)).body);
    expect(portfolio).toHaveLength(1);
    expect(portfolio[0]).toMatchObject({ id: s.cases.ofA, amount: 1000, invoices: [{ number: 'A-1', left: 1000, state: 'UNPAID' }] });
  });

  it('the Developer reads none', async () => {
    for (const path of ['', `/${test.s.creditorA}`, `/${test.s.creditorA}/file`, '/choices']) expect((await call('developer', 'GET', path)).status).toBe(403);
  });

  it('the choices of the form follow the settings of the firm', async () => {
    const choices = creditorChoices.parse((await call('manager', 'GET', '/choices')).body);
    expect(choices.defaults.amicableRateBp).toBe(800);
    expect(choices.bankAccess).toBe('EDIT');
    expect(choices.managers.map((manager) => manager.name)).not.toContain('Devon Test');
    expect(creditorChoices.parse((await call('managerAlone', 'GET', '/choices')).body).bankAccess).toBe('NONE');
  });
});

describe('a mandate', () => {
  it('is amended by another one, which closes it the day before, and keeps its terms', async () => {
    const id = await create();
    const [first] = (await file(id)).mandates;
    expect(
      (await call('manager', 'POST', `/${id}/amendments`, { amends: first!.id, mandate: mandate({ startsOn: '2027-01-01', amicableRateBp: 750 }) })).status,
    ).toBe(204);
    const { mandates } = await file(id);
    expect(mandates.map(({ startsOn, endsOn, amicableRateBp, state }) => ({ startsOn, endsOn, amicableRateBp, state }))).toEqual([
      { startsOn: '2027-01-01', endsOn: null, amicableRateBp: 750, state: 'TO_COME' },
      { startsOn: '2026-01-01', endsOn: '2026-12-31', amicableRateBp: 800, state: 'CURRENT' },
    ]);
    // The one that was read is no longer the last one.
    expect((await call('director', 'POST', `/${id}/amendments`, { amends: first!.id, mandate: mandate({ startsOn: '2028-01-01' }) })).status).toBe(409);
  });

  it('is amended once when two people do it at the same time', async () => {
    const id = await create();
    const [first] = (await file(id)).mandates;
    const amend = (startsOn: string) => call('director', 'POST', `/${id}/amendments`, { amends: first!.id, mandate: mandate({ startsOn }) });
    const answers = await Promise.all([amend('2027-01-01'), amend('2027-06-01')]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 409]);
  });

  it('is never amended before it starts', async () => {
    const id = await create();
    const [first] = (await file(id)).mandates;
    for (const startsOn of ['2025-12-31', '2026-01-01'])
      expect((await call('director', 'POST', `/${id}/amendments`, { amends: first!.id, mandate: mandate({ startsOn }) })).status).toBe(422);
  });

  it('never overlaps another one, and never changes, whatever is asked of PostgreSQL', async () => {
    const id = await create();
    const actor = { kind: 'staff', userId: test.s.director, role: 'DIRECTOR', delegations: [] } as const;
    const db = test.app.get(Database);
    await expect(db.run(actor, (tx) => tx.$executeRaw`UPDATE mandates SET amicable_rate_bp = 1 WHERE creditor_id = ${id}::uuid`)).rejects.toThrow();
    await expect(
      rows(
        `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
         VALUES ($1, '2026-06-01', 1, 1, 3, 0, false, 'NONE', false, 1, 'BUSINESS')`,
        [id],
      ),
    ).rejects.toThrow('mandates_single');
  });
});

describe('the account of the remittances', () => {
  it('is recorded for the Director, masked, encrypted, and noted without its value', async () => {
    const id = await create();
    expect((await call('manager', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account() })).status).toBe(204);
    const { bankAccount } = await file(id);
    expect(bankAccount).toMatchObject({ holder: 'Boulangeries Rivaud SAS', masked: 'GB82 •••• •••• 5432', bic: 'PSSTFRPPXXX', confirmed: null });
    const [stored] = await rows<{ iban_cipher: Buffer; on_behalf_of_id: string }>(
      'SELECT iban_cipher, on_behalf_of_id FROM creditor_bank_accounts WHERE creditor_id = $1',
      [id],
    );
    expect(stored!.on_behalf_of_id).toBe(test.s.director);
    expect(stored!.iban_cipher.toString('latin1')).not.toContain('WEST');
    const everywhere =
      JSON.stringify([await rows('SELECT * FROM audit_log'), await rows("SELECT encode(result, 'escape') FROM idempotency_keys")]) + test.logs.join('');
    expect(everywhere).not.toContain('WEST');
  });

  it('is out of reach of the manager without the delegation, of the officer and of the Developer', async () => {
    const id = await create();
    for (const as of ['managerAlone', 'officerA', 'developer'])
      expect((await call(as, 'POST', `/${id}/bank-accounts`, { replaces: null, account: account() })).status, as).toBe(403);
    await call('director', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account() });
    expect(await file(id, 'managerAlone')).toMatchObject({ bankAccess: 'NONE', bankAccount: null });
    const { bankAccount } = await file(id);
    for (const as of ['managerAlone', 'officerA', 'developer']) {
      expect((await call(as, 'POST', `/${id}/bank-accounts/${bankAccount!.id}/reveal`)).status, as).toBe(403);
      expect((await call(as, 'POST', `/${id}/bank-accounts/${bankAccount!.id}/confirm`, { confirmedWith: 'x' })).status, as).toBe(403);
    }
    // PostgreSQL itself.
    const db = test.app.get(Database);
    const manager = { kind: 'staff', userId: test.s.manager, role: 'COLLECTION_MANAGER', delegations: [] } as const;
    expect(await db.run(manager, (tx) => tx.$queryRaw`SELECT app.creditor_iban(${bankAccount!.id}::uuid) AS cipher`)).toEqual([{ cipher: null }]);
    await expect(
      db.run({ ...manager, userId: test.s.director, role: 'DIRECTOR' }, (tx) => tx.$queryRaw`SELECT iban_cipher FROM creditor_bank_accounts`),
    ).rejects.toThrow();
  });

  it('is shown whole on demand, noted each time, and never kept by the key of the request', async () => {
    const id = await create();
    await call('director', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account() });
    const { bankAccount } = await file(id);
    const path = `/staff/creditors/${id}/bank-accounts/${bankAccount!.id}/reveal`;
    const key = randomUUID();
    const reveal = () => test.call('POST', path, { as: 'manager', headers: { 'idempotency-key': key } });
    expect(await reveal()).toMatchObject({ status: 200, body: { iban: IBAN } });
    expect((await reveal()).status).toBe(409);
    expect((await actions(id)).filter((action) => action === 'CREDITOR_IBAN_SHOWN')).toHaveLength(1);
    // Of that creditor only.
    const other = await create();
    expect((await call('director', 'POST', `/${other}/bank-accounts/${bankAccount!.id}/reveal`)).status).toBe(404);
  });

  it('is never reopened, confirmed again nor in the name of someone else, by PostgreSQL itself', async () => {
    const id = await create();
    await call('director', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account() });
    const known = (await file(id)).bankAccount!.id;
    const database = new Database(test.database.url('app'));
    const manager = {
      kind: 'staff',
      userId: test.s.manager,
      role: 'COLLECTION_MANAGER',
      delegations: ['ADMINISTRATIVE'],
      actingFor: 'ADMINISTRATIVE',
    } as const;
    try {
      const run = (work: Parameters<typeof database.run>[1]) => expect(database.run(manager, work)).rejects.toThrow(/42501|history kept|policy/u);
      const confirm =
        (by: string): Parameters<typeof database.run>[1] =>
        (tx) =>
          tx.$executeRaw`UPDATE creditor_bank_accounts SET confirmed_by = ${by}::uuid, confirmed_at = now(), confirmed_with = 'x' WHERE id = ${known}::uuid`;
      await run(confirm(test.s.director));
      expect(await database.run(manager, confirm(test.s.manager))).toBe(1);
      await run(confirm(test.s.manager));
      await run((tx) => tx.$executeRaw`UPDATE creditor_bank_accounts SET valid_until = '2099-01-01' WHERE id = ${known}::uuid`);
      await database.run(manager, (tx) => tx.$executeRaw`UPDATE creditor_bank_accounts SET valid_until = now() WHERE id = ${known}::uuid`);
      await run((tx) => tx.$executeRaw`UPDATE creditor_bank_accounts SET valid_until = NULL WHERE id = ${known}::uuid`);
      // A mandate neither.
      await run(
        (
          tx,
        ) => tx.$executeRaw`INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario, created_by)
          VALUES (${id}::uuid, '2020-01-01', 800, 1200, 6, 500, true, 'NONE', true, 5, 'BUSINESS', ${test.s.director}::uuid)`,
      );
    } finally {
      await database.close();
    }
  });

  it('is replaced by the one that was confirmed, the former one staying in its history', async () => {
    const id = await create();
    await call('director', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account() });
    const before = (await file(id)).bankAccount!;
    expect((await call('director', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account(OTHER) })).status).toBe(409);
    expect((await call('director', 'POST', `/${id}/bank-accounts`, { replaces: before.id, account: account(OTHER, 'Élodie Rivaud') })).status).toBe(204);
    const after = (await file(id)).bankAccount!;
    expect(after).toMatchObject({ masked: 'DE89 •••• •••• 3000', confirmed: { with: 'Élodie Rivaud' } });
    expect(await rows('SELECT valid_until IS NULL AS current FROM creditor_bank_accounts WHERE creditor_id = $1 ORDER BY created_at', [id])).toEqual([
      { current: false },
      { current: true },
    ]);
    // Confirmed once, and only the one in force.
    expect((await call('director', 'POST', `/${id}/bank-accounts/${after.id}/confirm`, { confirmedWith: 'x' })).status).toBe(409);
    expect((await call('director', 'POST', `/${id}/bank-accounts/${before.id}/confirm`, { confirmedWith: 'x' })).status).toBe(409);
  });

  it('is replaced once when two people do it at the same time', async () => {
    const id = await create();
    const answers = await Promise.all(
      [IBAN, OTHER].map((iban) => call('director', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account(iban) })),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 409]);
  });

  it('is refused with a wrong IBAN, which is written nowhere', async () => {
    const id = await create();
    const answer = await call('director', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account('GB82 WEST 1234 5698 7654 33') });
    expect(answer.status).toBe(422);
    expect(JSON.stringify(answer.body) + test.logs.join('')).not.toContain('WEST');
  });
});
