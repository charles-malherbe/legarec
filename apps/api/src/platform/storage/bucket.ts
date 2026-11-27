import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Files } from './storage';

export interface BucketKeys {
  accessKeyId: string;
  secretAccessKey: string;
}
export interface BucketPlace {
  bucket: string;
  region: string;
}
type Command = PutObjectCommand | GetObjectCommand | ListObjectsV2Command | DeleteObjectCommand;
interface Answer {
  Body?: { transformToByteArray(): Promise<Uint8Array> } | undefined;
  Contents?: { Key?: string | undefined }[] | undefined;
}
/** What is used of the client of S3: a test gives its own, and nothing leaves the machine. */
export interface BucketClient {
  send(command: Command, options?: { abortSignal?: AbortSignal }): Promise<Answer>;
}
export type Connect = (place: BucketPlace, keys: BucketKeys) => BucketClient;

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** A key drawn by `Storage.put`, and nothing else: never a path, never a name chosen by anyone. */
export function checkedKey(key: string): string {
  if (!KEY.test(key)) throw new Error('invalid storage key');
  return key;
}

/** The same place in the bucket as under the folder of the disk: the first two characters, then the key. */
export const pathOf = (key: string): string => `${checkedKey(key).slice(0, 2)}/${key}`;

/** OVHcloud Object Storage, by its S3 address (docs/deploiement.md). */
export const endpointOf = (region: string): string => `https://s3.${region}.io.cloud.ovh.net`;

/**
 * A request holds a transaction of 15 seconds at most: the bucket has answered before, retries included, or the request
 * fails. The two timeouts of the client only bound the connection and a silence, not the whole exchange.
 */
export const DEADLINE_MS = 12_000;

const connectToOvh: Connect = ({ region }, keys) =>
  new S3Client({
    region,
    endpoint: endpointOf(region),
    credentials: keys,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 },
    // Checksums only where S3 demands them: a provider other than AWS may refuse the newer ones.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }) as BucketClient;

/**
 * What went wrong with the bucket, by the name S3 gives it (`AccessDenied`, `NoSuchBucket`, `TimeoutError`…) and nothing
 * else: the error of the client carries the request, its headers and the identifier of the key, which belong in no journal.
 */
export class BucketError extends Error {
  override readonly name = 'BucketError';

  constructor(
    readonly operation: 'write' | 'read' | 'erase' | 'remove',
    readonly code: string,
  ) {
    super(`bucket ${operation} failed: ${code}`);
  }
}
const nameOf = (error: unknown): string => {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && /^[A-Za-z0-9]{1,60}$/u.test(name) ? name : 'Unknown';
};

/**
 * An object that is not there, and that alone. A bucket that is not there (`NoSuchBucket`), a refusal or a silence are
 * failures: taken for an absence, they would send the reader to the disk and hide the outage.
 */
const absent = (error: unknown): boolean => nameOf(error) === 'NoSuchKey';

/** The private bucket of the documents. Its client is kept as long as the keys of the vault do not change. */
export class Bucket {
  private current: { keys: BucketKeys; files: Files } | undefined;

  constructor(
    private readonly place: BucketPlace,
    private readonly connect: Connect = connectToOvh,
  ) {}

  with(keys: BucketKeys): Files {
    const { current } = this;
    if (current && current.keys.accessKeyId === keys.accessKeyId && current.keys.secretAccessKey === keys.secretAccessKey) return current.files;
    const files = this.files(this.connect(this.place, keys));
    this.current = { keys, files };
    return files;
  }

  private files(client: BucketClient): Files {
    const Bucket = this.place.bucket;
    /** `null`: the object is not there. Anything else that goes wrong is told by its name alone. */
    const ask = async <T>(operation: BucketError['operation'], work: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
      try {
        return await work(AbortSignal.timeout(DEADLINE_MS));
      } catch (error) {
        if (operation === 'read' && absent(error)) return null;
        throw new BucketError(operation, nameOf(error));
      }
    };
    return {
      write: async (key, bytes) => {
        const Key = pathOf(key);
        await ask('write', (abortSignal) =>
          client.send(new PutObjectCommand({ Bucket, Key, Body: bytes, ContentLength: bytes.byteLength, ContentType: 'application/octet-stream' }), {
            abortSignal,
          }),
        );
      },
      read: async (key) => {
        const Key = pathOf(key);
        return ask('read', async (abortSignal) => {
          const { Body } = await client.send(new GetObjectCommand({ Bucket, Key }), { abortSignal });
          if (!Body) throw new Error('empty answer of the bucket');
          return Buffer.from(await Body.transformToByteArray());
        });
      },
      // S3 erases without saying whether there was anything: asked first, for the count of the purge. By the list, whose
      // answer names a bucket that is not there; the answer to a HEAD has no body, and cannot tell it from a missing object.
      erase: async (key) => {
        const Key = pathOf(key);
        const listed = await ask('erase', (abortSignal) => client.send(new ListObjectsV2Command({ Bucket, Prefix: Key, MaxKeys: 1 }), { abortSignal }));
        if (!listed?.Contents?.some((object) => object.Key === Key)) return false;
        await ask('erase', (abortSignal) => client.send(new DeleteObjectCommand({ Bucket, Key }), { abortSignal }));
        return true;
      },
      // One request, whatever was there: this one runs while a request is failing.
      remove: async (key) => {
        const Key = pathOf(key);
        await ask('remove', (abortSignal) => client.send(new DeleteObjectCommand({ Bucket, Key }), { abortSignal }));
      },
    };
  }
}
