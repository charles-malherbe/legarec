import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { emailConfigOf } from './emails/config';
import { EmailsService } from './emails/emails.service';
import { EmailRenderer } from './emails/renderer';
import { ResendClient } from './emails/resend';
import { SimulatedTransport } from './emails/transport';
import { accountMail } from './modules/auth/account-mail';
import { accountJobs } from './modules/auth/auth.jobs';
import { AuthKeys } from './modules/auth/keys';
import { accessCodeJobs, reseal } from './modules/debtor-access/access-codes.jobs';
import { SettingValues } from './modules/settings/values';
import { aiJobs, sweepCaseEvents } from './ai/ai.jobs';
import { aiSetup } from './ai/provider';
import { documentJobs } from './modules/documents/documents.jobs';
import { planJobs } from './modules/payments/plans.jobs';
import { receiptJobs } from './modules/payments/receipts.jobs';
import { resendEventJobs } from './modules/reminders/resend-events.jobs';
import { letterEventJobs, sweepLetters, type LetterTracking } from './modules/reminders/letter-events.jobs';
import { letterJobs, letterPreparer } from './modules/reminders/letters.jobs';
import { sendingJobs, sweepSendings } from './modules/reminders/sendings.jobs';
import { MySendingBoxClient } from './letters/mysendingbox';
import { PdfRenderer } from './platform/pdf/pdf';
import { storageKeys } from './modules/vault/storage-keys';
import { Vault } from './modules/vault/vault';
import { ClamavScanner, SimulatedScanner } from './platform/scanner/scanner';
import { fileLeft, storageFor } from './platform/storage/storage';
import { readWorkerConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { startWorkers, type JobHandlers, type ScheduledHandlers, type Workers } from './platform/queue/jobs';
import { checkAntivirus, maintenance, scheduleMaintenance, scheduleRepeated } from './platform/queue/maintenance';
import { OutboxPublisher } from './platform/queue/publisher';
import { connectValkey, whenReady } from './platform/queue/valkey';

const config = readWorkerConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const database = new Database(config.JOBS_DATABASE_URL, { poolSize: 8, timeoutMs: 60_000 });
const connection = connectValkey(config.VALKEY_URL, 'jobs');
// The publisher prefers a refusal to a wait: its tasks stay in the table.
const publishing = connectValkey(config.VALKEY_URL, 'api');
for (const link of [connection, publishing]) link.on('error', () => logger.warn('valkey unreachable'));

const publisher = new OutboxPublisher(database, logger, publishing);
const emailSettings = () => database.run({ kind: 'worker', job: 'email-settings' }, async (tx) => emailConfigOf(await SettingValues.read(tx), config));
// Next to the folder of the sources, as to that of the programs once built.
const templates = fileURLToPath(new URL('../templates/emails/', import.meta.url));
const vault = new Vault(config);
const simulated = new SimulatedTransport(logger, config.DEV_MAIL_DIR);
const emails = new EmailsService(new EmailRenderer(templates), simulated, emailSettings);
// Resend never redirects: a redirection would carry the key and the message elsewhere.
const resend = new ResendClient((url, init) => fetch(url, { ...init, redirect: 'error' }));
const clamd = config.CLAMAV_URL ? new URL(config.CLAMAV_URL) : null;
// Without an antivirus in production, received files wait unread; elsewhere, the simulated one.
const scanner = clamd ? new ClamavScanner(clamd.hostname, Number(clamd.port)) : config.NODE_ENV === 'production' ? null : new SimulatedScanner();
// The keys of the bucket, read with the rights of the worker, outside of any task.
const storage = storageFor(config, {
  keys: storageKeys(vault, (work) => database.run({ kind: 'worker', job: 'storage-keys' }, work)),
  left: fileLeft(logger),
});
const pdf = new PdfRenderer(config.CHROMIUM_PATH);
const pdfTemplates = fileURLToPath(new URL('../templates/pdf/', import.meta.url));
// MySendingBox never redirects either.
const mysendingbox = new MySendingBoxClient((url, init) => fetch(url, { ...init, redirect: 'error' }));
// What became of the letters: asked to MySendingBox when a webhook names one, and again by the clock.
const letterTracking: LetterTracking = { vault, mysendingbox, real: config.MYSENDINGBOX_ENV === 'production', logger };
const handlers: JobHandlers = {
  documents: documentJobs(storage, scanner),
  pdf: { ...receiptJobs(storage, pdf, pdfTemplates), ...planJobs(storage, pdf, pdfTemplates) },
  // The e-mails of the accounts leave by Resend with the key and the domain of the reminders (question 217); without the
  // key outside production, they are simulated. One try: each reaches a person.
  email: accountJobs({
    keys: new AuthKeys(config),
    portals: config,
    mail: accountMail({
      asWorker: (work) => database.run({ kind: 'worker', job: 'account-email' }, work),
      vault,
      emails,
      resend,
      production: config.NODE_ENV === 'production',
      real: config.RESEND_ENV === 'production',
      devRecipients: config.DEV_RECIPIENTS ?? [],
      simulate: (message) => simulated.send(message),
    }),
  }),
  // The reminders leave by Resend when its key is in the vault; without it outside production, they are simulated. Their
  // own queue, where nothing is ever tried twice.
  reminders: {
    ...sendingJobs({
      database,
      asWorker: (work) => database.run({ kind: 'worker', job: 'case-reminder' }, work),
      vault,
      emails,
      resend,
      production: config.NODE_ENV === 'production',
      real: config.RESEND_ENV === 'production',
      devRecipients: config.DEV_RECIPIENTS ?? [],
      simulate: (message) => simulated.send(message),
      // « E-mail avec PDF joint »: the letter of the level, as the post would carry it.
      letters: { prepare: letterPreparer({ database, pdf, templates: pdfTemplates, portal: config.DEBTOR_PORTAL_URL }), storage },
    }),
    // The registered letters by MySendingBox (question 210): the `live_` key only with MYSENDINGBOX_ENV=production.
    ...letterJobs({
      database,
      vault,
      storage,
      pdf,
      templates: pdfTemplates,
      mysendingbox,
      asWorker: (work) => database.run({ kind: 'worker', job: 'case-letter' }, work),
      production: config.NODE_ENV === 'production',
      real: config.MYSENDINGBOX_ENV === 'production',
      portal: config.DEBTOR_PORTAL_URL,
    }),
  },
  // With what Resend says of the reminders afterwards: nothing leaves from there, and it may wait behind the purge.
  maintenance: { ...accessCodeJobs(vault), ...resendEventJobs({ logger }), ...letterEventJobs(letterTracking) },
  ai: aiJobs(() => aiSetup(config), vault),
};
const resealAll = async () => {
  const { resealed, unreadable } = await reseal((work) => database.run({ kind: 'worker', job: 'reseal' }, work), vault);
  if (unreadable) logger.error({ count: unreadable }, 'access codes unreadable');
  else if (resealed) logger.info({ count: resealed }, 'access codes encrypted again');
};
let workers: Workers | undefined;
let hourly: NodeJS.Timeout | undefined;
let stopping = false;
/** A task under way ends before the process does. */
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  clearInterval(hourly);
  await Promise.all([publisher.stop(), workers?.stop()]);
  await pdf.close();
  await database.close();
  connection.disconnect();
  publishing.disconnect();
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());

