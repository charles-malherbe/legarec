import { z } from 'zod';
import { cents } from './money';

/**
 * Claims deposited by creditors, waiting for the Director or the manager before they become cases (question 155). What the
 * creditor gave is shown as it gave it: never verified.
 */
export const depositItem = z.object({
  id: z.string(),
  creditorId: z.string(),
  creditor: z.string(),
  debtor: z.string(),
  /** « SIRET 512 334 871 00088 », or « Particulier ». */
  identifier: z.string(),
  address: z.string(),
  email: z.string(),
  phone: z.string(),
  invoices: z.array(z.object({ number: z.string(), issuedOn: z.iso.date(), dueOn: z.iso.date(), amount: cents })),
  total: cents,
  files: z.number().int(),
  depositedOn: z.iso.date(),
});
export type DepositItem = z.infer<typeof depositItem>;
export const depositsData = z.object({ items: z.array(depositItem), count: z.number().int() });

/** With the total that was shown: refused when the deposit changed since. */
export const depositAcceptance = z.object({ expectedTotal: cents.min(1).max(2_000_000_000) });
export const depositRefusal = z.object({
  reason: z.string().trim().min(5, { error: 'Indiquez le motif du refus (5 caractères au moins).' }).max(500, { error: '500 caractères au plus.' }),
});
export const depositAccepted = z.object({ caseId: z.string() });
