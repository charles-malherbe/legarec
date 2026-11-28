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
  kind: z.enum(['PDF', 'DOCX', 'PNG', 'JPEG']),
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
/** How a letter leaves, with the label of the screen « Rédiger un courrier ». */
export const composeChannel = z.enum(['EMAIL_PDF', 'EMAIL_SIGNATURE', 'REGISTERED_LETTER', 'LETTER', 'DOWNLOAD']);
export type ComposeChannel = z.infer<typeof composeChannel>;
export const COMPOSE_CHANNELS: Record<ComposeChannel, string> = {
  EMAIL_PDF: 'E-mail avec PDF joint',
  EMAIL_SIGNATURE: 'E-mail avec lien de signature',
  REGISTERED_LETTER: 'Lettre recommandée avec AR (MySendingBox)',
  LETTER: 'Courrier simple (MySendingBox)',
  DOWNLOAD: 'Télécharger seulement',
};
/** Days between two levels of reminder sent from the list (question 220). */
export const REMINDER_GAP_DAYS = 7;
/** An e-mail whose fate is unknown holds its case that long; after that it counts as one that has left (question 220). */
export const UNCERTAIN_BLOCK_HOURS = 48;
/** Cases in one grouped reminder: a page of the list at most. */
export const REMINDER_BATCH_MAX = 100;
/** Why nothing left for a case; the same codes when the API refuses a single sending (409). */
export const sendingRefusal = z.enum([
  'NO_FIRST_LETTER',
  'CONTACT_CAP',
  'OUTSIDE_HOURS',
  'NO_EMAIL',
  'NO_ADDRESS',
  'INDIVIDUAL',
  'NOT_SETTLED',
  'CASE_CLOSED',
  'FIRM_INCOMPLETE',
  'NOT_AVAILABLE',
  'UNKNOWN_RECIPIENT',
  'CASE_DISPUTED',
  'PLAN_RESPECTED',
  'SERVICE_NOT_READY',
  'NO_NEXT_REMINDER',
  'REMINDER_PENDING',
  'TOO_SOON',
  'LEVEL_CHANGED',
  'NO_NEXT_INSTALLMENT',
  'INSTALLMENT_CHANGED',
]);
export type SendingRefusal = z.infer<typeof sendingRefusal>;
export const SENDING_REFUSALS: Record<SendingRefusal, string> = {
  NO_FIRST_LETTER: 'aucun premier courrier postal n’a encore été envoyé pour ce dossier',
  CONTACT_CAP: 'le plafond de contacts de ce débiteur est atteint',
  OUTSIDE_HOURS: 'l’envoi est hors des plages autorisées',
  NO_EMAIL: 'le dossier n’a aucune adresse e-mail utilisable',
  NO_ADDRESS: 'l’adresse postale du débiteur est incomplète',
  INDIVIDUAL: 'les relances par e-mail ne s’adressent pas à un particulier',
  NOT_SETTLED: 'le dossier n’est pas soldé',
  CASE_CLOSED: 'le dossier est clos',
  FIRM_INCOMPLETE: 'des valeurs du cabinet sont encore entre crochets dans Paramètres',
  NOT_AVAILABLE: 'ce mode d’envoi n’est pas encore disponible',
  UNKNOWN_RECIPIENT: 'le destinataire n’est pas une adresse e-mail du dossier',
  CASE_DISPUTED: 'le dossier est en litige ou au contentieux',
  PLAN_RESPECTED: 'l’échéancier du dossier est respecté',
  SERVICE_NOT_READY: 'le service d’envoi n’est pas encore configuré',
  // A grouped reminder never sends the formal notice, nor anything after one (question 220).
  NO_NEXT_REMINDER: 'la relance suivante est une mise en demeure, ou elle est déjà partie : la suite se décide sur la fiche du dossier',
  REMINDER_PENDING: 'une relance de ce dossier est encore en cours d’envoi par le même canal',
  TOO_SOON: `la relance précédente est partie depuis moins de ${REMINDER_GAP_DAYS} jours`,
  LEVEL_CHANGED: 'la relance à envoyer n’est plus celle qui a été confirmée',
  // Reminder of an installment (question 221).
  NO_NEXT_INSTALLMENT: 'l’échéancier n’est pas en cours ou n’a plus d’échéance à venir',
  INSTALLMENT_CHANGED: 'la prochaine échéance n’est plus celle qui a été confirmée',
};
/** Reminder of the next installment of a plan (question 221): the installment shown in the confirmation. */
export const installmentReminderBody = z.object({
  number: z.number().int().min(1).max(60),
  amount: z.number().int().min(1).max(2_000_000_000),
});
/** The code of a channel from the label shown in the list « Envoi ». */
export const composeChannelOf = (label: string): ComposeChannel =>
  (Object.keys(COMPOSE_CHANNELS) as ComposeChannel[]).find((code) => COMPOSE_CHANNELS[code] === label) ?? 'DOWNLOAD';
