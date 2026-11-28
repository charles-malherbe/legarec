import { composeQuery, REMINDER_BATCH_MAX, type ComposeData, type SendingOutcome, type SendingRefusal } from '@legarec/contracts';
import type { REQUEST_BODIES } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { streetLinesOf } from '../../letters/postal';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { ApiError, conflict, forbidden, invalid, notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { Audit } from '../../platform/audit/audit';
import { currentActor } from '../../platform/http/context';
import { mayActOn } from '../../platform/queue/jobs';
import { Outbox } from '../../platform/queue/outbox';
import { Ledgers, owedOf } from '../payments/ledger';
import { SettingValues } from '../settings/values';
import { suspensionOf } from './contact-rules';
import { LETTER_DELAYS } from './letters.jobs';
import { SendingsService } from './sendings.service';

type Compose = z.infer<(typeof REQUEST_BODIES)['staff']['POST /documents/compose']>;
type Query = z.infer<typeof composeQuery>;
type Draft = z.infer<(typeof REQUEST_BODIES)['staff']['POST /documents/compose/draft']>;
/** Days late of the oldest invoice still due, for each choice of the screen. */
const BATCH_AGES: Record<Query['age'], [number, number]> = { '0-30': [1, 30], '31-60': [31, 60], '60+': [61, Number.MAX_SAFE_INTEGER] };
/** Who sends a grouped letter: the manager, as the screen offers it. */
const BATCH_SENDERS: ReadonlySet<string> = new Set(['COLLECTION_MANAGER']);
const staffRole = () => {
  const actor = currentActor();
  return actor.kind === 'staff' ? actor.role : null;
};
/** The filters a batch was confirmed with, as the screen sends them; null if they are not those it offers. */
const composeFilters = (filters: Compose['filters']): Query | null => {
  const read = composeQuery.strict().safeParse(filters);
  return read.success && filters && read.data.creditor === filters.creditor && read.data.age === filters.age ? read.data : null;
};
/** One case of a grouped selection. */
interface Selected {
  id: string;
  firstLetter: boolean;
  invoices: number;
  amount: number;
}
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
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  async data(query: Query = { creditor: 'all', age: '31-60' }): Promise<ComposeData> {
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
      batch: BATCH_SENDERS.has(staffRole() ?? '') ? await this.batch(query) : null,
    };
  }

  /** What the filters of a grouped sending select now, and the creditors one may choose among. */
  private async batch(query: Query): Promise<NonNullable<ComposeData['batch']>> {
    const { tx } = this.database;
    const creditors = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT DISTINCT cr.id, cr.name FROM cases c JOIN creditors cr ON cr.id = c.creditor_id
      WHERE c.closed_on IS NULL AND c.anonymized_at IS NULL AND app.can_act_on_case(c.officer_id) ORDER BY cr.name, cr.id LIMIT 200`;
    const selected = await this.selection(query);
    return {
      creditors,
      debtors: selected.length,
      invoices: selected.reduce((sum, item) => sum + item.invoices, 0),
      amount: selected.reduce((sum, item) => sum + item.amount, 0),
      withoutFirstLetter: selected.filter((item) => !item.firstLetter).length,
    };
  }

  /**
   * The open cases the caller acts on, of the creditor chosen, whose oldest invoice still due is as late as chosen: one
   * letter for each (a debtor with two cases receives two). Read again when the batch is sent.
   */
  private async selection({ creditor, age }: Query): Promise<Selected[]> {
    const { tx } = this.database;
    const today = dayOf(this.clock.now());
    const [from, to] = BATCH_AGES[age];
    // In one query, whatever the size of the portfolio: the principal still due, invoice by invoice (the interest and the
    // indemnities are those of each letter, counted when it is written).
    const found = await tx.$queryRaw<{ id: string; first: boolean; invoices: number; amount: bigint }[]>`
      SELECT c.id, (c.first_letter_reference IS NOT NULL AND c.first_letter_on IS NOT NULL) AS first,
        count(*)::int AS invoices, sum(i.principal_cents - i.principal_paid_cents) AS amount
      FROM cases c JOIN case_invoices i ON i.case_id = c.id AND i.principal_cents > i.principal_paid_cents
      WHERE c.closed_on IS NULL AND c.anonymized_at IS NULL AND app.can_act_on_case(c.officer_id)
        AND (${creditor} = 'all' OR c.creditor_id::text = ${creditor})
      GROUP BY c.id
      HAVING ${today}::date - min(i.due_on) BETWEEN ${from}::int AND ${to}::bigint
      ORDER BY min(c.created_at), c.id`;
    return found.map((row) => ({ id: row.id, firstLetter: row.first, invoices: row.invoices, amount: Number(row.amount) }));
  }

  /**
   * A grouped sending (manager): the selection is read again, and refused if it no longer holds the number confirmed. Then
   * each case is judged by the rules of a single letter: what they refuse is left out with its reason, the rest is queued.
   * Neither the formal notice (a colleague decides it from the case, question 220) nor the certificate leave in a batch.
   */
  private async grouped(body: Compose, filters: Query): Promise<SendingOutcome> {
    if (!BATCH_SENDERS.has(staffRole() ?? '')) throw forbidden();
    if (body.template !== 'FRIENDLY' && body.template !== 'FIRM') throw conflict('NOT_AVAILABLE');
    const template = body.template;
    const all = await this.selection(filters);
    // The firm reminder recalls the first letter: whoever has none is left out, as the screen says.
    const selected = template === 'FIRM' ? all.filter((item) => item.firstLetter) : all;
    if (selected.length === 0 || selected.length !== body.expected) throw conflict('SELECTION_CHANGED');
    if (selected.length > REMINDER_BATCH_MAX) throw invalid({ field: 'filters', max: REMINDER_BATCH_MAX });
    const skipped: SendingOutcome['skipped'] = [];
    for (const { id } of selected) {
      try {
        await this.one(id, template, body.channel, body.delay);
      } catch (error) {
        // A rule refuses it before anything is written for the case: left out with its reason.
        if (error instanceof ApiError && error.status === 409) skipped.push({ id, reason: error.code as SendingRefusal });
        else throw error;
      }
    }
    const queued = selected.length - skipped.length;
    // Who, how many, when and on whose behalf: neither a case nor a debtor.
    if (queued > 0) await this.audit.log({ action: 'LETTERS_GROUPED', params: { count: queued } });
    return { queued, skipped };
  }

  async compose(body: Compose): Promise<SendingOutcome> {
    if (!TEMPLATES.has(body.template)) throw conflict('NOT_AVAILABLE');
    if (!LETTER_DELAYS.includes(body.delay)) throw invalid({ field: 'delay' });
    if (!body.caseIds) {
      const filters = composeFilters(body.filters);
      if (!filters) throw invalid({ field: 'filters' });
      return this.grouped(body, filters);
    }
    // One case was confirmed: anything else is another selection.
    if (body.expected !== 1) throw conflict('SELECTION_CHANGED');
    const [caseId] = body.caseIds as [string];
    await this.one(caseId, body.template, body.channel, body.delay);
    return { queued: 1, skipped: [] };
  }

  /** One case, by the channel chosen. */
  private async one(caseId: string, wanted: Compose['template'], channel: Compose['channel'], delay: number): Promise<void> {
    const body = { template: wanted, channel, delay };
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
  private async file(caseId: string, template: 'FRIENDLY' | 'FIRM' | 'FORMAL_NOTICE' | 'CLEARANCE', delay: number, draft = false): Promise<void> {
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
    await this.outbox.add({ queue: 'reminders', name: draft ? 'case-letter-draft' : 'case-letter-file', payload: { case: caseId, template, delay } });
  }

  /**
   * « Enregistrer le brouillon »: the PDF of the template for the case, kept in it as a draft and sent to nobody, with the
   * checks of « Télécharger seulement » and the delay of 8 days (the screen sends neither delay nor text).
   */
  async draft(body: Draft): Promise<void> {
    if (!TEMPLATES.has(body.template)) throw conflict('NOT_AVAILABLE');
    return this.file(body.caseId, body.template as 'FRIENDLY' | 'FIRM' | 'FORMAL_NOTICE' | 'CLEARANCE', LETTER_DELAYS[0]!, true);
  }
}
