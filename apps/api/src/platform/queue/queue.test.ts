import { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import { Database } from '../database/database';
import { createLogger } from '../logging/logger';
import { startWorkers, type JobHandlers } from './jobs';
import { maintenanceHandlers, purge, scheduleMaintenance } from './maintenance';
import { Outbox } from './outbox';
import { OutboxPublisher } from './publisher';
import { connectValkey, type Valkey } from './valkey';

let test: TestDatabase;
let s: Seed;
let api: Database;
let jobs: Database;
let valkey: Valkey;
const prefix = `test-${randomBytes(5).toString('hex')}`;
const logs: string[] = [];
const logger = createLogger('debug', new Writable({ write: (chunk: Buffer, _encoding, done) => (logs.push(chunk.toString()), done()) }));
const stops: (() => Promise<void>)[] = [];

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
const work = (handlers: JobHandlers) => {
  const workers = startWorkers({ database: jobs, logger, connection: valkey, handlers, prefix });
  stops.push(workers.stop);
};
const until = async (condition: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timeout');
};
const officer = () => ({ kind: 'staff' as const, userId: s.officerA, role: 'CLAIMS_OFFICER' as const, delegations: [] });
const queueTask = (payload: Record<string, string>, dedupeKey?: string) =>
  api.run(officer(), () => new Outbox(api).add({ queue: 'maintenance', name: 'sample', payload, dedupeKey }));

describe('outbox and queues', () => {
  it('run a committed task once, with the rights of its author', async () => {
    const seen: number[] = [];
    work({ maintenance: { sample: async ({ run }) => void seen.push(await run((tx) => tx.case.count())) } });
    await queueTask({ caseId: s.cases.ofA });
    expect(await publisher().publish()).toBe(1);
    await until(() => seen.length === 1);
    // The author sees one case only; the worker itself would see four.
    expect(seen).toEqual([1]);
  });

  it('never publish a task of a transaction that failed', async () => {
    await api
      .run(officer(), async () => {
        await new Outbox(api).add({ queue: 'maintenance', name: 'sample', payload: {} });
        throw new Error('rolled back');
      })
      .catch(() => undefined);
    expect(await publisher().publish()).toBe(0);
  });

  it('publish each task once, even with several publishers', async () => {
    for (let i = 0; i < 30; i += 1) await queueTask({ caseId: randomUUID() });
    const counts = await Promise.all([publisher().publish(), publisher().publish(), publisher().publish()]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(30);
  });

  it('keep a single task per dedupe key', async () => {
    const key = `sample:${randomUUID()}`;
    await queueTask({ caseId: s.cases.ofA }, key);
    await queueTask({ caseId: s.cases.ofA }, key);
    expect(await publisher().publish()).toBe(1);
  });

  it('stop a task whose author has been disabled since', async () => {
    const seen: string[] = [];
    work({ maintenance: { sample: async () => void seen.push('run') } });
    await queueTask({ caseId: s.cases.ofA });
    await test.admin.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.officerA]);
    await publisher().publish();
    await until(() => logs.some((line) => line.includes('task failed')));
    await test.admin.query("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.officerA]);
    expect(seen).toEqual([]);
  });

  it('leave identifiers only in Valkey and in the logs', async () => {
    work({ maintenance: { sample: () => Promise.reject(new Error('jean@exemple.test refused')) } });
    await queueTask({ caseId: s.cases.ofA, kind: 'FORMAL_NOTICE' });
    await publisher().publish();
    await until(async () => (await valkey.keys(`${prefix}:maintenance:*`)).length > 0);
    const jobKeys = (await valkey.keys(`${prefix}:maintenance:*`)).filter((key) => /:[0-9a-f-]{36}$/u.test(key));
    const stored = JSON.stringify(await Promise.all(jobKeys.map((key) => valkey.hgetall(key))));
    expect(stored).toContain('FORMAL_NOTICE');
    for (const hidden of ['Débiteur', 'ALPHA', 'Alba', '800000001', 'LGR-']) expect(stored).not.toContain(hidden);
    expect(logs.join('')).not.toContain('jean@exemple.test');
  });

  it('wait for Valkey without losing anything', async () => {
    await queueTask({ caseId: s.cases.ofA });
    const away = connectValkey('redis://127.0.0.1:1/0', 'api');
    away.on('error', () => undefined);
    const broken = new OutboxPublisher(jobs, logger, away, prefix);
    await expect(Promise.race([broken.publish(), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('refused')), 3_000))])).rejects.toThrow();
    away.disconnect();
    const { rows } = await test.admin.query('SELECT 1 FROM outbox WHERE published_at IS NULL');
    expect(rows).toHaveLength(1);
  });
});

