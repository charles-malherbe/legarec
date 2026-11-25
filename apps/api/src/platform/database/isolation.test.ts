import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import type { Actor } from './actor';
import { Database } from './database';

let test: TestDatabase;
let api: Database;
let jobs: Database;
let s: Seed;

const staff = (userId: string, role: Extract<Actor, { kind: 'staff' }>['role']): Actor => ({ kind: 'staff', userId, role, delegations: [] });
const actors = () => ({
  director: staff(s.director, 'DIRECTOR'),
  manager: staff(s.manager, 'COLLECTION_MANAGER'),
  developer: staff(s.developer, 'DEVELOPER'),
  officerA: staff(s.officerA, 'CLAIMS_OFFICER'),
  officerB: staff(s.officerB, 'CLAIMS_OFFICER'),
  partnerA: { kind: 'partner', userId: s.partnerA, creditorId: s.creditorA } as Actor,
  partnerB: { kind: 'partner', userId: s.partnerB, creditorId: s.creditorB } as Actor,
  debtorA: { kind: 'debtor', debtorId: s.debtorA } as Actor,
  debtorB: { kind: 'debtor', debtorId: s.debtorB } as Actor,
});
type Name = keyof ReturnType<typeof actors>;
const as = <T>(name: Name, work: Parameters<Database['run']>[1]) => api.run(actors()[name], work) as Promise<T>;
const visibleCases = async (name: Name) => {
  const rows = await as<{ id: string }[]>(name, (tx) => tx.case.findMany({ select: { id: true } }));
  return rows.map((row) => Object.entries(s.cases).find(([, id]) => id === row.id)?.[0]).sort();
};

beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  api = new Database(test.url('app'));
  jobs = new Database(test.url('jobs'));
});
afterAll(async () => {
  await Promise.all([api.close(), jobs.close()]);
  await test.drop();
});

describe('reading cases', () => {
  it.each<[Name, string[]]>([
    ['director', ['ofA', 'ofB', 'ofDirector', 'unassigned']],
    ['manager', ['ofA', 'ofB', 'unassigned']],
    ['officerA', ['ofA']],
    ['officerB', ['ofB']],
    ['developer', []],
    ['partnerA', ['ofA', 'unassigned']],
    ['partnerB', ['ofB', 'ofDirector']],
    ['debtorA', ['ofA', 'ofB']],
    // Nothing of a case before its first letter.
    ['debtorB', ['unassigned']],
  ])('%s sees %j', async (name, expected) => {
    expect(await visibleCases(name)).toEqual(expected);
  });

  it('shows nothing without an actor, with a disabled account or with the account of another portal', async () => {
    await expect(api.run({ kind: 'anonymous' }, (tx) => tx.case.findMany())).rejects.toThrow(/denied/u);
    await test.admin.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.officerB]);
    expect(await visibleCases('officerB')).toEqual([]);
    await test.admin.query("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.officerB]);
    const borrowed: Actor = { kind: 'staff', userId: s.partnerA, role: 'DIRECTOR', delegations: [] };
    expect(await api.run(borrowed, (tx) => tx.case.count())).toBe(0);
  });

  it('refuses a creditor account that claims to be another creditor', async () => {
    const forged: Actor = { kind: 'partner', userId: s.partnerA, creditorId: s.creditorB };
    expect(await api.run(forged, (tx) => tx.case.count({ where: {} }))).toBe(0);
    expect(await api.run(forged, (tx) => tx.creditor.findMany({ select: { name: true } }))).toEqual([]);
  });

  it('ignores the role announced by the API: only the table counts', async () => {
    const promoted: Actor = { kind: 'staff', userId: s.officerA, role: 'DIRECTOR', delegations: ['ADMINISTRATIVE'] };
    expect(await api.run(promoted, (tx) => tx.case.count())).toBe(1);
  });
});

describe('acting on cases', () => {
  const change = (name: Name, id: string) => as<{ count: number }>(name, (tx) => tx.case.updateMany({ where: { id }, data: { status: 'PROMISE' } }));
  it('lets the Director act on their own cases only', async () => {
    expect((await change('director', s.cases.ofDirector)).count).toBe(1);
    expect((await change('director', s.cases.ofA)).count).toBe(0);
    expect((await change('director', s.cases.unassigned)).count).toBe(0);
  });
  it('lets the manager act on the cases of the officers and on the unassigned ones', async () => {
    expect((await change('manager', s.cases.ofA)).count).toBe(1);
    expect((await change('manager', s.cases.unassigned)).count).toBe(1);
    expect((await change('manager', s.cases.ofDirector)).count).toBe(0);
  });
  it('lets an officer act on their own cases only, and the Developer on none', async () => {
    expect((await change('officerA', s.cases.ofA)).count).toBe(1);
    expect((await change('officerA', s.cases.ofB)).count).toBe(0);
    expect((await change('developer', s.cases.ofA)).count).toBe(0);
  });
  it('never lets anyone move a case to another officer, creditor or debtor directly', async () => {
    for (const data of [{ officerId: s.officerB }, { creditorId: s.creditorB }, { debtorId: s.debtorB }, { reference: 'LGR-2026-99999' }]) {
      await expect(as('officerA', (tx) => tx.case.updateMany({ where: { id: s.cases.ofA }, data }))).rejects.toThrow(/denied/u);
    }
  });
  it.each<Name>(['partnerA', 'debtorA'])('%s cannot change a case', async (name) => {
    await expect(change(name, s.cases.ofA)).rejects.toThrow(/denied/u);
  });
  it('refuses a child row that carries the creditor of another case', async () => {
    await expect(
      test.admin.query("INSERT INTO case_events (case_id, creditor_id, kind, title, actor_kind, actor_label) VALUES ($1, $2, 'NOTE', 'x', 'SYSTEM', 'x')", [
        s.cases.ofA,
        s.creditorB,
      ]),
    ).rejects.toThrow(/foreign key/u);
  });
});

