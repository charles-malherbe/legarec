import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Bucket, BucketError, DEADLINE_MS, endpointOf, pathOf, type BucketClient, type BucketKeys, type BucketPlace } from './bucket';

const PLACE: BucketPlace = { bucket: 'legarec-essai', region: 'eu-west-par' };
const KEYS: BucketKeys = { accessKeyId: 'identifiant-fictif-QZKX', secretAccessKey: 'valeur-fictive-zz-KXPM' };
const bytes = (text: string) => new TextEncoder().encode(text);

/** What S3 answers, as its client tells it: an error named after the code of the answer, with the facts of the request. */
function refusal(name: string, status: number): Error {
  return Object.assign(new Error(`${name}: ${KEYS.accessKeyId}`), {
    name,
    $metadata: { httpStatusCode: status, requestId: 'tx-fictif' },
    $response: { headers: { authorization: `AWS4-HMAC-SHA256 Credential=${KEYS.accessKeyId}/20261127/eu-west-par/s3/aws4_request` } },
    AWSAccessKeyId: KEYS.accessKeyId,
  });
}

/** A bucket of this test, in memory: nothing leaves the machine. */
class FakeBucket implements BucketClient {
  readonly objects = new Map<string, Uint8Array>();
  readonly heard: { command: string; bucket: string | undefined; key: string | undefined; signal: AbortSignal | undefined }[] = [];
  /** Thrown instead of any answer. */
  failure: Error | undefined;

  send(command: Parameters<BucketClient['send']>[0], options?: { abortSignal?: AbortSignal }) {
    const { Bucket: bucket, Key: key } = command.input;
    this.heard.push({ command: command.constructor.name, bucket, key, signal: options?.abortSignal });
    if (this.failure) return Promise.reject(this.failure);
    if (bucket !== PLACE.bucket) return Promise.reject(refusal('NoSuchBucket', 404));
    const found = this.objects.get(key!);
    if (command instanceof PutObjectCommand) {
      this.objects.set(key!, command.input.Body as Uint8Array);
      return Promise.resolve({});
    }
    if (command instanceof GetObjectCommand)
      return found ? Promise.resolve({ Body: { transformToByteArray: () => Promise.resolve(found) } }) : Promise.reject(refusal('NoSuchKey', 404));
    if (command instanceof HeadObjectCommand) return found ? Promise.resolve({}) : Promise.reject(refusal('NotFound', 404));
    if (command instanceof DeleteObjectCommand) this.objects.delete(key!);
    return Promise.resolve({});
  }
}

function start(place = PLACE) {
  const clients: { client: FakeBucket; place: BucketPlace; keys: BucketKeys }[] = [];
  const objects = new FakeBucket();
  const bucket = new Bucket(place, (at, keys) => {
    const client = new FakeBucket();
    // The same bucket behind each client.
    Object.assign(client, { objects: objects.objects });
    clients.push({ client, place: at, keys });
    return client;
  });
  return { bucket, clients, objects: objects.objects };
}

