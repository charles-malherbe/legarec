import { z } from 'zod';
import { caseStatus } from './dashboard';
import { FRENCH_PHONE } from './communication';
import { isValidIban, isValidSiren } from './firm';
import { atMost, EMAIL_MAX, ID_MAX, NUMBER_MAX } from './limits';
import { cents, enteredAmount } from './money';

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

// ---------------------------------------------------------------- Creditor and mandate (validated proposal 1)

const line = (max: number, error: string) => z.string().trim().min(1, { error }).max(max, atMost(max));
const optional = (max: number) => z.string().trim().max(max, atMost(max));
/** Basis points: 8 % is 800. */
const rate = z.number().int().min(0, { error: 'Entre 0 et 100 %.' }).max(10_000, { error: 'Entre 0 et 100 %.' });
export const PLAN_MONTHS = [3, 6, 12] as const;
export const mandateInterest = z.enum(['ECB_PLUS_TEN', 'CONTRACT', 'NONE']);
export const MANDATE_INTEREST_LABELS: Record<z.infer<typeof mandateInterest>, string> = {
  ECB_PLUS_TEN: 'Taux BCE majoré de 10 points',
  CONTRACT: 'Taux prévu au contrat du créancier',
  NONE: 'Aucun',
};
export const scenarioCode = z.enum(['BUSINESS', 'CONSUMER', 'KEY_ACCOUNTS']);
export const SCENARIO_LABELS: Record<z.infer<typeof scenarioCode>, string> = {
  BUSINESS: 'Professionnels (B2B), standard',
  CONSUMER: 'Particuliers (B2C)',
  KEY_ACCOUNTS: 'Grands comptes',
};

export const creditorIdentity = z.object({
  legalName: line(150, 'Indiquez la raison sociale.'),
  name: line(150, 'Indiquez le nom affiché.'),
  sector: optional(120),
  vatNumber: z
    .string()
    .trim()
    .max(NUMBER_MAX, atMost(NUMBER_MAX))
    .refine((value) => value === '' || /^FR[A-Z\d]{2}\d{9}$/u.test(value.replace(/\s/gu, '').toUpperCase()), {
      error: 'Ce n° de TVA n’est pas valide (FR, 2 caractères, 9 chiffres).',
    }),
  address: line(300, 'Indiquez l’adresse.'),
  postalCode: z.string().regex(/^\d{5}$/u, { error: 'Le code postal comporte 5 chiffres.' }),
  city: line(120, 'Indiquez la ville.'),
  managerId: z.string().max(ID_MAX).nullable(),
  portalEnabled: z.boolean(),
});
export const creditorContact = z.object({
  name: line(120, 'Indiquez le nom.'),
  title: optional(120),
  email: z.email({ error: 'Adresse e-mail invalide, par exemple nom@entreprise.fr.' }).max(EMAIL_MAX, atMost(EMAIL_MAX)),
  phone: z
    .string()
    .trim()
    .max(30, atMost(30))
    .refine((value) => value === '' || FRENCH_PHONE.test(value), { error: 'Numéro français attendu, par exemple 06 12 34 56 78 ou +33 6 12 34 56 78.' }),
  isMain: z.boolean(),
});
export const creditorContacts = z
  .array(creditorContact)
  .min(1, { error: 'Ajoutez au moins un interlocuteur.' })
  .max(20)
  .refine((items) => items.filter((item) => item.isMain).length === 1, { error: 'Choisissez un interlocuteur principal.' });

const terms = z.object({
  amicableRateBp: rate,
  litigationRateBp: rate,
  openingFeeCents: enteredAmount.min(0, { error: 'Ce montant ne peut pas être négatif.' }),
  planMonthsWithoutConsent: z.union([z.literal(3), z.literal(6), z.literal(12)]),
  discountMaxBp: rate,
  litigationNeedsConsent: z.boolean(),
  deferSmallRemittances: z.boolean(),
  interestMode: mandateInterest,
  contractRateBp: rate.nullable(),
  fixedIndemnity: z.boolean(),
  reportingDay: z.number().int().min(1, { error: 'Un jour de 1 à 28.' }).max(28, { error: 'Un jour de 1 à 28.' }),
  scenario: scenarioCode,
});
const dated = terms.extend({
  startsOn: z.iso.date({ error: 'Indiquez la date d’effet.' }),
  endsOn: z.iso.date({ error: 'Cette date n’est pas valide.' }).nullable(),
});
type Dated = z.infer<typeof dated>;
const consistent = <T extends z.ZodType<Dated>>(schema: T) =>
  schema
    .refine((value) => (value.interestMode === 'CONTRACT') === (value.contractRateBp !== null), {
      path: ['contractRateBp'],
      error: 'Indiquez le taux du contrat.',
    })
    .refine((value) => value.endsOn === null || value.endsOn >= value.startsOn, { path: ['endsOn'], error: 'La fin doit suivre la date d’effet.' });
