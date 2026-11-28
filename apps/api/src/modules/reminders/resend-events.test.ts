import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import { firmGroups, HOOK_MAX_BYTES, publicHolidays } from '@legarec/contracts';
import { TOLERANCE_SECONDS } from '../../emails/resend-webhook';
import { Clock } from '../../platform/clock';
import type { Actor } from '../../platform/database/actor';
import { databaseCode } from '../../platform/database/codes';
import type { Transaction } from '../../platform/database/database';
import { ApiError } from '../../platform/errors/api-error';
import { PLACEHOLDER } from '../../platform/pdf/pdf';
import { RateLimits } from '../../platform/limits/rate-limits';
import { createLogger } from '../../platform/logging/logger';
import { Vault } from '../vault/vault';
import { applyResendEvent } from './resend-events.jobs';
import { markFailed } from './sendings.jobs';

let test: TestApp;
let worker: MailWorker;
let reference = 70_000;
let siren = 562_100_000;
// Drawn here: no secret of anyone is ever written in a test.
const secret = `whsec_${randomBytes(24).toString('base64')}`;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const as = <T>(actor: Actor, work: (tx: Transaction) => Promise<T>) =>
  test.pool.run(actor, work).catch((error: unknown) => databaseCode(error) ?? String(error));
const officer = (): Actor => ({ kind: 'staff', userId: test.s.officerA, role: 'CLAIMS_OFFICER', delegations: [] });

interface Made {
  id: string;
  contact: string;
  email: string;
}
/** A company with a first letter and an address to write to, held by the first officer. */
const eligible = async (): Promise<Made> => {
  const email = `compta-${randomUUID().slice(0, 8)}@resend.dev`;
  const [creditor] = await rows<{ id: string }>('INSERT INTO creditors (name) VALUES ($1) RETURNING id', [`Créancier ${(reference += 1)}`]);
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name, siren) VALUES ('COMPANY', $1, $2) RETURNING id", [
    `Débiteur ${reference}`,
    String((siren += 1)),
  ]);
  const [made] = await rows<{ id: string }>(
    `INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status, first_letter_reference, first_letter_on)
     VALUES ($1, $2, $3, $4, 'REMINDER', $5, '2026-09-15') RETURNING id`,
    [`LGR-2026-${reference}`, creditor!.id, debtor!.id, test.s.officerA, `LR-2026-${String(reference).slice(-4)}`],
  );
  const [contact] = await rows<{ id: string }>(
    "INSERT INTO case_contacts (case_id, creditor_id, kind, label, value, value_normalized, source, status, is_primary) VALUES ($1, $2, 'EMAIL', 'Comptabilité', $3, $3, 'CREDITOR', 'VERIFIED', true) RETURNING id",
    [made!.id, creditor!.id, email],
  );
  return { id: made!.id, contact: contact!.id, email };
};
/** Everything of the firm that is still between brackets: the reminders wait for it. */
const fillFirm = async () => {
  const fields = firmGroups()
    .flatMap((group) => group.items)
    .find((item) => item.id === 'cabinet')!
    .blocks.flatMap((block) => block.fields);
  const samples: Record<string, string> = { siren: '732829007', iban: 'FR7630001007941234567890185', bic: 'BDFEFRPP' };
  for (const field of fields.filter((item) => PLACEHOLDER.test(item.value ?? '')))
    await rows('INSERT INTO settings (key, value, updated_by) VALUES ($1, to_jsonb($2::text), $3) ON CONFLICT DO NOTHING', [
      `firm.cabinet.${field.id}`,
      samples[field.id] ?? 'Valeur du cabinet',
      test.s.director,
    ]);
};
/** Half past ten in Paris, on a working day of this week. */
const workingHour = () => {
  const noon = Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const monday = noon - ((new Date(noon).getUTCDay() + 6) % 7) * 86_400_000;
  for (let index = 0; index < 6; index += 1) {
    const iso = new Date(monday + index * 86_400_000).toISOString().slice(0, 10);
    if (!publicHolidays(Number(iso.slice(0, 4))).has(iso)) return new Date(`${iso}T09:30:00Z`);
  }
  throw new Error('no working day this week');
};
type State = 'QUEUED' | 'UNCERTAIN' | 'SENT' | 'FAILED' | 'REPORTED' | 'EXPIRED' | 'SIMULATED';
/** The template of each level of the validated e-mail reminders. */
const TEMPLATES = { 1: 'FRIENDLY', 2: 'FIRM', 3: 'FORMAL_NOTICE' } as const;
/**
 * A reminder of the case in that state, asked `minutes` ago; `ref`: the message at the provider, for a line that was sent.
 * `FAILED`: taken, then refused by Resend at the call (no message there); `REPORTED`: taken, then said failed by Resend
 * itself (`email.failed`); `EXPIRED`: failed before it was ever taken. `level`: 1 unless said.
 */
const line = async (
  made: Made,
  state: State,
  { ref = randomUUID(), minutes = 10, level = 1 }: { ref?: string; minutes?: number; level?: keyof typeof TEMPLATES } = {},
) => {
  const [{ id }] = (await rows<{ id: string }>(
    `INSERT INTO sendings (case_id, creditor_id, channel, template, level, contact_id, created_by, created_at)
     SELECT c.id, c.creditor_id, 'EMAIL', $5::text, $6::int, $2, $3, now() - $4::float8 * interval '1 minute' FROM cases c WHERE c.id = $1 RETURNING id`,
    [made.id, made.contact, test.s.officerA, minutes, TEMPLATES[level], level],
  )) as [{ id: string }];
  if (state === 'EXPIRED') await rows("UPDATE sendings SET status = 'FAILED', failure = 'EXPIRED' WHERE id = $1", [id]);
  else if (state !== 'QUEUED') await rows("UPDATE sendings SET status = 'UNCERTAIN' WHERE id = $1", [id]);
  if (state === 'SENT')
    await rows("UPDATE sendings SET status = 'SENT', sent_at = created_at + interval '1 second', provider_ref = $2 WHERE id = $1", [id, ref]);
  if (state === 'SIMULATED') await rows("UPDATE sendings SET status = 'SENT', sent_at = created_at, simulated = true WHERE id = $1", [id]);
  if (state === 'FAILED') await rows("UPDATE sendings SET status = 'FAILED', failure = 'PROVIDER_REFUSED' WHERE id = $1", [id]);
  if (state === 'REPORTED')
    await rows(
      "UPDATE sendings SET status = 'FAILED', failure = 'PROVIDER_FAILED', undelivered_at = created_at + interval '1 second', undelivered_reason = 'PROVIDER_FAILED' WHERE id = $1",
      [id],
    );
  return { id, ref };
};
interface Sending {
  status: string;
  provider_ref: string | null;
  failure: string | null;
  sent_at: Date | null;
  confirmed_at: Date | null;
  delivered_at: Date | null;
  undelivered_at: Date | null;
  undelivered_reason: string | null;
  complained_at: Date | null;
}
const sending = async (id: string) =>
  (
    await rows<Sending>(
      'SELECT status, provider_ref, failure, sent_at, confirmed_at, delivered_at, undelivered_at, undelivered_reason, complained_at FROM sendings WHERE id = $1',
      [id],
    )
  )[0]!;
const contactOf = async (made: Made) =>
  (await rows<{ status: string; is_primary: boolean }>('SELECT status, is_primary FROM case_contacts WHERE id = $1', [made.contact]))[0]!;
const history = async (made: Made) =>
  (await rows<{ title: string }>('SELECT title FROM case_events WHERE case_id = $1 ORDER BY occurred_at, id', [made.id])).map((row) => row.title);

interface Sent {
  type: string;
  /** The line named by the tag of the message. */
  sending?: string | undefined;
  /** The message at Resend. */
  ref?: string | undefined;
  /** Seconds ago. */
  ago?: number;
  data?: Record<string, unknown>;
}
/** The body of an event, as Resend writes it: with the address and the subject, which must go nowhere. */
const bodyOf = ({ type, sending: tag, ref, ago = 5, data = {} }: Sent, to = 'compta@exemple.test') =>
  JSON.stringify({
    type,
    created_at: new Date(Date.now() - ago * 1000).toISOString(),
    data: {
      email_id: ref ?? randomUUID(),
      from: 'Cabinet Exemple <relances@exemple.test>',
      to: [to],
      subject: 'Relance de la facture F-2026-0712',
      tags: tag ? { sending_id: tag } : {},
      ...data,
    },
  });
const signature = (key: string, id: string, timestamp: string, body: string) =>
  `v1,${createHmac('sha256', Buffer.from(key.slice('whsec_'.length), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')}`;
