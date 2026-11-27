import { contactHours, type REQUEST_BODIES, type SendingRefusal } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { emailConfigOf } from '../../emails/config';
import { CONFIG, type Config } from '../../platform/config/config';
import { Database } from '../../platform/database/database';
import { conflict, forbidden, notFound } from '../../platform/errors/api-error';
import { dayOf, timeOf } from '../../platform/format';
import { PLACEHOLDER } from '../../platform/pdf/pdf';
import { mayActOn } from '../../platform/queue/jobs';
import { Outbox } from '../../platform/queue/outbox';
import { normalized } from '../cases/cases.service';
import { SettingValues } from '../settings/values';
import { capOf, capPeriod } from './contact-rules';

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
  ) {}

  /** The hour it is: the hours of the firm are judged on it. Set by the tests, which run at any hour. */
  now: () => Date = () => new Date();

  /** A reminder by e-mail, to an address of the case. Refused with the reason (409) when a rule of the firm forbids it. */
  async remind(caseId: string, body: Reminder): Promise<void> {
    const { tx } = this.database;
    const now = this.now();
    const found = await tx.case.findFirst({
      where: { id: caseId },
      select: {
        id: true,
        creditorId: true,
        closedOn: true,
        anonymizedAt: true,
        firstLetterReference: true,
        firstLetterOn: true,
        debtor: { select: { kind: true, siren: true } },
        contacts: { where: { kind: 'EMAIL', status: { not: 'INVALID' } }, select: { id: true, valueNormalized: true } },
      },
    });
    if (!found) throw notFound();
    if (!(await mayActOn(caseId)(tx))) throw forbidden();
    // Texts are with lot R; a registered letter with the letters of « Rédiger un courrier » (question 210).
    if (body.channel !== 'EMAIL') throw refused('NOT_AVAILABLE');
    if (found.closedOn || found.anonymizedAt) throw refused('CASE_CLOSED');
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
    if (Object.values(emailConfigOf(settings, this.config)).some((value) => typeof value === 'string' && PLACEHOLDER.test(value)))
      throw refused('FIRM_INCOMPLETE');
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
    await this.outbox.add({ queue: 'email', name: 'case-reminder', payload: { sending: id, case: caseId }, dedupeKey: `sending:${id}` });
    // Neither the address nor the text: the channel and the level.
    await tx.$executeRaw`SELECT app.add_case_event(${caseId}::uuid, 'REMINDER_SENT', 'Relance envoyée', ${`E-mail · niveau ${level}`}, 'info'::event_tone, false)`;
  }
}
