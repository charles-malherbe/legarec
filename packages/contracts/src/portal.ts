import { z } from 'zod';
import { isValidSiret } from './debtorAccess';
import { cents } from './money';

/** Creditors' portal. Every answer of the API is already limited to the creditor of the session. */
export const partnerSession = z.object({
  userId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  creditor: z.object({ id: z.string(), name: z.string(), initials: z.string(), siren: z.string() }),
  officer: z.string(),
  unread: z.number().int(),
});
export type PartnerSession = z.infer<typeof partnerSession>;

export const portalStatus = z.enum(['NEW', 'REMINDING', 'PLAN', 'LITIGATION', 'SETTLED', 'LOST']);
export type PortalStatus = z.infer<typeof portalStatus>;
export const PORTAL_STATUS_LABELS: Record<PortalStatus, string> = {
  NEW: 'Nouveau',
  REMINDING: 'En relance',
  PLAN: 'Échéancier',
  LITIGATION: 'Contentieux',
  SETTLED: 'Soldé',
  LOST: 'Irrécouvrable',
};
export const planApproval = z.object({
  id: z.string(),
  caseId: z.string(),
  debtor: z.string(),
  reference: z.string(),
  months: z.number().int(),
  installment: cents,
  total: cents,
  firstOn: z.string(),
  reason: z.string(),
  status: z.enum(['PENDING', 'ACCEPTED', 'REFUSED']),
});
export type PlanApproval = z.infer<typeof planApproval>;
export const portalDashboard = z.object({
  kpis: z.array(z.object({ label: z.string(), value: z.string(), hint: z.string() })),
  statuses: z.array(z.object({ status: portalStatus, count: z.number().int() })),
  months: z.array(z.object({ label: z.string(), amount: cents })),
  activity: z.array(z.object({ id: z.string(), who: z.string(), what: z.string(), when: z.string(), tone: z.enum(['success', 'warning', 'danger', 'info']) })),
  approvals: z.array(planApproval),
});
export const portalCase = z.object({
  id: z.string(),
  status: portalStatus,
  debtor: z.string(),
  externalReference: z.string(),
  reference: z.string(),
  invoices: z.string(),
  entrusted: cents,
  recovered: cents,
  last: z.string(),
  steps: z.array(z.object({ title: z.string(), date: z.string() })),
});
export type PortalCase = z.infer<typeof portalCase>;
export const portalCases = z.object({ items: z.array(portalCase), counts: z.record(z.string(), z.number().int()) });

const french = (message: string) => z.string().trim().min(1, { error: message });
const claimInvoice = z
  .object({
    number: french('Saisissez le numéro de facture.'),
    issuedOn: z.iso.date({ error: 'Saisissez une date.' }),
    dueOn: z.iso.date({ error: 'Saisissez une date.' }),
    amount: z.int({ error: 'Saisissez un montant, par exemple 1 250,00.' }).positive({ error: 'Saisissez un montant supérieur à zéro.' }),
  })
  .refine((value) => value.issuedOn <= value.dueOn, { path: ['dueOn'], error: 'L’échéance doit suivre l’émission.' });
export const newClaim = z
  .object({
    debtor: french('Saisissez le nom ou la raison sociale.'),
    siret: z.string().trim(),
    email: z.union([z.literal(''), z.email({ error: 'Saisissez une adresse e-mail valide.' })]),
    phone: z.string().trim(),
    address: french('Saisissez l’adresse du débiteur.'),
    invoices: z.array(claimInvoice).min(1).max(50),
  })
  .refine((value) => value.siret === '' || isValidSiret(value.siret), { path: ['siret'], error: 'Ce SIRET n’est pas valide (14 chiffres).' })
  .refine((value) => new Set(value.invoices.map((item) => item.number)).size === value.invoices.length, {
    path: ['invoices', 0, 'number'],
    error: 'Le même numéro de facture est saisi deux fois.',
  });
export const uploadedFile = z.object({ id: z.string() });
/** Line by line report built by the API: nothing is created before the confirmation. */
export const importReport = z.object({
  id: z.string(),
  lines: z.number().int(),
  valid: z.number().int(),
  total: cents,
  errors: z.array(z.object({ line: z.number().int(), message: z.string() })),
});
export type ImportReport = z.infer<typeof importReport>;
export const importDone = z.object({ created: z.number().int(), pending: z.number().int() });

export const portalPayouts = z.object({
  rateLabel: z.string(),
  next: z.object({ date: z.string(), net: cents, collected: cents, fee: cents }),
  year: z.object({ paid: cents, recovered: cents, fees: cents }),
  items: z.array(z.object({ id: z.string(), date: z.string(), count: z.number().int(), collected: cents, fee: cents, net: cents })),
});
export const portalMessage = z.object({ id: z.string(), mine: z.boolean(), who: z.string(), when: z.string(), text: z.string() });
export const portalThreads = z.object({
  items: z.array(
    z.object({ id: z.string(), subject: z.string(), reference: z.string(), time: z.string(), unread: z.boolean(), messages: z.array(portalMessage) }),
  ),
});
export const portalDocuments = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), meta: z.string(), extension: z.string(), available: z.boolean() })),
});
