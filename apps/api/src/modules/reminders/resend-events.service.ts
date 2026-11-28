import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PROVIDER, readResendEvent, signedByResend } from '../../emails/resend-webhook';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { unauthorized } from '../../platform/errors/api-error';
import { signedDelivery } from '../../platform/http/context';
import { RateLimits, type RateLimit } from '../../platform/limits/rate-limits';
import { LOGGER, type AppLogger } from '../../platform/logging/logger';
import { Outbox } from '../../platform/queue/outbox';
import { Vault } from '../vault/vault';

/**
 * By network: Resend writes from a handful of addresses, four events or so for each message, and the firm sends a few
 * hundred reminders on its busiest hour. Counted before the signature is looked at: guessing costs a request each time.
 */
const EVENTS: RateLimit = { name: 'hook-resend', max: 600, seconds: 60 };

/**
 * What Resend says of the messages it was given (`POST /hooks/resend`). Nothing is believed before the signature of the
 * body has been checked with the secret of the vault; without a secret, everything is refused. The event is then written
 * once, with its identifiers and its date only, and handed to the worker: nothing of a case is read or changed here.
 */
@Injectable()
export class ResendEventsService {
  /** Drawn at each start and told to nobody: what the signature is compared with when the vault holds no secret. */
  private readonly nobody = `whsec_${randomBytes(32).toString('base64')}`;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(RateLimits) private readonly limits: RateLimits,
    @Inject(Vault) private readonly vault: Vault,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: AppLogger,
  ) {}

  async receive(body: Uint8Array): Promise<void> {
    await this.limits.take(EVENTS);
    const { tx } = this.database;
    const delivery = signedDelivery();
    // The same answer, after the same work, whatever is wrong: no secret, no header, an old date, another body, another
    // secret. Without a secret the signature is still computed, under a key nobody holds, and refused all the same.
    const secret = await this.secret();
    if (!signedByResend(secret || this.nobody, delivery, body, this.clock.now()) || !secret) {
      this.logger.warn({ kind: 'resend' }, 'webhook refused');
      throw unauthorized();
    }
    const event = readResendEvent(body);
    // What names no message of ours is kept for the count only: nothing to do with it.
    const wanted = event.kind !== 'OTHER' && (event.sendingId !== null || event.providerRef !== null);
    // Neither its date nor the message it names: an open or a click is not followed, not even kept (question 225).
    const kept = wanted ? event : { occurredAt: null, providerRef: null, sendingId: null };
    // Delivered twice, or sent again by Resend: written once, handled once.
    const [written] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO webhook_events (provider, provider_event_id, status, kind, occurred_at, provider_ref, sending_id)
      VALUES (${PROVIDER}, ${delivery.id}, ${wanted ? 'RECEIVED' : 'IGNORED'}::webhook_status, ${event.kind}, ${kept.occurredAt}::timestamptz,
        ${kept.providerRef}::uuid, ${kept.sendingId}::uuid)
      ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`;
    if (written && wanted)
      await this.outbox.add({ queue: 'maintenance', name: 'resend-event', payload: { event: written.id }, dedupeKey: `resend-event:${written.id}` });
  }

  /** The secret of the vault, for this route alone (`app.hook_secret`). Empty when there is none, or when it cannot be opened. */
  private async secret(): Promise<string> {
    const [stored] = await this.database.tx.$queryRaw<{ id: string | null; value_cipher: Uint8Array | null }[]>`
      SELECT * FROM app.hook_secret('RESEND_WEBHOOK_SECRET')`;
    if (!stored?.id || !stored.value_cipher) return '';
    try {
      return this.vault.open(stored.id, stored.value_cipher);
    } catch {
      return '';
    }
  }
}