const stamp = (ago = 0) => String(Math.floor(Date.now() / 1000) - ago);
/** Posted as Resend does; `change` spoils the delivery after it was signed. */
const post = (body: string, change: { id?: string; headers?: Record<string, string | undefined>; sent?: string; key?: string; ago?: number } = {}) => {
  const id = change.id ?? `msg_${randomBytes(12).toString('hex')}`;
  const timestamp = stamp(change.ago);
  const headers: Record<string, string | undefined> = {
    'content-type': 'application/json',
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': signature(change.key ?? secret, id, timestamp, body),
    ...change.headers,
  };
  return test.call('POST', '/hooks/resend', {
    file: Buffer.from(change.sent ?? body),
    headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) as Record<string, string>,
  });
};
/** An event of Resend, received then handled by the worker. */
const happen = async (event: Sent) => {
  expect((await post(bodyOf(event))).status).toBe(204);
  await worker.run();
};
const stored = () =>
  rows<{ status: string; kind: string | null }>("SELECT status, kind FROM webhook_events WHERE provider = 'RESEND' ORDER BY received_at, id");
const storeSecret = async (value: string, status = 'VALID') => {
  const id = randomUUID();
  await rows("INSERT INTO vault_secrets (id, name, value_cipher, status) VALUES ($1, 'RESEND_WEBHOOK_SECRET', $2, $3::secret_status)", [
    id,
    new Vault(test.config).seal(id, value),
    status,
  ]);
  return id;
};

beforeAll(async () => {
  test = await startApp();
  worker = startMailWorker(test);
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rows("DELETE FROM webhook_events WHERE provider = 'RESEND'");
});

