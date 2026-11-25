import 'reflect-metadata';
import { createApp } from './app';
import { readConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { connectValkey } from './platform/queue/valkey';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const valkey = connectValkey(config.VALKEY_URL, 'api');
// Without a listener, a lost connection would stop the process; the client reconnects by itself.
valkey.on('error', () => logger.warn('valkey unreachable'));
await valkey.connect().catch(() => undefined);

const app = await createApp({ config, logger, database: new Database(config.DATABASE_URL), valkey });
await app.listen(config.PORT, config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
logger.info({ port: config.PORT, environment: config.NODE_ENV, letters: config.MYSENDINGBOX_ENV, ai: config.AI_ENABLED === 'true' }, 'api ready');
