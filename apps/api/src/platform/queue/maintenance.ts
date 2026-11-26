import { Queue, type ConnectionOptions } from 'bullmq';
import type { Database, Transaction } from '../database/database';
import type { AppLogger } from '../logging/logger';
import type { Storage } from '../storage/storage';
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
  // Imports never confirmed, 30 days after they were read.
  ['claim-imports', (tx) => tx.$executeRaw`DELETE FROM claim_imports WHERE status = 'PENDING' AND expires_at < now()`],
  // Messages without a code, unverified: 6 months.
  ['limited-messages', (tx) => tx.$executeRaw`DELETE FROM limited_messages WHERE created_at < now() - interval '6 months'`],
  ['task-marks', (tx) => tx.$executeRaw`DELETE FROM task_marks WHERE done_at < now() - interval '2 years'`],
  // The journal of the assistant: 1 year.
  ['ai-suggestions', (tx) => tx.$executeRaw`DELETE FROM ai_suggestions WHERE created_at < now() - interval '1 year'`],
  // The registry of the RGPD: 10 years (question 115).
  ['gdpr-requests', (tx) => tx.$executeRaw`DELETE FROM gdpr_requests WHERE received_on < (now() - interval '10 years')::date`],
  // Cases closed for more than 5 years, and their debtor with the last of them; receipts, invoices, payments and
  // remittances stay 10 years (question 77). Before the files: their documents are marked there.
  ['cases', async (tx) => counted(await tx.$queryRaw`SELECT app.anonymize_case() AS removed`)],
];

const FILES_AT_ONCE = 1000;
/**
 * The files of the erased documents, all of them each time: a restored disk brings some back. Read a thousand at a time,
 * each in its own transaction, erased outside of it, counted in another. Those of an erasure asked by a debtor go with
 * the next night.
 */
async function eraseFiles(database: Database, storage: Storage): Promise<number> {
  let removed = 0;
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const files = await database.run(
      { kind: 'retention' },
      (tx) => tx.$queryRaw<{ id: string; key: string }[]>`
        SELECT id, storage_key AS key FROM documents WHERE purged_at IS NOT NULL AND id > ${after}::uuid ORDER BY id LIMIT ${FILES_AT_ONCE}`,
    );
    for (const { key } of files) if (await storage.erase(key)) removed += 1;
    if (files.length < FILES_AT_ONCE) return removed;
    after = files.at(-1)!.id;
  }
}

/** Each step stands alone: one that fails neither undoes nor prevents the others. Counts are kept, never what was removed. */
export async function purge(database: Database, logger: AppLogger, storage: Storage): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const failures: string[] = [];
  const count = (kind: string, removed: number) => async (tx: Transaction) => {
    await tx.$executeRaw`INSERT INTO retention_runs (kind, removed) VALUES (${kind}, ${removed})`;
    return removed;
  };
  const steps: [kind: string, run: () => Promise<number>][] = [
    // The removal and its count in the same transaction.
    ...STEPS.map(([kind, remove]): [string, () => Promise<number>] => [
      kind,
      () => database.run({ kind: 'retention' }, async (tx) => count(kind, await remove(tx))(tx)),
    ]),
    ['document-files', async () => database.run({ kind: 'retention' }, count('document-files', await eraseFiles(database, storage)))],
  ];
  for (const [kind, run] of steps) {
    try {
      counts[kind] = await run();
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
export function maintenance(database: Database, logger: AppLogger, storage: Storage, after: () => Promise<void> = () => Promise.resolve()): ScheduledHandlers {
  return {
    maintenance: {
      purge: async () => {
        const outcomes = await Promise.allSettled([purge(database, logger, storage), after()]);
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