describe('an event of Resend', () => {
  it('is refused as long as the vault holds no valid secret, however well it is signed', async () => {
    expect(await post(bodyOf({ type: 'email.sent' }))).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } });
    // A secret being revoked signs nothing.
    const revoked = await storeSecret(secret, 'REVOKE_PENDING');
    expect(await post(bodyOf({ type: 'email.sent' }))).toMatchObject({ status: 401, body: { code: 'UNAUTHORIZED' } });
    await rows('DELETE FROM vault_secrets WHERE id = $1', [revoked]);
    expect(await stored()).toEqual([]);
    await storeSecret(secret);
  });

  it('is refused with the same answer whatever is wrong with its signature, and nothing is written', async () => {
    const made = await eligible();
    const { id } = await line(made, 'UNCERTAIN');
    const body = bodyOf({ type: 'email.delivered', sending: id });
    const refusals = [
      await post(body, { sent: body.replace('email.delivered', 'email.bounced') }),
      await post(body, { sent: `${body}\n` }),
      await post(body, { key: `whsec_${randomBytes(24).toString('base64')}` }),
      await post(body, { ago: TOLERANCE_SECONDS + 60 }),
      await post(body, { ago: -TOLERANCE_SECONDS - 60 }),
      await post(body, { headers: { 'svix-signature': undefined } }),
      await post(body, { headers: { 'svix-timestamp': undefined } }),
      await post(body, { headers: { 'svix-id': undefined } }),
      await post(body, { headers: { 'svix-id': 'msg_another' } }),
      await post(body, { headers: { 'svix-timestamp': stamp(30) } }),
      await post(body, { headers: { 'svix-signature': 'v1,' } }),
      await post(body, { sent: '' }),
      // Without any header at all, as a passer-by would.
      await test.call('POST', '/hooks/resend', { body: JSON.parse(body) as unknown }),
      await test.call('POST', '/hooks/resend'),
    ];
    for (const [index, refusal] of refusals.entries()) {
      expect(refusal.status, String(index)).toBe(401);
      expect(refusal.body, String(index)).toEqual({ code: 'UNAUTHORIZED' });
    }
    await worker.run();
    expect(await stored()).toEqual([]);
    expect(await sending(id)).toMatchObject({ status: 'UNCERTAIN', confirmed_at: null });
    expect(await rows("SELECT 1 FROM outbox WHERE name = 'resend-event'")).toEqual([]);
  });

  it('is counted before its signature is looked at, and bounded in size', async () => {
    const take = vi.spyOn(test.app.get(RateLimits), 'take');
    expect((await post(bodyOf({ type: 'email.sent' }), { key: `whsec_${randomBytes(24).toString('base64')}` })).status).toBe(401);
    expect(take).toHaveBeenCalledWith(expect.objectContaining({ name: 'hook-resend' }));
    take.mockRejectedValueOnce(new ApiError(429, 'TOO_MANY'));
    expect(await post(bodyOf({ type: 'email.sent' }))).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
    // Well signed, and far too large: stopped before it is read.
    const large = bodyOf({ type: 'email.sent', data: { padding: 'x'.repeat(HOOK_MAX_BYTES) } });
    expect((await post(large)).status).toBe(413);
    expect(await stored()).toEqual([]);
  });

  it('is written once with identifiers and dates only, then handled once, however many times it is delivered', async () => {
    const made = await eligible();
    const { id } = await line(made, 'UNCERTAIN');
    const ref = randomUUID();
    const body = bodyOf({ type: 'email.delivered', sending: id, ref }, made.email);
    const delivery = `msg_${randomBytes(12).toString('hex')}`;
    expect((await post(body, { id: delivery })).status).toBe(204);
    expect((await post(body, { id: delivery })).status).toBe(204);
    const kept = await rows("SELECT * FROM webhook_events WHERE provider = 'RESEND'");
    expect(kept).toMatchObject([{ provider_event_id: delivery, status: 'RECEIVED', kind: 'DELIVERED', provider_ref: ref, sending_id: id, processed_at: null }]);
    const tasks = await rows<{ payload: unknown; actor_kind: string }>("SELECT payload, actor_kind FROM outbox WHERE name = 'resend-event'");
    expect(tasks).toEqual([{ payload: { event: (kept[0] as { id: string }).id }, actor_kind: 'HOOK' }]);
    await worker.run();
    // Sent again by Resend after it was handled: still once.
    expect((await post(body, { id: delivery })).status).toBe(204);
    await worker.run();
    expect(await stored()).toEqual([{ status: 'PROCESSED', kind: 'DELIVERED' }]);
    // Its task delivered again by the queue: the event is found handled, and stays so.
    await rows("UPDATE outbox SET done_at = NULL, published_at = NULL, started_at = NULL, claimed_at = NULL WHERE name = 'resend-event'");
    await worker.run();
    expect(await stored()).toEqual([{ status: 'PROCESSED', kind: 'DELIVERED' }]);
    expect(await history(made)).toEqual(['Relance envoyée', 'Relance distribuée']);
    // Neither the address nor the subject, anywhere: tables, tasks, history, logs.
    const written = JSON.stringify([
      await rows('SELECT * FROM webhook_events'),
      await rows("SELECT * FROM outbox WHERE name = 'resend-event'"),
      await rows('SELECT * FROM case_events WHERE case_id = $1', [made.id]),
      await rows('SELECT * FROM sendings WHERE id = $1', [id]),
      test.logs,
    ]);
    for (const word of [made.email, 'exemple.test', 'F-2026-0712', 'Cabinet Exemple', secret]) expect(written).not.toContain(word);
  });

  it('that the firm does not follow, or that names no message, is kept for the count and nothing is done', async () => {
    const made = await eligible();
    const { id, ref } = await line(made, 'SENT');
    for (const type of ['email.opened', 'email.clicked', 'domain.updated']) expect((await post(bodyOf({ type, sending: id, ref }))).status).toBe(204);
    expect((await post('not json')).status).toBe(204);
    expect((await post(bodyOf({ type: 'email.delivered', data: { email_id: 'none' } }))).status).toBe(204);
    expect(await stored()).toEqual([
      { status: 'IGNORED', kind: 'OTHER' },
      { status: 'IGNORED', kind: 'OTHER' },
      { status: 'IGNORED', kind: 'OTHER' },
      { status: 'IGNORED', kind: 'OTHER' },
      { status: 'IGNORED', kind: 'DELIVERED' },
    ]);
    // Neither the date of an open or a click, nor the reminder it names (question 225).
    expect(await rows("SELECT occurred_at, provider_ref, sending_id FROM webhook_events WHERE provider = 'RESEND'")).toEqual(
      Array.from({ length: 5 }, () => ({ occurred_at: null, provider_ref: null, sending_id: null })),
    );
    expect(await rows("SELECT 1 FROM outbox WHERE name = 'resend-event' AND done_at IS NULL")).toEqual([]);
    expect(await sending(id)).toMatchObject({ confirmed_at: null, delivered_at: null });
    expect(await history(made)).toEqual([]);
  });

  it('about a line of another environment, a simulated one, one not taken yet or another message changes nothing', async () => {
    const made = await eligible();
    const queued = await line(made, 'QUEUED');
    const simulated = await line(made, 'SIMULATED');
    const sent = await line(made, 'SENT');
    const expired = await line(made, 'EXPIRED');
    const refused = await line(made, 'FAILED');
    const from = test.logs.length;
    await happen({ type: 'email.delivered', sending: randomUUID() });
    await happen({ type: 'email.delivered', ref: randomUUID() });
    await happen({ type: 'email.delivered', sending: queued.id });
    // Failed before it was taken: nothing of it ever left, whatever message names it (a copy of this database elsewhere).
    await happen({ type: 'email.delivered', sending: expired.id });
    await happen({ type: 'email.bounced', sending: expired.id, data: { bounce: { type: 'Permanent' } } });
    // Refused by Resend at the call: it never had a message of it.
    await happen({ type: 'email.delivered', sending: refused.id });
    await happen({ type: 'email.complained', sending: refused.id });
    await happen({ type: 'email.bounced', sending: simulated.id, data: { bounce: { type: 'Permanent' } } });
    // The line is named, but the message is not the one that left for it.
    await happen({ type: 'email.bounced', sending: sent.id, ref: randomUUID(), data: { bounce: { type: 'Permanent' } } });
    // A name unknown here is never looked for by its message: it belongs to another environment.
    await happen({ type: 'email.delivered', sending: randomUUID(), ref: sent.ref });
    expect((await stored()).map((row) => row.status)).toEqual(Array.from({ length: 10 }, () => 'IGNORED'));
    // Each one that names a line of ours, and yet another message, is said in the logs, without a name.
    const said = test.logs.slice(from).filter((text) => text.includes('resend event about another message'));
    expect(said).toHaveLength(7);
    for (const text of said) for (const id of [queued.id, simulated.id, sent.id, expired.id, refused.id]) expect(text).not.toContain(id);
    expect(await sending(queued.id)).toMatchObject({ status: 'QUEUED', confirmed_at: null });
    expect(await sending(expired.id)).toMatchObject({ status: 'FAILED', failure: 'EXPIRED', confirmed_at: null, delivered_at: null, undelivered_at: null });
    expect(await sending(sent.id)).toMatchObject({ status: 'SENT', confirmed_at: null, delivered_at: null, undelivered_at: null });
    expect(await sending(refused.id)).toMatchObject({ status: 'FAILED', failure: 'PROVIDER_REFUSED', confirmed_at: null, complained_at: null });
    expect(await contactOf(made)).toEqual({ status: 'VERIFIED', is_primary: true });
    expect(await history(made)).toEqual([]);
  });

  it('is taken up to 64 Ko exactly, and refused one byte beyond, before it is read', async () => {
    const made = await eligible();
    const { id, ref } = await line(made, 'SENT');
    /** A delivery of the line, well signed, of exactly that many bytes. */
    const sized = (bytes: number) => {
      const bare = Buffer.byteLength(bodyOf({ type: 'email.delivered', sending: id, ref, data: { padding: '' } }));
      return bodyOf({ type: 'email.delivered', sending: id, ref, data: { padding: 'x'.repeat(bytes - bare) } });
    };
    const exact = sized(HOOK_MAX_BYTES);
    expect(Buffer.byteLength(exact)).toBe(HOOK_MAX_BYTES);
    expect(await post(sized(HOOK_MAX_BYTES + 1))).toMatchObject({ status: 413, body: { code: 'TOO_LARGE' } });
    expect(await stored()).toEqual([]);
    expect((await post(exact)).status).toBe(204);
    await worker.run();
    expect(await stored()).toEqual([{ status: 'PROCESSED', kind: 'DELIVERED' }]);
    expect((await sending(id)).delivered_at).not.toBeNull();
  });

  it('is read on its bytes, whatever type it announces', async () => {
    const made = await eligible();
    const { id, ref } = await line(made, 'SENT');
    for (const type of ['text/plain', 'application/json; charset=utf-8', 'application/x-www-form-urlencoded', undefined])
      expect((await post(bodyOf({ type: 'email.delivery_delayed', sending: id, ref }), { headers: { 'content-type': type } })).status, String(type)).toBe(204);
    expect((await stored()).map((row) => row.kind)).toEqual(['DELAYED', 'DELAYED', 'DELAYED', 'DELAYED']);
    await worker.run();
    expect((await sending(id)).confirmed_at).not.toBeNull();
  });

  it('refused, is logged as « webhook refused » and nothing more, the same whatever is wrong, a secret the vault cannot open included', async () => {
    const body = bodyOf({ type: 'email.delivered', sending: randomUUID() });
    const delivery = `msg_${randomBytes(12).toString('hex')}`;
    /** What the API logged of one refused request, without what changes from one request to the next. */
    const logged = async (request: () => Promise<{ status: number }>) => {
      const from = test.logs.length;
      expect((await request()).status).toBe(401);
      // The line of the request is written once its answer has gone.
      await vi.waitFor(() => expect(test.logs.slice(from).some((text) => text.includes('"msg":"request"'))).toBe(true));
      const lines = test.logs.slice(from);
      for (const word of [delivery, secret.slice('whsec_'.length), 'exemple.test', 'F-2026-0712', 'svix', 'v1,'])
        expect(lines.join(''), word).not.toContain(word);
      return lines
        .map((text) => JSON.parse(text) as Record<string, unknown>)
        .filter((entry) => entry.queue === undefined)
        .map(({ time: _time, requestId: _request, ms: _ms, ...entry }) => entry);
    };
    const refusals = [
      await logged(() => post(body, { id: delivery, sent: `${body} ` })),
      await logged(() => post(body, { id: delivery, key: `whsec_${randomBytes(24).toString('base64')}` })),
      await logged(() => post(body, { id: delivery, ago: TOLERANCE_SECONDS + 60 })),
      await logged(() => post(body, { id: delivery, headers: { 'svix-signature': undefined } })),
      await logged(() => test.call('POST', '/hooks/resend')),
    ];
    // Sealed under another master key, as after a change of it that forgot the previous one: as if there were no secret.
    const [kept] = await rows<{ id: string; value_cipher: Buffer }>(
      "SELECT id, value_cipher FROM vault_secrets WHERE name = 'RESEND_WEBHOOK_SECRET' AND status = 'VALID'",
    );
    const other = new Vault({ VAULT_MASTER_KEY: randomBytes(32).toString('base64') });
    await rows('UPDATE vault_secrets SET value_cipher = $2 WHERE id = $1', [kept!.id, other.seal(kept!.id, secret)]);
    try {
      refusals.push(await logged(() => post(body, { id: delivery })));
    } finally {
      await rows('UPDATE vault_secrets SET value_cipher = $2 WHERE id = $1', [kept!.id, kept!.value_cipher]);
    }
    expect(refusals[0]).toEqual([
      { level: 40, kind: 'resend', msg: 'webhook refused' },
      { level: 30, method: 'POST', route: '/hooks/resend', status: 401, actor: 'hook', msg: 'request' },
    ]);
    for (const [index, refusal] of refusals.entries()) expect(refusal, String(index)).toEqual(refusals[0]);
    expect(await stored()).toEqual([]);
    // The secret opened again, the same delivery is taken: nothing of the refusals was kept.
    expect((await post(body, { id: delivery })).status).toBe(204);
    await worker.run();
    expect(await stored()).toEqual([{ status: 'IGNORED', kind: 'DELIVERED' }]);
  });
});