describe('assigning cases', () => {
  const assign = (name: Name, ids: string[], officer: string | null) =>
    as<number>(name, async (tx) => (await tx.$queryRaw<{ n: number }[]>`SELECT app.assign_cases(${ids}::uuid[], ${officer}::uuid) AS n`)[0]!.n);
  it('is kept for the Director and the manager with the administrative delegation', async () => {
    expect(await assign('director', [s.cases.unassigned], s.officerA)).toBe(1);
    expect(await assign('manager', [s.cases.unassigned], null)).toBe(1);
    await expect(assign('officerA', [s.cases.ofA], s.officerB)).rejects.toThrow(/assignment refused/u);
    await expect(assign('developer', [s.cases.ofA], s.officerB)).rejects.toThrow(/assignment refused/u);
  });
  it('stops as soon as the delegation is withdrawn', async () => {
    await test.admin.query("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = $1 WHERE kind = 'ADMINISTRATIVE'", [s.director]);
    await expect(assign('manager', [s.cases.unassigned], s.officerA)).rejects.toThrow(/assignment refused/u);
    await test.admin.query("INSERT INTO delegations (kind, granted_by) VALUES ('ADMINISTRATIVE', $1)", [s.director]);
    expect(await assign('manager', [s.cases.unassigned], s.officerA)).toBe(1);
    expect(await assign('manager', [s.cases.unassigned], null)).toBe(1);
  });
  it('refuses a Developer or a creditor account as officer, and never reaches a case out of sight', async () => {
    await expect(assign('director', [s.cases.unassigned], s.developer)).rejects.toThrow(/invalid officer/u);
    await expect(assign('director', [s.cases.unassigned], s.partnerA)).rejects.toThrow(/invalid officer/u);
    expect(await assign('manager', [s.cases.ofDirector], s.officerA)).toBe(0);
  });
});

describe('names, creditors and debtors', () => {
  const names = async (name: Name) =>
    (await as<{ name: string }[]>(name, (tx) => tx.creditor.findMany({ select: { name: true }, orderBy: { name: 'asc' } }))).map((row) => row.name);
  it('hides the creditors of other people', async () => {
    expect(await names('director')).toHaveLength(2);
    expect(await names('manager')).toHaveLength(2);
    expect(await names('officerA')).toEqual(['Créancier ALPHA-MARK']);
    expect(await names('developer')).toEqual([]);
    expect(await names('partnerB')).toEqual(['Créancier BETA-MARK']);
    await expect(names('debtorA')).rejects.toThrow(/denied/u);
  });
  it('hides the debtors of other people', async () => {
    const count = (name: Name) => as<number>(name, (tx) => tx.debtor.count());
    expect(await count('developer')).toBe(0);
    expect(await count('officerA')).toBe(1);
    expect(await count('debtorA')).toBe(1);
    expect(await count('partnerA')).toBe(2);
  });
  it('shows colleagues to the team, creditor accounts with their creditor, and only itself to a creditor', async () => {
    const emails = async (name: Name) => (await as<{ email: string }[]>(name, (tx) => tx.user.findMany({ select: { email: true } }))).map((row) => row.email);
    expect(await emails('director')).toHaveLength(7);
    expect(await emails('officerA')).not.toContain('quentin@exemple.test');
    expect(await emails('developer')).not.toContain('paula@exemple.test');
    expect(await emails('partnerA')).toEqual(['paula@exemple.test']);
    await expect(emails('debtorA')).rejects.toThrow(/denied/u);
  });
});

describe('single roles', () => {
  it('refuses a second holder, even with several requests at the same time', async () => {
    const pool = new pg.Pool({ connectionString: test.adminUrl, max: 3 });
    const add = (index: number) =>
      pool.query("INSERT INTO users (role, status, first_name, last_name, email) VALUES ('DEVELOPER', 'ACTIVE', 'X', 'X', $1)", [
        `second${index}@exemple.test`,
      ]);
    await expect(add(1)).rejects.toThrow(/users_single_role/u);
    await test.admin.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.developer]);
    const results = await Promise.allSettled([add(2), add(3), add(4)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await pool.end();
    await test.admin.query("DELETE FROM users WHERE email LIKE 'second%'");
    await test.admin.query("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.developer]);
  });
});

describe('worker and retention', () => {
  it('are out of reach of the HTTP API', async () => {
    await expect(api.run({ kind: 'worker', job: 'test' }, (tx) => tx.case.count())).rejects.toThrow(/permission denied to set role/u);
    await expect(api.run({ kind: 'retention' }, (tx) => tx.case.count())).rejects.toThrow(/permission denied to set role/u);
  });
  it('run a task of a collaborator with the rights of that collaborator', async () => {
    expect(await jobs.run({ kind: 'worker', job: 'test' }, (tx) => tx.case.count())).toBe(4);
    expect(await jobs.run(actors().officerA, (tx) => tx.case.count())).toBe(1);
    expect(await jobs.run(actors().partnerA, (tx) => tx.case.count())).toBe(2);
    expect(await jobs.run(actors().debtorB, (tx) => tx.case.count())).toBe(1);
    for (const kind of ['anonymous', 'hook', 'public'] as const)
      await expect(jobs.run({ kind }, (tx) => tx.case.count())).rejects.toThrow(/permission denied to set role/u);
  });
});
