import { dashboard } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
let creditor: string;
let reference = 80_000;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const read = async (as: string) => dashboard.parse((await test.call('GET', `/staff/dashboard?creditor=${creditor}`, { as })).body);
/** A case 45 days late, held by `officer`. */
const makeCase = async (officer: string | null, cents: number, status = 'OVERDUE') => {
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('COMPANY', $1) RETURNING id", [`Débiteur ${(reference += 1)}`]);
  const [made] = await rows<{ id: string }>(
    'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [`LGR-2026-${reference}`, creditor, debtor!.id, officer, status],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', current_date - 75, current_date - 45, $3, $3)",
    [made!.id, creditor, cents],
  );
  return made!.id;
};

beforeAll(async () => {
  test = await startApp();
  creditor = (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Tableau Delta') RETURNING id"))[0]!.id;
});
afterAll(() => test.stop());

describe('the dashboard', () => {
  it('counts for each one the cases PostgreSQL lets them read', async () => {
    const mine = await makeCase(test.s.officerA, 100_000);
    await makeCase(test.s.officerB, 50_000);
    await makeCase(null, 25_000);
    const officer = await read('officerA');
    expect(officer).toMatchObject({ scope: 'PERSONAL', outstanding: 100_000, overdue30: 100_000, team: [] });
    expect(officer.priorities.map((item) => item.href)).toEqual([`/dossiers/${mine}`]);
    const manager = await read('manager');
    expect(manager).toMatchObject({ scope: 'TEAM', outstanding: 175_000 });
    expect(manager.aging.find((item) => item.label === '31 – 60 j')).toMatchObject({ amount: 175_000, percent: 100 });
    expect((await read('director')).scope).toBe('GLOBAL');
    expect((await test.call('GET', '/staff/dashboard', { as: 'developer' })).status).toBe(403);
  });

  it('draws no goal while the firm has typed none', async () => {
    const data = await read('manager');
    expect(data.monthlyTarget).toBe(0);
    expect(data.periods.month.targetRatio).toBeNull();
  });

  it('keeps what one marked done for them alone, and refuses a case they do not read', async () => {
    const theirs = await makeCase(test.s.officerA, 10_000, 'DISPUTE');
    const id = `dispute:${theirs}`;
    const mark = (as: string, done: boolean) =>
      test.call('PUT', `/staff/dashboard/priorities/${id}`, { as, body: { done }, headers: { 'idempotency-key': randomUUID() } });
    expect((await mark('officerA', true)).status).toBe(204);
    expect((await read('officerA')).priorities.find((item) => item.id === id)?.done).toBe(true);
    expect((await mark('officerB', true)).status).toBe(404);
    expect((await mark('officerA', false)).status).toBe(204);
    expect((await read('officerA')).priorities.find((item) => item.id === id)?.done).toBe(false);
  });
});
