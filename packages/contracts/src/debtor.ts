import { z } from 'zod';
import { accessCode, isValidSiret } from './debtorAccess';
import { cents } from './money';

/** Debtors' portal (no account): an identifier and a four-letter access code. */
export const debtorIdentifier = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SIRET'), value: z.string().refine(isValidSiret, { error: 'Ce SIRET n’est pas valide (14 chiffres).' }) }),
  z.object({
    kind: z.literal('REFERENCE'),
    value: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^(DOS|LGR)-\d{4}-\d{4,5}$/u, { error: 'Saisissez la référence imprimée sur votre courrier, par exemple DOS-2026-0181.' }),
  }),
]);
export type DebtorIdentifier = z.infer<typeof debtorIdentifier>;
export const debtorAccess = z.object({ identifier: debtorIdentifier, code: accessCode, remember: z.boolean() });
export const debtorAccessError = z.discriminatedUnion('code', [
  z.object({ code: z.literal('INVALID'), attemptsLeft: z.number().int() }),
  z.object({ code: z.literal('LOCKED'), minutes: z.number().int() }),
  z.object({ code: z.literal('BLOCKED') }),
  z.object({ code: z.literal('TOO_MANY') }),
]);
export type DebtorAccessError = z.infer<typeof debtorAccessError>;
/** Opaque token of a letter, QR code or SMS: it pre-fills the identifier and never carries the code. */
export const debtorLink = z.object({ identifier: z.object({ kind: z.enum(['SIRET', 'REFERENCE']), value: z.string() }) });
export const codeBySms = z.object({ maskedPhone: z.string().nullable() });

const tone = z.enum(['neutral', 'info', 'success', 'warning', 'danger', 'violet']);
export const debtorCaseSummary = z.object({
  id: z.string(),
  reference: z.string(),
  creditor: z.string(),
  balance: cents,
  statusLabel: z.string(),
  statusTone: tone,
});
export const debtorSession = z.object({ greeting: z.string(), debtor: z.string(), cases: z.array(debtorCaseSummary) });
export type DebtorSession = z.infer<typeof debtorSession>;

export const paymentInfo = z.object({
  beneficiary: z.string(),
  iban: z.string(),
  bic: z.string(),
  reference: z.string().nullable(),
  chequeOrder: z.string(),
  chequeAddress: z.string(),
});
export type PaymentInfo = z.infer<typeof paymentInfo>;
export const installmentStatus = z.enum(['PAID', 'DUE', 'UPCOMING', 'LATE']);
export const debtorCase = debtorCaseSummary.extend({
  debtor: z.string(),
  officer: z.string(),
  isIndividual: z.boolean(),
  principal: cents,
  interest: cents,
  indemnity: cents,
  paid: cents,
  invoices: z.array(z.object({ id: z.string(), number: z.string(), dueOn: z.string(), amount: cents })),
  payments: z.array(z.object({ id: z.string(), amount: cents, date: z.string(), method: z.enum(['TRANSFER', 'CHEQUE']), receiptId: z.string().nullable() })),
  next: z.object({ date: z.string(), amount: cents }).nullable(),
  lastMessage: z.object({ who: z.string(), when: z.string(), text: z.string() }).nullable(),
  unread: z.number().int(),
  plan: z
    .object({
      acceptedOn: z.string(),
      installments: z.array(z.object({ number: z.number().int(), dueOn: z.string(), amount: cents, status: installmentStatus })),
    })
    .nullable(),
  payment: paymentInfo,
});
export type DebtorCase = z.infer<typeof debtorCase>;
export const debtorMessages = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      mine: z.boolean(),
      who: z.string(),
      when: z.string(),
      text: z.string(),
      attachments: z.array(z.object({ id: z.string(), name: z.string() })),
      receipt: z.string().nullable(),
    }),
  ),
});
export const ATTACHMENT_KINDS = {
  TRANSFER_PROOF: 'Justificatif de virement',
  CHEQUE_COPY: 'Copie de chèque',
  DISPUTE: 'Contestation',
  CERTIFICATE: 'Attestation',
  OTHER: 'Autre pièce',
} as const;
const attachments = z.array(z.object({ id: z.string(), name: z.string() }));
export const debtorMessage = z.object({
  text: z.string().trim().min(1, { error: 'Écrivez votre message.' }).max(5000),
  attachmentKind: z.enum(['TRANSFER_PROOF', 'CHEQUE_COPY', 'DISPUTE', 'CERTIFICATE', 'OTHER']),
  attachments,
});
export const DISPUTE_REASONS = [
  'La facture a déjà été payée',
  'Le montant est erroné',
  'La prestation n’est pas conforme',
  'Je ne suis pas concerné par cette dette',
  'Autre motif',
] as const;
/** Guided requests, each one sent as a structured message. */
export const debtorRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PLAN'), months: z.union([z.literal(2), z.literal(3), z.literal(6)]), note: z.string().trim().max(2000) }),
  z.object({
    kind: z.literal('DISPUTE'),
    reason: z.enum(DISPUTE_REASONS),
    text: z.string().trim().min(10, { error: 'Expliquez votre contestation en quelques mots.' }).max(5000),
    attachments,
  }),
  z.object({
    kind: z.literal('ALREADY_PAID'),
    paidOn: z.iso.date({ error: 'Saisissez la date du paiement.' }),
    amount: z.int({ error: 'Saisissez un montant, par exemple 1 250,00.' }).positive({ error: 'Saisissez un montant supérieur à zéro.' }),
    method: z.enum(['TRANSFER', 'CHEQUE']),
    attachments,
  }),
  z.object({
    kind: z.literal('CALLBACK'),
    phone: z.string().regex(/^0[1-9](?:[\s.]?\d{2}){4}$/u, { error: 'Saisissez un numéro à 10 chiffres.' }),
    slot: z.enum(['MORNING', 'AFTERNOON']),
  }),
]);
export type DebtorRequest = z.infer<typeof debtorRequest>;
/** Limited access: instructions and messages, nothing about the debt. */
export const limitedMessage = z.object({
  name: z.string().trim().min(1, { error: 'Saisissez votre nom.' }),
  email: z.union([z.literal(''), z.email({ error: 'Saisissez une adresse e-mail valide.' })]),
  reference: z.string().trim().max(40),
  text: z.string().trim().min(1, { error: 'Écrivez votre message.' }).max(5000),
  attachments,
});
