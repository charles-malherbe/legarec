import type { AutomaticEmail } from '@legarec/contracts';
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { inject } from 'vitest';
import { emailConfigOf } from '../src/emails/config';
import { EmailsService, type AutomaticMessage } from '../src/emails/emails.service';
import { ResendClient, type HttpClient } from '../src/emails/resend';
import { EmailRenderer, TEMPLATES_DIR } from '../src/emails/renderer';
import { aiJobs } from '../src/ai/ai.jobs';
import type { AiSetup } from '../src/ai/provider';
import { accountJobs } from '../src/modules/auth/auth.jobs';
import { AuthKeys } from '../src/modules/auth/keys';
import { accessCodeJobs } from '../src/modules/debtor-access/access-codes.jobs';
import { documentJobs } from '../src/modules/documents/documents.jobs';
import { receiptJobs } from '../src/modules/payments/receipts.jobs';
import { sendingJobs } from '../src/modules/reminders/sendings.jobs';
import { PdfRenderer } from '../src/platform/pdf/pdf';
import { fileURLToPath } from 'node:url';
import { SimulatedScanner } from '../src/platform/scanner/scanner';
import { storageFor } from '../src/platform/storage/storage';
import { SettingValues } from '../src/modules/settings/values';
import { Vault } from '../src/modules/vault/vault';
import { Database, type Transaction } from '../src/platform/database/database';
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

/**
 * The real worker, whose e-mails go nowhere. `http` stands for the provider of the reminders: without it, a call to a
 * provider fails the test, for no test ever reaches one.
 */
export function startMailWorker(
  test: TestApp,
  { ai, http, production = false, real = false, now }: { ai?: AiSetup; http?: HttpClient; production?: boolean; real?: boolean; now?: () => Date } = {},
) {
  const prefix = `test-${randomBytes(5).toString('hex')}`;
  const logger = createLogger('debug', new Writable({ write: (chunk: Buffer, _encoding, done) => (test.logs.push(chunk.toString()), done()) }));
  const database = new Database(test.database.url('jobs'));
  const valkey = connectValkey(inject('valkeyUrl'), 'jobs');
  const mails: Mail[] = [];
  /** The reminders that left for nobody, for want of a key. */
  const simulated: AutomaticMessage[] = [];
  const vault = new Vault(test.config);
  const pdf = new PdfRenderer();
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
  const handlers = {
    email: {
      ...accountJobs({ keys: new AuthKeys(test.config), portals: test.config, send }),
    },
    reminders: sendingJobs({
      database,
      asWorker: (work) => database.run({ kind: 'worker', job: 'case-reminder' }, work),
      vault,
      emails,
      resend: new ResendClient(http ?? (() => Promise.reject(new Error('a test never reaches a provider')))),
      production,
      real,
      devRecipients: ['recette@legarec.test'],
      simulate: (message) => Promise.resolve(void simulated.push(message)),
      ...(now ? { now } : {}),
    }),
    maintenance: accessCodeJobs(vault),
    documents: documentJobs(storageFor(test.config), new SimulatedScanner()),
    pdf: receiptJobs(storageFor(test.config), pdf, fileURLToPath(new URL('../templates/pdf/', import.meta.url))),
    ai: aiJobs(() => ai ?? null, vault),
  };
  const workers = startWorkers({ database, logger, connection: valkey, handlers, prefix });
  const publisher = new OutboxPublisher(database, logger, valkey, prefix);
  return {
    prefix,
    valkey,
    simulated,
    /** With the rights of the worker, for what the clock runs (`sweepSendings`) and what a test asks as the worker. */
    asWorker: <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => database.run({ kind: 'worker', job: 'test' }, work),
    /** Runs everything queued so far, and gives what was sent. */
    run: async (): Promise<Mail[]> => {
      // A worker just started has not reached Valkey yet: publishing then would say nothing of the tasks.
      for (let i = 0; i < 300 && valkey.status !== 'ready'; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
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
      await pdf.close();
      await database.close();
      valkey.disconnect();
    },
  };
}
export type MailWorker = ReturnType<typeof startMailWorker>;
