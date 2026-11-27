import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BucketError, type BucketKeys } from './bucket';
import { Storage, storageFor, type Files } from './storage';

const KEYS: BucketKeys = { accessKeyId: 'identifiant-fictif-QZKX', secretAccessKey: 'valeur-fictive-zz-KXPM' };
const bytes = (text: string) => new TextEncoder().encode(text);
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function folder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), 'legarec-storage-'));
  folders.push(made);
  return made;
}
/** Every file under a folder, by its path from it. */
const filesOf = async (root: string) =>
  (await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);

/** A bucket of this test, in memory, that can be made to fail. */
class Memory implements Files {
  readonly objects = new Map<string, Buffer>();
  readonly asked: string[] = [];
  down = false;

  private ask(operation: 'write' | 'read' | 'erase', key: string) {
    this.asked.push(`${operation} ${key}`);
    if (this.down) throw new BucketError(operation, 'TimeoutError');
  }
  write(key: string, content: Uint8Array) {
    return Promise.resolve().then(() => {
      this.ask('write', key);
      this.objects.set(key, Buffer.from(content));
    });
  }
  read(key: string) {
    return Promise.resolve().then(() => {
      this.ask('read', key);
      return this.objects.get(key) ?? null;
    });
  }
  erase(key: string) {
    return Promise.resolve().then(() => {
      this.ask('erase', key);
      return this.objects.delete(key);
    });
  }
}

describe('the files of the documents', () => {
  it('are kept on the disk without a bucket, under a key drawn at random, for the API and the worker alone', async () => {
    const root = await folder();
    const storage = new Storage(root);
    const stored = await storage.put(bytes('%PDF-1.4 essai'));
    expect(stored).toMatchObject({ size: 14, sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) as string });
    expect(stored.key).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await filesOf(root)).toEqual([stored.key]);
    expect((await stat(join(root, stored.key.slice(0, 2), stored.key))).mode & 0o777).toBe(0o660);
    expect((await storage.read(stored.key)).toString()).toBe('%PDF-1.4 essai');
    expect(await storage.erase(stored.key)).toBe(true);
    expect(await storage.erase(stored.key)).toBe(false);
    await expect(storage.read(stored.key)).rejects.toThrow('file not found');
    // Removing what is no longer there is not a failure.
    await storage.remove(stored.key);
  });

  it('go to the bucket when there is one, and nothing is left on the disk', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    const storage = new Storage(root, () => Promise.resolve(bucket));
    const stored = await storage.put(bytes('essai'));
    expect([...bucket.objects.keys()]).toEqual([stored.key]);
    expect(await filesOf(root)).toEqual([]);
    expect((await storage.read(stored.key)).toString()).toBe('essai');
    expect(await storage.erase(stored.key)).toBe(true);
    expect(bucket.objects.size).toBe(0);
    expect(await storage.erase(stored.key)).toBe(false);
    await expect(storage.read(stored.key)).rejects.toThrow('file not found');
  });

  it('written to the disk before the keys were typed are still read there, and erased there', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    let keysTyped = false;
    const storage = new Storage(root, () => Promise.resolve(keysTyped ? bucket : null));
    const before = await storage.put(bytes('avant'));
    keysTyped = true;
    const after = await storage.put(bytes('après'));
    expect(await filesOf(root)).toEqual([before.key]);
    expect([...bucket.objects.keys()]).toEqual([after.key]);
    expect((await storage.read(before.key)).toString()).toBe('avant');
    expect((await storage.read(after.key)).toString()).toBe('après');
    expect(await storage.erase(before.key)).toBe(true);
    expect(await filesOf(root)).toEqual([]);
    expect(bucket.objects.size).toBe(1);
  });

  it('erases a file from both places when it is in both (a disk restored after the switch)', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    const alone = new Storage(root);
    const stored = await alone.put(bytes('essai'));
    bucket.objects.set(stored.key, Buffer.from('essai'));
    const storage = new Storage(root, () => Promise.resolve(bucket));
    expect(await storage.erase(stored.key)).toBe(true);
    expect([await filesOf(root), bucket.objects.size]).toEqual([[], 0]);
  });

  it('fail when the bucket fails: the disk is never asked instead, nor written to', async () => {
    const [root, bucket] = [await folder(), new Memory()];
    const onDisk = await new Storage(root).put(bytes('sur le disque'));
    const storage = new Storage(root, () => Promise.resolve(bucket));
    const stored = await storage.put(bytes('essai'));
    bucket.down = true;
    // Even for a file that the disk holds: nobody knows where the newest one is.
    for (const key of [stored.key, onDisk.key]) await expect(storage.read(key)).rejects.toBeInstanceOf(BucketError);
    await expect(storage.put(bytes('autre'))).rejects.toBeInstanceOf(BucketError);
    await expect(storage.erase(onDisk.key)).rejects.toBeInstanceOf(BucketError);
    await expect(storage.remove(onDisk.key)).rejects.toBeInstanceOf(BucketError);
    expect(await filesOf(root)).toEqual([onDisk.key]);
    bucket.down = false;
    expect((await storage.read(onDisk.key)).toString()).toBe('sur le disque');
  });

  it('fail when the keys cannot be read', async () => {
    const storage = new Storage(await folder(), () => Promise.reject(new Error('vault')));
    await expect(storage.put(bytes('essai'))).rejects.toThrow('vault');
    await expect(storage.read(randomUUID())).rejects.toThrow('vault');
  });

  it.each(['', '..', '../../etc/passwd', '/etc/passwd', 'ab/../../x', `${randomUUID()}/../x`, randomUUID().toUpperCase(), `${randomUUID()}.part`])(
    'are never looked for under a key that is not one, with or without a bucket: %j',
    async (key) => {
      const [root, bucket] = [await folder(), new Memory()];
      for (const storage of [new Storage(root), new Storage(root, () => Promise.resolve(bucket)), new Storage(root, () => Promise.reject(new Error('vault')))])
        for (const work of [() => storage.read(key), () => storage.erase(key), () => storage.remove(key)])
          await expect(work()).rejects.toThrow('invalid storage key');
      expect(bucket.asked).toEqual([]);
    },
  );
});

