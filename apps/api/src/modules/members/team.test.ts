import { formatCents, teamData } from '@legarec/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
let creditor: string;
let reference = 82_000;
let cheque = 8_000_000;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const read = async (as: string, period = 'day') => {
  const answer = await test.call('GET', `/staff/team?period=${period}`, { as });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return teamData.parse(answer.body);
};
const makeCase = async (officer: string | null, cents: number) => {
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('COMPANY', $1) RETURNING id", [`Débiteur ${(reference += 1)}`]);
  const [made] = await rows<{ id: string }>(
    "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status) VALUES ($1, $2, $3, $4, 'OVERDUE') RETURNING id",
    [`LGR-2026-${reference}`, creditor, debtor!.id, officer],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', current_date - 75, current_date - 45, $3, $3)",
    [made!.id, creditor, cents],
  );
  return made!.id;
};
/** A cheque received `ago` days ago. */
const pay = (id: string, cents: number, ago: number) =>
  rows(
    `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, cheque_number, bank, recorded_by)
       VALUES ($1, $2, 'CHEQUE', $3, 'RECEIVED', (now() AT TIME ZONE 'Europe/Paris')::date - $4::int, $5, 'BNP', $6) RETURNING id)
     INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT $1, $2, p.id, 'OVERPAYMENT', $3 FROM p`,
    [id, creditor, cents, ago, String((cheque += 1)), test.s.manager],
  );

beforeAll(async () => {
  test = await startApp();
  creditor = (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Équipe Delta') RETURNING id"))[0]!.id;
  // Other tests of the file set left cases to nobody here: only what this one adds is compared.
  const first = await makeCase(test.s.officerB, 100_000);
  await pay(first, 1_000, 0);
  await pay(first, 2_000, 3);
  await pay(first, 4_000, 20);
  await pay(first, 8_000, 45);
  await makeCase(test.s.officerB, 50_000);
});
afterAll(() => test.stop());

describe('the activity of the team', () => {
  it('gives to those who steer the portfolio of each one and what was cashed on it over the period', async () => {
    const before = (await read('director')).agents.map((agent) => agent.id);
    expect(before).toEqual(expect.arrayContaining([test.s.manager, test.s.officerA, test.s.officerB]));
    // Neither the Director nor the Developer is followed.
    expect(before).not.toContain(test.s.director);
    expect(before).not.toContain(test.s.developer);
    const [{ held }] = (await rows<{ held: number }>(
      'SELECT coalesce(sum(i.principal_cents - i.principal_paid_cents), 0)::int AS held FROM case_invoices i JOIN cases c ON c.id = i.case_id WHERE c.officer_id = $1 AND c.closed_on IS NULL',
      [test.s.officerB],
    )) as [{ held: number }];
    for (const as of ['director', 'manager', 'managerAlone']) {
      const cashed = async (period: string) => (await read(as, period)).agents.find((agent) => agent.id === test.s.officerB)!.cashed;
      expect(await cashed('day')).toBe(1_000);
      expect(await cashed('week')).toBe(3_000);
      expect(await cashed('month')).toBe(7_000);
      // An unknown period reads as the day.
      expect(await cashed('siecle')).toBe(1_000);
      const agent = (await read(as)).agents.find((item) => item.id === test.s.officerB)!;
      expect(agent.book).toContain(formatCents(held));
      expect(agent.scope).toContain('Équipe Delta');
      expect(agent.roleLabel).toBe('Gestionnaire de créances');
    }
  });

  it('invents nothing of what the telephony will say', async () => {
    const data = await read('manager', 'month');
    expect(data).toMatchObject({ telephony: false, calls: [], callsTotal: 0, alerts: [] });
    for (const agent of data.agents)
      expect(agent).toMatchObject({
        presence: 'AWAY',
        status: '—',
        calls: 0,
        goal: 0,
        reached: 0,
        promises: 0,
        promisedAmount: 0,
        average: '—',
        kept: 0,
        live: null,
        hours: [],
      });
  });

  it('is refused to an officer, to the Developer, and to whoever announces a role PostgreSQL does not know them', async () => {
    for (const as of ['officerA', 'officerB', 'developer', 'liar', 'partnerA']) expect((await test.call('GET', '/staff/team', { as })).status, as).toBe(403);
    expect((await test.call('GET', '/staff/team', {})).status).toBe(401);
  });
});
