import { z } from 'zod';
import { caseStatus } from './dashboard';
import { cents } from './money';

export const creditorListItem = z.object({
  id: z.string(),
  initials: z.string(),
  name: z.string(),
  sector: z.string(),
  siren: z.string(),
  debtors: z.number().int(),
  invoices: z.number().int(),
  outstanding: cents,
  recovered: cents,
  rate: z.number(),
  fee: z.string(),
  owner: z.string(),
  status: z.enum(['ACTIVE', 'RENEWAL']),
  statusLabel: z.string(),
});
export type CreditorListItem = z.infer<typeof creditorListItem>;

export const invoiceState = z.enum(['UNPAID', 'PARTIAL', 'DISPUTED', 'REMINDED', 'PLAN']);
export type InvoiceState = z.infer<typeof invoiceState>;
const portfolioDebtor = z.object({
  id: z.string(),
  name: z.string(),
  reference: z.string(),
  amount: cents,
  daysLate: z.number().int(),
  status: caseStatus,
  statusLabel: z.string(),
  invoices: z.array(z.object({ number: z.string(), externalRef: z.string(), due: z.iso.date(), total: cents, left: cents, state: invoiceState })),
});
export const creditorDetail = creditorListItem.extend({
  mandateSince: z.iso.date(),
  ownerName: z.string(),
  totalDebtors: z.number().int(),
  portfolio: z.array(portfolioDebtor),
  payouts: z.array(z.object({ id: z.string(), date: z.iso.date(), collections: z.number().int(), gross: cents, fee: cents, net: cents })),
  nextPayout: z.object({ date: z.iso.date(), net: cents, gross: cents, fee: cents }),
  activity: z.array(z.object({ id: z.string(), who: z.string(), what: z.string(), when: z.string(), status: caseStatus.nullable() })),
  mandateTerms: z.array(z.object({ label: z.string(), value: z.string() })),
  contact: z.object({ name: z.string(), title: z.string(), phone: z.string(), email: z.email(), portalEnabled: z.boolean() }),
});
export type CreditorDetail = z.infer<typeof creditorDetail>;
