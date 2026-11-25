const TIME_ZONE = 'Europe/Paris';
export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TIME_ZONE }).format(new Date(iso));
export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: TIME_ZONE }).format(new Date(iso));
export const formatSiret = (value: string) => value.replace(/\s/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, '$1 $2 $3 $4');
export const formatSiren = (value: string) => value.replace(/\s/g, '').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
/** `24 novembre 2026`, in the Paris time zone. */
export const formatLongDate = (date: Date) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(date);
