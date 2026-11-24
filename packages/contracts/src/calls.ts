import { z } from 'zod';

export const callOutcome = z.enum(['PROMISE_TO_PAY', 'PAYMENT_PLAN', 'CALLBACK', 'DISPUTE', 'ALREADY_PAID', 'ABSENT', 'NO_ANSWER', 'WRONG_NUMBER']);
export type CallOutcome = z.infer<typeof callOutcome>;

/** Codes expected by 3CX, kept as in the mockup. */
export const TCX_CODES: Record<CallOutcome, string> = {
  PROMISE_TO_PAY: 'PROMESSE',
  PAYMENT_PLAN: 'ECHEANCIER',
  CALLBACK: 'RAPPEL',
  DISPUTE: 'LITIGE',
  ALREADY_PAID: 'DEJA_PAYE',
  ABSENT: 'ABSENT',
  NO_ANSWER: 'NON_REPONSE',
  WRONG_NUMBER: 'FAUX_NUMERO',
};
