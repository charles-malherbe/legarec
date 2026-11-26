import { z } from 'zod';
import { atMost, EMAIL_MAX, ID_MAX } from './limits';

const tone = z.enum(['neutral', 'info', 'success', 'warning', 'danger', 'teal', 'violet', 'marine', 'or']);
export const settingField = z.object({
  id: z.string(),
  kind: z.enum(['text', 'select', 'switch', 'value']),
  label: z.string(),
  description: z.string(),
  value: z.string(),
  checked: z.boolean(),
  options: z.array(z.string()),
  locked: z.boolean(),
  status: z.string().nullable(),
  statusTone: tone,
});
export type SettingField = z.infer<typeof settingField>;
export const settingTable = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.object({ text: z.string(), tone })]))),
});
export type SettingTable = z.infer<typeof settingTable>;
export const settingsHub = z.object({
  canEdit: z.boolean(),
  groups: z.array(
    z.object({
      label: z.string(),
      tiles: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), icon: z.string(), status: z.string(), statusTone: tone })),
    }),
  ),
});
export type SettingsHub = z.infer<typeof settingsHub>;
export const settingsSection = z.object({
  id: z.string(),
  /** Of what is shown: sent back with a change. */
  version: z.number().int(),
  canEdit: z.boolean(),
  blocks: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), fields: z.array(settingField) })),
  tables: z.array(settingTable),
  notes: z.array(z.string()),
});
export const settingsVersionQuery = z.object({
  version: z
    .string()
    .regex(/^\d{1,9}$/u)
    .transform(Number),
});
export type SettingsSection = z.infer<typeof settingsSection>;

/** Keys of the services, by the name the API looks for: nothing else is stored (question 110). */
export const SERVICE_SECRETS = {
  RESEND_API_KEY: 'Resend',
  RESEND_ACCOUNT_API_KEY: 'Resend (e-mails de compte)',
  RESEND_WEBHOOK_SECRET: 'Resend (webhooks)',
  MYSENDINGBOX_API_KEY: 'MySendingBox (lettres recommandées)',
  MYSENDINGBOX_TEST_API_KEY: 'MySendingBox (test)',
  S3_ACCESS_KEY: 'OVHcloud Object Storage (fichiers)',
  S3_SECRET_KEY: 'OVHcloud Object Storage (fichiers)',
  OVH_API_APP_KEY: 'API OVHcloud (boîtes e-mail)',
  OVH_API_APP_SECRET: 'API OVHcloud (boîtes e-mail)',
  OVH_API_CONSUMER_KEY: 'API OVHcloud (boîtes e-mail)',
  OVH_SMS_APP_KEY: 'OVHcloud SMS',
  OVH_SMS_APP_SECRET: 'OVHcloud SMS',
  OVH_SMS_CONSUMER_KEY: 'OVHcloud SMS',
  OVH_SMS_SERVICE_NAME: 'OVHcloud SMS',
  COLLECTION_MAILBOX_PASSWORD: 'Boîte recouvrement@ (lecture)',
  TCX_API_CLIENT_ID: '3CX (API Call Control)',
  TCX_API_CLIENT_SECRET: '3CX (API Call Control)',
  AI_API_KEY: 'IA',
} as const;
export type ServiceSecret = keyof typeof SERVICE_SECRETS;
/** Drawn by the API: renewed, never typed nor revoked (question 108). */
export const INTERNAL_SECRETS = {
  MAILBOX_SECRETS_KEY: 'Boîtes OVH (chiffrement des mots de passe)',
  ACCESS_CODE_KEY: 'Codes d’accès (chiffrement)',
  LOOKUP_KEY: 'Liens et identifiants (empreintes)',
} as const;
export type InternalSecret = keyof typeof INTERNAL_SECRETS;
const names = <T extends object>(of: T) => Object.keys(of) as [keyof T & string, ...(keyof T & string)[]];
export const serviceSecret = z.enum(names(SERVICE_SECRETS), { error: 'Choisissez le secret.' });
const secretName = z.enum([...names(SERVICE_SECRETS), ...names(INTERNAL_SECRETS)]);
const secretValue = z.string().min(1, { error: 'Saisissez la valeur.' }).max(4096, atMost(4096));

/** Secrets are write-only: the API never returns any part of a value. */
export const secretItem = z.object({
  id: z.string(),
  name: secretName,
  internal: z.boolean(),
  service: z.string(),
  environment: z.string(),
  used: z.string(),
  rotated: z.string(),
  status: z.enum(['VALID', 'EXPIRING', 'REVOKE_PENDING', 'REVOKED']),
});
export type SecretItem = z.infer<typeof secretItem>;
export const secretsData = z.object({ items: z.array(secretItem) });
export const newSecret = z.object({
  name: serviceSecret,
  value: secretValue,
  rotation: z.enum(['90', '30', 'MANUAL']),
});

/** The new value, created at the service and pasted here (question 109); none for an internal key, which the API draws. */
export const renewedSecret = z.object({ value: secretValue.optional() });

