import {
  formatPhone,
  hasDelegation,
  isValidSiret,
  LEGAL_FORMS,
  sirenOfNumber,
  type CaseCheckResult,
  type CaseDetail,
  type CaseFilter,
  type CaseInvoice,
  type CaseListItem,
  type NewCase,
} from '@legarec/contracts';
import type { addedInvoices, caseChoices, caseList, caseSearchQuery, debtorCorrection } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { Audit } from '../../platform/audit/audit';
import type { Actor } from '../../platform/database/actor';
import { Database, type Transaction } from '../../platform/database/database';
import { takenIndex } from '../../platform/database/codes';
import { containing, nothing, sql, type Sql } from '../../platform/database/sql';
import { ApiError, conflict, forbidden, invalid, notFound } from '../../platform/errors/api-error';
import { dayOf, longDay, timeOf } from '../../platform/format';
import { AccessCodes } from '../debtor-access/access-codes';
import { currentOf, dayText, termsOf } from '../creditors/mandates';
import { lateDays } from '../creditors/late';
import { STATUS_LABELS } from './labels';
import { Ledgers, owedOf } from '../payments/ledger';

export type StaffActor = Extract<Actor, { kind: 'staff' }>;
type Query = z.infer<typeof caseSearchQuery>;

const date = (value: string) => new Date(`${value}T00:00:00Z`);
const digits = (value: string) => value.replace(/\D/gu, '');
const spaced = (value: string) =>
  value.replace(/(\d{3})(\d{3})(\d{3})(\d{5})?/u, (_whole, a: string, b: string, c: string, d?: string) => [a, b, c, d].filter(Boolean).join(' '));
const fullName = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;
const plural = (count: number) => `${count} facture${count > 1 ? 's' : ''}`;
const SHOWN = 500;

/** Statuses behind each tab. */
const GROUPS: Record<Exclude<CaseFilter, 'all' | 'unassigned'>, CaseListItem['status'][]> = {
  overdue: ['OVERDUE', 'FORMAL_NOTICE'],
  reminder: ['REMINDER'],
  promise: ['PROMISE', 'PLAN'],
  dispute: ['DISPUTE'],
  settled: ['SETTLED', 'LOST'],
};
const FILTERS: CaseFilter[] = ['all', 'overdue', 'reminder', 'promise', 'dispute', 'settled', 'unassigned'];
const AGES: Record<string, [number, number]> = { '0-30': [0, 30], '31-60': [31, 60], '61-90': [61, 90], '90+': [91, 100_000] };

interface Row {
  id: string;
  reference: string;
  creditor_id: string;
  creditor: string;
  name: string;
  kind: 'COMPANY' | 'SOLE_TRADER' | 'INDIVIDUAL';
  siren: string | null;
  siret: string | null;
  status: CaseListItem['status'];
  first_letter_on: Date | null;
  officer_id: string | null;
  officer: string | null;
  can_act: boolean;
  anonymized: boolean;
  version: number;
  invoices: number;
  amount: bigint;
  oldest: Date | null;
}

