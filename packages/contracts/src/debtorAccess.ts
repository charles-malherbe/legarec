import { z } from 'zod';

const luhn = (digits: string) =>
  [...digits].reverse().reduce((sum, char, index) => {
    const value = Number(char) * (index % 2 === 1 ? 2 : 1);
    return sum + (value > 9 ? value - 9 : value);
  }, 0) %
    10 ===
  0;

/** La Poste (SIREN 356000000) uses a plain digit sum instead of Luhn for its branches. */
export function isValidSiret(input: string): boolean {
  const digits = input.replace(/\s/g, '');
  if (!/^\d{14}$/.test(digits)) return false;
  if (luhn(digits)) return true;
  return digits.startsWith('356000000') && [...digits].reduce((sum, char) => sum + Number(char), 0) % 5 === 0;
}

export const sirenOf = (siret: string) => siret.replace(/\s/g, '').slice(0, 9);

/** Four uppercase letters without I nor O; lowercase input is accepted. */
export const accessCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z]{4}$/, { error: 'Le code comporte 4 lettres, sans I ni O.' });
