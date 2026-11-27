import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BucketError, pathOf } from './bucket';
import { Storage, type Entry, type Files } from './storage';
import { ORPHAN_ALARM, ORPHAN_DELAY_MS, ORPHANS_PER_RUN, sweep, SweepInterrupted, SweepRefused } from './sweep';

const HOUR = 60 * 60 * 1000;
const bytes = (text: string) => new TextEncoder().encode(text);
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function folder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), 'legarec-sweep-'));
  folders.push(made);
  return made;
}
/** Every file under a folder, by its path from it. */
const filesOf = async (root: string) =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
/** Last written that long ago. */
const aged = async (root: string, name: string, ms: number) => {
  const at = new Date(Date.now() - ms);
  await utimes(join(root, name), at, at);
};
const OLD = ORPHAN_DELAY_MS + HOUR;
/** A file of the disk, written that long ago. */
async function kept(root: string, storage: Storage, ms = OLD): Promise<string> {
  const { key } = await storage.put(bytes('%PDF-1.4 essai'));
  await aged(root, pathOf(key), ms);
  return key;
}
/** The rows of a database: these keys, and what is asked of it. */
function rowsOf(keys: Iterable<string> = []) {
  const held = new Set(keys);
  const asked: string[][] = [];
  return {
    held,
    asked,
    referenced: (among: string[]) => {
      asked.push(among);
      return Promise.resolve(among.filter((key) => held.has(key)));
    },
  };
}

/** A bucket of this test, in memory: each object with its date. */
class Memory implements Files {
  readonly objects = new Map<string, Date | null>();
  down = false;
  readonly failing = new Set<string>();

  write(key: string) {
    this.objects.set(pathOf(key), new Date());
    return Promise.resolve();
  }
  read() {
    return Promise.resolve(null);
  }
  erase(key: string) {
    if (this.failing.has(key)) return Promise.reject(new BucketError('erase', 'AccessDenied'));
    if (this.down) return Promise.reject(new BucketError('erase', 'TimeoutError'));
    return Promise.resolve(this.objects.delete(pathOf(key)));
  }
  remove(key: string) {
    this.objects.delete(pathOf(key));
    return Promise.resolve();
  }
  async *list(): AsyncGenerator<Entry> {
    if (this.down) throw new BucketError('list', 'TimeoutError');
    for (const [name, modifiedAt] of this.objects) yield await Promise.resolve({ name, modifiedAt });
  }
}

