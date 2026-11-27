import 'reflect-metadata';
import { readWorkerConfig } from './platform/config/config';
import { Database } from './platform/database/database';
import { createLogger } from './platform/logging/logger';
import { resumeSweep, sweepFiles, sweepHeld } from './platform/queue/maintenance';
import { storageKeys } from './modules/vault/storage-keys';
import { Vault } from './modules/vault/vault';
import { storageFor } from './platform/storage/storage';
import { ORPHAN_DELAY_MS, ORPHANS_PER_RUN, SweepInterrupted, SweepRefused, type Swept } from './platform/storage/sweep';

/**
 *   node dist/sweep-files.js                  counts the files of the storage that no row points at, erases nothing
 *   node dist/sweep-files.js --erase <number> erases them, a hundred at most each time, even when the night refuses to;
 *                                             <number>: how many the count has just shown, any other number is refused
 *   node dist/sweep-files.js --resume         lets the night erase again, after a restoration
 * For a person who has looked (docs/deploiement.md, « Fichiers sans ligne »). Counts only, never a key.
 */
const [command, value, ...rest] = process.argv.slice(2);
const expected = command === '--erase' && /^\d{1,9}$/u.test(value ?? '') ? Number(value) : null;
const valid = rest.length === 0 && (command === undefined || (command === '--resume' && value === undefined) || expected !== null);
const said = (found: Swept) =>
  `Fichiers sans ligne : ${found.orphans + found.parts} (dont ${found.parts} écriture(s) interrompue(s)), sur ${found.old + found.parts} fichier(s) de plus de ` +
  `${ORPHAN_DELAY_MS / 86_400_000} jours ; ${found.young} trop récent(s) pour être jugé(s) ; ${found.unknown} nom(s) inconnu(s), laissé(s) en place.\n`;
const REFUSALS: Record<SweepRefused['code'], string> = {
  NO_ROW_HELD: 'Rien n’a été effacé : la base ne détient aucun de ces fichiers, ce n’est pas la leur. Aucune commande ne passe outre.',
  CHANGED: 'Rien n’a été effacé : ce n’est pas le nombre donné. Recompter, puis redonner le nombre affiché.',
  TOO_MANY: 'Rien n’a été effacé.',
  TOO_LARGE_A_SHARE: 'Rien n’a été effacé.',
};

if (!valid) {
  process.stderr.write('Usage : node dist/sweep-files.js [--erase <nombre affiché par le comptage> | --resume]\n');
  process.exitCode = 2;
} else {
  const config = readWorkerConfig(process.env);
  const logger = createLogger(config.LOG_LEVEL);
  const database = new Database(config.JOBS_DATABASE_URL, { poolSize: 1 });
  try {
    if (command === '--resume') {
      await resumeSweep(database);
      process.stdout.write('Effacement des fichiers sans ligne repris : il aura lieu chaque nuit.\n');
    } else {
      const keys = storageKeys(new Vault(config), (work) => database.run({ kind: 'worker', job: 'storage-keys' }, work));
      const found = await sweepFiles(database, logger, storageFor(config, { keys }), expected === null ? 'count' : 'force', expected ?? undefined);
      const left = found.orphans + found.parts - found.erased;
      process.stdout.write(
        said(found) +
          (expected === null
            ? `Rien n’a été effacé. Pour effacer : la même commande, suivie de --erase ${found.orphans + found.parts}.\n`
            : `Effacés : ${found.erased}.${left ? ` Il en reste ${left} : relancer avec --erase ${left} (${ORPHANS_PER_RUN} au plus à chaque fois).` : ''}\n`) +
          ((await sweepHeld(database)) ? 'L’effacement de la nuit est suspendu depuis une restauration ; pour le reprendre : --resume.\n' : ''),
      );
    }
  } catch (error) {
    if (error instanceof SweepRefused) process.stderr.write(`${said(error.found)}${REFUSALS[error.code]}\n`);
    else if (error instanceof SweepInterrupted)
      process.stderr.write(`Balayage interrompu après ${error.found.erased} fichier(s) effacé(s) : voir le journal du programme, puis recompter.\n`);
    else process.stderr.write('Balayage impossible : voir le journal du programme.\n');
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
