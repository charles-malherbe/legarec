import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { emailConfigOf } from './emails/config';
import { EmailsService } from './emails/emails.service';
import { EmailRenderer } from './emails/renderer';
import { SimulatedTransport } from './emails/transport';
import { accountJobs } from './modules/auth/auth.jobs';
import { AuthKeys } from './modules/auth/keys';
import { accessCodeJobs } from './modules/debtor-access/access-codes.jobs';
import { SettingValues } from './modules/settings/values';
import { Vault } from './modules/vault/vault';
import { readWorkerConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { startWorkers, type JobHandlers, type Workers } from './platform/queue/jobs';
import { maintenance, scheduleMaintenance } from './platform/queue/maintenance';
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
const emails = new EmailsService(new EmailRenderer(templates), new SimulatedTransport(logger, config.DEV_MAIL_DIR), emailSettings);
const handlers: JobHandlers = {
  email: accountJobs({ keys: new AuthKeys(config), portals: config, send: (name, to, data) => emails.send(name, to, data) }),
  maintenance: accessCodeJobs(new Vault(config)),
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
  workers = startWorkers({ database, logger, connection, handlers, scheduled: maintenance(database, logger), onDead });
  publisher.start();
  const schedule = () => scheduleMaintenance(connection).catch(() => logger.warn('maintenance not scheduled'));
  // Again every hour: the schedule lives in Valkey, and would be lost with it.
  hourly = setInterval(() => void schedule(), 3_600_000);
  await schedule();
  logger.info('worker ready');
}
void main();
