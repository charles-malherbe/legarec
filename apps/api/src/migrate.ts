import { fileURLToPath } from 'node:url';
import { ConfigError } from './platform/config/config';
import { isOwnService } from './platform/config/urls';
import { migrate } from './platform/database/migrate';

/** Run before each deployment, with the only account that may change the tables. Nothing is printed but names. */
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new ConfigError('Missing or invalid startup values: MIGRATION_DATABASE_URL');
if (process.env.NODE_ENV !== 'production' && !isOwnService(url))
  throw new ConfigError('Outside production, only 127.0.0.1 and never port 5432 or 6379: MIGRATION_DATABASE_URL');

const applied = await migrate(url, process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
process.stdout.write(applied.length ? `${applied.map((name) => `applied ${name}`).join('\n')}\n` : 'nothing to apply\n');
