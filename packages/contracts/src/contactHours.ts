/**
 * When a debtor may be contacted (question 160): the hours of Paramètres › Relances, day by day, for the calls on one side,
 * the e-mails and text messages on the other; never on Sunday nor on a public holiday. A letter has no hour. The same rules
 * for the API and the simulations.
 */
export type ContactChannel = 'EMAIL' | 'SMS' | 'CALL' | 'LETTER';
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

/** The days that may have hours, Monday first; Sunday never has any. */
export const CONTACT_DAYS = [
  ['mon', 'Lundi'],
  ['tue', 'Mardi'],
  ['wed', 'Mercredi'],
  ['thu', 'Jeudi'],
  ['fri', 'Vendredi'],
  ['sat', 'Samedi'],
] as const;
/** The hours of each day as the firm had them before they could be set (question 160). */
export const DEFAULT_CONTACT_HOURS: Record<'call' | 'send', Record<(typeof CONTACT_DAYS)[number][0], string>> = {
  call: { mon: '09:00–19:00', tue: '09:00–19:00', wed: '09:00–19:00', thu: '09:00–19:00', fri: '09:00–19:00', sat: '09:00–12:00' },
  send: { mon: '09:00–19:00', tue: '09:00–19:00', wed: '09:00–19:00', thu: '09:00–19:00', fri: '09:00–19:00', sat: '09:00–19:00' },
};

const RANGE = /^([01]\d|2[0-3]):([0-5]\d)\s*[–-]\s*([01]\d|2[0-3]):([0-5]\d)$/u;
/** « 09:00–19:00 » as [start, end]; empty: no contact that day; null when it cannot be read or does not end after it starts. */
export function readHours(text: string): [start: string, end: string] | 'NONE' | null {
  const typed = text.trim();
  if (!typed) return 'NONE';
  const found = RANGE.exec(typed);
  if (!found) return null;
  const start = `${found[1]}:${found[2]}`;
  const end = `${found[3]}:${found[4]}`;
  return start < end ? [start, end] : null;
}
/** Why a range of hours cannot be recorded; null when it can (empty included: no contact that day). */
export function hoursProblem(text: string): string | null {
  if (readHours(text)) return null;
  return RANGE.test(text.trim()) ? 'L’heure de fin doit suivre l’heure de début.' : 'Format attendu : 09:00–19:00, ou vide pour aucun contact ce jour-là.';
}

/**
 * The rules of the hours, from the fields of Paramètres › Relances (`call-mon` … `send-sat`). A value that cannot be read
 * never opens the hours: the former ones of the day apply.
 */
export function contactHours(read: (field: string) => string) {
  const rangeOf = (channel: 'CALL' | 'EMAIL' | 'SMS', weekday: number): [string, string] | 'NONE' => {
    const group = channel === 'CALL' ? 'call' : 'send';
    const [key] = CONTACT_DAYS[weekday - 1]!;
    return readHours(read(`${group}-${key}`)) ?? (readHours(DEFAULT_CONTACT_HOURS[group][key]) as [string, string]);
  };
  return {
    /** Why a contact on that day, at that hour, is outside the allowed hours; null when it is allowed. */
    outsideHours(channel: ContactChannel, day: string, time: string | null): string | null {
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (publicHolidays(Number(day.slice(0, 4))).has(day)) return 'Jour férié : hors des plages autorisées';
      if (weekday === 0) return 'Dimanche : hors des plages autorisées';
      if (channel === 'LETTER') return null;
      const range = rangeOf(channel, weekday);
      if (range === 'NONE') return `${CONTACT_DAYS[weekday - 1]![1]} : aucun contact ce jour-là`;
      if (!time) return null;
      const [start, end] = range;
      return time < start || time > end ? `${time} : hors des plages autorisées (${start}–${end})` : null;
    },
  };
}