export const mandateForm = consistent(dated);
export type MandateForm = z.infer<typeof mandateForm>;

export const bankAccountForm = z.object({
  holder: line(150, 'Indiquez le titulaire.'),
  iban: z.string().max(50).refine(isValidIban, { error: 'Cet IBAN n’est pas valide.' }),
  bic: z
    .string()
    .max(NUMBER_MAX, atMost(NUMBER_MAX))
    .refine((value) => /^[A-Z]{6}[A-Z\d]{2}(?:[A-Z\d]{3})?$/u.test(value.replace(/\s/gu, '').toUpperCase()), {
      error: 'Ce BIC n’est pas valide (8 ou 11 caractères).',
    }),
  /** Who confirmed it, at a number already known; empty while it is not. Nothing is remitted before. */
  confirmedWith: optional(120),
});

export const newCreditor = z.object({
  siren: z.string().max(NUMBER_MAX, atMost(NUMBER_MAX)).refine(isValidSiren, { error: 'Ce SIREN n’est pas valide (9 chiffres).' }),
  identity: creditorIdentity,
  contacts: creditorContacts,
  mandate: mandateForm,
});
export type NewCreditor = z.infer<typeof newCreditor>;
/** With the version that was read: refused when someone else has changed it since. */
export const creditorChanges = z.object({ version: z.number().int().positive().max(1_000_000), identity: creditorIdentity, contacts: creditorContacts });
/** With the mandate it amends: refused when another one took its place. */
export const mandateAmendment = z.object({ amends: z.string().max(ID_MAX), mandate: mandateForm });
/** Recorded by itself, by the Director or by the manager on their behalf. With the account it replaces, null for the first one. */
export const bankAccountChange = z.object({ replaces: z.string().max(ID_MAX).nullable(), account: bankAccountForm });
export const bankAccountConfirmation = z.object({ confirmedWith: line(120, 'Indiquez avec qui.') });

const mandateVersion = dated.extend({ id: z.string(), state: z.enum(['CURRENT', 'TO_COME', 'ENDED']), hasContract: z.boolean() });
export type MandateVersion = z.infer<typeof mandateVersion>;
/** What the screen « Créancier et mandat » needs to change one. */
export const creditorFile = z.object({
  id: z.string(),
  version: z.number().int(),
  siren: z.string(),
  /** As recorded: one that was created before this screen may lack some of it. */
  identity: z.object({
    legalName: z.string(),
    name: z.string(),
    sector: z.string(),
    vatNumber: z.string(),
    address: z.string(),
    postalCode: z.string(),
    city: z.string(),
    managerId: z.string().nullable(),
    portalEnabled: z.boolean(),
  }),
  contacts: z.array(creditorContact),
  mandates: z.array(mandateVersion),
  /** Open cases, which keep their terms whatever the amendment. */
  openCases: z.number().int(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
  bankAccess: z.enum(['EDIT', 'NONE']),
  bankAccount: z
    .object({
      id: z.string(),
      holder: z.string(),
      masked: z.string(),
      bic: z.string(),
      since: z.iso.date(),
      confirmed: z.object({ on: z.iso.date(), with: z.string() }).nullable(),
    })
    .nullable(),
});
export type CreditorFile = z.infer<typeof creditorFile>;
export const creditorCreated = z.object({ id: z.string() });
export const revealedIban = z.object({ iban: z.string() });
/** Choices of the form. */
export const creditorChoices = z.object({
  managers: z.array(z.object({ id: z.string(), name: z.string() })),
  bankAccess: z.enum(['EDIT', 'NONE']),
  defaults: z.object({ amicableRateBp: rate }),
});
