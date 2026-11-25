const ZONE = 'Europe/Paris';
const format = (options: Intl.DateTimeFormatOptions) => {
  const formatter = new Intl.DateTimeFormat('fr-FR', { timeZone: ZONE, ...options });
  return (date: Date) => formatter.format(date);
};
/** `2026-11-25`, in the time zone of the firm. */
const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = (date: Date) => isoDay.format(date);
/** By the calendar: the days of a change of hour last 23 or 25 hours. */
const dayBefore = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
export const timeOf = format({ hour: '2-digit', minute: '2-digit' });
const numeric = format({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const short = format({ day: 'numeric', month: 'short' });
const withYear = format({ day: 'numeric', month: 'short', year: 'numeric' });
/** « 21/11/2026 11:58 » */
export const moment = (date: Date) => numeric(date).replace(',', '');
export const longMoment = format({ dateStyle: 'long', timeStyle: 'short' });

export function daysAgo(date: Date, now = new Date()): 'TODAY' | 'YESTERDAY' | 'EARLIER' {
  const [day, today] = [dayOf(date), dayOf(now)];
  if (day === today) return 'TODAY';
  return day === dayBefore(today) ? 'YESTERDAY' : 'EARLIER';
}

/** « il y a 12 min », « aujourd’hui à 14:32 », « hier à 09:05 », « 18 nov. ». */
export function ago(date: Date, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const day = daysAgo(date, now);
  if (day === 'TODAY') return `aujourd’hui à ${timeOf(date)}`;
  if (day === 'YESTERDAY') return `hier à ${timeOf(date)}`;
  return dayOf(date).slice(0, 4) === dayOf(now).slice(0, 4) ? short(date) : withYear(date);
}
export const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
