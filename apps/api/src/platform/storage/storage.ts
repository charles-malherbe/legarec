import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bucket, checkedKey, pathOf, type BucketKeys, type Connect } from './bucket';

export { FILE_MAX_BYTES } from '@legarec/contracts';

export interface Stored {
  key: string;
  size: number;
  sha256: string;
}

/** Where the files are kept: under their key, whole, or not at all. */
export interface Files {
  write(key: string, bytes: Uint8Array): Promise<void>;
  /** `null`: no such file here. */
  read(key: string): Promise<Buffer | null>;
  /** Whether it was still there. */
  erase(key: string): Promise<boolean>;
}

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** The disk of the server, in a folder of its own (a volume in production). */
export class Folder implements Files {
  constructor(private readonly folder: string) {}

  private path(key: string): string {
    return join(this.folder, pathOf(key));
  }

  /** Written whole, then renamed: a file half written is never read. */
  async write(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.path(key);
    // Read and written by the API and the worker, by their common group (the folder keeps it: setgid), nobody else.
    const folder = join(this.folder, key.slice(0, 2));
    await mkdir(folder, { recursive: true });
    await chmod(folder, 0o2770);
    await writeFile(`${path}.part`, bytes);
    await chmod(`${path}.part`, 0o660);
    await rename(`${path}.part`, path);
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async erase(key: string): Promise<boolean> {
    try {
      await rm(this.path(key));
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
}

/**
 * Files of the documents, under a key drawn at random: never a name chosen by anyone, nor a personal data (CLAUDE.md).
 * In the bucket when there is one and its keys are in the vault; otherwise on the disk of the server. A file written to
 * the disk before the keys were typed is still read there.
 */
export class Storage {
  private readonly folder: Files;

  constructor(
    folder: string,
    private readonly bucket: () => Promise<Files | null> = () => Promise.resolve(null),
  ) {
    this.folder = new Folder(folder);
  }

  async put(bytes: Uint8Array): Promise<Stored> {
    const key = randomUUID();
    await ((await this.bucket()) ?? this.folder).write(key, bytes);
    return { key, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  /**
   * The bucket first, then the disk when the bucket says that it has no such object. A bucket that fails is a failure:
   * the disk is not asked, it would answer « not found » for a file that is only out of reach.
   */
  async read(key: string): Promise<Buffer> {
    const checked = checkedKey(key);
    const bucket = await this.bucket();
    const found = (await bucket?.read(checked)) ?? (await this.folder.read(checked));
    if (!found) throw new Error('file not found');
    return found;
  }

  /** A file erased by the retention: whether it was still there (it is again after a restoration of the disk). */
  async erase(key: string): Promise<boolean> {
    const checked = checkedKey(key);
    const bucket = await this.bucket();
    const there = [(await bucket?.erase(checked)) ?? false, await this.folder.erase(checked)];
    return there.includes(true);
  }

  /** A file whose row was never written, or that ClamAV found infected. */
  async remove(key: string): Promise<void> {
    await this.erase(key);
  }
}

export interface StorageConfig {
  NODE_ENV: string;
  DOCUMENTS_DIR?: string | undefined;
  S3_DOCUMENTS_BUCKET?: string | undefined;
  S3_REGION?: string | undefined;
}

/**
 * The folder of the configuration; outside production, without one, a folder of this process in the temporary one.
 * With `S3_DOCUMENTS_BUCKET`, the bucket, as long as `keys` finds its two keys in the vault.
 */
export function storageFor(config: StorageConfig, keys: () => Promise<BucketKeys | null> = () => Promise.resolve(null), connect?: Connect): Storage {
  const folder = config.DOCUMENTS_DIR ?? (config.NODE_ENV === 'production' ? null : join(tmpdir(), `legarec-documents-${process.pid}`));
  if (!folder) throw new Error('DOCUMENTS_DIR expected');
  if (!config.S3_DOCUMENTS_BUCKET || !config.S3_REGION) return new Storage(folder);
  const bucket = new Bucket({ bucket: config.S3_DOCUMENTS_BUCKET, region: config.S3_REGION }, connect);
  return new Storage(folder, async () => {
    const found = await keys();
    return found ? bucket.with(found) : null;
  });
}
