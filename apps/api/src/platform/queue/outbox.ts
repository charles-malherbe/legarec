import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../database/database';

/** One queue per channel, so that a slow provider never holds the others back. */
export const QUEUES = ['email', 'staff-email', 'sms', 'letter', 'pdf', 'imap', 'reminders', 'maintenance'] as const;
export type QueueName = (typeof QUEUES)[number];

/** Identifiers and codes in capitals only; PostgreSQL refuses anything else. */
export type TaskPayload = Record<string, string | number | boolean>;
export interface Task {
  queue: QueueName;
  name: string;
  payload: TaskPayload;
  /** At most one task with this key, ever: `reminder:<id>`. */
  dedupeKey?: string;
  runAt?: Date;
}

/** Queues a task with the current transaction: if it rolls back, nothing leaves. */
@Injectable()
export class Outbox {
  constructor(@Inject(Database) private readonly database: Database) {}

  async add(task: Task): Promise<void> {
    await this.database.tx.$executeRaw`
      SELECT app.enqueue(${task.queue}, ${task.name}, ${JSON.stringify(task.payload)}::jsonb, ${task.dedupeKey ?? null}, ${task.runAt ?? null}::timestamptz)`;
  }
}
