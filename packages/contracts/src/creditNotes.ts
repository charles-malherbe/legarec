import { z } from 'zod';
import { AMOUNT_MAX, cents } from './money';
import { ID_MAX } from './limits';

/**
 * Credit notes of the firm (docs/propositions, « Avoir » ; question 69, V1 to V5). A credit note corrects an invoice
 * already issued, line by line, with its tax; the invoice never changes, its status is derived.
 */
export const creditNoteScope = z.enum(['PARTIAL', 'TOTAL']);
export type CreditNoteScope = z.infer<typeof creditNoteScope>;
/** V2: settled invoice → next remittance or transfer made by hand; invoice not settled → deducted from it. */
export const creditNoteFollowUp = z.enum(['NEXT_REMITTANCE', 'TRANSFER', 'DEDUCTED']);
export type CreditNoteFollowUp = z.infer<typeof creditNoteFollowUp>;
export const CREDIT_NOTE_REASON_MAX = 1000;
export const CREDIT_NOTE_LINES_MAX = 50;

const client = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string(),
  address: z.string(),
  siren: z.string().nullable(),
  vatNumber: z.string().nullable(),
});
export const correctableInvoice = z.object({
  id: z.string(),
  number: z.string(),
  issuedOn: z.iso.date(),
  client,
  net: cents,
  vat: cents,
  gross: cents,
  /** What the invoice still bills, with tax: the value the issuance expects. */
  left: cents,
  /** Day of the remittance that retained it; null: not settled. */
  settledOn: z.iso.date().nullable(),
  credited: z.number().int(),
  lines: z.array(z.object({ id: z.string(), label: z.string(), net: cents, vat: cents, leftNet: cents, leftVat: cents })),
});
export type CorrectableInvoice = z.infer<typeof correctableInvoice>;

export const creditNoteRow = z.object({
  id: z.string(),
  number: z.string(),
  issuedOn: z.iso.date(),
  client,
  invoiceId: z.string(),
  invoice: z.string(),
  invoiceIssuedOn: z.iso.date(),
  /** Derived: cancelled once nothing is left of it. */
  invoiceStatus: z.enum(['PARTIAL', 'CANCELLED']),
  scope: creditNoteScope,
  net: cents,
  vat: cents,
  gross: cents,
  reason: z.string(),
  followUp: creditNoteFollowUp,
  /** Day of the remittance that gave it back, if any. */
  remittedOn: z.iso.date().nullable(),
});
export type CreditNoteRow = z.infer<typeof creditNoteRow>;

const draftLine = z.object({ lineId: z.string().min(1).max(ID_MAX), net: cents.min(0).max(AMOUNT_MAX) });
export const creditNoteDraft = z.object({
  id: z.string(),
  invoiceId: z.string(),
  invoice: z.string(),
  client: z.string(),
  scope: creditNoteScope,
  lines: z.array(draftLine),
  reason: z.string(),
  followUp: creditNoteFollowUp.nullable(),
  updatedAt: z.string(),
});
export type CreditNoteDraft = z.infer<typeof creditNoteDraft>;

export const creditNotesData = z.object({
  invoices: z.array(correctableInvoice),
  items: z.array(creditNoteRow),
  drafts: z.array(creditNoteDraft),
  /** Provisional: the number is drawn at the issuance only. */
  nextNumber: z.string(),
  /** Next day of transfers, as Paramètres › Reversements says it. */
  nextRemittance: z.iso.date().nullable(),
  /** Identity of the firm printed on the credit note; a value still between brackets refuses the issuance (FIRM_INCOMPLETE). */
  firm: z.object({ name: z.string(), address: z.string(), phone: z.string(), siren: z.string(), vat: z.string(), rcs: z.string() }),
});
export type CreditNotesData = z.infer<typeof creditNotesData>;

/** What is typed, saved as a draft or issued. */
export const creditNoteDraftBody = z.object({
  invoiceId: z.string().min(1).max(ID_MAX),
  scope: creditNoteScope,
  lines: z.array(draftLine).max(CREDIT_NOTE_LINES_MAX),
  reason: z.string().trim().max(CREDIT_NOTE_REASON_MAX, { error: 'Le motif ne peut pas dépasser 1 000 caractères.' }),
  followUp: creditNoteFollowUp.nullable(),
});
export const creditNoteIssue = creditNoteDraftBody.extend({
  reason: z
    .string()
    .trim()
    .min(1, { error: 'Indiquez le motif : il est imprimé sur l’avoir.' })
    .max(CREDIT_NOTE_REASON_MAX, { error: 'Le motif ne peut pas dépasser 1 000 caractères.' }),
  followUp: creditNoteFollowUp,
  /** What the invoice still bills, with tax, as shown: anything else and nothing is issued (409 CHANGED). */
  expectedLeft: cents.min(0).max(AMOUNT_MAX),
  draftId: z.string().min(1).max(ID_MAX).nullable(),
});

/** VAT of a line credited: that of the invoice line, in proportion; all that is left when the line is credited in full. */
export function creditedVat(line: { net: number; vat: number; leftNet: number; leftVat: number }, net: number): number {
  if (net === line.leftNet) return line.leftVat;
  return line.net === 0 ? 0 : Math.round((net * line.vat) / line.net);
}

export const CREDIT_NOTE_FOLLOW_UP_LABELS: Record<CreditNoteFollowUp, string> = {
  NEXT_REMITTANCE: 'Prochain reversement',
  TRANSFER: 'Virement',
  DEDUCTED: 'Déduit de la facture',
};