describe('the storage of the configuration', () => {
  const connected: { bucket: string; region: string; keys: BucketKeys }[] = [];
  const memory = new Memory();
  /** A client of this test that answers like S3, over the same memory. */
  const connect = (place: { bucket: string; region: string }, keys: BucketKeys) => {
    connected.push({ ...place, keys });
    return {
      send: async (command: { constructor: { name: string }; input: { Key?: string; Body?: unknown } }) => {
        const key = command.input.Key!.slice(3);
        if (command.constructor.name === 'PutObjectCommand') await memory.write(key, command.input.Body as Uint8Array);
        return {};
      },
    };
  };

  it('requires a folder in production, and draws one of this process elsewhere', async () => {
    expect(() => storageFor({ NODE_ENV: 'production' })).toThrow('DOCUMENTS_DIR expected');
    expect(() => storageFor({ NODE_ENV: 'production', S3_DOCUMENTS_BUCKET: 'legarec-essai', S3_REGION: 'eu-west-par' })).toThrow('DOCUMENTS_DIR expected');
    const stored = await storageFor({ NODE_ENV: 'test' }).put(bytes('essai'));
    const own = join(tmpdir(), `legarec-documents-${process.pid}`);
    expect(await filesOf(own)).toContain(stored.key);
    await rm(join(own, stored.key.slice(0, 2), stored.key));
  });

  it('uses the bucket with its name, its region and the two keys of the vault, and the disk as long as one is missing', async () => {
    const root = await folder();
    let keys: BucketKeys | null = null;
    let asked = 0;
    const read = () => Promise.resolve((asked += 1)).then(() => keys);
    const config = { NODE_ENV: 'production', DOCUMENTS_DIR: root, S3_DOCUMENTS_BUCKET: 'legarec-essai', S3_REGION: 'eu-west-par' };
    const storage = storageFor(config, read, connect as never);
    const onDisk = await storage.put(bytes('avant'));
    expect([await filesOf(root), connected, asked]).toEqual([[onDisk.key], [], 1]);
    keys = KEYS;
    const inBucket = await storage.put(bytes('après'));
    expect(connected).toEqual([{ bucket: 'legarec-essai', region: 'eu-west-par', keys: KEYS }]);
    expect([...memory.objects.keys()]).toEqual([inBucket.key]);
    expect(await filesOf(root)).toEqual([onDisk.key]);
    // The same keys: the same client.
    await storage.put(bytes('encore'));
    expect(connected).toHaveLength(1);
  });

  it.each([{ S3_DOCUMENTS_BUCKET: 'legarec-essai' }, { S3_REGION: 'eu-west-par' }, {}])(
    'stays on the disk without a bucket and its region: %j',
    async (place) => {
      const root = await folder();
      let asked = 0;
      const storage = storageFor({ NODE_ENV: 'test', DOCUMENTS_DIR: root, ...place }, () => Promise.resolve((asked += 1)).then(() => KEYS), connect as never);
      const stored = await storage.put(bytes('essai'));
      expect([await filesOf(root), asked]).toEqual([[stored.key], 0]);
    },
  );
});
