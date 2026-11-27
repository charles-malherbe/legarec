import { firmGroups, publicHolidays } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import type { HttpClient } from '../../emails/resend';
import { Clock } from '../../platform/clock';
import { CONFIG } from '../../platform/config/config';
import { databaseCode } from '../../platform/database/codes';
import type { Transaction } from '../../platform/database/database';
import { PLACEHOLDER } from '../../platform/pdf/pdf';
import { Outbox } from '../../platform/queue/outbox';
import { Vault } from '../vault/vault';
import { sendingDeadline } from './contact-rules';
import { sweepSendings } from './sendings.jobs';
import { SendingsService } from './sendings.service';
import { contactHours } from '@legarec/contracts';

let test: TestApp;
let worker: MailWorker;
let reference = 60_000;
let siren = 552_100_000;
/** What the fake provider was asked, and what it answers next. */
const asked: { url: string; headers: Record<string, string>; body: string }[] = [];
let answer: () => Promise<{ status: number; json(): Promise<unknown> }> = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ id: 'ref-1' }) });
const http: HttpClient = (url, init) => {
  asked.push({ url, headers: init.headers, body: init.body });
  return answer();
};
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });

/** A working day of this week, at half past ten in Paris: what PostgreSQL dates today falls in the same week. */
const WORKING = (() => {
  const noon = Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const monday = noon - ((new Date(noon).getUTCDay() + 6) % 7) * 86_400_000;
  for (let index = 0; index < 6; index += 1) {
    const iso = new Date(monday + index * 86_400_000).toISOString().slice(0, 10);
    if (!publicHolidays(Number(iso.slice(0, 4))).has(iso)) return iso;
  }
  throw new Error('no working day this week');
})();
/** That day at this hour in Paris, whatever the season. */
const at = (day: string, time: string) => {
  const guess = new Date(`${day}T${time}:00Z`);
  const shown = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(guess);
  const minutes = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
  return new Date(guess.getTime() - (minutes(shown) - minutes(time)) * 60_000);
};
/** The hour it is for the worker: a working one, unless a test says otherwise. */
let workerNow = at(WORKING, '10:30');
const clock = (now: Date) => {
  vi.spyOn(test.app.get(Clock), 'now').mockReturnValue(now);
};
/** As a colleague, straight in the database: what PostgreSQL itself answers, or its code when it refuses. */
const asStaff = <T>(userId: string, work: (tx: Transaction) => Promise<T>) =>
  test.pool.run({ kind: 'staff', userId, role: 'CLAIMS_OFFICER', delegations: [] }, work).catch((error: unknown) => databaseCode(error) ?? String(error));
const asWorker = <T>(work: (tx: Transaction) => Promise<T>) => worker.asWorker(work).catch((error: unknown) => databaseCode(error) ?? String(error));
const events = (caseId: string, kind: string) =>
  rows<{ title: string; detail: string | null; actor_label: string }>(
    'SELECT title, detail, actor_label FROM case_events WHERE case_id = $1 AND kind = $2 ORDER BY occurred_at',
    [caseId, kind],
  );

interface Made {
  id: string;
  debtor: string;
  email: string;
}
/** A company with a first letter and an address to write to, held by `officer`. */
const eligible = async (
  officer: string,
  options: { debtor?: string; email?: string; verified?: boolean; kind?: string; firstLetter?: boolean } = {},
): Promise<Made> => {
  const { email = `compta-${randomUUID().slice(0, 8)}@resend.dev`, verified = true, kind = 'COMPANY', firstLetter = true } = options;
  const [creditor] = await rows<{ id: string }>('INSERT INTO creditors (name) VALUES ($1) RETURNING id', [`Créancier ${(reference += 1)}`]);
  const debtor =
    options.debtor ??
    (
      await rows<{ id: string }>('INSERT INTO debtors (kind, name, siren) VALUES ($1::debtor_kind, $2, $3) RETURNING id', [
        kind,
        `Débiteur ${reference}`,
        kind === 'COMPANY' ? String((siren += 1)) : null,
      ])
    )[0]!.id;
  const [made] = await rows<{ id: string }>(
    `INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status, first_letter_reference, first_letter_on)
     VALUES ($1, $2, $3, $4, 'REMINDER', $5, $6) RETURNING id`,
    [`LGR-2026-${reference}`, creditor!.id, debtor, officer, firstLetter ? `LR-2026-${String(reference).slice(-4)}` : null, firstLetter ? '2026-09-15' : null],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-2026-0712', '2026-08-15', '2026-09-14', 1860000, 1860000)",
    [made!.id, creditor!.id],
  );
  await rows(
    "INSERT INTO case_contacts (case_id, creditor_id, kind, label, value, value_normalized, source, status, is_primary) VALUES ($1, $2, 'EMAIL', 'Comptabilité', $3, $4, 'CREDITOR', $5::contact_status, true)",
    [made!.id, creditor!.id, email, email.toLowerCase(), verified ? 'VERIFIED' : 'UNVERIFIED'],
  );
  return { id: made!.id, debtor, email };
};
const remind = (as: string, made: Made, body: Record<string, string> = {}) =>
  call(as, 'POST', `/cases/${made.id}/reminders`, { channel: 'EMAIL', template: 'FRIENDLY', recipient: made.email, message: 'Bonjour', ...body });
const sendings = (caseId: string) =>
  rows<{ status: string; simulated: boolean; provider_ref: string | null; failure: string | null; level: number }>(
    'SELECT status, simulated, provider_ref, failure, level FROM sendings WHERE case_id = $1 ORDER BY created_at',
    [caseId],
  );
/** Everything of the firm that is still between brackets. */
const fillFirm = async () => {
  const fields = firmGroups()
    .flatMap((group) => group.items)
    .find((item) => item.id === 'cabinet')!
    .blocks.flatMap((block) => block.fields);
  const samples: Record<string, string> = { siren: '732829007', iban: 'FR7630001007941234567890185', bic: 'BDFEFRPP' };
  for (const field of fields.filter((item) => PLACEHOLDER.test(item.value ?? '')))
    await rows('INSERT INTO settings (key, value, updated_by) VALUES ($1, to_jsonb($2::text), $3)', [
      `firm.cabinet.${field.id}`,
      samples[field.id] ?? 'Valeur du cabinet',
      test.s.director,
    ]);
};
const storeKey = async (value: string) => {
  const id = randomUUID();
  await rows("INSERT INTO vault_secrets (id, name, value_cipher) VALUES ($1, 'RESEND_API_KEY', $2)", [id, new Vault(test.config).seal(id, value)]);
};

