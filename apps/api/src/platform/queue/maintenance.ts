import { Queue, type ConnectionOptions } from 'bullmq';
import type { Database, Transaction } from '../database/database';
import type { AppLogger } from '../logging/logger';
import type { Storage } from '../storage/storage';
import { sweep, SweepInterrupted, SweepRefused, type SweepMode, type Swept } from '../storage/sweep';
import type { ScheduledHandlers } from './jobs';
import type { QueueName } from './outbox';
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
  // A deposit decided goes 30 days later (question 155); one waiting for the team stays.
  ['claim-deposits', (tx) => tx.$executeRaw`DELETE FROM claim_deposits WHERE status <> 'PENDING' AND decided_at < now() - interval '30 days'`],
  // A file of a creditor that no case took within 30 days (never deposited, or its deposit refused); one waiting stays.
  ['creditor-files', async (tx) => counted(await tx.$queryRaw`SELECT app.purge_waiting_files() AS removed`)],
  // The history of an anonymized case, line by line, as the pieces of accounting: ten years after the end of its year (question 192).
  ['case-history', async (tx) => counted(await tx.$queryRaw`SELECT app.purge_old_history() AS removed`)],
  // Drafts of credit notes left aside, 30 days after their last change.
  ['credit-note-drafts', (tx) => tx.$executeRaw`DELETE FROM credit_note_drafts WHERE updated_at < now() - interval '30 days'`],
  // Messages without a code, unverified: 6 months.
  ['limited-messages', (tx) => tx.$executeRaw`DELETE FROM limited_messages WHERE created_at < now() - interval '6 months'`],
  ['task-marks', (tx) => tx.$executeRaw`DELETE FROM task_marks WHERE done_at < now() - interval '2 years'`],
  // The journal of the assistant: 1 year.
  ['ai-suggestions', (tx) => tx.$executeRaw`DELETE FROM ai_suggestions WHERE created_at < now() - interval '1 year'`],
  // The registry of the RGPD: 10 years from the close of the request, counted as the accounting from the end of its year
  // (questions 115 and 175); one still open stays.
  [
    'gdpr-requests',
    (tx) => tx.$executeRaw`
      DELETE FROM gdpr_requests WHERE answered_at IS NOT NULL
        AND (answered_at AT TIME ZONE 'Europe/Paris')::date < make_date(extract(year FROM now() AT TIME ZONE 'Europe/Paris')::integer - 10, 1, 1)`,
  ],
  // Cases closed for more than 5 years, and their debtor with the last of them; receipts, invoices, payments and
  // remittances stay 10 years (question 77). Before the files: their documents are marked there.
  ['cases', async (tx) => counted(await tx.$queryRaw`SELECT app.anonymize_case() AS removed`)],
  // The pieces of accounting, 10 years after the end of their year (question 175), after the cases: only those of an
  // anonymized case go. Batches of remittances with what they hold, invoices that no remittance holds, bounced payments,
  // then the files still kept for accounting; their files go with the next step.
  ['remittances', async (tx) => counted(await tx.$queryRaw`SELECT app.purge_remittances() AS removed`)],
  ['invoices', async (tx) => counted(await tx.$queryRaw`SELECT app.purge_invoices() AS removed`)],
  ['payments', async (tx) => counted(await tx.$queryRaw`SELECT app.purge_payments() AS removed`)],
  ['accounting-documents', async (tx) => counted(await tx.$queryRaw`SELECT app.purge_accounting_documents() AS removed`)],
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

const HELD = 'orphan-files-held';
const RESUMED = 'orphan-files-resumed';
const noted = (database: Database, kind: string, removed: number) =>
  database.run({ kind: 'retention' }, (tx) => tx.$executeRaw`INSERT INTO retention_runs (kind, removed) VALUES (${kind}, ${removed})`);
/**
 * After a restoration the files received since the instant restored have lost their row: the night no longer erases any
 * file without a row, until a person has looked. Written by the purge asked at once (purge.ts), which the procedure of
 * the restoration runs, and by nothing else. The mark is a line of the journal of the purge: durable, never rewritten.
 */
