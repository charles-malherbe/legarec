import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamavScanner, SimulatedScanner } from './scanner';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/** A server of this test on 127.0.0.1: nothing leaves the machine. */
async function listen(onSocket: (socket: Socket) => void, allowHalfOpen = false): Promise<number> {
  const server = createServer({ allowHalfOpen }, (socket) => {
    sockets.push(socket);
    onSocket(socket);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}

interface Heard {
  command: string;
  chunks: number[];
  body: Buffer;
}
/**
 * clamd as its protocol is written: `zINSTREAM\0`, then chunks, each after its length on four bytes (big-endian), ended by a
 * length of zero; one answer ended by `\0`, then the connection is closed.
 */
function clamd(answer: (body: Buffer) => string, heard: Heard[] = [], limit = Infinity): Promise<number> {
  return listen((socket) => {
    let received = Buffer.alloc(0);
    let answered = false;
    const say = (text: string) => {
      answered = true;
      socket.end(`${text}\0`);
    };
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      if (answered) return;
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf(0);
      if (end < 0) return;
      const command = received.subarray(0, end).toString();
      if (command !== 'zINSTREAM') return say('UNKNOWN COMMAND');
      const chunks: number[] = [];
      const parts: Buffer[] = [];
      let total = 0;
      for (let at = end + 1; at + 4 <= received.length;) {
        const size = received.readUInt32BE(at);
        if (size === 0) {
          heard.push({ command, chunks, body: Buffer.concat(parts) });
          return say(answer(Buffer.concat(parts)));
        }
        total += size;
        if (total > limit) return say('INSTREAM size limit exceeded. ERROR');
        if (at + 4 + size > received.length) return;
        chunks.push(size);
        parts.push(received.subarray(at + 4, at + 4 + size));
        at += 4 + size;
      }
    });
  });
}
const verdict = (body: Buffer) => (body.includes(EICAR) ? 'stream: Win.Test.EICAR_HDB-1 FOUND' : 'stream: OK');

describe('clamd over TCP', () => {
  it('finds a clean file clean, and the test file of the antivirus makers infected', async () => {
    const scanner = new ClamavScanner('127.0.0.1', await clamd(verdict));
    expect(scanner.name).toBe('clamav');
    expect(await scanner.scan(Buffer.from('%PDF-1.4 nothing'))).toBe('CLEAN');
    expect(await scanner.scan(Buffer.from(`%PDF-1.4 ${EICAR}`))).toBe('INFECTED');
    expect(await scanner.scan(new Uint8Array(0))).toBe('CLEAN');
  });

  it('sends the whole file, in chunks of 64 KiB at most, each after its length', async () => {
    const heard: Heard[] = [];
    const scanner = new ClamavScanner('127.0.0.1', await clamd(verdict, heard));
    const file = Buffer.alloc(3 * 65_536 + 17);
    for (let index = 0; index < file.length; index += 1) file[index] = index % 251;
    // The test file astride two chunks: found only if they are put back in order.
    file.write(EICAR, 65_536 - 10, 'latin1');
    expect(await scanner.scan(file)).toBe('INFECTED');
    expect(heard).toHaveLength(1);
    expect(heard[0]!.command).toBe('zINSTREAM');
    expect(heard[0]!.chunks).toEqual([65_536, 65_536, 65_536, 17]);
    expect(heard[0]!.body.equals(file)).toBe(true);
  });

  it('takes for infected an archive that goes beyond what clamd reads (AlertExceedsMax), never for clean', async () => {
    for (const name of ['Heuristics.Limits.Exceeded.MaxFileSize', 'Heuristics.Limits.Exceeded.MaxScanSize', 'Heuristics.Limits.Exceeded.MaxRecursion']) {
      const scanner = new ClamavScanner('127.0.0.1', await clamd(() => `stream: ${name} FOUND`));
      expect(await scanner.scan(Buffer.from('PK nothing'))).toBe('INFECTED');
    }
  });

  it('never takes for clean a file that clamd refused, or an answer it does not know', async () => {
    const tooLarge = new ClamavScanner('127.0.0.1', await clamd(verdict, [], 100_000));
    await expect(tooLarge.scan(Buffer.alloc(200_000))).rejects.toThrow();
    for (const answer of ['', 'stream: OK and more', 'OK', 'FOUND', 'stream: Something ERROR', 'UNKNOWN COMMAND']) {
      const scanner = new ClamavScanner('127.0.0.1', await clamd(() => answer));
      await expect(scanner.scan(Buffer.from('nothing'))).rejects.toThrow('clamd refused the file');
    }
  });

  it('fails when clamd is away, closes without an answer, or says nothing in time', async () => {
    const port = await listen((socket) => socket.destroy());
    await expect(new ClamavScanner('127.0.0.1', port).scan(Buffer.from('nothing'))).rejects.toThrow();
    // It hears everything, and never answers nor closes.
    const silent = await listen((socket) => {
      socket.on('error', () => undefined);
      socket.on('data', () => undefined);
    }, true);
    await expect(new ClamavScanner('127.0.0.1', silent, 200).scan(Buffer.from('nothing'))).rejects.toThrow('clamd timeout');
    // A port nobody listens on: the one of a server just closed.
    const closed = await listen(() => undefined);
    await new Promise((done) => servers.pop()!.close(done));
    await expect(new ClamavScanner('127.0.0.1', closed, 2_000).scan(Buffer.from('nothing'))).rejects.toThrow();
  });
});

describe('the simulated antivirus', () => {
  it('finds the test file, and nothing else', async () => {
    const scanner = new SimulatedScanner();
    expect(await scanner.scan(Buffer.from(EICAR))).toBe('INFECTED');
    expect(await scanner.scan(Buffer.from('%PDF-1.4'))).toBe('CLEAN');
  });
});
