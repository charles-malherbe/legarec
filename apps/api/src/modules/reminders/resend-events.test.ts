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
type State = 'QUEUED' | 'UNCERTAIN' | 'SENT' | 'FAILED' | 'SIMULATED';
/** A reminder of the case in that state, asked `minutes` ago; `ref`: the message at the provider, for a line that was sent. */
const line = async (made: Made, state: State, { ref = randomUUID(), minutes = 10 }: { ref?: string; minutes?: number } = {}) => {
  const [{ id }] = (await rows<{ id: string }>(
    `INSERT INTO sendings (case_id, creditor_id, channel, template, level, contact_id, created_by, created_at)
     SELECT c.id, c.creditor_id, 'EMAIL', 'FRIENDLY', 1, $2, $3, now() - $4::float8 * interval '1 minute' FROM cases c WHERE c.id = $1 RETURNING id`,
    [made.id, made.contact, test.s.officerA, minutes],
  )) as [{ id: string }];
  if (state !== 'QUEUED') await rows("UPDATE sendings SET status = 'UNCERTAIN' WHERE id = $1", [id]);
  if (state === 'SENT') await rows("UPDATE sendings SET status = 'SENT', sent_at = created_at + interval '1 second', provider_ref = $2 WHERE id = $1", [id, ref]);
  if (state === 'SIMULATED') await rows("UPDATE sendings SET status = 'SENT', sent_at = created_at, simulated = true WHERE id = $1", [id]);
  if (state === 'FAILED') await rows("UPDATE sendings SET status = 'FAILED', failure = 'PROVIDER_REFUSED' WHERE id = $1", [id]);
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
  (await rows<{ title: string }>("SELECT title FROM case_events WHERE case_id = $1 ORDER BY occurred_at, id", [made.id])).map((row) => row.title);

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
  `v1,${createHmac('sha256', Buffer.from(key.slice('whsec_'.length), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
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
const stored = () => rows<{ status: string; kind: string | null }>("SELECT status, kind FROM webhook_events WHERE provider = 'RESEND' ORDER BY received_at, id");
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
    expect(await rows("SELECT 1 FROM outbox WHERE name = 'resend-event' AND done_at IS NULL")).toEqual([]);
    expect(await sending(id)).toMatchObject({ confirmed_at: null, delivered_at: null });
    expect(await history(made)).toEqual([]);
  });

  it('about a line of another environment, a simulated one, one not taken yet or another message changes nothing', async () => {
    const made = await eligible();
    const queued = await line(made, 'QUEUED');
    const simulated = await line(made, 'SIMULATED');
    const sent = await line(made, 'SENT');
    await happen({ type: 'email.delivered', sending: randomUUID() });
    await happen({ type: 'email.delivered', ref: randomUUID() });
    await happen({ type: 'email.delivered', sending: queued.id });
    await happen({ type: 'email.bounced', sending: simulated.id, data: { bounce: { type: 'Permanent' } } });
    // The line is named, but the message is not the one that left for it.
    await happen({ type: 'email.bounced', sending: sent.id, ref: randomUUID(), data: { bounce: { type: 'Permanent' } } });
    // A name unknown here is never looked for by its message: it belongs to another environment.
    await happen({ type: 'email.delivered', sending: randomUUID(), ref: sent.ref });
    expect((await stored()).map((row) => row.status)).toEqual(Array.from({ length: 6 }, () => 'IGNORED'));
    expect(await sending(queued.id)).toMatchObject({ status: 'QUEUED', confirmed_at: null });
    expect(await sending(sent.id)).toMatchObject({ status: 'SENT', confirmed_at: null, delivered_at: null, undelivered_at: null });
    expect(await contactOf(made)).toEqual({ status: 'VERIFIED', is_primary: true });
    expect(await history(made)).toEqual([]);
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
    expect(await rows('SELECT actor_label, detail FROM case_events WHERE case_id = $1', [made.id])).toEqual([{ actor_label: 'Application', detail: 'E-mail · niveau 1' }]);
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
    expect(await sending(id)).toMatchObject({ status: 'FAILED', failure: 'PROVIDER_FAILED', sent_at: null, confirmed_at: null, undelivered_reason: 'PROVIDER_FAILED' });
    expect(await history(made)).toEqual(['Relance non envoyée']);
    expect(await rows('SELECT kind::text FROM notifications WHERE sending_id = $1', [id])).toEqual([{ kind: 'SENDING_FAILED' }]);
    expect(await contactOf(made)).toMatchObject({ status: 'VERIFIED' });
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
      as(officer(), async (tx) => (await tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${made.id}::uuid, 'EMAIL', current_date - 7, current_date + 7) AS count`)[0]!.count);
    const { id } = await line(made, 'FAILED');
    // The line that failed does not count: the same level would be asked again.
    expect(await preview()).toEqual([{ id: made.id, template: 'FRIENDLY', reason: null }]);
    expect(await counted()).toBe(0);
    const ref = randomUUID();
    await happen({ type: 'email.delivered', sending: id, ref, ago: 15 });
    const after = await sending(id);
    expect(after).toMatchObject({ status: 'FAILED', failure: 'PROVIDER_REFUSED', sent_at: null, provider_ref: null });
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
    const old = await line(late, 'FAILED', { minutes: 25 * 1440 });
    await happen({ type: 'email.sent', sending: old.id, ago: 20 * 86_400 });
    const clock = vi.spyOn(test.app.get(Clock), 'now').mockReturnValue(workingHour());
    const next = await test.call('POST', '/staff/cases/reminders/preview', { as: 'officerA', body: { ids: [late.id] } });
    clock.mockRestore();
    expect(next.body).toEqual({ items: [{ id: late.id, template: 'FIRM', reason: null }] });
    // And Resend saying that nothing has left teaches nothing to a line that had failed.
    const other = await eligible();
    const failed = await line(other, 'FAILED');
    await happen({ type: 'email.suppressed', sending: failed.id });
    expect(await sending(failed.id)).toMatchObject({ status: 'FAILED', confirmed_at: null, undelivered_at: null });
    expect(await contactOf(other)).toMatchObject({ status: 'VERIFIED' });
    expect(await history(other)).toEqual([]);
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
    for (const set of ["status = 'FAILED', failure = 'LATE', sent_at = NULL, provider_ref = NULL", 'sent_at = now()', "provider_ref = 'other'", 'simulated = true'])
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
    expect(await change(sent.id, "undelivered_at = now()")).toBe('23514');
    expect(await change(sent.id, "confirmed_at = now(), delivered_at = now(), undelivered_at = now(), undelivered_reason = 'BOUNCE', complained_at = now()")).toBe('done');
    for (const set of [
      "confirmed_at = now() + interval '1 second'",
      'confirmed_at = NULL, delivered_at = NULL, complained_at = NULL',
      "delivered_at = now() + interval '1 second'",
      "undelivered_reason = 'HARD_BOUNCE'",
      'undelivered_at = NULL, undelivered_reason = NULL',
      "complained_at = now() + interval '1 second'",
    ])
      expect(await change(sent.id, set), set).toBe('42501');
    expect(await change(sent.id, "undelivered_reason = 'UNKNOWN'")).not.toBe('done');
    for (const state of ['QUEUED', 'UNCERTAIN', 'SIMULATED'] as const) {
      const { id } = await line(made, state);
      for (const set of ['confirmed_at = now()', "undelivered_at = now(), undelivered_reason = 'BOUNCE'"]) expect(await change(id, set), `${state} ${set}`).toBe('42501');
    }
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
      as(hook, (tx) => tx.$executeRaw`INSERT INTO webhook_events (provider, provider_event_id, status) VALUES ('RESEND', ${randomUUID()}, ${status}::webhook_status)`);
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
      const work = async (tx: Transaction) => (await tx.$queryRaw<{ marked: boolean }[]>`SELECT app.invalidate_unreachable_contact(${id}::uuid) AS marked`)[0]!.marked;
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
    expect(await worker.asWorker(async (tx) => (await tx.$queryRaw<{ marked: boolean }[]>`SELECT app.invalidate_unreachable_contact(${hard.id}::uuid) AS marked`)[0]!.marked)).toBe(true);
    expect(await contactOf(made)).toEqual({ status: 'INVALID', is_primary: false });
    // The worker itself cannot write a coordinate otherwise.
    expect(await worker.asWorker((tx) => tx.$executeRaw`UPDATE case_contacts SET status = 'INVALID', invalidated_at = now() WHERE id = ${made.contact}::uuid`).catch(databaseCode)).toBe('42501');
  });
});
