import { mkdtempSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../platform/logging/logger';
import { AUTOMATIC_SENDER } from './emails.service';
import { SimulatedTransport } from './transport';

const lines: string[] = [];
const logger = createLogger('debug', new Writable({ write: (chunk: Buffer, _encoding, done) => (lines.push(chunk.toString()), done()) }));
const message = { from: AUTOMATIC_SENDER, to: 'alba@exemple.test', subject: 'Votre lien', html: '<p>https://espace.legarec.fr/reinitialisation/jeton</p>' };
const base = mkdtempSync(join(tmpdir(), 'legarec-mails-'));
const folder = join(base, 'mails');
afterEach(() => {
  lines.length = 0;
});

describe('simulated e-mails', () => {
  it('go nowhere without a folder, and leave no trace of their content', async () => {
    await new SimulatedTransport(logger).send(message);
    expect(readdirSync(base)).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('email simulated');
    expect(lines[0]).not.toMatch(/alba|exemple|lien|jeton/u);
  });

  it('are written in a private folder, under a name that says nothing', async () => {
    const transport = new SimulatedTransport(logger, folder);
    await transport.send(message);
    await transport.send(message);
    const names = readdirSync(folder);
    try {
      expect(names).toHaveLength(2);
      for (const name of names) {
        expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{8}\.html$/u);
        expect(statSync(join(folder, name)).mode & 0o777).toBe(0o600);
        expect(readFileSync(join(folder, name), 'utf8')).toContain(message.html);
      }
      expect(statSync(folder).mode & 0o777).toBe(0o700);
      expect(lines.join('')).not.toMatch(/alba|exemple|lien|jeton/u);
    } finally {
      for (const name of names) unlinkSync(join(folder, name));
      rmdirSync(folder);
      rmdirSync(base);
    }
  });
});