beforeAll(async () => {
  test = await startApp();
  worker = startMailWorker(test, { http, now: () => workerNow });
  clock(at(WORKING, '10:30'));
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});

describe('a reminder from a case', () => {
  it('is refused while a value of the firm is between brackets', async () => {
    const made = await eligible(test.s.officerA);
    expect((await remind('officerA', made)).body).toEqual({ code: 'FIRM_INCOMPLETE' });
    expect(await sendings(made.id)).toEqual([]);
    await fillFirm();
  });

  it('is written with the request, then leaves simulated without the key of the provider', async () => {
    const made = await eligible(test.s.officerA);
    // The code of the debtor, drawn when a colleague first shows it.
    const { code } = (await call('officerA', 'GET', `/cases/${made.id}/access-code`)).body as { code: string };
    expect((await remind('officerA', made, { template: 'FIRM' })).status).toBe(204);
    expect(await sendings(made.id)).toEqual([{ status: 'QUEUED', simulated: false, provider_ref: null, failure: null, level: 2 }]);
    // The history says nothing before it has left (question 219).
    expect(await events(made.id, 'REMINDER_SENT')).toEqual([]);
    await worker.run();
    expect(await sendings(made.id)).toEqual([{ status: 'SENT', simulated: true, provider_ref: null, failure: null, level: 2 }]);
    // In the name of the colleague who asked.
    const [{ name }] = (await rows<{ name: string }>("SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1", [test.s.officerA])) as [
      { name: string },
    ];
    expect(await events(made.id, 'REMINDER_SENT')).toEqual([{ title: 'Relance envoyée', detail: 'E-mail · niveau 2', actor_label: name }]);
    expect(asked).toEqual([]);
    const [message] = worker.simulated.splice(0);
    expect(message).toMatchObject({ to: made.email, from: 'LEGAREC <ne-pas-repondre@mail.legarec.fr>', replyTo: 'recouvrement@legarec.fr' });
    expect(message!.subject).toBe('Important : facture F-2026-0712 toujours impayée');
    // The address was confirmed by a colleague: the code leaves with it, in the page only.
    expect(message!.html).toContain(code);
    expect(message!.subject).not.toContain(code);
    expect(message!.html).toMatch(/18\s600,00\s€/u);
    // Neither the address, nor the code in what the API and the worker wrote down.
    for (const line of test.logs) {
      expect(line).not.toContain(made.email);
      // The bare code, wherever it would stand: quoted or not, alone or in a sentence.
      expect(line).not.toMatch(new RegExp(`\\b${code}\\b`, 'u'));
    }
    expect(await rows('SELECT payload FROM outbox WHERE name = $1 AND payload ->> $2 = $3', ['case-reminder', 'case', made.id])).toEqual([
      { payload: { case: made.id, sending: expect.any(String) as string } },
    ]);
  });

  it('leaves without the code for an address nobody has confirmed', async () => {
    const made = await eligible(test.s.officerA, { verified: false });
    const { code } = (await call('officerA', 'GET', `/cases/${made.id}/access-code`)).body as { code: string };
    expect((await remind('officerA', made)).status).toBe(204);
    await worker.run();
    const [message] = worker.simulated.splice(0);
    expect(message!.to).toBe(made.email);
    expect(message!.html).not.toContain(`>${code}<`);
    expect(message!.html).not.toMatch(new RegExp(`\\b${code}\\b`, 'u'));
  });

  it('is refused with its reason: channel, individual, first letter, closed case, address', async () => {
    const made = await eligible(test.s.officerA);
    // Texts are with lot R, the registered letter with the letters (question 210).
    expect((await remind('officerA', made, { channel: 'SMS' })).body).toEqual({ code: 'NOT_AVAILABLE' });
    expect((await remind('officerA', made, { channel: 'REGISTERED_LETTER' })).body).toEqual({ code: 'NOT_AVAILABLE' });
    expect((await remind('officerA', made, { channel: 'E-mail' })).status).toBe(422);
    expect((await remind('officerA', made, { recipient: 'autre@resend.dev' })).body).toEqual({ code: 'UNKNOWN_RECIPIENT' });
    const individual = await eligible(test.s.officerA, { kind: 'INDIVIDUAL' });
    expect((await remind('officerA', individual)).body).toEqual({ code: 'INDIVIDUAL' });
    const noLetter = await eligible(test.s.officerA, { firstLetter: false });
    const refusal = await remind('officerA', noLetter);
    expect([refusal.status, refusal.body]).toEqual([409, { code: 'NO_FIRST_LETTER' }]);
    const wrong = await eligible(test.s.officerA);
    await rows("UPDATE case_contacts SET status = 'INVALID', is_primary = false, invalidated_at = now() WHERE case_id = $1", [wrong.id]);
    expect((await remind('officerA', wrong)).body).toEqual({ code: 'NO_EMAIL' });
    const closed = await eligible(test.s.officerA);
    await rows("UPDATE cases SET status = 'LOST', closed_on = current_date WHERE id = $1", [closed.id]);
    expect((await remind('officerA', closed)).body).toEqual({ code: 'CASE_CLOSED' });
    for (const item of [made, individual, noLetter, wrong, closed]) expect(await sendings(item.id)).toEqual([]);
  });

  it('only leaves from a case one acts on', async () => {
    const made = await eligible(test.s.officerA);
    expect((await remind('officerB', made)).status).toBe(404);
    // The Director reads every case, and acts on theirs only; the Developer reads none.
    expect((await remind('director', made)).status).toBe(403);
    expect((await remind('developer', made)).status).toBe(403);
    expect((await remind('manager', made)).status).toBe(204);
    expect((await sendings(made.id)).length).toBe(1);
    await worker.run();
    worker.simulated.splice(0);
  });

  it('follows the hours of Paramètres › Relances, never a Sunday nor a public holiday', async () => {
    const made = await eligible(test.s.officerA);
    clock(at(WORKING, '21:30'));
    expect((await remind('officerA', made)).body).toEqual({ code: 'OUTSIDE_HOURS' });
    const sunday = new Date(Date.parse(`${WORKING}T12:00:00Z`) + ((7 - new Date(`${WORKING}T12:00:00Z`).getUTCDay()) % 7) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    clock(at(sunday, '10:30'));
    expect((await remind('officerA', made)).body).toEqual({ code: 'OUTSIDE_HOURS' });
    clock(at('2027-05-01', '10:30'));
    expect((await remind('officerA', made)).body).toEqual({ code: 'OUTSIDE_HOURS' });
    clock(at(WORKING, '10:30'));
    expect(await sendings(made.id)).toEqual([]);
  });

  it('stops at the cap of the debtor, whatever the creditor, even when colleagues send together', async () => {
    const mine = await eligible(test.s.officerA);
    const theirs = await eligible(test.s.officerB, { debtor: mine.debtor });
    // Two e-mails a week by default: six asked at the same moment for the same debtor, two leave.
    const answers = await Promise.all([0, 1, 2].flatMap(() => [remind('officerA', mine), remind('officerB', theirs)]));
    expect(answers.map((item) => item.status).sort()).toEqual([204, 204, 409, 409, 409, 409]);
    expect(answers.filter((item) => item.status === 409).map((item) => item.body)).toEqual(Array(4).fill({ code: 'CONTACT_CAP' }));
    expect((await remind('officerA', mine)).body).toEqual({ code: 'CONTACT_CAP' });
    // What failed before leaving does not count.
    await rows("UPDATE sendings SET status = 'FAILED', failure = 'PROVIDER_REFUSED' WHERE id = (SELECT id FROM sendings WHERE case_id IN ($1, $2) LIMIT 1)", [
      mine.id,
      theirs.id,
    ]);
    expect((await remind('officerA', mine)).status).toBe(204);
    await rows("UPDATE outbox SET done_at = now() WHERE name = 'case-reminder' AND done_at IS NULL");
  });
});

describe('the reminder leaves by the provider', () => {
  const KEY = 're_test_0123456789';
  beforeAll(() => storeKey(KEY));

  it('once, with the key of the vault, and keeps the reference', async () => {
    const made = await eligible(test.s.officerA);
    expect((await remind('officerA', made, { template: 'FORMAL_NOTICE' })).status).toBe(204);
    await worker.run();
    expect(await sendings(made.id)).toEqual([{ status: 'SENT', simulated: false, provider_ref: 'ref-1', failure: null, level: 3 }]);
    expect(worker.simulated).toEqual([]);
    const [request] = asked.splice(0);
    expect(request!.url).toBe('https://api.resend.com/emails');
    expect(request!.headers.authorization).toBe(`Bearer ${KEY}`);
    const [{ id }] = (await rows<{ id: string }>('SELECT id FROM sendings WHERE case_id = $1', [made.id])) as [{ id: string }];
    expect(request!.headers['idempotency-key']).toBe(`sending/${id}`);
    const sent = JSON.parse(request!.body) as { to: string[]; subject: string; reply_to: string };
    expect(sent).toMatchObject({ to: [made.email], reply_to: 'recouvrement@legarec.fr', subject: 'DERNIER AVIS avant procédure : facture F-2026-0712' });
    // Delivered again, the task sends nothing more.
    await rows("UPDATE outbox SET done_at = NULL, published_at = NULL, started_at = NULL, claimed_at = NULL WHERE payload ->> 'sending' = $1", [id]);
    await worker.run();
    expect(asked).toEqual([]);
    // The key is in no log, no table but the vault, and no queue.
    for (const line of test.logs) expect(line).not.toContain(KEY);
    expect(await rows('SELECT 1 FROM outbox WHERE payload::text LIKE $1', [`%${KEY}%`])).toEqual([]);
  });

  it('never writes, outside production, to an address that is neither a test one nor listed by the firm', async () => {
    const real = await eligible(test.s.officerA, { email: 'compta@entreprise-reelle.example' });
    const listed = await eligible(test.s.officerA, { email: 'recette@legarec.test' });
    expect((await remind('officerA', real)).status).toBe(204);
    expect((await remind('officerA', listed)).status).toBe(204);
    await worker.run().catch(() => undefined);
    expect(await sendings(real.id)).toEqual([{ status: 'FAILED', simulated: false, provider_ref: null, failure: 'DEV_RECIPIENT', level: 1 }]);
    expect(await sendings(listed.id)).toMatchObject([{ status: 'SENT', simulated: false }]);
    expect(asked.splice(0).map((request) => (JSON.parse(request.body) as { to: string[] }).to)).toEqual([['recette@legarec.test']]);
    expect(await rows("SELECT title, tone::text FROM case_events WHERE case_id = $1 AND kind = 'REMINDER_FAILED'", [real.id])).toEqual([
      { title: 'Relance non envoyée', tone: 'danger' },
    ]);
  });

  it('says « failed » when the provider refuses, « uncertain » when nothing clear comes back, and never tries again', async () => {
    const refusedCase = await eligible(test.s.officerA);
    answer = () => Promise.resolve({ status: 422, json: () => Promise.resolve({ message: 'Invalid `to` field' }) });
    expect((await remind('officerA', refusedCase)).status).toBe(204);
    await worker.run().catch(() => undefined);
    expect(await sendings(refusedCase.id)).toMatchObject([{ status: 'FAILED', failure: 'PROVIDER_REFUSED', provider_ref: null }]);
    // A failed one does not count against the debtor.
    const cut = await eligible(test.s.officerA);
    answer = () => Promise.reject(new Error(`socket hang up while writing to ${cut.email}`));
    expect((await remind('officerA', cut)).status).toBe(204);
    await worker.run().catch(() => undefined);
    expect(await sendings(cut.id)).toMatchObject([{ status: 'UNCERTAIN', failure: null }]);
    expect(await rows("SELECT failure FROM outbox WHERE payload ->> 'case' = $1", [cut.id])).toEqual([{ failure: 'UNCERTAIN' }]);
    asked.splice(0);
    answer = () => Promise.resolve({ status: 200, json: () => Promise.resolve({ id: 'ref-2' }) });
    // Published again by mistake: the line is taken, nothing leaves.
    await rows("UPDATE outbox SET failed_at = NULL, failure = NULL, published_at = NULL, started_at = NULL, claimed_at = NULL WHERE payload ->> 'case' = $1", [
      cut.id,
    ]);
    await worker.run();
    expect(asked).toEqual([]);
    expect(await sendings(cut.id)).toMatchObject([{ status: 'UNCERTAIN' }]);
    for (const line of test.logs) expect(line).not.toContain(cut.email);
  });
});

describe('a reminder that had to wait', () => {
  it('never leaves outside the hours: it waits again', async () => {
    const made = await eligible(test.s.officerA);
    expect((await remind('officerA', made)).status).toBe(204);
    workerNow = at(WORKING, '22:15');
    await worker.run().catch(() => undefined);
    expect(await sendings(made.id)).toMatchObject([{ status: 'QUEUED' }]);
    expect(asked).toEqual([]);
    expect(await rows("SELECT started_at, failed_at FROM outbox WHERE payload ->> 'case' = $1", [made.id])).toEqual([{ started_at: null, failed_at: null }]);
    workerNow = at(WORKING, '10:30');
    await rows("UPDATE outbox SET published_at = NULL, claimed_at = NULL WHERE payload ->> 'case' = $1", [made.id]);
    await worker.run();
    expect(await sendings(made.id)).toMatchObject([{ status: 'SENT', provider_ref: 'ref-2' }]);
    asked.splice(0);
  });
});

describe('the state of the case (question 218)', () => {
  it('refuses a reminder during a dispute or a litigation and while a plan is respected; a promise suspends nothing', async () => {
    for (const status of ['DISPUTE', 'LITIGATION']) {
      const made = await eligible(test.s.officerA);
      await rows('UPDATE cases SET status = $2::case_status WHERE id = $1', [made.id, status]);
      const refusal = await remind('officerA', made, { template: 'FORMAL_NOTICE' });
      expect([refusal.status, refusal.body]).toEqual([409, { code: 'CASE_DISPUTED' }]);
      expect(await sendings(made.id)).toEqual([]);
    }
    const plan = await eligible(test.s.officerA);
    const [{ creditor_id: creditor }] = (await rows<{ creditor_id: string }>('SELECT creditor_id FROM cases WHERE id = $1', [plan.id])) as [
      { creditor_id: string },
    ];
    const [{ id: planId }] = (await rows<{ id: string }>(
      `INSERT INTO payment_plans (case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by)
       VALUES ($1, $2, 1860000, 6, 'TRANSFER', '2026-12-05', 'ACTIVE', 6, false, $3) RETURNING id`,
      [plan.id, creditor, test.s.officerA],
    )) as [{ id: string }];
    expect((await remind('officerA', plan)).body).toEqual({ code: 'PLAN_RESPECTED' });
    // A plan that is no longer respected suspends nothing.
    await rows("UPDATE payment_plans SET status = 'DEFAULT' WHERE id = $1", [planId]);
    expect((await remind('officerA', plan)).status).toBe(204);
    const promise = await eligible(test.s.officerA);
    await rows("UPDATE cases SET status = 'PROMISE' WHERE id = $1", [promise.id]);
    expect((await remind('officerA', promise)).status).toBe(204);
    await worker.run();
    expect(await sendings(promise.id)).toMatchObject([{ status: 'SENT' }]);
    worker.simulated.splice(0);
    asked.splice(0);
  });
});

describe('what has changed between the request and the departure', () => {
  /** Asked, then changed before the worker runs: the line fails with this code, and the case says so. */
  const changed = async (change: (made: Made) => Promise<unknown>, failure: string, officer: 'officerA' | 'officerB' = 'officerA') => {
    const made = await eligible(test.s[officer]);
    expect((await remind(officer, made)).status).toBe(204);
    await change(made);
    await worker.run().catch(() => undefined);
    expect(await sendings(made.id)).toMatchObject([{ status: 'FAILED', failure, simulated: false, provider_ref: null }]);
    expect(await events(made.id, 'REMINDER_FAILED')).toMatchObject([{ title: 'Relance non envoyée', detail: null }]);
    expect(await events(made.id, 'REMINDER_SENT')).toEqual([]);
    return made;
  };

  it('stops it: closed case, address invalidated, individual, nothing due, dispute', async () => {
    await changed((made) => rows("UPDATE cases SET status = 'LOST', closed_on = current_date WHERE id = $1", [made.id]), 'CASE_CLOSED');
    await changed(
      (made) => rows("UPDATE case_contacts SET status = 'INVALID', is_primary = false, invalidated_at = now() WHERE case_id = $1", [made.id]),
      'NO_EMAIL',
    );
    await changed((made) => rows("UPDATE debtors SET kind = 'INDIVIDUAL', siren = NULL WHERE id = $1", [made.debtor]), 'INDIVIDUAL');
    await changed((made) => rows('DELETE FROM case_invoices WHERE case_id = $1', [made.id]), 'NOTHING_DUE');
    await changed((made) => rows("UPDATE cases SET status = 'DISPUTE' WHERE id = $1", [made.id]), 'CASE_DISPUTED');
    expect(asked).toEqual([]);
    expect(worker.simulated).toEqual([]);
  });

  it('fails, under the rights of the worker, when the colleague may no longer act on the case', async () => {
    const made = await changed((item) => rows('UPDATE cases SET officer_id = $2 WHERE id = $1', [item.id, test.s.officerB]), 'NOT_ALLOWED');
    expect(await rows("SELECT failure FROM outbox WHERE payload ->> 'case' = $1", [made.id])).toEqual([{ failure: 'NOT_ALLOWED' }]);
  });

  it('fails at the next sweep when its task was abandoned before the line was taken: no line stays queued', async () => {
    const made = await eligible(test.s.officerB);
    expect((await remind('officerB', made)).status).toBe(204);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.officerB]);
    await worker.run().catch(() => undefined);
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [test.s.officerB]);
    expect(await rows("SELECT failure FROM outbox WHERE payload ->> 'case' = $1", [made.id])).toEqual([{ failure: 'AUTHOR_GONE' }]);
    expect(await sendings(made.id)).toMatchObject([{ status: 'QUEUED' }]);
    expect(await sweepSendings(worker.asWorker, workerNow)).toBe(1);
    expect(await sendings(made.id)).toMatchObject([{ status: 'FAILED', failure: 'AUTHOR_GONE' }]);
    expect(await events(made.id, 'REMINDER_FAILED')).toMatchObject([{ title: 'Relance non envoyée', actor_label: 'Application' }]);
    // Once: a second sweep finds nothing.
    expect(await sweepSendings(worker.asWorker, workerNow)).toBe(0);
    expect((await events(made.id, 'REMINDER_FAILED')).length).toBe(1);
  });

  it('waits while a value of the firm is between brackets, whatever the name of the debtor', async () => {
    const made = await eligible(test.s.officerA);
    await rows('UPDATE debtors SET name = $2 WHERE id = $1', [made.debtor, '[ABC Industrie] SARL']);
    expect((await remind('officerA', made)).status).toBe(204);
    const [kept] = await rows<{ key: string; value: unknown; updated_by: string }>(
      "DELETE FROM settings WHERE key = 'firm.cabinet.siren' RETURNING key, value, updated_by",
    );
    await worker.run().catch(() => undefined);
    expect(await sendings(made.id)).toMatchObject([{ status: 'QUEUED' }]);
    expect(await rows("SELECT started_at, failed_at FROM outbox WHERE payload ->> 'case' = $1", [made.id])).toEqual([{ started_at: null, failed_at: null }]);
    await rows('INSERT INTO settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)', [kept!.key, JSON.stringify(kept!.value), kept!.updated_by]);
    await rows("UPDATE outbox SET published_at = NULL, claimed_at = NULL WHERE payload ->> 'case' = $1", [made.id]);
    await worker.run();
    // The brackets of the debtor are its name, not a value to type: it leaves.
    expect(await sendings(made.id)).toMatchObject([{ status: 'SENT' }]);
    const { html } = JSON.parse(asked.splice(0)[0]!.body) as { html: string };
    expect(html.includes('<strong>[ABC Industrie] SARL</strong>')).toBe(true);
  });
});