describe('purge', () => {
  it('removes what is out of date, and only that', async () => {
    await test.admin.query(`
      INSERT INTO idempotency_keys (actor, key, route, request_hash, created_at) VALUES
        ('user:x', gen_random_uuid(), 'r', '\\x00', now() - interval '25 hours'), ('user:x', gen_random_uuid(), 'r', '\\x00', now());
      INSERT INTO webhook_events (provider, provider_event_id, status, received_at) VALUES
        ('RESEND', 'old', 'PROCESSED', now() - interval '31 days'), ('RESEND', 'late', 'RECEIVED', now() - interval '31 days'), ('RESEND', 'new', 'PROCESSED', now());
      INSERT INTO outbox (queue, name, payload, published_at) VALUES ('sms', 'x-x', '{}', now() - interval '8 days'), ('sms', 'x-x', '{}', NULL);
      INSERT INTO audit_log (occurred_at, actor_kind, actor_label, action, summary) VALUES
        (now() - interval '13 months', 'SYSTEM', 'Application', 'OLD_ENTRY', 'x'), (now() - interval '11 months', 'SYSTEM', 'Application', 'KEPT_ENTRY', 'x');`);
    expect(await purge(jobs)).toEqual({ audit: 1, idempotency: 1, outbox: 1, webhooks: 1 });
    const { rows } = await test.admin.query<{ action: string }>('SELECT action FROM audit_log');
    expect(rows).toEqual([{ action: 'KEPT_ENTRY' }]);
  });

  it('is scheduled once, whatever the number of workers', async () => {
    work(maintenanceHandlers(jobs, logger));
    await Promise.all([scheduleMaintenance(valkey, prefix), scheduleMaintenance(valkey, prefix)]);
    expect(await valkey.zcard(`${prefix}:maintenance:repeat`)).toBe(1);
  });

  it('is out of reach of the HTTP API', async () => {
    await expect(purge(api)).rejects.toThrow(/permission denied to set role/u);
  });
});

