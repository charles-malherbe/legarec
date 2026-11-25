import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import { Outbox } from '../queue/outbox';
import type { Actor } from './actor';
import { Database, type Transaction } from './database';

let test: TestDatabase;
let api: Database;
let jobs: Database;
let s: Seed;

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

type Staff = Extract<Actor, { kind: 'staff' }>;
const staff = (userId: string, role: Staff['role'], more: Partial<Staff> = {}): Actor => ({ kind: 'staff', userId, role, delegations: [], ...more });
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
  // Forged by a defect of the API: neither may open anything.
  borrowed: staff(s.partnerA, 'DIRECTOR'),
  liar: staff(s.officerA, 'DIRECTOR', { delegations: ['TECHNICAL', 'ADMINISTRATIVE'] }),
  forged: { kind: 'partner', userId: s.partnerA, creditorId: s.creditorB } as Actor,
  anonymous: { kind: 'anonymous' } as Actor,
  hook: { kind: 'hook' } as Actor,
  public: { kind: 'public' } as Actor,
  service: { kind: 'service', accountId: randomUUID() } as Actor,
  worker: { kind: 'worker', job: 'test' } as Actor,
  retention: { kind: 'retention' } as Actor,
});
type Name = keyof ReturnType<typeof actors>;
const as = <T>(name: Name, work: (tx: Transaction) => Promise<T>) => (name === 'worker' || name === 'retention' ? jobs : api).run(actors()[name], work);
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.admin.query<T>(sql, values)).rows;
/** The account is put out of use for the time of the work only. */
async function whileStatus<T>(userId: string, status: 'DISABLED' | 'INVITED', work: () => Promise<T>): Promise<T> {
  await test.admin.query('UPDATE users SET status = $2::user_status, disabled_at = CASE WHEN $2 = $3 THEN now() END WHERE id = $1', [
    userId,
    status,
    'DISABLED',
  ]);
  try {
    return await work();
  } finally {
    await test.admin.query("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [userId]);
  }
}
async function whileWithdrawn<T>(kind: 'TECHNICAL' | 'ADMINISTRATIVE', work: () => Promise<T>): Promise<T> {
  await test.admin.query('UPDATE delegations SET withdrawn_at = now(), withdrawn_by = $2 WHERE kind = $1::delegation_kind AND withdrawn_at IS NULL', [
    kind,
    s.director,
  ]);
  try {
    return await work();
  } finally {
    await test.admin.query('INSERT INTO delegations (kind, granted_by) VALUES ($1::delegation_kind, $2)', [kind, s.director]);
  }
}
const marker = () => `PROBE_${randomBytes(6).toString('hex').toUpperCase()}`;

describe('history of a case: who writes', () => {
  const write = (name: Name, target: string, kind = marker()) =>
    as(name, (tx) => tx.$executeRaw`SELECT app.add_case_event(${target}::uuid, ${kind}, 'Essai', NULL, 'neutral'::event_tone, false)`);
  const line = async (kind: string) =>
    (await rows('SELECT case_id, creditor_id, actor_kind, actor_id, actor_label, on_behalf_of_id FROM case_events WHERE kind = $1', [kind]))[0];
  type CaseName = keyof Seed['cases'];

  it.each<[Name, CaseName, string, string, (s: Seed) => string | null]>([
    ['officerA', 'ofA', 'STAFF', 'Alba Test', (seeded) => seeded.officerA],
    ['manager', 'unassigned', 'STAFF', 'Remi Test', (seeded) => seeded.manager],
    ['director', 'ofDirector', 'STAFF', 'Dora Test', (seeded) => seeded.director],
    // Never the name of the person who writes for a creditor, nor that of a debtor.
    ['partnerA', 'ofA', 'CREDITOR', 'Créancier', (seeded) => seeded.partnerA],
    ['partnerB', 'ofDirector', 'CREDITOR', 'Créancier', (seeded) => seeded.partnerB],
    ['debtorA', 'ofA', 'DEBTOR', 'Débiteur', (seeded) => seeded.debtorA],
    ['worker', 'ofDirector', 'SYSTEM', 'Application', () => null],
  ])('%s on %s, as %s « %s »', async (name, target, actorKind, label, id) => {
    const kind = marker();
    await write(name, s.cases[target], kind);
    const [owner] = await rows<{ creditor_id: string }>('SELECT creditor_id FROM cases WHERE id = $1', [s.cases[target]]);
    expect(await line(kind)).toEqual({
      case_id: s.cases[target],
      creditor_id: owner!.creditor_id,
      actor_kind: actorKind,
      actor_id: id(s),
      actor_label: label,
      on_behalf_of_id: null,
    });
  });

  it.each<[Name, CaseName]>([
    ['director', 'ofA'],
    ['manager', 'ofDirector'],
    ['officerA', 'ofB'],
    ['officerA', 'unassigned'],
    ['developer', 'ofA'],
    ['partnerA', 'ofB'],
    ['partnerB', 'ofA'],
    ['forged', 'ofA'],
    ['forged', 'ofB'],
    ['borrowed', 'ofA'],
    ['liar', 'ofB'],
    ['debtorA', 'unassigned'],
    // Their own case, before the first letter: the debtor must not know it exists.
    ['debtorB', 'ofDirector'],
  ])('refuses %s on %s, as if the case did not exist', async (name, target) => {
    const kind = marker();
    await expect(write(name, s.cases[target], kind)).rejects.toThrow(/case not found/u);
    await expect(write(name, randomUUID(), kind)).rejects.toThrow(/case not found/u);
    expect(await line(kind)).toBeUndefined();
  });

  it.each<Name>(['anonymous', 'hook', 'public', 'service', 'retention'])('is closed to %s', async (name) => {
    await expect(write(name, s.cases.ofA)).rejects.toThrow(/permission denied for function add_case_event/u);
  });

  it('refuses an account that is no longer, or not yet, active', async () => {
    for (const status of ['DISABLED', 'INVITED'] as const) {
      await whileStatus(s.officerA, status, () => expect(write('officerA', s.cases.ofA)).rejects.toThrow(/case not found/u));
      await whileStatus(s.partnerA, status, () => expect(write('partnerA', s.cases.ofA)).rejects.toThrow(/case not found/u));
    }
  });

  it('refuses a worker without the name of its task', async () => {
    const nameless: Actor = { kind: 'worker', job: '' };
    await expect(
      jobs.run(nameless, (tx) => tx.$executeRaw`SELECT app.add_case_event(${s.cases.ofA}::uuid, 'PROBE', 'Essai', NULL, 'neutral'::event_tone, false)`),
    ).rejects.toThrow(/case not found/u);
  });

  it('opens once the first letter has left', async () => {
    await test.admin.query("UPDATE cases SET first_letter_reference = 'LR-2026-9999', first_letter_on = '2026-11-24' WHERE id = $1", [s.cases.ofDirector]);
    try {
      const kind = marker();
      await write('debtorB', s.cases.ofDirector, kind);
      expect(await line(kind)).toMatchObject({ actor_kind: 'DEBTOR', actor_label: 'Débiteur' });
    } finally {
      await test.admin.query('UPDATE cases SET first_letter_reference = NULL, first_letter_on = NULL WHERE id = $1', [s.cases.ofDirector]);
    }
  });

  it.each<Name>(['director', 'officerA', 'partnerA', 'debtorA', 'worker'])('gives %s no other way in than the function', async (name) => {
    await expect(
      as(name, (tx) =>
        tx.caseEvent.create({
          data: { caseId: s.cases.ofA, creditorId: s.creditorA, kind: 'FORGED', title: 'x', actorKind: 'STAFF', actorLabel: 'Dora Test' },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow(/denied/u);
    await expect(as(name, (tx) => tx.$executeRaw`UPDATE case_events SET title = 'x'`)).rejects.toThrow(/denied/u);
    await expect(as(name, (tx) => tx.$executeRaw`DELETE FROM case_events`)).rejects.toThrow(/denied/u);
  });

  it('notes the consultations of the Director only, and only on the cases of someone else', async () => {
    const viewed = async () => (await rows<{ n: number }>("SELECT count(*)::int AS n FROM case_events WHERE kind = 'CASE_VIEWED'"))[0]!.n;
    const look = (name: Name, id: string) => as(name, (tx) => tx.$executeRaw`SELECT app.note_consultation(${id}::uuid)`);
    const before = await viewed();
    for (const [name, id] of [
      ['manager', s.cases.ofDirector],
      ['manager', s.cases.ofA],
      ['officerB', s.cases.ofA],
      ['developer', s.cases.ofA],
      ['director', s.cases.ofDirector],
      ['borrowed', s.cases.ofA],
    ] as const)
      await look(name, id);
    expect(await viewed()).toBe(before);
    await look('director', s.cases.unassigned);
    expect(await viewed()).toBe(before + 1);
    for (const name of ['partnerA', 'debtorA', 'worker'] as const) await expect(look(name, s.cases.ofA)).rejects.toThrow(/permission denied for function/u);
  });
});

describe('history of a case: who reads', () => {
  let kinds: Record<'shownA' | 'hiddenA' | 'shownB', string>;
  beforeAll(async () => {
    kinds = { shownA: marker(), hiddenA: marker(), shownB: marker() };
    const add = (kind: string, caseId: string, creditorId: string, visible: boolean) =>
      test.admin.query(
        "INSERT INTO case_events (case_id, creditor_id, kind, title, actor_kind, actor_label, visible_to_creditor) VALUES ($1, $2, $3, 'x', 'SYSTEM', 'Application', $4)",
        [caseId, creditorId, kind, visible],
      );
    await add(kinds.shownA, s.cases.ofA, s.creditorA, true);
    await add(kinds.hiddenA, s.cases.ofA, s.creditorA, false);
    await add(kinds.shownB, s.cases.ofB, s.creditorB, true);
  });

  it.each<[Name, (keyof typeof kinds)[]]>([
    ['director', ['shownA', 'hiddenA', 'shownB']],
    ['manager', ['shownA', 'hiddenA', 'shownB']],
    ['officerA', ['shownA', 'hiddenA']],
    ['officerB', ['shownB']],
    ['developer', []],
    ['liar', ['shownA', 'hiddenA']],
    ['borrowed', []],
    // A creditor: its own cases, and only what is marked for it.
    ['partnerA', ['shownA']],
    ['partnerB', ['shownB']],
    ['forged', []],
  ])('%s sees %j', async (name, expected) => {
    const found = await as(name, (tx) => tx.caseEvent.findMany({ where: { kind: { in: Object.values(kinds) } }, select: { kind: true } }));
    expect(found.map((row) => row.kind).sort()).toEqual(expected.map((key) => kinds[key]).sort());
  });

  it.each<Name>(['debtorA', 'anonymous', 'hook', 'public', 'service', 'retention'])('is closed to %s', async (name) => {
    await expect(as(name, (tx) => tx.caseEvent.count())).rejects.toThrow(/denied/u);
  });
});

describe('accounts that are not active', () => {
  it.each(['DISABLED', 'INVITED'] as const)('open nothing to a creditor whose account is %s', async (status) => {
    await whileStatus(s.partnerA, status, async () => {
      expect(await as('partnerA', (tx) => tx.case.count())).toBe(0);
      expect(await as('partnerA', (tx) => tx.creditor.findMany({ select: { id: true } }))).toEqual([]);
      expect(await as('partnerA', (tx) => tx.debtor.count())).toBe(0);
      expect(await as('partnerA', (tx) => tx.user.findMany({ select: { id: true } }))).toEqual([]);
    });
  });

  it.each(['DISABLED', 'INVITED'] as const)('open nothing to a collaborator whose account is %s', async (status) => {
    await whileStatus(s.director, status, async () => {
      expect(await as('director', (tx) => tx.case.count())).toBe(0);
      expect(await as('director', (tx) => tx.creditor.count())).toBe(0);
      expect(await as('director', (tx) => tx.auditEntry.count())).toBe(0);
      expect(await as('director', (tx) => tx.user.findMany({ select: { id: true } }))).toEqual([]);
      expect(await as('director', (tx) => tx.delegation.count())).toBe(0);
    });
  });

  it('show neither colleagues nor delegations to a creditor taken for a collaborator', async () => {
    expect(await as('borrowed', (tx) => tx.user.findMany({ select: { id: true } }))).toEqual([]);
    expect(await as('borrowed', (tx) => tx.delegation.count())).toBe(0);
    expect(await as('borrowed', (tx) => tx.auditEntry.count())).toBe(0);
  });

  it('leave their cases within reach of the manager', async () => {
    await whileStatus(s.officerA, 'DISABLED', async () => {
      expect(await as('manager', (tx) => tx.case.count({ where: { id: s.cases.ofA } }))).toBe(1);
      expect((await as('manager', (tx) => tx.case.updateMany({ where: { id: s.cases.ofA }, data: { status: 'PROMISE' } }))).count).toBe(1);
    });
  });
});

describe('audit log', () => {
  const log = async (actor: Actor) => {
    const action = marker();
    const database = actor.kind === 'worker' || actor.kind === 'retention' ? jobs : api;
    await database.run(actor, (tx) => tx.$executeRaw`SELECT app.log(${action}, NULL, NULL, 'Essai')`);
    return (await rows('SELECT actor_kind, actor_id, actor_label, on_behalf_of_id FROM audit_log WHERE action = $1', [action]))[0];
  };

  it.each<[Name, string, string, (s: Seed) => string | null]>([
    ['officerA', 'STAFF', 'Alba Test', (seeded) => seeded.officerA],
    ['partnerA', 'CREDITOR', 'Créancier', (seeded) => seeded.partnerA],
    ['debtorA', 'DEBTOR', 'Débiteur', (seeded) => seeded.debtorA],
    ['service', 'SERVICE', 'Compte de service', () => null],
    ['worker', 'SYSTEM', 'Application', () => null],
    ['retention', 'SYSTEM', 'Application', () => null],
    ['anonymous', 'ANONYMOUS', 'Inconnu', () => null],
    ['hook', 'ANONYMOUS', 'Inconnu', () => null],
    // What the API claims is not believed: the line names nobody rather than the wrong person.
    ['borrowed', 'ANONYMOUS', 'Inconnu', () => null],
    ['forged', 'ANONYMOUS', 'Inconnu', () => null],
    ['liar', 'STAFF', 'Alba Test', (seeded) => seeded.officerA],
  ])('notes %s as %s « %s »', async (name, kind, label, id) => {
    expect(await log(actors()[name])).toEqual({ actor_kind: kind, actor_id: id(s), actor_label: label, on_behalf_of_id: null });
  });

  it('never holds the name of a creditor, of its people nor of a debtor', async () => {
    for (const name of ['partnerA', 'partnerB', 'debtorA', 'debtorB'] as const) await log(actors()[name]);
    const text = JSON.stringify(await rows('SELECT * FROM audit_log'));
    for (const hidden of ['Paula', 'Quentin', 'exemple.test', 'ALPHA', 'BETA', 'Débiteur UN', 'Débiteur DEUX', '800000001', 'LGR-'])
      expect(text).not.toContain(hidden);
  });

  it('names nobody once the account is disabled', async () => {
    const nobody = { actor_kind: 'ANONYMOUS', actor_id: null, actor_label: 'Inconnu', on_behalf_of_id: null };
    await whileStatus(s.officerA, 'DISABLED', async () => expect(await log(actors().officerA)).toEqual(nobody));
    await whileStatus(s.partnerA, 'DISABLED', async () => expect(await log(actors().partnerA)).toEqual(nobody));
  });

  it('is closed to the pages without any account', async () => {
    await expect(log(actors().public)).rejects.toThrow(/permission denied for function log/u);
  });

  describe('on behalf of the Director', () => {
    const acting = (userId: string, role: Staff['role'], actingFor?: Staff['actingFor']) =>
      staff(userId, role, { delegations: ['TECHNICAL', 'ADMINISTRATIVE'], actingFor });
    const manager = () => acting(s.manager, 'COLLECTION_MANAGER', 'ADMINISTRATIVE');
    const developer = () => acting(s.developer, 'DEVELOPER', 'TECHNICAL');

    it('is noted for the holder of the delegation, in the audit and in the history of the case', async () => {
      expect(await log(manager())).toMatchObject({ actor_label: 'Remi Test', on_behalf_of_id: s.director });
      expect(await log(developer())).toMatchObject({ actor_label: 'Devon Test', on_behalf_of_id: s.director });
      const kind = marker();
      await api.run(manager(), (tx) => tx.$executeRaw`SELECT app.add_case_event(${s.cases.ofA}::uuid, ${kind}, 'Essai', NULL, 'neutral'::event_tone, false)`);
      expect(await rows('SELECT actor_label, on_behalf_of_id FROM case_events WHERE kind = $1', [kind])).toEqual([
        { actor_label: 'Remi Test', on_behalf_of_id: s.director },
      ]);
    });

    it('is not noted for an action that rests on no delegation', async () => {
      expect(await log(acting(s.manager, 'COLLECTION_MANAGER'))).toMatchObject({ actor_label: 'Remi Test', on_behalf_of_id: null });
    });

    it('stops at once when the delegation is withdrawn, although the session still holds it', async () => {
      await whileWithdrawn('ADMINISTRATIVE', async () => {
        expect(await log(manager())).toMatchObject({ actor_label: 'Remi Test', on_behalf_of_id: null });
        // The other delegation is not concerned.
        expect(await log(developer())).toMatchObject({ on_behalf_of_id: s.director });
      });
      await whileWithdrawn('TECHNICAL', async () => expect(await log(developer())).toMatchObject({ on_behalf_of_id: null }));
      expect(await log(manager())).toMatchObject({ on_behalf_of_id: s.director });
    });

    it('is kept for the person each delegation is made for', async () => {
      for (const actor of [
        acting(s.manager, 'COLLECTION_MANAGER', 'TECHNICAL'),
        acting(s.developer, 'DEVELOPER', 'ADMINISTRATIVE'),
        acting(s.officerA, 'COLLECTION_MANAGER', 'ADMINISTRATIVE'),
        acting(s.partnerA, 'COLLECTION_MANAGER', 'ADMINISTRATIVE'),
      ])
        expect(await log(actor)).toMatchObject({ on_behalf_of_id: null });
    });

    it('names no one when the account of the Director or of the delegate is disabled', async () => {
      await whileStatus(s.director, 'DISABLED', async () => expect(await log(manager())).toMatchObject({ on_behalf_of_id: null }));
      await whileStatus(s.manager, 'DISABLED', async () => expect(await log(manager())).toMatchObject({ actor_label: 'Inconnu', on_behalf_of_id: null }));
    });
  });

  it('is read by the Director and the Developer, and by nobody else', async () => {
    await log(actors().officerA);
    expect(await as('director', (tx) => tx.auditEntry.count())).toBeGreaterThan(0);
    expect(await as('developer', (tx) => tx.auditEntry.count())).toBeGreaterThan(0);
    for (const name of ['manager', 'officerA', 'liar', 'borrowed'] as const) expect(await as(name, (tx) => tx.auditEntry.count()), name).toBe(0);
    for (const name of ['partnerA', 'debtorA', 'anonymous', 'hook', 'public', 'service', 'worker'] as const)
      await expect(
        as(name, (tx) => tx.auditEntry.count()),
        name,
      ).rejects.toThrow(/denied/u);
  });

  it.each<Name>(['director', 'developer', 'partnerA', 'debtorA', 'anonymous', 'worker', 'retention'])(
    'cannot be written nor erased directly by %s',
    async (name) => {
      await expect(
        as(name, (tx) => tx.$executeRaw`INSERT INTO audit_log (actor_kind, actor_label, action, summary) VALUES ('STAFF', 'Dora Test', 'FORGED', 'x')`),
      ).rejects.toThrow(/denied/u);
      await expect(as(name, (tx) => tx.$executeRaw`DELETE FROM audit_log`)).rejects.toThrow(/denied/u);
      await expect(as(name, (tx) => tx.$executeRaw`UPDATE audit_log SET actor_label = 'x'`)).rejects.toThrow(/denied/u);
    },
  );

  it('only opens to the purge itself, not to whoever announces a purge', async () => {
    await log(actors().officerA);
    await test.admin.query('BEGIN');
    try {
      await test.admin.query("SELECT set_config('app.purging', 'audit_log', true)");
      await expect(test.admin.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/u);
    } finally {
      await test.admin.query('ROLLBACK');
    }
    for (const name of ['director', 'worker', 'anonymous'] as const)
      await expect(as(name, (tx) => tx.$executeRaw`SELECT app.purge_audit()`)).rejects.toThrow(/permission denied for function purge_audit/u);
    // The purge of the audit log opens nothing else: the history of the cases stays.
    await jobs.run({ kind: 'retention' }, (tx) => tx.$executeRaw`SELECT app.purge_audit()`);
    expect((await rows('SELECT 1 FROM case_events')).length).toBeGreaterThan(0);
  });
});

describe('numbers', () => {
  const next = (name: Name, kind = 'PROBE', year = 2026) =>
    as(name, async (tx) => (await tx.$queryRaw<{ n: number }[]>`SELECT app.next_number(${kind}, ${year}::integer) AS n`)[0]!.n);

  it('are drawn by the team and the worker only', async () => {
    const first = await next('officerA');
    expect(await next('worker')).toBe(first + 1);
    for (const name of ['partnerA', 'debtorA', 'anonymous', 'hook', 'public', 'service', 'retention'] as const)
      await expect(next(name), name).rejects.toThrow(/permission denied for function next_number/u);
    expect(await next('director')).toBe(first + 2);
  });

  it('leave no gap when the transaction that drew one fails', async () => {
    const first = await next('officerA', 'ROLLED');
    await as('officerA', async (tx) => {
      await tx.$queryRaw`SELECT app.next_number('ROLLED', 2026)`;
      throw new Error('stop');
    }).catch(() => undefined);
    expect(await next('officerA', 'ROLLED')).toBe(first + 1);
  });

  it('start again each year, for each kind', async () => {
    expect(await next('officerA', 'YEARLY', 2026)).toBe(1);
    expect(await next('officerA', 'YEARLY', 2026)).toBe(2);
    expect(await next('officerA', 'YEARLY', 2027)).toBe(1);
    expect(await next('officerA', 'OTHER', 2026)).toBe(1);
  });

  it('can be neither read nor changed directly', async () => {
    for (const name of ['director', 'officerA', 'worker', 'retention'] as const) {
      await expect(
        as(name, (tx) => tx.numberSequence.findMany()),
        name,
      ).rejects.toThrow(/denied/u);
      await expect(
        as(name, (tx) => tx.$executeRaw`UPDATE number_sequences SET last_value = 1`),
        name,
      ).rejects.toThrow(/denied/u);
    }
  });
});

describe('assigning cases', () => {
  const assign = (name: Name, ids: string[], officer: string | null) =>
    as(name, async (tx) => (await tx.$queryRaw<{ n: number }[]>`SELECT app.assign_cases(${ids}::uuid[], ${officer}::uuid) AS n`)[0]!.n);
  const state = async () =>
    (await rows<{ officer_id: string | null; version: number }>('SELECT officer_id, version FROM cases WHERE id = $1', [s.cases.unassigned]))[0]!;

  it('counts a new version for each change, and none without a change', async () => {
    const before = await state();
    expect(await assign('director', [s.cases.unassigned], s.officerA)).toBe(1);
    expect(await state()).toEqual({ officer_id: s.officerA, version: before.version + 1 });
    expect(await assign('director', [s.cases.unassigned, randomUUID()], s.officerA)).toBe(0);
    expect(await state()).toEqual({ officer_id: s.officerA, version: before.version + 1 });
    expect(await assign('director', [s.cases.unassigned], null)).toBe(1);
  });

  it('refuses an officer who is not, or no longer, active', async () => {
    for (const status of ['DISABLED', 'INVITED'] as const)
      await whileStatus(s.officerB, status, () => expect(assign('director', [s.cases.unassigned], s.officerB)).rejects.toThrow(/invalid officer/u));
    await expect(assign('director', [s.cases.unassigned], randomUUID())).rejects.toThrow(/invalid officer/u);
  });

  it('is closed to everyone else', async () => {
    for (const name of ['officerA', 'liar', 'borrowed'] as const)
      await expect(assign(name, [s.cases.ofA], s.officerB), name).rejects.toThrow(/assignment refused/u);
    for (const name of ['partnerA', 'debtorA', 'anonymous', 'worker', 'retention'] as const)
      await expect(assign(name, [s.cases.ofA], s.officerB), name).rejects.toThrow(/permission denied for function assign_cases/u);
    await whileStatus(s.director, 'DISABLED', () => expect(assign('director', [s.cases.ofA], s.officerB)).rejects.toThrow(/assignment refused/u));
  });
});

describe('idempotency keys', () => {
  const insert = (name: Name, actor: string, key = randomUUID()) =>
    as(name, (tx) => tx.$executeRaw`INSERT INTO idempotency_keys (actor, key, route, request_hash) VALUES (${actor}, ${key}::uuid, 'probe', '\\x00')`);

  it('are seen and changed by their owner only', async () => {
    const own: [Name, string][] = [
      ['officerA', `user:${s.officerA}`],
      ['partnerA', `user:${s.partnerA}`],
      ['debtorA', `debtor:${s.debtorA}`],
    ];
    for (const [name, actor] of own) expect(await insert(name, actor)).toBe(1);
    for (const [name, actor] of own) {
      const seen = await as(name, (tx) => tx.idempotencyKey.findMany({ select: { actor: true } }));
      expect(seen).toEqual([{ actor }]);
    }
    // Nobody else, the Director included: an answer kept for a replay is not for other eyes.
    for (const name of ['director', 'developer', 'officerB', 'partnerB', 'debtorB'] as const) {
      expect(await as(name, (tx) => tx.idempotencyKey.findMany({ select: { actor: true } })), name).toEqual([]);
      expect(await as(name, (tx) => tx.$executeRaw`UPDATE idempotency_keys SET result = '{"forged":true}'::jsonb`), name).toBe(0);
    }
    expect(await rows('SELECT 1 FROM idempotency_keys WHERE result IS NOT NULL')).toEqual([]);
  });

  it('cannot be written in the name of someone else', async () => {
    for (const [name, actor] of [
      ['officerB', `user:${s.officerA}`],
      ['partnerB', `user:${s.partnerA}`],
      ['debtorB', `debtor:${s.debtorA}`],
      ['debtorB', `user:${s.officerA}`],
    ] as const)
      await expect(insert(name, actor), `${name} as ${actor}`).rejects.toThrow(/row-level security/u);
    for (const name of ['anonymous', 'hook', 'public', 'service', 'worker'] as const) await expect(insert(name, 'user:x'), name).rejects.toThrow(/denied/u);
  });

  it('cannot be forgotten by the one who used them', async () => {
    for (const name of ['officerA', 'partnerA', 'debtorA'] as const)
      await expect(
        as(name, (tx) => tx.$executeRaw`DELETE FROM idempotency_keys`),
        name,
      ).rejects.toThrow(/denied/u);
    await expect(as('officerA', (tx) => tx.$executeRaw`UPDATE idempotency_keys SET request_hash = '\\x01'`)).rejects.toThrow(/denied/u);
  });
});

describe('tasks', () => {
  const add = async (name: Name, payload: Record<string, unknown> = {}) => {
    const dedupeKey = `probe:${randomUUID()}`;
    const database = name === 'worker' || name === 'retention' ? jobs : api;
    await as(name, () => new Outbox(database).add({ queue: 'maintenance', name: 'probe', payload: payload as Record<string, string>, dedupeKey }));
    return (await rows('SELECT actor_id, payload FROM outbox WHERE dedupe_key = $1', [dedupeKey]))[0];
  };

  it('keep the collaborator who started them, read from the session', async () => {
    expect(await add('officerA')).toMatchObject({ actor_id: s.officerA });
    expect(await add('liar')).toMatchObject({ actor_id: s.officerA });
    // Neither a creditor, a debtor, a webhook nor an account that is not what it claims.
    for (const name of ['partnerA', 'debtorA', 'anonymous', 'hook', 'service', 'worker', 'borrowed'] as const)
      expect(await add(name), name).toMatchObject({ actor_id: null });
    await whileStatus(s.officerA, 'DISABLED', async () => expect(await add('officerA')).toMatchObject({ actor_id: null }));
  });

  it('are neither read, written nor erased directly', async () => {
    for (const name of ['director', 'developer', 'officerA', 'partnerA', 'debtorA', 'anonymous', 'hook', 'service'] as const) {
      await expect(
        as(name, (tx) => tx.outboxTask.count()),
        name,
      ).rejects.toThrow(/denied/u);
      await expect(
        as(name, (tx) => tx.$executeRaw`INSERT INTO outbox (queue, name, payload, actor_id) VALUES ('sms', 'x-x', '{}', ${s.director}::uuid)`),
        name,
      ).rejects.toThrow(/denied/u);
    }
    await expect(add('public')).rejects.toThrow(/permission denied for function enqueue/u);
    await expect(as('worker', (tx) => tx.$executeRaw`UPDATE outbox SET actor_id = ${s.director}::uuid`)).rejects.toThrow(/denied/u);
    await expect(as('worker', (tx) => tx.$executeRaw`DELETE FROM outbox`)).rejects.toThrow(/denied/u);
  });

  it('that still wait survive any purge', async () => {
    await add('officerA');
    const waiting = async () => (await rows<{ n: number }>('SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL'))[0]!.n;
    const before = await waiting();
    await as('retention', (tx) => tx.$executeRaw`DELETE FROM outbox`);
    expect(await waiting()).toBe(before);
  });

  it.each<[string, unknown]>([
    ['nothing', {}],
    ['an identifier', { caseId: '01a2125f-3eeb-7d5a-a7da-e46706b4e5a8' }],
    ['a code', { template: 'FORMAL_NOTICE', step: 'REMINDER_2' }],
    ['a small number and a flag', { count: 999999, zero: 0, urgent: true }],
  ])('accept %s', async (_what, payload) => {
    expect(await add('officerA', payload as Record<string, unknown>)).toMatchObject({ payload });
  });

  it.each<[string, unknown]>([
    ['an object inside', { a: { b: 'FORMAL_NOTICE' } }],
    ['an empty object inside', { a: {} }],
    ['a list', { a: ['FORMAL_NOTICE'] }],
    ['an empty list', { a: [] }],
    ['a list of identifiers', { a: ['01a2125f-3eeb-7d5a-a7da-e46706b4e5a8'] }],
    ['an empty value', { a: null }],
    ['a list instead of an object', ['FORMAL_NOTICE']],
    ['a text instead of an object', 'FORMAL_NOTICE'],
    ['a SIREN written as a number', { a: 800000001 }],
    ['a phone written as a number', { a: 33612345678 }],
    ['a number of seven digits', { a: 1000000 }],
    ['a decimal number', { a: 12.5 }],
    ['a negative number', { a: -1 }],
    ['digits in a text', { a: '123456' }],
    ['an access code', { a: 'KXPM' }],
    ['an access code in lower case', { a: 'kxpm' }],
    ['a sentence in capitals', { a: 'MISE EN DEMEURE' }],
    ['a code followed by a line', { a: 'FORMAL_NOTICE\nJean' }],
    ['a code followed by an empty line', { a: 'FORMAL_NOTICE\n' }],
    ['an identifier followed by something', { a: '01a2125f-3eeb-7d5a-a7da-e46706b4e5a8 Jean' }],
    ['two identifiers', { a: '01a2125f-3eeb-7d5a-a7da-e46706b4e5a8,01a2125f-3eeb-7d5a-a7da-e46706b4e5a8' }],
    ['an empty text', { a: '' }],
    ['a good value beside a bad one', { a: 'FORMAL_NOTICE', b: 'Jean Martin' }],
    ['a code that is too long', { a: 'A'.repeat(65) }],
  ])('refuse %s', async (_what, payload) => {
    await expect(add('officerA', payload as Record<string, unknown>)).rejects.toThrow(/outbox_payload_check|non-object/u);
  });

  // Defect: the names of the fields are not checked, so anything may hide there.
  it.fails.each([{ 'jean@exemple.test': true }, { 'Atelier Mistral': 1 }, { '0612345678': true }])(
    'refuse personal data as the name of a field: %j',
    async (payload) => {
      await expect(add('officerA', payload)).rejects.toThrow(/outbox_payload_check/u);
    },
  );

  // Defect: an IBAN, a VAT number or a letter reference has the shape of a code in capitals.
  it.fails.each(['FR7630006000011234567890189', 'FR12800000001', 'RIB_30006000011234567890189'])('refuse %s, which is not a code', async (value) => {
    await expect(add('officerA', { a: value })).rejects.toThrow(/outbox_payload_check/u);
  });
});

describe('identifiers', () => {
  it('are drawn at random, in the order of time', async () => {
    const found = await rows<{ id: string }>('SELECT app.uuid_v7()::text AS id FROM generate_series(1, 500)');
    for (const { id } of found) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(new Set(found.map((row) => row.id.slice(14))).size).toBe(500);
    const time = Number.parseInt(found[0]!.id.replace('-', '').slice(0, 12), 16);
    expect(Math.abs(Date.now() - time)).toBeLessThan(60_000);
    const [first] = await rows<{ id: string }>('SELECT app.uuid_v7()::text AS id');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [second] = await rows<{ id: string }>('SELECT app.uuid_v7()::text AS id');
    expect(first!.id < second!.id).toBe(true);
  });
});