describe('the bucket of the documents', () => {
  it('writes a file under its key, reads it back and erases it', async () => {
    const { bucket, clients, objects } = start();
    const files = bucket.with(KEYS);
    const key = randomUUID();
    await files.write(key, bytes('%PDF-1.4 essai'));
    expect([...objects.keys()]).toEqual([`${key.slice(0, 2)}/${key}`]);
    expect((await files.read(key))?.toString()).toBe('%PDF-1.4 essai');
    expect(await files.erase(key)).toBe(true);
    expect(objects.size).toBe(0);
    const [{ client, place, keys }] = clients as [(typeof clients)[0]];
    expect([place, keys]).toEqual([PLACE, KEYS]);
    expect(client.heard.map((heard) => heard.command)).toEqual(['PutObjectCommand', 'GetObjectCommand', 'HeadObjectCommand', 'DeleteObjectCommand']);
    // Each request, in the one bucket, and with a deadline.
    for (const heard of client.heard) {
      expect(heard.bucket).toBe(PLACE.bucket);
      expect(heard.signal).toBeInstanceOf(AbortSignal);
    }
    expect(DEADLINE_MS).toBeLessThan(15_000);
  });

  it('says that an object is not there, on a read and on an erasure, without erasing anything', async () => {
    const { bucket, clients } = start();
    const files = bucket.with(KEYS);
    const key = randomUUID();
    expect(await files.read(key)).toBeNull();
    expect(await files.erase(key)).toBe(false);
    expect(clients[0]!.client.heard.map((heard) => heard.command)).toEqual(['GetObjectCommand', 'HeadObjectCommand']);
  });

  it.each([
    ['NoSuchBucket', 404],
    ['AccessDenied', 403],
    ['InvalidAccessKeyId', 403],
    ['SignatureDoesNotMatch', 403],
    ['SlowDown', 503],
    ['TimeoutError', 0],
    ['AbortError', 0],
  ])('never takes a failure for an absence: %s', async (name, status) => {
    const { bucket, clients } = start();
    const files = bucket.with(KEYS);
    const key = randomUUID();
    await files.write(key, bytes('essai'));
    clients[0]!.client.failure = refusal(name, status);
    for (const [operation, work] of [
      ['write', () => files.write(key, bytes('autre'))],
      ['read', () => files.read(key)],
      ['erase', () => files.erase(key)],
    ] as const) {
      const error = await work().then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(BucketError);
      expect(error).toMatchObject({ name: 'BucketError', operation, code: name, message: `bucket ${operation} failed: ${name}` });
    }
  });

  it('takes a bucket that is not there for a failure, not for an empty one', async () => {
    const { bucket } = start({ ...PLACE, bucket: 'legarec-ailleurs' });
    await expect(bucket.with(KEYS).read(randomUUID())).rejects.toMatchObject({ code: 'NoSuchBucket' });
    await expect(bucket.with(KEYS).write(randomUUID(), bytes('essai'))).rejects.toMatchObject({ code: 'NoSuchBucket' });
  });

  it('tells a failure by its name alone: nothing of the keys, of the request nor of the answer', async () => {
    const { bucket, clients } = start();
    const files = bucket.with(KEYS);
    clients[0]!.client.failure = refusal('InvalidAccessKeyId', 403);
    const error = (await files.read(randomUUID()).catch((thrown: unknown) => thrown)) as BucketError;
    const told = JSON.stringify([error, Object.getOwnPropertyNames(error), error.message, error.stack, String(error.cause)]);
    for (const secret of [KEYS.accessKeyId, KEYS.secretAccessKey, 'tx-fictif', 'Credential']) expect(told).not.toContain(secret);
    expect(error.cause).toBeUndefined();
    // A name that is not one says nothing either.
    clients[0]!.client.failure = Object.assign(new Error('x'), { name: `Bad ${KEYS.secretAccessKey}` });
    await expect(files.read(randomUUID())).rejects.toMatchObject({ code: 'Unknown' });
    clients[0]!.client.failure = null as unknown as Error;
    Object.assign(clients[0]!.client, { send: () => Promise.reject(new Error(KEYS.secretAccessKey)) });
    await expect(files.read(randomUUID())).rejects.toMatchObject({ message: 'bucket read failed: Error' });
  });

  it('fails on an answer without content', async () => {
    const { bucket, clients } = start();
    const files = bucket.with(KEYS);
    Object.assign(clients[0]!.client, { send: () => Promise.resolve({}) });
    await expect(files.read(randomUUID())).rejects.toBeInstanceOf(BucketError);
  });

  it('keeps its client as long as the keys are the same, and takes another one when one of them changes', () => {
    const { bucket, clients } = start();
    const first = bucket.with(KEYS);
    expect(bucket.with({ ...KEYS })).toBe(first);
    expect(clients).toHaveLength(1);
    const renewed = bucket.with({ ...KEYS, secretAccessKey: 'valeur-fictive-renouvelee' });
    expect(renewed).not.toBe(first);
    expect(bucket.with({ accessKeyId: 'autre-identifiant-fictif', secretAccessKey: 'valeur-fictive-renouvelee' })).not.toBe(renewed);
    expect(clients.map(({ keys }) => keys.secretAccessKey)).toEqual([KEYS.secretAccessKey, 'valeur-fictive-renouvelee', 'valeur-fictive-renouvelee']);
  });

  it.each(['', '../../etc/passwd', 'a/b', `${randomUUID()}/..`, randomUUID().toUpperCase(), `${randomUUID()}\n`])(
    'asks nothing for a key that is not one: %j',
    async (key) => {
      const { bucket, clients } = start();
      const files = bucket.with(KEYS);
      expect(() => pathOf(key)).toThrow('invalid storage key');
      for (const work of [() => files.write(key, bytes('essai')), () => files.read(key), () => files.erase(key)])
        await expect(work()).rejects.toThrow('invalid storage key');
      expect(clients[0]!.client.heard).toEqual([]);
    },
  );

  it('is at OVHcloud, in the region of the configuration', () => {
    expect(endpointOf('eu-west-par')).toBe('https://s3.eu-west-par.io.cloud.ovh.net');
  });
});
