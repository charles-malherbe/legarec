import type { AutomaticEmail } from '@legarec/contracts';
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { inject } from 'vitest';
import { emailConfigOf } from '../src/emails/config';
import { EmailsService } from '../src/emails/emails.service';
import { EmailRenderer, TEMPLATES_DIR } from '../src/emails/renderer';
import { accountJobs } from '../src/modules/auth/auth.jobs';
import { AuthKeys } from '../src/modules/auth/keys';
import { SettingValues } from '../src/modules/settings/values';
import { Database } from '../src/platform/database/database';
import { createLogger } from '../src/platform/logging/logger';
import { startWorkers } from '../src/platform/queue/jobs';
import { OutboxPublisher } from '../src/platform/queue/publisher';
import { connectValkey } from '../src/platform/queue/valkey';
import type { TestApp } from './app';

export interface Mail {
  name: AutomaticEmail;
  to: string;
  data: Record<string, unknown>;
  subject: string;
  html: string;
}

/** The real worker, whose e-mails go nowhere. */
export function startMailWorker(test: TestApp) {
  const prefix = `test-${randomBytes(5).toString('hex')}`;
  const logger = createLogger('debug', new Writable({ write: (chunk: Buffer, _encoding, done) => (test.logs.push(chunk.toString()), done()) }));
  const database = new Database(test.database.url('jobs'));
  const valkey = connectValkey(inject('valkeyUrl'), 'jobs');
  const mails: Mail[] = [];
  let sending: Pick<Mail, 'name' | 'data'> | undefined;
  const settings = () => database.run({ kind: 'worker', job: 'email-settings' }, async (tx) => emailConfigOf(await SettingValues.read(tx), test.config));
  const emails = new EmailsService(
    new EmailRenderer(TEMPLATES_DIR),
    // The page itself is left out of what a failed test prints.
    { send: ({ to, subject, html }) => Promise.resolve(void mails.push(Object.defineProperty({ ...sending!, to, subject } as Mail, 'html', { value: html }))) },
    settings,
  );
  const send = (name: AutomaticEmail, to: string, data: unknown) => {
    sending = { name, data: data as Mail['data'] };
    return emails.send(name, to, data);
  };
  const handlers = { email: accountJobs({ keys: new AuthKeys(test.config), portals: test.config, send }) };
  const workers = startWorkers({ database, logger, connection: valkey, handlers, prefix });
  const publisher = new OutboxPublisher(database, logger, valkey, prefix);
  return {
    prefix,
    valkey,
    /** Runs everything queued so far, and gives what was sent. */
    run: async (): Promise<Mail[]> => {
      await publisher.publish();
      for (let i = 0; i < 400; i += 1) {
        const { rows } = await test.database.admin.query('SELECT 1 FROM outbox WHERE published_at IS NOT NULL AND done_at IS NULL AND failed_at IS NULL');
        if (!rows.length) return mails.splice(0);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('tasks still running');
    },
    stop: async () => {
      await Promise.all([publisher.stop(), workers.stop()]);
      await database.close();
      valkey.disconnect();
    },
  };
}
export type MailWorker = ReturnType<typeof startMailWorker>;
