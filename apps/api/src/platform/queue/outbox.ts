import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../database/database';

/** One queue per channel, so that a slow provider never holds the others back. Same list in the table. */
export const QUEUES = ['email', 'staff-email', 'sms', 'letter', 'pdf', 'imap', 'reminders', 'maintenance'] as const;
export type QueueName = (typeof QUEUES)[number];

/** Identifiers, dates, listed codes and short numbers; PostgreSQL refuses anything else. */
export type TaskPayload = Record<string, string | number | boolean>;
export interface Task {
  queue: QueueName;
  name: string;
  payload: TaskPayload;
  /** At most one task with this key, ever: `reminder:<id>`. */
  dedupeKey?: string;
  /** Kept in the table until then: a task planned for later is not in Valkey. */
  runAt?: Date;
}

/** Queues a task with the current transaction: if it rolls back, nothing leaves. */
@Injectable()
export class Outbox {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** False when the key was already used: the task was not queued again. */
  async add(task: Task): Promise<boolean> {
    const [row] = await this.database.tx.$queryRaw<{ queued: boolean }[]>`
      SELECT app.enqueue(${task.queue}, ${task.name}, ${JSON.stringify(task.payload)}::jsonb, ${task.dedupeKey ?? null}, ${task.runAt ?? null}::timestamptz) AS queued`;
    return row?.queued === true;
  }
}