describe('a reminder that has waited too long', () => {
  const hours = contactHours(() => '09:00–19:00');
  it('may leave until the end of the next day the firm writes on, in Paris', () => {
    // A Friday of winter: until the end of Saturday. A Saturday: Sunday is skipped, until the end of Monday.
    expect(sendingDeadline(new Date('2026-11-27T09:30:00Z'), hours).toISOString()).toBe('2026-11-28T23:00:00.000Z');
    expect(sendingDeadline(new Date('2026-11-28T09:30:00Z'), hours).toISOString()).toBe('2026-11-30T23:00:00.000Z');
    // Summer, the eve of a public holiday (14 July 2027 is a Wednesday): until the end of Thursday.
    expect(sendingDeadline(new Date('2027-07-13T08:00:00Z'), hours).toISOString()).toBe('2027-07-15T22:00:00.000Z');
    // Asked just after midnight in Paris: it is already the next day.
    expect(sendingDeadline(new Date('2026-11-26T23:30:00Z'), hours).toISOString()).toBe('2026-11-28T23:00:00.000Z');
  });

  it('fails as expired when its task runs too late, and at the sweep when it never runs', async () => {
    const late = await eligible(test.s.officerA);
    const never = await eligible(test.s.officerA);
    expect((await remind('officerA', late)).status).toBe(204);
    expect((await remind('officerA', never)).status).toBe(204);
    const kept = workerNow;
    // Two weeks later, at a working hour.
    workerNow = new Date(at(WORKING, '10:30').getTime() + 14 * 86_400_000);
    await rows("UPDATE outbox SET run_at = now() + interval '1 hour' WHERE payload ->> 'case' = $1", [never.id]);
    await worker.run().catch(() => undefined);
    expect(await sendings(late.id)).toMatchObject([{ status: 'FAILED', failure: 'EXPIRED' }]);
    expect(await sendings(never.id)).toMatchObject([{ status: 'QUEUED' }]);
    // Before its time, the sweep leaves it; after, it fails and the case says so.
    expect(await sweepSendings(worker.asWorker, kept)).toBe(0);
    expect(await sweepSendings(worker.asWorker, workerNow)).toBeGreaterThanOrEqual(1);
    expect(await sendings(never.id)).toMatchObject([{ status: 'FAILED', failure: 'EXPIRED' }]);
    expect(await events(never.id, 'REMINDER_FAILED')).toMatchObject([{ title: 'Relance non envoyée' }]);
    workerNow = kept;
    // Its task, when it comes, sends nothing.
    await rows("UPDATE outbox SET run_at = NULL WHERE payload ->> 'case' = $1", [never.id]);
    await worker.run();
    expect(asked).toEqual([]);
    expect(await rows("SELECT done_at IS NOT NULL AS done FROM outbox WHERE payload ->> 'case' = $1", [never.id])).toEqual([{ done: true }]);
  });
});

