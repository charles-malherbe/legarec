import { formatCents, planDates, splitPlan, type PaymentPlan, type planRequest, type PlanSimulation, type plansData } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Audit } from '../../platform/audit/audit';
import { Database } from '../../platform/database/database';
import { takenIndex } from '../../platform/database/codes';
import { conflict, forbidden, notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import type { StaffActor } from '../cases/cases.service';
import { dayText } from '../creditors/mandates';
import { SettingValues } from '../settings/values';
import { balanceOf, Ledgers } from './ledger';
import type { Day } from './money';

type Installment = PaymentPlan['installments'][number];
const SHOWN_STATUSES = ['WAITING_CREDITOR', 'WAITING_DEBTOR', 'ACTIVE', 'DEFAULT'] as const;
const short = (day: Day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const spaced = (siren: string) => siren.replace(/(\d{3})(\d{3})(\d{3})/u, '$1 $2 $3');

/**
 * Where each installment stands, from the payments of the case since the plan was asked: what was paid fills the
 * installments in order. A bounced cheque counts for nothing. Two installments missed or more: the plan is in default
 * (« 2 impayés ou plus », maquette).
 */
export function installmentStates(
  rows: { number: number; dueOn: Day; amount: number }[],
  paidSince: number,
  today: Day,
): { installments: Installment[]; missed: number; left: number } {
  let pot = paidSince;
  const installments = rows.map((row) => {
    const covered = Math.min(pot, row.amount);
    pot -= covered;
    const state: Installment['state'] = covered === row.amount ? 'PAID' : row.dueOn < today ? 'MISSED' : 'UPCOMING';
    return { number: row.number, date: row.dueOn, amount: row.amount, state, left: row.amount - covered };
  });
  return {
    installments: installments.map(({ left: _left, ...rest }) => rest),
    missed: installments.filter((row) => row.state === 'MISSED').length,
    left: installments.reduce((sum, row) => sum + row.left, 0),
  };
}

/** Months above which a plan needs approvals: `Paramètres > Règles et validations`. */
const thresholdOf = (values: SettingValues) => Number.parseInt(values.text('firm', 'regles', 'duration'), 10) || 6;

@Injectable()
export class Plans {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Ledgers) private readonly ledgers: Ledgers,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  async list(actor: StaffActor, today: Day = dayOf(new Date())): Promise<z.infer<typeof plansData>> {
    const { tx } = this.database;
    const threshold = thresholdOf(await SettingValues.read(tx));
    const found = await tx.paymentPlan.findMany({
      where: { status: { in: [...SHOWN_STATUSES, 'PENDING_MANAGER'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        caseId: true,
        creditorId: true,
        totalCents: true,
        months: true,
        method: true,
        firstDueOn: true,
        status: true,
        thresholdMonths: true,
        version: true,
        createdAt: true,
        installments: { orderBy: { number: 'asc' }, select: { number: true, dueOn: true, amountCents: true } },
        requester: { select: { firstName: true, lastName: true } },
        case: { select: { officerId: true, debtor: { select: { name: true, kind: true, siren: true } }, creditor: { select: { name: true } } } },
      },
    });
    const acts = new Set(
      (
        await tx.$queryRaw<
          { id: string }[]
        >`SELECT c.id FROM cases c WHERE c.id = ANY (${found.map((plan) => plan.caseId)}::uuid[]) AND app.can_act_on_case(c.officer_id)`
      ).map((row) => row.id),
    );
    const plans: PaymentPlan[] = [];
    const nextMonth = { from: `${planDates(1, today)[0]!.slice(0, 8)}01`, to: '' };
    nextMonth.to = `${planDates(2, today)[1]!.slice(0, 8)}01`;
    const stats = { active: 0, remaining: 0, nextMonth: 0, nextMonthCount: 0, due: 0, honored: 0, defaults: 0 };
    for (const plan of found.filter((item) => (SHOWN_STATUSES as readonly string[]).includes(item.status))) {
      const ledger = await this.ledgers.read(plan.caseId, today);
      const since = dayText(plan.createdAt);
      const paid = (ledger?.counted ?? []).filter((entry) => entry.on >= since).reduce((sum, entry) => sum + entry.amount, 0);
      const { installments, missed, left } = installmentStates(
        plan.installments.map((row) => ({ number: row.number, dueOn: dayText(row.dueOn), amount: row.amountCents })),
        paid,
        today,
      );
      const running = plan.status === 'ACTIVE' || plan.status === 'DEFAULT';
      const state: PaymentPlan['state'] = !running
        ? plan.status === 'WAITING_DEBTOR'
          ? 'WAITING_DEBTOR'
          : 'WAITING_CREDITOR'
        : plan.status === 'DEFAULT' || missed >= 2
          ? 'DEFAULT'
          : missed === 1
            ? 'LATE'
            : 'ON_TRACK';
      if (running) {
        stats.active += 1;
        stats.remaining += left;
        if (state === 'DEFAULT') stats.defaults += 1;
        for (const row of installments) {
          if (row.date >= nextMonth.from && row.date < nextMonth.to && row.state !== 'PAID') {
            stats.nextMonth += row.amount;
            stats.nextMonthCount += 1;
          }
          if (row.date < today) {
            stats.due += 1;
            if (row.state === 'PAID') stats.honored += 1;
          }
        }
      }
      const { debtor, creditor } = plan.case;
      plans.push({
        id: plan.id,
        caseId: plan.caseId,
        debtor: debtor.name,
        identifier: debtor.kind === 'INDIVIDUAL' || !debtor.siren ? 'Particulier' : `SIREN ${spaced(debtor.siren)}`,
        creditorId: plan.creditorId,
        creditor: creditor.name,
        total: plan.totalCents,
        state,
        method: plan.method,
        installments,
        canAct: acts.has(plan.caseId),
      });
    }
    const manager = actor.role === 'COLLECTION_MANAGER';
    const requests: z.infer<typeof planRequest>[] =
      actor.role === 'CLAIMS_OFFICER'
        ? []
        : found
            .filter((plan) => plan.status === 'PENDING_MANAGER')
            .map((plan) => ({
              id: plan.id,
              debtor: plan.case.debtor.name,
              creditor: plan.case.creditor.name,
              plan: `${formatCents(plan.totalCents)} en ${plan.months} mensualités de ${formatCents(plan.installments[0]?.amountCents ?? 0)} à partir du ${short(dayText(plan.firstDueOn))}`,
              origin: `Proposé par ${plan.requester.firstName} ${plan.requester.lastName} le ${short(dayText(plan.createdAt))}`,
              flag: `Au-delà de ${plan.thresholdMonths} mois`,
              tone: 'warning' as const,
              decision: null,
              version: plan.version,
            }));
    return {
      plans,
      requests,
      canValidate: manager,
      thresholdMonths: threshold,
      stats: {
        active: stats.active,
        remaining: stats.remaining,
        nextMonth: stats.nextMonth,
        nextMonthCount: stats.nextMonthCount,
        honored: stats.due === 0 ? 100 : Math.round((stats.honored / stats.due) * 100),
        defaults: stats.defaults,
      },
      simulation: await this.firstCandidate(),
    };
  }

  /** The first case the person acts on with something to spread and no plan in progress: what the simulator opens with. */
  private async firstCandidate(): Promise<PlanSimulation | null> {
    const { tx } = this.database;
    const candidates = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM cases c
      WHERE app.can_act_on_case(c.officer_id) AND c.status NOT IN ('SETTLED', 'LOST', 'LITIGATION')
        AND NOT EXISTS (SELECT 1 FROM payment_plans p WHERE p.case_id = c.id AND p.status IN ('PENDING_MANAGER', 'WAITING_CREDITOR', 'WAITING_DEBTOR', 'ACTIVE'))
        AND EXISTS (SELECT 1 FROM case_invoices i WHERE i.case_id = c.id AND i.principal_paid_cents < i.principal_cents)
      ORDER BY c.opened_on DESC, c.id LIMIT 1`;
    return candidates[0] ? this.simulation(candidates[0].id) : null;
  }

  async simulation(caseId: string): Promise<PlanSimulation> {
    const { tx } = this.database;
    const [row] = await tx.$queryRaw<{ debtor: string; creditor: string; can_act: boolean; of_director: boolean }[]>`
      SELECT d.name AS debtor, k.name AS creditor, app.can_act_on_case(c.officer_id) AS can_act, c.officer_id IS NOT DISTINCT FROM app.director_id() AND c.officer_id IS NOT NULL AS of_director
      FROM cases c JOIN debtors d ON d.id = c.debtor_id JOIN creditors k ON k.id = c.creditor_id WHERE c.id = ${caseId}::uuid`;
    if (!row) throw notFound();
    if (!row.can_act) throw forbidden();
    const ledger = await this.ledgers.read(caseId);
    if (!ledger) throw notFound();
    return { caseId, debtor: row.debtor, creditor: row.creditor, balance: balanceOf(ledger), ownedByDirector: row.of_director };
  }

  /** Asked by whoever acts on the case, for the balance shown in the confirmation. */
  async create(body: { caseId: string; months: number; method: 'CHEQUE' | 'TRANSFER'; expected: number }, today: Day = dayOf(new Date())): Promise<void> {
    const { tx } = this.database;
    await this.simulation(body.caseId);
    await this.ledgers.lock(body.caseId);
    const ledger = await this.ledgers.read(body.caseId, today);
    if (!ledger || balanceOf(ledger) !== body.expected || body.expected === 0) throw conflict('CHANGED');
    if (['SETTLED', 'LOST', 'LITIGATION'].includes(ledger.status)) throw conflict('CASE_CLOSED');
    const dates = planDates(body.months, today);
    const amounts = splitPlan(body.expected, body.months);
    try {
      // Who must approve it is decided by PostgreSQL, from the setting in force and the holder of the case.
      await tx.$queryRaw`SELECT app.ask_plan(${body.caseId}::uuid, ${body.method}::payment_method, ${body.expected}::integer, ${amounts}::integer[], ${dates}::date[])`;
    } catch (error) {
      if (takenIndex(error) === 'payment_plans_one_open') throw conflict('CHANGED');
      throw error;
    }
  }

  /** The manager validates or refuses a long plan; PostgreSQL checks who decides, and that nothing changed since. */
  async decide(id: string, decision: 'APPROVED' | 'REFUSED', reason: string | undefined, version: number): Promise<void> {
    await this.database.tx.$executeRaw`SELECT app.decide_plan(${id}::uuid, ${decision}::plan_decision, ${reason ?? ''}, ${version}::integer)`;
  }
}
