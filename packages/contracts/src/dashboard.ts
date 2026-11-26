import { z } from 'zod';
import { cents } from './money';

export const caseStatus = z.enum(['OVERDUE', 'PROMISE', 'REMINDER', 'DISPUTE', 'SETTLED', 'PLAN', 'FORMAL_NOTICE', 'LITIGATION', 'NEW', 'LOST']);
export type CaseStatus = z.infer<typeof caseStatus>;

/** `targetRatio`: null without any goal in the settings (question 97). */
const period = z.object({ note: z.string(), recovered: cents, recoveredSub: z.string(), targetRatio: z.number().min(0).max(100).nullable() });
export const dashboard = z.object({
  /** GLOBAL: whole firm (Director). TEAM: Collection manager. PERSONAL: Claims officer. */
  scope: z.enum(['GLOBAL', 'TEAM', 'PERSONAL']),
  date: z.iso.date(),
  outstanding: cents,
  debtors: z.number().int(),
  invoices: z.number().int(),
  /** Claims deposited by creditors waiting for the team (question 155): the Director and the manager; null for the others. */
  depositsWaiting: z.number().int().nullable(),
  overdue30: cents,
  overdue30Sub: z.string(),
  periods: z.object({ week: period, month: period, year: period }),
  invoicesRecovered: z.number().int(),
  invoicesEntrusted: z.number().int(),
  dsoDays: z.number().int(),
  dsoSub: z.string(),
  priorities: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      meta: z.string(),
      tag: z.string(),
      tone: caseStatus,
      icon: z.enum(['phone', 'euro', 'check', 'mail', 'alert', 'scale']),
      href: z.string(),
      cta: z.string(),
      done: z.boolean(),
    }),
  ),
  feed: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['PAYMENT', 'CALL', 'MESSAGE', 'APPROVAL', 'ALERT', 'SYSTEM']),
      text: z.string(),
      meta: z.string(),
      time: z.string(),
    }),
  ),
  monthlyTarget: cents,
  months: z.array(z.object({ label: z.string(), amount: cents })),
  aging: z.array(z.object({ label: z.string(), amount: cents, percent: z.number() })),
  creditors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      siren: z.string(),
      sector: z.string(),
      debtors: z.number().int(),
      invoices: z.number().int(),
      outstanding: cents,
      recovered: cents,
      rate: z.number(),
    }),
  ),
  topDebtors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      siret: z.string(),
      creditor: z.string(),
      amount: cents,
      daysLate: z.number().int(),
      status: caseStatus,
      statusLabel: z.string(),
    }),
  ),
  team: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      presence: z.enum(['available', 'call', 'pause', 'away']),
      calls: z.number().int().nullable(),
      target: z.number().int(),
    }),
  ),
});
export type Dashboard = z.infer<typeof dashboard>;
/** `all`, or one creditor the person reads; anything else reads as `all`. */
export const dashboardQuery = z.object({
  creditor: z
    .union([z.literal('all'), z.uuid()])
    .catch('all')
    .default('all'),
});
