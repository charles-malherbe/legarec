import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readResendEvent, signedByResend, TOLERANCE_SECONDS, type Delivery } from './resend-webhook';

// Drawn here: no secret of anyone is ever written in a test.
const secret = `whsec_${randomBytes(24).toString('base64')}`;
const now = new Date('2026-11-27T10:00:00Z');
const seconds = (date: Date) => String(Math.floor(date.getTime() / 1000));
/** Signed as Svix documents it, written apart from the code under test. */
const sign = (key: string, id: string, timestamp: string, body: string) =>
  `v1,${createHmac('sha256', Buffer.from(key.slice('whsec_'.length), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-11-27T09:59:58.000Z', data: { email_id: randomUUID() } });
const delivery = (change: Partial<Delivery> = {}): Delivery => {
  const id = `msg_${randomBytes(9).toString('hex')}`;
  const timestamp = seconds(now);
  return { id, timestamp, signature: sign(secret, id, timestamp, body), ...change };
};
const accepted = (given: Delivery, bytes = body, key = secret, at = now) => signedByResend(key, given, Buffer.from(bytes), at);

describe('the signature of an event of Resend', () => {
  it('is accepted on the bytes that were signed', () => {
    expect(accepted(delivery())).toBe(true);
  });

  it('is refused on another body, were it the same JSON written otherwise', () => {
    expect(accepted(delivery(), body.replace('email.delivered', 'email.bounced'))).toBe(false);
    expect(accepted(delivery(), `${body} `)).toBe(false);
    expect(accepted(delivery(), JSON.stringify(JSON.parse(body), null, 1))).toBe(false);
  });

  it('is refused under another secret, without one, and with one that is not a secret of Resend', () => {
    expect(accepted(delivery(), body, `whsec_${randomBytes(24).toString('base64')}`)).toBe(false);
    for (const key of ['', 'whsec_', secret.slice('whsec_'.length), 'whsec_***']) expect(accepted(delivery(), body, key), key).toBe(false);
  });

  it('is refused when a header is missing, empty or of another event', () => {
    for (const name of ['id', 'timestamp', 'signature'] as const) {
      expect(accepted(delivery({ [name]: undefined })), name).toBe(false);
      expect(accepted(delivery({ [name]: '' })), name).toBe(false);
    }
    // The identifier and the date are signed with the body.
    expect(accepted(delivery({ id: 'msg_another' }))).toBe(false);
    expect(accepted({ ...delivery(), timestamp: seconds(new Date(now.getTime() - 1000)) })).toBe(false);
    expect(accepted(delivery({ id: 'a b' }))).toBe(false);
    expect(accepted(delivery({ timestamp: '1e9' }))).toBe(false);
  });

  it('is refused when it is too old or dated ahead, even well signed', () => {
    const signedAt = (date: Date) => {
      const id = 'msg_dated';
      return { id, timestamp: seconds(date), signature: sign(secret, id, seconds(date), body) };
    };
    const shifted = (by: number) => new Date(now.getTime() + by * 1000);
    expect(accepted(signedAt(shifted(-TOLERANCE_SECONDS + 5)))).toBe(true);
    expect(accepted(signedAt(shifted(TOLERANCE_SECONDS - 5)))).toBe(true);
    expect(accepted(signedAt(shifted(-TOLERANCE_SECONDS - 5)))).toBe(false);
    expect(accepted(signedAt(shifted(TOLERANCE_SECONDS + 5)))).toBe(false);
  });

  it('is accepted among several, while a secret is being renewed, and only in the version that is known', () => {
    const given = delivery();
    const other = sign(`whsec_${randomBytes(24).toString('base64')}`, given.id!, given.timestamp!, body);
    expect(accepted({ ...given, signature: `${other} ${given.signature!}` })).toBe(true);
    expect(accepted({ ...given, signature: `${given.signature!} ${other}` })).toBe(true);
    expect(accepted({ ...given, signature: `${other} ${other}` })).toBe(false);
    expect(accepted({ ...given, signature: given.signature!.replace('v1,', 'v2,') })).toBe(false);
    expect(accepted({ ...given, signature: given.signature!.slice(3) })).toBe(false);
    // A beginning of the signature is not the signature.
    expect(accepted({ ...given, signature: given.signature!.slice(0, 20) })).toBe(false);
    expect(accepted({ ...given, signature: `${given.signature!} `.repeat(40) })).toBe(false);
  });
});

describe('what is read of an event', () => {
  const sending = randomUUID();
  const email = randomUUID();
  const event = (type: string, data: Record<string, unknown> = {}) =>
    readResendEvent(
      Buffer.from(
        JSON.stringify({
          type,
          created_at: '2026-11-22T23:41:12.126Z',
          data: { email_id: email, from: 'Cabinet <relances@exemple.test>', to: ['compta@exemple.test'], subject: 'Relance', tags: { sending_id: sending }, ...data },
        }),
      ),
    );

  it('is its kind, its date, its message and its line: neither an address nor a subject', () => {
    const read = event('email.delivered');
    expect(read).toEqual({ kind: 'DELIVERED', occurredAt: new Date('2026-11-22T23:41:12.126Z'), providerRef: email, sendingId: sending });
    expect(JSON.stringify(read)).not.toMatch(/exemple|Relance|Cabinet/u);
  });

  it.each([
    ['email.sent', 'SENT'],
    ['email.delivery_delayed', 'DELAYED'],
    ['email.complained', 'COMPLAINED'],
    ['email.failed', 'FAILED'],
    ['email.suppressed', 'SUPPRESSED'],
    // Not followed (question 225), or not about a message that has left.
    ['email.opened', 'OTHER'],
    ['email.clicked', 'OTHER'],
    ['email.scheduled', 'OTHER'],
    ['email.received', 'OTHER'],
    ['domain.updated', 'OTHER'],
    ['constructor', 'OTHER'],
  ])('%s is %s', (type, kind) => {
    expect(event(type).kind).toBe(kind);
  });

  it('only takes a bounce said to be permanent for a hard one', () => {
    expect(event('email.bounced', { bounce: { type: 'Permanent', subType: 'General' } }).kind).toBe('BOUNCED');
    for (const bounce of [{ type: 'Transient' }, { type: 'Temporary' }, { type: 'Undetermined' }, {}, undefined, 'Permanent'])
      expect(event('email.bounced', { bounce }).kind, JSON.stringify(bounce)).toBe('BOUNCED_SOFT');
  });

  it('reads the tag as Resend gives it back, and as it was sent', () => {
    expect(event('email.sent', { tags: [{ name: 'category', value: 'x' }, { name: 'sending_id', value: sending }] }).sendingId).toBe(sending);
    for (const tags of [undefined, null, {}, { sending_id: 'compta@exemple.test' }, { sending_id: 12 }, { other: sending }, 'sending_id'])
      expect(event('email.sent', { tags }).sendingId, JSON.stringify(tags)).toBeNull();
    expect(event('email.sent', { email_id: 'compta@exemple.test' }).providerRef).toBeNull();
  });

  it('takes what cannot be read for an event of no interest', () => {
    for (const text of ['', 'null', '[]', '{', '"email.sent"', '{"type":"email.sent","data":7,"created_at":"hier"}', '{"type":["email.sent"]}']) {
      const read = readResendEvent(Buffer.from(text));
      expect(read.providerRef, text).toBeNull();
      expect(read.sendingId, text).toBeNull();
      expect(read.occurredAt, text).toBeNull();
    }
    expect(readResendEvent(Buffer.from('{')).kind).toBe('OTHER');
  });
});
