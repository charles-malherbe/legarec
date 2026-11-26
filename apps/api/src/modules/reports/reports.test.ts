import { formatCents, reportsData } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
let creditor: string;
let other: string;
let reference = 81_000;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const read = async (as: string, of = creditor) => {
  const answer = await test.call('GET', `/staff/reports?creditor=${of}`, { as });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return reportsData.parse(answer.body);
};
const kpi = (data: Awaited<ReturnType<typeof read>>, period: 'month' | 'quarter' | 'year', label: string) =>
  data.periods[period].kpis.find((item) => item.label === label);
/** A case of one invoice, entrusted today. */
const makeCase = async (officer: string | null, cents: number, of = creditor) => {
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('COMPANY', $1) RETURNING id", [`Débiteur ${(reference += 1)}`]);
  const [made] = await rows<{ id: string }>(
    'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [`LGR-2026-${reference}`, of, debtor!.id, officer, 'OVERDUE'],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', current_date - 75, current_date - 45, $3, $3)",
    [made!.id, of, cents],
  );
  return made!.id;
};
let cheque = 7_000_000;
/** A cheque received today; the test reads sums, not what each cent was allocated to. */
const pay = (id: string, cents: number, status = 'CASHED', of = creditor) =>
  rows(
    `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, settled_at, bounced_at, cheque_number, bank, recorded_by)
       VALUES ($1, $2, 'CHEQUE', $3, $4::payment_status, (now() AT TIME ZONE 'Europe/Paris')::date, CASE WHEN $4 = 'CASHED' THEN now() END,
         CASE WHEN $4 = 'BOUNCED' THEN now() END, $5, 'BNP', $6) RETURNING id)
     , a AS (INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT $1, $2, p.id, 'OVERPAYMENT', $3 FROM p
       RETURNING id, payment_id)
     INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents, reverses_id)
     SELECT $1, $2, a.payment_id, 'OVERPAYMENT', -$3, a.id FROM a WHERE $4 = 'BOUNCED'`,
    [id, of, cents, status, String((cheque += 1)), test.s.manager],
  );
const close = (id: string, status: 'SETTLED' | 'LOST', days: number) =>
  rows(
    "UPDATE cases SET status = $2::case_status, closed_on = (now() AT TIME ZONE 'Europe/Paris')::date, opened_on = (now() AT TIME ZONE 'Europe/Paris')::date - $3::int WHERE id = $1",
    [id, status, days],
  );

