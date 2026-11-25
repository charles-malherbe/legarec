/** Only module allowed to open phone calls, system notifications, generated files and external links. */

export const toTelHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '').replace(/^0/, '+33')}`;

/** Click-to-call through the 3CX client registered for tel: links. */
export function startCall(phone: string): void {
  window.location.assign(toTelHref(phone));
}

export async function notify(title: string, body: string): Promise<boolean> {
  if (!('Notification' in window)) return false;
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return false;
  new Notification(title, { body });
  return true;
}

/** File names must be generated identifiers: no personal data, no access code. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function openExternal(url: string): void {
  const { protocol } = new URL(url);
  if (protocol !== 'https:') throw new Error('Only https links can be opened');
  window.open(url, '_blank', 'noopener,noreferrer');
}
