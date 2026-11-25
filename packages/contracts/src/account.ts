import { z } from 'zod';
import { newPassword, PASSWORD_MAX } from './auth';
import { atMost, ID_MAX, NAME_MAX } from './limits';

export const accountSession = z.object({ id: z.string(), device: z.string(), meta: z.string(), mobile: z.boolean(), current: z.boolean() });
export type AccountSession = z.infer<typeof accountSession>;
/** Events a collaborator may be told of, with what is on at first. All of them concern cases: none for the Developer. */
export const NOTIFICATION_KINDS = [
  { id: 'payment', label: 'Paiement reçu', detail: 'Virement rapproché ou chèque encaissé', inApp: true, email: true },
  { id: 'promise', label: 'Promesse non tenue', detail: 'Le jour suivant la date promise', inApp: true, email: true },
  { id: 'message', label: 'Réponse d’un débiteur', detail: 'E-mail, SMS ou message de l’espace débiteur', inApp: true, email: false },
  { id: 'deadline', label: 'Délai judiciaire proche', detail: '10 jours, 3 jours et la veille', inApp: true, email: true },
  { id: 'creditor', label: 'Décision d’un créancier', detail: 'Accord ou refus d’échéancier, de contentieux', inApp: true, email: true },
  { id: 'failure', label: 'Échec d’envoi', detail: 'E-mail rejeté, SMS non distribué', inApp: true, email: false },
  { id: 'import', label: 'Import de factures terminé', detail: 'Nouvelles créances confiées', inApp: true, email: false },
  { id: 'mention', label: 'Mention par un collègue', detail: 'Dans une note de dossier', inApp: true, email: true },
] as const;
export const notificationPreference = z.object({ id: z.string(), label: z.string(), detail: z.string(), inApp: z.boolean(), email: z.boolean() });
export const accountData = z.object({
  signature: z.array(z.string()),
  absence: z.object({ substituteId: z.string(), from: z.string(), to: z.string(), autoReply: z.boolean() }),
  substitutes: z.array(z.object({ id: z.string(), name: z.string() })),
  passwordChangedOn: z.string(),
  twoFactor: z.object({ enabled: z.boolean(), method: z.enum(['TOTP', 'WEBAUTHN']).nullable(), mandatory: z.boolean(), since: z.string().nullable() }),
  sessions: z.array(accountSession),
  notifications: z.array(notificationPreference),
  dailySummary: z.boolean(),
  quietHours: z.boolean(),
});
export type AccountData = z.infer<typeof accountData>;
export const profileForm = z.object({
  firstName: z.string().trim().min(1, { error: 'Saisissez votre prénom.' }).max(NAME_MAX, atMost(NAME_MAX)),
  lastName: z.string().trim().min(1, { error: 'Saisissez votre nom.' }).max(NAME_MAX, atMost(NAME_MAX)),
});
const day = z.union([z.literal(''), z.iso.date()]);
export const absenceForm = z
  .object({ substituteId: z.string().max(ID_MAX), from: day, to: day, autoReply: z.boolean() })
  .refine((value) => !value.from || !value.to || value.from <= value.to, { path: ['to'], error: 'La fin doit suivre le début.' });
export const passwordForm = z.object({
  current: z.string().min(1, { error: 'Saisissez votre mot de passe actuel.' }).max(PASSWORD_MAX, atMost(PASSWORD_MAX)),
  next: newPassword.regex(/\d/u, { error: 'Ajoutez au moins un chiffre.' }).regex(/[^\p{L}\d\s]/u, { error: 'Ajoutez au moins un caractère spécial.' }),
});
export const totpSetup = z.object({ uri: z.string(), key: z.string() });
export type TotpSetup = z.infer<typeof totpSetup>;
/** Opaque WebAuthn creation options, passed as is to the browser. */
export const webauthnOptions = z.looseObject({ challenge: z.string() });
export const delegationsData = z.object({ technical: z.boolean(), administrative: z.boolean(), developer: z.string(), manager: z.string() });
export const supportTicket = z.object({
  subject: z.string().max(200, atMost(200)),
  message: z.string().trim().min(10, { error: 'Décrivez votre question en quelques mots.' }).max(5000, atMost(5000)),
});
export const ticketSent = z.object({ number: z.string() });