describe('a line whose fate was unknown', () => {
  it('is settled as sent, on the date of the event, by the first event that proves the message has left', async () => {
    const made = await eligible();
    const { id } = await line(made, 'UNCERTAIN');
    const ref = randomUUID();
    await happen({ type: 'email.sent', sending: id, ref, ago: 120 });
    const settled = await sending(id);
    expect(settled).toMatchObject({ status: 'SENT', provider_ref: ref, failure: null, delivered_at: null });
    expect(Math.abs(Date.now() - 120_000 - settled.sent_at!.getTime())).toBeLessThan(5000);
    expect(settled.confirmed_at).toEqual(settled.sent_at);
    expect(await history(made)).toEqual(['Relance envoyée']);
    expect(await rows('SELECT actor_label, detail FROM case_events WHERE case_id = $1', [made.id])).toEqual([
      { actor_label: 'Application', detail: 'E-mail · niveau 1' },
    ]);
  });

  it('is settled once when the events come in disorder, and keeps the date it was settled on', async () => {
    const made = await eligible();
    const { id } = await line(made, 'UNCERTAIN');
    const ref = randomUUID();
    await happen({ type: 'email.delivered', sending: id, ref, ago: 30 });
    const first = await sending(id);
    expect(first).toMatchObject({ status: 'SENT', provider_ref: ref });
    expect(first.delivered_at).toEqual(first.sent_at);
    // The older event comes last.
    await happen({ type: 'email.sent', sending: id, ref, ago: 60 });
    await happen({ type: 'email.delivered', sending: id, ref, ago: 10 });
    expect(await sending(id)).toEqual(first);
    expect(await history(made)).toEqual(['Relance envoyée', 'Relance distribuée']);
    expect((await stored()).map((row) => row.status)).toEqual(['PROCESSED', 'IGNORED', 'IGNORED']);
  });

  it('never dates a sending before its request nor ahead of the clock', async () => {
    const made = await eligible();
    const early = await line(made, 'UNCERTAIN', { minutes: 10 });
    await happen({ type: 'email.sent', sending: early.id, ago: 3600 });
    const [{ created_at: asked }] = (await rows<{ created_at: Date }>('SELECT created_at FROM sendings WHERE id = $1', [early.id])) as [{ created_at: Date }];
    expect((await sending(early.id)).sent_at).toEqual(asked);
    const late = await line(made, 'UNCERTAIN');
    await happen({ type: 'email.sent', sending: late.id, ago: -3600 });
    expect((await sending(late.id)).sent_at!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('fails when Resend says that nothing has left, and the colleague is told', async () => {
    const made = await eligible();
    const { id } = await line(made, 'UNCERTAIN');
    await happen({ type: 'email.failed', sending: id, data: { failed: { reason: 'reached_daily_quota' } } });
    expect(await sending(id)).toMatchObject({
      status: 'FAILED',
      failure: 'PROVIDER_FAILED',
      sent_at: null,
      confirmed_at: null,
      undelivered_reason: 'PROVIDER_FAILED',
    });
    expect(await history(made)).toEqual(['Relance non envoyée']);
    expect(await rows('SELECT kind::text FROM notifications WHERE sending_id = $1', [id])).toEqual([{ kind: 'SENDING_FAILED' }]);
    expect(await contactOf(made)).toMatchObject({ status: 'VERIFIED' });
  });

  it('fails when Resend has suppressed the address, which is marked as wrong; the colleague is told once, even when it has left after all', async () => {
    // Five notices an hour are named to a colleague: those of the tests before do not count here.
    await rows("DELETE FROM notifications WHERE kind = 'SENDING_FAILED'");
    const made = await eligible();
    const { id } = await line(made, 'UNCERTAIN');
    const ref = randomUUID();
    await happen({ type: 'email.suppressed', sending: id, ref, ago: 40, data: { suppressed: { type: 'OnAccountSuppressionList' } } });
    expect(await sending(id)).toMatchObject({
      status: 'FAILED',
      failure: 'PROVIDER_SUPPRESSED',
      sent_at: null,
      provider_ref: null,
      confirmed_at: null,
      undelivered_reason: 'SUPPRESSED',
    });
    expect(await contactOf(made)).toEqual({ status: 'INVALID', is_primary: false });
    expect(await rows('SELECT title, detail FROM case_events WHERE case_id = $1 ORDER BY occurred_at, id', [made.id])).toEqual([
      { title: 'Relance non envoyée', detail: null },
      { title: 'Adresse e-mail marquée invalide', detail: 'Adresse écartée par Resend' },
    ]);
    const notices = () => rows<{ sending_id: string | null }>("SELECT sending_id FROM notifications WHERE kind = 'SENDING_FAILED'");
    expect(await notices()).toEqual([{ sending_id: id }]);
    // Said again, then proved to have left (question 223): the line keeps its failure, and nobody is told a second time.
    await happen({ type: 'email.suppressed', sending: id, ref, ago: 30 });
    await happen({ type: 'email.failed', sending: id, ref, ago: 20 });
    await happen({ type: 'email.delivered', sending: id, ref, ago: 10 });
    const after = await sending(id);
    expect(after).toMatchObject({ status: 'FAILED', failure: 'PROVIDER_SUPPRESSED', sent_at: null, undelivered_reason: 'SUPPRESSED' });
    expect(after.delivered_at).toEqual(after.confirmed_at);
    expect(after.confirmed_at).not.toBeNull();
    expect(await history(made)).toEqual([
      'Relance non envoyée',
      'Adresse e-mail marquée invalide',
      'Relance partie malgré un échec signalé',
      'Relance distribuée',
    ]);
    expect(await notices()).toEqual([{ sending_id: id }]);
    expect((await stored()).map((row) => row.status)).toEqual(['PROCESSED', 'IGNORED', 'IGNORED', 'PROCESSED']);
    expect(await rows('SELECT what FROM case_contact_events WHERE contact_id = $1', [made.contact])).toEqual([{ what: 'INVALIDATED' }]);
  });

  it('is settled once when two events are handled at the same moment', async () => {
    const made = await eligible();
    const { id } = await line(made, 'UNCERTAIN');
    const ref = randomUUID();
    const logger = createLogger('silent');
    const event = (kind: 'SENT' | 'DELIVERED') => ({ kind, occurred_at: new Date(Date.now() - 5000), provider_ref: ref, sending_id: id });
    const done = await Promise.all(
      (['SENT', 'DELIVERED', 'SENT', 'DELIVERED'] as const).map((kind) => worker.asWorker((tx) => applyResendEvent(tx, event(kind), logger, new Date()))),
    );
    // The one that settles the line, and the delivery when it is not the same.
    expect([1, 2]).toContain(done.filter(Boolean).length);
    expect(await sending(id)).toMatchObject({ status: 'SENT', provider_ref: ref });
    expect((await history(made)).sort()).toEqual(['Relance distribuée', 'Relance envoyée']);
  });
});

describe('a line that was sent', () => {
  it('is found by its message when the event names no line, and learns that it was delivered', async () => {
    const made = await eligible();
    const { id, ref } = await line(made, 'SENT');
    const before = await sending(id);
    await happen({ type: 'email.delivered', ref, ago: 20 });
    const after = await sending(id);
    expect(after).toMatchObject({ status: 'SENT', sent_at: before.sent_at, provider_ref: ref, undelivered_at: null, complained_at: null });
    expect(Math.abs(Date.now() - 20_000 - after.delivered_at!.getTime())).toBeLessThan(5000);
    expect(await history(made)).toEqual(['Relance distribuée']);
    expect(await contactOf(made)).toEqual({ status: 'VERIFIED', is_primary: true });
  });

  it('that bounces for good has its address marked as wrong: nothing more leaves for it', async () => {
    const made = await eligible();
    const { id, ref } = await line(made, 'SENT');
    await happen({ type: 'email.bounced', sending: id, ref, data: { bounce: { type: 'Permanent', subType: 'General', message: 'mailbox unavailable' } } });
    expect(await sending(id)).toMatchObject({ status: 'SENT', undelivered_reason: 'HARD_BOUNCE', delivered_at: null });
    expect(await contactOf(made)).toEqual({ status: 'INVALID', is_primary: false });
    expect(await rows('SELECT what, actor_label, actor_id FROM case_contact_events WHERE contact_id = $1', [made.contact])).toEqual([
      { what: 'INVALIDATED', actor_label: 'Application', actor_id: null },
    ]);
    expect(await rows('SELECT title, detail, tone::text FROM case_events WHERE case_id = $1 ORDER BY occurred_at, id', [made.id])).toEqual([
      { title: 'Relance non distribuée', detail: 'E-mail · niveau 1 · adresse rejetée', tone: 'danger' },
      { title: 'Adresse e-mail marquée invalide', detail: 'Rebond Resend', tone: 'warning' },
    ]);
    expect(await rows("SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'CONTACT_CHANGED'", [made.id])).toHaveLength(1);
    // The same bounce again, by another delivery: nothing twice.
    await happen({ type: 'email.bounced', sending: id, ref, data: { bounce: { type: 'Permanent' } } });
    expect(await history(made)).toHaveLength(2);
    const asked = await test.call('POST', `/staff/cases/${made.id}/reminders`, {
      as: 'officerA',
      body: { channel: 'EMAIL', template: 'FIRM', recipient: made.email },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(asked).toMatchObject({ status: 409 });
    expect((asked.body as { code: string }).code).not.toBe('REMINDER_PENDING');
    expect(await rows("SELECT 1 FROM sendings WHERE case_id = $1 AND status = 'QUEUED'", [made.id])).toEqual([]);
  });

  it('that bounces for a time keeps its address', async () => {
    const made = await eligible();
    const { id, ref } = await line(made, 'SENT');
    await happen({ type: 'email.bounced', sending: id, ref, data: { bounce: { type: 'Transient', subType: 'MailboxFull' } } });
    expect(await sending(id)).toMatchObject({ undelivered_reason: 'BOUNCE' });
    expect(await contactOf(made)).toEqual({ status: 'VERIFIED', is_primary: true });
    expect(await history(made)).toEqual(['Relance non distribuée']);
    await happen({ type: 'email.delivery_delayed', sending: id, ref });
    expect(await history(made)).toEqual(['Relance non distribuée']);
  });

  it('that bounced for a time, then for good, takes the worse reason once and has its address marked as wrong', async () => {
    const made = await eligible();
    const { id, ref } = await line(made, 'SENT');
    await happen({ type: 'email.bounced', sending: id, ref, ago: 60, data: { bounce: { type: 'Transient' } } });
    const soft = await sending(id);
    expect(soft).toMatchObject({ undelivered_reason: 'BOUNCE' });
    expect(await contactOf(made)).toEqual({ status: 'VERIFIED', is_primary: true });
    await happen({ type: 'email.bounced', sending: id, ref, ago: 10, data: { bounce: { type: 'Permanent' } } });
    // The reason alone has changed: the date of the first bounce, and everything else, stay.
    expect(await sending(id)).toEqual({ ...soft, undelivered_reason: 'HARD_BOUNCE' });
    expect(await contactOf(made)).toEqual({ status: 'INVALID', is_primary: false });
    expect(await rows('SELECT title, detail FROM case_events WHERE case_id = $1 ORDER BY occurred_at, id', [made.id])).toEqual([
      { title: 'Relance non distribuée', detail: 'E-mail · niveau 1 · rejet temporaire' },
      { title: 'Adresse e-mail marquée invalide', detail: 'Rebond Resend' },
    ]);
    // Never back, nor from one final reason to the other.
    await happen({ type: 'email.bounced', sending: id, ref, data: { bounce: { type: 'Transient' } } });
    await happen({ type: 'email.suppressed', sending: id, ref });
    await happen({ type: 'email.failed', sending: id, ref });
    expect(await sending(id)).toEqual({ ...soft, undelivered_reason: 'HARD_BOUNCE' });
    expect(await history(made)).toHaveLength(2);
    expect((await stored()).map((row) => row.status)).toEqual(['PROCESSED', 'PROCESSED', 'IGNORED', 'IGNORED', 'IGNORED']);
    // A colleague has confirmed the address since the first bounce: the line learns the reason, the address is left alone.
    const touched = await eligible();
    const old = await line(touched, 'SENT', { minutes: 600 });
    await happen({ type: 'email.bounced', sending: old.id, ref: old.ref, ago: 3600, data: { bounce: { type: 'Transient' } } });
    await as(officer(), (tx) => tx.$executeRaw`SELECT app.note_contact(${touched.contact}::uuid, 'VERIFIED')`);
    await happen({ type: 'email.bounced', sending: old.id, ref: old.ref, ago: 5, data: { bounce: { type: 'Permanent' } } });
    expect(await sending(old.id)).toMatchObject({ undelivered_reason: 'HARD_BOUNCE' });
    expect(await contactOf(touched)).toEqual({ status: 'VERIFIED', is_primary: true });
    expect(await history(touched)).toEqual(['Relance non distribuée']);
  });

  it('that failed at Resend, then is suppressed, has its address marked as wrong, and its failure said once', async () => {
    const made = await eligible();
    const { id } = await line(made, 'UNCERTAIN');
    await happen({ type: 'email.failed', sending: id, ago: 30 });
    expect(await sending(id)).toMatchObject({ status: 'FAILED', failure: 'PROVIDER_FAILED', undelivered_reason: 'PROVIDER_FAILED' });
    await happen({ type: 'email.suppressed', sending: id, ago: 10 });
    expect(await sending(id)).toMatchObject({ status: 'FAILED', failure: 'PROVIDER_FAILED', undelivered_reason: 'SUPPRESSED', confirmed_at: null });
    expect(await contactOf(made)).toEqual({ status: 'INVALID', is_primary: false });
    expect(await rows('SELECT title, detail FROM case_events WHERE case_id = $1 ORDER BY occurred_at, id', [made.id])).toEqual([
      { title: 'Relance non envoyée', detail: null },
      { title: 'Adresse e-mail marquée invalide', detail: 'Adresse écartée par Resend' },
    ]);
    expect((await stored()).map((row) => row.status)).toEqual(['PROCESSED', 'PROCESSED']);
  });

  it('that is complained about, or that Resend has suppressed, has its address marked as wrong too', async () => {
    const complained = await eligible();
    const first = await line(complained, 'SENT');
    await happen({ type: 'email.delivered', sending: first.id, ref: first.ref, ago: 30 });
    await happen({ type: 'email.complained', sending: first.id, ref: first.ref, ago: 10 });
    expect((await sending(first.id)).complained_at).not.toBeNull();
    expect(await contactOf(complained)).toEqual({ status: 'INVALID', is_primary: false });
    expect(await history(complained)).toEqual(['Relance distribuée', 'Relance signalée comme indésirable', 'Adresse e-mail marquée invalide']);
    const suppressed = await eligible();
    const second = await line(suppressed, 'SENT');
    await happen({ type: 'email.suppressed', sending: second.id, ref: second.ref, data: { suppressed: { type: 'OnAccountSuppressionList' } } });
    expect(await sending(second.id)).toMatchObject({ status: 'SENT', undelivered_reason: 'SUPPRESSED', confirmed_at: null });
    expect(await contactOf(suppressed)).toEqual({ status: 'INVALID', is_primary: false });
    expect(await history(suppressed)).toEqual(['Relance non distribuée', 'Adresse e-mail marquée invalide']);
  });

  it('is told in the words of question 226, with its level, by the application, and never to the creditor', async () => {
    const events = (made: Made) =>
      rows<{ title: string; detail: string | null; tone: string }>(
        'SELECT title, detail, tone::text FROM case_events WHERE case_id = $1 ORDER BY occurred_at, id',
        [made.id],
      );
    const complained = await eligible();
    const firm = await line(complained, 'SENT', { level: 2 });
    await happen({ type: 'email.delivered', sending: firm.id, ref: firm.ref, ago: 30 });
    await happen({ type: 'email.complained', sending: firm.id, ref: firm.ref, ago: 10 });
    expect(await events(complained)).toEqual([
      { title: 'Relance distribuée', detail: 'E-mail · niveau 2', tone: 'success' },
      { title: 'Relance signalée comme indésirable', detail: 'E-mail · niveau 2', tone: 'danger' },
      { title: 'Adresse e-mail marquée invalide', detail: 'Signalement comme indésirable', tone: 'warning' },
    ]);
    // Accepted by Resend, then failed there: the reminder did not arrive, and the address is not in cause.
    const failed = await eligible();
    const accepted = await line(failed, 'SENT', { level: 2 });
    await happen({ type: 'email.failed', sending: accepted.id, ref: accepted.ref });
    expect(await sending(accepted.id)).toMatchObject({ status: 'SENT', undelivered_reason: 'PROVIDER_FAILED' });
    expect(await contactOf(failed)).toEqual({ status: 'VERIFIED', is_primary: true });
    expect(await events(failed)).toEqual([{ title: 'Relance non distribuée', detail: 'E-mail · niveau 2 · échec chez Resend', tone: 'danger' }]);
    const suppressed = await eligible();
    const notice = await line(suppressed, 'SENT', { level: 3 });
    await happen({ type: 'email.suppressed', sending: notice.id, ref: notice.ref });
    expect(await events(suppressed)).toEqual([
      { title: 'Relance non distribuée', detail: 'E-mail · niveau 3 · adresse écartée par Resend', tone: 'danger' },
      { title: 'Adresse e-mail marquée invalide', detail: 'Adresse écartée par Resend', tone: 'warning' },
    ]);
    const settled = await eligible();
    const uncertain = await line(settled, 'UNCERTAIN', { level: 2 });
    const reported = await line(settled, 'REPORTED', { level: 3 });
    await happen({ type: 'email.sent', sending: uncertain.id, ago: 20 });
    await happen({ type: 'email.sent', sending: reported.id, ago: 10 });
    expect(await events(settled)).toEqual([
      { title: 'Relance envoyée', detail: 'E-mail · niveau 2', tone: 'info' },
      { title: 'Relance partie malgré un échec signalé', detail: 'E-mail · niveau 3', tone: 'warning' },
    ]);
    // Neither an address nor a name; written by the application; never shown to the creditor.
    expect(
      await rows(
        'SELECT DISTINCT actor_kind::text, actor_id, actor_label, on_behalf_of_id, visible_to_creditor FROM case_events WHERE case_id = ANY($1::uuid[])',
        [[complained.id, failed.id, suppressed.id, settled.id]],
      ),
    ).toEqual([{ actor_kind: 'SYSTEM', actor_id: null, actor_label: 'Application', on_behalf_of_id: null, visible_to_creditor: false }]);
    // Nobody is told of what became of a reminder that has left (no text validated).
    expect(await rows('SELECT 1 FROM notifications WHERE case_id = ANY($1::uuid[])', [[complained.id, failed.id, suppressed.id, settled.id]])).toEqual([]);
  });

  it('marks an address as wrong once, however many of its messages bounce for good', async () => {
    const made = await eligible();
    const older = await line(made, 'SENT', { minutes: 120 });
    const newer = await line(made, 'SENT', { minutes: 30 });
    await happen({ type: 'email.bounced', sending: newer.id, ref: newer.ref, ago: 60, data: { bounce: { type: 'Permanent' } } });
    await happen({ type: 'email.bounced', sending: older.id, ref: older.ref, ago: 30, data: { bounce: { type: 'Permanent' } } });
    // Each line learns its own bounce; the address, once.
    expect(await sending(older.id)).toMatchObject({ undelivered_reason: 'HARD_BOUNCE' });
    expect(await sending(newer.id)).toMatchObject({ undelivered_reason: 'HARD_BOUNCE' });
    expect(await contactOf(made)).toEqual({ status: 'INVALID', is_primary: false });
    expect(await rows('SELECT what FROM case_contact_events WHERE contact_id = $1', [made.contact])).toEqual([{ what: 'INVALIDATED' }]);
    expect(await history(made)).toEqual(['Relance non distribuée', 'Adresse e-mail marquée invalide', 'Relance non distribuée']);
    expect(await rows("SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'CONTACT_CHANGED'", [made.id])).toHaveLength(1);
  });

  it('whose case has been anonymized is no longer there: nothing is written, by its line nor by its message', async () => {
    const made = await eligible();
    const { id, ref } = await line(made, 'SENT');
    // As the anonymization does: the lines go with the case.
    await rows('DELETE FROM sendings WHERE case_id = $1', [made.id]);
    await rows('UPDATE cases SET anonymized_at = now() WHERE id = $1', [made.id]);
    await happen({ type: 'email.bounced', sending: id, ref, data: { bounce: { type: 'Permanent' } } });
    await happen({ type: 'email.complained', ref });
    // And one whose case is being anonymized while its line is still there.
    const other = await eligible();
    const kept = await line(other, 'SENT');
    await rows('UPDATE cases SET anonymized_at = now() WHERE id = $1', [other.id]);
    await happen({ type: 'email.bounced', sending: kept.id, ref: kept.ref, data: { bounce: { type: 'Permanent' } } });
    expect((await stored()).map((row) => row.status)).toEqual(['IGNORED', 'IGNORED', 'IGNORED']);
    expect(await sending(kept.id)).toMatchObject({ status: 'SENT', confirmed_at: null, undelivered_at: null });
    expect(await contactOf(other)).toEqual({ status: 'VERIFIED', is_primary: true });
    expect(await rows('SELECT 1 FROM case_events WHERE case_id = ANY($1::uuid[])', [[made.id, other.id]])).toEqual([]);
    expect(await rows('SELECT 1 FROM audit_log WHERE entity_id = ANY($1::uuid[])', [[made.id, other.id]])).toEqual([]);
  });

  it('leaves alone an address a colleague has touched since the bounce, or that a later message has reached', async () => {
    const touched = await eligible();
    const old = await line(touched, 'SENT', { minutes: 600 });
    await as(officer(), (tx) => tx.$executeRaw`SELECT app.note_contact(${touched.contact}::uuid, 'VERIFIED')`);
    await happen({ type: 'email.bounced', sending: old.id, ref: old.ref, ago: 3600, data: { bounce: { type: 'Permanent' } } });
    expect(await sending(old.id)).toMatchObject({ undelivered_reason: 'HARD_BOUNCE' });
    expect(await contactOf(touched)).toEqual({ status: 'VERIFIED', is_primary: true });
    expect(await history(touched)).toEqual(['Relance non distribuée']);
    const reached = await eligible();
    const before = await line(reached, 'SENT', { minutes: 600 });
    const later = await line(reached, 'SENT', { minutes: 5 });
    await happen({ type: 'email.delivered', sending: later.id, ref: later.ref, ago: 60 });
    await happen({ type: 'email.complained', sending: before.id, ref: before.ref, ago: 3600 });
    expect(await contactOf(reached)).toEqual({ status: 'VERIFIED', is_primary: true });
  });

  it('leaves alone an address a colleague is changing while the bounce is handled', async () => {
    const made = await eligible();
    const old = await line(made, 'SENT', { minutes: 600 });
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    // As the sheet of the case does: the case, then the coordinate, then what was done, in one transaction not yet ended.
    const colleague = as(officer(), async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM cases WHERE id = ${made.id}::uuid FOR NO KEY UPDATE`;
      await tx.$executeRaw`UPDATE case_contacts SET status = 'VERIFIED' WHERE id = ${made.contact}::uuid`;
      holding();
      await released;
      await tx.$executeRaw`SELECT app.note_contact(${made.contact}::uuid, 'VERIFIED')`;
    });
    await held;
    const handled = happen({ type: 'email.bounced', sending: old.id, ref: old.ref, ago: 60, data: { bounce: { type: 'Permanent' } } });
    // The worker waits for the coordinate, while the colleague has not yet said what they did.
    await vi.waitFor(
      async () =>
        expect(
          await rows(
            "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%invalidate_unreachable_contact%'",
          ),
        ).toHaveLength(1),
      { timeout: 10_000, interval: 50 },
    );
    release();
    expect(await colleague).toBeUndefined();
    await handled;
    expect(await sending(old.id)).toMatchObject({ undelivered_reason: 'HARD_BOUNCE' });
    expect(await contactOf(made)).toEqual({ status: 'VERIFIED', is_primary: true });
    expect(await history(made)).toEqual(['Relance non distribuée']);
  });
});

describe('a line that had failed and yet has left', () => {
  it('keeps its status, says so in the history, and counts as left: the same level is not asked twice', async () => {
    const made = await eligible();
    await fillFirm();
    /** What the list would send now, asked at half past ten on a working day: the hours of the firm stop nothing. */
    const preview = async () => {
      const clock = vi.spyOn(test.app.get(Clock), 'now').mockReturnValue(workingHour());
      const answer = await test.call('POST', '/staff/cases/reminders/preview', { as: 'officerA', body: { ids: [made.id] } });
      clock.mockRestore();
      return (answer.body as { items: unknown[] }).items;
    };
    const counted = () =>
      as(
        officer(),
        async (tx) =>
          (await tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${made.id}::uuid, 'EMAIL', current_date - 7, current_date + 7) AS count`)[0]!.count,
      );
    const { id } = await line(made, 'REPORTED');
    // The line that failed does not count: the same level would be asked again.
    expect(await preview()).toEqual([{ id: made.id, template: 'FRIENDLY', reason: null }]);
    expect(await counted()).toBe(0);
    const ref = randomUUID();
    await happen({ type: 'email.delivered', sending: id, ref, ago: 15 });
    const after = await sending(id);
    expect(after).toMatchObject({ status: 'FAILED', failure: 'PROVIDER_FAILED', sent_at: null, provider_ref: null });
    expect(after.confirmed_at).not.toBeNull();
    expect(after.delivered_at).toEqual(after.confirmed_at);
    expect(await history(made)).toEqual(['Relance partie malgré un échec signalé', 'Relance distribuée']);
    expect(test.logs.join('')).toContain('sending failed yet confirmed by the provider');
    expect(await counted()).toBe(1);
    // It has left a moment ago: nothing more for a week, and then the next level, never the same one.
    expect(await preview()).toEqual([{ id: made.id, template: null, reason: 'TOO_SOON' }]);
    // Said once, whatever else Resend says of it.
    await happen({ type: 'email.sent', sending: id, ref, ago: 20 });
    expect(await history(made)).toHaveLength(2);
    // Known late, of a message that left twenty days ago: the list goes on to the next level, never the same one.
    const late = await eligible();
    const old = await line(late, 'REPORTED', { minutes: 25 * 1440 });
    await happen({ type: 'email.sent', sending: old.id, ago: 20 * 86_400 });
    const clock = vi.spyOn(test.app.get(Clock), 'now').mockReturnValue(workingHour());
    const next = await test.call('POST', '/staff/cases/reminders/preview', { as: 'officerA', body: { ids: [late.id] } });
    clock.mockRestore();
    expect(next.body).toEqual({ items: [{ id: late.id, template: 'FIRM', reason: null }] });
    // And a line that Resend refused at the call is never shown to have left: it has no message there, and whatever
    // names it speaks of another one.
    const other = await eligible();
    const refused = await line(other, 'FAILED');
    await happen({ type: 'email.delivered', sending: refused.id });
    await happen({ type: 'email.suppressed', sending: refused.id });
    expect(await sending(refused.id)).toMatchObject({ status: 'FAILED', confirmed_at: null, delivered_at: null, undelivered_at: null });
    expect(await contactOf(other)).toMatchObject({ status: 'VERIFIED' });
    expect(await history(other)).toEqual([]);
  });

  it('counts on the sheet of the case and in the week of the agenda as the caps count it, on the day it is known to have left', async () => {
    const sheet = async (made: Made) =>
      ((await test.call('GET', `/staff/cases/${made.id}`, { as: 'officerA' })).body as { remindersSent: number }).remindersSent;
    const week = async () => ((await test.call('GET', '/staff/reminders', { as: 'officerA' })).body as { weekly: { emails: number } }).weekly.emails;
    const before = await week();
    const made = await eligible();
    const { id } = await line(made, 'REPORTED');
    // Failed, and nothing known since: neither the sheet nor the week counts it.
    expect(await sheet(made)).toBe(0);
    expect(await week()).toBe(before);
    await happen({ type: 'email.delivered', sending: id, ago: 15 });
    expect(await sheet(made)).toBe(1);
    expect(await week()).toBe(before + 1);
    // Known to have left five weeks ago: on the sheet of its case, not in this week.
    const late = await eligible();
    const old = await line(late, 'REPORTED', { minutes: 40 * 1440 });
    await happen({ type: 'email.sent', sending: old.id, ago: 35 * 86_400 });
    expect(await sheet(late)).toBe(1);
    expect(await week()).toBe(before + 1);
  });

  it('as a formal notice, ends the reminders of the list, and counts for the cap on the day Resend dates it', async () => {
    const made = await eligible();
    await fillFirm();
    const preview = async () => {
      const clock = vi.spyOn(test.app.get(Clock), 'now').mockReturnValue(workingHour());
      const answer = await test.call('POST', '/staff/cases/reminders/preview', { as: 'officerA', body: { ids: [made.id] } });
      clock.mockRestore();
      return (answer.body as { items: unknown[] }).items;
    };
    const counted = (from: string, to: string) =>
      as(
        officer(),
        async (tx) =>
          (await tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${made.id}::uuid, 'EMAIL', ${from}::date, ${to}::date) AS count`)[0]!.count,
      );
    const notice = await line(made, 'REPORTED', { level: 3, minutes: 25 * 1440 });
    // Failed at Resend, the formal notice is as if it had never been asked: the list starts again from the first level.
    expect(await preview()).toEqual([{ id: made.id, template: 'FRIENDLY', reason: null }]);
    await happen({ type: 'email.delivered', sending: notice.id, ago: 20 * 86_400 });
    expect(await preview()).toEqual([{ id: made.id, template: null, reason: 'NO_NEXT_REMINDER' }]);
    const [days] = await rows<{ asked: string; confirmed: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS asked, to_char(confirmed_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS confirmed
       FROM sendings WHERE id = $1`,
      [notice.id],
    );
    expect(await counted(days!.confirmed, days!.confirmed)).toBe(1);
    // Neither on the day it was asked, nor in the days it was found out.
    expect(await counted(days!.asked, days!.asked)).toBe(0);
    const around = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    expect(await counted(around(-3), around(3))).toBe(0);
  });
});

describe('in the database', () => {
  const change = (id: string, set: string) =>
    rows(`UPDATE sendings SET ${set} WHERE id = $1`, [id]).then(
      () => 'done',
      (error: { code?: string }) => String(error.code),
    );

  it('a settled line keeps its status, its date and its reference, whoever asks', async () => {
    const made = await eligible();
    const sent = await line(made, 'SENT');
    const failed = await line(made, 'FAILED');
    for (const set of [
      "status = 'FAILED', failure = 'LATE', sent_at = NULL, provider_ref = NULL",
      'sent_at = now()',
      "provider_ref = 'other'",
      'simulated = true',
    ])
      expect(await change(sent.id, set), set).toBe('42501');
    for (const set of [
      "status = 'SENT', failure = NULL, sent_at = now()",
      "status = 'SENT', failure = NULL, sent_at = now(), confirmed_at = now()",
      "status = 'UNCERTAIN', failure = NULL",
      "failure = 'OTHER'",
    ])
      expect(await change(failed.id, set), set).toBe('42501');
    expect(await change(failed.id, 'confirmed_at = now(), delivered_at = now()')).toBe('done');
    expect(await sending(failed.id)).toMatchObject({ status: 'FAILED' });
  });

  it('what the provider said is written once, and never on a line that has not left this machine', async () => {
    const made = await eligible();
    const sent = await line(made, 'SENT');
    expect(await change(sent.id, 'delivered_at = now()')).toBe('23514');
    expect(await change(sent.id, 'undelivered_at = now()')).toBe('23514');
    expect(
      await change(sent.id, "confirmed_at = now(), delivered_at = now(), undelivered_at = now(), undelivered_reason = 'BOUNCE', complained_at = now()"),
    ).toBe('done');
    for (const set of [
      "confirmed_at = now() + interval '1 second'",
      'confirmed_at = NULL, delivered_at = NULL, complained_at = NULL',
      "delivered_at = now() + interval '1 second'",
      "undelivered_reason = 'PROVIDER_FAILED'",
      // The worse reason, but on another date.
      "undelivered_at = now() + interval '1 second', undelivered_reason = 'HARD_BOUNCE'",
      'undelivered_at = NULL, undelivered_reason = NULL',
      "complained_at = now() + interval '1 second'",
    ])
      expect(await change(sent.id, set), set).toBe('42501');
    // One change only: the reason that left the address alone becomes one that condemns it, and then stays.
    expect(await change(sent.id, "undelivered_reason = 'HARD_BOUNCE'")).toBe('done');
    for (const set of [
      "undelivered_reason = 'BOUNCE'",
      "undelivered_reason = 'SUPPRESSED'",
      "undelivered_reason = 'PROVIDER_FAILED'",
      'undelivered_at = NULL, undelivered_reason = NULL',
    ])
      expect(await change(sent.id, set), set).toBe('42501');
    const failedAtProvider = await line(made, 'SENT');
    expect(await change(failedAtProvider.id, "undelivered_at = now(), undelivered_reason = 'PROVIDER_FAILED'")).toBe('done');
    expect(await change(failedAtProvider.id, "undelivered_reason = 'BOUNCE'")).toBe('42501');
    expect(await change(failedAtProvider.id, "undelivered_reason = 'SUPPRESSED'")).toBe('done');
    expect(await change(sent.id, "undelivered_reason = 'UNKNOWN'")).not.toBe('done');
    for (const state of ['QUEUED', 'UNCERTAIN', 'SIMULATED', 'EXPIRED'] as const) {
      const { id } = await line(made, state);
      for (const set of ['confirmed_at = now()', "undelivered_at = now(), undelivered_reason = 'BOUNCE'"])
        expect(await change(id, set), `${state} ${set}`).toBe('42501');
    }
  });

  it('a line fails for a reason of the provider once it has been taken, and for no other', async () => {
    const made = await eligible();
    const queued = await line(made, 'QUEUED');
    expect(await change(queued.id, "status = 'FAILED', failure = 'PROVIDER_REFUSED'")).toBe('42501');
    expect(await change(queued.id, "status = 'FAILED', failure = 'EXPIRED'")).toBe('done');
    const taken = await line(made, 'UNCERTAIN');
    expect(await change(taken.id, "status = 'FAILED', failure = 'EXPIRED'")).toBe('42501');
    expect(await change(taken.id, "status = 'FAILED', failure = NULL")).toBe('42501');
    expect(await change(taken.id, "status = 'FAILED', failure = 'PROVIDER_BUSY'")).toBe('done');
  });

  it('a line is born without anything the provider said, whoever writes it', async () => {
    const made = await eligible();
    const born = (column: string, value = 'now()') =>
      rows(
        `INSERT INTO sendings (case_id, creditor_id, channel, template, level, contact_id, created_by, ${column})
         SELECT c.id, c.creditor_id, 'EMAIL', 'FRIENDLY', 1, $2, $3, ${value} FROM cases c WHERE c.id = $1`,
        [made.id, made.contact, test.s.officerA],
      ).then(
        () => 'done',
        (error: { code?: string }) => String(error.code),
      );
    for (const column of ['confirmed_at', 'delivered_at', 'undelivered_at', 'complained_at']) expect(await born(column), column).toBe('42501');
    expect(await born('undelivered_reason', "'BOUNCE'")).not.toBe('done');
    expect(await rows('SELECT 1 FROM sendings WHERE case_id = $1', [made.id])).toEqual([]);
  });

  it('the secret of the events is read by their route alone, and by its name alone', async () => {
    const read = (actor: Actor, name = 'RESEND_WEBHOOK_SECRET') =>
      as(actor, async (tx) => (await tx.$queryRaw<{ id: string | null }[]>`SELECT id FROM app.hook_secret(${name})`)[0]?.id != null);
    expect(await read({ kind: 'hook' })).toBe(true);
    for (const name of ['RESEND_API_KEY', 'MAILBOX_SECRETS_KEY', 'ACCESS_CODE_KEY', '']) expect(await read({ kind: 'hook' }, name), name).toBe('42501');
    for (const actor of [officer(), { kind: 'anonymous' }, { kind: 'public' }, { kind: 'debtor', debtorId: randomUUID() }] as Actor[])
      expect(await read(actor), actor.kind).toBe('42501');
    expect(await worker.asWorker((tx) => tx.$queryRaw`SELECT id FROM app.hook_secret('RESEND_WEBHOOK_SECRET')`).catch(databaseCode)).toBe('42501');
    // And never the key that sends.
    expect(await as({ kind: 'hook' }, (tx) => tx.$queryRaw`SELECT * FROM app.service_key('RESEND_API_KEY')`)).toBe('42501');
    expect(await as({ kind: 'hook' }, (tx) => tx.$queryRaw`SELECT value_cipher FROM vault_secrets`)).toBe('42501');
  });

  it('a provider writes events and nothing else: neither a line, nor a case, nor an event already handled', async () => {
    const hook: Actor = { kind: 'hook' };
    const made = await eligible();
    const { id } = await line(made, 'SENT');
    expect(await as(hook, (tx) => tx.$queryRaw`SELECT id FROM sendings`)).toBe('42501');
    expect(await as(hook, (tx) => tx.$executeRaw`UPDATE sendings SET delivered_at = now() WHERE id = ${id}::uuid`)).toBe('42501');
    expect(await as(hook, (tx) => tx.$queryRaw`SELECT id FROM cases`)).toBe('42501');
    expect(await as(hook, (tx) => tx.$queryRaw`SELECT app.invalidate_unreachable_contact(${id}::uuid)`)).toBe('42501');
    const insert = (status: string) =>
      as(
        hook,
        (tx) => tx.$executeRaw`INSERT INTO webhook_events (provider, provider_event_id, status) VALUES ('RESEND', ${randomUUID()}, ${status}::webhook_status)`,
      );
    expect(await insert('PROCESSED')).toBe('42501');
    expect(await insert('FAILED')).toBe('42501');
    expect(await insert('IGNORED')).toBe(1);
    expect(await as(hook, (tx) => tx.$executeRaw`UPDATE webhook_events SET status = 'PROCESSED'`)).toBe('42501');
    expect(await as(hook, (tx) => tx.$executeRaw`DELETE FROM webhook_events`)).toBe('42501');
  });

  it('an address is marked as wrong by the worker alone, and only when the line says that it can no longer be written to', async () => {
    const made = await eligible();
    const { id } = await line(made, 'SENT');
    const mark = (actor: Actor | 'worker') => {
      const work = async (tx: Transaction) =>
        (await tx.$queryRaw<{ marked: boolean }[]>`SELECT app.invalidate_unreachable_contact(${id}::uuid) AS marked`)[0]!.marked;
      return actor === 'worker' ? worker.asWorker(work) : as(actor, work);
    };
    expect(await mark(officer())).toBe('42501');
    expect(await mark({ kind: 'anonymous' })).toBe('42501');
    // Nothing on the line says so: the worker itself marks nothing.
    expect(await mark('worker')).toBe(false);
    await rows("UPDATE sendings SET undelivered_at = now(), undelivered_reason = 'BOUNCE' WHERE id = $1", [id]);
    expect(await mark('worker')).toBe(false);
    expect(await contactOf(made)).toEqual({ status: 'VERIFIED', is_primary: true });
    const hard = await line(made, 'SENT');
    await rows("UPDATE sendings SET undelivered_at = now(), undelivered_reason = 'HARD_BOUNCE' WHERE id = $1", [hard.id]);
    expect(
      await worker.asWorker(
        async (tx) => (await tx.$queryRaw<{ marked: boolean }[]>`SELECT app.invalidate_unreachable_contact(${hard.id}::uuid) AS marked`)[0]!.marked,
      ),
    ).toBe(true);
    expect(await contactOf(made)).toEqual({ status: 'INVALID', is_primary: false });
    // The worker itself cannot write a coordinate otherwise.
    expect(
      await worker
        .asWorker((tx) => tx.$executeRaw`UPDATE case_contacts SET status = 'INVALID', invalidated_at = now() WHERE id = ${made.contact}::uuid`)
        .catch(databaseCode),
    ).toBe('42501');
  });
});

describe('the code a line fails with', () => {
  it('says whether the line was ever taken, whatever code it is given, and leaves alone a line taken meanwhile', async () => {
    // Five notices an hour are named to a colleague: those of the tests before do not count here.
    await rows("DELETE FROM notifications WHERE kind = 'SENDING_FAILED'");
    const made = await eligible();
    const fail = (id: string, failure: string, from: 'QUEUED' | 'UNCERTAIN') => markFailed(worker.asWorker, id, made.id, failure, from);
    const queued = await line(made, 'QUEUED');
    const unreadable = await line(made, 'QUEUED');
    const taken = await line(made, 'UNCERTAIN');
    const busy = await line(made, 'UNCERTAIN');
    // A code of the provider for a line never taken, a code of ours for one taken, or no code at all: the one that says
    // what is known. A code that fits is kept.
    expect(await fail(queued.id, 'PROVIDER_REFUSED', 'QUEUED')).toEqual({ code: 'SENDING_FAILED', failed: true });
    expect(await fail(unreadable.id, 'refused by mx.exemple.test', 'QUEUED')).toEqual({ code: 'SENDING_FAILED', failed: true });
    expect(await fail(taken.id, 'EXPIRED', 'UNCERTAIN')).toEqual({ code: 'PROVIDER_FAILED', failed: true });
    expect(await fail(busy.id, 'PROVIDER_BUSY', 'UNCERTAIN')).toEqual({ code: 'PROVIDER_BUSY', failed: true });
    for (const [{ id }, failure] of [
      [queued, 'SENDING_FAILED'],
      [unreadable, 'SENDING_FAILED'],
      [taken, 'PROVIDER_FAILED'],
      [busy, 'PROVIDER_BUSY'],
    ] as const)
      expect(await sending(id)).toMatchObject({ status: 'FAILED', failure });
    // Taken meanwhile, or already failed: nobody here knows what has left, nothing is written.
    const moved = await line(made, 'UNCERTAIN');
    expect(await fail(moved.id, 'EXPIRED', 'QUEUED')).toEqual({ code: 'EXPIRED', failed: false });
    expect(await fail(queued.id, 'EXPIRED', 'QUEUED')).toEqual({ code: 'EXPIRED', failed: false });
    expect(await fail(taken.id, 'PROVIDER_REFUSED', 'UNCERTAIN')).toEqual({ code: 'PROVIDER_REFUSED', failed: false });
    expect(await sending(moved.id)).toMatchObject({ status: 'UNCERTAIN', failure: null });
    expect(await sending(taken.id)).toMatchObject({ status: 'FAILED', failure: 'PROVIDER_FAILED' });
    // Said once for each line that failed, in the history and to the colleague who asked for it; never with the code.
    expect(await history(made)).toEqual(Array.from({ length: 4 }, () => 'Relance non envoyée'));
    expect(await rows('SELECT 1 FROM case_events WHERE case_id = $1 AND detail IS NOT NULL', [made.id])).toEqual([]);
    const told = await rows<{ sending_id: string }>("SELECT sending_id FROM notifications WHERE kind = 'SENDING_FAILED' AND case_id = $1", [made.id]);
    expect(told.map((row) => row.sending_id).sort()).toEqual([queued.id, unreadable.id, taken.id, busy.id].sort());
  });
});
