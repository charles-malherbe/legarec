import { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import { connect, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import type { Actor } from '../database/actor';
import { Database } from '../database/database';
import { createLogger } from '../logging/logger';
import { Storage } from '../storage/storage';
import { GiveUp, TryLater } from './errors';
import { mayActOn, startWorkers, type AuthorKind, type JobDefinition, type ScheduledHandlers } from './jobs';
import { maintenance, purge, scheduleMaintenance } from './maintenance';
import { Outbox, QUEUES, type QueueName, type Task } from './outbox';
import { OutboxPublisher } from './publisher';
import { connectValkey, whenReady, type Valkey } from './valkey';

let test: TestDatabase;
let s: Seed;
let api: Database;
let jobs: Database;
let valkey: Valkey;
const prefix = `test-${randomBytes(5).toString('hex')}`;
const logs: string[] = [];
const storage = new Storage(join(tmpdir(), `legarec-purge-${process.pid}`));
const logger = createLogger('debug', new Writable({ write: (chunk: Buffer, _encoding, done) => (logs.push(chunk.toString()), done()) }));
const stops: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  api = new Database(test.url('app'));
  jobs = new Database(test.url('jobs'));
  valkey = connectValkey(inject('valkeyUrl'), 'jobs');
});
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  await test.admin.query('DELETE FROM outbox');
  const keys = await valkey.keys(`${prefix}:*`);
  if (keys.length) await valkey.del(...keys);
  logs.length = 0;
});
afterAll(async () => {
  await Promise.all([api.close(), jobs.close()]);
  valkey.disconnect();
  await test.drop();
});

const publisher = () => {
  const instance = new OutboxPublisher(jobs, logger, valkey, prefix);
  stops.push(() => instance.stop());
  return instance;
};
const EVERYONE: AuthorKind[] = ['STAFF', 'CREDITOR', 'DEBTOR', 'SERVICE', 'HOOK', 'SYSTEM', 'ANONYMOUS'];
interface Options {
  from?: readonly AuthorKind[];
  repeatable?: boolean;
  scheduled?: ScheduledHandlers;
  database?: Database;
}
const work = (run: JobDefinition['run'], { from = EVERYONE, repeatable = true, scheduled, database = jobs }: Options = {}) => {
  const handlers = { maintenance: { sample: { from, repeatable, run } } };
  stops.push(startWorkers({ database, logger, connection: valkey, handlers, scheduled, prefix }).stop);
};
const queue = () => {
  const instance = new Queue('maintenance', { connection: valkey, prefix });
  stops.push(() => instance.close());
  return instance;
};
const until = async (condition: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timeout');
};
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.admin.query<T>(sql, values)).rows;
const pending = async () => (await rows<{ n: number }>('SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL'))[0]!.n;
const logged = (text: string) => logs.filter((line) => line.includes(text)).length;
const state = async () =>
  (
    await rows<{ published: boolean; started: boolean; done: boolean; failure: string | null }>(
      'SELECT published_at IS NOT NULL AS published, started_at IS NOT NULL AS started, done_at IS NOT NULL AS done, failure FROM outbox',
    )
  )[0]!;
const ended = () => until(async () => (await state()).done || (await state()).failure !== null);
/** As if the transaction that marks it as published had been lost, and Valkey emptied. */
const loseInValkey = async () => {
  await test.admin.query('UPDATE outbox SET published_at = NULL, claimed_at = NULL');
  for (const key of await inValkey()) await valkey.del(key);
};
/** Same number, put in Valkey by someone else. */
const forge = async () => {
  const [row] = await rows<{ id: string }>('SELECT id FROM outbox');
  await queue().add('sample', {}, { jobId: row!.id, removeOnComplete: true });
};
const always = () => Promise.resolve(true);
/** What Valkey holds of the tasks themselves. */
const inValkey = async () => (await valkey.keys(`${prefix}:maintenance:*`)).filter((key) => /:[0-9a-f]{8}-[0-9a-f-]{27}/u.test(key));
const actor = {
  officer: (): Actor => ({ kind: 'staff', userId: s.officerA, role: 'CLAIMS_OFFICER', delegations: [] }),
  director: (): Actor => ({ kind: 'staff', userId: s.director, role: 'DIRECTOR', delegations: [] }),
  partner: (): Actor => ({ kind: 'partner', userId: s.partnerA, creditorId: s.creditorA }),
  debtor: (): Actor => ({ kind: 'debtor', debtorId: s.debtorB }),
};
const add = (task: Partial<Task> = {}, author: Actor = actor.officer()) =>
  api.run(author, () => new Outbox(api).add({ queue: 'maintenance', name: 'sample', payload: {}, ...task }));

