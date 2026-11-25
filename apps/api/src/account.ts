import 'reflect-metadata';
import { accountCommand } from './modules/auth/account-command';
import { AuthKeys } from './modules/auth/keys';
import { readWorkerConfig } from './platform/config/config';
import { Database } from './platform/database/database';

/**
 *   node dist/account.js director <adresse> <prénom> <nom>
 *   node dist/account.js lien <adresse>
 */
const config = readWorkerConfig(process.env);
const database = new Database(config.JOBS_DATABASE_URL, { poolSize: 1 });
try {
  process.stdout.write(`${await accountCommand({ database, keys: new AuthKeys(config), portals: config }, process.argv.slice(2))}\n`);
} catch {
  // The message of the database may quote what was typed.
  process.stderr.write('Refusé : un Directeur existe déjà, ou cette adresse est prise.\n');
  process.exitCode = 1;
} finally {
  await database.close();
}
