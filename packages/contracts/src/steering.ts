import { z } from 'zod';
import { cents } from './money';
import { role } from './roles';
import { isReservedAddress } from './settings';

export const notificationItem = z.object({
  id: z.string(),
  kind: z.enum(['PAYMENT', 'MESSAGE', 'REMINDER', 'LITIGATION', 'CREDITOR', 'SYSTEM']),
  unread: z.boolean(),
  day: z.enum(['TODAY', 'YESTERDAY', 'EARLIER']),
  time: z.string(),
  text: z.string(),
  meta: z.string(),
  href: z.string(),
  cta: z.string(),
});
export type NotificationItem = z.infer<typeof notificationItem>;

const report = z.object({
  text: z.string(),
  kpis: z.array(z.object({ label: z.string(), value: z.string(), delta: z.string(), tone: z.enum(['good', 'bad', 'neutral']) })),
  bars: z.array(z.object({ label: z.string(), entrusted: cents, recovered: cents })),
});
export const reportsData = z.object({
  scope: z.enum(['GLOBAL', 'TEAM', 'PERSONAL']),
  periods: z.object({ month: report, quarter: report, year: report }),
  outcomes: z.array(z.object({ label: z.string(), percent: z.number(), tone: z.enum(['success', 'teal', 'warning', 'neutral', 'danger']) })),
  promisesKept: z.number(),
  team: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cases: z.number().int(),
      calls: z.number().int(),
      promises: z.number().int(),
      recovered: cents,
      rate: z.number(),
    }),
  ),
  scheduled: z.array(z.object({ id: z.string(), title: z.string(), meta: z.string(), active: z.boolean() })),
});

export const presence = z.enum(['CALL', 'AVAILABLE', 'PAUSE', 'AWAY']);
export const agent = z.object({
  id: z.string(),
  name: z.string(),
  roleLabel: z.string(),
  scope: z.string(),
  presence,
  status: z.string(),
  calls: z.number().int(),
  goal: z.number().int(),
  reached: z.number().int(),
  promises: z.number().int(),
  promisedAmount: cents,
  cashed: cents,
  average: z.string(),
  book: z.string(),
  kept: z.number(),
  login: z.string(),
  pause: z.string(),
  live: z.string().nullable(),
  hours: z.array(z.number().int()),
});
export type Agent = z.infer<typeof agent>;
export const teamCall = z.object({
  id: z.string(),
  time: z.string(),
  agentId: z.string(),
  agent: z.string(),
  caseId: z.string().nullable(),
  debtor: z.string(),
  creditor: z.string(),
  siret: z.string(),
  direction: z.enum(['OUT', 'IN']),
  duration: z.string(),
  result: z.string(),
  tone: z.enum(['success', 'info', 'neutral', 'violet', 'warning', 'danger']),
  recording: z.enum(['AVAILABLE', 'LIVE', 'NONE']),
});
export const teamData = z.object({ agents: z.array(agent), calls: z.array(teamCall), callsTotal: z.number().int(), alerts: z.array(z.string()) });
export const member = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  role,
  extension: z.string().nullable(),
  status: z.enum(['ACTIVE', 'INVITED', 'DISABLED']),
  twoFactor: z.boolean(),
  cases: z.number().int(),
  lastSeen: z.string(),
  /** Creditor of a partner account; null for the staff. */
  creditor: z.string().nullable(),
  sessions: z.number().int(),
  twoFactorRequired: z.boolean(),
  activity: z.array(z.object({ what: z.string(), when: z.string() })),
});
export type Member = z.infer<typeof member>;
export const membersData = z.object({
  members: z.array(member),
  canInvite: z.boolean(),
  canDisable: z.boolean(),
  canEditExtension: z.boolean(),
  canSupport: z.boolean(),
  creditors: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const billingType = z.enum(['INVOICE', 'QUOTE', 'CONTRACT']);
export type BillingType = z.infer<typeof billingType>;
export const billingDocument = z.object({
  id: z.string(),
  type: billingType,
  number: z.string(),
  client: z.string(),
  idLine: z.string(),
  subject: z.string(),
  date: z.iso.date(),
  amount: cents.nullable(),
  duration: z.string().nullable(),
  status: z.string(),
  tone: z.enum(['success', 'marine', 'warning', 'danger', 'neutral']),
});
export const billingData = z.object({
  firm: z.object({ name: z.string(), address: z.string(), phone: z.string(), siren: z.string(), vat: z.string(), signer: z.string() }),
  clients: z.array(z.object({ id: z.string(), name: z.string(), legal: z.string(), siren: z.string(), address: z.string(), signer: z.string() })),
  documents: z.array(billingDocument),
  nextNumbers: z.record(billingType, z.string()),
  stats: z.array(z.object({ label: z.string(), value: z.string(), sub: z.string(), tone: z.enum(['default', 'danger', 'warning']).optional() })),
});
export type BillingData = z.infer<typeof billingData>;
export interface BillingLine {
  label: string;
  quantity: string;
  unitPrice: string;
}
/** Totals in cents; VAT is rounded on the document total. */
export function billingTotals(lines: { quantity: number; unitPrice: number }[], vatRate = 20) {
  const net = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0);
  const vat = Math.round((net * vatRate) / 100);
  return { net, vat, gross: net + vat };
}
export const vatNumber = (siren: string) => {
  const digits = siren.replace(/\s/g, '');
  return `FR${String((12 + 3 * (Number(digits) % 97)) % 97).padStart(2, '0')} ${siren}`;
};

const person = { firstName: z.string().trim().min(1), lastName: z.string().trim().min(1) };
/** Staff accounts live on the firm's domain; a partner account belongs to one creditor. */
export const newMember = z.discriminatedUnion('role', [
  z.object({
    ...person,
    role: z.enum(['CLAIMS_OFFICER', 'COLLECTION_MANAGER', 'DIRECTOR', 'DEVELOPER']),
    email: z
      .email()
      .toLowerCase()
      .regex(/@legarec\.fr$/u)
      .refine((value) => !isReservedAddress(value.split('@')[0] ?? '')),
  }),
  z.object({ ...person, role: z.literal('CREDITOR'), email: z.email(), creditorId: z.string().min(1) }),
]);
export const staffRole = z.enum(['CLAIMS_OFFICER', 'COLLECTION_MANAGER', 'DIRECTOR', 'DEVELOPER']);