describe('the sweep of the files without a row', () => {
  /** A storage of the disk with files that have their row: a database that is the one of these files. */
  async function start(heldFiles = 1) {
    const root = await folder();
    const storage = new Storage(root);
    const rows = rowsOf();
    for (let index = 0; index < heldFiles; index += 1) rows.held.add(await kept(root, storage));
    return { root, storage, ...rows, left: async () => (await filesOf(root)).filter((name) => !rows.held.has(name.slice(3))) };
  }
  const half = async (root: string, ms: number) => {
    const key = randomUUID();
    await mkdir(join(root, key.slice(0, 2)), { recursive: true });
    await writeFile(join(root, `${pathOf(key)}.part`), 'moitié');
    await aged(root, `${pathOf(key)}.part`, ms);
    return `${pathOf(key)}.part`;
  };
  const refusal = (work: Promise<unknown>) => work.then(() => null).catch((error: unknown) => (error instanceof SweepRefused ? error.code : error));

  it('erases an old file that no row points at, and keeps the one a row holds', async () => {
    const { root, storage, held, asked, referenced, left } = await start();
    const orphan = await kept(root, storage);
    expect(await sweep(storage, referenced, 'erase')).toEqual({ young: 0, old: 2, orphans: 1, parts: 0, unknown: 0, erased: 1 });
    expect(await filesOf(root)).toEqual([...held].map(pathOf));
    expect(asked.flat().sort()).toEqual([orphan, ...held].sort());
    // Nothing left to do.
    expect(await sweep(storage, referenced, 'erase')).toMatchObject({ old: 1, orphans: 0, erased: 0 });
    expect(await left()).toEqual([]);
  });

  it('never judges a file younger than the delay: its row may not be written yet', async () => {
    const { root, storage, held, asked, referenced, left } = await start();
    const fresh = await kept(root, storage, 0);
    const almost = await kept(root, storage, ORPHAN_DELAY_MS - HOUR);
    const due = await kept(root, storage, ORPHAN_DELAY_MS + HOUR);
    expect(await sweep(storage, referenced, 'erase')).toMatchObject({ young: 2, old: 2, orphans: 1, erased: 1 });
    expect(await left()).toEqual([pathOf(fresh), pathOf(almost)].sort());
    // Not even asked about.
    expect(asked.flat().sort()).toEqual([due, ...held].sort());
    // Forced by a person: the delay holds all the same.
    expect(await sweep(storage, referenced, 'force', { expected: 0 })).toMatchObject({ young: 2, erased: 0 });
    expect(await left()).toHaveLength(2);
    // A week at least: the time to notice a restoration (question 230).
    expect(ORPHAN_DELAY_MS).toBeGreaterThanOrEqual(7 * 24 * HOUR);
  });

  it('touches nothing whose name is not a storage key at its place', async () => {
    const { root, storage, referenced } = await start();
    const key = randomUUID();
    const other = key.startsWith('00') ? 'ff' : '00';
    await mkdir(join(root, key.slice(0, 2), 'sous-dossier'), { recursive: true });
    await mkdir(join(root, other), { recursive: true });
    await mkdir(join(root, 'archives'));
    const strangers = [
      'notes.txt',
      `${key}`,
      `archives/${key}`,
      `${key.slice(0, 2)}/notes.txt`,
      `${key.slice(0, 2)}/${key}.pdf`,
      `${key.slice(0, 2)}/${key.toUpperCase()}`,
      `${key.slice(0, 2)}/${key}.part.part`,
      `${key.slice(0, 2)}/sous-dossier/${randomUUID()}`,
      // A valid key, in the folder of another one.
      `${other}/${key}`,
      `${other}/${key}.part`,
    ];
    for (const name of strangers) {
      await writeFile(join(root, name), 'posé à la main');
      await aged(root, name, 10 * OLD);
    }
    // A link under the name of a key: never followed, never removed.
    const linked = randomUUID();
    await mkdir(join(root, linked.slice(0, 2)), { recursive: true });
    await symlink(join(root, 'notes.txt'), join(root, pathOf(linked)));
    const before = await filesOf(root);
    for (const found of [await sweep(storage, referenced, 'erase'), await sweep(storage, referenced, 'force', { expected: 0 })])
      // `archives` and the sub-folder are counted once each and never opened; the link is one more.
      expect(found).toEqual({ young: 0, old: 1, orphans: 0, parts: 0, unknown: strangers.length - 2 + 3, erased: 0 });
    expect(await filesOf(root)).toEqual(before);
  });

  it('erases what an interrupted writing left, once old enough, without asking the database about it', async () => {
    const { root, storage, held, asked, referenced, left } = await start();
    await half(root, OLD);
    const recent = await half(root, HOUR);
    expect(await sweep(storage, referenced, 'count')).toMatchObject({ young: 1, parts: 1, orphans: 0, erased: 0 });
    expect(await sweep(storage, referenced, 'erase')).toMatchObject({ young: 1, parts: 1, orphans: 0, erased: 1 });
    expect(await left()).toEqual([recent]);
    expect(new Set(asked.flat())).toEqual(held);
  });

  it('only counts when asked to count', async () => {
    const { root, storage, referenced, left } = await start();
    const orphan = await kept(root, storage);
    expect(await sweep(storage, referenced, 'count')).toEqual({ young: 0, old: 2, orphans: 1, parts: 0, unknown: 0, erased: 0 });
    expect(await left()).toEqual([pathOf(orphan)]);
  });

  it('never erases more than its cap in one run, even forced; the rest waits for the next one', async () => {
    const { root, storage, referenced, left } = await start();
    for (let index = 0; index < ORPHANS_PER_RUN + 7; index += 1) await kept(root, storage);
    await half(root, OLD);
    const all = ORPHANS_PER_RUN + 8;
    expect(await sweep(storage, referenced, 'force', { expected: all })).toMatchObject({ orphans: all - 1, parts: 1, erased: ORPHANS_PER_RUN });
    expect(await left()).toHaveLength(8);
    expect(await sweep(storage, referenced, 'force', { expected: 8 })).toMatchObject({ erased: 8 });
    expect(await left()).toEqual([]);
    expect(ORPHANS_PER_RUN).toBeLessThanOrEqual(100);
  });

  it('refuses at night beyond twenty files without a row, however large the storage: a restoration loses that many', async () => {
    const { root, storage, held, referenced, left } = await start(0);
    const orphans: string[] = [];
    for (let index = 0; index < ORPHAN_ALARM.files + 1; index += 1) orphans.push(await kept(root, storage));
    // 21 out of 2 100: one in a hundred, and refused all the same.
    for (let index = 0; index < 2_079; index += 1) held.add(await kept(root, storage));
    const refused = await sweep(storage, referenced, 'erase').catch((error: unknown) => error);
    expect(refused).toMatchObject({ name: 'SweepRefused', code: 'TOO_MANY', found: { old: 2_100, orphans: 21, erased: 0 } });
    expect(await left()).toHaveLength(21);
    // One less: a few failed uploads, erased.
    held.add(orphans.pop()!);
    expect(await sweep(storage, referenced, 'erase')).toMatchObject({ orphans: ORPHAN_ALARM.files, erased: ORPHAN_ALARM.files });
    expect(await left()).toEqual([]);
    expect(ORPHAN_ALARM.files).toBeLessThanOrEqual(20);
  });

  it('refuses at night when more files are without a row than with one, however few they are', async () => {
    const { root, storage, held, referenced, left } = await start(2);
    for (let index = 0; index < 3; index += 1) await kept(root, storage);
    expect(await refusal(sweep(storage, referenced, 'erase'))).toBe('TOO_LARGE_A_SHARE');
    expect(await left()).toHaveLength(3);
    // As many with a row as without: half, not more.
    held.add(await kept(root, storage));
    expect(await sweep(storage, referenced, 'erase')).toMatchObject({ old: 6, orphans: 3, erased: 3 });
    expect(ORPHAN_ALARM.share).toBeLessThanOrEqual(0.5);
  });

  it('never erases against a database that holds none of the old files, not even forced: it is not theirs', async () => {
    const { root, storage, referenced, left } = await start(0);
    await kept(root, storage);
    await half(root, OLD);
    for (const work of [sweep(storage, referenced, 'erase'), sweep(storage, referenced, 'force', { expected: 2 })])
      expect(await refusal(work)).toBe('NO_ROW_HELD');
    expect(await left()).toHaveLength(2);
    // Counting is always possible.
    expect(await sweep(storage, referenced, 'count')).toMatchObject({ old: 1, orphans: 1, parts: 1, erased: 0 });
  });

  it('lets a person who has looked erase beyond the alarm, by giving the number that the count has shown', async () => {
    const { root, storage, referenced, left } = await start(2);
    for (let index = 0; index < ORPHAN_ALARM.files + 1; index += 1) await kept(root, storage);
    expect(await refusal(sweep(storage, referenced, 'erase'))).toBe('TOO_MANY');
    // No number, or another one: files have come or gone since the person looked.
    for (const expected of [undefined, 20, 22]) {
      expect(await refusal(sweep(storage, referenced, 'force', expected === undefined ? {} : { expected }))).toBe('CHANGED');
    }
    expect(await left()).toHaveLength(21);
    expect(await sweep(storage, referenced, 'force', { expected: 21 })).toMatchObject({ erased: 21 });
    expect(await left()).toEqual([]);
  });

  it('sweeps the bucket as the disk, each file where it was found', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    let keysTyped = false;
    const storage = new Storage(root, { bucket: () => Promise.resolve(keysTyped ? bucket : null) });
    // Written to the disk before the keys were typed.
    await kept(root, storage);
    keysTyped = true;
    const old = new Date(Date.now() - OLD);
    const [orphan, held, alsoHeld, fresh, undated] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const key of [orphan, held, alsoHeld]) bucket.objects.set(pathOf(key), old);
    bucket.objects.set(pathOf(fresh), new Date());
    bucket.objects.set(pathOf(undated), null);
    const strangers = ['notes.txt', `${pathOf(randomUUID())}.part`, `zz/${randomUUID()}`, ''];
    for (const name of strangers) bucket.objects.set(name, old);
    expect(await sweep(storage, rowsOf([held, alsoHeld]).referenced, 'erase')).toEqual({ young: 2, old: 4, orphans: 2, parts: 0, unknown: 4, erased: 2 });
    expect([...bucket.objects.keys()].sort()).toEqual([pathOf(held), pathOf(alsoHeld), pathOf(fresh), pathOf(undated), ...strangers].sort());
    expect(await filesOf(root)).toEqual([]);
  });

  it('erases nothing when the bucket is out of reach: keys missing or bucket failing are not an empty bucket', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    let keysTyped = false;
    const storage = new Storage(root, { bucket: () => Promise.resolve(keysTyped ? bucket : null) });
    const held = await kept(root, storage);
    const onDisk = await kept(root, storage);
    const { referenced, asked } = rowsOf([held]);
    for (const mode of ['erase', 'force', 'count'] as const)
      await expect(sweep(storage, referenced, mode, { expected: 1 })).rejects.toMatchObject({ operation: 'list', code: 'NoKeys' });
    keysTyped = true;
    bucket.down = true;
    await expect(sweep(storage, referenced, 'erase')).rejects.toMatchObject({ operation: 'list', code: 'TimeoutError' });
    expect([await filesOf(root), asked]).toEqual([[pathOf(held), pathOf(onDisk)].sort(), []]);
    // Without any bucket in the configuration, the disk alone is the whole storage.
    expect(await sweep(new Storage(root), referenced, 'erase')).toMatchObject({ orphans: 1, erased: 1 });
  });

  it('tells how many files were erased before the storage failed', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    const storage = new Storage(root, { bucket: () => Promise.resolve(bucket) });
    const old = new Date(Date.now() - OLD);
    const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
    const all = [first, second, third, ...Array.from({ length: 3 }, () => randomUUID())];
    for (const key of all) bucket.objects.set(pathOf(key), old);
    bucket.failing.add(second);
    const stopped = await sweep(storage, rowsOf([third, ...all.slice(3)]).referenced, 'erase').catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(SweepInterrupted);
    expect(stopped).toMatchObject({ found: { orphans: 2, erased: 1 }, cause: { code: 'AccessDenied' } });
    expect(bucket.objects.has(pathOf(first))).toBe(false);
    expect(bucket.objects.has(pathOf(second))).toBe(true);
  });

  it('asks the database by batches, and fails with it', async () => {
    const { root, storage, asked, referenced } = await start(501);
    expect(await sweep(storage, referenced, 'erase')).toMatchObject({ old: 501, orphans: 0, erased: 0 });
    expect(asked.map((batch) => batch.length)).toEqual([500, 1]);
    await expect(sweep(storage, () => Promise.reject(new Error('database down')), 'erase')).rejects.toThrow('database down');
    expect(await filesOf(root)).toHaveLength(501);
  });

  it('holds nothing in a folder that does not exist yet', async () => {
    const storage = new Storage(join(await folder(), 'jamais-créé'));
    expect(await sweep(storage, rowsOf().referenced, 'erase')).toEqual({ young: 0, old: 0, orphans: 0, parts: 0, unknown: 0, erased: 0 });
  });
});