export const holdSweep = (database: Database) => noted(database, HELD, 0);
/** Lifted by a person, with `dist/sweep-files.js --resume`, and by nothing else (test/schema.test.ts). */
export const resumeSweep = (database: Database) => noted(database, RESUMED, 0);
export async function sweepHeld(database: Database): Promise<boolean> {
  const [last] = await database.run(
    { kind: 'retention' },
    (tx) => tx.$queryRaw<{ kind: string }[]>`SELECT kind FROM retention_runs WHERE kind IN (${HELD}, ${RESUMED}) ORDER BY ran_at DESC, id DESC LIMIT 1`,
  );
  return last?.kind === HELD;
}

/**
 * The files of the storage that no row points at (sweep.ts): an upload whose row was never written and whose removal
 * failed, a program stopped between the two. The purge asks which keys a row holds, and reads no table for that.
 * Counts in the journal, never a key. What was erased is kept in `retention_runs`, even when the run stopped halfway:
 * `orphan-files` for the night, `orphan-files-forced` when a person asked.
 */
export async function sweepFiles(database: Database, logger: AppLogger, storage: Storage, mode: SweepMode, expected?: number): Promise<Swept> {
  const referenced = (keys: string[]) =>
    database.run({ kind: 'retention' }, async (tx) =>
      (await tx.$queryRaw<{ key: string }[]>`SELECT key FROM app.referenced_files(${keys}::text[]) AS key`).map((row) => row.key),
    );
  const told = async (found: Swept) => {
    const without = found.orphans + found.parts;
    // One is enough to be worth a look: it should not happen often.
    logger[without ? 'warn' : 'info']({ kind: 'orphan-files', count: without }, 'files without a row found');
    if (found.unknown) logger.warn({ kind: 'orphan-files', count: found.unknown }, 'names that are no storage key, left untouched');
    if (mode === 'count') return found;
    await noted(database, mode === 'force' ? 'orphan-files-forced' : 'orphan-files', found.erased);
    logger.info({ kind: 'orphan-files', removed: found.erased }, mode === 'force' ? 'files without a row erased, forced' : 'files without a row erased');
    if (without > found.erased) logger.warn({ kind: 'orphan-files', count: without - found.erased }, 'files without a row left');
    return found;
  };
  try {
    return await told(await sweep(storage, referenced, mode, expected === undefined ? {} : { expected }));
  } catch (error) {
    if (error instanceof SweepRefused || error instanceof SweepInterrupted) {
      await told(error.found);
      logger.error({ kind: 'orphan-files', errorType: error instanceof SweepRefused ? error.code : error.name }, 'sweep of the files without a row stopped');
    }
    throw error;
  }
}

/** The sweep of the night: only a count as long as it is held since a restoration. */
export async function nightSweep(database: Database, logger: AppLogger, storage: Storage): Promise<void> {
  if (!(await sweepHeld(database))) return void (await sweepFiles(database, logger, storage, 'erase'));
  await sweepFiles(database, logger, storage, 'count');
  logger.warn({ kind: 'orphan-files' }, 'sweep of the files without a row held since a restoration: nothing erased');
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
      // On its own, tried once a night: a purge that is retried must never erase three times the cap of the sweep.
      'sweep-files': () => nightSweep(database, logger, storage),
    },
  };
}

/** Every night, at a quiet hour in Paris; the same schedule whatever the number of workers. */
export async function scheduleMaintenance(connection: ConnectionOptions, prefix = QUEUE_PREFIX): Promise<void> {
  await scheduleRepeated(connection, { queue: 'maintenance', name: 'purge', pattern: '30 3 * * *', attempts: 3 }, prefix);
  // After the purge, which erases the files of the erased documents; one try, whatever happens.
  await scheduleRepeated(connection, { queue: 'maintenance', name: 'sweep-files', pattern: '30 4 * * *', attempts: 1 }, prefix);
}

/** A task of the clock (`ScheduledHandlers`), without author nor payload; the same schedule whatever the number of workers. */
export async function scheduleRepeated(
  connection: ConnectionOptions,
  { queue: name, name: job, pattern, attempts }: { queue: QueueName; name: string; pattern: string; attempts: number },
  prefix = QUEUE_PREFIX,
): Promise<void> {
  const queue = new Queue(name, { connection, prefix });
  queue.on('error', () => undefined);
  await queue.upsertJobScheduler(
    job,
    { pattern, tz: 'Europe/Paris' },
    {
      name: job,
      data: {},
      opts: { attempts, backoff: { type: 'exponential', delay: 60_000 }, stackTraceLimit: 0, removeOnComplete: true, removeOnFail: true },
    },
  );
  await queue.close();
}
