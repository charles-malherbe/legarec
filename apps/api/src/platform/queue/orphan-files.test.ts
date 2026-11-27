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
import { purge, sweepFiles } from './maintenance';

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
const lastRun = async () => rows("SELECT removed FROM retention_runs WHERE kind = 'orphan-files' ORDER BY ran_at DESC, id DESC LIMIT 1");

beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  jobs = new Database(test.url('jobs'));
  root = await mkdtemp(join(tmpdir(), 'legarec-orphans-'));
  storage = new Storage(root);
});
afterAll(async () => {
  await jobs.close();
  await test.drop();
  await rm(root, { recursive: true, force: true });
});

describe('the files that no row points at', () => {
  it('are erased by the purge of the night, counted, and told by their number alone', async () => {
    const held = await file();
    await document(held);
    const orphan = await file();
    const recent = await file(60_000);
    written.length = 0;
    expect(await purge(jobs, logger, storage, 'erase')).toMatchObject({ 'document-files': 0, 'orphan-files': 1 });
    expect((await filesOf()).sort()).toEqual([held.key, recent.key].sort());
    expect(await lastRun()).toEqual([{ removed: 1 }]);
    const journal = written.join('');
    expect(journal).toContain('"kind":"orphan-files","count":1');
    for (const key of [held.key, orphan.key, recent.key]) expect(journal).not.toContain(key);
    await storage.erase(recent.key);
  });

  it('are only counted by the purge asked at once, after a restoration', async () => {
    const orphan = await file();
    written.length = 0;
    expect(await purge(jobs, logger, storage)).toMatchObject({ 'orphan-files': 0 });
    expect(await filesOf()).toContain(orphan.key);
    expect(written.join('')).toContain('"kind":"orphan-files","count":1');
    expect(await lastRun()).toEqual([{ removed: 0 }]);
    expect(await purge(jobs, logger, storage, 'erase')).toMatchObject({ 'orphan-files': 1 });
  });

  it('leave the file of an erased document to the purge of the documents: its row still holds it', async () => {
    const stored = await file();
    const id = await document(stored);
    await rows("UPDATE documents SET purged_at = now(), title = 'Pièce supprimée', original_name = 'piece-supprimee' WHERE id = $1", [id]);
    // The sweep alone: held by a row, neither an orphan nor erased.
    expect(await sweepFiles(jobs, logger, storage, 'force')).toMatchObject({ orphans: 0, erased: 0 });
    expect(await filesOf()).toContain(stored.key);
    // The night: erased once, by the step of the documents, and counted there.
    expect(await purge(jobs, logger, storage, 'erase')).toMatchObject({ 'document-files': 1, 'orphan-files': 0 });
    expect(await filesOf()).not.toContain(stored.key);
  });

  it('stop the purge of the night when there are too many, and nothing is erased until a person has looked', async () => {
    const before = (await filesOf()).length;
    for (let index = 0; index < ORPHAN_ALARM.files + 1; index += 1) await file();
    written.length = 0;
    await expect(purge(jobs, logger, storage, 'erase')).rejects.toThrow('PURGE_FAILED');
    expect(await filesOf()).toHaveLength(before + ORPHAN_ALARM.files + 1);
    const journal = written.join('');
    expect(journal).toContain(`"kind":"orphan-files","count":${ORPHAN_ALARM.files + 1}`);
    expect(journal).toContain('"kind":"orphan-files","errorType":"TooManyOrphans","msg":"purge failed"');
    // The other steps were done all the same.
    expect(journal).toContain('"kind":"document-files","removed":0');
    expect(await sweepFiles(jobs, logger, storage, 'force')).toMatchObject({ erased: ORPHAN_ALARM.files + 1 });
    expect(await purge(jobs, logger, storage, 'erase')).toMatchObject({ 'orphan-files': 0 });
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