describe('outbox', () => {
  it('lists the same queues in the code and in the table', async () => {
    const [row] = await rows<{ definition: string }>("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'outbox_queue_check'");
    expect([...row!.definition.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1]).sort()).toEqual([...QUEUES].sort());
    await expect(add({ queue: 'unknown' as never })).rejects.toThrow(/outbox_queue_check/u);
  });

  it('never publishes a task of a transaction that failed', async () => {
    await api
      .run(actor.officer(), async () => {
        await new Outbox(api).add({ queue: 'maintenance', name: 'sample', payload: {} });
        throw new Error('rolled back');
      })
      .catch(() => undefined);
    expect(await publisher().publish()).toBe(0);
  });

  it('publishes each task once, even with several publishers', async () => {
    for (let i = 0; i < 30; i += 1) await add({ payload: { caseId: randomUUID() } });
    const counts = await Promise.all([publisher().publish(), publisher().publish(), publisher().publish()]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(30);
    expect(await pending()).toBe(0);
  });

  it('keeps a task planned for later in the table, and publishes it when its time has come', async () => {
    await add({ runAt: new Date(Date.now() + 3_600_000) });
    await add({ runAt: new Date(Date.now() - 1_000) });
    expect(await publisher().publish()).toBe(1);
    expect(await queue().getJobCounts('waiting', 'delayed')).toEqual({ waiting: 1, delayed: 0 });
    await test.admin.query("UPDATE outbox SET run_at = now() - interval '1 second' WHERE published_at IS NULL");
    expect(await publisher().publish()).toBe(1);
  });

  it('keeps a single task per key, before, after and long after its publication', async () => {
    const dedupeKey = `sample:${randomUUID()}`;
    expect(await add({ dedupeKey })).toBe(true);
    expect(await add({ dedupeKey })).toBe(false);
    expect(await publisher().publish()).toBe(1);
    expect(await add({ dedupeKey })).toBe(false);
    await test.admin.query("UPDATE outbox SET done_at = now() - interval '15 days'");
    await purge(jobs, logger, storage);
    expect(await rows('SELECT 1 FROM outbox')).toEqual([]);
    expect(await add({ dedupeKey })).toBe(false);
    expect(await publisher().publish()).toBe(0);
  });

  it('shares its keys within the team only: nobody takes the key of someone else', async () => {
    const dedupeKey = `sample:${randomUUID()}`;
    const application = () =>
      jobs.run({ kind: 'worker', job: 'x' }, () => new Outbox(jobs).add({ queue: 'maintenance', name: 'sample', payload: {}, dedupeKey }));
    for (const author of [actor.partner(), actor.debtor(), { kind: 'anonymous' } as Actor, { kind: 'hook' } as Actor]) {
      expect(await add({ dedupeKey }, author), author.kind).toBe(true);
      expect(await add({ dedupeKey }, author), author.kind).toBe(false);
    }
    expect(await add({ dedupeKey })).toBe(true);
    expect(await add({ dedupeKey }, actor.director())).toBe(false);
    expect(await application()).toBe(false);
    // Another account of the same creditor asks for the same thing; another task does not.
    expect(await add({ dedupeKey }, { ...actor.partner(), userId: s.partnerB, creditorId: s.creditorB } as Actor)).toBe(true);
    expect(await add({ dedupeKey, name: 'other' })).toBe(true);
  });

  it('publishes again, an hour later, what Valkey was given and that nothing has settled', async () => {
    for (const change of [
      "published_at = now() - interval '2 hours'",
      "published_at = now() - interval '2 hours', started_at = now()",
      "published_at = now() - interval '2 hours', done_at = now()",
      "published_at = now() - interval '2 hours', failed_at = now(), failure = 'TASK_FAILED'",
      'published_at = now()',
    ]) {
      await add();
      await test.admin.query(`UPDATE outbox SET ${change} WHERE published_at IS NULL`);
    }
    expect(await publisher().putBack()).toBe(2);
    expect(logged('tasks not settled')).toBe(1);
    expect(await publisher().putBack()).toBe(0);
    expect(await publisher().publish()).toBe(2);
  });

  it('checks by itself what Valkey may have lost', async () => {
    await add();
    await test.admin.query("UPDATE outbox SET published_at = now() - interval '2 hours'");
    const instance = publisher();
    instance.start(10);
    await until(async () => (await queue().getWaitingCount()) === 1);
    await instance.stop();
  });

  it('takes again, a minute later, a task lost between the table and Valkey', async () => {
    await add();
    await test.admin.query('UPDATE outbox SET claimed_at = now()');
    expect(await publisher().publish()).toBe(0);
    await test.admin.query("UPDATE outbox SET claimed_at = now() - interval '2 minutes'");
    expect(await publisher().publish()).toBe(1);
  });

  it('waits for Valkey without losing anything, nor holding the process that stops', async () => {
    await add();
    const away = connectValkey('redis://127.0.0.1:1/0', 'api');
    away.on('error', () => undefined);
    const broken = new OutboxPublisher(jobs, logger, away, prefix);
    const started = performance.now();
    await expect(broken.publish()).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(5_000);
    // Free at once: no need to wait for the end of the claim.
    expect(await rows('SELECT 1 FROM outbox WHERE published_at IS NULL AND claimed_at IS NULL')).toHaveLength(1);
    await broken.stop();
    away.disconnect();
    expect(await publisher().publish()).toBe(1);
  }, 20_000);

  it('starts by itself, and stops when asked to', async () => {
    const instance = publisher();
    instance.start(10);
    await add();
    await until(async () => (await pending()) === 0);
    await instance.stop();
    await add();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await pending()).toBe(1);
  });
});

