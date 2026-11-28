import { createHmac, timingSafeEqual } from 'node:crypto';

/** Name of Resend in `webhook_events.provider`. */
export const PROVIDER = 'RESEND';

/** What Resend (Svix) writes beside the body of an event. */
export interface Delivery {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

/** How old, or how far ahead, the date of a delivery may be: beyond it, a copy of an old event is refused. */
export const TOLERANCE_SECONDS = 300;
const ID = /^[A-Za-z0-9_.-]{1,200}$/u;
const TIMESTAMP = /^[0-9]{1,12}$/u;
const SECRET = /^whsec_([A-Za-z0-9+/]{16,}={0,2})$/u;
const SIGNATURE = /^[A-Za-z0-9+/]{43}=$/u;

/**
 * True when the body is the one Resend signed: HMAC-SHA256 of `id.timestamp.body`, on the bytes as they came, under the
 * key that follows `whsec_` (base64). The header may hold several signatures (a secret being renewed): one is enough.
 * A missing header, another version than `v1`, a date outside the tolerance, a secret that is not one: false, without a
 * word of why. Compared in constant time.
 */
export function signedByResend(secret: string, delivery: Delivery, body: Uint8Array, now: Date): boolean {
  const { id, timestamp, signature } = delivery;
  const key = SECRET.exec(secret)?.[1];
  if (!key || !id || !timestamp || !signature || !ID.test(id) || !TIMESTAMP.test(timestamp) || signature.length > 1000) return false;
  // To the second, as Svix does: the clock is cut to its second before the comparison.
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', Buffer.from(key, 'base64')).update(`${id}.${timestamp}.`).update(body).digest();
  let found = false;
  for (const part of signature.split(' ')) {
    const [version, value = ''] = part.split(',');
    if (version !== 'v1' || !SIGNATURE.test(value)) continue;
    const given = Buffer.from(value, 'base64');
    // Every signature is compared, whatever the others gave.
    if (given.length === expected.length && timingSafeEqual(given, expected)) found = true;
  }
  return found;
}

/** What an event says, from the closed list of `webhook_events.kind`. */
export type EventKind = 'SENT' | 'DELIVERED' | 'DELAYED' | 'BOUNCED' | 'BOUNCED_SOFT' | 'COMPLAINED' | 'FAILED' | 'SUPPRESSED' | 'OTHER';
export interface ResendEvent {
  kind: EventKind;
  /** When it happened, as Resend dates it. */
  occurredAt: Date | null;
  /** The message at Resend. */
  providerRef: string | null;
  /** The line the message was sent for: the tag `sending_id` given with it. */
  sendingId: string | null;
}

/** Opens and clicks are not followed (question 225), nor what does not concern a message that has left. */
const KINDS: Record<string, EventKind> = {
  'email.sent': 'SENT',
  'email.delivered': 'DELIVERED',
  'email.delivery_delayed': 'DELAYED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
  'email.failed': 'FAILED',
  'email.suppressed': 'SUPPRESSED',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** The tag that names the line of `sendings` a message was sent for. */
export const SENDING_TAG = 'sending_id';
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const uuid = (value: unknown) => (typeof value === 'string' && UUID.test(value) ? value : null);

/**
 * The identifiers and the date of a signed event: nothing else leaves the body (neither the addresses nor the subject).
 * Whatever cannot be read is an event of no interest, never an error: it is signed, and asking for it again changes nothing.
 */
export function readResendEvent(body: Uint8Array): ResendEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    parsed = null;
  }
  const event = record(parsed);
  const data = record(event.data);
  let kind: EventKind = (typeof event.type === 'string' && Object.hasOwn(KINDS, event.type) ? KINDS[event.type] : undefined) ?? 'OTHER';
  // Only a bounce said to be permanent condemns an address.
  if (kind === 'BOUNCED' && record(data.bounce).type !== 'Permanent') kind = 'BOUNCED_SOFT';
  const date = typeof event.created_at === 'string' && event.created_at.length <= 40 ? new Date(event.created_at) : null;
  // In the events the tags are a map; in the request that sends, a list of names and values.
  const tags = Array.isArray(data.tags)
    ? (data.tags as unknown[]).map(record).find((tag) => tag.name === SENDING_TAG)?.value
    : Object.hasOwn(record(data.tags), SENDING_TAG)
      ? record(data.tags)[SENDING_TAG]
      : undefined;
  return {
    kind,
    occurredAt: date && !Number.isNaN(date.getTime()) ? date : null,
    providerRef: uuid(data.email_id),
    sendingId: uuid(tags),
  };
}
