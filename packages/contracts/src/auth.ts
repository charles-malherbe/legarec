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

/** Asked again before what matters most, when the last proof is older than that (questions 122 and 134). */
export const PROOF_MINUTES = 10;
export const proofMethod = z.enum(['PASSWORD', 'TOTP', 'WEBAUTHN']);
export const proofNeeded = z.object({ methods: z.array(proofMethod).min(1) });
/** LOCKED: whether the session was closed with it. */
export const proofError = z.object({
  code: z.enum(['INVALID_PROOF', 'LOCKED', 'TOO_MANY', 'INVALID', 'UNAUTHORIZED']),
  attemptsLeft: z.number().int().optional(),
  closed: z.boolean().optional(),
});
/**
 * Actions that need a recent proof, as the window names them. Those that are not always sensitive are decided by the API:
 * a setting that identifies the firm, a second factor added to another one.
 */
export const SENSITIVE_ACTIONS = {
  'DELETE /account/two-factor': 'Retirer la double authentification',
  'POST /account/two-factor/totp': 'Ajouter une application d’authentification',
  'POST /account/two-factor/totp/verify': 'Ajouter une application d’authentification',
  'POST /account/two-factor/webauthn': 'Ajouter une clé de sécurité',
  'POST /account/two-factor/webauthn/verify': 'Ajouter une clé de sécurité',
  'POST /members/:id/reset-2fa': 'Réinitialiser la double authentification d’un collaborateur',
  'PUT /members/:id/role': 'Changer le rôle d’un collaborateur',
  'PUT /delegations/:kind': 'Donner ou retirer une délégation',
  'PUT /settings/:scope/:id': 'Modifier les identifiants du cabinet',
  'POST /creditors/:id/bank-accounts': 'Enregistrer le compte de reversement d’un créancier',
  'POST /secrets': 'Ajouter un secret',
  'POST /secrets/:id/rotate': 'Renouveler un secret',
  'POST /secrets/:id/revoke': 'Révoquer un secret',
} as const;
export type SensitiveAction = keyof typeof SENSITIVE_ACTIONS;
/** Model of a real path; null when it is not one of them. */
export function sensitiveAction(method: string, path: string): SensitiveAction | null {
  const parts = path.split('?')[0]!.split('/').filter(Boolean);
  const found = (Object.keys(SENSITIVE_ACTIONS) as SensitiveAction[]).find((key) => {
    const [verb, model = ''] = key.split(' ');
    const expected = model.split('/').filter(Boolean);
    return verb === method && expected.length === parts.length && expected.every((part, index) => part.startsWith(':') || part === parts[index]);
  });
  return found ?? null;
}

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
