import { creditorChoices, creditorDetail, creditorFile, creditorListItem, isValidSiren, type Delegation, type MandateForm } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startApp, type TestApp } from '../../../test/app';
import { databaseCode } from '../../platform/database/codes';
import { Database, type Transaction } from '../../platform/database/database';
import { dayOf } from '../../platform/format';
import { lateDays } from './late';
import { stateOf } from './mandates';

/** Example IBANs of the international standard, not real accounts. */
const IBAN = 'GB82 WEST 1234 5698 7654 32';
const OTHER = 'DE89 3704 0044 0532 0130 00';
let test: TestApp;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path = '', body?: unknown) =>
  test.call(method, `/staff/creditors${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
/** Valid numbers of companies that do not exist here. */
let drawn = 73_282_900;
const siren = (): string => {
  drawn += 1;
  return Array.from({ length: 10 }, (_, digit) => `${drawn}${digit}`).find((number) => isValidSiren(number))!;
};
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
const body = (some: object = {}) => ({ siren: siren(), identity, contacts, mandate: mandate(), ...some });
const create = async (some: object = {}) => {
  const answer = await call('director', 'POST', '', body(some));
  expect(answer.status).toBe(200);
  return (answer.body as { id: string }).id;
};
const file = async (id: string, as = 'director') => creditorFile.parse((await call(as, 'GET', `/${id}/file`)).body);
const account = (iban = IBAN) => ({ holder: 'Boulangeries Rivaud SAS', iban, bic: 'PSSTFRPPXXX' });
/** Two lines of one request may share their millisecond: then in the order they were written. */
const actions = async (id: string) =>
  (await rows<{ action: string }>('SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at, ctid', [id])).map((row) => row.action);

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
    ['less than 0 %', { mandate: mandate({ discountMaxBp: -1 }) }],
    ['an empty name', { identity: { ...identity, name: ' ' } }],
    ['a wrong telephone number', { contacts: [{ ...contacts[0], phone: '12' }] }],
    ['too many contacts', { contacts: Array.from({ length: 21 }, (_, index) => ({ ...contacts[0], isMain: index === 0 })) }],
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
  it('shows every role the same terms of the mandate, its opening fee and its interest included', async () => {
    const [made] = await rows<{ id: string }>(
      `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
       VALUES ($1, '2026-01-01', 800, 1200, 1500, 6, 500, true, 'ECB_PLUS_TEN', true, 5, 'BUSINESS') RETURNING id`,
      [test.s.creditorA],
    );
    try {
      const lines = async (as: string) => creditorDetail.parse((await call(as, 'GET', `/${test.s.creditorA}`)).body).mandateTerms.map((term) => term.label);
      expect(await lines('officerA')).toEqual(await lines('director'));
      expect(await lines('officerA')).toEqual(expect.arrayContaining(['Frais d’ouverture', 'Intérêts de retard']));
    } finally {
      await rows('DELETE FROM mandates WHERE id = $1', [made!.id]);
    }
  });

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

  it('that ended before its amendment is not extended by it', async () => {
    const id = await create({ mandate: mandate({ endsOn: '2026-06-30' }) });
    const [first] = (await file(id)).mandates;
    expect((await call('director', 'POST', `/${id}/amendments`, { amends: first!.id, mandate: mandate({ startsOn: '2027-01-01' }) })).status).toBe(204);
    expect((await file(id)).mandates.map(({ endsOn }) => endsOn)).toEqual([null, '2026-06-30']);
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
    expect((await call('director', 'POST', `/${id}/bank-accounts/${bankAccount!.id}/confirm`, { confirmedWith: ' ' })).status).toBe(422);
    const path = `/staff/creditors/${id}/bank-accounts/${bankAccount!.id}/reveal`;
    const key = randomUUID();
    const reveal = () => test.call('POST', path, { as: 'manager', headers: { 'idempotency-key': key } });
    expect(await reveal()).toMatchObject({ status: 200, body: { iban: IBAN } });
    expect((await reveal()).status).toBe(409);
    expect((await actions(id)).filter((action) => action === 'CREDITOR_IBAN_SHOWN')).toHaveLength(1);
    // Of that creditor only.
    const other = await create();
    expect((await call('director', 'POST', `/${other}/bank-accounts/${bankAccount!.id}/reveal`)).status).toBe(404);
    expect((await call('director', 'POST', `/${other}/bank-accounts/${bankAccount!.id}/confirm`, { confirmedWith: 'x' })).status).toBe(409);
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
      // Another one, said to be on behalf of someone else than the Director.
      const add =
        (behalf: string | null): Parameters<typeof database.run>[1] =>
        (tx) =>
          tx.$executeRaw`INSERT INTO creditor_bank_accounts (creditor_id, holder, iban_cipher, iban_masked, bic, created_by, on_behalf_of_id)
            VALUES (${id}::uuid, 'X', ${Buffer.from([0])}, 'GB82 •••• •••• 5432', 'PSSTFRPPXXX', ${test.s.manager}::uuid, ${behalf}::uuid)`;
      await run(add(test.s.officerA));
      await run(add(null));
      expect(await database.run(manager, add(test.s.director))).toBe(1);
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
    expect((await call('director', 'POST', `/${id}/bank-accounts`, { replaces: before.id, account: account(OTHER) })).status).toBe(204);
    const after = (await file(id)).bankAccount!;
    expect(after).toMatchObject({ masked: 'DE89 •••• •••• 3000', confirmed: null });
    expect((await call('manager', 'POST', `/${id}/bank-accounts/${after.id}/confirm`, { confirmedWith: 'Élodie Rivaud' })).status).toBe(204);
    expect((await file(id)).bankAccount).toMatchObject({ confirmed: { with: 'Élodie Rivaud' } });
    expect(await rows('SELECT valid_until IS NULL AS current FROM creditor_bank_accounts WHERE creditor_id = $1 ORDER BY created_at', [id])).toEqual([
      { current: false },
      { current: true },
    ]);
    // Confirmed once, and only the one in force.
    expect((await call('director', 'POST', `/${id}/bank-accounts/${after.id}/confirm`, { confirmedWith: 'x' })).status).toBe(409);
    expect((await call('director', 'POST', `/${id}/bank-accounts/${before.id}/confirm`, { confirmedWith: 'x' })).status).toBe(409);
  });

  it('is confirmed by someone other than whoever typed it (question 142), PostgreSQL too', async () => {
    const id = await create();
    // Typed by the manager on behalf of the Director: the Director in person may confirm it.
    await call('manager', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account() });
    const mine = await file(id, 'manager');
    expect(mine.bankAccount).toMatchObject({ confirmed: null, enteredBy: expect.any(String), enteredByMe: true });
    expect((await file(id)).bankAccount).toMatchObject({ enteredBy: mine.bankAccount!.enteredBy, enteredByMe: false });
    expect((await call('manager', 'POST', `/${id}/bank-accounts/${mine.bankAccount!.id}/confirm`, { confirmedWith: 'x' })).body).toEqual({ code: 'SAME_PERSON' });
    const database = new Database(test.database.url('app'));
    const manager = { kind: 'staff', userId: test.s.manager, role: 'COLLECTION_MANAGER', delegations: ['ADMINISTRATIVE'], actingFor: 'ADMINISTRATIVE' } as const;
    try {
      await expect(
        database.run(manager, (tx) =>
          tx.$executeRaw`UPDATE creditor_bank_accounts SET confirmed_by = ${test.s.manager}::uuid, confirmed_at = now(), confirmed_with = 'x' WHERE id = ${mine.bankAccount!.id}::uuid`,
        ),
      ).rejects.toThrow(/confirmed by its author/u);
    } finally {
      await database.close();
    }
    expect((await call('director', 'POST', `/${id}/bank-accounts/${mine.bankAccount!.id}/confirm`, { confirmedWith: 'Élodie Rivaud' })).status).toBe(204);
    expect(await rows('SELECT confirmed_by FROM creditor_bank_accounts WHERE creditor_id = $1', [id])).toEqual([{ confirmed_by: test.s.director }]);
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

describe('what is left out', () => {
  const own = async (some: object = {}) => {
    const id = await create(some);
    return {
      id,
      item: async () =>
        z
          .array(creditorListItem)
          .parse((await call('director', 'GET')).body)
          .find((one) => one.id === id),
    };
  };
  const day = (days: number) => new Date(Date.parse(`${dayOf(new Date())}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const newCase = async (creditorId: string, cents: number, paid: number, closed = false) => {
    const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'Débiteur fictif') RETURNING id");
    const [made] = await rows<{ id: string }>(
      "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status, closed_on) VALUES ('LGR-2026-' || (60000 + nextval('creditors_test')), $1, $2, $3, $4::case_status, CASE WHEN $5 THEN current_date END) RETURNING id",
      [creditorId, debtor!.id, test.s.officerA, closed ? 'SETTLED' : 'NEW', closed],
    );
    await rows(
      "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents, principal_paid_cents) VALUES ($1, $2, 'A', '2026-01-01', '2026-02-01', $3, $3, $4), ($1, $2, 'B', '2026-01-01', '2026-02-01', 100, 100, 100)",
      [made!.id, creditorId, cents, paid],
    );
    return made!.id;
  };
  beforeAll(() => rows('CREATE SEQUENCE creditors_test').then(() => undefined));

  it('is what was paid, and the cases that are closed', async () => {
    const { id, item } = await own();
    const opened = await newCase(id, 1000, 400);
    await newCase(id, 500, 500, true);
    expect(await item()).toMatchObject({ debtors: 2, invoices: 1, outstanding: 600 });
    const { portfolio } = creditorDetail.parse((await call('director', 'GET', `/${id}`)).body);
    expect(portfolio.map((one) => [one.id, one.amount, one.invoices.map((invoice) => invoice.number)])).toEqual([[opened, 600, ['A']]]);
    expect((await file(id)).openCases).toBe(1);
  });

  it('is a creditor that has left', async () => {
    const { id, item } = await own();
    expect(await item()).toBeDefined();
    await rows("UPDATE creditors SET status = 'ENDED' WHERE id = $1", [id]);
    expect(await item()).toBeUndefined();
  });

  it('is a colleague who has left', async () => {
    const id = await create();
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.officerB]);
    try {
      expect(creditorChoices.parse((await call('director', 'GET', '/choices')).body).managers.map((manager) => manager.id)).not.toContain(test.s.officerB);
      for (const managerId of [test.s.officerB, test.s.developer])
        expect(await call('director', 'PUT', `/${id}`, { version: 1, identity: { ...identity, managerId }, contacts })).toMatchObject({
          status: 422,
          body: { fields: ['identity.managerId'] },
        });
    } finally {
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [test.s.officerB]);
    }
  });

  it('is never the contacts of another creditor', async () => {
    const [left, right] = [await create(), await create()];
    expect((await call('director', 'PUT', `/${left}`, { version: 1, identity, contacts: [{ ...contacts[0]!, name: 'Marc Teyssier' }] })).status).toBe(204);
    expect((await file(right)).contacts).toEqual(contacts);
  });

  it.each([
    [day(-1), 'Aucun mandat actif', 'RENEWAL'],
    [day(0), 'Renouvellement', 'RENEWAL'],
    [day(59), 'Renouvellement', 'RENEWAL'],
    [day(61), 'Mandat actif', 'ACTIVE'],
  ])('is a mandate that ended, the day after its end: %s', async (endsOn, label, status) => {
    const { item } = await own({ mandate: mandate({ endsOn }) });
    const seen = await item();
    expect(seen).toMatchObject({ status });
    expect(seen!.statusLabel).toContain(label);
  });

  it('is a mandate that has not started, until its day', () => {
    const state = (startsOn: string, endsOn: string | null = null) => stateOf({ startsOn: new Date(startsOn), endsOn: endsOn ? new Date(endsOn) : null });
    expect([state(day(0)), state(day(1)), state(day(-2), day(-1)), state(day(-2), day(0))]).toEqual(['CURRENT', 'TO_COME', 'ENDED', 'CURRENT']);
    expect([lateDays(new Date('2026-11-25'), '2026-11-25'), lateDays(new Date('2026-11-24'), '2026-11-25'), lateDays(null, '2026-11-25')]).toEqual([
      null,
      1,
      null,
    ]);
  });

  it('is a commission that no mandate could hold', async () => {
    await rows("INSERT INTO settings (key, value, updated_by) VALUES ('firm.reversements.commission', '\"800 %\"', $1)", [test.s.director]);
    try {
      expect(creditorChoices.parse((await call('manager', 'GET', '/choices')).body).defaults.amicableRateBp).toBe(10_000);
    } finally {
      await rows("DELETE FROM settings WHERE key = 'firm.reversements.commission'");
    }
  });
});

