import { z } from 'zod';

/** Amount in integer cents. Never a float. */
export const cents = z.number().int();
export type Cents = z.infer<typeof cents>;

/** What the database holds for one amount: 20 million euros. A total may go beyond. */
export const AMOUNT_MAX = 2_000_000_000;
/** Amount typed by someone. */
export const enteredAmount = cents.max(AMOUNT_MAX, { error: 'Ce montant dépasse 20 000 000 €.' });

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euroRound = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/** `48 200 €` when the amount is round, `1 250,50 €` otherwise (narrow no-break space). */
export function formatCents(value: Cents, options: { decimals?: 'auto' | 'always' } = {}): string {
  const round = value % 100 === 0 && options.decimals !== 'always';
  return (round ? euroRound : euro).format(value / 100);
}

/** Parses a French amount typed by a user (`1 250,50`, `1250.5 €`). Returns null when invalid. */
export function parseCents(input: string): Cents | null {
  const clean = input.replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const value = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -value : value;
}

/** A partial payment is applied to interest first, then to the principal (mirrors the API rule). */
export function allocatePayment(payment: Cents, due: { interest: Cents; principal: Cents; fees: Cents }) {
  const interest = Math.min(payment, due.interest);
  const principal = Math.min(payment - interest, due.principal);
  const fees = Math.min(payment - interest - principal, due.fees);
  return { interest, principal, fees, remainder: payment - interest - principal - fees };
}
