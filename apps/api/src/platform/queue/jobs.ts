import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Delegation } from '@legarec/contracts';
import type { Actor } from '../database/actor';
import type { Database, Transaction } from '../database/database';
import { ApiError } from '../errors/api-error';
import type { AppLogger } from '../logging/logger';
import type { QueueName, TaskPayload } from './outbox';
import { QUEUE_PREFIX } from './publisher';

export type AuthorKind = 'STAFF' | 'CREDITOR' | 'DEBTOR' | 'SERVICE' | 'HOOK' | 'SYSTEM' | 'ANONYMOUS';
export interface JobContext {
  taskId: string;
  payload: TaskPayload;
  /** With the rights of the author, read again now. */
  asAuthor<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  /** With those of the application: only once `asAuthor` has shown that the author may. */
  asApplication<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
export interface JobDefinition {
  /** Who may start it: a task from anyone else is refused. */
  from: readonly AuthorKind[];
  run(context: JobContext): Promise<void>;
}
/** Handlers by queue, then by name of task. */
export type JobHandlers = Partial<Record<QueueName, Record<string, JobDefinition>>>;
/** Run by the clock, without any author nor payload. */
export type ScheduledHandlers = Partial<Record<QueueName, Record<string, () => Promise<void>>>>;

interface Stored {
  id: string;
  queue: string;
  name: string;
  payload: TaskPayload;
  actor_kind: AuthorKind;
  actor_id: string | null;
  acting_for: Delegation | null;
  done_at: Date | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const worker = (job: string): Actor => ({ kind: 'worker', job });

/** Rights of the author read again now: a disabled account, a closed portal or a withdrawn delegation stops what it had started. */
async function authorOf(database: Database, task: Stored): Promise<Actor> {
  if (task.actor_kind === 'DEBTOR' && task.actor_id) return { kind: 'debtor', debtorId: task.actor_id };
  if (task.actor_kind !== 'STAFF' && task.actor_kind !== 'CREDITOR') return worker(task.name);
  const account = await database.run(worker(task.name), (tx) =>
    tx.user.findUnique({ where: { id: task.actor_id ?? '' }, select: { id: true, role: true, status: true, creditorId: true } }),
  );
  if (account?.status !== 'ACTIVE') throw new UnrecoverableError('AUTHOR_GONE');
  const actor: Actor | null =
    account.role === 'CREDITOR'
      ? account.creditorId && task.actor_kind === 'CREDITOR'
        ? { kind: 'partner', userId: account.id, creditorId: account.creditorId }
        : null
      : task.actor_kind === 'STAFF'
        ? { kind: 'staff', userId: account.id, role: account.role, delegations: [], ...(task.acting_for ? { actingFor: task.acting_for } : {}) }
        : null;
  if (!actor) throw new UnrecoverableError('AUTHOR_GONE');
  // Asked to PostgreSQL itself: is this account still somebody, and does the delegation still hold?
  const [known] = await database
    .run(actor, (tx) => tx.$queryRaw<{ kind: AuthorKind }[]>`SELECT app.actor_kind()::text AS kind, app.on_behalf_of()`)
    .catch(() => []);
  if (known?.kind !== task.actor_kind) throw new UnrecoverableError('AUTHOR_GONE');
  return actor;
}

async function runTask(parts: { database: Database; handlers: JobHandlers }, queue: QueueName, id: string): Promise<void> {
  const { database } = parts;
  const [task] = UUID.test(id)
    ? await database.run(
        worker(queue),
        (tx) =>
          tx.$queryRaw<Stored[]>`SELECT id, queue, name, payload, actor_kind::text, actor_id, acting_for::text, done_at FROM outbox WHERE id = ${id}::uuid`,
      )
    : [];
  if (!task || task.queue !== queue) throw new UnrecoverableError('UNKNOWN_TASK');
  // Delivered twice: done once.
  if (task.done_at) return;
  const definition = parts.handlers[queue]?.[task.name];
  if (!definition) throw new UnrecoverableError('UNKNOWN_TASK');
  if (!definition.from.includes(task.actor_kind)) throw new UnrecoverableError('AUTHOR_REFUSED');
  const author = await authorOf(database, task);
  await definition.run({
    taskId: task.id,
    payload: task.payload,
    asAuthor: (work) => database.run(author, work),
    asApplication: (work) => database.run(worker(task.name), work),
  });
  await database.run(worker(task.name), (tx) => tx.$executeRaw`UPDATE outbox SET done_at = now() WHERE id = ${task.id}::uuid`);
}

/** Code of a failure: what a provider or the database answered stays out of Valkey and of the logs. */
function codeOf(error: unknown): Error {
  if (error instanceof UnrecoverableError) return new UnrecoverableError(error.message);
  const clean = new Error(error instanceof ApiError ? error.code : 'TASK_FAILED');
  clean.stack = '';
  return clean;
}

export function startWorkers(parts: {
  database: Database;
  logger: AppLogger;
  connection: ConnectionOptions;
  handlers: JobHandlers;
  scheduled?: ScheduledHandlers;
  prefix?: string;
  concurrency?: Partial<Record<QueueName, number>>;
}) {
  const { database, logger, scheduled = {} } = parts;
  const names = [...new Set([...Object.keys(parts.handlers), ...Object.keys(scheduled)])] as QueueName[];
  const workers = names.map((queue) => {
    const instance = new Worker(
      queue,
      async (job: Job) => {
        try {
          const planned = scheduled[queue]?.[job.name];
          await (planned ? planned() : runTask(parts, queue, job.id ?? ''));
        } catch (error) {
          throw codeOf(error);
        }
      },
      { connection: parts.connection, prefix: parts.prefix ?? QUEUE_PREFIX, concurrency: parts.concurrency?.[queue] ?? 1 },
    );
    instance.on('error', () => logger.warn({ queue }, 'worker error'));
    instance.on('failed', (job, error) => {
      const final = !job || error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
      logger.error({ queue, task: job?.name, taskId: job?.id, attempt: job?.attemptsMade, errorType: error.message }, final ? 'task abandoned' : 'task failed');
      // Kept in the table, with its key: nothing starts it again without a decision.
      if (final && job?.id && UUID.test(job.id)) {
        void database
          .run(worker(queue), (tx) => tx.$executeRaw`UPDATE outbox SET failed_at = now() WHERE id = ${job.id}::uuid AND done_at IS NULL`)
          .catch(() => logger.error({ queue }, 'failure not recorded'));
      }
    });
    instance.on('completed', (job) => logger.info({ queue, task: job.name, taskId: job.id }, 'task done'));
    return instance;
  });
  return { stop: () => Promise.all(workers.map((instance) => instance.close())).then(() => undefined) };
}
