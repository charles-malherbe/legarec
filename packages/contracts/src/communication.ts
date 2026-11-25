import { z } from 'zod';
import { callOutcome, type CallOutcome } from './calls';
import { atMost, EMAIL_MAX, ID_MAX } from './limits';
import { cents } from './money';

export const coordinateKind = z.enum(['PHONE', 'EMAIL']);
export const coordinateStatus = z.enum(['VERIFIED', 'INVALID', 'UNVERIFIED', 'NEW', 'PENDING']);
export const coordinate = z.object({
  id: z.string(),
  kind: coordinateKind,
  label: z.string(),
  value: z.string(),
  status: coordinateStatus,
  primary: z.boolean(),
  note: z.string(),
});
export type Coordinate = z.infer<typeof coordinate>;
export const coordinateSource = z.enum(['CALL', 'IMPORT', 'DOCUMENT', 'CREDITOR']);
export const SOURCE_LABELS: Record<z.infer<typeof coordinateSource>, string> = {
  CALL: 'Donnée pendant l’appel',
  IMPORT: 'Erreur de saisie à l’import',
  DOCUMENT: 'Document du débiteur',
  CREDITOR: 'Transmise par le créancier',
};

export const callTarget = z.object({
  caseId: z.string(),
  kind: z.enum(['CALL', 'CALLBACK', 'MISSED']),
  debtor: z.string(),
  siret: z.string(),
  creditor: z.string(),
  creditorId: z.string(),
  contact: z.string(),
  role: z.string(),
  amount: cents,
  daysLate: z.number().int(),
  reference: z.string(),
  reason: z.string(),
  slot: z.string(),
  priority: z.enum(['HIGH', 'MEDIUM', 'NORMAL']),
  coordinates: z.array(coordinate),
  coordinateHistory: z.array(z.object({ when: z.string(), text: z.string() })),
  invoices: z.array(z.object({ number: z.string(), due: z.iso.date(), amount: cents })),
  note: z.string(),
  doneOutcome: callOutcome.nullable(),
  history: z.array(z.object({ channel: z.string(), text: z.string(), when: z.string() })),
  ai: z
    .object({
      lines: z.array(z.object({ who: z.string(), text: z.string() })),
      chips: z.array(z.string()),
      summary: z.string(),
      outcome: callOutcome,
      facts: z.array(z.object({ k: z.string(), v: z.string() })),
      amount: cents.nullable(),
      date: z.iso.date().nullable(),
      invoices: z.array(z.string()),
    })
    .nullable(),
});
export type CallTarget = z.infer<typeof callTarget>;
export const callsData = z.object({
  campaign: z.string(),
  line: z.string(),
  extension: z.string().nullable(),
  tcx: z.enum(['CONNECTED', 'DOWN']),
  targets: z.array(callTarget),
  active: z.object({ caseId: z.string(), seconds: z.number().int(), announced: z.boolean(), phone: z.string() }).nullable(),
  colleagues: z.array(z.object({ extension: z.string(), name: z.string(), state: z.string(), available: z.boolean() })),
  stats: z.object({
    calls: z.number().int(),
    target: z.number().int(),
    reached: z.number().int(),
    promises: z.string(),
    duration: z.string(),
    corrected: z.number().int(),
  }),
});

export const CALL_OUTCOMES: { code: CallOutcome; label: string }[] = [
  { code: 'PROMISE_TO_PAY', label: 'Promesse de paiement' },
  { code: 'PAYMENT_PLAN', label: 'Demande d’échéancier' },
  { code: 'CALLBACK', label: 'Rappel demandé' },
  { code: 'DISPUTE', label: 'Litige' },
  { code: 'ALREADY_PAID', label: 'Déjà payé' },
  { code: 'ABSENT', label: 'Absent' },
  { code: 'NO_ANSWER', label: 'Pas de réponse' },
  { code: 'WRONG_NUMBER', label: 'Mauvais numéro' },
];
export const qualification = z.object({
  outcome: callOutcome,
  tcxCode: z.string(),
  interlocutor: z.string(),
  notes: z.string(),
  promise: z.object({ amount: cents, date: z.iso.date(), method: z.enum(['TRANSFER', 'CHEQUE']), invoices: z.array(z.string()) }).nullable(),
  paymentReference: z.string().nullable(),
  months: z.number().int().nullable(),
  recall: z.string().nullable(),
  announced: z.boolean(),
  sendRecap: z.boolean(),
});
export type Qualification = z.infer<typeof qualification>;

export const FRENCH_PHONE = /^(\+33\s?|0)[1-9](\s?\d{2}){4}$/;
export const formatPhone = (value: string) => {
  const digits = value.replace(/\s/g, '').replace(/^\+33/, '0');
  return /^0\d{9}$/.test(digits) ? digits.replace(/(\d{2})(?=\d)/g, '$1 ') : value;
};
/** Returns an error message, or an empty string when the coordinate can be saved. */
export function checkCoordinate(kind: Coordinate['kind'], raw: string, existing: Coordinate[], selfId: string | null): string {
  const value = raw.trim();
  if (!value) return 'Saisissez une valeur.';
  const others = existing.filter((item) => item.id !== selfId);
  if (kind === 'PHONE') {
    if (!FRENCH_PHONE.test(value)) return 'Numéro français attendu, par exemple 06 12 34 56 78 ou +33 6 12 34 56 78.';
    const digits = value.replace(/\s/g, '').replace(/^\+33/, '0');
    return others.some((item) => item.value.replace(/\s/g, '') === digits) ? 'Ce numéro est déjà enregistré pour ce débiteur.' : '';
  }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) return 'Adresse e-mail invalide, par exemple nom@entreprise.fr.';
  return others.some((item) => item.value.toLowerCase() === value.toLowerCase()) ? 'Cette adresse est déjà enregistrée pour ce débiteur.' : '';
}