/** What a grouped sending did: how many left for the queue, and which cases were left out, with the reason. */
export const sendingOutcome = z.object({
  queued: z.number().int().nonnegative(),
  skipped: z.array(z.object({ id: z.string(), reason: sendingRefusal })),
});
export type SendingOutcome = z.infer<typeof sendingOutcome>;
/** What a grouped reminder sends: the two first levels, never the formal notice. */
export const batchTemplate = z.enum(['FRIENDLY', 'FIRM']);
export type BatchTemplate = z.infer<typeof batchTemplate>;
export const BATCH_TEMPLATE_LABELS: Record<BatchTemplate, [one: string, many: string]> = {
  FRIENDLY: ['rappel amiable', 'rappels amiables'],
  FIRM: ['relance ferme', 'relances fermes'],
};
/** Before the confirmation: the reminder each case would receive now, or why it would receive none. */
/**
 * E-mails and registered letters « incertains » for 48 hours at least, that no answer of Resend or MySendingBox has settled:
 * a person decides (Collection manager, or the Director on their cases). Neither address nor text: the case, the debtor,
 * the step and the day it was asked. A letter noted « Partie » never becomes the first letter of the case.
 */
export const uncertainSendings = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      caseId: z.string(),
      reference: z.string(),
      debtor: z.string(),
      channel: z.enum(['EMAIL', 'REGISTERED_LETTER']),
      /** Level of an e-mail; null for the reminder of an installment (question 221), and for a letter. */
      level: z.number().int().min(1).max(3).nullable(),
      /** The letter, for a registered letter; null for an e-mail. */
      letter: z.enum(['FRIENDLY', 'FIRM', 'FORMAL_NOTICE']).nullable(),
      askedAt: z.iso.datetime({ offset: true }),
    }),
  ),
});
export type UncertainSendings = z.infer<typeof uncertainSendings>;
/** « Partie » or « Non partie ». */
export const sendingSettlementBody = z.object({ outcome: z.enum(['SENT', 'NOT_SENT']) });
export const reminderPreview = z.object({
  items: z.array(z.object({ id: z.string(), template: batchTemplate.nullable(), reason: sendingRefusal.nullable() })),
});
export type ReminderPreview = z.infer<typeof reminderPreview>;
/** « 2 non envoyés : le plafond de contacts de ce débiteur est atteint (2) » ; empty when everything left. */
export function skippedText(outcome: SendingOutcome): string {
  if (outcome.skipped.length === 0) return '';
  const counts = new Map<SendingRefusal, number>();
  for (const item of outcome.skipped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  const reasons = [...counts].map(([reason, count]) => `${SENDING_REFUSALS[reason]} (${count})`).join(' ; ');
  return `${outcome.skipped.length} non envoyé${outcome.skipped.length > 1 ? 's' : ''} : ${reasons}`;
}
export const LETTER_TEMPLATES: Record<LetterTemplate, { label: string; hint: string; subject: string; channel: string; slug: string }> = {
  FRIENDLY: {
    label: 'Relance amiable',
    hint: 'Premier rappel courtois',
    subject: 'Rappel – factures impayées',
    channel: COMPOSE_CHANNELS.EMAIL_PDF,
    slug: 'amiable',
  },
  FIRM: {
    label: 'Relance ferme',
    hint: 'Avec indemnités de retard',
    subject: 'Relance – factures impayées',
    channel: COMPOSE_CHANNELS.EMAIL_PDF,
    slug: 'ferme',
  },
  FORMAL_NOTICE: {
    label: 'Mise en demeure',
    hint: 'Dernier avertissement avant procédure',
    subject: 'Mise en demeure de payer',
    channel: COMPOSE_CHANNELS.REGISTERED_LETTER,
    slug: 'demeure',
  },
  PAYMENT_PLAN: {
    label: 'Proposition d’échéancier',
    hint: 'Plan de paiement à signer',
    subject: 'Proposition d’échéancier',
    channel: COMPOSE_CHANNELS.EMAIL_SIGNATURE,
    slug: 'echeancier',
  },
  CLEARANCE: {
    label: 'Attestation de solde',
    hint: 'Confirme le paiement intégral',
    subject: 'Attestation de solde',
    channel: COMPOSE_CHANNELS.EMAIL_PDF,
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
  /** A clearance certificate only leaves for a settled case. */
  settled: z.boolean(),
  /** The last reminder that left, whatever its channel; null when none did. */
  lastReminder: z.iso.date().nullable(),
  firstLetter: z.object({ reference: z.string(), date: z.iso.date() }).nullable(),
  interest: cents,
  invoices: z.array(z.object({ number: z.string(), due: z.iso.date(), amount: cents })),
});
export type LetterRecipient = z.infer<typeof letterRecipient>;
/** The API reads the file, then attaches it to a case its author may act on, or leaves it to be filed. */
export const importedDocument = z.object({ id: z.string(), status: z.enum(['ATTACHED', 'TO_FILE']) });
export const composeData = z.object({
  firm: z.object({ name: z.string(), address: z.string(), phone: z.string(), siren: z.string() }),
  recipients: z.array(letterRecipient),
  /** `withoutFirstLetter`: debtors left out of any reminder that must recall a first letter. */
  batch: z
    .object({
      creditors: z.array(z.object({ id: z.string(), name: z.string() })),
      debtors: z.number().int(),
      invoices: z.number().int(),
      amount: cents,
      withoutFirstLetter: z.number().int(),
    })
    .nullable(),
});
export type ComposeData = z.infer<typeof composeData>;

/** The 40 € fixed indemnity only concerns professional debtors, never an individual. */
export const fixedIndemnity = (recipient: Pick<LetterRecipient, 'isIndividual' | 'invoices'>) =>
  recipient.isIndividual ? 0 : recipient.invoices.length * 4000;
export function letterTotals(recipient: LetterRecipient, withIndemnity: boolean) {
  const principal = recipient.invoices.reduce((sum, item) => sum + item.amount, 0);
  const indemnity = withIndemnity ? fixedIndemnity(recipient) : 0;
  return { principal, interest: recipient.interest, indemnity, total: principal + recipient.interest + indemnity };
}
/** The amount claimed by a letter: interest only appears in a formal notice. */
export function letterAmount(template: LetterTemplate, recipient: LetterRecipient, withIndemnity: boolean) {
  const { principal, indemnity, total } = letterTotals(recipient, withIndemnity && (template === 'FIRM' || template === 'FORMAL_NOTICE'));
  return template === 'FORMAL_NOTICE' ? total : principal + indemnity;
}
/**
 * The amount an e-mail reminder announces (question 213), as the letters of the same name: the principal left, the
 * indemnities from the firm reminder on (level 2), interest in the formal notice only (level 3).
 */
export const reminderAmount = (level: number, owed: { principal: number; fees: number; interest: number }) =>
  owed.principal + (level >= 2 ? owed.fees : 0) + (level >= 3 ? owed.interest : 0);
export const letterSchedule = (total: number, months: number) =>
  splitPlan(total, months).map((amount, index) => ({ date: new Date(Date.UTC(2026, 11 + index, 15)).toISOString().slice(0, 10), amount }));
