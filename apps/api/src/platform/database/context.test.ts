import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import { contextOf, DATABASE_ROLE, type Actor } from './actor';
import { Database } from './database';

let test: TestDatabase;
let s: Seed;
/** One connection only: each transaction runs where the previous actor has just been. */
let single: Database;
let shared: Database;

beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  single = new Database(test.url('app'), { poolSize: 1 });
  shared = new Database(test.url('app'), { poolSize: 3 });
});
afterAll(async () => {
  await Promise.all([single.close(), shared.close()]);
  await test.drop();
});

const director = (): Actor => ({ kind: 'staff', userId: s.director, role: 'DIRECTOR', delegations: [] });
const officerA = (): Actor => ({ kind: 'staff', userId: s.officerA, role: 'CLAIMS_OFFICER', delegations: [] });
const partnerA = (): Actor => ({ kind: 'partner', userId: s.partnerA, creditorId: s.creditorA });
const partnerB = (): Actor => ({ kind: 'partner', userId: s.partnerB, creditorId: s.creditorB });
const debtorA = (): Actor => ({ kind: 'debtor', debtorId: s.debtorA });
const delegate = (): Actor => ({ kind: 'staff', userId: s.manager, role: 'COLLECTION_MANAGER', delegations: ['ADMINISTRATIVE'], actingFor: 'ADMINISTRATIVE' });

interface State {
  connection: number;
  role: string;
  context: string[];
}
const STATE = `SELECT pg_backend_pid() AS connection, current_user::text AS role,
  ARRAY(SELECT coalesce(current_setting(name, true), '') FROM unnest(ARRAY['app.user_id', 'app.creditor_id', 'app.debtor_id', 'app.acting_for', 'app.job', 'app.service', 'app.purging', 'app.ip', 'app.request_id']) AS name) AS context`;
/** State of the connection once it is back in the pool, outside of any transaction. */
const leftovers = async (database: Database) =>
  (await (database as unknown as { client: { $queryRawUnsafe(sql: string): Promise<State[]> } }).client.$queryRawUnsafe(STATE))[0]!;
const nothing = Array.from({ length: 9 }, () => '');
const facts = { requestId: randomUUID(), ip: '203.0.113.9' };

describe('context of the transaction', () => {
  it('sets the same variables for every kind of actor, and the role last', () => {
    const everyone: Actor[] = [
      { kind: 'anonymous' },
      delegate(),
      partnerA(),
      debtorA(),
      { kind: 'hook' },
      { kind: 'public' },
      { kind: 'service', accountId: randomUUID(), scopes: [] },
      { kind: 'worker', job: 'x' },
      { kind: 'retention' },
    ];
    expect(everyone.map((actor) => actor.kind).sort()).toEqual(Object.keys(DATABASE_ROLE).sort());
    const names = Object.keys(contextOf({ kind: 'anonymous' }, {}));
    expect(names.at(-1)).toBe('role');
    for (const actor of everyone) {
      const context = contextOf(actor, {});
      expect(Object.keys(context), actor.kind).toEqual(names);
      expect(context.role, actor.kind).toBe(DATABASE_ROLE[actor.kind]);
      // Nothing undefined: PostgreSQL would keep the value that was there before.
      expect(
        Object.values(context).every((value) => typeof value === 'string'),
        actor.kind,
      ).toBe(true);
    }
  });

  it('dies with the transaction, whether it succeeds, throws or is refused by PostgreSQL', async () => {
    const endings: [string, () => Promise<unknown>][] = [
      ['success', () => single.run(delegate(), (tx) => tx.case.count(), facts)],
      ['creditor', () => single.run(partnerA(), (tx) => tx.case.count(), facts)],
      ['debtor', () => single.run(debtorA(), (tx) => tx.case.count(), facts)],
      ['service', () => single.run({ kind: 'service', accountId: randomUUID(), scopes: [] }, () => Promise.resolve(), facts)],
      ['exception', () => single.run(director(), () => Promise.reject(new Error('stop')), facts)],
      ['refusal', () => single.run(partnerA(), (tx) => tx.auditEntry.count(), facts)],
    ];
    for (const [name, work] of endings) {
      let inside: State | undefined;
      await single.run(delegate(), async (tx) => void (inside = (await tx.$queryRawUnsafe<State[]>(STATE))[0]), facts);
      expect(inside, name).toMatchObject({ role: 'legarec_staff', context: expect.arrayContaining([s.manager, 'ADMINISTRATIVE', facts.ip]) as string[] });
      await work().catch(() => undefined);
      // The same connection, or the test would prove nothing.
      expect(await leftovers(single), name).toEqual({ connection: inside!.connection, role: 'legarec_app', context: nothing });
    }
  });

  it('keeps nothing of the previous actor on the same connection', async () => {
    const see = (actor: Actor) =>
      single.run(
        actor,
        async (tx) =>
          (
            await tx.$queryRaw<
              Record<string, string | null>[]
            >`SELECT app.user_id()::text AS user_id, app.creditor_id()::text AS creditor_id, app.debtor_id()::text AS debtor_id, app.setting('acting_for') AS acting_for, app.setting('ip') AS ip`
          )[0],
      );
    await single.run(delegate(), (tx) => tx.case.count(), facts);
    expect(await see(debtorA())).toEqual({ user_id: null, creditor_id: null, debtor_id: s.debtorA, acting_for: null, ip: null });
    expect(await see(partnerA())).toEqual({ user_id: s.partnerA, creditor_id: s.creditorA, debtor_id: null, acting_for: null, ip: null });
    expect(await see(officerA())).toEqual({ user_id: s.officerA, creditor_id: null, debtor_id: null, acting_for: null, ip: null });
    expect(await see({ kind: 'anonymous' })).toEqual({ user_id: null, creditor_id: null, debtor_id: null, acting_for: null, ip: null });
  });

  it('gives no right without an identity, even to a known kind of actor', async () => {
    for (const broken of [
      { kind: 'staff', role: 'DIRECTOR', delegations: [] },
      { kind: 'partner', creditorId: s.creditorA },
      { kind: 'partner', userId: s.partnerA },
      { kind: 'debtor' },
    ])
      expect(await single.run(broken as unknown as Actor, (tx) => tx.case.count()), JSON.stringify(broken)).toBe(0);
    await expect(single.run({ kind: 'unknown' } as unknown as Actor, (tx) => tx.case.count())).rejects.toThrow(/denied/u);
  });
});