describe('delivery of a task', () => {
  const queue = (name = 'maintenance') => {
    const instance = new Queue(name, { connection: valkey, prefix });
    stops.push(() => instance.close());
    return instance;
  };
  const pending = async () => (await test.admin.query<{ n: number }>('SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL')).rows[0]!.n;
  const add = (task: Partial<Parameters<Outbox['add']>[0]> = {}) =>
    api.run(officer(), () => new Outbox(api).add({ queue: 'maintenance', name: 'sample', payload: {}, ...task }));
  const failed = () => logs.filter((line) => line.includes('task failed')).length;

  it('happens once when the publisher stops between Valkey and PostgreSQL, then starts again', async () => {
    await add();
    expect(await publisher().publish()).toBe(1);
    // As if the transaction that marks the task as published had been lost.
    await test.admin.query('UPDATE outbox SET published_at = NULL');
    expect(await publisher().publish()).toBe(1);
    const waiting = queue();
    expect(await waiting.getJobCountByTypes('waiting', 'delayed', 'active', 'completed')).toBe(1);
    const seen: string[] = [];
    work({ maintenance: { sample: async () => void seen.push('run') } });
    await until(async () => (await waiting.getCompletedCount()) === 1);
    expect(seen).toEqual(['run']);
  });

  it('waits for the time asked for, and does not wait for a time already past', async () => {
    const later = queue();
    await add({ runAt: new Date(Date.now() + 3_600_000) });
    expect(await publisher().publish()).toBe(1);
    expect(await later.getJobCounts('waiting', 'delayed')).toEqual({ waiting: 0, delayed: 1 });
    const [job] = await later.getDelayed();
    expect(job!.opts.delay).toBeGreaterThan(3_590_000);
    expect(job!.opts.delay).toBeLessThanOrEqual(3_600_000);
    await add({ runAt: new Date(Date.now() - 3_600_000) });
    expect(await publisher().publish()).toBe(1);
    expect(await later.getJobCounts('waiting', 'delayed')).toEqual({ waiting: 1, delayed: 1 });
  });

  it('is tried again later after a failure, a limited number of times', async () => {
    let tries = 0;
    work({ maintenance: { sample: () => ((tries += 1), Promise.reject(new Error('refused'))) } });
    const later = queue();
    await add();
    await publisher().publish();
    await until(async () => (await later.getDelayedCount()) === 1);
    const [job] = await later.getDelayed();
    expect(job).toMatchObject({ attemptsMade: 1, opts: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } } });
    expect(tries).toBe(1);
  });

  it('follows the order of the tasks', async () => {
    const seen: unknown[] = [];
    for (let step = 1; step <= 5; step += 1) {
      await add({ payload: { step } });
      // Kept to the millisecond by PostgreSQL.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await publisher().publish();
    work({ maintenance: { sample: async ({ payload }) => void seen.push(payload.step) } });
    await until(() => seen.length === 5);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps a single task per key, even once the first one has been published', async () => {
    const dedupeKey = `sample:${randomUUID()}`;
    await add({ dedupeKey });
    expect(await publisher().publish()).toBe(1);
    await add({ dedupeKey });
    expect(await publisher().publish()).toBe(0);
  });

  // Defect: the purge forgets the key after seven days, whereas it is said to hold for ever: the same reminder could leave twice.
  it.fails('keeps a single task per key after the purge', async () => {
    const dedupeKey = `sample:${randomUUID()}`;
    await add({ dedupeKey });
    await test.admin.query("UPDATE outbox SET published_at = now() - interval '8 days'");
    await purge(jobs);
    await add({ dedupeKey });
    expect(await pending()).toBe(0);
  });

  it('reports a queue that does not exist, keeps its tasks, and lets the others go', async () => {
    await test.admin.query("INSERT INTO outbox (queue, name, payload) VALUES ('unknown', 'sample', '{}')");
    await add();
    logs.length = 0;
    expect(await publisher().publish()).toBe(1);
    expect(await pending()).toBe(1);
    expect(logs.join('')).toContain('unknown queue');
  });

  // Defect: the hundred oldest tasks are read, and those of an unknown queue stay the oldest: nothing else leaves any more.
  it.fails('is not held back by the tasks of a queue that does not exist', async () => {
    await test.admin.query(
      "INSERT INTO outbox (queue, name, payload, created_at) SELECT 'unknown', 'sample', '{}', now() - interval '1 hour' FROM generate_series(1, 100)",
    );
    await add();
    const instance = publisher();
    const published = [await instance.publish(), await instance.publish()];
    expect(published).toContain(1);
  });

  it('fails without any effect when nobody knows the task', async () => {
    const before = failed();
    const seen: string[] = [];
    work({ maintenance: { sample: async () => void seen.push('run') } });
    await add({ name: 'other' });
    await publisher().publish();
    await until(() => failed() > before);
    expect(seen).toEqual([]);
  });

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

describe('rights of a task', () => {
  const add = (actor: Parameters<Database['run']>[0]) =>
    api.run(actor, () => new Outbox(api).add({ queue: 'maintenance', name: 'sample', payload: { caseId: s.cases.ofA } }));
  const failed = () => logs.filter((line) => line.includes('task failed')).length;
  const counting = () => {
    const seen: [number, number][] = [];
    work({
      maintenance: {
        sample: async ({ run }) => {
          seen.push(await run(async (tx) => [await tx.case.count(), (await tx.case.updateMany({ data: { status: 'PROMISE' } })).count]));
        },
      },
    });
    return seen;
  };

  it('are read when it runs: a case given to someone else since is out of reach', async () => {
    const seen = counting();
    await add(officer());
    await test.admin.query('UPDATE cases SET officer_id = $2 WHERE id = $1', [s.cases.ofA, s.officerB]);
    try {
      await publisher().publish();
      await until(() => seen.length === 1);
      expect(seen).toEqual([[0, 0]]);
    } finally {
      await test.admin.query('UPDATE cases SET officer_id = $2 WHERE id = $1', [s.cases.ofA, s.officerA]);
    }
  });

  it('of the Director stop at their own cases, as on the screen', async () => {
    const seen = counting();
    await add({ kind: 'staff', userId: s.director, role: 'DIRECTOR', delegations: [] });
    await publisher().publish();
    await until(() => seen.length === 1);
    expect(seen).toEqual([[4, 1]]);
  });

  it('are refused to an author who has become a creditor account', async () => {
    const seen = counting();
    const before = failed();
    await add(officer());
    await test.admin.query("UPDATE users SET role = 'CREDITOR', creditor_id = $2 WHERE id = $1", [s.officerA, s.creditorA]);
    try {
      await publisher().publish();
      await until(() => failed() > before);
      expect(seen).toEqual([]);
    } finally {
      await test.admin.query("UPDATE users SET role = 'CLAIMS_OFFICER', creditor_id = NULL WHERE id = $1", [s.officerA]);
    }
  });

  it('of a task born from a creditor or a debtor are those of the worker: its handler must limit itself', async () => {
    const seen = counting();
    await add({ kind: 'partner', userId: s.partnerA, creditorId: s.creditorA });
    await add({ kind: 'debtor', debtorId: s.debtorA });
    await publisher().publish();
    await until(() => seen.length === 2);
    expect(seen).toEqual([
      [4, 4],
      [4, 4],
    ]);
  });

  it('of the nightly purge are enough to run it from the queue', async () => {
    await test.admin.query("INSERT INTO outbox (queue, name, payload, published_at) VALUES ('sms', 'x-x', '{}', now() - interval '8 days')");
    work(maintenanceHandlers(jobs, logger));
    const queue = new Queue('maintenance', { connection: valkey, prefix });
    stops.push(() => queue.close());
    logs.length = 0;
    await queue.add('purge', { payload: {} });
    await until(() => logs.some((line) => line.includes('purge done')));
    expect(JSON.parse(logs.find((line) => line.includes('purge done'))!)).toMatchObject({ removed: { outbox: 1 } });
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
});
