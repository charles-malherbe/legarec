import {
  contactHours,
  REMINDER_GAP_DAYS,
  UNCERTAIN_BLOCK_HOURS,
  type BatchTemplate,
  type ReminderPreview,
  type REQUEST_BODIES,
  type SendingOutcome,
  type SendingRefusal,
} from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { emailConfigOf, firmIncomplete } from '../../emails/config';
import { postalOf, streetLinesOf } from '../../letters/postal';
import { Audit } from '../../platform/audit/audit';
import { Clock } from '../../platform/clock';
import { CONFIG, type Config } from '../../platform/config/config';
import { Database } from '../../platform/database/database';
import { conflict, forbidden, notFound } from '../../platform/errors/api-error';
import { dayOf, timeOf } from '../../platform/format';
import { currentActor } from '../../platform/http/context';
import { mayActOn } from '../../platform/queue/jobs';
import { Outbox } from '../../platform/queue/outbox';
import { normalized } from '../cases/cases.service';
import { Ledgers } from '../payments/ledger';
import { nextInstallment, PLAN_INSTALLMENTS } from '../payments/plans';
import { SettingValues } from '../settings/values';
import { capOf, capPeriod, suspensionOf } from './contact-rules';

type Reminder = z.infer<(typeof REQUEST_BODIES)['staff']['POST /cases/:id/reminders']>;
type Template = Reminder['template'] | 'INSTALLMENT';
/** What leaves by the post: the three reminders, and the proposal of a plan of Rédiger un courrier. */
type LetterOf = Reminder['template'] | 'PAYMENT_PLAN';
type Wanted = z.infer<(typeof REQUEST_BODIES)['staff']['POST /cases/reminders']>['items'][number];
/** The validated e-mail of the kit for each template of the form: reminder-1 to reminder-3 (question 212). */
export const REMINDER_LEVELS = { FRIENDLY: 1, FIRM: 2, FORMAL_NOTICE: 3 } as const;
/**
 * What a grouped reminder sends, by the highest level that has left the case by e-mail: the friendly reminder, then the
 * firm one. The formal notice is never sent in a batch: a colleague decides it from the case (question 220).
 */
/** The installment a colleague confirmed reminding (question 221). */
type ExpectedInstallment = z.infer<(typeof REQUEST_BODIES)['staff']['POST /payment-plans/:id/reminder']>;
const NEXT_IN_BATCH: readonly (BatchTemplate | undefined)[] = ['FRIENDLY', 'FIRM'];
const GAP_MS = REMINDER_GAP_DAYS * 86_400_000;
const UNCERTAIN_MS = UNCERTAIN_BLOCK_HOURS * 3_600_000;
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
  formalNoticeOn: true,
  debtorAddress: true,
  debtorPostalCode: true,
  debtorCity: true,
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
  formalNoticeOn: Date | null;
  debtorAddress: string | null;
  debtorPostalCode: string | null;
  debtorCity: string | null;
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
  /** The provider itself said that the message had left (webhooks of Resend). */
  confirmedAt: Date | null;
  createdAt: Date;
}
/** `override`: the reason a colleague gave to go beyond the cap (question 214), used only when it is reached. */
type Chosen = { contactId: string; template: Template; override?: string } | SendingRefusal;
/** Who may override the cap of contacts (question 214); PostgreSQL asks it again (`app.check_cap_override`). */
const OVERRIDERS: ReadonlySet<string> = new Set(['COLLECTION_MANAGER', 'DIRECTOR']);
const currentStaffRole = () => {
  const actor = currentActor();
  return actor.kind === 'staff' ? actor.role : null;
};
/** What does not depend on the case: read once for a request. */
interface Rules {
  now: Date;
  firmIncomplete: boolean;
  serviceReady: boolean;
  outsideHours: boolean;
  period: [from: string, to: string];
  cap: number;
}

/** Nobody knows whether it has left, and nothing tells it later: it holds the case for a time only (question 220). */
const stillUncertain = (line: Line, now: Date) => line.status === 'UNCERTAIN' && now.getTime() - line.createdAt.getTime() < UNCERTAIN_MS;
/**
 * A line that has failed and yet has left, by the word of the provider itself: it keeps its status for ever, and counts as
 * one that has left, so that the same level never leaves twice in its name.
 */
const failed = (line: Line) => line.status === 'FAILED' && !line.confirmedAt;
/**
 * A line that waits, or whose fate is unknown since less than two days: nothing more is asked for the case meanwhile, by
 * the same channel (an e-mail, or a letter).
 */
