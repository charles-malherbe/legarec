import { z } from 'zod';
import { checkCoordinate, coordinateKind } from './communication';
import { scenarioCode } from './creditors';
import { caseStatus } from './dashboard';
import { isValidSiret, sirenOf } from './debtorAccess';
import { isValidSiren } from './firm';
import { atMost, ID_MAX } from './limits';
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
    /** Null without any goal in the settings: no ratio is shown (question 97). */
    targetRatio: z.number().nullable(),
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
  /** Sent back with a change of status. */
  version: z.number().int(),
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
  /** The debtor as it is known, for the Director and the manager who may correct it (question 138); null for the others. */
  correctable: z.object({ name: z.string(), kind: z.enum(['COMPANY', 'SOLE_TRADER', 'INDIVIDUAL']), hasSiren: z.boolean() }).nullable(),
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
/** No code when none of the keys opens it any more. */
/** `closed`: shown read only, never renewed from a closed case (question 140). */
export const accessCodeResponse = z.object({ code: z.string().nullable(), version: z.number().int(), closed: z.boolean() });
/** The code that was on the screen when it was confirmed. */
export const renewedCode = z.object({ version: z.number().int().positive().max(1_000_000) });
export const gdprRequestKind = z.enum(['ACCESS', 'RECTIFICATION', 'OBJECTION', 'ERASURE']);
export const GDPR_LABELS: Record<z.infer<typeof gdprRequestKind>, string> = {
  ACCESS: 'Accès',
  RECTIFICATION: 'Rectification',
  OBJECTION: 'Opposition',
  ERASURE: 'Effacement',
};

// ---------------------------------------------------------------- Debtor and invoices (validated proposal 2)

export const caseSearchQuery = z.object({
  creditor: z.string().max(ID_MAX).default('all'),
  status: caseFilter.default('all'),
  officer: z.string().max(ID_MAX).default('all'),
  age: z.enum(['', '0-30', '31-60', '61-90', '90+']).catch('').default(''),
});
export const debtorKind = z.enum(['COMPANY', 'SOLE_TRADER', 'INDIVIDUAL']);
export const DEBTOR_KIND_LABELS: Record<z.infer<typeof debtorKind>, string> = {
  COMPANY: 'Entreprise',
  SOLE_TRADER: 'Entrepreneur individuel',
  INDIVIDUAL: 'Particulier',
};
/** Legal categories of INSEE that the form proposes; another one comes from the directory of companies. */
export const LEGAL_FORMS: Record<string, string> = {
  '1000': 'Entrepreneur individuel',
  '5202': 'SNC',
  '5498': 'EURL',
  '5499': 'SARL',
  '5599': 'SA',
  '5710': 'SAS',
  '5720': 'SASU',
  '5785': 'SELAS',
  '6540': 'SCI',
  '9220': 'Association déclarée',
};
/** One line: neither PostgreSQL nor a letter takes a control character. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max, atMost(max))
    .regex(/^\P{Cc}*$/u, { error: 'Retirez les caractères invisibles.' });
const typed = (max: number, error: string) => line(max).min(1, { error });
const optionalText = line;
const digitsOf = (value: string) => value.replace(/\s/gu, '');
/** « 512 334 871 00088 » or « 512 334 871 ». */
export const isCompanyNumber = (value: string) => isValidSiret(value) || isValidSiren(value);
export const sirenOfNumber = (value: string) => (digitsOf(value).length === 14 ? sirenOf(value) : digitsOf(value));

export const caseInvoice = z
  .object({
    number: typed(60, 'Indiquez le n° de facture.'),
    externalRef: optionalText(60),
    issuedOn: z.iso.date({ error: 'Indiquez la date d’émission.' }),
    dueOn: z.iso.date({ error: 'Indiquez l’échéance.' }),
    amount: enteredAmount.positive({ error: 'Indiquez un montant.' }),
    left: enteredAmount.positive({ error: 'Indiquez le reste dû.' }),
  })
  .refine((invoice) => invoice.dueOn >= invoice.issuedOn, { path: ['dueOn'], error: 'L’échéance doit suivre l’émission.' })
  .refine((invoice) => invoice.left <= invoice.amount, { path: ['left'], error: 'Au plus le montant de la facture.' });
export type CaseInvoice = z.infer<typeof caseInvoice>;
export const caseInvoices = z
  .array(caseInvoice)
  .min(1, { error: 'Ajoutez au moins une facture.' })
  .max(50, { error: 'Cinquante factures au plus.' })
  .refine((items) => new Set(items.map((item) => item.number.toLowerCase())).size === items.length, { error: 'Deux factures portent le même numéro.' });
