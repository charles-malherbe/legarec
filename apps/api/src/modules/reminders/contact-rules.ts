/**
 * When a debtor may be contacted (Paramètres › Relances, « Plages horaires ») : calls Monday to Friday 9:00–19:00 and
 * Saturday 9:00–12:00; e-mails and text messages Monday to Saturday 9:00–19:00; never on Sunday nor on a public holiday.
 * A letter has no hour. The texts of the settings are shown as typed; these are the hours they say (question 160).
 */
export type Channel = 'EMAIL' | 'SMS' | 'CALL' | 'LETTER';
const DAY_MS = 86_400_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Easter Sunday of a year (anonymous Gregorian algorithm). */
function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

/** The eleven public holidays of metropolitan France. */
export function publicHolidays(year: number): Set<string> {
  const sunday = easter(year);
  return new Set([
    `${year}-01-01`,
    iso(sunday + DAY_MS),
    `${year}-05-01`,
    `${year}-05-08`,
    iso(sunday + 39 * DAY_MS),
    iso(sunday + 50 * DAY_MS),
    `${year}-07-14`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-25`,
  ]);
}

/** Why a contact on that day, at that hour, is outside the allowed hours; null when it is allowed. */
export function outsideHours(channel: Channel, day: string, time: string | null): string | null {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (publicHolidays(Number(day.slice(0, 4))).has(day)) return 'Jour férié : hors des plages autorisées';
  if (weekday === 0) return 'Dimanche : hors des plages autorisées';
  if (channel === 'LETTER' || !time) return null;
  const end = weekday === 6 && channel === 'CALL' ? '12:00' : '19:00';
  return time < '09:00' || time > end ? `${time} : hors des plages autorisées (09:00–${end})` : null;
}

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
