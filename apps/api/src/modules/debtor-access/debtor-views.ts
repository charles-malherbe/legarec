import type { DebtorCase, DebtorSession } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../platform/database/database';
import { notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { dayText } from '../creditors/mandates';
import { balanceOf, Ledgers, owedOf } from '../payments/ledger';
import { installmentStates } from '../payments/plans';
import { SettingValues } from '../settings/values';

type Tone = DebtorCase['statusTone'];
const STATUS: Record<string, [string, Tone]> = {
  NEW: ['Paiement attendu', 'warning'],
  OVERDUE: ['Paiement attendu', 'warning'],
  REMINDER: ['Paiement attendu', 'warning'],
  FORMAL_NOTICE: ['Mise en demeure', 'danger'],
  PROMISE: ['Paiement annoncé', 'info'],
  PLAN: ['Échéancier', 'info'],
  DISPUTE: ['Contestation en cours', 'violet'],
  LITIGATION: ['Procédure en cours', 'danger'],
  SETTLED: ['Soldé', 'success'],
  LOST: ['Clos', 'neutral'],
};

/** What a debtor reads of their cases, with their own rights (PostgreSQL shows only theirs, once announced). */
@Injectable()
export class DebtorViews {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Ledgers) private readonly ledgers: Ledgers,
  ) {}

  async session(debtorId: string): Promise<DebtorSession> {
    const { tx } = this.database;
    const debtor = await tx.debtor.findUnique({ where: { id: debtorId }, select: { name: true } });
    const cases = await tx.case.findMany({
      where: { closedOn: null },
      orderBy: { openedOn: 'asc' },
      select: { id: true, reference: true, status: true, creditor: { select: { name: true } } },
    });
    return {
      greeting: debtor?.name ?? '',
      debtor: debtor?.name ?? '',
      cases: await Promise.all(
        cases.map(async (item) => {
          const ledger = await this.ledgers.read(item.id, dayOf(new Date()), false, true);
          const [label, tone] = STATUS[item.status] ?? STATUS.OVERDUE!;
          return { id: item.id, reference: item.reference, creditor: item.creditor.name, balance: ledger ? balanceOf(ledger) : 0, statusLabel: label, statusTone: tone };
        }),
      ),
    };
  }

  async detail(id: string): Promise<DebtorCase> {
    const { tx } = this.database;
    const today = dayOf(new Date());
    const found = await tx.case.findFirst({
      where: { id, closedOn: null },
      select: { id: true, reference: true, status: true, creditor: { select: { name: true } }, debtor: { select: { name: true, kind: true } } },
    });
    const ledger = found && (await this.ledgers.read(id, today, false, true));
    if (!found || !ledger) throw notFound();
    const owed = owedOf(ledger);
    const plan = await tx.paymentPlan.findFirst({
      where: { caseId: id, status: { in: ['WAITING_DEBTOR', 'ACTIVE', 'DEFAULT'] } },
      select: { status: true, acceptedAt: true, createdAt: true, installments: { orderBy: { number: 'asc' }, select: { number: true, dueOn: true, amountCents: true } } },
    });
    const states = plan
      ? installmentStates(
          plan.installments.map((row) => ({ number: row.number, dueOn: dayText(row.dueOn), amount: row.amountCents })),
          ledger.counted.filter((entry) => entry.on >= dayText(plan.createdAt)).reduce((sum, entry) => sum + entry.amount, 0),
          today,
        ).installments
      : [];
    const values = await SettingValues.read(tx);
    const firm = (field: string) => values.text('firm', 'cabinet', field);
    const [label, tone] = STATUS[found.status] ?? STATUS.OVERDUE!;
    const next = states.find((row) => row.state !== 'PAID');
    return {
      id: found.id,
      reference: found.reference,
      creditor: found.creditor.name,
      balance: balanceOf(ledger),
      statusLabel: label,
      statusTone: tone,
      debtor: found.debtor.name,
      officer: 'Le service recouvrement de Legarec',
      isIndividual: found.debtor.kind === 'INDIVIDUAL',
      principal: owed.principal,
      interest: owed.interest,
      indemnity: owed.fees,
      paid: ledger.payments.filter((payment) => payment.status !== 'BOUNCED').reduce((sum, payment) => sum + payment.amount, 0),
      invoices: ledger.invoices.filter((invoice) => invoice.principalLeft > 0).map((invoice) => ({ id: invoice.id, number: invoice.number, dueOn: invoice.dueOn, amount: invoice.principalLeft })),
      payments: ledger.payments
        .filter((payment) => payment.status !== 'BOUNCED')
        .map((payment) => ({ id: payment.id, amount: payment.amount, date: payment.receivedOn, method: payment.method, receiptId: payment.receiptId })),
      next: next ? { date: next.date, amount: next.amount } : null,
      lastMessage: null,
      unread: 0,
      plan:
        plan && plan.acceptedAt
          ? {
              acceptedOn: dayText(plan.acceptedAt),
              installments: states.map((row) => ({
                number: row.number,
                dueOn: row.date,
                amount: row.amount,
                status: row.state === 'PAID' ? 'PAID' : row.state === 'MISSED' ? 'LATE' : row.date === today ? 'DUE' : 'UPCOMING',
              })),
            }
          : null,
      payment: {
        beneficiary: firm('holder'),
        iban: firm('iban'),
        bic: firm('bic'),
        reference: found.reference,
        chequeOrder: firm('chequePayee'),
        chequeAddress: firm('chequeAddress'),
      },
    };
  }
}
