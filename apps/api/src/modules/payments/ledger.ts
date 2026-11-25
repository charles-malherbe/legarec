import type { NewPayment, Payment } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { Audit } from '../../platform/audit/audit';
import { Database } from '../../platform/database/database';
import { conflict, invalid } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { dayText } from '../creditors/mandates';
import { accruedInterest, allocate, byAge, indemnities, type Day, type InterestMode, type InvoiceDue, type PrincipalPaid, type Terms } from './money';

/** What a case owes today, and how its payments were allocated. */
export interface Ledger {
  caseId: string;
  creditorId: string;
  status: string;
  terms: Terms;
  invoices: (InvoiceDue & { principalLeft: number; feesDue: number; feesPaid: number })[];
  interestAccrued: number;
  interestPaid: number;
  /** Semesters during which interest ran without any rate typed. */
  missingRates: Day[];
  payments: Payment[];
  /** Sum of the payments that count (not bounced), by day received: for the installments of a plan. */
  counted: { on: Day; amount: number }[];
}
export const owedOf = (ledger: Ledger) => ({
  principal: ledger.invoices.reduce((sum, invoice) => sum + invoice.principalLeft, 0),
  interest: Math.max(ledger.interestAccrued - ledger.interestPaid, 0),
  fees: ledger.invoices.reduce((sum, invoice) => sum + Math.max(invoice.feesDue - invoice.feesPaid, 0), 0),
});
export const balanceOf = (ledger: Ledger) => {
  const owed = owedOf(ledger);
  return owed.principal + owed.interest + owed.fees;
};

const IBAN = /\b[A-Z]{2}\d{2} ?(?:[0-9A-Z]{4} ?){2,7}[0-9A-Z]{0,4}/gu;
/** The IBAN typed in the label of a transfer: its last four characters only, but for the Director (tests « fuites »). */
export const maskedLabel = (label: string, director: boolean) =>
  director
    ? label
    : label.replace(IBAN, (iban) => {
        const plain = iban.replace(/\s/gu, '');
        return `${plain.slice(0, 4)} •••• ${plain.slice(-4)}${iban.endsWith(' ') ? ' ' : ''}`;
      });

const RECEIPT = (year: number, number: number) => `Q-${year}-${String(number).padStart(5, '0')}`;

