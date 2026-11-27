import { firmGroups, publicHolidays } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import type { HttpClient } from '../../emails/resend';
import { PLACEHOLDER } from '../../platform/pdf/pdf';
import { Vault } from '../vault/vault';
import { SendingsService } from './sendings.service';

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
  test.app.get(SendingsService).now = () => now;
};

interface Made {
  id: string;
  debtor: string;
  email: string;
}
/** A company with a first letter and an address to write to, held by `officer`. */
const eligible = async (officer: string, options: { debtor?: string; email?: string; verified?: boolean; kind?: string; firstLetter?: boolean } = {}): Promise<Made> => {
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
    expect(await rows("SELECT title, detail FROM case_events WHERE case_id = $1 AND kind = 'REMINDER_SENT'", [made.id])).toEqual([
      { title: 'Relance envoyée', detail: 'E-mail · niveau 2' },
    ]);
    await worker.run();
    expect(await sendings(made.id)).toEqual([{ status: 'SENT', simulated: true, provider_ref: null, failure: null, level: 2 }]);
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
      expect(line).not.toContain(`"${code}"`);
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
    const sunday = new Date(Date.parse(`${WORKING}T12:00:00Z`) + ((7 - new Date(`${WORKING}T12:00:00Z`).getUTCDay()) % 7) * 86_400_000).toISOString().slice(0, 10);
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
  });
});
