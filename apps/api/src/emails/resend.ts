import type { AutomaticMessage } from './emails.service';
import { SENDING_TAG } from './resend-webhook';

/** What a provider is asked through: `fetch`, or a fake in the tests. No test ever reaches a provider. */
export type HttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** The provider said no: nothing has left. `code` is ours, never its words. */
export class ProviderRefused extends Error {
  override readonly name = 'ProviderRefused';
  constructor(readonly code: string) {
    super(code);
  }
}

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 20_000;
const REF = /^[A-Za-z0-9_-]{1,100}$/u;

/**
 * E-mails to the debtors, by Resend. The key is given for each message and kept nowhere; neither the address, nor the
 * subject, nor what Resend answers is logged or thrown. An answer that is not a clear refusal, a cut or a timeout says
 * nothing of what has left: the caller keeps the sending « uncertain ».
 */
export class ResendClient {
  constructor(
    private readonly http: HttpClient,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}

  /**
   * `once`: the same key never sends twice (Resend keeps it 24 hours). `sending`: the line the message leaves for, given
   * back by Resend with each event of the message (tag `sending_id`): an identifier, nothing of the debtor.
   */
  async send(key: string, message: AutomaticMessage, once: string, sending?: string): Promise<{ ref: string }> {
    let answer: Awaited<ReturnType<HttpClient>>;
    try {
      answer = await this.http(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': once },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          ...(sending ? { tags: [{ name: SENDING_TAG, value: sending }] } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // The cause may quote the request: it stops here.
      throw new Error('PROVIDER_UNREACHABLE');
    }
    if (answer.status === 401 || answer.status === 403) throw new ProviderRefused('PROVIDER_KEY_REFUSED');
    if (answer.status === 429) throw new ProviderRefused('PROVIDER_BUSY');
    // 409: the same key is being used by a request under way: its outcome is not known here.
    if (answer.status >= 400 && answer.status < 500 && answer.status !== 408 && answer.status !== 409) throw new ProviderRefused('PROVIDER_REFUSED');
    if (answer.status < 200 || answer.status >= 300) throw new Error('PROVIDER_FAILED');
    const body = (await answer.json().catch(() => null)) as { id?: unknown } | null;
    // Accepted, whatever it calls it.
    return { ref: typeof body?.id === 'string' && REF.test(body.id) ? body.id : 'unknown' };
  }
}

/** Outside production, a message only leaves for a test address of Resend or one the firm has listed (`DEV_RECIPIENTS`). */
export const allowedOutsideProduction = (to: string, listed: readonly string[]) =>
  to.toLowerCase().endsWith('@resend.dev') || listed.includes(to.toLowerCase());
