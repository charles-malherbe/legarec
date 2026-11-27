import {
  contactHours,
  REMINDER_GAP_DAYS,
  type BatchTemplate,
  type ReminderPreview,
  type REQUEST_BODIES,
  type SendingOutcome,
  type SendingRefusal,
} from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { emailConfigOf, firmIncomplete } from '../../emails/config';
import { Audit } from '../../platform/audit/audit';
import { Clock } from '../../platform/clock';
import { CONFIG, type Config } from '../../platform/config/config';
import { Database } from '../../platform/database/database';
import { conflict, forbidden, notFound } from '../../platform/errors/api-error';
import { dayOf, timeOf } from '../../platform/format';
import { mayActOn } from '../../platform/queue/jobs';
import { Outbox } from '../../platform/queue/outbox';
import { normalized } from '../cases/cases.service';
import { SettingValues } from '../settings/values';
import { capOf, capPeriod, suspensionOf } from './contact-rules';

type Reminder = z.infer<(typeof REQUEST_BODIES)['staff']['POST /cases/:id/reminders']>;
type Template = Reminder['template'];
type Wanted = z.infer<(typeof REQUEST_BODIES)['staff']['POST /cases/reminders']>['items'][number];
/** The validated e-mail of the kit for each template of the form: reminder-1 to reminder-3 (question 212). */
export const REMINDER_LEVELS = { FRIENDLY: 1, FIRM: 2, FORMAL_NOTICE: 3 } as const;
/**
 * What a grouped reminder sends, by the highest level that has left the case by e-mail: the friendly reminder, then the
 * firm one. The formal notice is never sent in a batch: a colleague decides it from the case (question 220).
 */
const NEXT_IN_BATCH: readonly (BatchTemplate | undefined)[] = ['FRIENDLY', 'FIRM'];
const GAP_MS = REMINDER_GAP_DAYS * 86_400_000;
const refused = (reason: SendingRefusal) => conflict(reason);

/** What the rules read of a case; the main address first, as the form of the case proposes it. */
const CASE = {
  id: true,
  creditorId: true,
  debtorId: true,
  status: true,
  closedOn: true,
  anonymizedAt: true,
  firstLetterReference: true,
  firstLetterOn: true,
  debtor: { select: { kind: true, siren: true } },
  contacts: {
    where: { kind: 'EMAIL' as const, status: { not: 'INVALID' as const } },
    select: { id: true, valueNormalized: true },
    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
  },
  _count: { select: { plans: { where: { status: 'ACTIVE' as const } } } },
};
interface Found {
  id: string;
  creditorId: string;
  debtorId: string;
  status: string;
  closedOn: Date | null;
  anonymizedAt: Date | null;
  firstLetterReference: string | null;
  firstLetterOn: Date | null;
  debtor: { kind: string; siren: string | null };
  contacts: { id: string; valueNormalized: string }[];
  _count: { plans: number };
}
/** What has been asked for a case so far, whatever became of it. */
interface Line {
  channel: string;
  template: string;
  level: number | null;
  status: string;
  sentAt: Date | null;
}
type Chosen = { contactId: string; template: Template } | SendingRefusal;
/** What does not depend on the case: read once for a request. */
interface Rules {
  now: Date;
  firmIncomplete: boolean;
  serviceReady: boolean;
  outsideHours: boolean;
  period: [from: string, to: string];
  cap: number;
}

/** A line that waits or whose fate is unknown: nothing more is asked for the case until it is settled. */
const pending = (lines: readonly Line[]) => lines.some((line) => line.channel === 'EMAIL' && (line.status === 'QUEUED' || line.status === 'UNCERTAIN'));
/**
 * The reminder a case receives from the list now (question 220): the level after the highest that has really left by
 * e-mail, at least a week after it. Nothing once a formal notice is in the story of the case, whatever its channel.
 */
function nextInBatch(found: Found, lines: readonly Line[], now: Date): BatchTemplate | SendingRefusal {
  if (found.status === 'FORMAL_NOTICE' || lines.some((line) => line.template === 'FORMAL_NOTICE' && line.status !== 'FAILED')) return 'NO_NEXT_REMINDER';
  const left = lines.filter((line) => line.channel === 'EMAIL' && line.status === 'SENT');
  const highest = Math.max(0, ...left.map((line) => line.level ?? 0));
  const template = NEXT_IN_BATCH[highest];
  if (!template) return 'NO_NEXT_REMINDER';
  const last = Math.max(0, ...left.map((line) => line.sentAt?.getTime() ?? 0));
  return now.getTime() - last < GAP_MS ? 'TOO_SOON' : template;
}

/**
 * What leaves for a debtor from a case. The line is written here, with the request; the worker sends it. PostgreSQL decides
 * which cases one reads and acts on, and counts the contacts of the debtor, whatever the creditor.
 */
