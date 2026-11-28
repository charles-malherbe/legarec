import { ProviderRefused } from '../emails/resend';
import { ADDRESS_LINE_MAX } from './postal';

/** What MySendingBox is asked through: `fetch` with a form, or a fake in the tests. No test ever reaches a provider. */
export type FormClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: FormData; signal: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** A postal address as MySendingBox reads it: one to three lines of street, of 45 characters at most (`streetLinesOf`). */
export interface PostalAddress {
  name: string;
  lines: readonly string[];
  postalCode: string;
  city: string;
}
export interface Letter {
  pdf: Uint8Array;
  to: PostalAddress;
  from: PostalAddress;
  /** `lrar`: registered, with an acknowledgement of receipt (« recommandé avec AR »); `prioritaire`: a plain letter. */
  postage: 'lrar' | 'prioritaire';
  /** An identifier of ours, given back with the letter: nothing of the debtor. */
  sending: string;
}

const ENDPOINT = 'https://api.mysendingbox.fr/letters';
const TIMEOUT_MS = 30_000;
const REF = /^[A-Za-z0-9_-]{1,100}$/u;
/** Why a letter did not reach its address, as `sendings.undelivered_reason` keeps it. */
export type LetterUndelivered = 'RETURNED' | 'WRONG_ADDRESS' | 'LOST' | 'CANCELED' | 'PROVIDER_FAILED';
/** What the events of a letter say, each fact with the date of its first event; nothing when they say nothing of it. */
export interface LetterTrack {
  posted?: Date;
  delivered?: Date;
  undelivered?: { at: Date; reason: LetterUndelivered };
}
/** Events that prove the letter was handed to La Poste. */
const POSTED = new Set(['letter.filing_proof', 'letter.sent', 'letter.in_transit', 'letter.waiting_to_be_withdrawn', 'letter.distributed', 'letter.delivery_proof', 'letter.returned_to_sender', 'letter.return_to_sender_proof', 'letter.wrong_address']);
const DELIVERED = new Set(['letter.distributed', 'letter.delivery_proof']);
const UNDELIVERED: Record<string, LetterUndelivered> = {
  'letter.returned_to_sender': 'RETURNED',
  'letter.return_to_sender_proof': 'RETURNED',
  'letter.wrong_address': 'WRONG_ADDRESS',
  'letter.lost': 'LOST',
  'letter.canceled': 'CANCELED',
  'letter.error': 'PROVIDER_FAILED',
  'letter.failed_internal': 'PROVIDER_FAILED',
};

/**
 * The tracking of a letter from its events (MySendingBox has no single status): the earliest date of each fact. Events
 * without a readable name or date are left aside. Delivered wins over undelivered: a letter once distributed has arrived.
 */
export function trackOf(events: readonly { name: string; at: Date }[]): LetterTrack {
  const track: LetterTrack = {};
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const { name, at } of sorted) {
    if (POSTED.has(name)) track.posted ??= at;
    if (DELIVERED.has(name)) track.delivered ??= at;
    const reason = UNDELIVERED[name];
    if (reason) track.undelivered ??= { at, reason };
  }
  if (track.delivered) delete track.undelivered;
  return track;
}

/** The letter a webhook names (`event.letter`, or `letter._id`), when it looks like one; nothing else of the body is kept. */
export function letterNamed(body: Uint8Array): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return null;
  }
  const read = (value: unknown, key: string) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined);
  for (const ref of [read(read(parsed, 'event'), 'letter'), read(read(parsed, 'letter'), '_id')]) if (typeof ref === 'string' && REF.test(ref)) return ref;
  return null;
}

const fit = (text: string) => text.replace(/\s+/gu, ' ').trim().slice(0, ADDRESS_LINE_MAX);

/**
 * Letters by MySendingBox (`POST /letters`, HTTP Basic with the key as user name). A `test_` key renders the letter and
 * sends nothing; a `live_` key posts it. The key is given for each letter and kept nowhere; neither the address, nor the
 * file, nor what MySendingBox answers is logged or thrown. An answer that is not a clear refusal, a cut or a timeout says
 * nothing of what has left: the caller keeps the sending « uncertain ».
 */
