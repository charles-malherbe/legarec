import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import type { Actor } from '../../platform/database/actor';
import { databaseCode } from '../../platform/database/codes';
import { Database, type Transaction } from '../../platform/database/database';
import { storageKeys } from './storage-keys';
import { Vault } from './vault';

const ACCESS = 'identifiant-fictif-QZKX';
const SECRET = 'valeur-fictive-zz-KXPM';
let test: TestApp;
let jobs: Database;
let vault: Vault;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
/** A value of the vault, sealed for its own line as the screen does. */
async function type(name: string, value: string, status = 'VALID'): Promise<string> {
  const id = randomUUID();
  await rows('INSERT INTO vault_secrets (id, name, value_cipher, status) VALUES ($1, $2::secret_name, $3, $4::secret_status)', [
    id,
    name,
    status === 'REVOKED' ? null : vault.seal(id, value),
    status,
  ]);
  return id;
}
const asWorker = <T>(work: (tx: Transaction) => Promise<T>) => jobs.run({ kind: 'worker', job: 'storage-keys' }, work);

beforeAll(async () => {
  test = await startApp();
  jobs = new Database(test.database.url('jobs'));
  vault = new Vault(test.config);
});
beforeEach(async () => void (await rows('DELETE FROM vault_secrets')));
afterEach(() => void vi.useRealTimers());
afterAll(async () => {
  await jobs.close();
  await test.stop();
});

describe('the keys of the bucket', () => {
  it('are the two of the vault, opened; none as long as one is missing', async () => {
    expect(await storageKeys(vault, asWorker)()).toBeNull();
    await type('S3_ACCESS_KEY', ACCESS);
    expect(await storageKeys(vault, asWorker)()).toBeNull();
    await type('S3_SECRET_KEY', SECRET);
    expect(await storageKeys(vault, asWorker)()).toEqual({ accessKeyId: ACCESS, secretAccessKey: SECRET });
    await rows("DELETE FROM vault_secrets WHERE name = 'S3_ACCESS_KEY'");
    expect(await storageKeys(vault, asWorker)()).toBeNull();
  });

  it('are read once in five minutes: a renewed key is taken after that, a missing one within thirty seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-27T09:00:00Z') });
    let asked = 0;
    const keys = storageKeys(vault, (work) => {
      asked += 1;
      return asWorker(work);
    });
    expect(await keys()).toBeNull();
    const access = await type('S3_ACCESS_KEY', ACCESS);
    const secret = await type('S3_SECRET_KEY', SECRET);
    vi.setSystemTime(new Date('2026-11-27T09:00:29Z'));
    expect([await keys(), asked]).toEqual([null, 1]);
    vi.setSystemTime(new Date('2026-11-27T09:00:31Z'));
    expect([await keys(), asked]).toEqual([{ accessKeyId: ACCESS, secretAccessKey: SECRET }, 2]);
    // Renewed from the screen: the same line, another value.
    await rows('UPDATE vault_secrets SET value_cipher = $2 WHERE id = $1', [secret, vault.seal(secret, 'valeur-fictive-renouvelee')]);
    vi.setSystemTime(new Date('2026-11-27T09:05:30Z'));
    expect([await keys(), asked]).toEqual([{ accessKeyId: ACCESS, secretAccessKey: SECRET }, 2]);
    vi.setSystemTime(new Date('2026-11-27T09:05:32Z'));
    expect([await keys(), asked]).toEqual([{ accessKeyId: ACCESS, secretAccessKey: 'valeur-fictive-renouvelee' }, 3]);
    // Revoked: the files go back to the disk, five minutes later at most.
    await rows("UPDATE vault_secrets SET status = 'REVOKED', value_cipher = NULL WHERE id = $1", [access]);
    vi.setSystemTime(new Date('2026-11-27T09:10:33Z'));
    expect([await keys(), asked]).toEqual([null, 4]);
  });

  it('fail, and are asked again, when the vault cannot be read or opened: never taken for missing', async () => {
    await type('S3_ACCESS_KEY', ACCESS);
    await type('S3_SECRET_KEY', SECRET);
    let down = true;
    const keys = storageKeys(vault, (work) => (down ? Promise.reject(new Error('database')) : asWorker(work)));
    await expect(keys()).rejects.toThrow('database');
    down = false;
    expect(await keys()).toEqual({ accessKeyId: ACCESS, secretAccessKey: SECRET });
    // Sealed for another line, or under another master key.
    await rows("UPDATE vault_secrets SET value_cipher = $1 WHERE name = 'S3_SECRET_KEY'", [vault.seal(randomUUID(), SECRET)]);
    const error = (await storageKeys(vault, asWorker)().catch((thrown: unknown) => thrown)) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(`${error.message}${error.stack}`).not.toContain(SECRET);
  });

  it('are found in no journal', async () => {
    await type('S3_ACCESS_KEY', ACCESS);
    await type('S3_SECRET_KEY', SECRET);
    await storageKeys(vault, asWorker)();
    const everywhere = JSON.stringify([await rows('SELECT * FROM audit_log'), await rows('SELECT * FROM outbox'), await rows('SELECT * FROM vault_secrets')]);
    for (const value of [ACCESS, SECRET]) expect(everywhere + test.logs.join('')).not.toContain(value);
  });
});