@Injectable()
export class SendingsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  /** A reminder by e-mail, to an address of the case. Refused with the reason (409) when a rule of the firm forbids it. */
  async remind(caseId: string, body: Reminder): Promise<void> {
    const { tx } = this.database;
    const found = await tx.case.findFirst({ where: { id: caseId }, select: CASE });
    if (!found) throw notFound();
    if (!(await mayActOn(caseId)(tx))) throw forbidden();
    // Texts are with lot R; a registered letter with the letters of « Rédiger un courrier » (question 210).
    if (body.channel !== 'EMAIL') throw refused('NOT_AVAILABLE');
    const rules = await this.rules();
    const stopped = this.ofCase(found);
    if (stopped) throw refused(stopped);
    const wanted = normalized('EMAIL', body.recipient);
    const contact = found.contacts.find((item) => item.valueNormalized === wanted);
    if (!contact) throw refused('UNKNOWN_RECIPIENT');
    const refusal = (await this.queue([found], rules, () => ({ contactId: contact.id, template: body.template }))).get(found.id);
    if (refusal) throw refused(refusal);
  }

  /** The cases of a grouped action: all read (404) and acted on (403) by the caller, or nothing is done. */
  private async all(ids: readonly string[]): Promise<Found[]> {
    const { tx } = this.database;
    const found = await tx.case.findMany({ where: { id: { in: [...ids] } }, select: CASE });
    if (found.length !== ids.length) throw notFound();
    // One question for the whole batch.
    const [rights] = await tx.$queryRaw<{ every: boolean | null }[]>`
      SELECT bool_and(app.can_act_on_case(officer_id)) AS every FROM cases WHERE id = ANY(${found.map((item) => item.id)}::uuid[])`;
    if (rights?.every !== true) throw forbidden();
    return found;
  }

  /**
   * Before the confirmation of a grouped reminder: what each case would receive now, or why nothing. The same rules as the
   * sending, but the cap of the debtor, which is only counted when a line is written.
   */
  async preview(ids: readonly string[]): Promise<ReminderPreview> {
    const { tx } = this.database;
    const wanted = [...new Set(ids)];
    const found = new Map((await this.all(wanted)).map((item) => [item.id, item]));
    const rules = await this.rules();
    const lines = new Map<string, Line[]>();
    for (const line of await tx.sending.findMany({
      where: { caseId: { in: wanted } },
      select: { caseId: true, channel: true, template: true, level: true, status: true, sentAt: true },
    }))
      lines.set(line.caseId, [...(lines.get(line.caseId) ?? []), line]);
    return {
      items: wanted.map((id) => {
        const item = found.get(id)!;
        const chosen = this.ofCase(item) ?? this.ofFirm(rules) ?? this.chosenInBatch(item, lines.get(id) ?? [], rules.now);
        return typeof chosen === 'string' ? { id, template: null, reason: chosen } : { id, template: chosen.template as BatchTemplate, reason: null };
      }),
    };
  }

  /**
   * The e-mail reminder that was confirmed for each case, to its main address (question 220). The cases are all read and
   * acted on by the caller, or nothing is done (404, 403): as the other grouped actions. Then each one is judged by the rules
   * of a single reminder: what they refuse is left out with its reason, the rest is queued. Under the lock of the debtor:
   * the cap holds across the batch, and the level is read again; another one than the one confirmed never leaves.
   */
  async remindMany(items: readonly Wanted[]): Promise<SendingOutcome> {
    const expected = new Map<string, BatchTemplate>();
    for (const item of items) if (!expected.has(item.id)) expected.set(item.id, item.template);
    const wanted = [...expected.keys()];
    const found = await this.all(wanted);
    const rules = await this.rules();
    const refusals = await this.queue(found, rules, (item, lines) => {
      const chosen = this.chosenInBatch(item, lines, rules.now);
      return typeof chosen !== 'string' && chosen.template !== expected.get(item.id) ? 'LEVEL_CHANGED' : chosen;
    });
    const queued = wanted.length - refusals.size;
    // Who, how many, when and on whose behalf: neither a case nor a debtor.
    if (queued > 0) await this.audit.log({ action: 'REMINDERS_GROUPED', params: { count: queued } });
    return {
      queued,
      skipped: wanted.flatMap((id) => {
        const reason = refusals.get(id);
        return reason ? [{ id, reason }] : [];
      }),
    };
  }

  private chosenInBatch(found: Found, lines: readonly Line[], now: Date): Chosen {
    if (pending(lines)) return 'REMINDER_PENDING';
    const template = nextInBatch(found, lines, now);
    return template === 'FRIENDLY' || template === 'FIRM' ? { contactId: found.contacts[0]!.id, template } : template;
  }

  private async rules(): Promise<Rules> {
    const { tx } = this.database;
    const now = this.clock.now();
    const settings = await SettingValues.read(tx);
    const relances = (field: string) => settings.text('firm', 'relances', field);
    const today = dayOf(now);
    // In production nothing is simulated: without the key of the service, the reminder would wait, then expire.
    let serviceReady = true;
    if (this.config.NODE_ENV === 'production') {
      const [service] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT app.service_ready('RESEND_API_KEY') AS ready`;
      serviceReady = service?.ready === true;
    }
    return {
      now,
      // What the firm has not typed yet would leave between brackets.
      firmIncomplete: Boolean(firmIncomplete(emailConfigOf(settings, this.config))),
      serviceReady,
      outsideHours: contactHours(relances).outsideHours('EMAIL', today, timeOf(now)) !== null,
      period: capPeriod('EMAIL', today),
      cap: capOf('EMAIL', relances).cap,
    };
  }

  /** What the case itself forbids, in the order of the rules. */
  private ofCase(found: Found): SendingRefusal | null {
    if (found.closedOn || found.anonymizedAt) return 'CASE_CLOSED';
    // Nothing leaves during a dispute or a litigation, nor while a plan is respected (question 218).
    const suspended = suspensionOf(found.status, found._count.plans);
    if (suspended) return suspended;
    // The reminders of the kit name a company by its SIREN: never an individual.
    if (found.debtor.kind === 'INDIVIDUAL' || !found.debtor.siren) return 'INDIVIDUAL';
    // The first contact is a postal letter: nothing else before it has left (question 83).
    if (!found.firstLetterReference || !found.firstLetterOn) return 'NO_FIRST_LETTER';
    return found.contacts.length === 0 ? 'NO_EMAIL' : null;
  }

  /** What stops every reminder at this moment: the same for all the cases of a request. */
  private ofFirm(rules: Rules): SendingRefusal | null {
    if (rules.firmIncomplete) return 'FIRM_INCOMPLETE';
    if (!rules.serviceReady) return 'SERVICE_NOT_READY';
    return rules.outsideHours ? 'OUTSIDE_HOURS' : null;
  }

  /**
   * The rules of the firm for cases one acts on; a line and its task for each one that none refuses, the reason for the
   * others. Whoever counts the contacts holds the debtor until the end of the request: what was already asked for a case is
   * read under that lock, so that two requests at the same moment never both see « nothing asked yet ». The debtors are
   * taken in the same order by everyone, so that two batches never wait for each other. The lines are written together:
   * the right to write on a case is asked once, not once per line.
   */
  private async queue(cases: readonly Found[], rules: Rules, choose: (found: Found, lines: readonly Line[]) => Chosen): Promise<Map<string, SendingRefusal>> {
    const { tx } = this.database;
    const refusals = new Map<string, SendingRefusal>();
    const [from, to] = rules.period;
    const sent = new Map<string, number>();
    const open: Found[] = [];
    for (const found of cases.toSorted((a, b) => a.debtorId.localeCompare(b.debtorId) || a.id.localeCompare(b.id))) {
      const stopped = this.ofCase(found) ?? this.ofFirm(rules);
      if (stopped) {
        refusals.set(found.id, stopped);
        continue;
      }
      const [row] = await tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${found.id}::uuid, 'EMAIL', ${from}::date, ${to}::date) AS count`;
      // What this request adds for the debtor is counted below: the count of the database is the same for all its cases.
      sent.set(found.debtorId, Math.max(sent.get(found.debtorId) ?? 0, row?.count ?? 0));
      open.push(found);
    }
    if (open.length === 0) return refusals;
    const lines = new Map<string, Line[]>();
    for (const line of await tx.sending.findMany({
      where: { caseId: { in: open.map((found) => found.id) } },
      select: { caseId: true, channel: true, template: true, level: true, status: true, sentAt: true },
    }))
      lines.set(line.caseId, [...(lines.get(line.caseId) ?? []), line]);
    const data: { caseId: string; creditorId: string; channel: 'EMAIL'; template: Template; level: number; contactId: string }[] = [];
    for (const found of open) {
      const asked = lines.get(found.id) ?? [];
      // One at a time per case: a second click, a second tab or a colleague adds nothing while a reminder is on its way.
      const chosen = pending(asked) ? 'REMINDER_PENDING' : choose(found, asked);
      const count = sent.get(found.debtorId) ?? 0;
      const refusal = typeof chosen === 'string' ? chosen : count >= rules.cap ? 'CONTACT_CAP' : null;
      if (refusal ?? typeof chosen === 'string') {
        refusals.set(found.id, refusal!);
        continue;
      }
      sent.set(found.debtorId, count + 1);
      const { contactId, template } = chosen as Exclude<Chosen, string>;
      data.push({ caseId: found.id, creditorId: found.creditorId, channel: 'EMAIL', template, level: REMINDER_LEVELS[template], contactId });
    }
    if (data.length === 0) return refusals;
    const written = await tx.sending.createManyAndReturn({ data, select: { id: true, caseId: true } });
    // The history says « Relance envoyée » when the worker has sent it, not before (question 219).
    for (const { id, caseId } of written)
      await this.outbox.add({ queue: 'reminders', name: 'case-reminder', payload: { sending: id, case: caseId }, dedupeKey: `sending:${id}` });
    return refusals;
  }
}
