import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Delegation } from '@legarec/contracts';
import type { Actor } from '../database/actor';
import { databaseCode } from '../database/codes';
import type { Database, Transaction } from '../database/database';
import { ApiError } from '../errors/api-error';
import type { AppLogger } from '../logging/logger';
import { GiveUp, TryLater } from './errors';
import type { QueueName, TaskPayload } from './outbox';
import { QUEUE_PREFIX } from './publisher';

export type AuthorKind = 'STAFF' | 'CREDITOR' | 'DEBTOR' | 'SERVICE' | 'HOOK' | 'SYSTEM' | 'ANONYMOUS';
/** Answers true when the author holds the right to what follows. */
export type Check = (tx: Transaction) => Promise<boolean>;
export type Run = <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;
export interface JobContext {
  taskId: string;
  payload: TaskPayload;
  /** With the rights of the author, read again now. Refused when nobody had signed in. */
  asAuthor: Run;
  /**
   * Opens those of the application, once the author has passed the check: seeing a case does not prove the right to act
   * on it. Asked once, before anything leaves; what has left can then be recorded, whatever has changed meanwhile. Not
   * asked when nobody had signed in (a provider, the application itself, the sign-in page).
   */
  authorize(check: Check): Promise<Run>;
}
export interface JobDefinition {
  /** Who may start it: a task from anyone else is refused. */
  from: readonly AuthorKind[];
  /** Harmless when run again. Otherwise a single try: what was interrupted has an unknown outcome, that a person settles. */
  repeatable: boolean;
  run(context: JobContext): Promise<void>;
}
/** Handlers by queue, then by name of task. */
export type JobHandlers = Partial<Record<QueueName, Record<string, JobDefinition>>>;
/** Run by the clock, without any author nor payload. */
export type ScheduledHandlers = Partial<Record<QueueName, Record<string, () => Promise<void>>>>;

/** What leaves through these queues reaches someone: never twice, whatever a definition says. */
const ONE_TRY: ReadonlySet<QueueName> = new Set(['letter', 'sms', 'staff-email', 'reminders']);

interface Stored {
  id: string;
  queue: string;
  name: string;
  payload: TaskPayload;
  actor_kind: AuthorKind;
  actor_id: string | null;
  acting_for: Delegation | null;
  settled: boolean;
  early: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const worker = (job: string): Actor => ({ kind: 'worker', job });

/** The author may act on this case: what most tasks of the team ask first. */
export const mayActOn =
  (caseId: string): Check =>
  async (tx) => {
    const [row] = await tx.$queryRaw<{ may: boolean }[]>`SELECT app.can_act_on_case(officer_id) AS may FROM cases WHERE id = ${caseId}::uuid`;
    return row?.may === true;
  };

/** Who the task acts for; null when nobody had signed in. */
async function claimedAuthor(database: Database, { name, actor_kind: kind, actor_id: id, acting_for: actingFor }: Stored): Promise<Actor | null> {
  if (id === null) return null;
  if (kind === 'DEBTOR') return { kind: 'debtor', debtorId: id };
  if (kind === 'SERVICE') return { kind: 'service', accountId: id, scopes: [] };
  const account = await database.run(worker(name), (tx) =>
    tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, creditorId: true } }),
  );
  if (account?.status !== 'ACTIVE') throw new GiveUp('AUTHOR_GONE');
  if (kind === 'CREDITOR' && account.role === 'CREDITOR' && account.creditorId) return { kind: 'partner', userId: id, creditorId: account.creditorId };
  if (kind === 'STAFF' && account.role !== 'CREDITOR')
    return { kind: 'staff', userId: id, role: account.role, delegations: [], ...(actingFor ? { actingFor } : {}) };
  throw new GiveUp('AUTHOR_GONE');
}

