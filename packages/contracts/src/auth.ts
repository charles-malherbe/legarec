import { z } from 'zod';
import { atMost, EMAIL_MAX } from './limits';
import { role, session } from './roles';

/** Beyond, the hash would cost more than the password protects. */
export const PASSWORD_MAX = 200;
export const loginRequest = z.object({
  email: z.email({ error: 'Saisissez une adresse e-mail valide.' }).max(EMAIL_MAX, atMost(EMAIL_MAX)),
  password: z.string().min(1, { error: 'Saisissez votre mot de passe.' }).max(PASSWORD_MAX, atMost(PASSWORD_MAX)),
  portal: z.enum(['espace', 'partenaires']),
});
export const loginResponse = z.discriminatedUnion('status', [
  // `session` is only sent to the staff portal; the creditors' portal reads /auth/session.
  z.object({ status: z.literal('OK'), session: session.nullable() }),
  z.object({ status: z.literal('TWO_FACTOR'), methods: z.array(z.enum(['TOTP', 'WEBAUTHN'])) }),
  // Required of this account, which has none yet: set up before anything else.
  z.object({ status: z.literal('SETUP_REQUIRED') }),
  z.object({ status: z.literal('WRONG_PORTAL'), portal: z.enum(['espace', 'partenaires']), url: z.string() }),
]);
export const loginError = z.object({
  /** UNAUTHORIZED: too late, the password has to be given again. */
  code: z.enum(['INVALID_CREDENTIALS', 'LOCKED', 'INVALID_CODE', 'TOO_MANY', 'UNAUTHORIZED']),
  attemptsLeft: z.number().int().optional(),
});
export type LoginResponse = z.infer<typeof loginResponse>;
/** Eight codes, shown once; empty when the account still has some. */
export const backupCodes = z.object({ backupCodes: z.array(z.string()) });
export const setupDone = backupCodes.extend({ session: session.nullable() });

/** Holder of a link of reset or of invitation. */
export const linkInfo = z.object({
  email: z.email(),
  firstName: z.string(),
  invitedBy: z.string().optional(),
  role: role.optional(),
  twoFactorRequired: z.boolean(),
});
export type LinkInfo = z.infer<typeof linkInfo>;
export const totpKey = z.object({ totpKey: z.string() });

const TOO_SHORT = { error: 'Le mot de passe doit comporter au moins 12 caractères.' };
/** Spaces around it do not count. */
export const newPassword = z
  .string()
  .min(12, TOO_SHORT)
  .max(PASSWORD_MAX, atMost(PASSWORD_MAX))
  .refine((value) => value.trim().length >= 12, TOO_SHORT);
