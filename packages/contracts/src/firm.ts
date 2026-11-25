import { z } from 'zod';

const luhn = (digits: string) =>
  [...digits].reverse().reduce((sum, char, index) => {
    const value = Number(char) * (index % 2 === 1 ? 2 : 1);
    return sum + (value > 9 ? value - 9 : value);
  }, 0) %
    10 ===
  0;
const compact = (value: string) => value.replace(/\s/g, '').toUpperCase();

/** International control key of an IBAN. */
export function isValidIban(input: string): boolean {
  const iban = compact(input);
  if (!/^[A-Z]{2}\d{2}[A-Z\d]{11,30}$/u.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/gu, (char) => String(char.charCodeAt(0) - 55));
  let rest = 0;
  for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  return rest === 1;
}
export const isValidSiren = (input: string) => /^\d{9}$/u.test(compact(input)) && luhn(compact(input));

/** A value between brackets is still to be supplied: it is kept as it is. */
const orPlaceholder = (check: (value: string) => boolean, error: string) => z.string().refine((value) => /^\[.+\]$/u.test(value) || check(value), { error });
/** Identity and bank details of the firm, typed by the Director only. */
export const firmIdentity = z.object({
  siren: orPlaceholder(isValidSiren, 'Ce SIREN n’est pas valide (9 chiffres).'),
  vat: orPlaceholder((value) => /^FR[A-Z\d]{2}\d{9}$/u.test(compact(value)), 'Ce n° de TVA n’est pas valide (FR, 2 caractères, 9 chiffres).'),
  iban: orPlaceholder(isValidIban, 'Cet IBAN n’est pas valide.'),
  bic: orPlaceholder((value) => /^[A-Z]{4}[A-Z]{2}[A-Z\d]{2}(?:[A-Z\d]{3})?$/u.test(compact(value)), 'Ce BIC n’est pas valide (8 ou 11 caractères).'),
});
export const FIRM_IDENTITY_FIELDS = Object.keys(firmIdentity.shape) as (keyof typeof firmIdentity.shape)[];