export const mailbox = z.object({
  id: z.string(),
  address: z.email(),
  holder: z.string().nullable(),
  kind: z.enum(['MEMBER', 'FUNCTION', 'SHARED']),
  usedMb: z.number().int(),
  sizeMb: z.number().int(),
  connection: z.enum(['OK', 'PASSWORD_NEEDED', 'ERROR']),
  protected: z.boolean(),
  redirections: z.array(z.object({ id: z.string(), to: z.email() })),
  autoReply: z.object({ text: z.string(), until: z.string().nullable() }).nullable(),
});
export type Mailbox = z.infer<typeof mailbox>;
export const mailboxesData = z.object({
  items: z.array(mailbox),
  sizes: z.array(z.number().int()),
  holders: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Mailboxes asked for when a collaborator was invited. */
  requests: z.array(z.object({ id: z.string(), holder: z.string(), local: z.string(), requestedBy: z.string() })),
  history: z.array(z.object({ id: z.string(), when: z.string(), who: z.string(), onBehalfOf: z.string().nullable(), what: z.string() })),
});
/** Generated by the API and returned once, never again. */
export const issuedPassword = z.object({ password: z.string() });
/** Shared and technical addresses: never the mailbox nor the login of one person. */
const RESERVED = ['recouvrement', 'administratif', 'dpo', 'support', 'contact', 'ne-pas-repondre', 'no-reply', 'postmaster', 'abuse', 'admin', 'root'];
export const isReservedAddress = (local: string) => RESERVED.includes(local.trim().toLowerCase());
export const newMailbox = z
  .object({
    local: z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{0,30}[a-z0-9])?$/u, { error: 'Lettres minuscules, chiffres, point ou tiret, par exemple cl.' }),
    holderId: z.string().max(ID_MAX).nullable(),
    sizeMb: z.number().int().positive().max(1_000_000),
  })
  .refine((value) => value.local !== 'recouvrement' && (value.holderId === null || !isReservedAddress(value.local)), {
    path: ['local'],
    error: 'Cette adresse est réservée au cabinet.',
  });
export const redirectionTarget = z.email({ error: 'Saisissez une adresse e-mail valide.' }).max(EMAIL_MAX, atMost(EMAIL_MAX));

export const gdprRegistry = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      receivedOn: z.string(),
      dueOn: z.string(),
      daysLeft: z.number().int(),
      kind: z.enum(['ACCESS', 'RECTIFICATION', 'OBJECTION', 'ERASURE']),
      debtor: z.string(),
      caseId: z.string(),
      origin: z.string(),
      status: z.enum(['OPEN', 'ANSWERED', 'REFUSED']),
    }),
  ),
});
export type GdprRequest = z.infer<typeof gdprRegistry>['items'][number];
export const gdprExport = z.object({ fileName: z.string(), content: z.unknown() });
/** What an erasure would anonymize, and what stands in its way (article 17.3 of the RGPD). */
export const gdprErasureBlocker = z.enum(['OPEN_CASE', 'PAYMENT_PENDING', 'NOT_REMITTED', 'REQUEST_CLOSED']);
/**
 * `digest`: a fingerprint of the cases shown, sent back with the confirmation. `homonyms`: other individuals with the same
 * name, never put together with this one (a line per creditor may be the same person), only counted; `warning` says it.
 */
export const gdprErasure = z.object({
  cases: z.number().int(),
  digest: z.string(),
  blockers: z.array(gdprErasureBlocker),
  homonyms: z.number().int(),
  warning: z.string().nullable(),
});

/** The journal of the assistant (Paramètres › Assistant IA): Director and Developer only (question 178). */
export const AI_JOURNAL_PAGE = 25;
export const aiJournalQuery = z.object({
  page: z
    .string()
    .regex(/^\d{1,5}$/u)
    .transform(Number)
    .refine((page) => page >= 1)
    .optional(),
  /** Lines per page, as the other lists offer them. */
  size: z.enum(['25', '50', '100']).transform(Number).optional(),
});
export const AI_FEATURE_LABELS = { CASE_SUMMARY: 'Synthèse du dossier' } as const;
export const AI_OUTCOME_LABELS = {
  SUGGESTED: 'Proposée',
  REFUSED_BY_GUARD: 'Refusée par un garde-fou',
  FAILED: 'Échec',
  OVER_BUDGET: 'Budget atteint',
} as const;
export const AI_DECISION_LABELS = {
  PENDING: 'En attente',
  ACCEPTED: 'Acceptée',
  MODIFIED: 'Modifiée',
  IGNORED: 'Ignorée',
  REPORTED: 'Signalée',
} as const;
export const aiJournal = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      feature: z.enum(['CASE_SUMMARY']),
      /** Null for whoever may not read the case (the Developer). */
      caseReference: z.string().nullable(),
      /** What was sent, in short: counts, never the text. */
      input: z.string(),
      model: z.string().nullable(),
      promptVersion: z.string(),
      outcome: z.enum(['SUGGESTED', 'REFUSED_BY_GUARD', 'FAILED', 'OVER_BUDGET']),
      decision: z.enum(['PENDING', 'ACCEPTED', 'MODIFIED', 'IGNORED', 'REPORTED']),
      /** Who decided, or who asked; null when the application made it after an event and nobody has decided yet. */
      colleague: z.string().nullable(),
      tokens: z.number().int().nonnegative(),
      /** In millionths of a euro. */
      costMicro: z.number().int().nonnegative(),
    }),
  ),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  /** The last 30 days: suggestions made, and how they were decided. */
  last30Days: z.object({
    suggested: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative(),
    reported: z.number().int().nonnegative(),
  }),
});
export type AiJournal = z.infer<typeof aiJournal>;
export type AiJournalEntry = AiJournal['items'][number];
/** `0,0042 €`: the cost of a call, in euros. */
export const formatMicroEuros = (micro: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(micro / 1_000_000);
