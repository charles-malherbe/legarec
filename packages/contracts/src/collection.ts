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

/** In default from the first installment missed (question 145): no « late » plan. */
export const planState = z.enum(['ON_TRACK', 'DEFAULT', 'WAITING_CREDITOR', 'WAITING_DEBTOR']);
export const PLAN_STATE_LABELS: Record<z.infer<typeof planState>, string> = {
  ON_TRACK: 'À jour',
  DEFAULT: 'En défaut',
  WAITING_CREDITOR: 'Accord créancier',
  /** Hors maquette : proposé, pas encore accepté dans l'espace du débiteur (question 145). */
  WAITING_DEBTOR: 'Accord débiteur',
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
  /** Sent back with the decision: a plan changed since is refused (409). */
  version: z.number().int(),
});
export const planSimulation = z.object({ caseId: z.string(), debtor: z.string(), creditor: z.string(), balance: cents, ownedByDirector: z.boolean() });
export type PlanSimulation = z.infer<typeof planSimulation>;
/** Rates typed each semester (question 75), and the semesters that lack one while interest runs. */
export const interestRates = z.object({
  items: z.array(
    z.object({ kind: z.enum(['ECB', 'LEGAL_INDIVIDUAL']), validFrom: z.iso.date(), rateBp: z.number().int(), enteredBy: z.string(), updatedAt: z.string() }),
  ),
  canEdit: z.boolean(),
});
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
/** First installment on the 15th of the next month (Paris), then every month: the same for the simulator and the API. */
export function planDates(months: number, today: string): string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return Array.from({ length: months }, (_, index) => new Date(Date.UTC(year, month + index, 15)).toISOString().slice(0, 10));
}
/** Above the threshold: Collection manager first (except on the Director's own cases), then the creditor. */
export function planApprovals(months: number, threshold: number, ownedByDirector: boolean): ('COLLECTION_MANAGER' | 'CREDITOR')[] {
  if (months <= threshold) return [];
  return ownedByDirector ? ['CREDITOR'] : ['COLLECTION_MANAGER', 'CREDITOR'];
}

export const LITIGATION_STAGES = [
  { code: 'FORMAL_NOTICE', label: 'Mise en demeure', hint: 'Accord créancier, LRAR' },
  { code: 'PAYMENT_ORDER', label: 'Injonction de payer', hint: 'ou procédure simplifiée' },
  { code: 'ENFORCEABLE_TITLE', label: 'Titre exécutoire', hint: 'Signification, délai d’opposition' },
  { code: 'ENFORCEMENT', label: 'Exécution forcée', hint: 'Commandement, saisies' },
  { code: 'CLOSED', label: 'Clos', hint: 'Recouvré ou irrécouvrable' },
] as const;
export const litigationStage = z.enum(['FORMAL_NOTICE', 'PAYMENT_ORDER', 'ENFORCEABLE_TITLE', 'ENFORCEMENT', 'CLOSED']);
export type LitigationStage = z.infer<typeof litigationStage>;
/** Written agreement of the creditor, when the mandate asks for one (question 163): a box ticked by the team. */
export const litigationConsent = z.enum(['NOT_NEEDED', 'WAITING', 'RECEIVED']);
/** What closing does to the case: settled when nothing is left to pay, otherwise lost. */
export const litigationOutcome = z.enum(['SETTLED', 'LOST']);
/** Litigation in a minimal follow-up (question 163): the stage, the court and the partner; the acts stay with the lawyer. */
export const litigationCase = z.object({
  id: z.string(),
  caseId: z.string(),
  stage: z.number().int().min(0).max(4),
  stageSince: z.iso.date(),
  debtor: z.string(),
  /** « SIRET … », « SIREN … » or « Particulier ». */
  identifier: z.string(),
  creditorId: z.string(),
  creditor: z.string(),
  /** Principal left to pay. */
  amount: cents,
  /** All that is owed today (principal, interest, fees): what closing compares to zero. */
  balance: cents,
  court: z.string(),
  partnerName: z.string(),
  consent: litigationConsent,
  /** Steps of the procedure, from the history of the case. */
  events: z.array(z.object({ title: z.string(), date: z.iso.date(), who: z.string() })),
  version: z.number().int(),
  canAct: z.boolean(),
});
export type LitigationCase = z.infer<typeof litigationCase>;
export const litigationData = z.object({
  cases: z.array(litigationCase),
  stageTotals: z.array(z.object({ count: z.number().int(), amount: cents })),
  stats: z.object({ amount: cents, count: z.number().int(), titles: z.number().int(), waiting: z.number().int() }),
});
