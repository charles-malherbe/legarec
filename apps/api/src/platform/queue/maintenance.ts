import { Queue, type ConnectionOptions } from 'bullmq';
import type { Database } from '../database/database';
import type { AppLogger } from '../logging/logger';
import type { JobHandlers } from './jobs';
import { QUEUE_PREFIX, type JobData } from './publisher';

/** Removes what has outlived its purpose. Each duration is written here or in its SQL function, never passed. */
export async function purge(database: Database): Promise<Record<string, number>> {
  return database.run({ kind: 'retention' }, async (tx) => {
    const [audit] = await tx.$queryRaw<{ removed: number }[]>`SELECT app.purge_audit() AS removed`;
    return {
      audit: audit?.removed ?? 0,
      idempotency: await tx.$executeRaw`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`,
      outbox: await tx.$executeRaw`DELETE FROM outbox WHERE published_at < now() - interval '7 days'`,
      webhooks: await tx.$executeRaw`DELETE FROM webhook_events WHERE received_at < now() - interval '30 days'`,
    };
  });
}

export function maintenanceHandlers(database: Database, logger: AppLogger): JobHandlers {
  return {
    maintenance: {
      purge: async () => {
        logger.info({ removed: await purge(database) }, 'purge done');
      },
    },
  };
}

/** Every night, at a quiet hour in Paris; the same schedule whatever the number of workers. */
export async function scheduleMaintenance(connection: ConnectionOptions, prefix = QUEUE_PREFIX): Promise<void> {
  const queue = new Queue<JobData>('maintenance', { connection, prefix });
  queue.on('error', () => undefined);
  await queue.upsertJobScheduler('purge', { pattern: '30 3 * * *', tz: 'Europe/Paris' }, { name: 'purge', data: { payload: {} } });
  await queue.close();
}