describe('the rules the database holds by itself', () => {
  it('a line goes forward only: queued, taken, then sent or failed; a settled one never changes', async () => {
    const made = await eligible(test.s.officerA);
    const [{ creditor_id: creditor, contact }] = (await rows<{ creditor_id: string; contact: string }>(
      'SELECT c.creditor_id, k.id AS contact FROM cases c JOIN case_contacts k ON k.case_id = c.id WHERE c.id = $1',
      [made.id],
    )) as [{ creditor_id: string; contact: string }];
    const insert = (status: string) =>
      rows<{ id: string }>(
        "INSERT INTO sendings (case_id, creditor_id, channel, template, level, contact_id, status, created_by) VALUES ($1, $2, 'EMAIL', 'FRIENDLY', 1, $3, $4::sending_status, $5) RETURNING id",
        [made.id, creditor, contact, status, test.s.officerA],
      ).then(
        ([row]) => row!.id,
        (error: { code?: string }) => String(error.code),
      );
    const move = (id: string, set: string) =>
      rows(`UPDATE sendings SET ${set} WHERE id = $1`, [id]).then(
        () => 'done',
        (error: { code?: string }) => String(error.code),
      );
    for (const status of ['SENT', 'FAILED', 'UNCERTAIN']) expect(await insert(status)).toBe('42501');
    const first = await insert('QUEUED');
    // Never sent without having been taken.
    expect(await move(first, "status = 'SENT', sent_at = now()")).toBe('42501');
    expect(await move(first, "status = 'UNCERTAIN'")).toBe('done');
    expect(await move(first, "status = 'QUEUED'")).toBe('42501');
    expect(await move(first, "status = 'SENT', sent_at = now(), provider_ref = 'ref-9'")).toBe('done');
    for (const set of ["status = 'QUEUED'", "status = 'UNCERTAIN'", "status = 'FAILED', failure = 'LATE'", "provider_ref = 'other'", "status = 'SENT'"])
      expect(await move(first, set), set).toBe('42501');
    const second = await insert('QUEUED');
    expect(await move(second, "status = 'FAILED', failure = 'EXPIRED'")).toBe('done');
    for (const set of ["status = 'QUEUED', failure = NULL", "status = 'UNCERTAIN', failure = NULL", "status = 'SENT', failure = NULL"])
      expect(await move(second, set), set).toBe('42501');
    // Whom it is for and who asked never change.
    const third = await insert('QUEUED');
    expect(await move(third, 'level = 3')).toBe('42501');
    expect(await move(third, 'created_by = (SELECT id FROM users WHERE id <> created_by LIMIT 1)')).toBe('42501');
    await rows('DELETE FROM sendings WHERE id = ANY($1::uuid[])', [[first, second, third]]);
  });

  it('a line never points at the coordinate nor the document of another case', async () => {
    const mine = await eligible(test.s.officerA);
    const other = await eligible(test.s.officerA);
    const [{ creditor_id: creditor }] = (await rows<{ creditor_id: string }>('SELECT creditor_id FROM cases WHERE id = $1', [mine.id])) as [
      { creditor_id: string },
    ];
    const [{ id: theirs }] = (await rows<{ id: string }>('SELECT id FROM case_contacts WHERE case_id = $1', [other.id])) as [{ id: string }];
    const refusedBy = (sql: string, values: unknown[]) =>
      rows(sql, values).then(
        () => 'done',
        (error: { code?: string; constraint?: string }) => `${error.code} ${error.constraint}`,
      );
    expect(
      await refusedBy(
        "INSERT INTO sendings (case_id, creditor_id, channel, template, level, contact_id, created_by) VALUES ($1, $2, 'EMAIL', 'FRIENDLY', 1, $3, $4)",
        [mine.id, creditor, theirs, test.s.officerA],
      ),
    ).toBe('23503 sendings_contact_id_case_id_fkey');
    // As a colleague too, whatever the case they act on.
    expect(
      await asStaff(test.s.officerA, (tx) =>
        tx.sending.create({
          data: { caseId: mine.id, creditorId: creditor, channel: 'EMAIL', template: 'FRIENDLY', level: 1, contactId: theirs },
          select: { id: true },
        }),
      ),
    ).toBe('23503');
    const [{ id: document }] = (await rows<{ id: string }>('SELECT gen_random_uuid() AS id')) as [{ id: string }];
    const [{ id: mineContact }] = (await rows<{ id: string }>('SELECT id FROM case_contacts WHERE case_id = $1', [mine.id])) as [{ id: string }];
    expect(
      await refusedBy(
        "INSERT INTO sendings (case_id, creditor_id, channel, template, level, contact_id, document_id, created_by) VALUES ($1, $2, 'EMAIL', 'FRIENDLY', 1, $3, $4, $5)",
        [mine.id, creditor, mineContact, document, test.s.officerA],
      ),
    ).toBe('23503 sendings_document_id_case_id_fkey');
  });

  it('nothing is added to an anonymized case, and a colleague never says what has left', async () => {
    const made = await eligible(test.s.officerA);
    const [{ creditor_id: creditor, contact }] = (await rows<{ creditor_id: string; contact: string }>(
      'SELECT c.creditor_id, k.id AS contact FROM cases c JOIN case_contacts k ON k.case_id = c.id WHERE c.id = $1',
      [made.id],
    )) as [{ creditor_id: string; contact: string }];
    const data = { caseId: made.id, creditorId: creditor, channel: 'EMAIL', template: 'FRIENDLY', level: 1, contactId: contact } as const;
    // The status, the reference and the failure are the worker's.
    expect(await asStaff(test.s.officerA, (tx) => tx.sending.create({ data: { ...data, status: 'SENT' }, select: { id: true } }))).toBe('42501');
    const made1 = await asStaff(test.s.officerA, (tx) => tx.sending.create({ data, select: { id: true } }));
    expect(made1).toEqual({ id: expect.any(String) as string });
    expect(await asStaff(test.s.officerA, (tx) => tx.sending.updateMany({ where: { caseId: made.id }, data: { status: 'FAILED' } }))).toBe('42501');
    expect(await asStaff(test.s.officerA, (tx) => tx.sending.deleteMany({ where: { caseId: made.id } }))).toBe('42501');
    await rows("UPDATE cases SET status = 'LOST', closed_on = current_date - 2000, anonymized_at = now() WHERE id = $1", [made.id]);
    expect(await asStaff(test.s.officerA, (tx) => tx.sending.create({ data, select: { id: true } }))).toBe('42501');
    // Nor changed, even by the worker.
    expect(await asWorker((tx) => tx.sending.updateMany({ where: { caseId: made.id }, data: { status: 'FAILED', failure: 'EXPIRED' } }))).toEqual({ count: 0 });
  });

  it('the contacts of a debtor are only counted by whoever acts on the case', async () => {
    const made = await eligible(test.s.officerA);
    const count = (userId: string, wanted = 'EMAIL') =>
      asStaff(
        userId,
        (tx) => tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${made.id}::uuid, ${wanted}, '2026-01-01'::date, '2099-01-01'::date) AS count`,
      );
    expect(await count(test.s.officerA)).toEqual([{ count: 0 }]);
    expect(await count(test.s.officerA, 'LETTER')).toEqual([{ count: 0 }]);
    // Another officer does not read the case; the Director reads it without acting on it.
    expect(await count(test.s.officerB)).toBe('42501');
    expect(
      await test.pool
        .run(
          { kind: 'staff', userId: test.s.director, role: 'DIRECTOR', delegations: [] },
          (tx) => tx.$queryRaw`SELECT app.sent_contacts(${made.id}::uuid, 'EMAIL', '2026-01-01'::date, '2099-01-01'::date)`,
        )
        .catch(databaseCode),
    ).toBe('42501');
    expect(await count(test.s.officerA, 'SMS')).toBe('42501');
    expect(await asWorker((tx) => tx.$queryRaw`SELECT app.sent_contacts(${made.id}::uuid, 'EMAIL', '2026-01-01'::date, '2099-01-01'::date)`)).toBe('42501');
  });

  it('a sending counts on the day it left, not on the day it was asked', async () => {
    const made = await eligible(test.s.officerA);
    expect((await remind('officerA', made)).status).toBe(204);
    const count = (from: string, to: string) =>
      asStaff(
        test.s.officerA,
        (tx) => tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${made.id}::uuid, 'EMAIL', ${from}::date, ${to}::date) AS count`,
      );
    // It still waits: counted on the day it was asked.
    const [{ day }] = (await rows<{ day: string }>(
      "SELECT to_char(created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day FROM sendings WHERE case_id = $1",
      [made.id],
    )) as [{ day: string }];
    expect(await count(day, day)).toEqual([{ count: 1 }]);
    await rows("UPDATE sendings SET status = 'UNCERTAIN' WHERE case_id = $1", [made.id]);
    await rows("UPDATE sendings SET status = 'SENT', sent_at = '2031-06-03 10:00+02' WHERE case_id = $1", [made.id]);
    expect(await count(day, day)).toEqual([{ count: 0 }]);
    expect(await count('2031-06-03', '2031-06-03')).toEqual([{ count: 1 }]);
    await rows("UPDATE outbox SET done_at = now() WHERE payload ->> 'case' = $1", [made.id]);
  });

  it('the key of a service is for the worker alone, by its name, and only while it is valid', async () => {
    await rows("DELETE FROM vault_secrets WHERE name = 'RESEND_API_KEY'");
    const key = (wanted: string) => (tx: Transaction) => tx.$queryRaw<{ id: string | null }[]>`SELECT id FROM app.service_key(${wanted})`;
    const ready = (wanted: string) => (tx: Transaction) => tx.$queryRaw<{ ready: boolean }[]>`SELECT app.service_ready(${wanted}) AS ready`;
    expect(await asWorker(key('RESEND_API_KEY'))).toEqual([{ id: null }]);
    expect(await asStaff(test.s.officerA, ready('RESEND_API_KEY'))).toEqual([{ ready: false }]);
    await storeKey('re_test_abcdefgh');
    const [{ id }] = (await rows<{ id: string }>("SELECT id FROM vault_secrets WHERE name = 'RESEND_API_KEY'")) as [{ id: string }];
    expect(await asWorker(key('RESEND_API_KEY'))).toEqual([{ id }]);
    expect(await asStaff(test.s.officerA, ready('RESEND_API_KEY'))).toEqual([{ ready: true }]);
    // Nobody else reads it, and no other secret is read through it.
    expect(await asStaff(test.s.officerA, key('RESEND_API_KEY'))).toBe('42501');
    expect(await test.pool.run({ kind: 'staff', userId: test.s.director, role: 'DIRECTOR', delegations: [] }, key('RESEND_API_KEY')).catch(databaseCode)).toBe(
      '42501',
    );
    for (const name of ['ACCESS_CODE_KEY', 'LOOKUP_KEY', 'OVH_SMS_KEY', '']) {
      expect(await asWorker(key(name)), name).toBe('42501');
      expect(await asStaff(test.s.officerA, ready(name)), name).toBe('42501');
    }
    // The yes or no is for the team: the worker has the key itself.
    expect(await asWorker(ready('RESEND_API_KEY'))).toBe('42501');
    // A key being revoked no longer serves.
    for (const status of ['REVOKE_PENDING', 'REVOKED']) {
      await rows("UPDATE vault_secrets SET status = $2::secret_status, value_cipher = CASE WHEN $2 = 'REVOKED' THEN NULL ELSE value_cipher END WHERE id = $1", [
        id,
        status,
      ]);
      expect(await asWorker(key('RESEND_API_KEY')), status).toEqual([{ id: null }]);
      expect(await asStaff(test.s.officerA, ready('RESEND_API_KEY')), status).toEqual([{ ready: false }]);
    }
    await rows("DELETE FROM vault_secrets WHERE name = 'RESEND_API_KEY'");
  });
});

