import { z } from 'zod';
import { newPassword } from './auth';

export const accountSession = z.object({ id: z.string(), device: z.string(), meta: z.string(), mobile: z.boolean(), current: z.boolean() });
export type AccountSession = z.infer<typeof accountSession>;
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
  firstName: z.string().trim().min(1, { error: 'Saisissez votre prénom.' }),
  lastName: z.string().trim().min(1, { error: 'Saisissez votre nom.' }),
});
export const absenceForm = z
  .object({ substituteId: z.string(), from: z.string(), to: z.string(), autoReply: z.boolean() })
  .refine((value) => !value.from || !value.to || value.from <= value.to, { path: ['to'], error: 'La fin doit suivre le début.' });
export const passwordForm = z.object({
  current: z.string().min(1, { error: 'Saisissez votre mot de passe actuel.' }),
  next: newPassword.regex(/\d/u, { error: 'Ajoutez au moins un chiffre.' }).regex(/[^\p{L}\d\s]/u, { error: 'Ajoutez au moins un caractère spécial.' }),
});
export const totpSetup = z.object({ uri: z.string(), key: z.string() });
/** Opaque WebAuthn creation options, passed as is to the browser. */
export const webauthnOptions = z.looseObject({ challenge: z.string() });
export const delegationsData = z.object({ technical: z.boolean(), administrative: z.boolean(), developer: z.string(), manager: z.string() });
export const supportTicket = z.object({ subject: z.string(), message: z.string().trim().min(10, { error: 'Décrivez votre question en quelques mots.' }) });
export const ticketSent = z.object({ number: z.string() });
