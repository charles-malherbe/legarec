import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bucket, BucketError, checkedKey, isKey, pathOf, type BucketKeys, type Connect } from './bucket';

export { FILE_MAX_BYTES } from '@legarec/contracts';

export interface Stored {
  key: string;
  size: number;
  sha256: string;
}

/** Something found in a place, by its name there (`ab/<key>` for a file); `modifiedAt` is `null` when the place does not tell. */
export interface Entry {
  name: string;
  modifiedAt: Date | null;
  /** Not a plain file (a folder, a link): never a file of the storage, whatever its name. */
  foreign?: true;
}

/**
 * What the storage holds, for the sweep of the files without a row. Only a name that is exactly a key drawn by `put`, at
 * its place, can be erased; anything else is `unknown`, and nobody touches it. A `part` is a writing of the disk that was
 * interrupted before its renaming: no row can point at it, its key was never given to anyone.
 */
export type Kept = { kind: 'file' | 'part'; key: string; modifiedAt: Date | null; erase(): Promise<void> } | { kind: 'unknown' };

/** Where the files are kept: under their key, whole, or not at all. */
export interface Files {
  write(key: string, bytes: Uint8Array): Promise<void>;
  /** `null`: no such file here. */
  read(key: string): Promise<Buffer | null>;
  /** Whether it was still there. */
  erase(key: string): Promise<boolean>;
  /** Gone, whether it was there or not. */
  remove(key: string): Promise<void>;
  /** Everything that is there, whatever its name. */
  list(): AsyncIterable<Entry>;
}

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
/** A folder that is not there yet holds nothing. */
const entriesOf = async (folder: string) => {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
};

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

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  /** What an interrupted writing left beside the place of its file. */
  async discard(key: string): Promise<void> {
    await rm(`${this.path(key)}.part`, { force: true });
  }

  /**
   * The two levels written by `write`, and no deeper: a link is never followed, a folder under a folder never opened.
   */
  async *list(): AsyncGenerator<Entry> {
    for (const top of await entriesOf(this.folder)) {
      if (!top.isDirectory() || !/^[0-9a-f]{2}$/u.test(top.name)) {
        yield { name: top.name, modifiedAt: null, foreign: true };
        continue;
      }
      for (const entry of await entriesOf(join(this.folder, top.name))) {
        const name = `${top.name}/${entry.name}`;
        if (!entry.isFile()) {
          yield { name, modifiedAt: null, foreign: true };
          continue;
        }
        try {
          yield { name, modifiedAt: (await lstat(join(this.folder, name))).mtime };
        } catch (error) {
          // Erased since the folder was read.
          if (!missing(error)) throw error;
        }
      }
    }
  }
}

/** A file that could not be removed: the name of what went wrong, and nothing of the file. */
export type Left = (code: string) => void;

/**
 * Files of the documents, under a key drawn at random: never a name chosen by anyone, nor a personal data (CLAUDE.md).
 * In the bucket when there is one and its keys are in the vault; otherwise on the disk of the server. A file written to
 * the disk before the keys were typed is still read there.
 */
export class Storage {
  private readonly folder: Folder;
  private readonly bucket: () => Promise<Files | null>;
  /** A bucket is named in the configuration: without its keys, what it holds is out of reach, not absent. */
  private readonly expected: boolean;
  private readonly left: Left;

  constructor(folder: string, options: { bucket?: () => Promise<Files | null>; left?: Left } = {}) {
    this.folder = new Folder(folder);
    this.bucket = options.bucket ?? (() => Promise.resolve(null));
    this.expected = options.bucket !== undefined;
    this.left = options.left ?? (() => undefined);
  }

