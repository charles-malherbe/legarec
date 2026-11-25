import { z } from 'zod';
import { atMost } from './limits';

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

/** Qualification sheet sent at the end of a call. */
export const callQualification = z.object({
  outcome: callOutcome,
  tcxCode: z.string().max(40),
  interlocutor: z.string().max(120, atMost(120)),
  notes: z.string().max(5000, atMost(5000)),
  promise: z
    .object({
      amount: z.number().int().positive(),
      date: z.iso.date(),
      method: z.enum(['TRANSFER', 'CHEQUE']),
      invoices: z.array(z.string().max(60)).min(1).max(100),
    })
    .nullable(),
  alreadyPaid: z.object({ paidOn: z.iso.date(), reference: z.string().min(1).max(100, atMost(100)) }).nullable(),
  dispute: z.object({ reason: z.string().min(1).max(500, atMost(500)), suspendReminders: z.boolean(), askCreditor: z.boolean() }).nullable(),
  absent: z.object({ voicemail: z.boolean(), smsLink: z.boolean() }).nullable(),
  months: z.number().int().nullable(),
  recall: z.enum(['1h', 'tomorrow', 'friday', 'custom']).nullable(),
  announced: z.boolean(),
  sendRecap: z.boolean(),
});
export type CallQualification = z.infer<typeof callQualification>;
