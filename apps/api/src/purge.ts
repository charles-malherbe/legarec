import 'reflect-metadata';
import { readWorkerConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { holdSweep, purge, sweepFiles } from './platform/queue/maintenance';
import { storageKeys } from './modules/vault/storage-keys';
import { Vault } from './modules/vault/vault';
import { storageFor } from './platform/storage/storage';

/**
 *   node dist/purge.js
 * The purge of the night, at once: after a restoration, before anyone signs in, what had been removed must go again
 * (docs/deploiement.md, « Restaurer la base »). Counts only, never what was removed.
 * First of all, the sweep of the night is held: a database just restored has lost the rows of the files received since,
 * and none of them is erased until a person has looked and typed `node dist/sweep-files.js --resume`.
 */
const config = readWorkerConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const database = new Database(config.JOBS_DATABASE_URL, { poolSize: 1 });
try {
  const keys = storageKeys(new Vault(config), (work) => database.run({ kind: 'worker', job: 'storage-keys' }, work));
  const storage = storageFor(config, { keys });
  await holdSweep(database);
  process.stdout.write('Effacement des fichiers sans ligne suspendu : à lever par « node dist/sweep-files.js --resume » après vérification.\n');
  const counts = await purge(database, logger, storage);
  process.stdout.write(
    `Purge faite : ${Object.entries(counts)
      .map(([kind, removed]) => `${kind} ${removed}`)
      .join(', ')}.\n`,
  );
  // For the person who restores: what the night would have judged. A storage out of reach is said, and stops nothing.
  const found = await sweepFiles(database, logger, storage, 'count').catch(() => null);
  process.stdout.write(
    found
      ? `Fichiers sans ligne : ${found.orphans + found.parts}, aucun effacé.\n`
      : 'Fichiers sans ligne : non comptés, le stockage n’a pas pu être lu en entier.\n',
  );
} catch {
  process.stderr.write('Purge incomplète : voir le journal du programme, puis la relancer avant d’ouvrir l’accès.\n');
  process.exitCode = 1;
} finally {
  await database.close();
}
