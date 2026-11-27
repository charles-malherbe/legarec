import 'reflect-metadata';
import { readWorkerConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { sweepFiles } from './platform/queue/maintenance';
import { storageKeys } from './modules/vault/storage-keys';
import { Vault } from './modules/vault/vault';
import { storageFor } from './platform/storage/storage';
import { ORPHAN_DELAY_MS, ORPHANS_PER_RUN } from './platform/storage/sweep';

/**
 *   node dist/sweep-files.js           counts the files of the storage that no row points at, erases nothing
 *   node dist/sweep-files.js --erase   erases them, a hundred at most each time, even when the night refused to
 * For a person who has looked: after a restoration, or when the purge of the night says that there are too many
 * (docs/deploiement.md, « Fichiers sans ligne »). Counts only, never a key.
 */
const erase = process.argv.includes('--erase');
const config = readWorkerConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const database = new Database(config.JOBS_DATABASE_URL, { poolSize: 1 });
try {
  const keys = storageKeys(new Vault(config), (work) => database.run({ kind: 'worker', job: 'storage-keys' }, work));
  const found = await sweepFiles(database, logger, storageFor(config, { keys }), erase ? 'force' : 'count');
  const without = found.orphans + found.parts;
  process.stdout.write(
    `Fichiers sans ligne : ${without} (dont ${found.parts} écriture(s) interrompue(s)), sur ${found.old + found.parts} fichier(s) de plus de ${ORPHAN_DELAY_MS / 86_400_000} jours ; ` +
      `${found.young} trop récent(s) pour être jugé(s) ; ${found.unknown} nom(s) inconnu(s), laissé(s) en place.\n` +
      (erase
        ? `Effacés : ${found.erased}.${without > found.erased ? ` Il en reste ${without - found.erased} : relancer la commande (${ORPHANS_PER_RUN} au plus à chaque fois).` : ''}\n`
        : 'Rien n’a été effacé. Pour effacer : la même commande, suivie de --erase.\n'),
  );
} catch {
  process.stderr.write('Balayage interrompu : voir le journal du programme, puis relancer la commande.\n');
  process.exitCode = 1;
} finally {
  await database.close();
}