describe('what is noted', () => {
  it('of a creditor, its mandate and its account, each time', async () => {
    const id = await create();
    await call('director', 'PUT', `/${id}`, { version: 1, identity, contacts });
    await call('director', 'POST', `/${id}/bank-accounts`, { replaces: null, account: account() });
    const before = (await file(id)).bankAccount!;
    await call('manager', 'POST', `/${id}/bank-accounts/${before.id}/confirm`, { confirmedWith: 'Élodie Rivaud' });
    await call('director', 'POST', `/${id}/bank-accounts`, { replaces: before.id, account: account(OTHER) });
    expect(await actions(id)).toEqual(['CREDITOR_CREATED', 'CREDITOR_CHANGED', 'CREDITOR_ACCOUNT_CHANGED', 'CREDITOR_ACCOUNT_CONFIRMED', 'CREDITOR_ACCOUNT_CHANGED']);
    const [first] = (await file(id)).mandates;
    await call('director', 'POST', `/${id}/amendments`, { amends: first!.id, mandate: mandate({ startsOn: '2027-01-01' }) });
    const [last] = (await file(id)).mandates;
    expect(await actions(last!.id)).toEqual(['MANDATE_AMENDED']);
    expect(await rows('SELECT amends_id FROM mandates WHERE id = $1', [last!.id])).toEqual([{ amends_id: first!.id }]);
  });
});

