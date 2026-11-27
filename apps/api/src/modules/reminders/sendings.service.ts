import { contactHours, type REQUEST_BODIES, type SendingRefusal } from '@legarec/contracts';
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
/** The validated e-mail of the kit for each template of the form: reminder-1 to reminder-3 (question 212). */
export const REMINDER_LEVELS = { FRIENDLY: 1, FIRM: 2, FORMAL_NOTICE: 3 } as const;
const refused = (reason: SendingRefusal) => conflict(reason);

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
    const now = this.clock.now();
    const found = await tx.case.findFirst({
      where: { id: caseId },
      select: {
        id: true,
        creditorId: true,
        status: true,
        closedOn: true,
        anonymizedAt: true,
        firstLetterReference: true,
        firstLetterOn: true,
        debtor: { select: { kind: true, siren: true } },
        contacts: { where: { kind: 'EMAIL', status: { not: 'INVALID' } }, select: { id: true, valueNormalized: true } },
        _count: { select: { plans: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!found) throw notFound();
    if (!(await mayActOn(caseId)(tx))) throw forbidden();
    // Texts are with lot R; a registered letter with the letters of « Rédiger un courrier » (question 210).
    if (body.channel !== 'EMAIL') throw refused('NOT_AVAILABLE');
    if (found.closedOn || found.anonymizedAt) throw refused('CASE_CLOSED');
    // Nothing leaves during a dispute or a litigation, nor while a plan is respected (question 218).
    const suspended = suspensionOf(found.status, found._count.plans);
    if (suspended) throw refused(suspended);
    // The reminders of the kit name a company by its SIREN: never an individual.
    if (found.debtor.kind === 'INDIVIDUAL' || !found.debtor.siren) throw refused('INDIVIDUAL');
    // The first contact is a postal letter: nothing else before it has left (question 83).
    if (!found.firstLetterReference || !found.firstLetterOn) throw refused('NO_FIRST_LETTER');
    if (found.contacts.length === 0) throw refused('NO_EMAIL');
    const wanted = normalized('EMAIL', body.recipient);
    const contact = found.contacts.find((item) => item.valueNormalized === wanted);
    if (!contact) throw refused('UNKNOWN_RECIPIENT');
    const settings = await SettingValues.read(tx);
    // What the firm has not typed yet would leave between brackets.
    if (firmIncomplete(emailConfigOf(settings, this.config))) throw refused('FIRM_INCOMPLETE');
    // In production nothing is simulated: without the key of the service, the reminder would wait, then expire.
    if (this.config.NODE_ENV === 'production') {
      const [service] = await tx.$queryRaw<{ ready: boolean }[]>`SELECT app.service_ready('RESEND_API_KEY') AS ready`;
      if (service?.ready !== true) throw refused('SERVICE_NOT_READY');
    }
    const relances = (field: string) => settings.text('firm', 'relances', field);
    const today = dayOf(now);
    if (contactHours(relances).outsideHours('EMAIL', today, timeOf(now))) throw refused('OUTSIDE_HOURS');
    // Counted last: whoever counts holds the debtor until the end of the request.
    const [from, to] = capPeriod('EMAIL', today);
    const [sent] = await tx.$queryRaw<{ count: number }[]>`SELECT app.sent_contacts(${caseId}::uuid, 'EMAIL', ${from}::date, ${to}::date) AS count`;
    if ((sent?.count ?? 0) >= capOf('EMAIL', relances).cap) throw refused('CONTACT_CAP');
    const level = REMINDER_LEVELS[body.template];
    const { id } = await tx.sending.create({
      data: { caseId, creditorId: found.creditorId, channel: 'EMAIL', template: body.template, level, contactId: contact.id },
      select: { id: true },
    });
    // The history says « Relance envoyée » when the worker has sent it, not before (question 219).
    await this.outbox.add({ queue: 'reminders', name: 'case-reminder', payload: { sending: id, case: caseId }, dedupeKey: `sending:${id}` });
  }
}
