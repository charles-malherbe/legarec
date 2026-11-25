import { Queue, type JobsOptions } from 'bullmq';
import type { Database } from '../database/database';
import type { AppLogger } from '../logging/logger';
import { QUEUES, type QueueName } from './outbox';
import type { Valkey } from './valkey';

export const QUEUE_PREFIX = 'legarec';
const BATCH = 100;

/**
 * A job carries nothing: the worker reads the task again from PostgreSQL. Whoever can write in Valkey can neither invent
 * a task nor change its author. Nothing of an error stays there either: neither message nor stack.
 */
const OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  stackTraceLimit: 0,
  keepLogs: 0,
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};

const ADD_MS = 5_000;
function atMost<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('VALKEY_SLOW')), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

interface Pending {
  id: string;
  queue: QueueName;
  name: string;
}

/** Moves the committed tasks from PostgreSQL to Valkey. Run twice, it adds nothing: the number of the task is that of the job. */
export class OutboxPublisher {
  private readonly queues = new Map<QueueName, Queue>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly database: Database,
    private readonly logger: AppLogger,
    private readonly connection: Valkey,
    prefix = QUEUE_PREFIX,
  ) {
    for (const name of QUEUES) {
      const queue = new Queue(name, { connection, prefix, defaultJobOptions: OPTIONS });
      queue.on('error', () => this.logger.warn({ queue: name }, 'queue unreachable'));
      this.queues.set(name, queue);
    }
  }

  /** Publishes one batch and returns its size. Valkey is called outside of any transaction. */
  async publish(): Promise<number> {
    // A queue waits for Valkey for as long as it takes: asked first, so that no task is held meanwhile.
    if (this.connection.status !== 'ready') throw new Error('VALKEY_AWAY');
    const worker = { kind: 'worker', job: 'outbox' } as const;
    // Claimed for a minute: several publishers never take the same task, and a lost one is taken again.
    const tasks = await this.database.run(
      worker,
      (tx) => tx.$queryRaw<Pending[]>`
        UPDATE outbox SET claimed_at = now() WHERE id IN (
          SELECT id FROM outbox
          WHERE published_at IS NULL AND (run_at IS NULL OR run_at <= now()) AND (claimed_at IS NULL OR claimed_at < now() - interval '1 minute')
          ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, queue, name`,
    );
    const sent: string[] = [];
    try {
      // Numbers are drawn in order of time: the oldest task leaves first.
      for (const task of tasks.sort((left, right) => (left.id < right.id ? -1 : 1))) {
        await atMost(ADD_MS, this.queues.get(task.queue)!.add(task.name, {}, { jobId: task.id }));
        sent.push(task.id);
      }
    } finally {
      const left = tasks.filter((task) => !sent.includes(task.id)).map((task) => task.id);
      await this.database.run(worker, async (tx) => {
        if (sent.length) await tx.$executeRaw`UPDATE outbox SET published_at = now() WHERE id = ANY (${sent}::uuid[])`;
        if (left.length) await tx.$executeRaw`UPDATE outbox SET claimed_at = NULL WHERE id = ANY (${left}::uuid[])`;
      });
    }
    return sent.length;
  }

  start(everyMs = 1_000): void {
    const round = async () => {
      try {
        while ((await this.publish()) === BATCH);
      } catch (error) {
        // PostgreSQL or Valkey away: the tasks wait in the table, nothing is lost.
        this.logger.warn({ errorType: (error as Error).name }, 'outbox not published');
      }
      this.timer = setTimeout(() => (this.running = round()), everyMs);
    };
    this.running = round();
  }

  async stop(): Promise<void> {
    await this.running;
    clearTimeout(this.timer);
    // Closing a queue waits for Valkey; a process that stops does not.
    await Promise.race([
      Promise.allSettled([...this.queues.values()].map((queue) => queue.close())),
      new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
    ]);
  }
}
