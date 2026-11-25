import 'reflect-metadata';
import { readConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { startWorkers } from './platform/queue/jobs';
import { maintenanceHandlers, scheduleMaintenance } from './platform/queue/maintenance';
import { OutboxPublisher } from './platform/queue/publisher';
import { connectValkey } from './platform/queue/valkey';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
if (!config.JOBS_DATABASE_URL) throw new Error('Missing or invalid startup values: JOBS_DATABASE_URL');

const database = new Database(config.JOBS_DATABASE_URL, { poolSize: 8 });
const connection = connectValkey(config.VALKEY_URL, 'jobs');
connection.on('error', () => logger.warn('valkey unreachable'));

const publisher = new OutboxPublisher(database, logger, connection);
const workers = startWorkers({ database, logger, connection, handlers: maintenanceHandlers(database, logger) });
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
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
