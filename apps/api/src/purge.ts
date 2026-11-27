import 'reflect-metadata';
import { readWorkerConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { purge } from './platform/queue/maintenance';
import { storageKeys } from './modules/vault/storage-keys';
import { Vault } from './modules/vault/vault';
import { storageFor } from './platform/storage/storage';

/**
 *   node dist/purge.js
 * The purge of the night, at once: after a restoration, before anyone signs in, what had been removed must go again
 * (docs/deploiement.md, « Restaurer la base »). Counts only, never what was removed. The files of the storage that no
 * row points at are counted by the journal and never erased here: a database just restored has lost the rows of the
 * files received since (`dist/sweep-files.js`).
 */
const config = readWorkerConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const database = new Database(config.JOBS_DATABASE_URL, { poolSize: 1 });
try {
  const keys = storageKeys(new Vault(config), (work) => database.run({ kind: 'worker', job: 'storage-keys' }, work));
  const counts = await purge(database, logger, storageFor(config, { keys }));
  process.stdout.write(
    `Purge faite : ${Object.entries(counts)
      .map(([kind, removed]) => `${kind} ${removed}`)
      .join(', ')}.\n`,
  );
} catch {
  process.stderr.write('Purge incomplète : voir le journal du programme, puis la relancer avant d’ouvrir l’accès.\n');
  process.exitCode = 1;
} finally {
  await database.close();
}