const pending = (lines: readonly Line[], now: Date, channel: 'EMAIL' | 'LETTER' = 'EMAIL') =>
  lines.some((line) => (channel === 'EMAIL' ? line.channel === 'EMAIL' : line.channel !== 'EMAIL') && (line.status === 'QUEUED' || stillUncertain(line, now)));
/** Templates of a letter that quote the first one: they never are the first (Paramètres › Modèles, « Relance ferme »). */
const QUOTES_FIRST_LETTER: ReadonlySet<string> = new Set(['FIRM', 'FORMAL_NOTICE']);
/**
 * The reminder a case receives from the list now (question 220): the level after the highest that has left by e-mail, at
 * least a week after it. An uncertain line counts as one that has left, on the day it was asked: the cautious reading.
 * Nothing once a formal notice is in the story of the case, whatever its channel, in the lines or on the case itself.
 */
function nextInBatch(found: Found, lines: readonly Line[], now: Date): BatchTemplate | SendingRefusal {
  if (found.status === 'FORMAL_NOTICE' || found.formalNoticeOn || lines.some((line) => line.template === 'FORMAL_NOTICE' && !failed(line)))
    return 'NO_NEXT_REMINDER';
  // Reminders of an installment have no level: they are no step of the reminders.
  const left = lines.filter((line) => line.channel === 'EMAIL' && line.level !== null && line.status !== 'QUEUED' && !failed(line));
  const highest = Math.max(0, ...left.map((line) => line.level ?? 0));
  const template = NEXT_IN_BATCH[highest];
  if (!template) return 'NO_NEXT_REMINDER';
  const last = Math.max(0, ...left.map((line) => (line.sentAt ?? line.confirmedAt ?? line.createdAt).getTime()));
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
    @Inject(Ledgers) private readonly ledgers: Ledgers,
  ) {}

  /** A reminder by e-mail, to an address of the case. Refused with the reason (409) when a rule of the firm forbids it. */
  async remind(caseId: string, body: Reminder): Promise<void> {
    const { tx } = this.database;
    const found = await tx.case.findFirst({ where: { id: caseId }, select: CASE });
    if (!found) throw notFound();
    if (!(await mayActOn(caseId)(tx))) throw forbidden();
    if (body.channel === 'REGISTERED_LETTER') return this.remindByLetter(found, body.template, 'REGISTERED_LETTER');
    // Texts are with lot R.
    if (body.channel !== 'EMAIL') throw refused('NOT_AVAILABLE');
    const rules = await this.rules();
    const stopped = this.ofCase(found);
    if (stopped) throw refused(stopped);
    const wanted = normalized('EMAIL', body.recipient);
    const contact = found.contacts.find((item) => item.valueNormalized === wanted);
    if (!contact) throw refused('UNKNOWN_RECIPIENT');
    // The cap may be overridden with a reason by the manager, or the Director on their cases (question 214); the database
    // asks the role again.
    const override = body.capOverride;
    if (override !== undefined && !OVERRIDERS.has(currentStaffRole() ?? '')) throw forbidden();
    const refusal = (await this.queue([found], rules, () => ({ contactId: contact.id, template: body.template, override }))).get(found.id);
    if (refusal) throw refused(refusal);
  }

  /**
   * Reminder of the next installment of a running plan (question 221): by e-mail, to the main address of the case, an
   * individual included, on a colleague's request only. The cap and the hours hold; the link is the portal, never a personal
   * one, and the access code never goes with it. Refused when the installment is no longer the one confirmed.
   */
  async remindInstallment(planId: string, expected: ExpectedInstallment): Promise<void> {
    const { tx } = this.database;
    const plan = await tx.paymentPlan.findFirst({ where: { id: planId }, select: PLAN_INSTALLMENTS });
    const found = plan && (await tx.case.findFirst({ where: { id: plan.caseId }, select: CASE }));
    if (!plan || !found) throw notFound();
    if (!(await mayActOn(found.id)(tx))) throw forbidden();
    const rules = await this.rules();
    const next = await nextInstallment(this.ledgers, plan, dayOf(rules.now));
    if (!next) throw refused('NO_NEXT_INSTALLMENT');
    if (next.number !== expected.number || next.amount !== expected.amount) throw refused('INSTALLMENT_CHANGED');
    const stopped = this.ofPlanCase(found);
    if (stopped) throw refused(stopped);
    const refusal = (
      await this.queue(
        [found],
        rules,
        () => ({ contactId: found.contacts[0]!.id, template: 'INSTALLMENT' }),
        (item) => this.ofPlanCase(item),
      )
    ).get(found.id);
    if (refusal) throw refused(refusal);
  }

  /**
   * A registered letter with acknowledgement of receipt, by MySendingBox (question 210), to the postal address of the case:
   * the validated text of Paramètres › Modèles, without the access code. It may be the first contact, and may go to an
   * individual; the firm and the second letters quote the first one. The monthly cap of letters holds, without any
   * override; no hours. One letter at a time per case. The worker writes the PDF, keeps it in the case, then posts it.
   * A plain letter (`LETTER`, « Courrier simple » of Rédiger un courrier) follows the same rules, and never is a first letter.
   */
  private async remindByLetter(found: Found, template: LetterOf, channel: 'REGISTERED_LETTER' | 'LETTER', delay = 8): Promise<void> {
    const { tx } = this.database;
    if (found.closedOn || found.anonymizedAt) throw refused('CASE_CLOSED');
    const suspended = suspensionOf(found.status, found._count.plans);
    if (suspended) throw refused(suspended);
    if (QUOTES_FIRST_LETTER.has(template) && (!found.firstLetterReference || !found.firstLetterOn)) throw refused('NO_FIRST_LETTER');
    if (!streetLinesOf(found.debtorAddress) || !found.debtorPostalCode || !found.debtorCity?.trim()) throw refused('NO_ADDRESS');
    // The proposal of a plan goes with the plan that waits for its debtor, and no other.
    if (template === 'PAYMENT_PLAN' && !(await tx.paymentPlan.count({ where: { caseId: found.id, status: 'WAITING_DEBTOR' } })))
      throw refused('NO_PLAN_PROPOSED');
    const settings = await SettingValues.read(tx);
    const firm = (field: string) => settings.text('firm', 'cabinet', field);
    // The letter names the firm and leaves from its address: nothing between brackets, and an address the post reads.
    if (firmIncomplete(emailConfigOf(settings, this.config)) || !postalOf(firm('address'))) throw refused('FIRM_INCOMPLETE');
    if (this.config.NODE_ENV === 'production') {
      const [service] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT app.service_ready('MYSENDINGBOX_API_KEY') AS ready`;
      if (service?.ready !== true) throw refused('SERVICE_NOT_READY');
    }
    const now = this.clock.now();
    const [from, to] = capPeriod('LETTER', dayOf(now));
    // Under the lock of the debtor until the end of the request, as the e-mails.
    const [row] = await tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${found.id}::uuid, 'LETTER', ${from}::date, ${to}::date) AS count`;
    const lines = await tx.sending.findMany({
      where: { caseId: found.id },
      select: { channel: true, template: true, level: true, status: true, sentAt: true, confirmedAt: true, createdAt: true },
    });
    if (pending(lines, now, 'LETTER')) throw refused('REMINDER_PENDING');
    if ((row?.count ?? 0) >= capOf('LETTER', (field) => settings.text('firm', 'relances', field)).cap) throw refused('CONTACT_CAP');
    const line = await tx.sending.create({
      data: { caseId: found.id, creditorId: found.creditorId, channel, template, level: null, contactId: null },
      select: { id: true },
    });
    await this.outbox.add({ queue: 'reminders', name: 'case-letter', payload: { sending: line.id, case: found.id, delay }, dedupeKey: `sending:${line.id}` });
  }

  /** A letter of Rédiger un courrier, for one case: the rules of the registered letter of the case card (question 210). */
  async letter(caseId: string, template: LetterOf, channel: 'REGISTERED_LETTER' | 'LETTER', delay: number): Promise<void> {
    const { tx } = this.database;
    const found = await tx.case.findFirst({ where: { id: caseId }, select: CASE });
    if (!found) throw notFound();
    if (!(await mayActOn(caseId)(tx))) throw forbidden();
    return this.remindByLetter(found, template, channel, delay);
  }

  /**
   * « E-mail avec PDF joint » of Rédiger un courrier: the validated e-mail of the same level (reminder-1 to reminder-3), to
   * the main address of the case, with the letter of Paramètres › Modèles joined as a PDF and kept in the case. The rules of
   * an e-mail reminder (first letter sent, no individual, cap without override, hours); the letter needs a postal address,
   * as it names the debtor at it.
   */
  async emailWithLetter(caseId: string, template: Reminder['template'], delay: number): Promise<void> {
    const { tx } = this.database;
    const found = await tx.case.findFirst({ where: { id: caseId }, select: CASE });
    if (!found) throw notFound();
    if (!(await mayActOn(caseId)(tx))) throw forbidden();
    const rules = await this.rules();
    const stopped = this.ofCase(found);
    if (stopped) throw refused(stopped);
    if (!streetLinesOf(found.debtorAddress) || !found.debtorPostalCode || !found.debtorCity?.trim()) throw refused('NO_ADDRESS');
    const refusal = (await this.queue([found], rules, () => ({ contactId: found.contacts[0]!.id, template }), undefined, { delay })).get(found.id);
    if (refusal) throw refused(refusal);
  }

  /** What the case forbids for the reminder of an installment: its plan runs, and it may go to an individual. */
  private ofPlanCase(found: Found): SendingRefusal | null {
    if (found.closedOn || found.anonymizedAt) return 'CASE_CLOSED';
    if (suspensionOf(found.status, 0)) return 'CASE_DISPUTED';
    if (!found.firstLetterReference || !found.firstLetterOn) return 'NO_FIRST_LETTER';
    return found.contacts.length === 0 ? 'NO_EMAIL' : null;
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
      select: { caseId: true, channel: true, template: true, level: true, status: true, sentAt: true, confirmedAt: true, createdAt: true },
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
    if (pending(lines, now)) return 'REMINDER_PENDING';
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
  private async queue(
    cases: readonly Found[],
    rules: Rules,
    choose: (found: Found, lines: readonly Line[]) => Chosen,
    stops: (found: Found) => SendingRefusal | null = (found) => this.ofCase(found),
    /** What the task carries besides its line: the delay of a joined letter (Rédiger un courrier). */
    extra: { delay?: number } = {},
  ): Promise<Map<string, SendingRefusal>> {
    const { tx } = this.database;
    const refusals = new Map<string, SendingRefusal>();
    const [from, to] = rules.period;
    const sent = new Map<string, number>();
    const open: Found[] = [];
    for (const found of cases.toSorted((a, b) => a.debtorId.localeCompare(b.debtorId) || a.id.localeCompare(b.id))) {
      const stopped = stops(found) ?? this.ofFirm(rules);
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
      select: { caseId: true, channel: true, template: true, level: true, status: true, sentAt: true, confirmedAt: true, createdAt: true },
    }))
      lines.set(line.caseId, [...(lines.get(line.caseId) ?? []), line]);
    const data: {
      caseId: string;
      creditorId: string;
      channel: 'EMAIL';
      template: Template;
      level: number | null;
      contactId: string;
      capOverrideReason: string | null;
    }[] = [];
    for (const found of open) {
      const asked = lines.get(found.id) ?? [];
      // One at a time per case: a second click, a second tab or a colleague adds nothing while a reminder is on its way.
      const chosen = pending(asked, rules.now) ? 'REMINDER_PENDING' : choose(found, asked);
      const count = sent.get(found.debtorId) ?? 0;
      const over = count >= rules.cap;
      const refusal = typeof chosen === 'string' ? chosen : over && chosen.override === undefined ? 'CONTACT_CAP' : null;
      if (refusal ?? typeof chosen === 'string') {
        refusals.set(found.id, refusal!);
        continue;
      }
      sent.set(found.debtorId, count + 1);
      const { contactId, template, override } = chosen as Exclude<Chosen, string>;
      data.push({
        caseId: found.id,
        creditorId: found.creditorId,
        channel: 'EMAIL',
        template,
        level: template === 'INSTALLMENT' ? null : REMINDER_LEVELS[template],
        contactId,
        // Below the cap, nothing is overridden: no reason is kept.
        capOverrideReason: over && override !== undefined ? override : null,
      });
    }
    if (data.length === 0) return refusals;
    const written = await tx.sending.createManyAndReturn({ data, select: { id: true, caseId: true, level: true, capOverrideReason: true } });
    for (const line of written.filter((item) => item.capOverrideReason !== null)) {
      // Who, when and which sending: never the reason, which stays on the line.
      await this.audit.log({ action: 'CONTACT_CAP_OVERRIDDEN', entity: { type: 'sending', id: line.id } });
      await tx.$executeRaw`SELECT app.add_case_event(${line.caseId}::uuid, 'CAP_OVERRIDDEN', 'Dérogation au plafond de contacts', ${`E-mail · niveau ${line.level ?? 1}`}, 'warning'::event_tone, false)`;
    }
    // The history says « Relance envoyée » when the worker has sent it, not before (question 219).
    for (const { id, caseId } of written)
      await this.outbox.add({ queue: 'reminders', name: 'case-reminder', payload: { sending: id, case: caseId, ...extra }, dedupeKey: `sending:${id}` });
    return refusals;
  }
}
