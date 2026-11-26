import type { ContactChannel } from '@legarec/contracts';

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
