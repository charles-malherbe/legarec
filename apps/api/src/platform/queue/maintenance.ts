import { Queue, type ConnectionOptions } from 'bullmq';
import type { Database, Transaction } from '../database/database';
import type { AppLogger } from '../logging/logger';
import type { ScheduledHandlers } from './jobs';
import { QUEUE_PREFIX } from './publisher';

/** What has outlived its purpose. Each duration is written here or in its SQL function, never passed. */
const STEPS: readonly [kind: string, remove: (tx: Transaction) => Promise<number>][] = [
  ['audit', async (tx) => (await tx.$queryRaw<{ removed: number }[]>`SELECT app.purge_audit() AS removed`)[0]?.removed ?? 0],
  ['idempotency', (tx) => tx.$executeRaw`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`],
  ['outbox', (tx) => tx.$executeRaw`DELETE FROM outbox WHERE done_at < now() - interval '7 days' OR failed_at < now() - interval '30 days'`],
  [
    'task-keys',
    (tx) => tx.$executeRaw`
      DELETE FROM task_keys k WHERE created_at < now() - interval '1 year'
        AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.id = k.task_id AND o.done_at IS NULL AND o.failed_at IS NULL)`,
  ],
  ['webhooks', (tx) => tx.$executeRaw`DELETE FROM webhook_events WHERE received_at < now() - interval '30 days'`],
];

/** Each step stands alone: one that fails neither undoes nor prevents the others. Counts are kept, never what was removed. */
export async function purge(database: Database, logger: AppLogger): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const failures: string[] = [];
  for (const [kind, remove] of STEPS) {
    try {
      counts[kind] = await database.run({ kind: 'retention' }, async (tx) => {
        const removed = await remove(tx);
        await tx.$executeRaw`INSERT INTO retention_runs (kind, removed) VALUES (${kind}, ${removed})`;
        return removed;
      });
      logger.info({ kind, removed: counts[kind] }, 'purge done');
    } catch (error) {
      failures.push(kind);
      logger.error({ kind, errorType: (error as Error).name }, 'purge failed');
    }
  }
  if (failures.length) throw new Error('PURGE_FAILED');
  return counts;
}

export function maintenance(database: Database, logger: AppLogger): ScheduledHandlers {
  return { maintenance: { purge: () => purge(database, logger).then(() => undefined) } };
}

/** Every night, at a quiet hour in Paris; the same schedule whatever the number of workers. */
export async function scheduleMaintenance(connection: ConnectionOptions, prefix = QUEUE_PREFIX): Promise<void> {
  const queue = new Queue('maintenance', { connection, prefix });
  queue.on('error', () => undefined);
  await queue.upsertJobScheduler(
    'purge',
    { pattern: '30 3 * * *', tz: 'Europe/Paris' },
    {
      name: 'purge',
      data: {},
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, stackTraceLimit: 0, removeOnComplete: true, removeOnFail: true },
    },
  );
  await queue.close();
}
