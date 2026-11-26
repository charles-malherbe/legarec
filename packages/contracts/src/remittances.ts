import { z } from 'zod';
import { cents } from './money';

/**
 * Remittances to the creditors (docs/propositions, « Validation des reversements »). READY: paid in this batch.
 * BELOW_MINIMUM: under the threshold, deferred as the mandate allows. NO_ACCOUNT: no confirmed account (C3). NO_MANDATE:
 * a payment of a case without mandate, whose commission cannot be computed. RETAINED: kept out with a reason (R7). PAID.
 */
export const remittanceState = z.enum(['READY', 'BELOW_MINIMUM', 'NO_ACCOUNT', 'NO_MANDATE', 'RETAINED', 'PAID']);
export type RemittanceState = z.infer<typeof remittanceState>;
export const REMITTANCE_STATE_LABELS: Record<RemittanceState, string> = {
  READY: 'Prêt',
  BELOW_MINIMUM: 'Sous le seuil',
  NO_ACCOUNT: 'Compte manquant',
  NO_MANDATE: 'Mandat manquant',
  RETAINED: 'Retenu',
  PAID: 'Versé',
};

export const remittanceRow = z.object({
  creditorId: z.string(),
  creditor: z.string(),
  state: remittanceState,
  payments: z.number().int(),
  /** Cheques cashed and transfers reconciled, not yet remitted, until the day before. */
  collected: cents,
  /** Commission of the mandate and opening fees: before tax, tax, with tax (retained with tax, R1). */
  feesNet: cents,
  feesVat: cents,
  feesGross: cents,
  toPay: cents,
  /** Masked: the whole IBAN is shown on request and written in the audit (C3). */
  account: z.string().nullable(),
  invoice: z.string().nullable(),
  reason: z.string().nullable(),
});
export type RemittanceRow = z.infer<typeof remittanceRow>;

export const remittanceDraft = z.object({
  until: z.iso.date(),
  rows: z.array(remittanceRow),
  /** What the READY rows add up to: the values the validation expects. */
  total: cents,
  transfers: z.number().int(),
});

export const remittanceBatch = z.object({
  id: z.string(),
  until: z.iso.date(),
  status: z.enum(['VALIDATED', 'PAID']),
  total: cents,
  transfers: z.number().int(),
  validatedAt: z.string(),
  validatedBy: z.string(),
  paidOn: z.iso.date().nullable(),
  rows: z.array(remittanceRow),
});
export const remittanceBatches = z.object({ items: z.array(remittanceBatch.omit({ rows: true })) });
