import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BucketError, pathOf } from './bucket';
import { Storage, type Entry, type Files } from './storage';
import { ORPHAN_ALARM, ORPHAN_DELAY_MS, ORPHANS_PER_RUN, sweep, TooManyOrphans } from './sweep';

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

  write(key: string) {
    this.objects.set(pathOf(key), new Date());
    return Promise.resolve();
  }
  read() {
    return Promise.resolve(null);
  }
  erase(key: string) {
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
  it('erases an old file that no row points at, and keeps the one a row holds', async () => {
    const root = await folder();
    const storage = new Storage(root);
    const [orphan, held] = [await kept(root, storage), await kept(root, storage)];
    const rows = rowsOf([held]);
    expect(await sweep(storage, rows.referenced, 'erase')).toEqual({ young: 0, old: 2, orphans: 1, parts: 0, unknown: 0, erased: 1 });
    expect(await filesOf(root)).toEqual([pathOf(held)]);
    expect(rows.asked.flat().sort()).toEqual([orphan, held].sort());
    // Nothing left to do.
    expect(await sweep(storage, rows.referenced, 'erase')).toMatchObject({ old: 1, orphans: 0, erased: 0 });
  });

  it('never judges a file younger than the delay: its row may not be written yet', async () => {
    const root = await folder();
    const storage = new Storage(root);
    const fresh = await kept(root, storage, 0);
    const almost = await kept(root, storage, ORPHAN_DELAY_MS - HOUR);
    const due = await kept(root, storage, ORPHAN_DELAY_MS + HOUR);
    const rows = rowsOf();
    expect(await sweep(storage, rows.referenced, 'erase')).toMatchObject({ young: 2, old: 1, orphans: 1, erased: 1 });
    expect(await filesOf(root)).toEqual([pathOf(fresh), pathOf(almost)].sort());
    // Not even asked about.
    expect(rows.asked.flat()).toEqual([due]);
    // A week at least: the time to notice a restoration (question 230).
    expect(ORPHAN_DELAY_MS).toBeGreaterThanOrEqual(7 * 24 * HOUR);
  });

  it('touches nothing whose name is not a storage key at its place', async () => {
    const root = await folder();
    const storage = new Storage(root);
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
    const found = await sweep(storage, rowsOf().referenced, 'force');
    expect(found).toMatchObject({ old: 0, orphans: 0, parts: 0, erased: 0 });
    // `archives` and the sub-folder are counted once each and never opened; the link is one more.
    expect(found).toMatchObject({ young: 0, unknown: strangers.length - 2 + 3 });
    expect(await filesOf(root)).toEqual(before);
  });

  it('erases what an interrupted writing left, once old enough, without asking the database', async () => {
    const root = await folder();
    const storage = new Storage(root);
    const [old, recent] = [randomUUID(), randomUUID()];
    for (const [key, ms] of [
      [old, OLD],
      [recent, HOUR],
    ] as const) {
      await mkdir(join(root, key.slice(0, 2)), { recursive: true });
      await writeFile(join(root, `${pathOf(key)}.part`), 'moitié');
      await aged(root, `${pathOf(key)}.part`, ms);
    }
    const rows = rowsOf([old]);
    expect(await sweep(storage, rows.referenced, 'count')).toMatchObject({ young: 1, parts: 1, orphans: 0, erased: 0 });
    expect(await sweep(storage, rows.referenced, 'erase')).toMatchObject({ young: 1, parts: 1, orphans: 0, erased: 1 });
    expect(await filesOf(root)).toEqual([`${pathOf(recent)}.part`]);
    expect(rows.asked).toEqual([]);
  });

  it('only counts when asked to count', async () => {
    const root = await folder();
    const storage = new Storage(root);
    const orphan = await kept(root, storage);
    expect(await sweep(storage, rowsOf().referenced, 'count')).toEqual({ young: 0, old: 1, orphans: 1, parts: 0, unknown: 0, erased: 0 });
    expect(await filesOf(root)).toEqual([pathOf(orphan)]);
  });

  it('never erases more than its cap in one run, even forced; the rest waits for the next one', async () => {
    const root = await folder();
    const storage = new Storage(root);
    for (let index = 0; index < ORPHANS_PER_RUN + 7; index += 1) await kept(root, storage);
    const half = randomUUID();
    await mkdir(join(root, half.slice(0, 2)), { recursive: true });
    await writeFile(join(root, `${pathOf(half)}.part`), 'moitié');
    await aged(root, `${pathOf(half)}.part`, OLD);
    const { referenced } = rowsOf();
    expect(await sweep(storage, referenced, 'force')).toMatchObject({ orphans: ORPHANS_PER_RUN + 7, parts: 1, erased: ORPHANS_PER_RUN });
    expect(await filesOf(root)).toHaveLength(8);
    expect(await sweep(storage, referenced, 'force')).toMatchObject({ erased: 8 });
    expect(await filesOf(root)).toEqual([]);
    expect(ORPHANS_PER_RUN).toBeLessThanOrEqual(100);
  });

  it('refuses to erase anything when too many files have no row: the database is not the one of these files', async () => {
    const root = await folder();
    const storage = new Storage(root);
    const orphans: string[] = [];
    for (let index = 0; index < ORPHAN_ALARM.files + 1; index += 1) orphans.push(await kept(root, storage));
    const { held, referenced } = rowsOf();
    const before = await filesOf(root);
    const refused = await sweep(storage, referenced, 'erase').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TooManyOrphans);
    expect((refused as TooManyOrphans).found).toMatchObject({ old: ORPHAN_ALARM.files + 1, orphans: ORPHAN_ALARM.files + 1, erased: 0 });
    expect(await filesOf(root)).toEqual(before);
    // The same orphans among enough files that have their row: a few failed uploads, erased.
    for (let index = 0; index < (ORPHAN_ALARM.files + 1) / ORPHAN_ALARM.share - orphans.length; index += 1) held.add(await kept(root, storage));
    expect(await sweep(storage, referenced, 'count')).toMatchObject({ old: 420, orphans: 21 });
    held.delete([...held][0]!);
    await expect(sweep(storage, referenced, 'erase')).rejects.toBeInstanceOf(TooManyOrphans);
    held.add(orphans.pop()!);
    held.add(orphans.pop()!);
    expect(await sweep(storage, referenced, 'erase')).toMatchObject({ old: 420, orphans: 20, erased: 20 });
    expect(await filesOf(root)).toHaveLength(400);
  });

  it('lets a person who has looked erase beyond the alarm, and a small storage lose its few orphans', async () => {
    const root = await folder();
    const storage = new Storage(root);
    for (let index = 0; index < ORPHAN_ALARM.files; index += 1) await kept(root, storage);
    // Twenty out of twenty: all of them, but too few to be a mistaken database.
    expect(await sweep(storage, rowsOf().referenced, 'erase')).toMatchObject({ orphans: ORPHAN_ALARM.files, erased: ORPHAN_ALARM.files });
    for (let index = 0; index < ORPHAN_ALARM.files + 1; index += 1) await kept(root, storage);
    await expect(sweep(storage, rowsOf().referenced, 'erase')).rejects.toBeInstanceOf(TooManyOrphans);
    expect(await sweep(storage, rowsOf().referenced, 'force')).toMatchObject({ erased: ORPHAN_ALARM.files + 1 });
    expect(await filesOf(root)).toEqual([]);
  });

  it('sweeps the bucket as the disk, each file where it was found', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    let keysTyped = false;
    const storage = new Storage(root, { bucket: () => Promise.resolve(keysTyped ? bucket : null) });
    // Written to the disk before the keys were typed.
    const onDisk = await kept(root, storage);
    keysTyped = true;
    const old = new Date(Date.now() - OLD);
    const [orphan, held, fresh, undated] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    bucket.objects.set(pathOf(orphan), old);
    bucket.objects.set(pathOf(held), old);
    bucket.objects.set(pathOf(fresh), new Date());
    bucket.objects.set(pathOf(undated), null);
    for (const name of ['notes.txt', `${pathOf(randomUUID())}.part`, `zz/${randomUUID()}`, '']) bucket.objects.set(name, old);
    expect(await sweep(storage, rowsOf([held]).referenced, 'erase')).toEqual({ young: 2, old: 3, orphans: 2, parts: 0, unknown: 4, erased: 2 });
    expect([...bucket.objects.keys()].sort()).toEqual(
      [pathOf(held), pathOf(fresh), pathOf(undated), 'notes.txt', ...[...bucket.objects.keys()].filter((name) => /part$|^zz|^$/u.test(name))].sort(),
    );
    expect(await filesOf(root)).toEqual([]);
    expect(onDisk).toHaveLength(36);
  });

  it('erases nothing when the bucket is out of reach: keys missing or bucket failing are not an empty bucket', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    let keysTyped = false;
    const storage = new Storage(root, { bucket: () => Promise.resolve(keysTyped ? bucket : null) });
    const onDisk = await kept(root, storage);
    const { referenced, asked } = rowsOf();
    for (const mode of ['erase', 'force', 'count'] as const)
      await expect(sweep(storage, referenced, mode)).rejects.toMatchObject({ operation: 'list', code: 'NoKeys' });
    keysTyped = true;
    bucket.down = true;
    await expect(sweep(storage, referenced, 'erase')).rejects.toMatchObject({ operation: 'list', code: 'TimeoutError' });
    expect([await filesOf(root), asked]).toEqual([[pathOf(onDisk)], []]);
    // Without any bucket in the configuration, the disk alone is the whole storage.
    expect(await sweep(new Storage(root), referenced, 'erase')).toMatchObject({ orphans: 1, erased: 1 });
  });

  it('asks the database by batches, and fails with it', async () => {
    const root = await folder();
    const storage = new Storage(root);
    const keys: string[] = [];
    for (let index = 0; index < 501; index += 1) keys.push(await kept(root, storage));
    const rows = rowsOf(keys);
    expect(await sweep(storage, rows.referenced, 'erase')).toMatchObject({ old: 501, orphans: 0, erased: 0 });
    expect(rows.asked.map((batch) => batch.length)).toEqual([500, 1]);
    await expect(sweep(storage, () => Promise.reject(new Error('database down')), 'erase')).rejects.toThrow('database down');
    expect(await filesOf(root)).toHaveLength(501);
  });

  it('holds nothing in a folder that does not exist yet', async () => {
    const storage = new Storage(join(await folder(), 'jamais-créé'));
    expect(await sweep(storage, rowsOf().referenced, 'erase')).toEqual({ young: 0, old: 0, orphans: 0, parts: 0, unknown: 0, erased: 0 });
  });
});
