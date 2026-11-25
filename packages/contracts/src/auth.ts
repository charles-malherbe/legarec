import { z } from 'zod';
import { session } from './roles';

export const loginRequest = z.object({
  email: z.email({ error: 'Saisissez une adresse e-mail valide.' }),
  password: z.string().min(1, { error: 'Saisissez votre mot de passe.' }),
  portal: z.enum(['espace', 'partenaires']),
});
export const loginResponse = z.discriminatedUnion('status', [
  // `session` is only sent to the staff portal; the creditors' portal reads /auth/session.
  z.object({ status: z.literal('OK'), session: session.nullable() }),
  z.object({ status: z.literal('TWO_FACTOR'), methods: z.array(z.enum(['TOTP', 'WEBAUTHN'])) }),
  z.object({ status: z.literal('WRONG_PORTAL'), portal: z.enum(['espace', 'partenaires']), url: z.string() }),
]);
export const loginError = z.object({ code: z.enum(['INVALID_CREDENTIALS', 'LOCKED', 'INVALID_CODE']), attemptsLeft: z.number().int().optional() });
export type LoginResponse = z.infer<typeof loginResponse>;

export const newPassword = z.string().min(12, { error: 'Le mot de passe doit comporter au moins 12 caractères.' });