/** Rights of the author read again now: a disabled account, a closed portal or a withdrawn delegation stops what it had started. */
async function authorOf(database: Database, task: Stored): Promise<Actor | null> {
  const author = await claimedAuthor(database, task);
  if (!author) return null;
  try {
    // Asked to PostgreSQL itself: is this account still somebody, and does the delegation still hold?
    const [known] = await database.run(author, (tx) => tx.$queryRaw<{ kind: AuthorKind }[]>`SELECT app.actor_kind()::text AS kind, app.on_behalf_of()`);
    if (known?.kind === task.actor_kind) return author;
  } catch (error) {
    // A refusal says that the author is gone; a lost connection says nothing.
    if (databaseCode(error) !== '42501') throw error;
  }
  throw new GiveUp('AUTHOR_GONE');
}

function contextOf(database: Database, task: Stored, author: Actor | null): JobContext {
  return {
    taskId: task.id,
    payload: task.payload,
    asAuthor: async (work) => {
      if (!author) throw new GiveUp('NO_AUTHOR');
      return database.run(author, work);
    },
    authorize: async (check) => {
      if (author && (await database.run(author, check)) !== true) throw new GiveUp('NOT_ALLOWED');
      return (work) => database.run(worker(task.name), work);
    },
  };
}

interface Taken {
  definition: JobDefinition;
  context: JobContext;
  set(change: (tx: Transaction) => Promise<number>): Promise<number>;
}

/** Takes the task, or null when there is nothing to do. Whatever fails here, nothing has started. */
async function take(parts: { database: Database; logger: AppLogger; handlers: JobHandlers }, queue: QueueName, id: string): Promise<Taken | null> {
  const { database, logger } = parts;
  const read = async () =>
    (
      await database.run(
        worker(queue),
        (tx) => tx.$queryRaw<Stored[]>`
          SELECT id, queue, name, payload, actor_kind::text, actor_id, acting_for::text,
            done_at IS NOT NULL OR failed_at IS NOT NULL AS settled, coalesce(run_at > now(), false) AS early
          FROM outbox WHERE id = ${id}::uuid`,
      )
    )[0];
  const task = UUID.test(id) ? await read() : undefined;
  if (!task || task.queue !== queue) throw new GiveUp('UNKNOWN_TASK');
  // Delivered twice, or before its time: done once, at its time.
  if (task.settled || task.early) return null;
  const set: Taken['set'] = (change) => database.run(worker(task.name), change);
  const definition = parts.handlers[queue]?.[task.name];
  if (!definition) {
    // Queued by a newer version of the API: back in the table, until a worker knows it.
    logger.error({ queue, task: task.name, taskId: id }, 'task unknown to this worker');
    await set(
      (tx) => tx.$executeRaw`UPDATE outbox SET published_at = NULL, claimed_at = now() WHERE id = ${id}::uuid AND done_at IS NULL AND failed_at IS NULL`,
    );
    return null;
  }
  if (!definition.from.includes(task.actor_kind)) throw new GiveUp('AUTHOR_REFUSED');
  const author = await authorOf(database, task);
  // Taken in the table, not only in Valkey: a task whose lock was lost does not run twice.
  const taken = await set(
    (tx) => tx.$executeRaw`
      UPDATE outbox SET started_at = now()
      WHERE id = ${id}::uuid AND done_at IS NULL AND failed_at IS NULL AND (run_at IS NULL OR run_at <= now()) AND (started_at IS NULL OR ${definition.repeatable})`,
  );
  if (taken === 1) return { definition, context: contextOf(database, task, author), set };
  if ((await read())?.settled !== false) return null;
  // Started once and never ended: nobody knows what has left.
  throw new GiveUp('UNCERTAIN');
}

async function execute({ definition, context, set }: Taken): Promise<void> {
  const id = context.taskId;
  try {
    await definition.run(context);
  } catch (error) {
    if (error instanceof TryLater) await set((tx) => tx.$executeRaw`UPDATE outbox SET started_at = NULL WHERE id = ${id}::uuid AND done_at IS NULL`);
    else if (!definition.repeatable && !(error instanceof GiveUp)) throw new GiveUp('UNCERTAIN');
    throw error;
  }
  // Ended after all: what another delivery may have taken for uncertain is done.
  await set((tx) => tx.$executeRaw`UPDATE outbox SET done_at = now(), failed_at = NULL, failure = NULL WHERE id = ${id}::uuid`);
}