describe('the agenda', () => {
  it('counts what left this week on the cases one reads only', async () => {
    const weekly = async (as: string) => ((await call(as, 'GET', '/reminders')).body as { weekly: { emails: number } }).weekly.emails;
    const before = { a: await weekly('officerA'), b: await weekly('officerB'), manager: await weekly('manager') };
    const made = await eligible(test.s.officerA);
    expect((await remind('officerA', made)).status).toBe(204);
    expect(await weekly('officerA')).toBe(before.a + 1);
    expect(await weekly('manager')).toBe(before.manager + 1);
    expect(await weekly('officerB')).toBe(before.b);
    await rows("UPDATE outbox SET done_at = now() WHERE payload ->> 'case' = $1", [made.id]);
  });
});

describe('in production', () => {
  it('a reminder waits for the key of the provider: nothing is simulated', async () => {
    await rows("DELETE FROM vault_secrets WHERE name = 'RESEND_API_KEY'");
    const made = await eligible(test.s.officerA);
    expect((await remind('officerA', made)).status).toBe(204);
    await worker.stop();
    worker = startMailWorker(test, { http, production: true, now: () => workerNow });
    await worker.run().catch(() => undefined);
    expect(await sendings(made.id)).toMatchObject([{ status: 'QUEUED', simulated: false }]);
    expect(worker.simulated).toEqual([]);
    expect(asked).toEqual([]);
    await rows("UPDATE outbox SET done_at = now() WHERE payload ->> 'case' = $1", [made.id]);
  });
});