async function main() {
  // A queue whose reader starts without Valkey is never read again: waited for, however long it takes.
  await Promise.all([whenReady(connection), whenReady(publishing)]);
  if (stopping) return;
  // Started again by its container, in a clean state.
  const onDead = () => void stop(1);
  const night = maintenance(database, logger, storage, resealAll);
  const scheduled: ScheduledHandlers = {
    ...night,
    maintenance: {
      ...night.maintenance,
      // Only the worker reaches clamd: it asks it every 10 minutes, and tells the Developer when it no longer answers.
      ...(scanner ? { 'antivirus-check': async () => void (await checkAntivirus(database, logger, scanner)) } : {}),
    },
    // Something new on a case: its summary, once the case has been quiet for a few minutes (docs/ia.md).
    // No reminder stays queued for ever: abandoned or too old, it fails and the case says so.
    reminders: {
      'sendings-sweep': async () => void (await sweepSendings((work) => database.run({ kind: 'worker', job: 'sendings-sweep' }, work))),
      // A webhook may be lost: the letters on their way are asked again.
      'letters-tracking': async () => void (await sweepLetters((work) => database.run({ kind: 'worker', job: 'letters-tracking' }, work), letterTracking)),
    },
    ai: {
      'case-events': async () =>
        void (await sweepCaseEvents(
          () => aiSetup(config),
          (work) => database.run({ kind: 'worker', job: 'ai-case-events' }, work),
        )),
    },
  };
  workers = startWorkers({ database, logger, connection, handlers, scheduled, onDead });
  publisher.start();
  const schedule = () =>
    Promise.all([
      scheduleMaintenance(connection).catch(() => logger.warn('maintenance not scheduled')),
      ...(scanner
        ? [
            scheduleRepeated(connection, { queue: 'maintenance', name: 'antivirus-check', pattern: '*/10 * * * *', attempts: 1 }).catch(() =>
              logger.warn('check of the antivirus not scheduled'),
            ),
          ]
        : []),
      scheduleRepeated(connection, { queue: 'reminders', name: 'sendings-sweep', pattern: '*/5 * * * *', attempts: 1 }).catch(() =>
        logger.warn('sweep of the sendings not scheduled'),
      ),
      scheduleRepeated(connection, { queue: 'reminders', name: 'letters-tracking', pattern: '20 */6 * * *', attempts: 1 }).catch(() =>
        logger.warn('tracking of the letters not scheduled'),
      ),
      scheduleRepeated(connection, { queue: 'ai', name: 'case-events', pattern: '*/5 * * * *', attempts: 1 }).catch(() =>
        logger.warn('case events of the assistant not scheduled'),
      ),
    ]);
  // Again every hour: the schedule lives in Valkey, and would be lost with it.
  hourly = setInterval(() => void schedule(), 3_600_000);
  await schedule();
  logger.info('worker ready');
}
void main();
