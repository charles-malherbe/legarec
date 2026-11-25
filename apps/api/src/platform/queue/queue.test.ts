import { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import type { Actor } from '../database/actor';
import { Database } from '../database/database';
import { createLogger } from '../logging/logger';
import { startWorkers, type AuthorKind, type JobContext, type JobDefinition, type ScheduledHandlers } from './jobs';
import { maintenance, purge, scheduleMaintenance } from './maintenance';
import { Outbox, QUEUES, type Task } from './outbox';
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
const work = (run: JobDefinition['run'], from: readonly AuthorKind[] = EVERYONE, scheduled?: ScheduledHandlers) => {
  const workers = startWorkers({ database: jobs, logger, connection: valkey, handlers: { maintenance: { sample: { from, run } } }, scheduled, prefix });
  stops.push(workers.stop);
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
const abandoned = () => logs.filter((line) => line.includes('task abandoned'));
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
    await test.admin.query("UPDATE outbox SET done_at = now() - interval '8 days'");
    await purge(jobs, logger);
    expect(await rows('SELECT 1 FROM outbox')).toEqual([]);
    expect(await add({ dedupeKey })).toBe(false);
    expect(await publisher().publish()).toBe(0);
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
    await until(async () => (await rows('SELECT 1 FROM outbox WHERE done_at IS NOT NULL')).length === 1);
    // As if the transaction that marks it as published had been lost, and Valkey emptied.
    await test.admin.query('UPDATE outbox SET published_at = NULL, claimed_at = NULL');
    for (const key of await valkey.keys(`${prefix}:maintenance:*-*`)) await valkey.del(key);
    const again = queue();
    expect(await publisher().publish()).toBe(1);
    await until(async () => (await again.getCompletedCount()) >= 1);
    expect(seen).toEqual(['run']);
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
    await until(async () => (await rows('SELECT 1 FROM outbox WHERE failed_at IS NOT NULL AND done_at IS NULL')).length === 1);
    expect(abandoned()).toHaveLength(1);
  });

  it('leaves nothing in Valkey but its number, and nothing in the logs', async () => {
    work(() => Promise.reject(new Error('550 <jean@exemple.test> KXPM refused')));
    await add({ payload: { caseId: s.cases.ofA, template: 'FORMAL_NOTICE' } });
    await publisher().publish();
    await until(() => logs.some((line) => line.includes('task failed')));
    const jobKeys = (await valkey.keys(`${prefix}:maintenance:*`)).filter((key) => /:[0-9a-f-]{36}$/u.test(key));
    expect(jobKeys).toHaveLength(1);
    const [stored] = await Promise.all(jobKeys.map((key) => valkey.hgetall(key)));
    expect(stored).toMatchObject({ data: '{}', failedReason: 'TASK_FAILED' });
    const all = JSON.stringify(stored) + logs.join('');
    for (const hidden of ['jean@', 'KXPM', '550', 'FORMAL_NOTICE', s.cases.ofA, s.officerA, 'Alba', ' at ']) expect(all).not.toContain(hidden);
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

  it('stays in its queue, and under a name that someone knows', async () => {
    const seen: string[] = [];
    work(async () => void seen.push('run'));
    const here = queue();
    await add({ queue: 'sms' });
    await add({ name: 'other' });
    for (const { id } of await rows<{ id: string }>('SELECT id FROM outbox')) await here.add('sample', {}, { jobId: id });
    await until(async () => (await here.getFailedCount()) === 2);
    expect(seen).toEqual([]);
  });
});

