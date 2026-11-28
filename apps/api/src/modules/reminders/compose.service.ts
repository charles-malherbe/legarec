import type { ComposeData } from '@legarec/contracts';
import type { REQUEST_BODIES } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { streetLinesOf } from '../../letters/postal';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { conflict, forbidden, invalid, notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { mayActOn } from '../../platform/queue/jobs';
import { Outbox } from '../../platform/queue/outbox';
import { Ledgers, owedOf } from '../payments/ledger';
import { SettingValues } from '../settings/values';
import { suspensionOf } from './contact-rules';
import { LETTER_DELAYS } from './letters.jobs';
import { SendingsService } from './sendings.service';

type Compose = z.infer<(typeof REQUEST_BODIES)['staff']['POST /documents/compose']>;
/** Cases offered by « Rédiger un courrier »: the most recent the caller acts on. */
const RECIPIENTS_MAX = 50;
/** Closed cases stay offered for so many days: the certificate of a settled case is written after it closed. */
const CLOSED_DAYS = 90;
/** What leaves from here for now: the three reminders of Paramètres › Modèles (question 210). */
const TEMPLATES: ReadonlySet<string> = new Set(['FRIENDLY', 'FIRM', 'FORMAL_NOTICE', 'CLEARANCE']);
const QUOTES_FIRST_LETTER: ReadonlySet<string> = new Set(['FIRM', 'FORMAL_NOTICE']);

/**
 * « Rédiger un courrier » (Documents). One case at a time: a registered or a plain letter by MySendingBox, with the rules of
 * the registered letter of the case card; the validated e-mail of the same level with the letter joined, with the rules of
 * an e-mail reminder; or the PDF alone, kept in the case. The link to sign, the payment plan, the clearance certificate and the grouped sending are not open yet: 409 `NOT_AVAILABLE`.
 */
@Injectable()
export class ComposeService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Ledgers) private readonly ledgers: Ledgers,
    @Inject(SendingsService) private readonly sendings: SendingsService,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async data(): Promise<ComposeData> {
    const { tx } = this.database;
    const settings = await SettingValues.read(tx);
    const firm = (field: string) => settings.text('firm', 'cabinet', field);
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM cases c
      WHERE (c.closed_on IS NULL OR c.closed_on >= current_date - ${CLOSED_DAYS}::int) AND c.anonymized_at IS NULL AND app.can_act_on_case(c.officer_id)
      ORDER BY c.created_at DESC, c.id LIMIT ${RECIPIENTS_MAX}`;
    const found = await tx.case.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        reference: true,
        contactName: true,
        debtorAddress: true,
        debtorPostalCode: true,
        debtorCity: true,
        firstLetterReference: true,
        firstLetterOn: true,
        creditor: { select: { name: true } },
        debtor: { select: { name: true, kind: true } },
        sendings: { where: { status: 'SENT' }, orderBy: { sentAt: 'desc' }, take: 1, select: { sentAt: true } },
      },
    });
    const today = dayOf(this.clock.now());
    const recipients: ComposeData['recipients'] = [];
    for (const item of found) {
      const ledger = await this.ledgers.read(item.id, today);
      if (!ledger) continue;
      const owed = owedOf(ledger);
      const street = streetLinesOf(item.debtorAddress) ?? [];
      const city = [item.debtorPostalCode, item.debtorCity].filter(Boolean).join(' ');
      const sent = item.sendings[0]?.sentAt;
      recipients.push({
        caseId: item.id,
        name: item.debtor.name,
        contact: item.contactName ?? '',
        address: [...street, ...(city ? [city] : [])],
        creditor: item.creditor.name,
        reference: item.reference,
        isIndividual: item.debtor.kind === 'INDIVIDUAL',
        settled: owed.principal + owed.interest + owed.fees === 0,
        lastReminder: sent ? dayOf(sent) : null,
        firstLetter: item.firstLetterReference && item.firstLetterOn ? { reference: item.firstLetterReference, date: dayOf(item.firstLetterOn) } : null,
        interest: owed.interest,
        invoices: ledger.invoices
          .filter((invoice) => invoice.principalLeft > 0)
          .map((invoice) => ({ number: invoice.number, due: invoice.dueOn, amount: invoice.principalLeft })),
      });
    }
    return {
      firm: { name: firm('name'), address: firm('address'), phone: firm('phone'), siren: firm('siren') },
      recipients,
      // The grouped sending is not open yet: the screen offers one case at a time.
      batch: null,
    };
  }

  async compose(body: Compose): Promise<void> {
    if (!body.caseIds) throw conflict('NOT_AVAILABLE');
    if (!TEMPLATES.has(body.template)) throw conflict('NOT_AVAILABLE');
    // One case was confirmed: anything else is another selection.
    if (body.expected !== 1) throw conflict('SELECTION_CHANGED');
    if (!LETTER_DELAYS.includes(body.delay)) throw invalid({ field: 'delay' });
    const [caseId] = body.caseIds as [string];
    // The certificate of a settled case is no reminder: kept in the case only, for now (Télécharger seulement).
    if (body.template === 'CLEARANCE') {
      if (body.channel !== 'DOWNLOAD') throw conflict('NOT_AVAILABLE');
      return this.file(caseId, 'CLEARANCE', body.delay);
    }
    const template = body.template as 'FRIENDLY' | 'FIRM' | 'FORMAL_NOTICE';
    if (body.channel === 'REGISTERED_LETTER' || body.channel === 'LETTER') return this.sendings.letter(caseId, template, body.channel, body.delay);
    if (body.channel === 'EMAIL_PDF') return this.sendings.emailWithLetter(caseId, template, body.delay);
    if (body.channel !== 'DOWNLOAD') throw conflict('NOT_AVAILABLE');
    return this.file(caseId, template, body.delay);
  }

  /** « Télécharger seulement »: the PDF alone, written by the worker and kept in the case, sent to nobody. */
  private async file(caseId: string, template: 'FRIENDLY' | 'FIRM' | 'FORMAL_NOTICE' | 'CLEARANCE', delay: number): Promise<void> {
    const { tx } = this.database;
    const found = await tx.case.findFirst({
      where: { id: caseId },
      select: {
        id: true,
        closedOn: true,
        anonymizedAt: true,
        status: true,
        firstLetterReference: true,
        firstLetterOn: true,
        debtorAddress: true,
        debtorPostalCode: true,
        debtorCity: true,
        _count: { select: { plans: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!found) throw notFound();
    if (!(await mayActOn(caseId)(tx))) throw forbidden();
    // A settled case is closed at once: only its certificate is still written for it.
    if (found.anonymizedAt || (found.closedOn && template !== 'CLEARANCE')) throw conflict('CASE_CLOSED');
    if (template === 'CLEARANCE') {
      // Everything paid: principal, interest and indemnities, as the ledger reads them today.
      const ledger = await this.ledgers.read(caseId, dayOf(this.clock.now()));
      const owed = ledger && owedOf(ledger);
      if (!ledger || !owed || ledger.invoices.length === 0 || owed.principal + owed.interest + owed.fees > 0) throw conflict('NOT_SETTLED');
    } else {
      const suspended = suspensionOf(found.status, found._count.plans);
      if (suspended) throw conflict(suspended);
      if (QUOTES_FIRST_LETTER.has(template) && (!found.firstLetterReference || !found.firstLetterOn)) throw conflict('NO_FIRST_LETTER');
    }
    if (!streetLinesOf(found.debtorAddress) || !found.debtorPostalCode || !found.debtorCity?.trim()) throw conflict('NO_ADDRESS');
    await this.outbox.add({ queue: 'reminders', name: 'case-letter-file', payload: { case: caseId, template, delay } });
  }

  /** « Enregistrer le brouillon »: not open yet. */
  draft(): Promise<void> {
    return Promise.reject(conflict('NOT_AVAILABLE'));
  }
}
