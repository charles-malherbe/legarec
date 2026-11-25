import { Queue, type ConnectionOptions } from 'bullmq';
import type { Database } from '../database/database';
import type { AppLogger } from '../logging/logger';
import { QUEUES, type QueueName } from './outbox';

export const QUEUE_PREFIX = 'legarec';
export interface JobData {
  /** Collaborator whose rights apply; absent for a scheduled task. */
  actorId?: string;
  payload: Record<string, string | number | boolean>;
}

interface Pending {
  id: string;
  queue: string;
  name: string;
  payload: JobData['payload'];
  actor_id: string | null;
  run_at: Date | null;
}

const BATCH = 100;
/** Retries are spaced out; a task that still fails stays visible for the Developer. */
const OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 30 * 86_400 },
};

/** Moves the committed tasks from PostgreSQL to Valkey. Run twice, it adds nothing: the number of the task is that of the job. */
export class OutboxPublisher {
  private readonly queues = new Map<QueueName, Queue<JobData>>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly database: Database,
    private readonly logger: AppLogger,
    connection: ConnectionOptions,
    prefix = QUEUE_PREFIX,
  ) {
    for (const name of QUEUES) {
      const queue = new Queue<JobData>(name, { connection, prefix, defaultJobOptions: OPTIONS });
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
  }

  /** Publishes one batch and returns its size. */
  publish(): Promise<number> {
    return this.database.run({ kind: 'worker', job: 'outbox' }, async (tx) => {
      const tasks = await tx.$queryRaw<Pending[]>`
        SELECT id, queue, name, payload, actor_id, run_at FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`;
      for (const task of tasks) {
        const queue = this.queues.get(task.queue as QueueName);
        if (!queue) {
          this.logger.error({ taskId: task.id, queue: task.queue }, 'unknown queue');
          continue;
        }
        const delay = task.run_at ? Math.max(0, task.run_at.getTime() - Date.now()) : 0;
        await queue.add(task.name, { payload: task.payload, ...(task.actor_id ? { actorId: task.actor_id } : {}) }, { jobId: task.id, delay });
      }
      const published = tasks.filter((task) => this.queues.has(task.queue as QueueName)).map((task) => task.id);
      if (published.length) await tx.$executeRaw`UPDATE outbox SET published_at = now() WHERE id = ANY (${published}::uuid[])`;
      return published.length;
    });
  }

  start(everyMs = 1_000): void {
    const round = async () => {
      try {
        while ((await this.publish()) === BATCH);
      } catch {
        // PostgreSQL or Valkey away: the tasks wait in the table, nothing is lost.
        this.logger.warn('outbox not published, will retry');
      }
      this.timer = setTimeout(() => (this.running = round()), everyMs);
    };
    this.running = round();
  }

  async stop(): Promise<void> {
    await this.running;
    clearTimeout(this.timer);
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
