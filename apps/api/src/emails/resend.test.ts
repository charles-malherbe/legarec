import { describe, expect, it } from 'vitest';
import type { AutomaticMessage } from './emails.service';
import { allowedOutsideProduction, ProviderRefused, ResendClient, type HttpClient } from './resend';

const message: AutomaticMessage = {
  from: 'LEGAREC <ne-pas-repondre@mail.legarec.fr>',
  to: 'compta@resend.dev',
  subject: 'Relance : facture F-2026-0712 impayée',
  html: '<p>Bonjour</p>',
  replyTo: 'recouvrement@legarec.fr',
};
const answering =
  (status: number, body: unknown = { message: `no such address: ${message.to}` }): HttpClient =>
  () =>
    Promise.resolve({ status, json: () => Promise.resolve(body) });
/** What `send` ends with: a reference, a refusal (nothing left), or nothing clear. */
const outcome = (http: HttpClient, timeoutMs?: number) =>
  new ResendClient(http, timeoutMs).send('re_test_key', message, 'sending/1').then(
    ({ ref }) => `sent ${ref}`,
    (error: Error) => `${error instanceof ProviderRefused ? 'refused' : 'unclear'} ${error.message}`,
  );

describe('what Resend answers', () => {
  it.each([
    [401, 'refused PROVIDER_KEY_REFUSED'],
    [403, 'refused PROVIDER_KEY_REFUSED'],
    [429, 'refused PROVIDER_BUSY'],
    [400, 'refused PROVIDER_REFUSED'],
    [404, 'refused PROVIDER_REFUSED'],
    [422, 'refused PROVIDER_REFUSED'],
    // The request may have been taken all the same: nobody knows what has left.
    [408, 'unclear PROVIDER_FAILED'],
    [409, 'unclear PROVIDER_FAILED'],
    [500, 'unclear PROVIDER_FAILED'],
    [502, 'unclear PROVIDER_FAILED'],
    [503, 'unclear PROVIDER_FAILED'],
    // Never followed: neither the key nor the message goes elsewhere.
    [301, 'unclear PROVIDER_FAILED'],
    [302, 'unclear PROVIDER_FAILED'],
    [199, 'unclear PROVIDER_FAILED'],
  ])('%i: %s', async (status, expected) => expect(await outcome(answering(status))).toBe(expected));

  it('accepted: the reference when there is a readable one, « unknown » otherwise', async () => {
    expect(await outcome(answering(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }))).toBe('sent 49a3999c-0ce1-4ea6-ab68-afcd6dc2e794');
    expect(await outcome(answering(202, { id: 'ref_1' }))).toBe('sent ref_1');
    for (const body of [{}, null, { id: 7 }, { id: '' }, { id: 'a b' }, { id: 'x'.repeat(101) }, { id: '<script>' }])
      expect(await outcome(answering(200, body))).toBe('sent unknown');
    // A body that is not JSON.
    expect(await outcome(() => Promise.resolve({ status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token')) }))).toBe('sent unknown');
  });

  it('a cut or a silence says nothing of what has left, and nothing of the request either', async () => {
    expect(await outcome(() => Promise.reject(new Error(`socket hang up while writing to ${message.to}`)))).toBe('unclear PROVIDER_UNREACHABLE');
    // No answer in time: the request is abandoned by its signal.
    const silent: HttpClient = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason as Error)));
    expect(await outcome(silent, 20)).toBe('unclear PROVIDER_UNREACHABLE');
  });

  it('is asked once, with the key in its header only, one recipient and the key that forbids a second sending', async () => {
    const asked: { url: string; init: Parameters<HttpClient>[1] }[] = [];
    const http: HttpClient = (url, init) => (asked.push({ url, init }), Promise.resolve({ status: 200, json: () => Promise.resolve({ id: 'ref' }) }));
    await new ResendClient(http).send('re_test_key', message, 'sending/1');
    expect(asked.length).toBe(1);
    const [{ url, init }] = asked as [(typeof asked)[number]];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: 'Bearer re_test_key', 'content-type': 'application/json', 'idempotency-key': 'sending/1' });
    expect(JSON.parse(init.body)).toEqual({ from: message.from, to: [message.to], subject: message.subject, html: message.html, reply_to: message.replyTo });
    expect(init.body).not.toContain('re_test_key');
  });

  it('names the line the message leaves for in a tag, and nothing else', async () => {
    const bodies: string[] = [];
    const http: HttpClient = (_url, init) => (bodies.push(init.body), Promise.resolve({ status: 200, json: () => Promise.resolve({ id: 'ref' }) }));
    await new ResendClient(http).send('re_test_key', message, 'sending/1', '0193a4c7-8f1e-7c3a-9b2d-5e6f7a8b9c0d');
    expect((JSON.parse(bodies[0]!) as { tags: unknown }).tags).toEqual([{ name: 'sending_id', value: '0193a4c7-8f1e-7c3a-9b2d-5e6f7a8b9c0d' }]);
  });
});

describe('outside production', () => {
  it('a message only leaves for a test address of Resend or one the firm has listed', () => {
    const listed = ['recette@legarec.test'];
    for (const to of ['delivered@resend.dev', 'Delivered@Resend.DEV', 'bounced+label@resend.dev', 'recette@legarec.test', 'Recette@LEGAREC.test'])
      expect(allowedOutsideProduction(to, listed), to).toBe(true);
    // Neither a sub-domain, nor a look-alike, nor an address that only holds one.
    for (const to of [
      'compta@x.resend.dev',
      'compta@resend.dev.example',
      'compta@notresend.dev',
      'compta@resend.dev@entreprise.example',
      'recette@legarec.test.example',
      'autre@legarec.test',
      'compta@entreprise.example',
      '',
    ])
      expect(allowedOutsideProduction(to, listed), to).toBe(false);
    expect(allowedOutsideProduction('recette@legarec.test', [])).toBe(false);
  });
});
