import { contactHours, type REQUEST_BODIES, type SendingOutcome, type SendingRefusal } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { emailConfigOf, firmIncomplete } from '../../emails/config';
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
/** The validated e-mail of the kit for each template of the form: reminder-1 to reminder-3 (question 212). */
export const REMINDER_LEVELS = { FRIENDLY: 1, FIRM: 2, FORMAL_NOTICE: 3 } as const;
/**
 * What a grouped reminder sends, by the highest level that has already left the case by e-mail: the friendly reminder,
 * then the firm one. The formal notice is never sent in a batch: a colleague decides it from the case (question 220).
 */
const NEXT_IN_BATCH: readonly (Template | undefined)[] = ['FRIENDLY', 'FIRM'];
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
  sendings: { where: { channel: 'EMAIL' as const, status: { not: 'FAILED' as const } }, select: { level: true } },
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
  sendings: { level: number | null }[];
  _count: { plans: number };
}
/** What is asked for a case: the address and the template, or why they cannot be chosen. */
type Choice = (found: Found) => { contactId: string; template: Template } | SendingRefusal;
/** What does not depend on the case: read once for a request. */
interface Rules {
  firmIncomplete: boolean;
  serviceReady: boolean;
  outsideHours: boolean;
  period: [from: string, to: string];
  cap: number;
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
  ) {}

  /** A reminder by e-mail, to an address of the case. Refused with the reason (409) when a rule of the firm forbids it. */
  async remind(caseId: string, body: Reminder): Promise<void> {
    const { tx } = this.database;
    const found = await tx.case.findFirst({ where: { id: caseId }, select: CASE });
    if (!found) throw notFound();
    if (!(await mayActOn(caseId)(tx))) throw forbidden();
    // Texts are with lot R; a registered letter with the letters of « Rédiger un courrier » (question 210).
    if (body.channel !== 'EMAIL') throw refused('NOT_AVAILABLE');
    const wanted = normalized('EMAIL', body.recipient);
    const refusal = await this.queue(found, await this.rules(), ({ contacts }) => {
      const contact = contacts.find((item) => item.valueNormalized === wanted);
      return contact ? { contactId: contact.id, template: body.template } : 'UNKNOWN_RECIPIENT';
    });
    if (refusal) throw refused(refusal);
  }

  /**
   * The next e-mail reminder of each case, to its main address (question 220). The cases are all read and acted on by the
   * caller, or nothing is done (404, 403): as the other grouped actions. Then each one is judged by the rules of a single
   * reminder: what they refuse is left out with its reason, the rest is queued. The cap of a debtor holds across the batch:
   * each line written counts for the next case of the same debtor.
   */
  async remindMany(ids: readonly string[]): Promise<SendingOutcome> {
    const { tx } = this.database;
    const wanted = [...new Set(ids)];
    const found = await tx.case.findMany({ where: { id: { in: wanted } }, select: CASE });
    if (found.length !== wanted.length) throw notFound();
    for (const { id } of found) if (!(await mayActOn(id)(tx))) throw forbidden();
    const rules = await this.rules();
    const refusals = new Map<string, SendingRefusal>();
    // Whoever counts holds the debtor: always in the same order, so that two batches never wait for each other.
    for (const item of found.toSorted((a, b) => a.debtorId.localeCompare(b.debtorId) || a.id.localeCompare(b.id))) {
      const refusal = await this.queue(item, rules, ({ contacts, sendings }) => {
        const template = NEXT_IN_BATCH[Math.max(0, ...sendings.map((sending) => sending.level ?? 0))];
        return template ? { contactId: contacts[0]!.id, template } : 'NO_NEXT_REMINDER';
      });
      if (refusal) refusals.set(item.id, refusal);
    }
    return {
      queued: wanted.length - refusals.size,
      skipped: wanted.flatMap((id) => {
        const reason = refusals.get(id);
        return reason ? [{ id, reason }] : [];
      }),
    };
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
      // What the firm has not typed yet would leave between brackets.
      firmIncomplete: Boolean(firmIncomplete(emailConfigOf(settings, this.config))),
      serviceReady,
      outsideHours: contactHours(relances).outsideHours('EMAIL', today, timeOf(now)) !== null,
      period: capPeriod('EMAIL', today),
      cap: capOf('EMAIL', relances).cap,
    };
  }

  /** The rules of the firm for one case one acts on, in their order; the line and its task when none refuses. */
  private async queue(found: Found, rules: Rules, choose: Choice): Promise<SendingRefusal | null> {
    const { tx } = this.database;
    if (found.closedOn || found.anonymizedAt) return 'CASE_CLOSED';
    // Nothing leaves during a dispute or a litigation, nor while a plan is respected (question 218).
    const suspended = suspensionOf(found.status, found._count.plans);
    if (suspended) return suspended;
    // The reminders of the kit name a company by its SIREN: never an individual.
    if (found.debtor.kind === 'INDIVIDUAL' || !found.debtor.siren) return 'INDIVIDUAL';
    // The first contact is a postal letter: nothing else before it has left (question 83).
    if (!found.firstLetterReference || !found.firstLetterOn) return 'NO_FIRST_LETTER';
    if (found.contacts.length === 0) return 'NO_EMAIL';
    const chosen = choose(found);
    if (typeof chosen === 'string') return chosen;
    if (rules.firmIncomplete) return 'FIRM_INCOMPLETE';
    if (!rules.serviceReady) return 'SERVICE_NOT_READY';
    if (rules.outsideHours) return 'OUTSIDE_HOURS';
    // Counted last: whoever counts holds the debtor until the end of the request.
    const [from, to] = rules.period;
    const [sent] = await tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${found.id}::uuid, 'EMAIL', ${from}::date, ${to}::date) AS count`;
    if ((sent?.count ?? 0) >= rules.cap) return 'CONTACT_CAP';
    const { id } = await tx.sending.create({
      data: {
        caseId: found.id,
        creditorId: found.creditorId,
        channel: 'EMAIL',
        template: chosen.template,
        level: REMINDER_LEVELS[chosen.template],
        contactId: chosen.contactId,
      },
      select: { id: true },
    });
    // The history says « Relance envoyée » when the worker has sent it, not before (question 219).
    await this.outbox.add({ queue: 'reminders', name: 'case-reminder', payload: { sending: id, case: found.id }, dedupeKey: `sending:${id}` });
    return null;
  }
}
