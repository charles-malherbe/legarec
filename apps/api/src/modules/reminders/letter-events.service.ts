import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { letterNamed } from '../../letters/mysendingbox';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { RateLimits, type RateLimit } from '../../platform/limits/rate-limits';
import { Outbox } from '../../platform/queue/outbox';

/** By network: a few events for each letter, and the firm posts a few dozen letters on its busiest day. */
const EVENTS: RateLimit = { name: 'hook-mysendingbox', max: 300, seconds: 60 };

/**
 * What MySendingBox says of the letters it was given (`POST /hooks/mysendingbox`). It signs nothing: the body is never
 * believed. Only the letter it names is looked for, among those this database sent for real (`app.letter_named`): the
 * worker then asks MySendingBox itself about it, with the key of the vault, once a minute at most for a letter. A letter
 * it does not know is left there, without a call. The same answer whatever came.
 */
@Injectable()
export class LetterEventsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(RateLimits) private readonly limits: RateLimits,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async receive(body: Uint8Array): Promise<void> {
    await this.limits.take(EVENTS);
    const ref = letterNamed(body);
    if (!ref) return;
    const [found] = await this.database.tx.$queryRaw<{ sending: string | null }[]>`SELECT app.letter_named(${ref})::text AS sending`;
    if (!found?.sending) return;
    const minute = Math.floor(this.clock.now().getTime() / 60_000);
    // A key of tasks is made of identifiers: the letter and the minute, as one.
    const hex = createHash('sha256').update(`${found.sending}:${minute}`).digest('hex');
    const once = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    await this.outbox.add({ queue: 'maintenance', name: 'letter-refresh', payload: { sending: found.sending }, dedupeKey: `letter-refresh:${once}` });
  }
}