/** Code of a failure: what a provider or the database answered stays out of PostgreSQL, of Valkey and of the logs. */
function codeOf(error: unknown): string {
  const code = error instanceof GiveUp || error instanceof TryLater || error instanceof ApiError ? error.code : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/u.test(code) ? code : 'TASK_FAILED';
}

export interface Workers {
  stop(): Promise<void>;
}

/** To be called once Valkey answers. `onDead` is told when a queue will not be read: the process must then start again. */
export function startWorkers(parts: {
  database: Database;
  logger: AppLogger;
  connection: ConnectionOptions;
  handlers: JobHandlers;
  scheduled?: ScheduledHandlers;
  prefix?: string;
  concurrency?: Partial<Record<QueueName, number>>;
  onDead?: (queue: QueueName) => void;
}): Workers {
  const { database, logger, scheduled = {} } = parts;
  for (const [queue, definitions] of Object.entries(parts.handlers)) {
    const wrong = Object.entries(definitions).filter(([, { repeatable }]) => repeatable && ONE_TRY.has(queue as QueueName));
    if (wrong.length) throw new Error(`Never repeatable in the queue ${queue}: ${wrong.map(([name]) => name).join(', ')}`);
    const both = Object.keys(definitions).filter((name) => name in (scheduled[queue as QueueName] ?? {}));
    if (both.length) throw new Error(`Both a task and a schedule in the queue ${queue}: ${both.join(', ')}`);
  }
  let stopping = false;
  const names = [...new Set([...Object.keys(parts.handlers), ...Object.keys(scheduled)])] as QueueName[];
  const workers = names.map((queue) => {
    const instance = new Worker(
      queue,
      async (job: Job) => {
        const id = job.id ?? '';
        let taken: Taken | null = null;
        try {
          const planned = scheduled[queue]?.[job.name];
          if (planned) await planned();
          else {
            taken = await take(parts, queue, id);
            if (taken) await execute(taken);
          }
        } catch (error) {
          const code = codeOf(error);
          const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
          // A task that has not started, or from which nothing has left, is never abandoned: Valkey forgets it, the table
          // does not, and it is published again an hour later.
          const abandoned = error instanceof GiveUp || (last && taken !== null && !(error instanceof TryLater));
          logger.error({ queue, task: job.name, taskId: id, attempt: job.attemptsMade + 1, errorType: code }, abandoned ? 'task abandoned' : 'task failed');
          // Kept in the table, with its key: nothing starts it again without a decision.
          if (abandoned && UUID.test(id))
            await database
              .run(
                worker(queue),
                (tx) =>
                  tx.$executeRaw`UPDATE outbox SET failed_at = now(), failure = ${code} WHERE id = ${id}::uuid AND queue = ${queue} AND done_at IS NULL AND failed_at IS NULL`,
              )
              .catch(() => logger.error({ queue, taskId: id }, 'failure not recorded'));
          throw abandoned ? new UnrecoverableError(code) : Object.assign(new Error(code), { stack: '' });
        }
      },
      { connection: parts.connection, prefix: parts.prefix ?? QUEUE_PREFIX, concurrency: parts.concurrency?.[queue] ?? 1, autorun: false },
    );
    instance.on('error', () => logger.warn({ queue }, 'worker error'));
    instance.on('completed', (job) => logger.info({ queue, task: job.name, taskId: job.id }, 'task done'));
    let told = false;
    const dead = () => {
      if (stopping || told) return;
      told = true;
      logger.error({ queue }, 'queue no longer read');
      parts.onDead?.(queue);
    };
    // A reader that misses its start waits for ever, without a word; one that is cut later comes back by itself.
    instance.waitUntilReady().catch(dead);
    void instance.run().then(dead, dead);
    return instance;
  });
  return {
    stop: async () => {
      stopping = true;
      await Promise.all(workers.map((instance) => instance.close()));
    },
  };
}
