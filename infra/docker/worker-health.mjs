// Health of the worker, which opens no port: a program that runs reads its queues, and Valkey knows who reads them.
// Run inside its container, with its own values. Prints nothing of them.
import { networkInterfaces } from 'node:os';
import { Redis } from 'ioredis';

/** Same prefix as src/platform/queue/publisher.ts: BullMQ names its connections `<prefix>:<queue in base64>`. */
const READER = /(?:^| )name=legarec:/u;
const IDLE_SECONDS = 60;
const LIMIT_MS = 8_000;

// Whatever happens, an answer.
setTimeout(() => process.exit(1), LIMIT_MS).unref();

const own = Object.values(networkInterfaces())
  .flat()
  .map((address) => address?.address);
const isOwn = (line) => own.includes(/(?:^| )addr=\[?([^ ]*?)\]?:\d+(?: |$)/u.exec(line)?.[1]);
const isFresh = (line) => Number(/(?:^| )idle=(\d+)(?: |$)/u.exec(line)?.[1] ?? Infinity) <= IDLE_SECONDS;

async function reads() {
  const valkey = new Redis(process.env.VALKEY_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  valkey.on('error', () => undefined);
  try {
    await valkey.connect();
    const clients = String(await valkey.client('LIST')).split('\n');
    return clients.some((line) => READER.test(line) && isOwn(line) && isFresh(line));
  } catch {
    return false;
  } finally {
    valkey.disconnect();
  }
}

process.exit((await reads()) ? 0 : 1);