const newContact = z.object({
  kind: coordinateKind,
  label: typed(40, 'Indiquez le libellé.'),
  value: typed(254, 'Saisissez une valeur.'),
  primary: z.boolean(),
});
const newContacts = z
  .array(newContact)
  .max(20)
  .superRefine((items, context) => {
    items.forEach((item, index) => {
      const before = items.slice(0, index).map((other, position) => ({ ...other, id: String(position), status: 'NEW' as const, note: '' }));
      const message = checkCoordinate(
        item.kind,
        item.value,
        before.filter((other) => other.kind === item.kind),
        null,
      );
      if (message) context.addIssue({ code: 'custom', path: [index, 'value'], message });
      if (item.primary && items.some((other, position) => position < index && other.primary && other.kind === item.kind))
        context.addIssue({ code: 'custom', path: [index, 'primary'], message: 'Un seul contact principal par type.' });
    });
  });
/** What the confirmation showed: refused when it is not what is recorded. */
const expectedTotals = z.object({ principal: cents.min(0).max(100_000_000_000), invoices: z.number().int().min(0).max(50) });
const totalsMatch = (value: { invoices: CaseInvoice[]; expected: { principal: number; invoices: number } }) =>
  value.expected.invoices === value.invoices.length && value.expected.principal === value.invoices.reduce((sum, invoice) => sum + invoice.left, 0);

export const newCase = z
  .object({
    creditorId: z.string().min(1, { error: 'Choisissez le créancier.' }).max(ID_MAX),
    /** The mandate that was shown. */
    mandateId: z.string().min(1).max(ID_MAX),
    externalReference: optionalText(60),
    kind: debtorKind,
    /** SIRET or SIREN; empty for an individual. */
    number: z.string().trim().max(20),
    name: typed(150, 'Indiquez le nom.'),
    nameConfirmed: z.literal(true, { error: 'Confirmez le nom du débiteur.' }),
    legalForm: z.string().regex(/^(?:\d{4})?$/u, { error: 'Choisissez la forme juridique.' }),
    address: typed(300, 'Indiquez l’adresse.'),
    postalCode: z.string().regex(/^\d{5}$/u, { error: 'Le code postal comporte 5 chiffres.' }),
    city: typed(120, 'Indiquez la ville.'),
    contactName: optionalText(120),
    contactTitle: optionalText(120),
    contacts: newContacts,
    invoices: caseInvoices,
    scenario: scenarioCode,
    /** For whoever opens it; given to someone else by another action. */
    toMe: z.boolean(),
    expected: expectedTotals,
  })
  .refine((value) => (value.kind === 'INDIVIDUAL' ? value.number === '' : isCompanyNumber(value.number)), {
    path: ['number'],
    error: 'Ce SIRET ou ce SIREN n’est pas valide.',
  })
  .refine((value) => value.kind !== 'INDIVIDUAL' || value.legalForm === '', { path: ['legalForm'], error: 'Un particulier n’a pas de forme juridique.' })
  .refine(totalsMatch, { path: ['expected'], error: 'Le total a changé : vérifiez les factures.' });
export type NewCase = z.infer<typeof newCase>;
export const caseOpened = z.object({ id: z.string(), reference: z.string() });
export const addedInvoices = z
  .object({ version: z.number().int().positive().max(1_000_000), invoices: caseInvoices, expected: expectedTotals })
  .refine(totalsMatch, { path: ['expected'], error: 'Le total a changé : vérifiez les factures.' });
/** Before a case is opened: what the person may know of it, and nothing else. */
export const caseCheck = z.object({ creditorId: z.string().min(1).max(ID_MAX), number: z.string().trim().max(20) });
export const caseCheckResult = z.object({
  mandate: z
    .object({
      id: z.string(),
      since: z.iso.date(),
      scenario: scenarioCode,
      fixedIndemnity: z.boolean(),
      terms: z.array(z.object({ label: z.string(), value: z.string() })),
      hasContract: z.boolean(),
    })
    .nullable(),
  /** The debtor of that number, when the person already reads one of its cases. */
  known: z.object({ name: z.string(), kind: debtorKind }).nullable(),
  /** The next one, when none is in force. */
  startsOn: z.iso.date().nullable(),
  open: z
    .object({ id: z.string(), reference: z.string(), name: z.string(), version: z.number().int(), officer: z.string().nullable(), canAct: z.boolean() })
    .nullable(),
  others: z.array(z.object({ creditor: z.string(), invoices: z.number().int() })),
});
export type CaseCheckResult = z.infer<typeof caseCheckResult>;
export const caseChoices = z.object({
  creditors: z.array(z.object({ id: z.string(), name: z.string() })),
  officers: z.array(z.object({ id: z.string(), name: z.string() })),
  mayAssign: z.boolean(),
});

/** The name and the kind of a debtor, corrected for all its cases (question 138); `seen`: the name that was shown. */
export const debtorCorrection = z.object({ kind: debtorKind, name: typed(150, 'Indiquez le nom.'), seen: z.string().max(300) });
/** A note of the team in the history of a case, never shown to the creditor (« + Ajouter une note » of the mockup). */
export const caseNote = z.object({ text: z.string().trim().min(1, { error: 'Écrivez la note.' }).max(5000) });