describe('rights of a task', () => {
  const counts = (context: Pick<JobContext, 'asAuthor' | 'asApplication'>) =>
    Promise.all([context.asAuthor((tx) => tx.case.count()), context.asApplication((tx) => tx.case.count())]);
  const counting = (from?: readonly AuthorKind[]) => {
    const seen: number[][] = [];
    work(async (context) => void seen.push(await counts(context)), from);
    return seen;
  };
  const refused = async (seen: unknown[], reason: string) => {
    const failed = queue();
    await publisher().publish();
    await until(async () => (await failed.getFailedCount()) === 1);
    expect((await failed.getFailed())[0]!.failedReason).toBe(reason);
    expect(seen).toEqual([]);
    await until(async () => (await rows('SELECT 1 FROM outbox WHERE failed_at IS NOT NULL')).length === 1);
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
    await test.admin.query(`
      INSERT INTO idempotency_keys (actor, key, route, request_hash, created_at) VALUES
        ('user:x', gen_random_uuid(), 'r', '\\x00', now() - interval '25 hours'), ('user:x', gen_random_uuid(), 'r', '\\x00', now());
      INSERT INTO webhook_events (provider, provider_event_id, status, received_at) VALUES
        ('RESEND', 'old', 'PROCESSED', now() - interval '31 days'), ('RESEND', 'late', 'RECEIVED', now() - interval '31 days'), ('RESEND', 'new', 'PROCESSED', now());
      INSERT INTO outbox (queue, name, payload, actor_kind, published_at, done_at, failed_at) VALUES
        ('sms', 'x-x', '{}', 'SYSTEM', now(), now() - interval '8 days', NULL), ('sms', 'x-x', '{}', 'SYSTEM', now(), NULL, now() - interval '31 days'),
        ('sms', 'x-x', '{}', 'SYSTEM', now(), NULL, now() - interval '8 days'), ('sms', 'x-x', '{}', 'SYSTEM', now() - interval '90 days', NULL, NULL), ('sms', 'x-x', '{}', 'SYSTEM', NULL, NULL, NULL);
      INSERT INTO audit_log (occurred_at, actor_kind, actor_label, action) VALUES
        (now() - interval '13 months', 'SYSTEM', 'Application', 'OLD_ENTRY'), (now() - interval '11 months', 'SYSTEM', 'Application', 'KEPT_ENTRY');`);
    const counts = { audit: 1, idempotency: 1, outbox: 2, webhooks: 1 };
    expect(await purge(jobs, logger)).toEqual(counts);
    expect(await rows('SELECT action FROM audit_log')).toEqual([{ action: 'KEPT_ENTRY' }]);
    const kept = await rows<{ kind: string; removed: number }>('SELECT kind, removed FROM retention_runs ORDER BY ran_at DESC LIMIT 4');
    expect(Object.fromEntries(kept.map((row) => [row.kind, row.removed]))).toEqual(counts);
  });

  it('goes on when one of its steps fails, and says so', async () => {
    await test.admin.query('REVOKE DELETE ON idempotency_keys FROM legarec_retention');
    await test.admin.query("INSERT INTO outbox (queue, name, payload, actor_kind, done_at) VALUES ('sms', 'x-x', '{}', 'SYSTEM', now() - interval '8 days')");
    try {
      await expect(purge(jobs, logger)).rejects.toThrow('PURGE_FAILED');
      expect(await rows('SELECT 1 FROM outbox')).toEqual([]);
      expect(logs.join('')).toContain('purge failed');
    } finally {
      await test.admin.query('GRANT DELETE ON idempotency_keys TO legarec_retention');
    }
  });

  it('is scheduled once, whatever the number of workers, and runs from the queue', async () => {
    work(async () => undefined, EVERYONE, maintenance(jobs, logger));
    await Promise.all([scheduleMaintenance(valkey, prefix), scheduleMaintenance(valkey, prefix)]);
    expect(await valkey.zcard(`${prefix}:maintenance:repeat`)).toBe(1);
    await queue().add('purge', {});
    await until(() => logs.filter((line) => line.includes('purge done')).length === 4);
  });

  it('is out of reach of the HTTP API', async () => {
    await expect(purge(api, logger)).rejects.toThrow('PURGE_FAILED');
    await expect(api.run({ kind: 'retention' }, (tx) => tx.$queryRaw`SELECT 1`)).rejects.toThrow(/permission denied to set role/u);
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
