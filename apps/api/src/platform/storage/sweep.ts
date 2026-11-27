import type { Kept, Storage } from './storage';

/**
 * A file is judged only once it is this old (question 230). Between `put` and the commit of its row a file has no row
 * yet: a request holds its transaction 15 seconds at most, a task a few minutes, so a day would already be a wide
 * margin. A week, out of caution: these are the documents of the cases, and nothing presses. The delay does not protect
 * from a restoration of the database: the hold set by the purge at once does (maintenance.ts, `holdSweep`).
 */
export const ORPHAN_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
/** One run never erases more than this, whoever asks: a mistake costs a hundred files at most, and the rest waits. */
export const ORPHANS_PER_RUN = 100;
/**
 * A failed upload whose removal failed too is rare: a few files a year. More than twenty files without a row, or more
 * files without a row than with one, is not that but a database that is not the one of these files (restored, empty,
 * another one): the night erases nothing then, and fails until a person has looked (question 231).
 */
export const ORPHAN_ALARM = { files: 20, share: 0.5 };
const KEYS_AT_ONCE = 500;

/**
 * `erase`: the run of the night. `count`: nothing is erased, whatever is found. `force`: asked by a person who has
 * looked (`dist/sweep-files.js --erase <number>`) and who gives the number of files that the count has shown; the alarm
 * no longer stops it. The delay, the cap and the refusal of a database that holds none of the files hold for everyone.
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

/**
 * Why nothing was erased. `NO_ROW_HELD`: the database holds none of the old files, it is not theirs (nobody passes).
 * `TOO_MANY`, `TOO_LARGE_A_SHARE`: the alarm of the night. `CHANGED`: no longer the number that the person was shown.
 */
export class SweepRefused extends Error {
  override readonly name = 'SweepRefused';

  constructor(
    readonly code: 'NO_ROW_HELD' | 'TOO_MANY' | 'TOO_LARGE_A_SHARE' | 'CHANGED',
    readonly found: Swept,
  ) {
    super(`sweep refused: ${code}`);
  }
}
/** Erased before the storage or the database failed: the count is not lost with the failure. */
export class SweepInterrupted extends Error {
  override readonly name = 'SweepInterrupted';

  constructor(
    readonly found: Swept,
    override readonly cause: unknown,
  ) {
    super('sweep interrupted');
  }
}

/**
 * Erases the files of the storage that no row points at. `referenced` answers, among keys, those that a row holds,
 * erased documents included: their files belong to the purge of the documents, which erases and counts them.
 * Nothing is erased before everything was listed and counted.
 * `expected`: with `force`, the number of files without a row that the person was shown; any other number refuses.
 */
export async function sweep(
  storage: Storage,
  referenced: (keys: string[]) => Promise<string[]>,
  mode: SweepMode,
  { expected, now = Date.now() }: { expected?: number; now?: number } = {},
): Promise<Swept> {
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
  // A database that holds not one of the old files is not the one of these files: nobody erases against it, forced or not.
  if (found.old > 0 && found.orphans === found.old) throw new SweepRefused('NO_ROW_HELD', found);
  if (mode === 'erase' && found.orphans > ORPHAN_ALARM.files) throw new SweepRefused('TOO_MANY', found);
  if (mode === 'erase' && found.orphans > found.old * ORPHAN_ALARM.share) throw new SweepRefused('TOO_LARGE_A_SHARE', found);
  if (mode === 'force' && found.orphans + found.parts !== expected) throw new SweepRefused('CHANGED', found);
  for (const erase of doomed) {
    try {
      await erase();
    } catch (error) {
      throw new SweepInterrupted(found, error);
    }
    found.erased += 1;
  }
  return found;
}