describe('with a key, the guard of the recipients', () => {
  it('holds under NODE_ENV=production as long as RESEND_ENV does not say production', async () => {
    await storeKey('re_test_guard');
    const real = await eligible(test.s.officerA, { email: 'compta@entreprise-reelle.example' });
    expect((await remind('officerA', real)).status).toBe(204);
    // The worker of the last test: production, without RESEND_ENV.
    await worker.run().catch(() => undefined);
    expect(await sendings(real.id)).toMatchObject([{ status: 'FAILED', failure: 'DEV_RECIPIENT' }]);
    expect(asked).toEqual([]);
    const again = await eligible(test.s.officerA, { email: 'compta@entreprise-reelle.example' });
    expect((await remind('officerA', again)).status).toBe(204);
    await worker.stop();
    worker = startMailWorker(test, { http, production: true, real: true, now: () => workerNow });
    await worker.run();
    expect(await sendings(again.id)).toMatchObject([{ status: 'SENT', simulated: false }]);
    expect(asked.splice(0).map((request) => (JSON.parse(request.body) as { to: string[] }).to)).toEqual([['compta@entreprise-reelle.example']]);
  });

  it('in production, a request is refused while the service has no valid key: nothing would be simulated', async () => {
    const made = await eligible(test.s.officerA);
    const production = new SendingsService(test.pool, test.app.get(Outbox), { ...test.app.get(CONFIG), NODE_ENV: 'production' }, test.app.get(Clock));
    const ask = () =>
      test.pool
        .run({ kind: 'staff', userId: test.s.officerA, role: 'CLAIMS_OFFICER', delegations: [] }, () =>
          production.remind(made.id, { channel: 'EMAIL', template: 'FRIENDLY', recipient: made.email }),
        )
        .then(
          () => 'queued',
          (error: { status?: number; code?: string }) => `${error.status} ${error.code}`,
        );
    await rows("UPDATE vault_secrets SET status = 'REVOKE_PENDING' WHERE name = 'RESEND_API_KEY'");
    expect(await ask()).toBe('409 SERVICE_NOT_READY');
    expect(await sendings(made.id)).toEqual([]);
    await rows("UPDATE vault_secrets SET status = 'VALID' WHERE name = 'RESEND_API_KEY'");
    expect(await ask()).toBe('queued');
    await rows("UPDATE outbox SET done_at = now() WHERE payload ->> 'case' = $1", [made.id]);
  });
});

