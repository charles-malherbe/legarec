import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import { Database } from '../database/database';
import { createLogger } from '../logging/logger';
import { pathOf } from '../storage/bucket';
import { Storage } from '../storage/storage';
import { ORPHAN_ALARM, ORPHAN_DELAY_MS } from '../storage/sweep';
import { holdSweep, maintenance, nightSweep, purge, resumeSweep, sweepFiles, sweepHeld } from './maintenance';

let test: TestDatabase;
let s: Seed;
let jobs: Database;
let root: string;
let storage: Storage;
const written: string[] = [];
const logger = createLogger('debug', new Writable({ write: (chunk: Buffer, _encoding, done) => (written.push(chunk.toString()), done()) }));
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.admin.query<T>(sql, values)).rows;
const filesOf = async () => (await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);

/** A file of the storage, written longer ago than the delay of the sweep unless told otherwise. */
async function file(ms = ORPHAN_DELAY_MS + 3_600_000): Promise<{ key: string; size: number; sha256: string }> {
  const stored = await storage.put(new TextEncoder().encode('%PDF-1.4 Jeanne Martin'));
  const at = new Date(Date.now() - ms);
  await utimes(join(root, pathOf(stored.key)), at, at);
  return stored;
}
/** The row of a document that holds a file. */
async function document(stored: { key: string; size: number; sha256: string }): Promise<string> {
  const [made] = await rows<{ id: string }>(
    `INSERT INTO documents (category, kind, title, original_name, storage_key, size_bytes, sha256, source, author_id)
     VALUES ('EVIDENCE', 'PDF', 'Document importé', 'document.pdf', $1, $2, $3, 'UPLOAD', $4) RETURNING id`,
    [stored.key, stored.size, stored.sha256, s.officerA],
  );
  return made!.id;
}
const runs = async (kind = 'orphan-files%') => rows(`SELECT kind, removed FROM retention_runs WHERE kind LIKE $1 ORDER BY ran_at, id`, [kind]);
const forget = () => rows("DELETE FROM retention_runs WHERE kind LIKE 'orphan-files%'");
const orphans = async () => (await filesOf()).filter((key) => !held.includes(key));
const held: string[] = [];

beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  jobs = new Database(test.url('jobs'));
  root = await mkdtemp(join(tmpdir(), 'legarec-orphans-'));
  storage = new Storage(root);
  // The database of these files: fifty of them have their row.
  for (let index = 0; index < 50; index += 1) {
    const stored = await file();
    await document(stored);
    held.push(stored.key);
  }
});
afterAll(async () => {
  await jobs.close();
  await test.drop();
  await rm(root, { recursive: true, force: true });
});

