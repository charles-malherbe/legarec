import { ProviderRefused } from '../emails/resend';
import { ADDRESS_LINE_MAX } from './postal';

/** What MySendingBox is asked through: `fetch` with a form, or a fake in the tests. No test ever reaches a provider. */
export type FormClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData; signal: AbortSignal },
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
}
