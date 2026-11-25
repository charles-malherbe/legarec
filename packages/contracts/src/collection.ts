import { z } from 'zod';
import { atMost, ID_MAX } from './limits';
import { cents } from './money';

export const reminderType = z.enum(['EMAIL', 'SMS', 'CALL', 'LETTER', 'INSTALLMENT', 'COURT_DEADLINE']);
export type ReminderType = z.infer<typeof reminderType>;
export const REMINDER_LABELS: Record<ReminderType, string> = {
  EMAIL: 'E-mail',
  SMS: 'SMS',
  CALL: 'Appel',
  LETTER: 'Courrier / LRAR',
  INSTALLMENT: 'Échéance',
  COURT_DEADLINE: 'Délai judiciaire',
};
export const reminder = z.object({
  id: z.string(),
  date: z.iso.date(),
  time: z.string().nullable(),
  type: reminderType,
  debtor: z.string(),
  caseId: z.string().nullable(),
  creditorId: z.string().nullable(),
  creditor: z.string(),
  title: z.string(),
  done: z.boolean(),
  automatic: z.boolean(),
  officerId: z.string().nullable(),
  canAct: z.boolean(),
  /** Set when the reminder exceeds the contact caps or the allowed hours. */
  limit: z.string().nullable(),
});
export type Reminder = z.infer<typeof reminder>;
export const agenda = z.object({
  today: z.iso.date(),
  items: z.array(reminder),
  weekly: z.object({ emails: z.number().int(), sms: z.number().int(), letters: z.number().int() }),
});

export const newReminder = z.object({
  caseId: z.string().min(1, { error: 'Choisissez un débiteur.' }).max(ID_MAX),
  type: z.enum(['EMAIL', 'SMS', 'CALL', 'LETTER']),
  date: z.iso.date({ error: 'Choisissez une date.' }),
  time: z.union([z.literal(''), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)], { error: 'Saisissez une heure, par exemple 10:00.' }),
  title: z.string().trim().min(1, { error: 'Indiquez l’objet de la relance.' }).max(200, atMost(200)),
});
/** Cases the user may act on, and the reminders that would exceed the limits. */
export const reminderTargets = z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), creditor: z.string() })) });
export const reminderPlanned = z.object({ id: z.string(), limit: z.string().nullable() });

export const planState = z.enum(['ON_TRACK', 'LATE', 'DEFAULT', 'WAITING_CREDITOR']);
export const PLAN_STATE_LABELS: Record<z.infer<typeof planState>, string> = {
  ON_TRACK: 'À jour',
  LATE: 'En retard',
  DEFAULT: 'En défaut',
  WAITING_CREDITOR: 'Accord créancier',
};
export const installment = z.object({ number: z.number().int(), date: z.iso.date(), amount: cents, state: z.enum(['PAID', 'MISSED', 'UPCOMING']) });
export const paymentPlan = z.object({
  id: z.string(),
  caseId: z.string(),
  debtor: z.string(),
  identifier: z.string(),
  creditorId: z.string(),
  creditor: z.string(),
  total: cents,
  state: planState,
  method: z.enum(['CHEQUE', 'TRANSFER']),
  installments: z.array(installment),
  canAct: z.boolean(),
});
export type PaymentPlan = z.infer<typeof paymentPlan>;
export const planRequest = z.object({
  id: z.string(),
  debtor: z.string(),
  creditor: z.string(),
  plan: z.string(),
  origin: z.string(),
  flag: z.string(),
  tone: z.enum(['warning', 'info', 'danger']),
  decision: z.enum(['APPROVED', 'REFUSED']).nullable(),
});
export const planSimulation = z.object({ caseId: z.string(), debtor: z.string(), creditor: z.string(), balance: cents, ownedByDirector: z.boolean() });
export type PlanSimulation = z.infer<typeof planSimulation>;
export const plansData = z.object({
  plans: z.array(paymentPlan),
  requests: z.array(planRequest),
  canValidate: z.boolean(),
  thresholdMonths: z.number().int(),
  stats: z.object({
    active: z.number().int(),
    remaining: cents,
    nextMonth: cents,
    nextMonthCount: z.number().int(),
    honored: z.number(),
    defaults: z.number().int(),
  }),
  simulation: planSimulation.nullable(),
});

/** Equal installments rounded up to the euro; the last one carries the difference. */
export function splitPlan(total: number, months: number): number[] {
  const unit = Math.ceil(total / months / 100) * 100;
  return Array.from({ length: months }, (_, index) => (index === months - 1 ? total - unit * (months - 1) : unit));
}
/** Above the threshold: Collection manager first (except on the Director's own cases), then the creditor. */
export function planApprovals(months: number, threshold: number, ownedByDirector: boolean): ('COLLECTION_MANAGER' | 'CREDITOR')[] {
  if (months <= threshold) return [];
  return ownedByDirector ? ['CREDITOR'] : ['COLLECTION_MANAGER', 'CREDITOR'];
}

export const LITIGATION_STAGES = [
  { label: 'Mise en demeure', hint: 'Accord créancier, LRAR' },
  { label: 'Injonction de payer', hint: 'ou procédure simplifiée' },
  { label: 'Titre exécutoire', hint: 'Signification, délai d’opposition' },
  { label: 'Exécution forcée', hint: 'Commandement, saisies' },
  { label: 'Clos', hint: 'Recouvré ou irrécouvrable' },
] as const;
export const litigationCase = z.object({
  id: z.string(),
  stage: z.number().int().min(0).max(4),
  debtor: z.string(),
  siret: z.string(),
  creditorId: z.string(),
  creditor: z.string(),
  amount: cents,
  step: z.string(),
  due: z.string(),
  urgent: z.boolean(),
  procedure: z.string(),
  court: z.string(),
  partner: z.string(),
  action: z.string(),
  actionSent: z.boolean(),
  acts: z.array(z.object({ title: z.string(), date: z.string(), state: z.enum(['DONE', 'NOW', 'TODO']) })),
  canAct: z.boolean(),
});
export type LitigationCase = z.infer<typeof litigationCase>;
export const litigationData = z.object({
  cases: z.array(litigationCase),
  stageTotals: z.array(z.object({ count: z.number().int(), amount: cents })),
  deadlines: z.array(z.object({ caseId: z.string(), date: z.iso.date(), title: z.string(), who: z.string(), tone: z.enum(['danger', 'warning', 'neutral']) })),
  stats: z.object({ amount: cents, count: z.number().int(), advancedFees: cents, titles: z.number().int(), waiting: z.number().int(), soon: z.number().int() }),
});