beforeAll(async () => {
  test = await startApp();
  creditor = (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Rapports Delta') RETURNING id"))[0]!.id;
  other = (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Rapports Rhône') RETURNING id"))[0]!.id;
  const mine = await makeCase(test.s.officerA, 100_000);
  await pay(mine, 40_000);
  // A cheque that bounced recovered nothing.
  await pay(mine, 7_000, 'BOUNCED');
  const theirs = await makeCase(test.s.officerB, 50_000);
  await pay(theirs, 10_000);
  await makeCase(null, 25_000);
  // Closed: one settled in 10 days by A, one lost without a cent by B, one lost after a payment by B.
  const settled = await makeCase(test.s.officerA, 20_000);
  await pay(settled, 20_000);
  await rows('UPDATE case_invoices SET principal_paid_cents = principal_cents WHERE case_id = $1', [settled]);
  await close(settled, 'SETTLED', 10);
  await close(await makeCase(test.s.officerB, 30_000), 'LOST', 40);
  const partial = await makeCase(test.s.officerB, 60_000);
  await pay(partial, 5_000);
  await close(partial, 'LOST', 40);
  // A case of the Director, paid: the manager reads nothing of it.
  await pay(await makeCase(test.s.director, 200_000), 50_000);
  // Another creditor, held by B alone.
  await pay(await makeCase(test.s.officerB, 900_000, other), 300_000, 'CASHED', other);
});
afterAll(() => test.stop());

describe('the reports', () => {
  it('counts for each one the cases PostgreSQL lets them read', async () => {
    const officer = await read('officerA');
    expect(officer.scope).toBe('PERSONAL');
    for (const period of ['month', 'quarter', 'year'] as const) {
      expect(kpi(officer, period, 'Recouvré')).toMatchObject({ value: formatCents(60_000), delta: '2 paiements' });
      expect(kpi(officer, period, 'Nouvelles créances confiées')).toMatchObject({ value: formatCents(120_000), delta: '2 factures' });
      expect(kpi(officer, period, 'Taux de recouvrement')).toMatchObject({ value: '50 %', delta: '1 facture soldée sur 2' });
      expect(kpi(officer, period, 'DSO moyen')).toMatchObject({ value: '10 j', delta: 'sur 1 dossier réglé' });
      // Every bar of a period adds up to its figures.
      expect(officer.periods[period].bars.reduce((sum, bar) => sum + bar.recovered, 0)).toBe(60_000);
      expect(officer.periods[period].bars.reduce((sum, bar) => sum + bar.entrusted, 0)).toBe(120_000);
    }
    expect(kpi(officer, 'year', 'Irrécouvrable')).toMatchObject({ value: formatCents(0), delta: '0 dossier', tone: 'neutral' });
    expect(kpi(officer, 'month', 'Irrécouvrable')).toBeUndefined();
    expect(officer.outcomes.map((item) => item.percent)).toEqual([100, 0, 0]);
    // Their own line, and nobody else's.
    expect(officer.team).toEqual([{ id: test.s.officerA, name: expect.any(String), cases: 1, calls: null, promises: null, recovered: 60_000, rate: 50 }]);

    const manager = await read('manager');
    expect(manager.scope).toBe('TEAM');
    expect(kpi(manager, 'year', 'Recouvré')).toMatchObject({ value: formatCents(75_000), delta: '4 paiements' });
    expect(kpi(manager, 'year', 'Irrécouvrable')).toMatchObject({ value: formatCents(90_000), delta: '2 dossiers', tone: 'bad' });
    expect(manager.outcomes).toEqual([
      { label: 'Recouvré intégralement', percent: 33, tone: 'success' },
      { label: 'Recouvré partiellement', percent: 33, tone: 'teal' },
      { label: 'Irrécouvrable', percent: 33, tone: 'danger' },
    ]);
    expect(manager.team.find((item) => item.id === test.s.officerB)).toMatchObject({ cases: 1, recovered: 15_000, rate: 11 });
    expect(manager.team.find((item) => item.id === test.s.manager)).toMatchObject({ cases: 0, recovered: 0, rate: 0 });
    // The portfolio of the Director is theirs: not in the figures of the manager, nor a line of their team.
    expect(manager.team.map((item) => item.id)).not.toContain(test.s.director);
    expect(kpi(manager, 'year', 'Nouvelles créances confiées')?.value).toBe(formatCents(285_000));
    const director = await read('director');
    expect(director.scope).toBe('GLOBAL');
    expect(kpi(director, 'year', 'Recouvré')).toMatchObject({ value: formatCents(125_000), delta: '5 paiements' });
    expect(kpi(director, 'year', 'Nouvelles créances confiées')?.value).toBe(formatCents(485_000));
    expect(director.team.find((item) => item.id === test.s.director)).toMatchObject({ cases: 1, recovered: 50_000, rate: 25 });
    // The same without naming the creditor: the manager still counts nothing of the Director.
    const [all, whole] = [await read('manager', 'all'), await read('director', 'all')];
    expect(all.team.map((item) => item.id)).not.toContain(test.s.director);
    const amount = (data: typeof all) => data.periods.year.bars.reduce((sum, bar) => sum + bar.recovered, 0);
    expect(amount(whole) - amount(all)).toBeGreaterThanOrEqual(50_000);
    expect((await test.call('GET', '/staff/reports', { as: 'developer' })).status).toBe(403);
  });

  it('shows nothing of a creditor whose cases one does not read, as of a creditor that has none', async () => {
    const hidden = await read('officerA', other);
    const unknown = await read('officerA', randomUUID());
    expect(hidden).toEqual(unknown);
    expect(kpi(hidden, 'year', 'Recouvré')).toMatchObject({ value: formatCents(0), delta: '0 paiement' });
    expect(kpi(hidden, 'year', 'Taux de recouvrement')?.value).toBe('—');
    expect(kpi(hidden, 'year', 'DSO moyen')).toMatchObject({ value: '—', delta: 'aucun dossier réglé' });
    expect(hidden.team).toEqual([expect.objectContaining({ id: test.s.officerA, cases: 0, recovered: 0 })]);
    expect(kpi(await read('officerB', other), 'year', 'Recouvré')?.value).toBe(formatCents(300_000));
    // Neither `all` nor an identifier: refused, never the figures of all under the name of one.
    for (const value of ['autre', 'ALL', `${creditor}x`, ''])
      expect((await test.call('GET', `/staff/reports?creditor=${value}`, { as: 'officerA' })).status, value).toBe(422);
    expect((await test.call('GET', '/staff/reports', { as: 'officerA' })).body).toEqual(JSON.parse(JSON.stringify(await read('officerA', 'all'))));
  });

  it('believes the role PostgreSQL knows, not the one that is announced', async () => {
    // The liar is the officer A, announced as the Director.
    const liar = await read('liar', 'all');
    expect(liar).toEqual(await read('officerA', 'all'));
    expect(liar.scope).toBe('PERSONAL');
  });

  it('invents neither a call, nor a promise, nor a report that would be sent', async () => {
    const data = await read('director');
    expect(data.promisesKept).toBeNull();
    expect(data.scheduled).toEqual([]);
    expect(data.team.every((item) => item.calls === null && item.promises === null)).toBe(true);
    for (const period of ['month', 'quarter', 'year'] as const) expect(kpi(data, period, 'Honoraires')).toBeUndefined();
  });

  it('finds no scheduled report to switch, and refuses whoever does not steer', async () => {
    const written = async () =>
      (await rows<{ audit: string; tasks: string }>('SELECT (SELECT count(*) FROM audit_log) AS audit, (SELECT count(*) FROM outbox) AS tasks'))[0];
    const before = await written();
    const toggle = (as: string) =>
      test.call('PUT', '/staff/reports/scheduled/r1', { as, body: { active: false }, headers: { 'idempotency-key': randomUUID() } });
    expect((await toggle('director')).status).toBe(404);
    expect((await toggle('manager')).status).toBe(404);
    for (const as of ['officerA', 'developer', 'liar']) expect((await toggle(as)).status, as).toBe(403);
    expect((await test.call('PUT', '/staff/reports/scheduled/r1', { as: 'manager', body: {}, headers: { 'idempotency-key': randomUUID() } })).status).toBe(422);
    // Nothing was done: no line in the audit, no task to run.
    expect(await written()).toEqual(before);
  });
});
