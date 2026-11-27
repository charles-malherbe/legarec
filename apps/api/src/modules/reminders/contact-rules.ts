import type { ContactChannel, contactHours, SendingRefusal } from '@legarec/contracts';
import { dayOf, startOfDay } from '../../platform/format';

/**
 * The caps of contacts by debtor (Paramètres › Relances, « Plafonds »). The hours, day by day, and the public holidays are
 * in @legarec/contracts (`contactHours`, question 160): the same for the simulations.
 */
export type Channel = ContactChannel;
const DAY_MS = 86_400_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** The period a cap counts over: the week from Monday, or the month for letters. */
export function capPeriod(channel: Channel, day: string): [from: string, to: string] {
  if (channel === 'LETTER') {
    const [year, month] = day.split('-').map(Number) as [number, number];
    return [`${day.slice(0, 7)}-01`, iso(Date.UTC(year, month, 0))];
  }
  const time = Date.parse(`${day}T12:00:00Z`);
  const monday = time - ((new Date(time).getUTCDay() + 6) % 7) * DAY_MS;
  return [iso(monday), iso(monday + 6 * DAY_MS)];
}

const CAP_FIELDS: Record<Channel, [field: string, unit: string, strict: number]> = {
  CALL: ['calls', 'appels par semaine', 2],
  EMAIL: ['emails', 'e-mails par semaine', 2],
  SMS: ['sms', 'SMS par semaine', 1],
  LETTER: ['letters', 'courriers par mois', 2],
};
/** The cap of a channel as the settings say it; an unreadable value never lifts the cap. */
export function capOf(channel: Channel, setting: (field: string) => string): { cap: number; unit: string } {
  const [field, unit, strict] = CAP_FIELDS[channel];
  const value = Number(setting(field));
  return { cap: Number.isInteger(value) && value > 0 ? value : strict, unit };
}

/**
 * Until when a sending that waits (a key, a value of the firm, the hours) may still leave: the end of the next day the
 * firm writes on, after the day it was asked. Beyond, it has failed (`EXPIRED`): a reminder never leaves days late.
 */
export function sendingDeadline(asked: Date, hours: ReturnType<typeof contactHours>): Date {
  let day = dayOf(asked);
  // Two weeks never go without a day the firm writes on; the loop ends whatever the settings say.
  for (let tries = 0; tries < 14; tries += 1) {
    day = iso(Date.parse(`${day}T12:00:00Z`) + DAY_MS);
    if (!hours.outsideHours('EMAIL', day, null)) break;
  }
  return startOfDay(iso(Date.parse(`${day}T12:00:00Z`) + DAY_MS));
}

/**
 * Why no reminder leaves on a case in that state (question 218): a dispute or a litigation, a plan that is respected
 * (maquette/HANDOFF.md: « Les relances sont suspendues tant que le plan est respecté »). A promise suspends nothing.
 */
export function suspensionOf(status: string, activePlans: number): Extract<SendingRefusal, 'CASE_DISPUTED' | 'PLAN_RESPECTED'> | null {
  if (status === 'DISPUTE' || status === 'LITIGATION') return 'CASE_DISPUTED';
  return activePlans > 0 ? 'PLAN_RESPECTED' : null;
}