export const emailCategory = z.enum(['PAYMENT_PLAN', 'DISPUTE', 'PAYMENT', 'PROMISE', 'BOUNCE', 'OTHER']);
export const EMAIL_CATEGORIES: Record<z.infer<typeof emailCategory>, { label: string; tag: string }> = {
  PAYMENT_PLAN: { label: 'Demande d’échéancier', tag: 'Échéancier' },
  DISPUTE: { label: 'Litige', tag: 'Litige' },
  PAYMENT: { label: 'Paiement ou justificatif', tag: 'Paiement' },
  PROMISE: { label: 'Promesse de paiement', tag: 'Promesse' },
  BOUNCE: { label: 'E-mail non remis', tag: 'Rebond' },
  OTHER: { label: 'Autre', tag: 'Autre' },
};
export const emailThread = z.object({
  id: z.string(),
  source: z.enum(['EMAIL', 'DEBTOR_PORTAL']),
  verified: z.boolean(),
  category: emailCategory,
  recategorized: z.boolean(),
  unread: z.boolean(),
  from: z.string(),
  email: z.string(),
  caseId: z.string(),
  debtor: z.string(),
  creditor: z.string(),
  creditorId: z.string(),
  reference: z.string(),
  due: cents,
  time: z.string(),
  date: z.string(),
  subject: z.string(),
  body: z.string(),
  attachment: z.string().nullable(),
  archived: z.boolean(),
  canAct: z.boolean().optional(),
  replies: z.array(z.object({ id: z.string(), text: z.string(), status: z.enum(['SENT', 'FAILED']), when: z.string() })),
  ai: z
    .object({ summary: z.string(), facts: z.array(z.object({ k: z.string(), v: z.string() })), actions: z.array(z.string()), draft: z.string().nullable() })
    .nullable(),
});
export type EmailThread = z.infer<typeof emailThread>;
export const emailDraft = z.object({
  id: z.string(),
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  caseId: z.string().nullable(),
  /** Case of the draft, as long as its author may still act on it. */
  recipient: z.object({ name: z.string(), reference: z.string() }).nullable().optional(),
  updated: z.string(),
});
export type EmailDraft = z.infer<typeof emailDraft>;
export const automaticEmail = z.object({
  id: z.string(),
  caseId: z.string(),
  debtor: z.string(),
  creditorId: z.string(),
  creditor: z.string(),
  subject: z.string(),
  when: z.string(),
  status: z.enum(['DELIVERED', 'OPENED', 'FAILED']),
});
export const messageTemplate = z.object({ id: z.string(), use: z.enum(['NEW', 'REPLY', 'BOTH']), name: z.string(), subject: z.string(), text: z.string() });
export type MessageTemplate = z.infer<typeof messageTemplate>;
export const mailboxData = z.object({
  drafts: z.array(emailDraft),
  automatic: z.array(automaticEmail),
  templates: z.array(messageTemplate),
  sender: z.object({
    name: z.string(),
    address: z.email(),
    roleLabel: z.string(),
    phone: z.string(),
    extension: z.string().nullable(),
    firmAddress: z.string(),
    website: z.string(),
    sentThisHour: z.number().int(),
    hourlyQuota: z.number().int(),
  }),
  syncedMinutesAgo: z.number().int(),
  threads: z.array(emailThread),
  total: z.number().int(),
  folders: z.object({ inbox: z.number().int(), drafts: z.number().int(), automatic: z.number().int() }),
  stats: z.object({ unread: z.number().int(), todo: z.number().int(), delay: z.string(), automatic: z.number().int() }),
});

export const smsThread = z.object({
  id: z.string(),
  linked: z.boolean(),
  stopped: z.boolean(),
  caseId: z.string().nullable(),
  name: z.string(),
  contact: z.string(),
  phone: z.string(),
  creditor: z.string(),
  creditorId: z.string().nullable(),
  due: cents.nullable(),
  late: z.string(),
  status: z.enum(['OVERDUE', 'PROMISE', 'REMINDER', 'SETTLED']).nullable(),
  time: z.string(),
  unread: z.number().int(),
  canAct: z.boolean().optional(),
  next: z.string(),
  messages: z.array(
    z.object({ id: z.string(), direction: z.enum(['IN', 'OUT']), text: z.string(), meta: z.string(), automatic: z.string().nullable(), failed: z.boolean() }),
  ),
});
export type SmsThread = z.infer<typeof smsThread>;
export const smsData = z.object({
  threads: z.array(smsThread),
  total: z.number().int(),
  stopNotice: z.string(),
  /** Figures of the firm: never for a claims officer. */
  stats: z.object({ sent: z.number().int(), delivered: z.number(), answers: z.number().int(), stops: z.number().int(), stopRate: z.number() }).nullable(),
});

/** Message of an employee: one valid address, and a real case or none. */
export const outgoingMessage = z.object({
  to: z.email({ error: 'Saisissez une adresse e-mail valide.' }).max(EMAIL_MAX, atMost(EMAIL_MAX)),
  subject: z.string().trim().min(1).max(150, atMost(150)),
  paragraphs: z
    .array(z.string().min(1).max(5000, atMost(5000)))
    .min(1)
    .max(100),
  caseId: z.string().min(1).max(ID_MAX).nullable(),
  statement: z.boolean().default(false),
});
