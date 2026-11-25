import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** National format for display, international format for `tel:` links. */
export function formatPhone(input: string): { national: string; international: string } {
  const number = parsePhoneNumberFromString(input, 'FR');
  if (!number?.isValid()) throw new Error('Invalid phone number');
  return { national: number.formatNational(), international: number.number };
}