describe('transaction of the current request', () => {
  it('is out of reach before, after and outside of the work', async () => {
    expect(() => shared.tx).toThrow('No transaction');
    expect(() => shared.actor).toThrow('No transaction');
    await shared.run(director(), () => Promise.resolve(shared.tx));
    expect(() => shared.tx).toThrow('No transaction');
    let late!: () => Promise<number>;
    await shared.run(director(), (tx) => {
      late = () => tx.case.count();
      return Promise.resolve();
    });
    // Work left running after the end of the request acts for nobody.
    await expect(late()).rejects.toThrow(/closed|already|expired/iu);
  });

  it('belongs to one of two actors at work at the same time, never to the other', async () => {
    let arrived = 0;
    let open!: () => void;
    const everyone = new Promise<void>((resolve) => (open = resolve));
    const view = (actor: Actor) =>
      shared.run(actor, async () => {
        arrived += 1;
        if (arrived === 3) open();
        // All the transactions are open from here on.
        await everyone;
        const cases = await shared.tx.case.findMany({ select: { id: true } });
        await new Promise((resolve) => setTimeout(resolve, 10));
        const [own] = await shared.tx.$queryRaw<{ role: string; key: string | null }[]>`SELECT current_user::text AS role, app.actor_key() AS key`;
        return { actor: shared.actor, ids: cases.map((row) => row.id).sort(), ...own };
      });
    const [a, b, d] = await Promise.all([view(partnerA()), view(partnerB()), view(debtorA())]);
    expect(a).toEqual({ actor: partnerA(), ids: [s.cases.ofA, s.cases.unassigned].sort(), role: 'legarec_partner', key: `user:${s.partnerA}` });
    expect(b).toEqual({ actor: partnerB(), ids: [s.cases.ofB, s.cases.ofDirector].sort(), role: 'legarec_partner', key: `user:${s.partnerB}` });
    expect(d).toEqual({ actor: debtorA(), ids: [s.cases.ofA, s.cases.ofB].sort(), role: 'legarec_debtor', key: `debtor:${s.debtorA}` });
  });

  it('stays right when more requests than connections wait for their turn', async () => {
    const expected: [Actor, number][] = [
      [director(), 4],
      [officerA(), 1],
      [partnerA(), 2],
      [partnerB(), 2],
      [debtorA(), 2],
    ];
    const answers = await Promise.all(
      Array.from({ length: 60 }, (_, index) => {
        const [actor, count] = expected[index % expected.length]!;
        return shared.run(actor, async () => {
          const before = await shared.tx.case.count();
          await new Promise((resolve) => setTimeout(resolve, index % 4));
          return [before, await shared.tx.case.count(), count];
        });
      }),
    );
    for (const [before, after, count] of answers) expect([before, after]).toEqual([count, count]);
  });

  it('is found again after another one opened inside of it', async () => {
    await shared.run(director(), async () => {
      const outer = shared.tx;
      await shared.run(partnerA(), async () => {
        expect(shared.actor).toEqual(partnerA());
        expect(await shared.tx.case.count()).toBe(2);
      });
      expect(shared.tx).toBe(outer);
      expect(shared.actor).toEqual(director());
      expect(await shared.tx.case.count()).toBe(4);
    });
  });

  it('rolls back as a whole when any part of the work fails', async () => {
    await shared
      .run(officerA(), async (tx) => {
        await tx.case.updateMany({ where: { id: s.cases.ofA }, data: { externalReference: 'half' } });
        throw new Error('stop');
      })
      .catch(() => undefined);
    const { rows } = await test.admin.query('SELECT external_reference FROM cases WHERE id = $1', [s.cases.ofA]);
    expect(rows).toEqual([{ external_reference: null }]);
  });
});
