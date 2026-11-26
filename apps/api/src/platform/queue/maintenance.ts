import { Queue, type ConnectionOptions } from 'bullmq';
import type { Database, Transaction } from '../database/database';
import type { AppLogger } from '../logging/logger';
import type { ScheduledHandlers } from './jobs';
import { QUEUE_PREFIX } from './publisher';

const counted = (rows: { removed: number }[]) => rows[0]?.removed ?? 0;
/** What has outlived its purpose. Each duration is written here or in its SQL function, never passed. */
const STEPS: readonly [kind: string, remove: (tx: Transaction) => Promise<number>][] = [
  ['audit', async (tx) => counted(await tx.$queryRaw`SELECT app.purge_audit() AS removed`)],
  ['idempotency', (tx) => tx.$executeRaw`DELETE FROM idempotency_keys WHERE created_at < now() - interval '48 hours'`],
  ['outbox', (tx) => tx.$executeRaw`DELETE FROM outbox WHERE done_at < now() - interval '14 days' OR failed_at < now() - interval '60 days'`],
  [
    'task-keys',
    (tx) => tx.$executeRaw`
      DELETE FROM task_keys k WHERE created_at < now() - interval '2 years'
        AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.id = k.task_id AND o.done_at IS NULL AND o.failed_at IS NULL)`,
  ],
  ['webhooks', (tx) => tx.$executeRaw`DELETE FROM webhook_events WHERE received_at < now() - interval '60 days'`],
  // Sessions and links 48 hours after their end, failures one year.
  ['sign-ins', async (tx) => counted(await tx.$queryRaw`SELECT app.purge_sign_ins() AS removed`)],
  // Disabled for two years.
  ['accounts', async (tx) => counted(await tx.$queryRaw`SELECT app.anonymize_accounts() AS removed`)],
  ['notifications', (tx) => tx.$executeRaw`DELETE FROM notifications WHERE created_at < now() - interval '2 years'`],
  // After the notifications, of the same age, that refer to them.
  ['support-tickets', (tx) => tx.$executeRaw`DELETE FROM support_tickets WHERE created_at < now() - interval '2 years'`],
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

/** `after`: what else a night takes care of, whatever the purge has done. */
export function maintenance(database: Database, logger: AppLogger, after: () => Promise<void> = () => Promise.resolve()): ScheduledHandlers {
  return {
    maintenance: {
      purge: async () => {
        const outcomes = await Promise.allSettled([purge(database, logger), after()]);
        // The purge has already said which of its steps failed.
        if (outcomes[1].status === 'rejected') logger.error({ errorType: (outcomes[1].reason as Error).name }, 'night task failed');
        const failed = outcomes.find((outcome) => outcome.status === 'rejected');
        if (failed) throw failed.reason;
      },
    },
  };
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
