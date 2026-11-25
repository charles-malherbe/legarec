import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppLogger } from '../platform/logging/logger';
import type { AutomaticMessage, AutomaticTransport } from './emails.service';

/**
 * Nothing leaves before the real one (lot Q). In development the message is written in a private folder of this machine,
 * outside of the repository, so that its links can be followed.
 */
export class SimulatedTransport implements AutomaticTransport {
  constructor(
    private readonly logger: AppLogger,
    private readonly directory?: string,
  ) {}

  async send(message: AutomaticMessage): Promise<void> {
    if (this.directory) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const name = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}.html`;
      // Nothing typed by anyone may close the comment.
      const about = `${message.to} · ${message.subject}`.replace(/[<>-]{2,}/gu, ' ');
      await writeFile(join(this.directory, name), `<!-- ${about} -->\n${message.html}`, { mode: 0o600 });
    }
    this.logger.info({ kind: 'email' }, 'email simulated');
  }
}
