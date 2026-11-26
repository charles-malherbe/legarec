import { connect } from 'node:net';

export type Verdict = 'CLEAN' | 'INFECTED';
export interface Scanner {
  readonly name: 'clamav' | 'simulated';
  scan(bytes: Uint8Array): Promise<Verdict>;
}

/** The test file of the antivirus makers: what the simulated scanner finds, as ClamAV does. */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!';

/** Development and tests: no antivirus on the machine. Never in production (`readWorkerConfig`). */
export class SimulatedScanner implements Scanner {
  readonly name = 'simulated';
  scan(bytes: Uint8Array): Promise<Verdict> {
    return Promise.resolve(Buffer.from(bytes).includes(EICAR) ? 'INFECTED' : 'CLEAN');
  }
}

/** clamd over TCP (`INSTREAM`): chunks of at most 64 Ko, each after its length; the answer ends with OK or FOUND. */
export class ClamavScanner implements Scanner {
  readonly name = 'clamav';
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 60_000,
  ) {}

  scan(bytes: Uint8Array): Promise<Verdict> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('clamd timeout')));
      socket.on('error', reject);
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('end', () => {
        const answer = Buffer.concat(chunks).toString('utf8').replace(/\0/gu, '').trim();
        if (answer.endsWith(' OK')) resolve('CLEAN');
        else if (answer.endsWith(' FOUND')) resolve('INFECTED');
        // A file too large for its settings, or any error: never taken for clean.
        else reject(new Error('clamd refused the file'));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let start = 0; start < bytes.byteLength; start += 65_536) {
          const part = bytes.subarray(start, Math.min(start + 65_536, bytes.byteLength));
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.byteLength);
          socket.write(size);
          socket.write(part);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}