describe('a task', () => {
  it('runs once, even delivered twice or published again', async () => {
    const seen: string[] = [];
    work(async () => void seen.push('run'));
    await add();
    expect(await publisher().publish()).toBe(1);
    await until(async () => (await state()).done && logged('task done') === 1);
    await loseInValkey();
    expect(await publisher().publish()).toBe(1);
    // The second delivery has ended too: without the table, it would have run.
    await until(() => logged('task done') === 2);
    expect(seen).toEqual(['run']);
  });

  it.each([
    ['planned for later', "run_at = now() + interval '1 day'"],
    ['abandoned', "failed_at = now(), failure = 'TASK_FAILED'"],
    ['done', 'done_at = now()'],
  ])('does not run because its number is put in Valkey: %s', async (_what, change) => {
    const seen: string[] = [];
    work(async () => void seen.push('run'));
    await add();
    await test.admin.query(`UPDATE outbox SET ${change}`);
    const before = await rows('SELECT * FROM outbox');
    await forge();
    await until(() => logged('task done') === 1);
    expect(seen).toEqual([]);
    expect(await rows('SELECT * FROM outbox')).toEqual(before);
  });

  it('leaves nothing in Valkey once it is done or abandoned', async () => {
    let fail = false;
    work(() => (fail ? Promise.reject(new GiveUp('REFUSED')) : Promise.resolve()));
    for (const outcome of [false, true]) {
      fail = outcome;
      await add();
      await publisher().publish();
      await until(async () => (await rows('SELECT 1 FROM outbox WHERE done_at IS NULL AND failed_at IS NULL')).length === 0);
      await until(async () => (await inValkey()).length === 0);
    }
  });

  it('follows the order in which they were queued', async () => {
    const seen: unknown[] = [];
    for (let step = 1; step <= 5; step += 1) {
      await add({ payload: { step } });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await publisher().publish();
    work(async ({ payload }) => void seen.push(payload.step));
    await until(() => seen.length === 5);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('is tried again later, a limited number of times, then kept as abandoned', async () => {
    let tries = 0;
    work(() => ((tries += 1), Promise.reject(new Error('refused'))));
    const later = queue();
    await add();
    await publisher().publish();
    await until(async () => (await later.getDelayedCount()) === 1);
    const [job] = await later.getDelayed();
    expect(job).toMatchObject({ attemptsMade: 1, opts: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } } });
    for (let i = 2; i <= 5; i += 1) {
      await (await later.getDelayed())[0]!.promote();
      await until(() => tries === i);
      if (i < 5) await until(async () => (await later.getDelayedCount()) === 1);
    }
    await ended();
    expect(await state()).toMatchObject({ done: false, failure: 'TASK_FAILED' });
    expect(logged('task abandoned')).toBe(1);
  });

  it('is not tried again when that would change nothing', async () => {
    let tries = 0;
    work(() => ((tries += 1), Promise.reject(new GiveUp('FIRM_INCOMPLETE'))));
    await add();
    await publisher().publish();
    await ended();
    expect([tries, (await state()).failure]).toEqual([1, 'FIRM_INCOMPLETE']);
  });

  it('waits in the table for a worker that knows it', async () => {
    const seen: string[] = [];
    await add();
    await publisher().publish();
    stops.push(startWorkers({ database: jobs, logger, connection: valkey, handlers: { maintenance: {} }, prefix }).stop);
    await until(async () => !(await state()).published);
    expect(await state()).toMatchObject({ started: false, done: false, failure: null });
    expect(logged('task unknown')).toBe(1);
    for (const stop of stops.splice(0)) await stop();
    work(async () => void seen.push('run'));
    expect(await publisher().publish()).toBe(0);
    await test.admin.query("UPDATE outbox SET claimed_at = now() - interval '2 minutes'");
    expect(await publisher().publish()).toBe(1);
    await ended();
    expect(seen).toEqual(['run']);
  });

  /** Every try but the last one, at once rather than after its delay. */
  const tryAgain = async (tries: () => number) => {
    const later = queue();
    for (let i = 1; i <= 5; i += 1) {
      await until(() => tries() === i);
      if (i === 5) break;
      await until(async () => (await later.getDelayedCount()) === 1);
      await (await later.getDelayed())[0]!.promote();
    }
    await until(async () => (await inValkey()).length === 0);
  };

  it('is never given up because the database was away: it comes back by itself', async () => {
    const seen: string[] = [];
    let cuts = 0;
    let away = true;
    const shaky = Object.create(jobs) as Database;
    shaky.run = ((who: Actor, ...rest: [never]) => {
      if (who.kind !== 'staff' || !away) return jobs.run(who, ...rest);
      cuts += 1;
      return Promise.reject(new Error('Connection terminated'));
    }) as Database['run'];
    work(async () => void seen.push('run'), { repeatable: false, database: shaky });
    await add();
    await publisher().publish();
    await tryAgain(() => cuts);
    expect([await state(), logged('task abandoned')]).toEqual([{ published: true, started: false, done: false, failure: null }, 0]);
    away = false;
    await test.admin.query("UPDATE outbox SET published_at = now() - interval '2 hours'");
    expect(await publisher().putBack()).toBe(1);
    await publisher().publish();
    await ended();
    expect([seen, (await state()).failure]).toEqual([['run'], null]);
  });

  it.each([false, true])('is never given up while nothing has left (repeatable: %s)', async (repeatable) => {
    let tries = 0;
    work(() => ((tries += 1), Promise.reject(new TryLater('PROVIDER_AWAY'))), { repeatable });
    await add();
    await publisher().publish();
    await tryAgain(() => tries);
    expect([await state(), logged('task abandoned')]).toEqual([{ published: true, started: false, done: false, failure: null }, 0]);
  });

  it('leaves nothing in Valkey but its number, and nothing in the logs', async () => {
    work(() => Promise.reject(new Error('550 <jean@exemple.test> KXPM refused')));
    await add({ payload: { caseId: s.cases.ofA, template: 'FORMAL_NOTICE' } });
    await publisher().publish();
    await until(() => logs.some((line) => line.includes('task failed')));
    const jobKeys = await inValkey();
    expect(jobKeys).toHaveLength(1);
    const [stored] = await Promise.all(jobKeys.map((key) => valkey.hgetall(key)));
    expect(stored).toMatchObject({ data: '{}', failedReason: 'TASK_FAILED' });
    const all = JSON.stringify(stored) + logs.join('');
    // More than digits: the number of the task may hold any of them.
    for (const hidden of ['jean@', 'KXPM', '550 <', 'FORMAL_NOTICE', s.cases.ofA, s.officerA, 'Alba', ' at ']) expect(all).not.toContain(hidden);
  });

  it.each([
    ['an unknown number', { id: randomUUID() }],
    ['something that is not a number', { id: 'jean' }],
    ['its own author', { id: 'x1', data: { actorId: 'x', payload: {} } }],
  ])('cannot be invented in Valkey with %s', async (_what, { id, data }: { id: string; data?: object }) => {
    const seen: string[] = [];
    work(async () => void seen.push('run'));
    const forged = queue();
    await forged.add('sample', data ?? {}, { jobId: id });
    await until(async () => (await forged.getFailedCount()) === 1);
    expect((await forged.getFailed())[0]!.failedReason).toBe('UNKNOWN_TASK');
    expect(seen).toEqual([]);
  });

  it('stays in its queue: a number put in another one does nothing to it', async () => {
    const seen: string[] = [];
    work(async () => void seen.push('run'));
    await add({ queue: 'sms' });
    const here = queue();
    await here.add('sample', {}, { jobId: (await rows<{ id: string }>('SELECT id FROM outbox'))[0]!.id });
    await until(async () => (await here.getFailedCount()) === 1);
    expect(seen).toEqual([]);
    expect(await state()).toMatchObject({ started: false, done: false, failure: null });
  });
});

describe('a task that must not run twice', () => {
  const once = (run: JobDefinition['run']) => work(run, { repeatable: false });

  it('has a single try: whatever stops it, nobody knows what has left', async () => {
    let tries = 0;
    once(() => ((tries += 1), Promise.reject(Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }))));
    await add();
    await publisher().publish();
    await ended();
    expect([tries, (await state()).failure]).toEqual([1, 'UNCERTAIN']);
    // Given up at once, not at a second delivery.
    expect([logged('task failed'), logged('task abandoned')]).toEqual([0, 1]);
  });

  it.each([
    [false, { done: false, failure: 'UNCERTAIN' }, 0],
    [true, { done: true, failure: null }, 1],
  ])('is uncertain when its worker was stopped in the middle (repeatable: %s)', async (repeatable, expected, runs) => {
    const seen: string[] = [];
    await add();
    await test.admin.query('UPDATE outbox SET started_at = now()');
    work(async () => void seen.push('run'), { repeatable });
    await publisher().publish();
    await ended();
    expect(await state()).toMatchObject(expected);
    expect(seen).toHaveLength(runs);
  });

  it('does not run next to itself when its lock is lost, and is done once it ends', async () => {
    let finish = () => {};
    let runs = 0;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const run = () => ((runs += 1), gate);
    once(run);
    await add();
    await publisher().publish();
    await until(() => runs === 1);
    await loseInValkey();
    once(run);
    await publisher().publish();
    await until(async () => (await state()).failure === 'UNCERTAIN');
    finish();
    await until(async () => (await state()).done);
    expect([runs, (await state()).failure]).toEqual([1, null]);
  });

  it('is tried again when it says that nothing has left', async () => {
    let tries = 0;
    once(() => ((tries += 1), tries === 1 ? Promise.reject(new TryLater('PROVIDER_AWAY')) : Promise.resolve()));
    const later = queue();
    await add();
    await publisher().publish();
    await until(async () => (await later.getDelayedCount()) === 1);
    expect(await state()).toMatchObject({ started: false, failure: null });
    await (await later.getDelayed())[0]!.promote();
    await ended();
    expect([tries, (await state()).done]).toEqual([2, true]);
  });

  it.each(['email', 'letter', 'sms', 'staff-email', 'reminders'] satisfies QueueName[])('is every task of the queue %s, whatever its definition says', (name) => {
    const handlers = { [name]: { send: { from: EVERYONE, repeatable: true, run: () => Promise.resolve() } } };
    expect(() => startWorkers({ database: jobs, logger, connection: valkey, handlers, prefix })).toThrow(`Never repeatable in the queue ${name}: send`);
  });

  it('does not share its name with a schedule, that would run in its place', () => {
    const handlers = { maintenance: { purge: { from: EVERYONE, repeatable: true, run: () => Promise.resolve() } } };
    const scheduled = maintenance(jobs, logger, storage);
    expect(() => startWorkers({ database: jobs, logger, connection: valkey, handlers, scheduled, prefix })).toThrow(
      'Both a task and a schedule in the queue maintenance: purge',
    );
  });
});

