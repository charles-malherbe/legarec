import { z } from 'zod';
import { luhn } from './debtorAccess';

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

/** Only these values are still to be supplied: any other text between brackets is refused. */
const orPlaceholder = (placeholder: string, check: (value: string) => boolean, error: string) =>
  z.string().refine((value) => value === placeholder || check(value), { error });
const named = (placeholder: string, error: string) => orPlaceholder(placeholder, (value) => value.trim().length >= 2 && !/[[\]]/u.test(value), error);
/** Identity and bank details of the firm, typed by the Director only. */
export const firmIdentity = z.object({
  siren: orPlaceholder('[SIREN]', isValidSiren, 'Ce SIREN n’est pas valide (9 chiffres).'),
  vat: orPlaceholder('[N° TVA]', (value) => /^FR[A-Z\d]{2}\d{9}$/u.test(compact(value)), 'Ce n° de TVA n’est pas valide (FR, 2 caractères, 9 chiffres).'),
  iban: orPlaceholder('[IBAN DU COMPTE DÉDIÉ]', isValidIban, 'Cet IBAN n’est pas valide.'),
  bic: orPlaceholder('[BIC]', (value) => /^[A-Z]{4}[A-Z]{2}[A-Z\d]{2}(?:[A-Z\d]{3})?$/u.test(compact(value)), 'Ce BIC n’est pas valide (8 ou 11 caractères).'),
  holder: named('[TITULAIRE DU COMPTE]', 'Indiquez le titulaire du compte.'),
  bankName: named('[BANQUE]', 'Indiquez la banque.'),
  chequePayee: named('[ORDRE DES CHÈQUES]', 'Indiquez l’ordre des chèques.'),
  chequeAddress: named('[ADRESSE D’ENVOI DES CHÈQUES]', 'Indiquez l’adresse d’envoi des chèques.'),
});
export const FIRM_IDENTITY_FIELDS = Object.keys(firmIdentity.shape) as (keyof typeof firmIdentity.shape)[];