export class MySendingBoxClient {
  constructor(
    private readonly http: FormClient,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}

  /** `once`: the same key never creates two letters (MySendingBox keeps it 24 hours, per mode). */
  async send(key: string, letter: Letter, once: string): Promise<{ ref: string; test: boolean }> {
    const form = new FormData();
    const address = (prefix: string, value: PostalAddress) => {
      form.set(`${prefix}.name`, fit(value.name));
      value.lines.slice(0, 3).forEach((line, index) => form.set(`${prefix}.address_line${index + 1}`, fit(line)));
      form.set(`${prefix}.address_postalcode`, value.postalCode.trim());
      form.set(`${prefix}.address_city`, fit(value.city));
      form.set(`${prefix}.address_country`, 'France');
    };
    address('to', letter.to);
    address('from', letter.from);
    form.set('color', 'bw');
    form.set('postage_type', letter.postage);
    form.set('postage_speed', 'D1');
    form.set('both_sides', 'false');
    // A page of its own for the address: the text of the letter never has to leave room for the window.
    form.set('address_placement', 'insert_blank_page');
    form.set('metadata[sending_id]', letter.sending);
    form.set('source_file_type', 'file');
    form.set('source_file', new Blob([new Uint8Array(letter.pdf)], { type: 'application/pdf' }), 'courrier.pdf');
    let answer: Awaited<ReturnType<FormClient>>;
    try {
      answer = await this.http(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'idempotency-key': once },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // The cause may quote the request: it stops here.
      throw new Error('PROVIDER_UNREACHABLE');
    }
    if (answer.status === 401 || answer.status === 403) throw new ProviderRefused('PROVIDER_KEY_REFUSED');
    if (answer.status === 429) throw new ProviderRefused('PROVIDER_BUSY');
    if (answer.status >= 400 && answer.status < 500 && answer.status !== 408 && answer.status !== 409) throw new ProviderRefused('PROVIDER_REFUSED');
    if (answer.status < 200 || answer.status >= 300) throw new Error('PROVIDER_FAILED');
    const body = (await answer.json().catch(() => null)) as { _id?: unknown; mode?: unknown } | null;
    return { ref: typeof body?._id === 'string' && REF.test(body._id) ? body._id : 'unknown', test: body?.mode !== 'live' };
  }

  /**
   * What MySendingBox says of a letter now (`GET /letters/:id`): what is believed, never the body of a webhook. Null when it
   * does not know it (404). Its mode, and its events by name and date; the rest (address, file, proofs) is not read.
   */
  async read(key: string, ref: string): Promise<{ live: boolean; events: { name: string; at: Date }[] } | null> {
    if (!REF.test(ref)) return null;
    let answer: Awaited<ReturnType<FormClient>>;
    try {
      answer = await this.http(`${ENDPOINT}/${ref}`, {
        method: 'GET',
        headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error('PROVIDER_UNREACHABLE');
    }
    if (answer.status === 404) return null;
    if (answer.status === 401 || answer.status === 403) throw new ProviderRefused('PROVIDER_KEY_REFUSED');
    if (answer.status < 200 || answer.status >= 300) throw new Error('PROVIDER_FAILED');
    const body = (await answer.json().catch(() => null)) as { _id?: unknown; mode?: unknown; events?: unknown } | null;
    if (body?._id !== ref) return null;
    const events = (Array.isArray(body.events) ? body.events : []).flatMap((event: unknown) => {
      const { name, created_at: created } = (event ?? {}) as { name?: unknown; created_at?: unknown };
      const at = typeof created === 'string' ? new Date(created) : null;
      return typeof name === 'string' && at && !Number.isNaN(at.getTime()) ? [{ name: name.startsWith('letter.') ? name : `letter.${name}`, at }] : [];
    });
    return { live: body.mode === 'live', events };
  }
}
