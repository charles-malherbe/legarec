/** Room of a line of address, postage speed D or D1 (documentation of MySendingBox, read on 28/11/2026). */
export const ADDRESS_LINE_MAX = 45;
/** Lines of street MySendingBox takes (`address_line1` to `address_line3`). */
const STREET_LINES = 3;
const POSTAL = /^(\d{5})\s+(\S.*)$/u;

/**
 * The street of an address as the post reads it: one to three lines of 45 characters at most, cut at the line breaks and
 * the commas. Null when it does not fit: a registered letter never leaves with an address cut short.
 */
export function streetLinesOf(text: string | null | undefined): string[] | null {
  const lines = (text ?? '')
    .split(/[\n,]/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > STREET_LINES || lines.some((line) => line.length > ADDRESS_LINE_MAX)) return null;
  return lines;
}

/**
 * An address typed in one field (Paramètres › Cabinet, « Adresse du siège »): the street, then « 75002 Paris » as its last
 * part. Null when no postal code and city end it.
 */
export function postalOf(text: string | null | undefined): { lines: string[]; postalCode: string; city: string } | null {
  const parts = (text ?? '')
    .split(/[\n,]/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  const last = POSTAL.exec(parts.at(-1) ?? '');
  const lines = streetLinesOf(parts.slice(0, -1).join('\n'));
  if (!last || !lines || last[2]!.length > ADDRESS_LINE_MAX) return null;
  return { lines, postalCode: last[1]!, city: last[2]! };
}
