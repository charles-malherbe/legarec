import 'reflect-metadata';
import { readConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { startWorkers } from './platform/queue/jobs';
import { maintenance, scheduleMaintenance } from './platform/queue/maintenance';
import { OutboxPublisher } from './platform/queue/publisher';
import { connectValkey } from './platform/queue/valkey';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
if (!config.JOBS_DATABASE_URL) throw new Error('Missing or invalid startup values: JOBS_DATABASE_URL');

const database = new Database(config.JOBS_DATABASE_URL, { poolSize: 8, timeoutMs: 60_000 });
const connection = connectValkey(config.VALKEY_URL, 'jobs');
// The publisher prefers a refusal to a wait: its tasks stay in the table.
const publishing = connectValkey(config.VALKEY_URL, 'api');
for (const link of [connection, publishing]) link.on('error', () => logger.warn('valkey unreachable'));
await publishing.connect().catch(() => undefined);

const publisher = new OutboxPublisher(database, logger, publishing);
const workers = startWorkers({ database, logger, connection, handlers: {}, scheduled: maintenance(database, logger) });
publisher.start();
await scheduleMaintenance(connection);
logger.info('worker ready');

// A task under way ends before the process does.
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all([publisher.stop(), workers.stop()]);
  await database.close();
  connection.disconnect();
  publishing.disconnect();
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