describe('the sweep and a line a task has taken', () => {
  const abandoned = async () => {
    const made = await eligible(test.s.officerA);
    expect((await remind('officerA', made)).status).toBe(204);
    await rows("UPDATE outbox SET failed_at = now(), failure = 'AUTHOR_GONE' WHERE payload ->> 'case' = $1", [made.id]);
    return made;
  };
  const late = () => new Date(Date.now() + 14 * 86_400_000);

  it('never fails a line already taken, whatever its task says and however old it is', async () => {
    const made = await abandoned();
    await rows("UPDATE sendings SET status = 'UNCERTAIN' WHERE case_id = $1", [made.id]);
    await sweepSendings(worker.asWorker, late());
    expect(await sendings(made.id)).toMatchObject([{ status: 'UNCERTAIN', failure: null }]);
    expect(await events(made.id, 'REMINDER_FAILED')).toEqual([]);
  });

  it('leaves alone a line taken between its reading and its writing: the message may have left', async () => {
    const made = await abandoned();
    let calls = 0;
    // The sweep reads first; a task takes the line before the sweep writes.
    const raced: typeof worker.asWorker = async (work) => {
      if ((calls += 1) === 2) await rows("UPDATE sendings SET status = 'UNCERTAIN' WHERE case_id = $1 AND status = 'QUEUED'", [made.id]);
      return worker.asWorker(work);
    };
    await sweepSendings(raced, late());
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(await sendings(made.id)).toMatchObject([{ status: 'UNCERTAIN', failure: null }]);
    expect(await events(made.id, 'REMINDER_FAILED')).toEqual([]);
    // Left alone, the same line fails.
    const other = await abandoned();
    await sweepSendings(worker.asWorker, workerNow);
    expect(await sendings(other.id)).toMatchObject([{ status: 'FAILED', failure: 'AUTHOR_GONE' }]);
  });

  it('says « Relance envoyée » for a line sent whose task was cut before the history said so, once', async () => {
    const made = await eligible(test.s.officerA);
    expect((await remind('officerA', made, { template: 'FIRM' })).status).toBe(204);
    await rows("UPDATE outbox SET failed_at = now(), failure = 'UNCERTAIN' WHERE payload ->> 'case' = $1", [made.id]);
    await rows("UPDATE sendings SET status = 'UNCERTAIN' WHERE case_id = $1", [made.id]);
    await rows("UPDATE sendings SET status = 'SENT', sent_at = now() - interval '1 minute' WHERE case_id = $1", [made.id]);
    // Too recent: its task may still be writing.
    await sweepSendings(worker.asWorker, new Date());
    expect(await events(made.id, 'REMINDER_SENT')).toEqual([]);
    await sweepSendings(worker.asWorker, new Date(Date.now() + 5 * 60_000));
    await sweepSendings(worker.asWorker, new Date(Date.now() + 10 * 60_000));
    expect(await events(made.id, 'REMINDER_SENT')).toEqual([{ title: 'Relance envoyée', detail: 'E-mail · niveau 2', actor_label: 'Application' }]);
  });

  it('counts in the week of the agenda on the day it left, as the caps do', async () => {
    const weekly = async () => ((await call('officerA', 'GET', '/reminders')).body as { weekly: { emails: number } }).weekly.emails;
    const made = await eligible(test.s.officerA);
    const before = await weekly();
    await rows(
      `INSERT INTO sendings (case_id, creditor_id, channel, template, level, contact_id, created_by, created_at)
       SELECT c.id, c.creditor_id, 'EMAIL', 'FRIENDLY', 1, k.id, $2, now() - interval '8 days' FROM cases c JOIN case_contacts k ON k.case_id = c.id WHERE c.id = $1`,
      [made.id, test.s.officerA],
    );
    // Asked last week and still waiting: last week's.
    expect(await weekly()).toBe(before);
    await rows("UPDATE sendings SET status = 'UNCERTAIN' WHERE case_id = $1", [made.id]);
    await rows("UPDATE sendings SET status = 'SENT', sent_at = now() WHERE case_id = $1", [made.id]);
    expect(await weekly()).toBe(before + 1);
  });
});