describe('PostgreSQL itself', () => {
  interface Row {
    name: string;
    id: string;
    value_cipher: Uint8Array;
  }
  const read = (tx: Transaction) => tx.$queryRaw<Row[]>`SELECT name, id, value_cipher FROM app.storage_keys()`;
  /** The names that are given, or the code of the refusal. */
  const given = (database: Database, actor: Actor) => database.run(actor, read).then((found) => found.map((row) => row.name).sort(), databaseCode);
  const staff = (as: 'director' | 'manager' | 'officerA' | 'developer', role: 'DIRECTOR' | 'COLLECTION_MANAGER' | 'CLAIMS_OFFICER' | 'DEVELOPER'): Actor => ({
    kind: 'staff',
    userId: test.s[as],
    role,
    delegations: [],
  });
  const BOTH = ['S3_ACCESS_KEY', 'S3_SECRET_KEY'];

  beforeEach(async () => {
    await type('S3_ACCESS_KEY', ACCESS);
    await type('S3_SECRET_KEY', SECRET);
  });

  it('gives them to whoever handles a file: the team, a creditor, a debtor and the worker', async () => {
    for (const actor of [
      staff('director', 'DIRECTOR'),
      staff('manager', 'COLLECTION_MANAGER'),
      staff('officerA', 'CLAIMS_OFFICER'),
      staff('developer', 'DEVELOPER'),
    ])
      expect(await given(test.pool, actor)).toEqual(BOTH);
    expect(await given(test.pool, { kind: 'partner', userId: test.s.partnerA, creditorId: test.s.creditorA })).toEqual(BOTH);
    expect(await given(test.pool, { kind: 'debtor', debtorId: test.s.debtorA })).toEqual(BOTH);
    expect(await given(jobs, { kind: 'worker', job: 'storage-keys' })).toEqual(BOTH);
  });

  it('gives them encrypted, each for its own line', async () => {
    const found = await test.pool.run(staff('officerA', 'CLAIMS_OFFICER'), read);
    expect(found.map((row) => vault.open(row.id, row.value_cipher)).sort()).toEqual([ACCESS, SECRET].sort());
    for (const row of found) for (const value of [ACCESS, SECRET]) expect(Buffer.from(row.value_cipher).toString('latin1')).not.toContain(value);
  });

  it('refuses them to anyone else', async () => {
    const service = { kind: 'service', accountId: randomUUID(), scopes: [] } as const;
    for (const actor of [{ kind: 'anonymous' }, { kind: 'hook' }, { kind: 'public' }, service] as const) expect(await given(test.pool, actor)).toBe('42501');
    expect(await given(jobs, { kind: 'retention' })).toBe('42501');
  });

  it('refuses them to someone who is no longer recognised, instead of answering that there is no key', async () => {
    // An account that does not exist, a creditor that is not the one of the account.
    expect(await given(test.pool, { kind: 'staff', userId: randomUUID(), role: 'DIRECTOR', delegations: [] })).toBe('42501');
    expect(await given(test.pool, { kind: 'partner', userId: test.s.partnerA, creditorId: test.s.creditorB })).toBe('42501');
  });

  it('gives these two names only, whatever else the vault holds', async () => {
    await type('RESEND_API_KEY', 'autre-valeur-fictive');
    await type('AI_API_KEY', 'autre-valeur-fictive');
    await rows("INSERT INTO vault_secrets (name, value_cipher) VALUES ('LOOKUP_KEY', '\\x00'), ('ACCESS_CODE_KEY', '\\x00'), ('MAILBOX_SECRETS_KEY', '\\x00')");
    for (const [database, actor] of [
      [test.pool, staff('director', 'DIRECTOR')],
      [test.pool, { kind: 'debtor', debtorId: test.s.debtorA }],
      [jobs, { kind: 'worker', job: 'storage-keys' }],
    ] as [Database, Actor][])
      expect(await given(database, actor)).toEqual(BOTH);
    // The table itself stays closed to them.
    const direct = (tx: Transaction) => tx.$queryRaw<Row[]>`SELECT name::text, id, value_cipher FROM vault_secrets`;
    for (const actor of [{ kind: 'debtor', debtorId: test.s.debtorA }, staff('officerA', 'CLAIMS_OFFICER')] as Actor[])
      expect(await test.pool.run(actor, direct).then((found) => found.length, databaseCode)).toBe('42501');
    expect(await jobs.run({ kind: 'worker', job: 'storage-keys' }, direct).then((found) => found.length, databaseCode)).toBe('42501');
  });

  it.each(['REVOKE_PENDING', 'REVOKED'])('gives only a valid key: %s', async (status) => {
    await rows("DELETE FROM vault_secrets WHERE name = 'S3_SECRET_KEY'");
    await type('S3_SECRET_KEY', SECRET, status);
    expect(await given(jobs, { kind: 'worker', job: 'storage-keys' })).toEqual(['S3_ACCESS_KEY']);
    // A new one takes the place of the revoked one.
    if (status === 'REVOKED') {
      await type('S3_SECRET_KEY', 'valeur-fictive-renouvelee');
      const found = await asWorker(read);
      expect(found.map((row) => vault.open(row.id, row.value_cipher)).sort()).toEqual([ACCESS, 'valeur-fictive-renouvelee'].sort());
    }
  });
});

describe('the API with a bucket in its configuration', () => {
  let folder: string;
  let withBucket: TestApp;
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'legarec-storage-keys-'));
    // A name that exists nowhere: without keys, nothing is ever asked to it.
    withBucket = await startApp([], { next: test, env: { DOCUMENTS_DIR: folder, S3_DOCUMENTS_BUCKET: 'legarec-essai-absent', S3_REGION: 'eu-west-par' } });
  });
  afterAll(async () => {
    await withBucket.stop();
    await rm(folder, { recursive: true, force: true });
  });

  it('reads the keys in the request, with the rights of who sends a file, and keeps the file on the disk as long as they are not typed', async () => {
    const file = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
    const answer = await withBucket.call('POST', '/staff/documents/import', {
      as: 'officerA',
      file,
      headers: { 'content-type': 'application/pdf', 'idempotency-key': randomUUID() },
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const [stored] = await rows<{ storage_key: string }>('SELECT storage_key FROM documents WHERE id = $1', [(answer.body as { id: string }).id]);
    const written = (await readdir(folder, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
    expect(written).toEqual([stored!.storage_key]);
  });
});
