import { z } from 'zod';
import { cents } from './money';
import { splitPlan } from './collection';

export const documentCategory = z.enum(['REMINDER_LETTER', 'FORMAL_NOTICE', 'PAYMENT_PLAN', 'INVOICE', 'EVIDENCE', 'COURT', 'REMITTANCE', 'RECEIPT']);
export type DocumentCategory = z.infer<typeof documentCategory>;
export const DOCUMENT_CATEGORIES: Record<DocumentCategory, string> = {
  REMINDER_LETTER: 'Courriers de relance',
  FORMAL_NOTICE: 'Mises en demeure',
  PAYMENT_PLAN: 'Échéanciers signés',
  INVOICE: 'Factures du créancier',
  EVIDENCE: 'Justificatifs et preuves',
  COURT: 'Actes judiciaires',
  REMITTANCE: 'Relevés de reversement',
  RECEIPT: 'Quittances',
};
export const documentItem = z.object({
  id: z.string(),
  category: documentCategory,
  name: z.string(),
  title: z.string(),
  debtor: z.string(),
  caseId: z.string().nullable(),
  creditor: z.string(),
  creditorId: z.string(),
  date: z.iso.date(),
  size: z.string(),
  kind: z.enum(['PDF', 'DOCX']),
  status: z.string(),
  tone: z.enum(['info', 'success', 'neutral', 'marine', 'warning']),
  tracking: z.string(),
  author: z.string(),
});
export type DocumentItem = z.infer<typeof documentItem>;
export const documentsData = z.object({
  items: z.array(documentItem),
  total: z.number().int(),
  size: z.string(),
  counts: z.record(documentCategory, z.number().int()),
});

export const letterTemplate = z.enum(['FRIENDLY', 'FIRM', 'FORMAL_NOTICE', 'PAYMENT_PLAN', 'CLEARANCE']);
export type LetterTemplate = z.infer<typeof letterTemplate>;
export const LETTER_TEMPLATES: Record<LetterTemplate, { label: string; hint: string; subject: string; channel: string; slug: string }> = {
  FRIENDLY: {
    label: 'Relance amiable',
    hint: 'Premier rappel courtois',
    subject: 'Rappel – factures impayées',
    channel: 'E-mail avec PDF joint',
    slug: 'amiable',
  },
  FIRM: { label: 'Relance ferme', hint: 'Avec indemnités de retard', subject: 'Relance – factures impayées', channel: 'E-mail avec PDF joint', slug: 'ferme' },
  FORMAL_NOTICE: {
    label: 'Mise en demeure',
    hint: 'Dernier avertissement avant procédure',
    subject: 'Mise en demeure de payer',
    channel: 'Lettre recommandée avec AR (MySendingBox)',
    slug: 'demeure',
  },
  PAYMENT_PLAN: {
    label: 'Proposition d’échéancier',
    hint: 'Plan de paiement à signer',
    subject: 'Proposition d’échéancier',
    channel: 'E-mail avec lien de signature',
    slug: 'echeancier',
  },
  CLEARANCE: {
    label: 'Attestation de solde',
    hint: 'Confirme le paiement intégral',
    subject: 'Attestation de solde',
    channel: 'E-mail avec PDF joint',
    slug: 'attestation',
  },
};
export const letterRecipient = z.object({
  caseId: z.string(),
  name: z.string(),
  contact: z.string(),
  address: z.array(z.string()),
  creditor: z.string(),
  reference: z.string(),
  isIndividual: z.boolean(),
  lastReminder: z.iso.date(),
  firstLetter: z.object({ reference: z.string(), date: z.iso.date() }).nullable(),
  interest: cents,
  invoices: z.array(z.object({ number: z.string(), due: z.iso.date(), amount: cents })),
});
export type LetterRecipient = z.infer<typeof letterRecipient>;
export const composeData = z.object({
  firm: z.object({ name: z.string(), address: z.string(), phone: z.string(), siren: z.string() }),
  recipients: z.array(letterRecipient),
  batch: z.object({ debtors: z.number().int(), invoices: z.number().int(), amount: cents }).nullable(),
});

/** The 40 € fixed indemnity only concerns professional debtors, never an individual. */
export const fixedIndemnity = (recipient: Pick<LetterRecipient, 'isIndividual' | 'invoices'>) =>
  recipient.isIndividual ? 0 : recipient.invoices.length * 4000;
export function letterTotals(recipient: LetterRecipient, withIndemnity: boolean) {
  const principal = recipient.invoices.reduce((sum, item) => sum + item.amount, 0);
  const indemnity = withIndemnity ? fixedIndemnity(recipient) : 0;
  return { principal, interest: recipient.interest, indemnity, total: principal + recipient.interest + indemnity };
}
export const letterSchedule = (total: number, months: number) =>
  splitPlan(total, months).map((amount, index) => ({ date: new Date(Date.UTC(2026, 11 + index, 15)).toISOString().slice(0, 10), amount }));