  /** On the disk as long as the keys of the bucket are not typed. */
  async put(bytes: Uint8Array): Promise<Stored> {
    const key = randomUUID();
    await ((await this.bucket()) ?? this.folder).write(key, bytes);
    return { key, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  /**
   * The bucket first, then the disk when the bucket says that it has no such object. A bucket that fails is a failure:
   * the disk is not asked, it would answer « not found » for a file that is only out of reach. A bucket without its keys:
   * the disk, and a failure for what the disk does not hold, which may well be in the bucket.
   */
  async read(key: string): Promise<Buffer> {
    const checked = checkedKey(key);
    const bucket = await this.bucket();
    const found = (await bucket?.read(checked)) ?? (await this.folder.read(checked));
    if (found) return found;
    if (this.expected && !bucket) throw new BucketError('read', 'NoKeys');
    throw new Error('file not found');
  }

  /**
   * A file erased by the retention: whether it was still there (it is again after a restoration of the disk). A bucket
   * without its keys is a failure, after the disk: answering « nothing there » would leave in the bucket, uncounted, a
   * file that the retention has to erase.
   */
  async erase(key: string): Promise<boolean> {
    const checked = checkedKey(key);
    const bucket = await this.bucket();
    const there = [(await bucket?.erase(checked)) ?? false, await this.folder.erase(checked)];
    if (this.expected && !bucket) throw new BucketError('erase', 'NoKeys');
    return there.includes(true);
  }

  /**
   * A file whose row was never written. Never fails because of the storage: it runs while a request is already failing, whose error must stay
   * the one that is told. What could not be removed is said by the name of its failure alone, and stays in the storage
   * without a row: the sweep of the night erases it later (sweep.ts).
   */
  async remove(key: string): Promise<void> {
    const checked = checkedKey(key);
    const tried = await Promise.allSettled([
      this.bucket().then((bucket) => {
        if (this.expected && !bucket) throw new BucketError('remove', 'NoKeys');
        return bucket?.remove(checked);
      }),
      this.folder.remove(checked),
    ]);
    for (const outcome of tried) if (outcome.status === 'rejected') this.left(outcome.reason instanceof BucketError ? outcome.reason.code : 'Error');
  }

  /**
   * Everything the two places hold, for the sweep (sweep.ts). A bucket without its keys is a failure before anything is
   * listed: what it holds is out of reach, not absent, and a count of the disk alone would be told as the whole.
   * Each file is erased where it was found, and nowhere else.
   */
  async *kept(): AsyncGenerator<Kept> {
    const bucket = await this.bucket();
    if (this.expected && !bucket) throw new BucketError('list', 'NoKeys');
    for (const place of bucket ? [bucket, this.folder] : [this.folder]) {
      for await (const { name, modifiedAt, foreign } of place.list()) {
        const [, key, part] = /^[0-9a-f]{2}\/([^/]+?)(\.part)?$/u.exec(name) ?? [];
        // The key at the place `write` gives it; a `.part` exists on the disk only.
        if (foreign || !key || !isKey(key) || name !== `${pathOf(key)}${part ?? ''}` || (part && place !== this.folder)) yield { kind: 'unknown' };
        else if (part) yield { kind: 'part', key, modifiedAt, erase: () => this.folder.discard(key) };
        else yield { kind: 'file', key, modifiedAt, erase: async () => void (await place.erase(key)) };
      }
    }
  }
}

/** Said in the journal by the name of the failure alone: neither the key of the file, nor anything of the bucket. */
export const fileLeft =
  (logger: { warn(fields: Record<string, unknown>, message: string): void }): Left =>
  (code) =>
    logger.warn({ kind: 'storage', errorType: code }, 'file left in the storage');

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
export function storageFor(config: StorageConfig, options: { keys?: () => Promise<BucketKeys | null>; connect?: Connect; left?: Left } = {}): Storage {
  const folder = config.DOCUMENTS_DIR ?? (config.NODE_ENV === 'production' ? null : join(tmpdir(), `legarec-documents-${process.pid}`));
  if (!folder) throw new Error('DOCUMENTS_DIR expected');
  const left = options.left ? { left: options.left } : {};
  if (!config.S3_DOCUMENTS_BUCKET || !config.S3_REGION) return new Storage(folder, left);
  const bucket = new Bucket({ bucket: config.S3_DOCUMENTS_BUCKET, region: config.S3_REGION }, options.connect);
  const keys = options.keys ?? (() => Promise.resolve(null));
  return new Storage(folder, {
    ...left,
    bucket: async () => {
      const found = await keys();
      return found ? bucket.with(found) : null;
    },
  });
}
