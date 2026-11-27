import type { Transaction } from '../../platform/database/database';
import type { BucketKeys } from '../../platform/storage/bucket';
import type { Vault } from './vault';

const KEPT_MS = 300_000;
const ABSENT_KEPT_MS = 30_000;

/**
 * The two keys of the bucket of the documents, typed in Paramètres techniques > Secrets: read encrypted by a function of
 * PostgreSQL, opened here, kept five minutes in memory (a renewed key is taken within that time). `null` without both:
 * the files then stay on the disk of the server.
 */
export function storageKeys(vault: Pick<Vault, 'open'>, read: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>): () => Promise<BucketKeys | null> {
  let known: { keys: BucketKeys | null; until: number } | undefined;
  return async () => {
    if (known && known.until > Date.now()) return known.keys;
    const rows = await read(
      (tx) => tx.$queryRaw<{ name: string; id: string; value_cipher: Uint8Array }[]>`SELECT name, id, value_cipher FROM app.storage_keys()`,
    );
    const value = (name: string) => {
      const row = rows.find((candidate) => candidate.name === name);
      return row ? vault.open(row.id, row.value_cipher) : null;
    };
    const [accessKeyId, secretAccessKey] = [value('S3_ACCESS_KEY'), value('S3_SECRET_KEY')];
    const keys = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
    known = { keys, until: Date.now() + (keys ? KEPT_MS : ABSENT_KEPT_MS) };
    return keys;
  };
}