/** Money of the cases. PostgreSQL decides which cases are shown and acted on; the rules of the amounts are in `money.ts`. */
@Injectable()
export class Ledgers {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  /** Null when the case is not shown to this person. */
  async read(caseId: string, today: Day = dayOf(new Date()), director = false): Promise<Ledger | null> {
    const { tx } = this.database;
    const found = await tx.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        creditorId: true,
        status: true,
        formalNoticeOn: true,
        debtor: { select: { kind: true } },
        mandate: { select: { interestMode: true, contractRateBp: true, fixedIndemnity: true } },
        invoices: { select: { id: true, number: true, dueOn: true, principalCents: true, principalPaidCents: true } },
        payments: { orderBy: [{ receivedOn: 'asc' }, { createdAt: 'asc' }], include: { allocations: true, receipt: { select: { id: true } } } },
      },
    });
    if (!found) return null;
    const rates = (await tx.interestRate.findMany({ select: { kind: true, validFrom: true, rateBp: true } })).map((rate) => ({
      kind: rate.kind,
      validFrom: dayText(rate.validFrom),
      rateBp: rate.rateBp,
    }));
    const mode: InterestMode =
      found.mandate?.interestMode === 'CONTRACT' && found.mandate.contractRateBp !== null
        ? { kind: 'CONTRACT', rateBp: found.mandate.contractRateBp }
        : found.mandate?.interestMode === 'NONE'
          ? { kind: 'NONE' }
          : { kind: 'ECB_PLUS_TEN' };
    const terms: Terms = {
      individual: found.debtor.kind === 'INDIVIDUAL',
      mode,
      formalNoticeOn: found.formalNoticeOn ? dayText(found.formalNoticeOn) : null,
      fixedIndemnity: found.mandate?.fixedIndemnity ?? false,
    };
    const invoices = found.invoices
      .map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        dueOn: dayText(invoice.dueOn),
        principal: invoice.principalCents,
        paid: invoice.principalPaidCents,
      }))
      .sort(byAge);
    // A bounced payment is as if it had never been received: its entries cancel each other.
    const live = found.payments.filter((payment) => payment.status !== 'BOUNCED');
    const net = (component: string, invoiceId?: string) =>
      live
        .flatMap((payment) => payment.allocations)
        .filter((entry) => entry.component === component && (invoiceId === undefined || entry.invoiceId === invoiceId))
        .reduce((sum, entry) => sum + entry.amountCents, 0);
    const paid: PrincipalPaid[] = live.flatMap((payment) =>
      payment.allocations
        .filter((entry) => entry.component === 'PRINCIPAL' && entry.reversesId === null && entry.invoiceId)
        .map((entry) => ({ invoiceId: entry.invoiceId!, on: dayText(payment.receivedOn), amount: entry.amountCents })),
    );
    const accrued = accruedInterest(invoices, paid, rates, terms, today);
    const fees = indemnities(invoices, terms, today);
    return {
      caseId: found.id,
      creditorId: found.creditorId,
      status: found.status,
      terms,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        dueOn: invoice.dueOn,
        principal: invoice.principal,
        principalLeft: invoice.principal - invoice.paid,
        feesDue: fees.get(invoice.id) ?? 0,
        feesPaid: net('FEES', invoice.id),
      })),
      interestAccrued: accrued.total,
      interestPaid: net('INTEREST'),
      missingRates: accrued.missing,
      payments: found.payments.map((payment) => {
        const first = (component: string) =>
          payment.allocations.filter((entry) => entry.component === component && entry.reversesId === null).reduce((sum, entry) => sum + entry.amountCents, 0);
        return {
          id: payment.id,
          method: payment.method,
          amount: payment.amountCents,
          status: payment.status,
          receivedOn: dayText(payment.receivedOn),
          depositedOn: payment.depositedOn ? dayText(payment.depositedOn) : null,
          chequeNumber: payment.chequeNumber,
          bank: payment.bank,
          label: payment.label === null ? null : maskedLabel(payment.label, director),
          receiptId: payment.receipt?.id ?? null,
          allocation: { interest: first('INTEREST'), principal: first('PRINCIPAL'), fees: first('FEES') },
        };
      }),
      counted: live.map((payment) => ({ on: dayText(payment.receivedOn), amount: payment.amountCents })),
    };
  }

  /** One change of money at a time per case: two payments typed together are allocated one after the other. */
  async lock(caseId: string): Promise<void> {
    await this.database.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`money:${caseId}`}, 0))`;
  }

  /** Records a payment, allocated as of the day it was received. The case is one the person acts on (checked before). */
  async record(caseId: string, body: NewPayment, today: Day = dayOf(new Date())): Promise<void> {
    const { tx } = this.database;
    if (body.receivedOn > today) throw invalid({ fields: ['receivedOn'] });
    if (body.method === 'CHEQUE' && body.depositedOn && (body.depositedOn < body.receivedOn || body.depositedOn > today))
      throw invalid({ fields: ['depositedOn'] });
    await this.lock(caseId);
    const asOf = await this.read(caseId, body.receivedOn);
    const now = await this.read(caseId, today);
    if (!asOf || !now) throw conflict('CHANGED');
    if (now.status === 'LOST') throw conflict('CASE_CLOSED');
    const owed = {
      interest: Math.max(asOf.interestAccrued - asOf.interestPaid, 0),
      invoices: now.invoices.map((invoice) => ({
        id: invoice.id,
        principal: invoice.principalLeft,
        fees: Math.max((asOf.invoices.find((item) => item.id === invoice.id)?.feesDue ?? 0) - invoice.feesPaid, 0),
      })),
    };
    const parts = allocate(body.amount, owed);
    const [who] = await tx.$queryRaw<{ user_id: string; behalf: string | null }[]>`SELECT app.user_id() AS user_id, app.on_behalf_of() AS behalf`;
    const settled = body.method === 'TRANSFER' && body.reconciled;
    const payment = await tx.payment.create({
      data: {
        caseId,
        creditorId: now.creditorId,
        method: body.method,
        amountCents: body.amount,
        status: body.method === 'CHEQUE' ? (body.depositedOn ? 'DEPOSITED' : 'RECEIVED') : settled ? 'RECONCILED' : 'TO_RECONCILE',
        receivedOn: new Date(`${body.receivedOn}T00:00:00Z`),
        depositedOn: body.method === 'CHEQUE' && body.depositedOn ? new Date(`${body.depositedOn}T00:00:00Z`) : null,
        settledAt: settled ? new Date() : null,
        chequeNumber: body.method === 'CHEQUE' ? body.chequeNumber : null,
        bank: body.method === 'CHEQUE' ? body.bank.trim() : null,
        label: body.method === 'TRANSFER' ? body.label.trim() : null,
        recordedBy: who!.user_id,
        onBehalfOfId: who!.behalf,
      },
      select: { id: true },
    });
    await tx.paymentAllocation.createMany({
      data: parts.map((part) => ({
        caseId,
        creditorId: now.creditorId,
        paymentId: payment.id,
        invoiceId: part.invoiceId,
        component: part.component,
        amountCents: part.amount,
      })),
    });
    if (settled) await this.receipt(caseId, now.creditorId, payment.id);
    await this.event(caseId, 'PAYMENT_RECORDED', 'Paiement enregistré', body.method === 'CHEQUE' ? 'Chèque' : 'Virement', 'success');
    await this.settleIfPaid(caseId);
  }

  /** Cashed, reconciled or bounced: only from the state the screen showed. */
  async change(caseId: string, paymentId: string, status: 'CASHED' | 'BOUNCED' | 'RECONCILED', reason: string): Promise<void> {
    const { tx } = this.database;
    await this.lock(caseId);
    const payment = await tx.payment.findFirst({ where: { id: paymentId, caseId }, include: { allocations: true } });
    if (!payment) throw conflict('CHANGED');
    const allowed =
      payment.method === 'CHEQUE'
        ? ['RECEIVED', 'DEPOSITED'].includes(payment.status) && status !== 'RECONCILED'
        : payment.status === 'TO_RECONCILE' && status === 'RECONCILED';
    if (!allowed) throw conflict('CHANGED');
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, caseId, version: payment.version },
      data:
        status === 'BOUNCED'
          ? { status, bouncedAt: new Date(), bounceReason: reason.trim() || null, version: { increment: 1 } }
          : { status, settledAt: new Date(), version: { increment: 1 } },
    });
    if (!count) throw conflict('CHANGED');
    if (status === 'BOUNCED') {
      // Opposite entries: what it paid is owed again, exactly.
      await tx.paymentAllocation.createMany({
        data: payment.allocations
          .filter((entry) => entry.reversesId === null)
          .map((entry) => ({
            caseId,
            creditorId: payment.creditorId,
            paymentId,
            invoiceId: entry.invoiceId,
            component: entry.component,
            amountCents: -entry.amountCents,
            reversesId: entry.id,
          })),
      });
      await this.event(caseId, 'PAYMENT_BOUNCED', 'Chèque impayé', '', 'danger');
      await this.audit.log({ action: 'PAYMENT_BOUNCED', entity: { type: 'case', id: caseId } });
      await tx.case.updateMany({ where: { id: caseId, status: 'SETTLED' }, data: { status: 'OVERDUE', closedOn: null, version: { increment: 1 } } });
    } else {
      await this.receipt(caseId, payment.creditorId, paymentId);
      await this.event(caseId, 'PAYMENT_SETTLED', 'Paiement définitif, quittance générée', '', 'success');
    }
  }

  private async receipt(caseId: string, creditorId: string, paymentId: string): Promise<void> {
    const { tx } = this.database;
    const [next] = await tx.$queryRaw<{ for_year: number; number: number }[]>`SELECT for_year, number FROM app.next_number('RECEIPT')`;
    await tx.receipt.create({ data: { caseId, creditorId, paymentId, number: RECEIPT(next!.for_year, next!.number) } });
  }

  /** Nothing left to pay: the case is settled. */
  private async settleIfPaid(caseId: string): Promise<void> {
    const ledger = await this.read(caseId);
    if (ledger && balanceOf(ledger) === 0 && !['SETTLED', 'LOST', 'LITIGATION'].includes(ledger.status)) {
      await this.database.tx.case.updateMany({
        where: { id: caseId },
        data: { status: 'SETTLED', closedOn: new Date(`${dayOf(new Date())}T00:00:00Z`), version: { increment: 1 } },
      });
      await this.event(caseId, 'CASE_SETTLED', 'Dossier soldé', '', 'success');
    }
  }

  private async event(id: string, kind: string, title: string, detail: string, tone: 'info' | 'success' | 'danger'): Promise<void> {
    // A creditor sees what was paid on its cases.
    await this.database.tx.$executeRaw`SELECT app.add_case_event(${id}::uuid, ${kind}, ${title}, ${detail || null}, ${tone}::event_tone, true)`;
  }
}
