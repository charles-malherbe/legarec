import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export { FILE_MAX_BYTES } from '@legarec/contracts';

export interface Stored {
  key: string;
  size: number;
  sha256: string;
}

/**
 * Files of the documents, under a key drawn at random: never a name chosen by anyone, nor a personal data (CLAUDE.md).
 * On the disk of the server, in a folder of its own (a volume in production) until the bucket of lot X.
 */
export class Storage {
  constructor(private readonly folder: string) {}

  private path(key: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(key)) throw new Error('invalid storage key');
    return join(this.folder, key.slice(0, 2), key);
  }

  /** Written whole, then renamed: a file half written is never read. */
  async put(bytes: Uint8Array): Promise<Stored> {
    const key = randomUUID();
    const path = this.path(key);
    // Read and written by the API and the worker, by their common group (the folder keeps it: setgid), nobody else.
    const folder = join(this.folder, key.slice(0, 2));
    await mkdir(folder, { recursive: true });
    await chmod(folder, 0o2770);
    await writeFile(`${path}.part`, bytes);
    await chmod(`${path}.part`, 0o660);
    await rename(`${path}.part`, path);
    return { key, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  /** A file erased by the retention: whether it was still there (it is again after a restoration of the disk). */
  async erase(key: string): Promise<boolean> {
    try {
      await rm(this.path(key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** A file whose row was never written, or that ClamAV found infected. */
  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** The folder of the configuration; outside production, without one, a folder of this process in the temporary one. */
export function storageFor(config: { NODE_ENV: string; DOCUMENTS_DIR?: string | undefined }): Storage {
  if (config.DOCUMENTS_DIR) return new Storage(config.DOCUMENTS_DIR);
  if (config.NODE_ENV === 'production') throw new Error('DOCUMENTS_DIR expected');
  return new Storage(join(tmpdir(), `legarec-documents-${process.pid}`));
}
