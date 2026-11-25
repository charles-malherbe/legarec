import { z } from 'zod';
import { caseStatus } from './dashboard';
import { atMost } from './limits';
import { cents, enteredAmount } from './money';

export const caseListItem = z.object({
  id: z.string(),
  reference: z.string(),
  name: z.string(),
  identifier: z.string(),
  creditorId: z.string(),
  creditor: z.string(),
  invoicesLabel: z.string(),
  amount: cents,
  daysLate: z.number().int().nullable(),
  status: caseStatus,
  statusLabel: z.string(),
  nextAction: z.string(),
  nextDate: z.string(),
  officerId: z.string().nullable(),
  officer: z.string().nullable(),
  canAct: z.boolean(),
});
export type CaseListItem = z.infer<typeof caseListItem>;
export const caseFilter = z.enum(['all', 'overdue', 'reminder', 'promise', 'dispute', 'settled', 'unassigned']);
export type CaseFilter = z.infer<typeof caseFilter>;
export const caseList = z.object({
  items: z.array(caseListItem),
  total: z.number().int(),
  counts: z.record(caseFilter, z.number().int()),
  stats: z.object({
    outstanding: cents,
    invoices: z.number().int(),
    overdue: z.number().int(),
    overdueAmount: cents,
    promises: z.number().int(),
    promisesToday: z.number().int(),
    recovered: cents,
    targetRatio: z.number(),
  }),
});

export const paymentMethod = z.enum(['CHEQUE', 'TRANSFER']);
export const paymentStatus = z.enum(['RECEIVED', 'DEPOSITED', 'CASHED', 'BOUNCED', 'RECONCILED', 'TO_RECONCILE']);
export const payment = z.object({
  id: z.string(),
  method: paymentMethod,
  amount: cents,
  status: paymentStatus,
  receivedOn: z.iso.date(),
  depositedOn: z.iso.date().nullable(),
  chequeNumber: z.string().nullable(),
  bank: z.string().nullable(),
  label: z.string().nullable(),
  receiptId: z.string().nullable(),
  allocation: z.object({ interest: cents, principal: cents, fees: cents }),
});
export type Payment = z.infer<typeof payment>;
export const PAYMENT_STATUS_LABELS: Record<z.infer<typeof paymentStatus>, string> = {
  RECEIVED: 'Reçu',
  DEPOSITED: 'Remis en banque',
  CASHED: 'Encaissé',
  BOUNCED: 'Impayé',
  RECONCILED: 'Rapproché',
  TO_RECONCILE: 'À rapprocher',
};

const day = z.iso.date({ error: 'Indiquez une date.' });
export const newPayment = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('CHEQUE'),
    amount: enteredAmount.positive({ error: 'Indiquez un montant.' }),
    chequeNumber: z.string().regex(/^\d{7}$/, { error: 'Le numéro de chèque comporte 7 chiffres.' }),
    bank: z.string().min(2, { error: 'Indiquez la banque.' }).max(80, atMost(80)),
    receivedOn: day,
    depositedOn: day.nullable(),
  }),
  z.object({
    method: z.literal('TRANSFER'),
    amount: enteredAmount.positive({ error: 'Indiquez un montant.' }),
    receivedOn: day,
    label: z.string().min(1, { error: 'Indiquez le libellé reçu.' }).max(140, atMost(140)),
    reconciled: z.boolean(),
  }),
]);
export type NewPayment = z.infer<typeof newPayment>;

export const deliveryStatus = z.enum(['SENT', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED']);
export const DELIVERY_LABELS: Record<z.infer<typeof deliveryStatus>, string> = {
  SENT: 'Envoyé',
  DELIVERED: 'Distribué',
  ACKNOWLEDGED: 'Accusé de réception reçu',
  FAILED: 'Erreur',
};
export const exchangeChannel = z.enum(['EMAIL_IN', 'EMAIL_OUT', 'CALL', 'SMS_IN', 'SMS_OUT', 'LETTER', 'REGISTERED_LETTER', 'PORTAL_IN', 'PORTAL_OUT']);
export const exchange = z.object({
  id: z.string(),
  channel: exchangeChannel,
  title: z.string(),
  text: z.string(),
  when: z.string(),
  delivery: deliveryStatus.nullable(),
  acknowledgmentId: z.string().nullable(),
  verified: z.boolean(),
});
export type Exchange = z.infer<typeof exchange>;
export const historyEntry = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  date: z.string(),
  actor: z.string(),
  onBehalfOf: z.string().nullable(),
  tone: z.enum(['danger', 'info', 'warning', 'success', 'neutral']),
});

export const caseDetail = caseListItem.extend({
  creditorRef: z.string(),
  isIndividual: z.boolean(),
  principal: cents,
  interest: cents,
  fees: cents,
  remindersSent: z.number().int(),
  remindersTotal: z.number().int(),
  /** Companies only, computed from plain rules; never for an individual. */
  risk: z.object({ label: z.string(), reason: z.string() }).nullable(),
  contacts: z.array(z.object({ id: z.string(), kind: z.enum(['PHONE', 'EMAIL']), value: z.string(), verified: z.boolean() })),
  mainContact: z.object({ name: z.string(), title: z.string(), phone: z.string(), email: z.string(), address: z.string() }),
  aiSummary: z.object({ events: z.number().int(), updated: z.string(), lines: z.array(z.object({ k: z.string(), v: z.string() })) }).nullable(),
  invoices: z.array(z.object({ number: z.string(), issued: z.iso.date(), due: z.iso.date(), amount: cents, daysLate: z.number().int() })),
  history: z.array(historyEntry),
  exchanges: z.array(exchange),
  payments: z.array(payment),
  documents: z.array(z.object({ id: z.string(), name: z.string(), meta: z.string(), kind: z.enum(['PDF', 'DOCX']) })),
  mandate: z.object({ sector: z.string(), terms: z.array(z.object({ label: z.string(), value: z.string() })) }),
  otherClaims: z.array(z.object({ creditor: z.string(), invoices: z.number().int(), amount: cents })),
  scenario: z.array(z.object({ label: z.string(), when: z.string(), state: z.enum(['DONE', 'NEXT', 'TODO']) })),
  firstLetter: z.object({ reference: z.string(), date: z.iso.date() }).nullable(),
  contactLimit: z.string().nullable(),
});
export type CaseDetail = z.infer<typeof caseDetail>;
export const accessCodeResponse = z.object({ code: z.string() });
export const gdprRequestKind = z.enum(['ACCESS', 'RECTIFICATION', 'OBJECTION', 'ERASURE']);
export const GDPR_LABELS: Record<z.infer<typeof gdprRequestKind>, string> = {
  ACCESS: 'Accès',
  RECTIFICATION: 'Rectification',
  OBJECTION: 'Opposition',
  ERASURE: 'Effacement',
};