describe('PostgreSQL itself', () => {
  type Work = (tx: Transaction) => Promise<unknown>;
  const ROLES = {
    director: 'DIRECTOR',
    manager: 'COLLECTION_MANAGER',
    officerA: 'CLAIMS_OFFICER',
    officerB: 'CLAIMS_OFFICER',
    developer: 'DEVELOPER',
  } as const;
  /** What it answers: the lines that are seen or changed, or the code of its refusal. */
  const answer = (as: keyof typeof ROLES, work: Work, actingFor?: Delegation) =>
    test.pool
      .run({ kind: 'staff', userId: test.s[as], role: ROLES[as], delegations: [], ...(actingFor ? { actingFor } : {}) }, work)
      .catch((error: unknown) => databaseCode(error) ?? String(error));
  const terms = { ...mandate(), startsOn: new Date('2026-01-01'), endsOn: null };
  let creditorId: string;
  beforeAll(async () => {
    creditorId = test.s.creditorA;
    await rows('DELETE FROM creditor_contacts WHERE creditor_id = $1', [creditorId]);
    await rows("INSERT INTO creditor_contacts (creditor_id, name, email, is_main) VALUES ($1, 'X', 'x@exemple.test', true)", [creditorId]);
    await rows(
      `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
       VALUES ($1, '2026-01-01', 1, 1, 3, 0, false, 'NONE', false, 1, 'BUSINESS')`,
      [creditorId],
    );
    await rows(
      "INSERT INTO creditor_bank_accounts (creditor_id, holder, iban_cipher, iban_masked, bic, created_by) VALUES ($1, 'x', '\\x00', 'GB82 •••• •••• 5432', 'PSSTFRPPXXX', $2)",
      [creditorId, test.s.director],
    );
  });

  it('lets an officer read the creditor of their cases, and change nothing of it', async () => {
    const of = { creditorId };
    const reads: Work[] = [(tx) => tx.mandate.count({ where: of }), (tx) => tx.creditorContact.count({ where: of })];
    for (const work of reads) {
      expect(await answer('officerA', work)).toBe(1);
      for (const as of ['officerB', 'developer'] as const) expect(await answer(as, work), as).toBe(0);
    }
    const changes: Work[] = [
      (tx) => tx.creditor.updateMany({ where: { id: creditorId }, data: { city: 'X' } }),
      (tx) => tx.mandate.updateMany({ where: of, data: { endsOn: new Date('2026-12-31') } }),
      (tx) => tx.creditorContact.deleteMany({ where: of }),
    ];
    const additions: Work[] = [
      (tx) => tx.creditor.create({ data: { name: 'X' }, select: { id: true } }),
      (tx) => tx.mandate.create({ data: { ...terms, ...of, startsOn: new Date('2099-01-01') }, select: { id: true } }),
      (tx) => tx.creditorContact.create({ data: { ...of, name: 'Y', email: 'y@exemple.test' }, select: { id: true } }),
    ];
    for (const as of ['officerA', 'developer'] as const) {
      for (const work of changes) expect(await answer(as, work), as).toEqual({ count: 0 });
      for (const work of additions) expect(await answer(as, work), as).toBe('42501');
    }
  });

  it('keeps the account of the remittances for the Director, and for their delegate in their name', async () => {
    const add =
      (by: string, confirmedBy: string | null = null, behalf: string | null = null): Work =>
      (tx) =>
        tx.$executeRaw`INSERT INTO creditor_bank_accounts (id, creditor_id, holder, iban_cipher, iban_masked, bic, confirmed_by, confirmed_at, confirmed_with, created_by, on_behalf_of_id)
          VALUES (${randomUUID()}::uuid, ${test.s.creditorB}::uuid, 'x', ${Buffer.from('x')}, 'GB82 •••• •••• 5432', 'PSSTFRPPXXX', ${confirmedBy}::uuid,
            ${confirmedBy ? new Date() : null}::timestamptz, ${confirmedBy ? 'x' : null}, ${by}::uuid, ${behalf}::uuid)`;
    const close: Work = (tx) => tx.creditorBankAccount.updateMany({ where: { creditorId }, data: { validUntil: new Date() } });
    const { director, manager, officerA } = test.s;
    for (const [as, by] of [
      ['manager', manager],
      ['officerA', officerA],
    ] as const) {
      expect(await answer(as, add(by)), as).toBe('42501');
      expect(await answer(as, close), as).toEqual({ count: 0 });
    }
    // In one's own name, the telephone call too.
    expect(await answer('director', add(officerA))).toBe('42501');
    expect(await answer('director', add(director, officerA))).toBe('42501');
    expect(await answer('manager', add(director), 'ADMINISTRATIVE')).toBe('42501');
    // On behalf of the Director, and of nobody else.
    expect(await answer('manager', add(manager, manager), 'ADMINISTRATIVE')).toBe('42501');
    expect(await answer('manager', add(manager, manager, officerA), 'ADMINISTRATIVE')).toBe('42501');
    expect(await answer('director', add(director, null, manager))).toBe('42501');
    // Never confirmed as it is typed: someone else makes the call (question 142).
    expect(await answer('manager', add(manager, manager, director), 'ADMINISTRATIVE')).toBe('42501');
    expect(await answer('manager', add(manager, null, director), 'ADMINISTRATIVE')).toBe(1);
    const seen: Work = (tx) => tx.creditorBankAccount.count({ where: { creditorId } });
    for (const [as, count] of [
      ['director', 1],
      ['manager', 1],
      ['officerA', 0],
      ['developer', 0],
    ] as const)
      expect(await answer(as, seen), as).toBe(count);
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'ADMINISTRATIVE' AND withdrawn_at IS NULL");
    try {
      expect(await answer('manager', seen)).toBe(0);
    } finally {
      await rows("INSERT INTO delegations (kind, granted_by) VALUES ('ADMINISTRATIVE', $1)", [director]);
    }
  });

  const MANDATE = `INSERT INTO mandates (creditor_id, starts_on, ends_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, contract_rate_bp, fixed_indemnity, reporting_day, scenario, amends_id)`;
  const ACCOUNT = 'INSERT INTO creditor_bank_accounts (creditor_id, holder, iban_cipher, iban_masked, bic, created_by, confirmed_by)';
  it.each([
    [
      'an end before its start',
      `${MANDATE} VALUES ($1, '2030-01-01', '2029-12-31', 1, 1, 3, 0, false, 'NONE', NULL, false, 1, 'BUSINESS', NULL)`,
      'mandates_dates',
    ],
    [
      'a contract without its rate',
      `${MANDATE} VALUES ($1, '2030-01-01', NULL, 1, 1, 3, 0, false, 'CONTRACT', NULL, false, 1, 'BUSINESS', NULL)`,
      'mandates_contract_rate',
    ],
    [
      'a rate without a contract',
      `${MANDATE} VALUES ($1, '2030-01-01', NULL, 1, 1, 3, 0, false, 'NONE', 500, false, 1, 'BUSINESS', NULL)`,
      'mandates_contract_rate',
    ],
    [
      'the amendment of another creditor',
      `${MANDATE} SELECT $1, '2030-01-01', NULL, 1, 1, 3, 0, false, 'NONE', NULL, false, 1, 'BUSINESS', id FROM mandates WHERE creditor_id <> $1 LIMIT 1`,
      'mandates_amends_id_creditor_id_fkey',
    ],
    [
      'an account that is not masked',
      `${ACCOUNT} SELECT $1, 'x', '\\x00', 'GB82WEST12345698765432', 'PSSTFRPPXXX', manager.id, NULL FROM users manager LIMIT 1`,
      'iban_masked_check',
    ],
    [
      'a call without its day',
      `${ACCOUNT} SELECT $1, 'x', '\\x00', 'GB82 •••• •••• 5432', 'PSSTFRPPXXX', manager.id, manager.id FROM users manager LIMIT 1`,
      'creditor_bank_accounts_confirmed',
    ],
    [
      'two accounts in force',
      `${ACCOUNT} SELECT $1, 'x', '\\x00', 'GB82 •••• •••• 5432', 'PSSTFRPPXXX', u.id, NULL FROM users u LIMIT 2`,
      'creditor_bank_accounts_current',
    ],
    [
      'two main contacts',
      "INSERT INTO creditor_contacts (creditor_id, name, email, is_main) VALUES ($1, 'X', 'x@exemple.test', true), ($1, 'Y', 'y@exemple.test', true)",
      'creditor_contacts_main',
    ],
  ])('holds no such line: %s', async (_what, statement, constraint) => {
    const [own] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Nouveau') RETURNING id");
    await expect(rows(statement, [own!.id])).rejects.toThrow(constraint);
  });
});
