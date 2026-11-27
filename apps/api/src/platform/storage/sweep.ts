import type { Kept, Storage } from './storage';

/**
 * A file is judged only once it is this old (question 230). Between `put` and the commit of its row a file has no row
 * yet: a request holds its transaction 15 seconds at most, a task a few minutes, so a day would already be a wide
 * margin. A week, because of the restorations: a database brought back to an earlier instant has lost the rows of the
 * files received since, and the firm keeps a week to notice it and to copy them before anything goes.
 */
export const ORPHAN_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
/** One run never erases more than this, whoever asks: a mistake costs a hundred files at most, and the rest waits. */
export const ORPHANS_PER_RUN = 100;
/**
 * A failed upload whose removal failed too is rare: a few files a year. More than twenty files without a row that are
 * also more than one file in twenty is not that, but a database that is not the one of these files (restored from long
 * ago, empty, another one): the run of the night erases nothing then, and fails until a person has looked (question 231).
 */
export const ORPHAN_ALARM = { files: 20, share: 0.05 };
const KEYS_AT_ONCE = 500;

/**
 * `erase`: the run of the night. `count`: nothing is erased, whatever is found. `force`: asked by a person who has
 * looked (`dist/sweep-files.js --erase`); the alarm no longer stops it, everything else holds.
 */
export type SweepMode = 'erase' | 'count' | 'force';

/** Counts, and nothing of the files: a key belongs in no journal. */
export interface Swept {
  /** Too recent to be judged, or without a date. */
  young: number;
  /** Old enough, under a valid key: with or without a row. */
  old: number;
  /** Among them, those that no row points at. */
  orphans: number;
  /** Writings interrupted before their end, old enough. */
  parts: number;
  /** Names that are no storage key: never touched. */
  unknown: number;
  erased: number;
}

export class TooManyOrphans extends Error {
  override readonly name = 'TooManyOrphans';

  constructor(readonly found: Swept) {
    super('too many files without a row');
  }
}

/**
 * Erases the files of the storage that no row points at. `referenced` answers, among keys, those that a row holds,
 * erased documents included: their files belong to the purge of the documents, which erases and counts them.
 * Nothing is erased before everything was listed and counted.
 */
export async function sweep(storage: Storage, referenced: (keys: string[]) => Promise<string[]>, mode: SweepMode, now = Date.now()): Promise<Swept> {
  const found: Swept = { young: 0, old: 0, orphans: 0, parts: 0, unknown: 0, erased: 0 };
  const doomed: (() => Promise<void>)[] = [];
  const doom = (erase: () => Promise<void>) => {
    if (doomed.length < ORPHANS_PER_RUN) doomed.push(erase);
  };
  const asked: Exclude<Kept, { kind: 'unknown' }>[] = [];
  const settle = async () => {
    if (!asked.length) return;
    const held = new Set(await referenced([...new Set(asked.map((file) => file.key))]));
    for (const file of asked.splice(0)) {
      if (held.has(file.key)) continue;
      found.orphans += 1;
      doom(file.erase);
    }
  };
  for await (const entry of storage.kept()) {
    if (entry.kind === 'unknown') found.unknown += 1;
    else if (!entry.modifiedAt || now - entry.modifiedAt.getTime() < ORPHAN_DELAY_MS) found.young += 1;
    else if (entry.kind === 'part') {
      found.parts += 1;
      doom(entry.erase);
    } else {
      found.old += 1;
      asked.push(entry);
      if (asked.length >= KEYS_AT_ONCE) await settle();
    }
  }
  await settle();
  if (mode === 'count') return found;
  if (mode === 'erase' && found.orphans > ORPHAN_ALARM.files && found.orphans > found.old * ORPHAN_ALARM.share) throw new TooManyOrphans(found);
  for (const erase of doomed) {
    await erase();
    found.erased += 1;
  }
  return found;
}
