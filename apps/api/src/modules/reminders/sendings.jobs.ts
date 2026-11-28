import { contactHours, formatCents, reminderAmount, type AutomaticEmail } from '@legarec/contracts';
import type { AutomaticMessage, EmailsService } from '../../emails/emails.service';
import { allowedOutsideProduction, ProviderRefused, type ResendClient } from '../../emails/resend';
import { Audit } from '../../platform/audit/audit';
import { Keyring } from '../../platform/crypto/keyring';
import { databaseCode } from '../../platform/database/codes';
import type { Database, Transaction } from '../../platform/database/database';
import { dayOf, timeOf } from '../../platform/format';
import { GiveUp, TryLater } from '../../platform/queue/errors';
import { mayActOn, type JobDefinition, type Run } from '../../platform/queue/jobs';
import { bindingOf } from '../debtor-access/access-codes';
import { Ledgers, owedOf } from '../payments/ledger';
import { SettingValues } from '../settings/values';
import { sendingDeadline, suspensionOf } from './contact-rules';
import { keysIn } from '../vault/internal-keys';
import type { Vault } from '../vault/vault';

interface Parts {
  database: Database;
  vault: Vault;
  emails: Pick<EmailsService, 'compose' | 'firmIncomplete'>;
  resend: ResendClient;
  /** The rights of the worker, for what fails before the author has passed the check of the task. */
  asWorker: Run;
  /** In production, a missing key makes the sending wait; elsewhere it is simulated and nothing leaves the machine. */
  production: boolean;
  /**
   * `RESEND_ENV=production`, said in so many words: the reminders leave for the debtors. Without it, whatever NODE_ENV says,
   * a key only writes to the test addresses.
   */
  real: boolean;
  /** Addresses of the firm a test key may write to, outside production. */
  devRecipients: readonly string[];
  /** What a simulated sending does with the message (a private folder in development, nothing in the tests). */
  simulate(message: AutomaticMessage): Promise<void>;
  /** The hour it is; set by the tests, which run at any hour. */
  now?: () => Date;
}
const id = (value: unknown): string => {
  if (typeof value !== 'string') throw new GiveUp('NO_IDENTIFIER');
  return value;
};
const day = (value: string | Date) => {
  const iso = typeof value === 'string' ? value : value.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
const money = (cents: number) => formatCents(cents, { decimals: 'always' });
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;

/** What the reminder says, read with the rights of the colleague who sent it. Null: the case no longer allows it. */
async function factsOf(database: Database, vault: Vault, tx: Transaction, caseId: string, contactId: string, level: number) {
  const found = await tx.case.findFirst({
    where: { id: caseId, closedOn: null, anonymizedAt: null },
    select: {
      reference: true,
      status: true,
      _count: { select: { plans: { where: { status: 'ACTIVE' } } } },
      contactName: true,
      creditor: { select: { name: true } },
      debtor: { select: { name: true, siren: true, kind: true } },
      contacts: { where: { id: contactId, kind: 'EMAIL', status: { not: 'INVALID' } }, select: { value: true, status: true } },
      invoices: { select: { id: true, issuedOn: true } },
    },
  });
  const contact = found?.contacts[0];
  if (!found || !contact) return { refusal: found ? 'NO_EMAIL' : 'CASE_CLOSED' } as const;
  if (found.debtor.kind === 'INDIVIDUAL' || !found.debtor.siren) return { refusal: 'INDIVIDUAL' } as const;
  // What has changed since the request stops it as it would have then (question 218).
  const suspended = suspensionOf(found.status, found._count.plans);
  if (suspended) return { refusal: suspended } as const;
  const ledger = await new Ledgers(database, new Audit(database)).read(caseId, dayOf(new Date()));
  const unpaid = ledger?.invoices.filter((invoice) => invoice.principalLeft > 0) ?? [];
  if (!ledger || unpaid.length === 0) return { refusal: 'NOTHING_DUE' } as const;
  const owed = owedOf(ledger);
  // As the letters of the same name (`letterAmount`): the indemnities from the firm reminder on, interest in the last one only (question 213).
  const total = reminderAmount(level, owed);
  // The code only goes to an address a colleague has confirmed (question 112); otherwise the message leaves without it.
  let code: string | undefined;
  if (contact.status === 'VERIFIED') {
    const [row] = await tx.$queryRaw<{ debtor_id: string; code_cipher: Uint8Array }[]>`SELECT debtor_id, code_cipher FROM app.access_code(${caseId}::uuid)`;
    if (row) {
      const [current, ...previous] = await keysIn(tx, vault, 'ACCESS_CODE_KEY');
      try {
        code = new Keyring(current!, previous).decrypt(row.code_cipher, bindingOf(row.debtor_id)).toString();
      } catch {
        code = undefined;
      }
    }
  }
  const issued = new Map(found.invoices.map((invoice) => [invoice.id, invoice.issuedOn]));
  return {
    refusal: undefined,
    to: contact.value,
    data: {
      case: { reference: found.reference, total_due: money(total), ...(code ? { access_code: code } : {}) },
      creditor: { name: found.creditor.name },
      debtor: { company_name: found.debtor.name, siren: found.debtor.siren, ...(found.contactName ? { contact_name: found.contactName } : {}) },
      invoices: unpaid.map((invoice) => ({
        number: invoice.number,
        issue_date: day(issued.get(invoice.id) ?? invoice.dueOn),
        due_date: day(invoice.dueOn),
        principal: money(invoice.principal),
        total: money(invoice.principalLeft),
      })),
    },
  };
}

/**
 * Beginning of every reason a line fails for once it has been taken, and of none other: a failed line says whether it ever
 * left this machine (held by `keep_sending`). What the provider says afterwards is only believed of the first kind.
 */
export const PROVIDER_FAILURE = 'PROVIDER_';

/**
 * A line that has not left fails, once: said in the history of the case and to the colleague who asked for it, without a
 * word of why beyond a code. `from` is the
 * state the caller knows it in: `QUEUED` for whatever stops it before it is taken (a line taken meanwhile is left alone:
 * nobody here knows what has left), `UNCERTAIN` for the one task that took it and heard the provider refuse.
 */
export async function markFailed(
  asApplication: Run,
  sending: string,
  caseId: string,
  failure: string,
  from: 'QUEUED' | 'UNCERTAIN',
): Promise<{ code: string; failed: boolean }> {
  const taken = from === 'UNCERTAIN';
  const code = CODE.test(failure) && failure.startsWith(PROVIDER_FAILURE) === taken ? failure : taken ? 'PROVIDER_FAILED' : 'SENDING_FAILED';
  const failed = await asApplication(async (tx) => {
    const { count } = await tx.sending.updateMany({ where: { id: sending, status: from }, data: { status: 'FAILED', failure: code } });
    if (count) {
      // An anonymized case takes no more history.
      await tx.$executeRaw`SELECT app.add_case_event(${caseId}::uuid, 'REMINDER_FAILED', 'Relance non envoyée', NULL, 'danger'::event_tone, false) WHERE app.case_writable(${caseId}::uuid)`;
      // And the colleague who asked for it is told in the application, once: with the failure, or not at all.
      await tx.$executeRaw`SELECT app.tell_sending_failed(${sending}::uuid)`;
    }
    return count === 1;
  });
  return { code, failed };
}
export const sentNote = (caseId: string, level: number | null) => (tx: Transaction) =>
  tx.$executeRaw`SELECT app.add_case_event(${caseId}::uuid, 'REMINDER_SENT', 'Relance envoyée', ${`E-mail · niveau ${level ?? 1}`}, 'info'::event_tone, false) WHERE app.case_writable(${caseId}::uuid)`;
/** How long a sent line may stay without its event before the sweep writes it: far more than the two writes of a task take. */
const UNSAID_MS = 2 * 60_000;

/**
 * No line stays queued for ever. Every few minutes: those whose task was abandoned before anything left (the author gone,
 * a task refused or interrupted before the line was taken) fail with its code; those that have waited beyond their time
 * (`sendingDeadline`) fail as `EXPIRED`. A line already taken is never touched, even when a task takes it between the
 * reading and the writing here: nobody knows what has left. And a line sent whose task was cut before the history said so
 * gets its « Relance envoyée », in the name of the application.
 */
export async function sweepSendings(asApplication: Run, now: Date = new Date()): Promise<number> {
  const [settings, waiting] = await asApplication(
    async (tx) =>
      [
        await SettingValues.read(tx),
        await tx.$queryRaw<{ id: string; case_id: string; created_at: Date; abandoned: boolean; failure: string | null }[]>`
      SELECT s.id, s.case_id, s.created_at, coalesce(bool_or(o.failed_at IS NOT NULL), false) AS abandoned, max(o.failure) AS failure
      FROM sendings s LEFT JOIN outbox o ON o.queue = 'reminders' AND o.name = 'case-reminder' AND o.payload->>'sending' = s.id::text
      WHERE s.status = 'QUEUED' GROUP BY s.id ORDER BY s.id LIMIT 1000`,
      ] as const,
  );
  const hours = contactHours((field) => settings.text('firm', 'relances', field));
  let failed = 0;
  for (const line of waiting) {
    // Started and never ended, but the line was never taken: nothing has left.
    const code = line.abandoned
      ? line.failure === 'UNCERTAIN'
        ? 'INTERRUPTED'
        : (line.failure ?? 'TASK_FAILED')
      : now >= sendingDeadline(line.created_at, hours)
        ? 'EXPIRED'
        : null;
    if (!code) continue;
    if ((await markFailed(asApplication, line.id, line.case_id, code, 'QUEUED')).failed) failed += 1;
  }
  // Sent a moment ago at least, and no « Relance envoyée » on the case since: the task was cut between its two writes.
  const before = new Date(now.getTime() - UNSAID_MS);
  await asApplication(async (tx) => {
    const unsaid = await tx.$queryRaw<{ case_id: string; level: number | null }[]>`
      SELECT s.case_id, s.level FROM sendings s
      WHERE s.status = 'SENT' AND s.sent_at < ${before} AND s.sent_at > ${before}::timestamptz - interval '7 days' AND app.case_writable(s.case_id)
        AND NOT EXISTS (SELECT 1 FROM case_events e WHERE e.case_id = s.case_id AND e.kind = 'REMINDER_SENT' AND e.occurred_at >= s.sent_at - interval '1 minute')
      ORDER BY s.sent_at LIMIT 200`;
    for (const line of unsaid) await sentNote(line.case_id, line.level)(tx);
  });
  return failed;
}

/**
 * Sends what a request has written in `sendings`. Before anything leaves, the line passes from « queued » to « uncertain »,
 * once: a task delivered twice, or started again after a cut, finds it taken and sends nothing. Then the provider says what
 * happened: sent, refused (nothing left), or nothing clear, and the line stays uncertain until a person decides.
 */
export function sendingJobs({
  database,
  asWorker,
  vault,
  emails,
  resend,
  production,
  real,
  devRecipients,
  simulate,
  now = () => new Date(),
}: Parts): Record<string, JobDefinition> {
  /** What the provider said, then the history: « Relance envoyée » once it has left, not before (question 219). */
  const sent = async (
    asApplication: Run,
    asAuthor: Run,
    sending: string,
    caseId: string,
    level: number,
    data: { simulated?: boolean; providerRef?: string },
  ) => {
    const { count } = await asApplication((tx) =>
      tx.sending.updateMany({ where: { id: sending, status: 'UNCERTAIN' }, data: { status: 'SENT', sentAt: new Date(), ...data } }),
    );
    if (!count) return;
    // Neither the address nor the text: the channel and the level. In the name of the colleague who asked, as long as
    // the case is still theirs; of the application otherwise.
    // Only a refusal of the rights hands it to the application; anything else surfaces, and the sweep says it later.
    const note = sentNote(caseId, level);
    await asAuthor(note).catch((error: unknown) => {
      if (databaseCode(error) !== '42501') throw error;
      return asApplication(note);
    });
  };
  const fail = async (asApplication: Run, sending: string, caseId: string, failure: string, from: 'QUEUED' | 'UNCERTAIN' = 'QUEUED'): Promise<never> => {
    throw new GiveUp((await markFailed(asApplication, sending, caseId, failure, from)).code);
  };

  return {
    'case-reminder': {
      from: ['STAFF'],
      // It reaches a debtor: one try, and the line itself is taken before the provider is called.
      repeatable: false,
      run: async ({ payload, asAuthor, authorize }) => {
        const sending = id(payload.sending);
        const caseId = id(payload.case);
        let asApplication: Run;
        try {
          asApplication = await authorize(mayActOn(caseId));
        } catch (error) {
          // The right to act on the case was lost meanwhile: the line fails, under the rights of the worker.
          if (error instanceof GiveUp) return fail(asWorker, sending, caseId, error.code);
          throw error;
        }
        const line = await asApplication((tx) =>
          tx.sending.findFirst({ where: { id: sending, caseId }, select: { status: true, channel: true, level: true, contactId: true, createdAt: true } }),
        );
        if (!line) throw new GiveUp('UNKNOWN_SENDING');
        // Already taken by another delivery: whatever happened to it, nothing more leaves from here.
        if (line.status !== 'QUEUED') return;
        if (line.channel !== 'EMAIL' || !line.level || !line.contactId) return fail(asApplication, sending, caseId, 'NOT_AVAILABLE');
        const { level, contactId } = line;
        const settings = await asApplication((tx) => SettingValues.read(tx));
        const hours = contactHours((field) => settings.text('firm', 'relances', field));
        const moment = now();
        // One that has waited too long never leaves (a key, a value of the firm, the hours).
        if (moment >= sendingDeadline(line.createdAt, hours)) return fail(asApplication, sending, caseId, 'EXPIRED');
        const facts = await asAuthor((tx) => factsOf(database, vault, tx, caseId, contactId, level));
        if (facts.refusal !== undefined) return fail(asApplication, sending, caseId, facts.refusal);
        // A value of the firm still between brackets: it waits until the Director has typed it. Asked of the settings,
        // never of the message: a debtor whose name holds brackets waits for nothing.
        if (await emails.firmIncomplete()) throw new TryLater('FIRM_INCOMPLETE');
        let message: AutomaticMessage;
        try {
          message = await emails.compose(`reminder-${level}` as AutomaticEmail, facts.to, facts.data);
        } catch {
          // What the template refuses may quote the debtor: only a code stays.
          return fail(asApplication, sending, caseId, 'UNREADABLE_MESSAGE');
        }
        // One that has waited never leaves at night, on a Sunday nor on a public holiday (question 161).
        if (hours.outsideHours('EMAIL', dayOf(moment), timeOf(moment))) throw new TryLater('OUTSIDE_HOURS');
        const [stored] = await asApplication(
          (tx) => tx.$queryRaw<{ id: string | null; value_cipher: Uint8Array | null }[]>`SELECT * FROM app.service_key('RESEND_API_KEY')`,
        );
        const key = stored?.id && stored.value_cipher ? vault.open(stored.id, stored.value_cipher) : null;
        if (!key && production) throw new TryLater('NO_KEY');
        if (key && !real && !allowedOutsideProduction(facts.to, devRecipients)) return fail(asApplication, sending, caseId, 'DEV_RECIPIENT');
        // From here on, a second run sends nothing.
        const taken = await asApplication((tx) => tx.sending.updateMany({ where: { id: sending, status: 'QUEUED' }, data: { status: 'UNCERTAIN' } }));
        if (taken.count !== 1) return;
        if (!key) {
          await simulate(message);
          await sent(asApplication, asAuthor, sending, caseId, level, { simulated: true });
          return;
        }
        let ref: string;
        try {
          ({ ref } = await resend.send(key, message, `sending/${sending}`, sending));
        } catch (error) {
          if (error instanceof ProviderRefused) return fail(asApplication, sending, caseId, error.code, 'UNCERTAIN');
          // Nothing clear came back: the line stays uncertain, and so does its task.
          throw new GiveUp('UNCERTAIN');
        }
        await sent(asApplication, asAuthor, sending, caseId, level, { providerRef: ref });
      },
    },
  };
}