describe('rights of a task', () => {
  const counting = (from?: readonly AuthorKind[]) => {
    const seen: number[][] = [];
    const run: JobDefinition['run'] = async ({ asAuthor, authorize }) => {
      const asApplication = await authorize(always);
      seen.push(await Promise.all([asAuthor((tx) => tx.case.count()), asApplication((tx) => tx.case.count())]));
    };
    work(run, { from });
    return seen;
  };
  const refused = async (seen: unknown[], reason: string) => {
    await publisher().publish();
    await ended();
    expect((await state()).failure).toBe(reason);
    expect(seen).toEqual([]);
  };

  it.each<[string, () => Actor, number]>([
    ['a collaborator', actor.officer, 1],
    ['the Director', actor.director, 4],
    ['a creditor', actor.partner, 2],
    ['a debtor', actor.debtor, 1],
  ])('are those of its author: %s', async (_who, author, visible) => {
    const seen = counting();
    await add({}, author());
    await publisher().publish();
    await until(() => seen.length === 1);
    // The application itself would see the four cases.
    expect(seen).toEqual([[visible, 4]]);
  });

  it('are those of a service account, which is not the application', async () => {
    const seen: unknown[] = [];
    work(
      async ({ asAuthor }) =>
        void seen.push(await asAuthor((tx) => tx.$queryRaw`SELECT current_user::text AS role, app.setting('service') IS NOT NULL AS named`)),
    );
    await add({}, { kind: 'service', accountId: randomUUID(), scopes: [] });
    await publisher().publish();
    await until(() => seen.length === 1);
    expect(seen).toEqual([[{ role: 'legarec_service', named: true }]]);
  });

  it.each<[string, (add: () => Promise<boolean>) => Promise<boolean>]>([
    ['a provider', () => add({}, { kind: 'hook' })],
    ['the sign-in page', () => add({}, { kind: 'anonymous' })],
    ['the application', () => jobs.run({ kind: 'worker', job: 'x' }, () => new Outbox(jobs).add({ queue: 'maintenance', name: 'sample', payload: {} }))],
  ])('belong to nobody when nobody had signed in: %s', async (_who, start) => {
    const seen: unknown[] = [];
    work(async ({ asAuthor, authorize }) => {
      // There is nobody to check.
      const asApplication = await authorize(() => Promise.reject(new Error('asked')));
      seen.push(await asApplication((tx) => tx.case.count()));
      await asAuthor((tx) => tx.case.count());
    });
    await start(() => add());
    await publisher().publish();
    await ended();
    expect([seen, (await state()).failure]).toEqual([[4], 'NO_AUTHOR']);
  });

  it.each<[string, () => Actor, keyof Seed['cases'], boolean]>([
    ['an officer on their case', actor.officer, 'ofA', true],
    ['an officer on the case of another', actor.officer, 'ofB', false],
    ['the Director on their case', actor.director, 'ofDirector', true],
    // Seen, but not theirs: reading does not prove the right to act.
    ['the Director on the case of an officer', actor.director, 'ofA', false],
  ])('open those of the application only to who may act: %s', async (_who, author, target, allowed) => {
    const seen: number[] = [];
    work(async ({ authorize }) => {
      const asApplication = await authorize(mayActOn(s.cases[target]));
      seen.push(await asApplication((tx) => tx.case.count()));
    });
    await add({}, author());
    await publisher().publish();
    await ended();
    expect([seen, (await state()).failure]).toEqual(allowed ? [[4], null] : [[], 'NOT_ALLOWED']);
  });

  it('stay open once checked: what has left is recorded, whatever has changed meanwhile', async () => {
    const seen: unknown[] = [];
    const give = (officer: string) => test.admin.query('UPDATE cases SET officer_id = $2 WHERE id = $1', [s.cases.ofA, officer]);
    work(async ({ authorize }) => {
      const asApplication = await authorize(mayActOn(s.cases.ofA));
      await give(s.officerB);
      seen.push(await asApplication((tx) => tx.$executeRaw`UPDATE cases SET first_letter_on = '2026-11-21' WHERE id = ${s.cases.ofA}::uuid`));
      await authorize(mayActOn(s.cases.ofA));
      seen.push('allowed again');
    });
    await add();
    await publisher().publish();
    try {
      await ended();
      expect([seen, (await state()).failure]).toEqual([[1], 'NOT_ALLOWED']);
    } finally {
      await give(s.officerA);
    }
  });

  it('are read when it runs: a case given to someone else since is out of reach', async () => {
    const seen = counting();
    await add();
    await test.admin.query('UPDATE cases SET officer_id = $2 WHERE id = $1', [s.cases.ofA, s.officerB]);
    try {
      await publisher().publish();
      await until(() => seen.length === 1);
      expect(seen).toEqual([[0, 4]]);
    } finally {
      await test.admin.query('UPDATE cases SET officer_id = $2 WHERE id = $1', [s.cases.ofA, s.officerA]);
    }
  });

  it.each<[string, () => Actor, string, string, (seeded: Seed) => unknown[]]>([
    [
      'disabled since',
      actor.officer,
      "UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1",
      "UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1",
      (seeded) => [seeded.officerA],
    ],
    [
      'who has become a creditor account',
      actor.officer,
      "UPDATE users SET role = 'CREDITOR', creditor_id = $2 WHERE id = $1",
      "UPDATE users SET role = 'CLAIMS_OFFICER', creditor_id = NULL WHERE id = $1 AND $2::uuid IS NOT NULL",
      (seeded) => [seeded.officerA, seeded.creditorA],
    ],
    [
      'whose portal was closed',
      actor.partner,
      'UPDATE creditors SET portal_enabled = false WHERE id = $1',
      'UPDATE creditors SET portal_enabled = true WHERE id = $1',
      (seeded) => [seeded.creditorA],
    ],
  ])('are refused to an author %s', async (_what, author, change, restore, values) => {
    const seen = counting();
    await add({}, author());
    await test.admin.query(change, values(s));
    try {
      await refused(seen, 'AUTHOR_GONE');
    } finally {
      await test.admin.query(restore, values(s));
    }
  });

  it('keep the delegation they rest on, and stop with it', async () => {
    const delegate: Actor = { kind: 'staff', userId: s.manager, role: 'COLLECTION_MANAGER', delegations: ['ADMINISTRATIVE'], actingFor: 'ADMINISTRATIVE' };
    const seen: unknown[] = [];
    work(async ({ asAuthor }) => void seen.push(await asAuthor((tx) => tx.$queryRaw`SELECT app.on_behalf_of() AS director`)));
    await add({}, delegate);
    await publisher().publish();
    await until(() => seen.length === 1);
    expect(seen).toEqual([[{ director: s.director }]]);
    seen.length = 0;
    await test.admin.query('DELETE FROM outbox');
    await add({}, delegate);
    await test.admin.query("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = $1 WHERE kind = 'ADMINISTRATIVE'", [s.director]);
    try {
      await refused(seen, 'AUTHOR_GONE');
    } finally {
      await test.admin.query("INSERT INTO delegations (kind, granted_by) VALUES ('ADMINISTRATIVE', $1)", [s.director]);
    }
  });

  it.each<[AuthorKind, () => Actor]>([
    ['CREDITOR', actor.partner],
    ['DEBTOR', actor.debtor],
    ['ANONYMOUS', () => ({ kind: 'anonymous' })],
    ['HOOK', () => ({ kind: 'hook' })],
    ['SERVICE', () => ({ kind: 'service', accountId: randomUUID(), scopes: [] })],
  ])('are refused to %s when the task is not meant for them', async (kind, author) => {
    const seen = counting(EVERYONE.filter((item) => item !== kind));
    await add({}, author());
    await refused(seen, 'AUTHOR_REFUSED');
  });
});

