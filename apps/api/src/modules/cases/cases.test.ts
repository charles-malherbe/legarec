import { caseCheckResult, caseChoices, caseDetail, caseList, isValidSiren, type CaseInvoice, type NewCase } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { Database } from '../../platform/database/database';

let test: TestApp;
let creditor: { id: string; mandate: string };
let other: { id: string; mandate: string };
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path = '', body?: unknown) =>
  test.call(method, `/staff/cases${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const withMandate = async (id: string, startsOn = '2026-01-01') =>
  (
    await rows<{ id: string }>(
      `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
       VALUES ($1, $2, 800, 1200, 6, 500, true, 'NONE', true, 5, 'BUSINESS') RETURNING id`,
      [id, startsOn],
    )
  )[0]!.id;
const newCreditor = async (name: string) => (await rows<{ id: string }>('INSERT INTO creditors (name) VALUES ($1) RETURNING id', [name]))[0]!.id;
/** Valid numbers of companies that do not exist here. */
let drawn = 73_282_900;
const siren = (): string => {
  drawn += 1;
  return Array.from({ length: 10 }, (_, digit) => `${drawn}${digit}`).find((number) => isValidSiren(number))!;
};
let invoiceNumber = 0;
const invoice = (some: Partial<CaseInvoice> = {}): CaseInvoice => ({
  number: `F-${(invoiceNumber += 1)}`,
  externalRef: '',
  issuedOn: '2026-08-28',
  dueOn: '2026-09-27',
  amount: 486_000,
  left: 486_000,
  ...some,
});
const opening = (some: Partial<NewCase> = {}): NewCase => {
  const invoices = some.invoices ?? [invoice()];
  return {
    creditorId: creditor.id,
    mandateId: creditor.mandate,
    externalReference: 'CLI-1',
    kind: 'COMPANY',
    number: siren(),
    name: 'Menuiserie Arnal',
    nameConfirmed: true,
    legalForm: '5499',
    address: '18 chemin des Scieurs',
    postalCode: '38500',
    city: 'Voiron',
    contactName: 'Gilles Arnal',
    contactTitle: 'Gérant',
    contacts: [
      { kind: 'PHONE', label: 'Standard', value: '04 76 00 00 21', primary: true },
      { kind: 'EMAIL', label: 'Comptabilité', value: 'Compta@exemple.test', primary: true },
    ],
    invoices,
    scenario: 'BUSINESS',
    toMe: true,
    expected: { principal: invoices.reduce((total, item) => total + item.left, 0), invoices: invoices.length },
    ...some,
  };
};
const open = async (as: string, some: Partial<NewCase> = {}) => {
  const answer = await call(as, 'POST', '', opening(some));
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body as { id: string; reference: string };
};
const detail = async (as: string, id: string) => caseDetail.parse((await call(as, 'GET', `/${id}`)).body);
const search = async (as: string, query = '', filters = '?creditor=all&status=all&officer=all') =>
  caseList.parse((await call(as, 'POST', `/search${filters}`, { query })).body);
const ids = async (as: string, query = '', filters?: string) => (await search(as, query, filters)).items.map((item) => item.id);
const officerOf = async (id: string) => (await rows<{ officer_id: string | null }>('SELECT officer_id FROM cases WHERE id = $1', [id]))[0]!.officer_id;

beforeAll(async () => {
  test = await startApp();
  const a = await newCreditor('Matériaux Delta');
  const b = await newCreditor('Énergies Rhône');
  // Beyond the references of the test set.
  await rows("INSERT INTO number_sequences (kind, year, last_value) VALUES ('CASE', extract(year FROM now() AT TIME ZONE 'Europe/Paris')::int, 1000)");
  creditor = { id: a, mandate: await withMandate(a) };
  other = { id: b, mandate: await withMandate(b) };
});
afterAll(() => test.stop());

describe('opening a case', () => {
  it('records the debtor, the invoices and the coordinates, under the mandate of the day', async () => {
    const { id, reference } = await open('manager', { toMe: true, number: '512 334 871 00088' });
    expect(reference).toMatch(/^LGR-\d{4}-\d{5}$/u);
    const seen = await detail('manager', id);
    expect(seen).toMatchObject({
      name: 'Menuiserie Arnal',
      identifier: 'SIRET 512 334 871 00088',
      creditorRef: 'CLI-1',
      status: 'NEW',
      statusLabel: 'Nouveau',
      principal: 486_000,
      fees: 4000,
      officer: 'Remi Test',
      canAct: true,
      firstLetter: null,
      nextAction: 'Envoyer le premier courrier',
      mainContact: {
        name: 'Gilles Arnal',
        title: 'Gérant',
        phone: '04 76 00 00 21',
        email: 'Compta@exemple.test',
        address: '18 chemin des Scieurs, 38500 Voiron',
      },
    });
    // From the creditor: nothing of it is verified, so that no code of access leaves for it.
    expect(seen.contacts.map((contact) => contact.verified)).toEqual([false, false]);
    expect(seen.history.map((entry) => [entry.title, entry.actor])).toEqual([['Dossier ouvert', 'Remi Test']]);
    expect(seen.mandate.terms[0]).toEqual({ label: 'Honoraires amiable', value: '8 % HT du recouvré' });
    expect(await rows('SELECT mandate_id, created_by FROM cases WHERE id = $1', [id])).toEqual([{ mandate_id: creditor.mandate, created_by: test.s.manager }]);
    expect(await rows('SELECT action FROM audit_log WHERE entity_id = $1', [id])).toEqual([{ action: 'CASE_OPENED' }]);
    expect(JSON.stringify(await rows('SELECT * FROM audit_log')) + test.logs.join('')).not.toMatch(/Arnal|51233487/u);
  });

  it('keeps its mandate after an amendment', async () => {
    const own = await newCreditor('Médiatel');
    const mandate = await withMandate(own, '2025-01-01');
    const { id } = await open('manager', { creditorId: own, mandateId: mandate });
    await rows('UPDATE mandates SET ends_on = current_date - 1 WHERE id = $1', [mandate]);
    const next = await withMandate(own, new Date().toISOString().slice(0, 10));
    await rows('UPDATE mandates SET amicable_rate_bp = 500 WHERE id = $1', [next]);
    expect((await detail('manager', id)).mandate.terms[0]!.value).toBe('8 % HT du recouvré');
  });

  it('belongs to whoever opens it, or to nobody, never to someone else', async () => {
    expect(await officerOf((await open('manager', { toMe: true })).id)).toBe(test.s.manager);
    expect(await officerOf((await open('managerAlone', { toMe: false })).id)).toBeNull();
    expect(await officerOf((await open('director', { toMe: true })).id)).toBe(test.s.director);
    expect(await officerOf((await open('director', { toMe: false })).id)).toBeNull();
    const db = test.app.get(Database);
    const manager = { kind: 'staff', userId: test.s.manager, role: 'COLLECTION_MANAGER', delegations: [] } as const;
    const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'X') RETURNING id");
    await expect(
      db.run(
        manager,
        (tx) =>
          tx.$executeRaw`INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, created_by) VALUES ('LGR-2026-99999', ${creditor.id}::uuid, ${debtor!.id}::uuid, ${test.s.officerA}::uuid, ${test.s.manager}::uuid)`,
      ),
    ).rejects.toThrow();
  });

  it.each(['officerA', 'developer', 'liar'])('is refused to %s, and nothing of it stays', async (as) => {
    const before = await rows('SELECT count(*) FROM debtors');
    expect((await call(as, 'POST', '', opening())).status).toBe(as === 'liar' ? 404 : 403);
    expect(await rows('SELECT count(*) FROM debtors')).toEqual(before);
    expect((await call(as, 'POST', '/check', { creditorId: creditor.id, number: siren() })).status).toBe(as === 'liar' ? 404 : 403);
  });

  it.each<[string, () => Partial<NewCase>]>([
    ['a wrong number', () => ({ number: '123 456 789' })],
    ['an individual with a number', () => ({ kind: 'INDIVIDUAL', legalForm: '' })],
    ['a name that nobody confirmed', () => ({ nameConfirmed: false as never })],
    ['no invoice', () => ({ invoices: [], expected: { principal: 0, invoices: 0 } })],
    ['the same invoice twice', () => ({ invoices: [invoice({ number: 'F-X' }), invoice({ number: 'f-x' })] })],
    ['a due date before its issue', () => ({ invoices: [invoice({ dueOn: '2026-08-01' })] })],
    ['more left than claimed', () => ({ invoices: [invoice({ left: 486_001 })] })],
    ['another total than the one that was confirmed', () => ({ expected: { principal: 1, invoices: 1 } })],
    ['a wrong telephone number', () => ({ contacts: [{ kind: 'PHONE' as const, label: 'x', value: '12', primary: true }] })],
    [
      'two main numbers',
      () => ({ contacts: ['04 76 00 00 21', '04 76 00 00 22'].map((value) => ({ kind: 'PHONE' as const, label: 'x', value, primary: true })) }),
    ],
  ])('is refused with %s', async (_what, some) => {
    const before = await rows('SELECT count(*) FROM cases');
    expect((await call('manager', 'POST', '', opening(some()))).status).toBe(422);
    expect(await rows('SELECT count(*) FROM cases')).toEqual(before);
  });

  it('needs a mandate in force, the one that was shown', async () => {
    const none = await newCreditor('Sans mandat');
    expect(await call('manager', 'POST', '', opening({ creditorId: none }))).toMatchObject({ status: 409, body: { code: 'NO_MANDATE' } });
    const future = await withMandate(none, '2099-01-01');
    expect(await call('manager', 'POST', '', opening({ creditorId: none, mandateId: future }))).toMatchObject({ status: 409, body: { code: 'NO_MANDATE' } });
    expect(await call('manager', 'POST', '', opening({ mandateId: other.mandate }))).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    expect((await call('manager', 'POST', '', opening({ creditorId: randomUUID() }))).status).toBe(404);
    expect(caseCheckResult.parse((await call('manager', 'POST', '/check', { creditorId: none, number: '' })).body)).toMatchObject({
      mandate: null,
      startsOn: '2099-01-01',
    });
  });

  it('is done once for a creditor and a debtor, even at the same time and for someone who does not see the other case', async () => {
    const number = siren();
    const answers = await Promise.all(['director', 'manager', 'manager'].map((as) => call(as, 'POST', '', opening({ number, toMe: as === 'director' }))));
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409]);
    const hidden = siren();
    await open('director', { number: hidden, toMe: true });
    // The manager does not see the cases of the Director, and is told of nothing but the refusal.
    expect(caseCheckResult.parse((await call('manager', 'POST', '/check', { creditorId: creditor.id, number: hidden })).body)).toMatchObject({
      open: null,
      others: [],
    });
    const refused = await call('manager', 'POST', '', opening({ number: hidden }));
    expect(refused).toMatchObject({ status: 409 });
    expect(refused.body).toEqual({ code: 'CASE_EXISTS' });
  });

  it('gives a number without any gap, even at the same time', async () => {
    const opened = await Promise.all(Array.from({ length: 4 }, () => open('manager')));
    const numbers = opened.map(({ reference }) => Number(reference.slice(-5))).sort((a, b) => a - b);
    expect(numbers.at(-1)! - numbers[0]!).toBe(3);
    expect(new Set(numbers).size).toBe(4);
  });
});

describe('the same debtor', () => {
  it('is one for two creditors, under the name that was recorded first, with nothing else in common', async () => {
    const number = siren();
    const first = await open('manager', { number, name: 'Bâtiplus SAS' });
    const second = await open('manager', { creditorId: other.id, mandateId: other.mandate, number: `${number}`, name: 'BATIPLUS', contacts: [] });
    const debtors = await rows<{ debtor_id: string }>('SELECT DISTINCT debtor_id FROM cases WHERE id = ANY ($1::uuid[])', [[first.id, second.id]]);
    expect(debtors).toHaveLength(1);
    const seen = await detail('manager', second.id);
    expect(seen.name).toBe('Bâtiplus SAS');
    expect(seen.contacts).toEqual([]);
    expect(seen.otherClaims).toEqual([{ creditor: 'Matériaux Delta', invoices: 1, amount: 486_000 }]);
    expect(caseCheckResult.parse((await call('manager', 'POST', '/check', { creditorId: creditor.id, number })).body)).toMatchObject({
      open: { id: first.id, reference: first.reference, officer: 'Remi Test', canAct: true },
      others: [{ creditor: 'Énergies Rhône', invoices: 1 }],
    });
  });

  it('is opened once by two people at the same time, for two creditors', async () => {
    const number = siren();
    await Promise.all([open('manager', { number }), open('director', { creditorId: other.id, mandateId: other.mandate, number })]);
    expect(await rows('SELECT count(*)::int AS n FROM debtors WHERE siren = $1', [number])).toEqual([{ n: 1 }]);
  });

  it('is never the same when it is an individual', async () => {
    const individual = { kind: 'INDIVIDUAL' as const, number: '', legalForm: '', name: 'Julie Mercier', contacts: [] };
    const [first, second] = [await open('manager', individual), await open('manager', individual)];
    expect(await rows('SELECT count(DISTINCT debtor_id)::int AS n FROM cases WHERE id = ANY ($1::uuid[])', [[first.id, second.id]])).toEqual([{ n: 2 }]);
    // Neither 40 € nor a score.
    expect(await detail('manager', first.id)).toMatchObject({ fees: 0, risk: null, identifier: 'Particulier', isIndividual: true });
  });
});

describe('what is owed', () => {
  it('counts what is late from the oldest invoice, and no 40 € before the due date', async () => {
    const late = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const { id } = await open('manager', {
      invoices: [
        invoice({ issuedOn: late(90), dueOn: late(40), amount: 1000, left: 400 }),
        invoice({ issuedOn: late(10), dueOn: late(-10), amount: 500, left: 500 }),
      ],
    });
    expect(await detail('manager', id)).toMatchObject({ principal: 900, fees: 4000, daysLate: 40, invoicesLabel: '2 factures' });
  });

  it('is not raised by 40 € when the mandate does not claim it', async () => {
    const own = await newCreditor('Sans indemnité');
    const mandate = await withMandate(own);
    await rows('UPDATE mandates SET fixed_indemnity = false WHERE id = $1', [mandate]);
    const { id } = await open('manager', { creditorId: own, mandateId: mandate });
    expect((await detail('manager', id)).fees).toBe(0);
  });

  it('grows with the invoices that are added, for the version that was read', async () => {
    const { id } = await open('manager');
    const more = (version: number, some = invoice()) => ({ version, invoices: [some], expected: { principal: some.left, invoices: 1 } });
    expect((await call('manager', 'POST', `/${id}/invoices`, more(1))).status).toBe(204);
    expect(await call('manager', 'POST', `/${id}/invoices`, more(1))).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    expect((await detail('manager', id)).principal).toBe(972_000);
    const [known] = (await detail('manager', id)).invoices;
    expect(await call('manager', 'POST', `/${id}/invoices`, more(2, invoice({ number: known!.number.toLowerCase() })))).toMatchObject({
      status: 409,
      body: { code: 'INVOICE_EXISTS' },
    });
    // The Director reads it, and adds nothing to it; an officer has no right to it.
    expect((await call('director', 'POST', `/${id}/invoices`, more(2))).status).toBe(403);
    expect((await call('officerA', 'POST', `/${id}/invoices`, more(2))).status).toBe(403);
    await rows("UPDATE cases SET status = 'SETTLED', closed_on = current_date WHERE id = $1", [id]);
    expect(await call('manager', 'POST', `/${id}/invoices`, more(2))).toMatchObject({ status: 409, body: { code: 'CASE_CLOSED' } });
  });
});

describe('who reads what', () => {
  it('follows the role: the Director all, the manager those of the team and of nobody, an officer theirs, the Developer none', async () => {
    const { s } = test;
    expect(await ids('director')).toEqual(expect.arrayContaining(Object.values(s.cases)));
    const manager = await ids('manager');
    expect(manager).toEqual(expect.arrayContaining([s.cases.ofA, s.cases.ofB, s.cases.unassigned]));
    expect(manager).not.toContain(s.cases.ofDirector);
    expect(await ids('officerA')).toEqual([s.cases.ofA]);
    expect(await ids('liar')).toEqual([s.cases.ofA]);
    expect((await call('developer', 'POST', '/search', { query: '' })).status).toBe(403);
    for (const [as, id, status] of [
      ['manager', s.cases.ofDirector, 404],
      ['officerA', s.cases.ofB, 404],
      ['officerA', s.cases.ofA, 200],
      ['developer', s.cases.ofA, 403],
      ['director', s.cases.ofB, 200],
    ] as const)
      expect((await call(as, 'GET', `/${id}`)).status, `${as} ${id}`).toBe(status);
  });

  it('never shows an officer anything of another one, in a search either', async () => {
    const { items, counts, stats } = await search('officerA');
    expect(JSON.stringify([items, counts, stats])).not.toContain('BETA-MARK');
    expect(counts.all).toBe(1);
    expect(await ids('officerA', 'BETA')).toEqual([]);
    // The same debtor, for another creditor.
    expect((await detail('officerA', test.s.cases.ofA)).otherClaims).toEqual([]);
  });

  it('notes once an hour that the Director read a case of someone else, and not their own', async () => {
    const { id } = await open('manager');
    for (let i = 0; i < 3; i += 1) await detail('director', id);
    expect((await detail('manager', id)).history.filter((entry) => entry.title === 'Dossier consulté')).toHaveLength(1);
    const own = await open('director');
    await detail('director', own.id);
    expect((await detail('director', own.id)).history.map((entry) => entry.title)).toEqual(['Dossier ouvert']);
    expect(await detail('director', id)).toMatchObject({ canAct: false });
  });

  it('finds by name without its accents, by reference, number of the company, invoice or creditor', async () => {
    const number = siren();
    const { id, reference } = await open('manager', { name: 'Hôtel Lagarde', number, invoices: [invoice({ number: 'ZZ-7781' })] });
    for (const query of ['hotel lag', reference, number, `${number.slice(0, 3)} ${number.slice(3, 6)}`, 'zz-778'])
      expect(await ids('manager', query), query).toContain(id);
    expect(await ids('manager', 'materiaux')).toContain(id);
    // Nothing of a query is a pattern.
    for (const query of ['%', '_', '\\', "'; DROP TABLE cases; --"]) expect(await ids('manager', query), query).not.toContain(id);
  });

  it('narrows by creditor, status, officer and age', async () => {
    const own = await newCreditor('Filtre');
    const mandate = await withMandate(own);
    const day = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const of = (days: number, some: Partial<NewCase> = {}) =>
      open('manager', { creditorId: own, mandateId: mandate, invoices: [invoice({ issuedOn: day(200), dueOn: day(days) })], ...some });
    const [recent, old, unassigned] = [await of(10), await of(120), await of(40, { toMe: false })];
    const filtered = (filters: string) => ids('manager', '', `?creditor=${own}&${filters}`);
    expect(await filtered('age=0-30')).toEqual([recent.id]);
    expect(await filtered('age=90%2B')).toEqual([old.id]);
    expect(await filtered('status=unassigned')).toEqual([unassigned.id]);
    expect((await filtered(`officer=${test.s.manager}`)).sort()).toEqual([recent.id, old.id].sort());
    const { counts, stats } = await search('manager', '', `?creditor=${own}`);
    expect(counts).toMatchObject({ all: 3, unassigned: 1, settled: 0 });
    expect(stats).toMatchObject({ outstanding: 3 * 486_000, invoices: 3, overdue: 3, overdueAmount: 486_000, targetRatio: null });
    expect((await call('manager', 'POST', '/search?creditor=x', { query: '' })).status).toBe(404);
  });

  it('gives the form its choices', async () => {
    const choices = caseChoices.parse((await call('manager', 'GET', '/choices')).body);
    expect(choices.mayAssign).toBe(true);
    expect(choices.officers.map((officer) => officer.name)).not.toContain('Devon Test');
    expect(caseChoices.parse((await call('managerAlone', 'GET', '/choices')).body).mayAssign).toBe(false);
  });
});

describe('giving a case', () => {
  it('is the right of the Director, or of the manager on their behalf, and is written in its history', async () => {
    const { id } = await open('manager', { toMe: false });
    for (const as of ['managerAlone', 'officerA', 'developer'])
      expect((await call(as, 'POST', '/assign', { ids: [id], officerId: test.s.officerA })).status, as).toBe(403);
    expect((await call('manager', 'POST', '/assign', { ids: [id], officerId: test.s.officerA })).status).toBe(204);
    expect(await officerOf(id)).toBe(test.s.officerA);
    expect((await detail('manager', id)).history[0]).toMatchObject({ title: 'Dossier attribué', actor: 'Remi Test', onBehalfOf: 'Dora Test' });
    expect(await ids('officerA')).toContain(id);
    expect((await call('director', 'POST', '/assign', { ids: [id], officerId: test.s.officerB })).status).toBe(204);
    expect(await ids('officerA')).not.toContain(id);
  });

  it('never goes to whoever handles no case, nor touches one that is not seen', async () => {
    const { id } = await open('manager');
    for (const officerId of [test.s.developer, test.s.partnerA, randomUUID()])
      expect(await call('director', 'POST', '/assign', { ids: [id], officerId })).toMatchObject({ status: 422, body: { code: 'INVALID_OFFICER' } });
    const before = await officerOf(test.s.cases.ofDirector);
    expect((await call('manager', 'POST', '/assign', { ids: [id, test.s.cases.ofDirector], officerId: test.s.officerA })).status).toBe(403);
    expect(await officerOf(test.s.cases.ofDirector)).toBe(before);
    expect(await officerOf(id)).toBe(test.s.manager);
  });
});

describe('the coordinates', () => {
  const phone = (value: string, some: object = {}) => ({ kind: 'PHONE', label: 'Mobile', value, primary: false, replaces: null, source: 'CALL', ...some });
  const stored = (id: string) =>
    rows<{ id: string; value: string; status: string; is_primary: boolean; replaced_by_id: string | null }>(
      "SELECT id, value, status, is_primary, replaced_by_id FROM case_contacts WHERE case_id = $1 AND kind = 'PHONE' ORDER BY created_at",
      [id],
    );
  const add = (as: string, id: string, body: object) => call(as, 'POST', `/${id}/coordinates`, body);

  it('are added, replaced and made the main one, each noted without its value', async () => {
    const { id } = await open('manager');
    expect((await add('manager', id, phone('+33 6 12 00 00 34', { primary: true }))).status).toBe(204);
    const [first, second] = await stored(id);
    expect([first!.is_primary, second!.is_primary]).toEqual([false, true]);
    expect(second).toMatchObject({ value: '06 12 00 00 34', status: 'NEW' });
    expect((await add('manager', id, phone('04 76 00 00 99', { replaces: first!.id }))).status).toBe(204);
    const all = await stored(id);
    expect(all[0]).toMatchObject({ status: 'INVALID', is_primary: false, replaced_by_id: all[2]!.id });
    expect(await rows('SELECT what FROM case_contact_events WHERE case_id = $1 ORDER BY occurred_at', [id])).toEqual(
      ['ADDED', 'ADDED', 'ADDED', 'ADDED', 'REPLACED'].map((what) => ({ what })),
    );
    expect((await detail('manager', id)).contacts.map((contact) => contact.value)).not.toContain('04 76 00 00 21');
    expect(JSON.stringify([await rows('SELECT * FROM audit_log'), await rows('SELECT title, detail FROM case_events')]) + test.logs.join('')).not.toMatch(
      /06 12 00|04 76 00/u,
    );
  });

  it('are refused twice, written in another way too, and at the same time', async () => {
    const { id } = await open('manager');
    expect(await add('manager', id, phone('+33 4 76 00 00 21'))).toMatchObject({ status: 409, body: { code: 'COORDINATE_EXISTS' } });
    const answers = await Promise.all(['06 00 00 00 01', '06 00 00 00 02'].map((value) => add('manager', id, phone(value, { primary: true }))));
    expect(answers.map((answer) => answer.status)).toEqual([204, 204]);
    expect((await stored(id)).filter((contact) => contact.is_primary)).toHaveLength(1);
    expect((await add('manager', id, phone('12'))).status).toBe(422);
    expect((await add('manager', id, phone('06 00 00 00 03', { replaces: randomUUID() }))).status).toBe(409);
  });

  it('are verified or set aside by whoever acts on the case, the main one included', async () => {
    const { id } = await open('manager');
    const [contact] = await stored(id);
    const change = (as: string, body: object, of = contact!.id) => call(as, 'PUT', `/${id}/coordinates/${of}`, body);
    expect((await change('manager', { status: 'VERIFIED' })).status).toBe(204);
    expect((await detail('manager', id)).contacts.find((item) => item.id === contact!.id)!.verified).toBe(true);
    expect((await change('manager', { status: 'INVALID' })).status).toBe(204);
    expect((await stored(id))[0]).toMatchObject({ status: 'INVALID', is_primary: false });
    expect((await change('manager', { status: 'INVALID', primary: true })).status).toBe(422);
    for (const [as, status] of [
      ['director', 403],
      ['officerA', 404],
      ['developer', 403],
    ] as const)
      expect((await change(as, { status: 'VERIFIED' })).status, as).toBe(status);
    // Of another case.
    const elsewhere = await open('manager');
    expect((await call('manager', 'PUT', `/${elsewhere.id}/coordinates/${contact!.id}`, { status: 'VERIFIED' })).status).toBe(404);
    expect((await add('director', id, phone('06 00 00 00 09'))).status).toBe(403);
  });

  it('are read neither by the creditor nor by the debtor', async () => {
    const db = test.app.get(Database);
    for (const actor of [
      { kind: 'partner', userId: test.s.partnerA, creditorId: test.s.creditorA },
      { kind: 'debtor', debtorId: test.s.debtorA },
    ] as const)
      await expect(db.run(actor, (tx) => tx.$queryRaw`SELECT value FROM case_contacts`)).rejects.toThrow();
  });
});

describe('what the portals may read of the invoices', () => {
  it('is that of their own cases, and the debtor only once announced', async () => {
    const { s } = test;
    const add = (caseId: string, creditorId: string, number: string) =>
      rows(
        "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, $3, '2026-01-01', '2026-02-01', 100, 100)",
        [caseId, creditorId, number],
      );
    await add(s.cases.ofA, s.creditorA, 'ALPHA');
    await add(s.cases.ofB, s.creditorB, 'BETA');
    await add(s.cases.ofDirector, s.creditorB, 'HIDDEN');
    const db = test.app.get(Database);
    const numbers = async (actor: Parameters<Database['run']>[0]) =>
      (await db.run(actor, (tx) => tx.caseInvoice.findMany({ select: { number: true }, orderBy: { number: 'asc' } }))).map((row) => row.number);
    expect(await numbers({ kind: 'partner', userId: s.partnerA, creditorId: s.creditorA })).toEqual(['ALPHA']);
    expect(await numbers({ kind: 'debtor', debtorId: s.debtorA })).toEqual(['ALPHA', 'BETA']);
    expect(await numbers({ kind: 'debtor', debtorId: s.debtorB })).toEqual([]);
  });

  it('never carries the creditor of another case', async () => {
    await expect(
      rows(
        "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'X', '2026-01-01', '2026-02-01', 100, 100)",
        [test.s.cases.ofA, test.s.creditorB],
      ),
    ).rejects.toThrow();
  });
});

describe('a company that is already known', () => {
  it('is the same debtor whatever the way its name is written', async () => {
    const number = siren();
    const first = await open('manager', { number, name: 'Bâtiplus SAS' });
    const second = await open('manager', { number, name: 'BATI-PLUS', creditorId: other.id, mandateId: other.mandate });
    const debtors = await rows<{ debtor_id: string }>('SELECT DISTINCT debtor_id FROM cases WHERE id = ANY ($1::uuid[])', [[first.id, second.id]]);
    expect(debtors).toHaveLength(1);
    expect((await detail('manager', second.id)).name).toBe('Bâtiplus SAS');
  });

  it.each([
    ['Martin S.A.R.L.', 'SARL Martin'],
    ['Dupont & Fils', 'DUPONT ET FILS SAS'],
    ['SA', 'sa'],
  ])('« %s » and « %s » are the same name', async (first, second) => {
    const number = siren();
    await open('manager', { number, name: first });
    await open('manager', { number, name: second, creditorId: other.id, mandateId: other.mandate });
  });
  it('« SA » and « SCI » are not', async () => {
    const number = siren();
    await open('manager', { number, name: 'SA' });
    expect(await call('manager', 'POST', '', opening({ number, name: 'SCI', creditorId: other.id, mandateId: other.mandate }))).toMatchObject({ status: 409 });
  });

  it('is sought with what can be written only', async () => {
    const number = siren();
    for (const some of [{ city: 'Lyon\u0000' }, { name: 'Nom\u0007' }, { address: '1 rue\nX' }])
      expect(await call('manager', 'POST', '', opening({ number, ...some }))).toMatchObject({ status: 422, body: { code: 'INVALID' } });
  });

  it.each([
    ['another name', { name: 'Plomberie Martin' }],
    ['another kind', { kind: 'SOLE_TRADER' as const }],
  ])('is not joined under %s: nothing is recorded', async (_what, some) => {
    const number = siren();
    await open('director', { number, toMe: true, name: 'Nom réservé' });
    const before = await rows('SELECT 1 FROM cases');
    const answer = await call('manager', 'POST', '', opening({ number, name: 'Nom réservé', creditorId: other.id, mandateId: other.mandate, ...some }));
    expect(answer).toMatchObject({ status: 409, body: { code: 'DEBTOR_MISMATCH' } });
    expect(JSON.stringify(answer.body)).not.toContain('réservé');
    expect(await rows('SELECT 1 FROM cases')).toHaveLength(before.length);
  });

  it('is named before the case is opened to whoever reads one of its cases, and to nobody else', async () => {
    const number = siren();
    await open('director', { number, toMe: true, name: 'Nom réservé' });
    const known = async (as: string) => caseCheckResult.parse((await call(as, 'POST', '/check', { creditorId: other.id, number })).body).known;
    expect(await known('director')).toEqual({ name: 'Nom réservé', kind: 'COMPANY' });
    expect(await known('manager')).toBeNull();
  });
});

describe('PostgreSQL itself', () => {
  it('records nothing as paid, verified, or in the name of someone else', async () => {
    const { id } = await open('manager', { toMe: true });
    const database = new Database(test.database.url('app'));
    const manager = { kind: 'staff', userId: test.s.manager, role: 'COLLECTION_MANAGER', delegations: [] } as const;
    try {
      const contact = (status: string, by: string) =>
        database.run(
          manager,
          (tx) => tx.$executeRaw`INSERT INTO case_contacts (case_id, creditor_id, kind, label, value, value_normalized, status, source, created_by)
            VALUES (${id}::uuid, ${creditor.id}::uuid, 'PHONE', 'x', ${`06 00 00 0${status.length} 99`}, ${`060000${status.length}99`}, ${status}::contact_status, 'CALL', ${by}::uuid)`,
        );
      await expect(contact('VERIFIED', test.s.manager)).rejects.toThrow(/42501|policy/u);
      await expect(contact('NEW', test.s.officerA)).rejects.toThrow(/42501|policy/u);
      expect(await contact('NEW', test.s.manager)).toBe(1);
      const bill = (paid: number, by: string) =>
        database.run(
          manager,
          (
            tx,
          ) => tx.$executeRaw`INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents, principal_paid_cents, created_by)
            VALUES (${id}::uuid, ${creditor.id}::uuid, ${`SQL-${paid}-${by}`}, '2026-08-01', '2026-09-01', 100, 100, ${paid}::int, ${by}::uuid)`,
        );
      await expect(bill(100, test.s.manager)).rejects.toThrow(/42501|policy/u);
      await expect(bill(0, test.s.officerA)).rejects.toThrow(/42501|policy/u);
      await expect(
        database.run(
          manager,
          (tx) => tx.$executeRaw`INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents, state, created_by)
            VALUES (${id}::uuid, ${creditor.id}::uuid, 'SQL-state', '2026-08-01', '2026-09-01', 100, 100, ${'PAID'}::invoice_state, ${test.s.manager}::uuid)`,
        ),
      ).rejects.toThrow(/42501|policy/u);
      expect(await bill(0, test.s.manager)).toBe(1);
    } finally {
      await database.close();
    }
  });
});

describe('an amendment of the mandate', () => {
  it('under way is waited for: no case is opened under a mandate that has just ended', async () => {
    const id = await newCreditor('Créancier en cours');
    const under = await withMandate(id);
    const database = new Database(test.database.url('app'));
    const manager = { kind: 'staff', userId: test.s.manager, role: 'COLLECTION_MANAGER', delegations: [] } as const;
    try {
      let opened: ReturnType<typeof call> | undefined;
      await database.run(manager, async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM creditors WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
        opened = call('manager', 'POST', '', opening({ creditorId: id, mandateId: under }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx.$executeRaw`UPDATE mandates SET ends_on = '2026-02-01' WHERE id = ${under}::uuid`;
      });
      expect(await opened).toMatchObject({ status: 409, body: { code: 'NO_MANDATE' } });
    } finally {
      await database.close();
    }
  });
});

describe('the journal of an assignment', () => {
  it('counts the cases that have changed, and says nothing when none has', async () => {
    const [left, right] = [await open('manager', { toMe: true }), await open('manager', { toMe: true })];
    const counts = async () =>
      (await rows<{ params: { count: number } }>("SELECT params FROM audit_log WHERE action = 'CASES_ASSIGNED' ORDER BY occurred_at, id")).map(
        (row) => row.params.count,
      );
    const before = (await counts()).length;
    await call('director', 'POST', '/assign', { ids: [left.id], officerId: test.s.officerA });
    await call('director', 'POST', '/assign', { ids: [left.id, right.id], officerId: test.s.officerA });
    await call('director', 'POST', '/assign', { ids: [left.id, right.id], officerId: test.s.officerA });
    expect((await counts()).slice(before)).toEqual([1, 1]);
  });
});