/** What the team reads and does of the cases. PostgreSQL decides which ones: nothing here filters by role. */
@Injectable()
export class CasesService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(AccessCodes) private readonly codes: AccessCodes,
    @Inject(Ledgers) private readonly ledgers: Ledgers,
  ) {}

  async search(query: string, { creditor, status, officer, age }: Query): Promise<z.infer<typeof caseList>> {
    const all = await this.rows(creditor === 'all' ? nothing : sql`AND c.creditor_id = ${creditor}::uuid`);
    const now = dayOf(new Date());
    const late = (row: Row) => lateDays(row.oldest, now);
    const inTab = (row: Row, tab: CaseFilter) => tab === 'all' || (tab === 'unassigned' ? row.officer_id === null : GROUPS[tab].includes(row.status));
    const range = AGES[age];
    const matching = await this.matching(query, all);
    const found = all.filter((row) => {
      const days = late(row);
      return (
        inTab(row, status) &&
        (officer === 'all' || row.officer_id === officer) &&
        (!range || (days !== null && days >= range[0] && days <= range[1])) &&
        (!matching || matching.has(row.id))
      );
    });
    const open = all.filter((row) => Number(row.amount) > 0);
    const old = open.filter((row) => (late(row) ?? 0) > 60);
    return {
      items: found.slice(0, SHOWN).map((row) => itemOf(row, now)),
      total: found.length,
      counts: Object.fromEntries(FILTERS.map((tab) => [tab, all.filter((row) => inTab(row, tab)).length])) as Record<CaseFilter, number>,
      stats: {
        outstanding: sum(open),
        invoices: open.reduce((total, row) => total + row.invoices, 0),
        overdue: open.filter((row) => (late(row) ?? 0) > 0).length,
        overdueAmount: sum(old),
        // Promises, payments and goals: with their own modules.
        promises: all.filter((row) => row.status === 'PROMISE').length,
        promisesToday: 0,
        recovered: 0,
        targetRatio: null,
      },
    };
  }

  /** The last summary of the assistant, unless it was reported: always shown as « Proposé par l'IA ». */
  private async aiSummary(id: string): Promise<CaseDetail['aiSummary']> {
    const last = await this.database.tx.aiSuggestion.findFirst({
      where: { caseId: id, feature: 'CASE_SUMMARY', outcome: 'SUGGESTED' },
      orderBy: { createdAt: 'desc' },
      select: { output: true, events: true, createdAt: true, decision: true },
    });
    // Reported, nothing is shown: never an older one in its place.
    if (last?.decision === 'REPORTED') return null;
    const lines = (last?.output as { lines?: { k: string; v: string }[] } | null)?.lines;
    if (!last || !lines) return null;
    return { events: last.events, updated: `le ${dayOf(last.createdAt).slice(8, 10)}/${dayOf(last.createdAt).slice(5, 7)} à ${timeOf(last.createdAt)}`, lines };
  }

  /**
   * The name and the kind of the debtor of a case, for all its cases (question 138). PostgreSQL checks who may, from a case
   * they act on, that the name is still the one shown, and notes it in the history of each case of the debtor.
   */
  async correctDebtor(id: string, body: z.infer<typeof debtorCorrection>): Promise<void> {
    const { tx } = this.database;
    const found = await tx.case.findUnique({ where: { id }, select: { debtorId: true, debtor: { select: { siren: true } } } });
    if (!found) throw notFound();
    if (body.kind === 'INDIVIDUAL' && found.debtor.siren) throw invalid({ fields: ['kind'] });
    const [row] = await tx.$queryRaw<{ done: string | null }[]>`
      SELECT app.correct_debtor(${id}::uuid, ${body.kind}::debtor_kind, ${body.name}, ${body.seen}) AS done`;
    if (!row?.done) throw notFound();
    if (row.done !== 'DONE') throw conflict('CHANGED');
    // The debtor, which all its cases share; never its name.
    await this.audit.log({ action: 'DEBTOR_CORRECTED', entity: { type: 'debtor', id: found.debtorId } });
  }

  async detail(actor: StaffActor, id: string): Promise<CaseDetail> {
    const { tx } = this.database;
    const [row] = await this.rows(sql`AND c.id = ${id}::uuid`);
    if (!row) {
      // « Accès refusé » for a case of someone else, as the firm wants it (question 141): the team alone is told that it exists.
      const [known] = await tx.$queryRaw<{ found: boolean }[]>`SELECT app.case_exists(${id}::uuid) AS found`;
      throw known?.found ? forbidden() : notFound();
    }
    // The Director reads a case of someone else: noted once an hour.
    await tx.$executeRaw`SELECT app.note_consultation(${id}::uuid)`;
    // First of the cases offered under the search box (DECISIONS.md, 28/11/2026).
    await tx.$executeRaw`SELECT app.note_recent_case(${id}::uuid)`;
    const found = await tx.case.findUniqueOrThrow({
      where: { id },
      select: {
        externalReference: true,
        anonymizedAt: true,
        debtorId: true,
        debtorAddress: true,
        debtorPostalCode: true,
        debtorCity: true,
        contactName: true,
        contactTitle: true,
        firstLetterReference: true,
        firstLetterOn: true,
        mandate: true,
        creditor: { select: { sector: true } },
        debtor: { select: { name: true, kind: true, siren: true, anonymizedAt: true } },
        invoices: { orderBy: [{ dueOn: 'asc' }, { number: 'asc' }] },
        contacts: { where: { status: { not: 'INVALID' } }, orderBy: [{ kind: 'desc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }] },
        events: { orderBy: { occurredAt: 'desc' }, take: SHOWN, include: { onBehalfOf: { select: { firstName: true, lastName: true } } } },
      },
    });
    const now = dayOf(new Date());
    const main = (kind: 'PHONE' | 'EMAIL') => found.contacts.find((contact) => contact.kind === kind)?.value ?? '';
    const others = await this.others(found.debtorId, id);
    const ledger = await this.ledgers.read(id, now, actor.role === 'DIRECTOR');
    const owed = ledger ? owedOf(ledger) : { principal: Number(row.amount), interest: 0, fees: 0 };
    return {
      ...itemOf(row, now),
      creditorRef: found.externalReference ?? '—',
      isIndividual: row.kind === 'INDIVIDUAL',
      principal: owed.principal,
      interest: owed.interest,
      fees: owed.fees,
      // What has left for the debtor from this case (lot Q): a sending that failed before leaving does not count.
      remindersSent: await tx.sending.count({ where: { caseId: id, status: { not: 'FAILED' } } }),
      remindersTotal: 0,
      risk: null,
      contacts: found.contacts.map(({ id: contactId, kind, value, status }) => ({ id: contactId, kind, value, verified: status === 'VERIFIED' })),
      mainContact: {
        name: found.contactName ?? 'Aucun interlocuteur',
        title: found.contactTitle ?? '',
        phone: main('PHONE'),
        email: main('EMAIL'),
        address: [found.debtorAddress, [found.debtorPostalCode, found.debtorCity].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      },
      aiSummary: await this.aiSummary(id),
      invoices: found.invoices.map((invoice) => ({
        number: invoice.number,
        issued: dayText(invoice.issuedOn),
        due: dayText(invoice.dueOn),
        amount: invoice.principalCents - invoice.principalPaidCents,
        daysLate: lateDays(invoice.dueOn, now) ?? 0,
      })),
      history: found.events.map((event) => ({
        id: event.id,
        title: event.title,
        detail: event.detail ?? '',
        date: longDay(event.occurredAt),
        actor: event.actorKind === 'SYSTEM' ? 'automatique' : event.actorLabel,
        onBehalfOf: event.onBehalfOf ? fullName(event.onBehalfOf) : null,
        tone: event.tone,
      })),
      // From a case one acts on, not forgotten (the Director changes nothing from a case of someone else).
      correctable:
        (actor.role === 'DIRECTOR' || actor.role === 'COLLECTION_MANAGER') && row.can_act && !found.anonymizedAt && !found.debtor.anonymizedAt
          ? { name: found.debtor.name, kind: found.debtor.kind, hasSiren: found.debtor.siren !== null }
          : null,
      // Messages, payments, documents and scenarios: with their own modules.
      exchanges: (
        await tx.portalMessage.findMany({
          where: { caseId: id },
          orderBy: { createdAt: 'desc' },
          take: SHOWN,
          select: { id: true, side: true, text: true, createdAt: true },
        })
      ).map((message) => ({
        id: message.id,
        channel: message.side === 'DEBTOR' ? ('PORTAL_IN' as const) : ('PORTAL_OUT' as const),
        title: message.side === 'DEBTOR' ? 'Message dans l’espace débiteur' : 'Réponse du cabinet',
        text: message.text,
        when: longDay(message.createdAt),
        delivery: message.side === 'STAFF' ? ('SENT' as const) : null,
        acknowledgmentId: null,
        verified: true,
      })),
      payments: ledger?.payments ?? [],
      documents: [],
      mandate: { sector: found.creditor.sector ?? '', terms: found.mandate ? termsOf(found.mandate, 'case') : [] },
      otherClaims: others,
      scenario: [],
      firstLetter: found.firstLetterReference && found.firstLetterOn ? { reference: found.firstLetterReference, date: dayText(found.firstLetterOn) } : null,
      contactLimit: null,
    };
  }

  async assign(ids: string[], officerId: string): Promise<void> {
    const { tx } = this.database;
    const officer = await tx.user.findFirst({
      where: { id: officerId, status: 'ACTIVE', role: { in: ['DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER'] } },
      select: { id: true },
    });
    if (!officer) throw new ApiError(422, 'INVALID_OFFICER');
    const wanted = [...new Set(ids)];
    // Only what the actor sees; one that is missing stops the whole.
    if ((await tx.case.count({ where: { id: { in: wanted } } })) !== wanted.length) throw forbidden();
    const [row] = await tx.$queryRaw<{ changed: number }[]>`SELECT app.assign_cases(${wanted}::uuid[], ${officerId}::uuid) AS changed`;
    if (row!.changed) await this.audit.log({ action: 'CASES_ASSIGNED', params: { count: row!.changed, officer: officerId } });
  }

  // ---------------------------------------------------------------- Opening

  async choices(actor: StaffActor): Promise<z.infer<typeof caseChoices>> {
    const { tx } = this.database;
    const [creditors, officers] = [
      await tx.creditor.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      await tx.user.findMany({
        where: { status: 'ACTIVE', role: { in: ['DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER'] }, id: { not: actor.userId } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
    ];
    return {
      creditors,
      officers: officers.map((officer) => ({ id: officer.id, name: fullName(officer) })),
      mayAssign:
        actor.role === 'DIRECTOR' || hasDelegation({ role: actor.role, activeDelegations: [...actor.delegations], userId: actor.userId }, 'ADMINISTRATIVE'),
    };
  }

  /** What the person may know before they open a case: the cases that PostgreSQL does not show them are not told of. */
  async check(creditorId: string, number: string): Promise<CaseCheckResult> {
    const { tx } = this.database;
    const creditor = await tx.creditor.findUnique({ where: { id: creditorId }, select: { mandates: { orderBy: { startsOn: 'asc' } } } });
    if (!creditor) throw notFound();
    const current = currentOf(creditor.mandates);
    const next = creditor.mandates.find((mandate) => dayText(mandate.startsOn) > dayOf(new Date()));
    const siren = sirenOfNumber(number);
    const known = /^\d{9}$/u.test(siren) ? await tx.debtor.findFirst({ where: { siren }, select: { id: true, name: true, kind: true } }) : null;
    const [open] = known ? await this.rows(sql`AND c.creditor_id = ${creditorId}::uuid AND c.debtor_id = ${known.id}::uuid AND c.closed_on IS NULL`) : [];
    return {
      mandate: current
        ? {
            id: current.id,
            since: dayText(current.startsOn),
            scenario: current.scenario,
            fixedIndemnity: current.fixedIndemnity,
            hasContract: false,
            terms: termsOf(current, 'opening'),
          }
        : null,
      known: known ? { name: known.name, kind: known.kind } : null,
      startsOn: !current && next ? dayText(next.startsOn) : null,
      open: open ? { id: open.id, reference: open.reference, name: open.name, version: open.version, officer: open.officer, canAct: open.can_act } : null,
      others: known ? (await this.others(known.id, null, creditorId)).map(({ creditor: name, invoices }) => ({ creditor: name, invoices })) : [],
    };
  }

  async open(actor: StaffActor, body: NewCase): Promise<{ id: string; reference: string }> {
    const { tx } = this.database;
    // An amendment of the mandate waits.
    await tx.$executeRaw`SELECT 1 FROM creditors WHERE id = ${body.creditorId}::uuid FOR SHARE`;
    const creditor = await tx.creditor.findFirst({
      where: { id: body.creditorId, status: 'ACTIVE' },
      select: { id: true, mandates: { orderBy: { startsOn: 'asc' } } },
    });
    if (!creditor) throw notFound();
    const mandate = currentOf(creditor.mandates);
    if (!mandate) throw conflict('NO_MANDATE');
    // What was shown is what applies.
    if (mandate.id !== body.mandateId) throw conflict('CHANGED');
    const individual = body.kind === 'INDIVIDUAL';
    const [debtor] = await tx.$queryRaw<{ id: string | null }[]>`
      SELECT app.open_debtor(${body.kind}::debtor_kind, ${body.name}, ${individual ? null : sirenOfNumber(body.number)}, ${body.legalForm || null}) AS id`;
    if (!debtor?.id) throw conflict('DEBTOR_MISMATCH');
    // The Director opens it for themselves, then gives it up: nobody else may write in it.
    const officerId = body.toMe || actor.role === 'DIRECTOR' ? actor.userId : null;
    const [drawn] = await tx.$queryRaw<{ for_year: number; number: number }[]>`SELECT * FROM app.next_number('CASE')`;
    const id = randomUUID();
    const reference = `LGR-${drawn!.for_year}-${String(drawn!.number).padStart(5, '0')}`;
    try {
      await tx.case.create({
        data: {
          id,
          reference,
          creditorId: body.creditorId,
          debtorId: debtor.id,
          officerId,
          mandateId: mandate.id,
          externalReference: body.externalReference || null,
          debtorSiret: isValidSiret(body.number) ? digits(body.number) : null,
          debtorAddress: body.address,
          debtorPostalCode: body.postalCode,
          debtorCity: body.city,
          contactName: body.contactName || null,
          contactTitle: body.contactTitle || null,
          scenario: body.scenario,
          createdBy: actor.userId,
        },
        select: { id: true },
      });
    } catch (error) {
      // One open case for a creditor and a debtor, whether or not this person sees the other one.
      if (takenIndex(error) === 'cases_one_open') throw conflict('CASE_EXISTS');
      throw error;
    }
    await this.addInvoices(tx, actor, id, body.creditorId, body.invoices);
    for (const contact of body.contacts)
      await this.addContact(tx, actor, { caseId: id, creditorId: body.creditorId, ...contact, source: 'CREDITOR', status: 'UNVERIFIED' });
    await this.event(
      id,
      'CASE_OPENED',
      'Dossier ouvert',
      `${plural(body.invoices.length)} · ${individual ? 'particulier' : (LEGAL_FORMS[body.legalForm] ?? 'entreprise')}`,
    );
    await this.codes.ensure(id);
    if (actor.role === 'DIRECTOR' && !body.toMe) await tx.$executeRaw`SELECT app.assign_cases(ARRAY[${id}]::uuid[], NULL)`;
    await this.audit.log({ action: 'CASE_OPENED', entity: { type: 'case', id } });
    return { id, reference };
  }

  /** A note of the team, kept from the creditor; whoever acts on the case writes it, and the audit notes it without its text. */
  async addNote(id: string, text: string): Promise<void> {
    const { tx } = this.database;
    const [row] = await this.rows(sql`AND c.id = ${id}::uuid`);
    if (!row) throw notFound();
    if (!row.can_act) throw forbidden();
    await tx.$executeRaw`SELECT app.add_case_event(${id}::uuid, 'CASE_NOTE', 'Note', ${text}, 'info'::event_tone, false)`;
    await this.audit.log({ action: 'CASE_NOTE_ADDED', entity: { type: 'case', id } });
  }

  async addToCase(actor: StaffActor, id: string, { version, invoices }: z.infer<typeof addedInvoices>): Promise<void> {
    const { tx } = this.database;
    const [row] = await this.rows(sql`AND c.id = ${id}::uuid`);
    if (!row) throw notFound();
    if (!row.can_act) throw forbidden();
    if (row.status === 'SETTLED' || row.status === 'LOST') throw conflict('CASE_CLOSED');
    const { count } = await tx.case.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
    if (!count) throw conflict('CHANGED');
    const numbers = new Set(
      (await tx.caseInvoice.findMany({ where: { caseId: id }, select: { number: true } })).map((invoice) => invoice.number.toLowerCase()),
    );
    if (invoices.some((invoice) => numbers.has(invoice.number.toLowerCase()))) throw conflict('INVOICE_EXISTS');
    await this.addInvoices(tx, actor, id, row.creditor_id, invoices);
    await this.event(id, 'INVOICES_ADDED', 'Factures ajoutées', plural(invoices.length));
    await this.audit.log({ action: 'CASE_INVOICES_ADDED', entity: { type: 'case', id }, params: { count: invoices.length } });
  }

  // ---------------------------------------------------------------- Shared

  /** The case, for whoever may act on it. */
  async acting(id: string): Promise<Row> {
    const [row] = await this.rows(sql`AND c.id = ${id}::uuid`);
    if (!row) throw notFound();
    if (!row.can_act) throw forbidden();
    // Anonymized (retention, erasure): nothing is added to it any more.
    if (row.anonymized) throw conflict('CHANGED');
    return row;
  }

  async event(id: string, kind: string, title: string, detail: string, tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' = 'info'): Promise<void> {
    await this.database.tx.$executeRaw`SELECT app.add_case_event(${id}::uuid, ${kind}, ${title}, ${detail || null}, ${tone}::event_tone, false)`;
  }

  async addContact(
    tx: Transaction,
    actor: StaffActor,
    contact: {
      caseId: string;
      creditorId: string;
      kind: 'PHONE' | 'EMAIL';
      label: string;
      value: string;
      primary: boolean;
      source: 'CALL' | 'IMPORT' | 'DOCUMENT' | 'CREDITOR';
      status: 'UNVERIFIED' | 'NEW';
    },
  ): Promise<string> {
    const { id } = await tx.caseContact.create({
      data: {
        caseId: contact.caseId,
        creditorId: contact.creditorId,
        kind: contact.kind,
        label: contact.label,
        value: contact.kind === 'PHONE' ? formatPhone(contact.value) : contact.value.trim(),
        valueNormalized: normalized(contact.kind, contact.value),
        isPrimary: contact.primary,
        source: contact.source,
        status: contact.status,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await tx.$executeRaw`SELECT app.note_contact(${id}::uuid, 'ADDED')`;
    return id;
  }

  private async addInvoices(tx: Transaction, actor: StaffActor, caseId: string, creditorId: string, invoices: CaseInvoice[]): Promise<void> {
    await tx.caseInvoice.createMany({
      data: invoices.map((invoice) => ({
        caseId,
        creditorId,
        number: invoice.number,
        externalRef: invoice.externalRef || null,
        issuedOn: date(invoice.issuedOn),
        dueOn: date(invoice.dueOn),
        claimedCents: invoice.amount,
        principalCents: invoice.left,
        createdBy: actor.userId,
      })),
    });
  }

  /** Same debtor, other creditors: what this person sees of them. */
  private async others(
    debtorId: string,
    except: string | null,
    exceptCreditor: string | null = null,
  ): Promise<{ creditor: string; invoices: number; amount: number }[]> {
    const rows = await this.rows(sql`AND c.debtor_id = ${debtorId}::uuid AND c.closed_on IS NULL`);
    return rows
      .filter((row) => row.id !== except && row.creditor_id !== exceptCreditor)
      .map((row) => ({ creditor: row.creditor, invoices: row.invoices, amount: Number(row.amount) }));
  }

  /**
   * The last cases this person opened, the latest first (DECISIONS.md, 28/11/2026): among them, those the policies still
   * show, and not anonymized.
   */
  async recent(): Promise<CaseListItem[]> {
    const [list] = await this.database.tx.$queryRaw<{ ids: string[] }[]>`SELECT app.recent_cases() AS ids`;
    const ids = list?.ids ?? [];
    if (!ids.length) return [];
    const found = new Map((await this.rows(sql`AND c.id = ANY (${ids}::uuid[]) AND c.anonymized_at IS NULL`)).map((row) => [row.id, row]));
    const now = dayOf(new Date());
    return ids.flatMap((id) => {
      const row = found.get(id);
      return row ? [itemOf(row, now)] : [];
    });
  }

  /** Name, reference, number of the company or of an invoice, creditor. Null without any query. */
  /** Under the search box. */
  async named(query: string, limit: number): Promise<CaseListItem[]> {
    const all = await this.rows(nothing);
    const matching = await this.matching(query, all);
    const now = dayOf(new Date());
    return all
      .filter((row) => matching?.has(row.id))
      .slice(0, limit)
      .map((row) => itemOf(row, now));
  }

  async invoicesNamed(query: string, limit: number) {
    return this.database.tx.$queryRaw<{ id: string; number: string; case_id: string; debtor: string; creditor: string; left: bigint }[]>`
      SELECT i.id, i.number, i.case_id, d.name AS debtor, k.name AS creditor, i.principal_cents - i.principal_paid_cents AS left
      FROM case_invoices i JOIN cases c ON c.id = i.case_id JOIN debtors d ON d.id = c.debtor_id JOIN creditors k ON k.id = c.creditor_id
      WHERE unaccent(i.number) ILIKE ${containing(query)} OR unaccent(i.external_ref) ILIKE ${containing(query)} ORDER BY i.number, i.id LIMIT ${limit}`;
  }

  private async matching(query: string, all: Row[]): Promise<Set<string> | null> {
    const text = query.trim();
    if (!text) return null;
    const number = text.replace(/\s/gu, '');
    const found = await this.database.tx.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM cases c JOIN debtors d ON d.id = c.debtor_id JOIN creditors k ON k.id = c.creditor_id
      WHERE c.id = ANY (${all.map((row) => row.id)}::uuid[]) AND (
        unaccent(d.name) ILIKE ${containing(text)} OR c.reference ILIKE ${containing(text)} OR unaccent(c.external_reference) ILIKE ${containing(text)} OR unaccent(k.name) ILIKE ${containing(text)}
        OR (${/^\d{3,14}$/u.test(number)} AND (d.siren LIKE ${`${number.slice(0, 9)}%`} OR c.debtor_siret LIKE ${`${number}%`}))
        OR EXISTS (SELECT 1 FROM case_invoices i WHERE i.case_id = c.id AND unaccent(i.number) ILIKE ${containing(text)}))`;
    return new Set(found.map((row) => row.id));
  }

  /** Cases that the policies show to this person, with what their invoices amount to. */
  private rows(where: Sql): Promise<Row[]> {
    return this.database.tx.$queryRaw<Row[]>`
      SELECT c.id, c.reference, c.creditor_id, k.name AS creditor, d.name, d.kind, d.siren, c.debtor_siret AS siret, c.status, c.first_letter_on, c.officer_id, c.version,
        CASE WHEN u.id IS NOT NULL THEN u.first_name || ' ' || u.last_name END AS officer, app.can_act_on_case(c.officer_id) AS can_act, c.anonymized_at IS NOT NULL AS anonymized,
        coalesce(i.invoices, 0)::int AS invoices, coalesce(i.amount, 0)::bigint AS amount, i.oldest
      FROM cases c JOIN creditors k ON k.id = c.creditor_id JOIN debtors d ON d.id = c.debtor_id LEFT JOIN users u ON u.id = c.officer_id
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE principal_paid_cents < principal_cents) AS invoices, sum(principal_cents - principal_paid_cents) AS amount,
          min(due_on) FILTER (WHERE principal_paid_cents < principal_cents) AS oldest
        FROM case_invoices WHERE case_id = c.id
      ) i ON true
      WHERE true ${where} ORDER BY amount DESC, c.reference`;
  }
}

export function normalized(kind: 'PHONE' | 'EMAIL', value: string): string {
  return kind === 'PHONE' ? digits(value).replace(/^33(?=\d{9}$)/u, '0') : value.trim().toLowerCase();
}
function sum(rows: Row[]): number {
  return rows.reduce((total, row) => total + Number(row.amount), 0);
}
function itemOf(row: Row, today: string): CaseListItem {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    identifier: row.kind === 'INDIVIDUAL' ? 'Particulier' : row.siret ? `SIRET ${spaced(row.siret)}` : `SIREN ${spaced(row.siren ?? '')}`,
    creditorId: row.creditor_id,
    creditor: row.creditor,
    invoicesLabel: plural(row.invoices),
    amount: Number(row.amount),
    daysLate: lateDays(row.oldest, today),
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    nextAction: row.first_letter_on === null && row.status === 'NEW' ? 'Envoyer le premier courrier' : '—',
    nextDate: '—',
    officerId: row.officer_id,
    officer: row.officer,
    canAct: row.can_act,
  };
}
