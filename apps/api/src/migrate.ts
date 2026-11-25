import { fileURLToPath } from 'node:url';
import { readMigrationUrl } from './platform/config/config';
import { migrate } from './platform/database/migrate';

/** Run before each deployment, with the only account that may change the tables. Nothing is printed but names. */
const directory = process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../prisma/migrations', import.meta.url));
const applied = await migrate(readMigrationUrl(process.env), directory);
process.stdout.write(applied.length ? `${applied.map((name) => `applied ${name}`).join('\n')}\n` : 'nothing to apply\n');