describe('the files that no row points at', () => {
  const night = () => maintenance(jobs, logger, storage).maintenance!['sweep-files']!();

  it('are erased by the sweep of the night, counted, and told by their number alone', async () => {
    const orphan = await file();
    const recent = await file(60_000);
    written.length = 0;
    await night();
    expect(await orphans()).toEqual([recent.key]);
    expect(await runs()).toEqual([{ kind: 'orphan-files', removed: 1 }]);
    const journal = written.join('');
    expect(journal).toContain('"level":40,');
    expect(journal).toMatch(/"kind":"orphan-files","count":1,"msg":"files without a row found"/u);
    expect(journal).toMatch(/"kind":"orphan-files","removed":1,"msg":"files without a row erased"/u);
    for (const key of [held[0]!, orphan.key, recent.key]) expect(journal).not.toContain(key);
    await storage.erase(recent.key);
    // Nothing found: said without a warning.
    written.length = 0;
    await night();
    expect(written.join('')).not.toContain('"level":40');
  });

  it('are no business of the purge, retried or not: the sweep runs on its own, once a night', async () => {
    await forget();
    const orphan = await file();
    expect(Object.keys(await purge(jobs, logger, storage))).not.toContain('orphan-files');
    expect(await orphans()).toEqual([orphan.key]);
    expect(await runs()).toEqual([]);
    await night();
    expect(await orphans()).toEqual([]);
  });

  it('leave the file of an erased document to the purge of the documents: its row still holds it', async () => {
    await forget();
    const stored = await file();
    const id = await document(stored);
    await rows("UPDATE documents SET purged_at = now(), title = 'Pièce supprimée', original_name = 'piece-supprimee' WHERE id = $1", [id]);
    // The sweep: held by a row, neither an orphan nor erased.
    expect(await sweepFiles(jobs, logger, storage, 'erase')).toMatchObject({ orphans: 0, erased: 0 });
    expect(await filesOf()).toContain(stored.key);
    // The purge: erased once, by the step of the documents, and counted there.
    expect(await purge(jobs, logger, storage)).toMatchObject({ 'document-files': 1 });
    expect(await filesOf()).not.toContain(stored.key);
  });

  it('stop the sweep of the night when there are too many: nothing is erased until a person has given their number', async () => {
    await forget();
    for (let index = 0; index < ORPHAN_ALARM.files + 1; index += 1) await file();
    written.length = 0;
    await expect(night()).rejects.toMatchObject({ name: 'SweepRefused', code: 'TOO_MANY' });
    expect(await orphans()).toHaveLength(21);
    const journal = written.join('');
    expect(journal).toMatch(/"level":40,[^\n]*"kind":"orphan-files","count":21,"msg":"files without a row found"/u);
    expect(journal).toMatch(/"level":50,[^\n]*"kind":"orphan-files","errorType":"TOO_MANY"/u);
    expect(await runs()).toEqual([{ kind: 'orphan-files', removed: 0 }]);
    // Another number than the one shown: refused.
    await expect(sweepFiles(jobs, logger, storage, 'force', 20)).rejects.toMatchObject({ code: 'CHANGED' });
    expect(await orphans()).toHaveLength(21);
    written.length = 0;
    expect(await sweepFiles(jobs, logger, storage, 'force', 21)).toMatchObject({ erased: 21 });
    expect(await orphans()).toEqual([]);
    // A forced erasure leaves its own trace.
    expect(await runs('orphan-files-forced')).toEqual([
      { kind: 'orphan-files-forced', removed: 0 },
      { kind: 'orphan-files-forced', removed: 21 },
    ]);
    expect(written.join('')).toMatch(/"kind":"orphan-files","removed":21,"msg":"files without a row erased, forced"/u);
  });

  it('are kept after a restoration: the night only counts, until a person lifts the hold', async () => {
    await forget();
    expect(await sweepHeld(jobs)).toBe(false);
    await holdSweep(jobs);
    expect(await sweepHeld(jobs)).toBe(true);
    const orphan = await file();
    written.length = 0;
    await nightSweep(jobs, logger, storage);
    await night();
    expect(await orphans()).toEqual([orphan.key]);
    expect(written.join('')).toMatch(/"level":40,[^\n]*"msg":"sweep of the files without a row held since a restoration: nothing erased"/u);
    expect(await runs('orphan-files')).toEqual([]);
    // A count does not lift it, nor a forced erasure of something else.
    await sweepFiles(jobs, logger, storage, 'count');
    expect(await sweepHeld(jobs)).toBe(true);
    await resumeSweep(jobs);
    expect(await sweepHeld(jobs)).toBe(false);
    // Held again by the next restoration.
    await holdSweep(jobs);
    expect(await sweepHeld(jobs)).toBe(true);
    await resumeSweep(jobs);
    await night();
    expect(await orphans()).toEqual([]);
    expect(await runs()).toEqual([
      { kind: 'orphan-files-held', removed: 0 },
      { kind: 'orphan-files-resumed', removed: 0 },
      { kind: 'orphan-files-held', removed: 0 },
      { kind: 'orphan-files-resumed', removed: 0 },
      { kind: 'orphan-files', removed: 1 },
    ]);
  });

  it('never go against a database that holds none of them, whoever asks', async () => {
    await forget();
    const orphan = await file();
    await rows("SELECT set_config('session_replication_role', 'replica', false)");
    await rows('CREATE TEMP TABLE kept_documents AS SELECT id, storage_key FROM documents');
    await rows('UPDATE documents SET storage_key = gen_random_uuid()::text');
    try {
      await expect(night()).rejects.toMatchObject({ code: 'NO_ROW_HELD' });
      await expect(sweepFiles(jobs, logger, storage, 'force', 51)).rejects.toMatchObject({ code: 'NO_ROW_HELD' });
      expect(await filesOf()).toHaveLength(51);
    } finally {
      await rows('UPDATE documents d SET storage_key = k.storage_key FROM kept_documents k WHERE k.id = d.id');
      await rows("SELECT set_config('session_replication_role', 'origin', false)");
    }
    await night();
    expect(await orphans()).toEqual([]);
    expect(orphan.key).toHaveLength(36);
  });
});

describe('which keys a row holds', () => {
  const ask = (actor: Parameters<Database['run']>[0], keys: string[]) =>
    jobs.run(actor, async (tx) => (await tx.$queryRaw<{ key: string }[]>`SELECT key FROM app.referenced_files(${keys}::text[]) AS key`).map((row) => row.key));

  it('is answered to the purge: the keys of the documents, erased ones included, and nothing else', async () => {
    const [live, purged, none] = [await file(60_000), await file(60_000), await file(60_000)];
    await document(live);
    await rows('UPDATE documents SET purged_at = now() WHERE id = $1', [await document(purged)]);
    expect((await ask({ kind: 'retention' }, [live.key, purged.key, none.key, 'notes.txt'])).sort()).toEqual([live.key, purged.key].sort());
    expect(await ask({ kind: 'retention' }, [])).toEqual([]);
    for (const { key } of [live, purged, none]) await storage.erase(key);
  });

  it('is refused to the worker, and to a question larger than a batch', async () => {
    await expect(ask({ kind: 'worker', job: 'scan-document' }, [])).rejects.toThrow(/permission denied|42501/u);
    const many = Array.from({ length: 1001 }, (_, index) => `k${index}`);
    await expect(ask({ kind: 'retention' }, many)).rejects.toThrow();
    // No keys at all is no question: never answered « none is held ».
    await expect(jobs.run({ kind: 'retention' }, (tx) => tx.$queryRaw`SELECT app.referenced_files(NULL)`)).rejects.toThrow();
    expect(await ask({ kind: 'retention' }, many.slice(1))).toEqual([]);
  });

  it('is refused to whoever is not the purge, even with the right to call it', async () => {
    await rows('BEGIN');
    try {
      await rows('GRANT EXECUTE ON FUNCTION app.referenced_files(text[]) TO legarec_worker');
      await rows('SET LOCAL ROLE legarec_worker');
      await expect(test.admin.query("SELECT app.referenced_files(ARRAY['a'])")).rejects.toMatchObject({ code: '42501', message: 'refused' });
    } finally {
      await rows('ROLLBACK');
    }
  });
});
