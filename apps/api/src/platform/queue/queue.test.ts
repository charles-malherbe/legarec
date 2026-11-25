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
