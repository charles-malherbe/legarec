import { formatCents, type PlanApproval, type PortalCase, type portalCases, type portalDashboard, type PortalStatus } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Database } from '../../platform/database/database';
import { Outbox } from '../../platform/queue/outbox';
import { Storage } from '../../platform/storage/storage';
import { checkFile } from '../documents/file-type';
import { ApiError, conflict, notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { dayText } from '../creditors/mandates';

const STATUS: Record<string, PortalStatus> = {
  NEW: 'NEW',
  OVERDUE: 'REMINDING',
  REMINDER: 'REMINDING',
  FORMAL_NOTICE: 'REMINDING',
  PROMISE: 'REMINDING',
  DISPUTE: 'REMINDING',
  PLAN: 'PLAN',
  LITIGATION: 'LITIGATION',
  SETTLED: 'SETTLED',
  LOST: 'LOST',
};
const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const short = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

/** What a creditor reads of its cases: PostgreSQL shows its own only, and their history only where it is marked for it. */
@Injectable()
export class PortalService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  private async rows() {
    return this.database.tx.case.findMany({
      orderBy: { openedOn: 'desc' },
      select: {
        id: true,
        reference: true,
        status: true,
        externalReference: true,
        openedOn: true,
        closedOn: true,
        debtor: { select: { name: true } },
        invoices: { select: { principalCents: true } },
        payments: { select: { amountCents: true, status: true, receivedOn: true } },
        events: { orderBy: { occurredAt: 'desc' }, take: 20, select: { id: true, title: true, occurredAt: true, tone: true } },
      },
    });
  }

  private caseOf(row: Awaited<ReturnType<PortalService['rows']>>[number]): PortalCase {
    const recovered = row.payments.filter((payment) => payment.status !== 'BOUNCED').reduce((sum, payment) => sum + payment.amountCents, 0);
    const [last] = row.events;
    return {
      id: row.id,
      status: STATUS[row.status] ?? 'REMINDING',
      debtor: row.debtor.name,
      externalReference: row.externalReference ?? '—',
      reference: row.reference,
      invoices: plural(row.invoices.length, 'facture'),
      entrusted: row.invoices.reduce((sum, invoice) => sum + invoice.principalCents, 0),
      recovered,
      last: last ? `${last.title} · ${short(dayOf(last.occurredAt))}` : 'Dossier ouvert',
      steps: row.events.map((event) => ({ title: event.title, date: dayOf(event.occurredAt) })),
    };
  }

  async cases(): Promise<z.infer<typeof portalCases>> {
    const items = (await this.rows()).map((row) => this.caseOf(row));
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
    return { items, counts };
  }

  async detail(id: string): Promise<PortalCase> {
    const row = (await this.rows()).find((item) => item.id === id);
    if (!row) throw notFound();
    return this.caseOf(row);
  }

  /** The plans that wait for the creditor, and those it decided lately. */
  private async approvals(): Promise<PlanApproval[]> {
    const plans = await this.database.tx.paymentPlan.findMany({
      where: { status: { in: ['WAITING_CREDITOR', 'WAITING_DEBTOR', 'REFUSED', 'ACTIVE'] }, approvals: { some: { step: 'CREDITOR' } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        caseId: true,
        months: true,
        totalCents: true,
        firstDueOn: true,
        status: true,
        thresholdMonths: true,
        installments: { orderBy: { number: 'asc' }, take: 1, select: { amountCents: true } },
        approvals: { where: { step: 'CREDITOR' }, select: { decision: true, decidedAt: true } },
        case: { select: { reference: true, debtor: { select: { name: true } } } },
      },
    });
    const recent = Date.now() - 30 * 86_400_000;
    return plans
      .filter((plan) => plan.approvals[0]?.decision === 'PENDING' || (plan.approvals[0]?.decidedAt?.getTime() ?? 0) > recent)
      .map((plan) => ({
        id: plan.id,
        caseId: plan.caseId,
        debtor: plan.case.debtor.name,
        reference: plan.case.reference,
        months: plan.months,
        installment: plan.installments[0]?.amountCents ?? 0,
        total: plan.totalCents,
        firstOn: dayText(plan.firstDueOn),
        reason: `Plan de ${plan.months} mois, au-delà des ${plan.thresholdMonths} mois prévus sans votre accord`,
        status: plan.approvals[0]?.decision === 'APPROVED' ? 'ACCEPTED' : plan.approvals[0]?.decision === 'REFUSED' ? 'REFUSED' : 'PENDING',
      }));
  }

  async dashboard(): Promise<z.infer<typeof portalDashboard>> {
    const rows = await this.rows();
    const year = dayOf(new Date()).slice(0, 4);
    const thisMonth = dayOf(new Date()).slice(0, 7);
    const ofYear = rows.filter((row) => dayText(row.openedOn).startsWith(year));
    const entrusted = ofYear.reduce((sum, row) => sum + row.invoices.reduce((total, invoice) => total + invoice.principalCents, 0), 0);
    const live = rows.flatMap((row) => row.payments.filter((payment) => payment.status !== 'BOUNCED'));
    const recovered = live.reduce((sum, payment) => sum + payment.amountCents, 0);
    const recoveredOfYear = ofYear
      .flatMap((row) => row.payments.filter((payment) => payment.status !== 'BOUNCED'))
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    const lastMonth = live.filter((payment) => dayText(payment.receivedOn).startsWith(thisMonth)).reduce((sum, payment) => sum + payment.amountCents, 0);
    const settled = rows.filter((row) => row.closedOn && row.status === 'SETTLED');
    const delay = settled.length
      ? Math.round(settled.reduce((sum, row) => sum + (row.closedOn!.getTime() - row.openedOn.getTime()) / 86_400_000, 0) / settled.length)
      : null;
    const debtors = new Set(ofYear.map((row) => row.debtor.name)).size;
    const invoices = ofYear.reduce((sum, row) => sum + row.invoices.length, 0);
    const statuses = new Map<PortalStatus, number>();
    for (const row of rows) statuses.set(STATUS[row.status] ?? 'REMINDING', (statuses.get(STATUS[row.status] ?? 'REMINDING') ?? 0) + 1);
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
      const key = at.toISOString().slice(0, 7);
      return {
        label: MONTHS[at.getUTCMonth()]!,
        amount: live.filter((payment) => dayText(payment.receivedOn).startsWith(key)).reduce((sum, payment) => sum + payment.amountCents, 0),
      };
    });
    const activity = rows
      .flatMap((row) => row.events.map((event) => ({ ...event, who: row.debtor.name })))
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 6)
      .map((event) => ({
        id: event.id,
        who: event.who,
        what: event.title.charAt(0).toLowerCase() + event.title.slice(1),
        when: short(dayOf(event.occurredAt)),
        tone: (event.tone === 'success' || event.tone === 'warning' || event.tone === 'danger' ? event.tone : 'info') as
          'success' | 'warning' | 'danger' | 'info',
      }));
    return {
      kpis: [
        { label: `Montant confié en ${year}`, value: formatCents(entrusted), hint: `${plural(invoices, 'facture')} · ${plural(debtors, 'débiteur')}` },
        { label: 'Montant recouvré', value: formatCents(recovered), hint: `dont ${formatCents(lastMonth)} ce mois-ci` },
        {
          label: 'Taux de recouvrement',
          value: entrusted ? `${Math.round((recoveredOfYear / entrusted) * 100)} %` : '—',
          hint: `sur les dossiers ouverts en ${year}`,
        },
        { label: 'Délai moyen de recouvrement', value: delay === null ? '—' : plural(delay, 'jour'), hint: 'de la prise en charge au paiement' },
      ],
      statuses: [...statuses].map(([status, count]) => ({ status, count })),
      months,
      activity,
      approvals: await this.approvals(),
    };
  }

  async decide(id: string, accepted: boolean, reason: string | undefined): Promise<void> {
    // Checked again by PostgreSQL.
    if (!accepted && !reason?.trim()) throw new ApiError(422, 'REASON_REQUIRED');
    await this.database.tx.$executeRaw`SELECT app.creditor_decide_plan(${id}::uuid, ${accepted}, ${reason ?? ''})`;
  }

  /**
   * A claim deposited by the creditor: a case held by nobody, under its mandate in force, that the manager takes. PostgreSQL
   * checks everything again; what the creditor gives of the debtor is not verified.
   */
  async deposit(body: {
    debtor: string;
    siret: string;
    email: string;
    phone: string;
    address: string;
    invoices: unknown[];
    attachments: string[];
  }): Promise<void> {
    const [row] = await this.database.tx.$queryRaw<{ outcome: string }[]>`
      SELECT outcome FROM app.creditor_deposit(${body.debtor}, ${body.siret.replace(/\s/gu, '')}, ${body.address}, ${body.email}, ${body.phone},
        ${JSON.stringify(body.invoices)}::jsonb, ${body.attachments}::uuid[])`;
    switch (row?.outcome) {
      case 'OPENED':
        return;
      case 'NO_MANDATE':
      case 'DEBTOR_MISMATCH':
      case 'CASE_EXISTS':
        throw conflict(row.outcome);
      default:
        throw conflict('CHANGED');
    }
  }

  /** A file of the creditor: real type checked, analysed before anyone reads it, kept until its claim takes it. */
  async upload(bytes: Uint8Array, declared: string): Promise<{ id: string }> {
    const kind = checkFile(bytes, declared);
    if (!kind) throw new ApiError(415, 'REFUSED');
    const stored = await this.storage.put(bytes);
    const id = randomUUID();
    try {
      await this.database.tx
        .$executeRaw`SELECT app.creditor_upload(${id}::uuid, ${kind}::document_kind, ${stored.key}, ${stored.size}::integer, ${stored.sha256})`;
      await this.outbox.add({ queue: 'documents', name: 'scan-document', payload: { document: id } });
    } catch (error) {
      await this.storage.remove(stored.key);
      throw error;
    }
    return { id };
  }
}