describe('purge', () => {
  it('removes what is out of date, and only that, and keeps the counts', async () => {
    // A deposit decided 31 days ago goes; one decided yesterday, and one still waiting, stay (question 155).
    await test.admin.query(
      `INSERT INTO claim_deposits (creditor_id, deposited_by, status, reason, decided_by, decided_at, total_cents, invoice_count) VALUES
         ($1, $2, 'REFUSED', 'Motif du refus', $3, now() - interval '31 days', 1, 1), ($1, $2, 'REFUSED', 'Motif du refus', $3, now() - interval '1 day', 1, 1)`,
      [s.creditorA, s.partnerA, s.director],
    );
    await test.admin.query(
      `INSERT INTO claim_deposits (creditor_id, deposited_by, debtor_name, invoices, total_cents, invoice_count)
       VALUES ($1, $2, 'X', '[{"number":"N","issuedOn":"2026-01-01","dueOn":"2026-02-01","amount":1}]', 1, 1)`,
      [s.creditorA, s.partnerA],
    );
    await test.admin.query(`
      INSERT INTO idempotency_keys (actor, key, route, request_hash, created_at) VALUES
        ('user:x', gen_random_uuid(), 'r', '\\x00', now() - interval '49 hours'), ('user:x', gen_random_uuid(), 'r', '\\x00', now() - interval '47 hours');
      INSERT INTO webhook_events (provider, provider_event_id, status, received_at) VALUES
        ('RESEND', 'old', 'PROCESSED', now() - interval '61 days'), ('RESEND', 'late', 'RECEIVED', now() - interval '61 days'), ('RESEND', 'new', 'PROCESSED', now() - interval '59 days');
      INSERT INTO outbox (queue, name, payload, actor_kind, published_at, done_at, failed_at, failure) VALUES
        ('sms', 'x-x', '{}', 'SYSTEM', now(), now() - interval '15 days', NULL, NULL), ('sms', 'x-x', '{}', 'SYSTEM', now(), NULL, now() - interval '61 days', 'TASK_FAILED'),
        ('sms', 'x-x', '{}', 'SYSTEM', now(), now() - interval '13 days', NULL, NULL), ('sms', 'x-x', '{}', 'SYSTEM', now(), NULL, now() - interval '59 days', 'TASK_FAILED'), ('sms', 'x-x', '{}', 'SYSTEM', now() - interval '90 days', NULL, NULL, NULL),
        ('sms', 'x-x', '{}', 'SYSTEM', NULL, NULL, NULL, NULL);
      DELETE FROM task_keys;
      INSERT INTO task_keys (owner, name, key, task_id, created_at) VALUES
        ('team', 'x-x', 'x-x:00000000-0000-0000-0000-000000000001', gen_random_uuid(), now() - interval '25 months'),
        ('team', 'x-x', 'x-x:00000000-0000-0000-0000-000000000002', gen_random_uuid(), now() - interval '23 months'),
        ('team', 'x-x', 'x-x:00000000-0000-0000-0000-000000000003', (SELECT id FROM outbox WHERE published_at IS NULL), now() - interval '25 months');
      INSERT INTO audit_log (occurred_at, actor_kind, actor_label, action) VALUES
        (now() - interval '13 months', 'SYSTEM', 'Application', 'OLD_ENTRY'), (now() - interval '11 months', 'SYSTEM', 'Application', 'KEPT_ENTRY');`);
    const counts = {
      audit: 1,
      idempotency: 1,
      outbox: 2,
      'task-keys': 1,
      webhooks: 1,
      'sign-ins': 0,
      accounts: 0,
      notifications: 0,
      'support-tickets': 0,
      'claim-imports': 0,
      'claim-deposits': 1,
      'creditor-files': 0,
      'case-history': 0,
      'credit-note-drafts': 0,
      'limited-messages': 0,
      'task-marks': 0,
      'ai-suggestions': 0,
      'gdpr-requests': 0,
      cases: 0,
      remittances: 0,
      invoices: 0,
      payments: 0,
      'accounting-documents': 0,
      'document-files': 0,
    };
    expect(await purge(jobs, logger, storage)).toEqual(counts);
    expect(await rows('SELECT action FROM audit_log')).toEqual([{ action: 'KEPT_ENTRY' }]);
    const kept = await rows<{ kind: string; removed: number }>('SELECT kind, removed FROM retention_runs ORDER BY ran_at DESC LIMIT 24');
    expect(Object.fromEntries(kept.map((row) => [row.kind, row.removed]))).toEqual(counts);
    // The key of a task still to come is kept, however old it is.
    expect(await rows('SELECT right(key, 1) AS key FROM task_keys ORDER BY key')).toEqual([{ key: '2' }, { key: '3' }]);
  });

  it('goes on when one of its steps fails, and says so', async () => {
    await test.admin.query('REVOKE DELETE ON idempotency_keys FROM legarec_retention');
    await test.admin.query("INSERT INTO outbox (queue, name, payload, actor_kind, done_at) VALUES ('sms', 'x-x', '{}', 'SYSTEM', now() - interval '15 days')");
    try {
      await expect(purge(jobs, logger, storage)).rejects.toThrow('PURGE_FAILED');
      expect(await rows('SELECT 1 FROM outbox')).toEqual([]);
      expect(logs.join('')).toContain('purge failed');
    } finally {
      await test.admin.query('GRANT DELETE ON idempotency_keys TO legarec_retention');
    }
  });

  it('is scheduled once, whatever the number of workers, and runs from the queue', async () => {
    work(async () => undefined, { scheduled: maintenance(jobs, logger, storage) });
    await Promise.all([scheduleMaintenance(valkey, prefix), scheduleMaintenance(valkey, prefix)]);
    // The purge, and the sweep of the files without a row.
    expect(await valkey.zcard(`${prefix}:maintenance:repeat`)).toBe(2);
    await queue().add('purge', {});
    await until(() => logged('purge done') === 24);
  });

  it('is out of reach of the HTTP API', async () => {
    await expect(purge(api, logger, storage)).rejects.toThrow('PURGE_FAILED');
    await expect(api.run({ kind: 'retention' }, (tx) => tx.$queryRaw`SELECT 1`)).rejects.toThrow(/permission denied to set role/u);
  });

  it('looks after something else too, whatever becomes of the purge, and says which one has failed', async () => {
    const done: string[] = [];
    const night = (database: Database, after: () => Promise<void>) => maintenance(database, logger, storage, after).maintenance!.purge!();
    await night(jobs, () => Promise.resolve(void done.push('after')));
    // The API has no right to purge.
    await expect(night(api, () => Promise.resolve(void done.push('after')))).rejects.toThrow('PURGE_FAILED');
    expect(done).toEqual(['after', 'after']);
    await expect(night(jobs, () => Promise.reject(new TypeError('NIGHT')))).rejects.toThrow('NIGHT');
    expect(logs.join('')).toContain('night task failed');
  });
});

