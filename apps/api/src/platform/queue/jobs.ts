import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Actor } from '../database/actor';
import type { Database, Transaction } from '../database/database';
import type { AppLogger } from '../logging/logger';
import type { QueueName } from './outbox';
import { QUEUE_PREFIX, type JobData } from './publisher';

export interface JobContext {
  payload: JobData['payload'];
  /** Opens a transaction with the rights of the author of the task, or those of the worker when it was scheduled. */
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
export type JobHandler = (context: JobContext) => Promise<void>;
/** Handlers by queue, then by name of task. */
export type JobHandlers = Partial<Record<QueueName, Record<string, JobHandler>>>;

/** Rights of the author read again now: a disabled account or a withdrawn delegation stops what it had started. */
async function actorOf(database: Database, job: Job<JobData>): Promise<Actor> {
  const { actorId } = job.data;
  const worker: Actor = { kind: 'worker', job: job.name };
  if (!actorId) return worker;
  const author = await database.run(worker, (tx) => tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true } }));
  if (author?.status !== 'ACTIVE' || author.role === 'CREDITOR') throw new Error('author no longer active');
  return { kind: 'staff', userId: author.id, role: author.role, delegations: [] };
}

export function startWorkers(parts: {
  database: Database;
  logger: AppLogger;
  connection: ConnectionOptions;
  handlers: JobHandlers;
  prefix?: string;
  concurrency?: Partial<Record<QueueName, number>>;
}) {
  const workers = Object.entries(parts.handlers).map(([queue, handlers]) => {
    const worker = new Worker<JobData>(
      queue,
      async (job) => {
        const handler = handlers[job.name];
        if (!handler) throw new Error('unknown task');
        const actor = await actorOf(parts.database, job);
        await handler({ payload: job.data.payload, run: (work) => parts.database.run(actor, work) });
      },
      { connection: parts.connection, prefix: parts.prefix ?? QUEUE_PREFIX, concurrency: parts.concurrency?.[queue as QueueName] ?? 1 },
    );
    worker.on('error', () => undefined);
    // Neither the payload nor the message of the error: both could quote something.
    worker.on('failed', (job, error) =>
      parts.logger.error({ queue, task: job?.name, jobId: job?.id, attempt: job?.attemptsMade, errorType: error.name }, 'task failed'),
    );
    worker.on('completed', (job) => parts.logger.info({ queue, task: job.name, jobId: job.id }, 'task done'));
    return worker;
  });
  return { stop: () => Promise.all(workers.map((worker) => worker.close())).then(() => undefined) };
}