describe('connection to Valkey', () => {
  it('refuses at once when Valkey is away, rather than holding a request', async () => {
    const away = connectValkey('redis://127.0.0.1:1/0', 'api');
    away.on('error', () => undefined);
    const started = performance.now();
    await expect(away.ping()).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(2_000);
    away.disconnect();
  });

  it('is waited for by the worker, however late it comes', async () => {
    const real = new URL(inject('valkeyUrl'));
    const server = createServer((socket) => {
      const there = connect(Number(real.port), real.hostname);
      socket.pipe(there).pipe(socket);
      for (const end of [socket, there]) end.on('error', () => undefined);
    });
    // A port that nobody holds yet.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    const url = new URL(real);
    url.port = String(port);
    const late = connectValkey(url.href, 'jobs');
    late.on('error', () => undefined);
    let ready = false;
    const waiting = whenReady(late).then(() => (ready = true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(ready).toBe(false);
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    await waiting;
    expect(await late.ping()).toBe('PONG');
    await whenReady(late);
    late.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  it('tells when a queue is no longer read, so that the process starts again', async () => {
    const away = connectValkey('redis://127.0.0.1:1/0', 'jobs');
    away.on('error', () => undefined);
    const dead: string[] = [];
    const handlers = { maintenance: { sample: { from: EVERYONE, repeatable: true, run: () => Promise.resolve() } } };
    const workers = startWorkers({ database: jobs, logger, connection: away, handlers, prefix, onDead: (name) => dead.push(name) });
    await until(() => dead.length === 1);
    expect(dead).toEqual(['maintenance']);
    expect(logged('queue no longer read')).toBe(1);
    away.disconnect();
    await Promise.race([workers.stop(), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  });
});
