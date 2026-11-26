/**
 * The fixed guards (docs/ia.md, « Garde-fous »): what never leaves for the provider, and what an answer may never say.
 * The input is built from the case, not from free text where possible; these masks are the second line.
 */
const SEP = '[ .\\-]?';
/** IBAN, any case, spaces, dots or dashes between groups. */
const IBAN = new RegExp(`\\b[a-z]{2}\\d{2}(?:${SEP}[a-z0-9]{4}){2,7}(?:${SEP}[a-z0-9]{1,4})?\\b`, 'giu');
/** French RIB: bank 5, office 5, account 11, key 2. */
const RIB = /\b\d{5}[ .-]?\d{5}[ .-]?[a-z0-9]{11}[ .-]?\d{2}\b/giu;
const CARD = /\b(?:\d[ -]?){13,19}\b/gu;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gu;
const PHONE = /(?:(?:\+|00)33[ .-]?|\b0)[1-9](?:[ .-]?\d{2}){4}\b/gu;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Bank data, contact details, and what the case knows of the debtor (`known`: their name, their coordinates, their access
 * code), masked before anything is sent.
 */
export function minimize(text: string, known: string[] = []): string {
  let masked = text;
  for (const value of known.filter((item) => item.trim().length >= 3).sort((a, b) => b.length - a.length))
    masked = masked.replace(new RegExp(escape(value.trim()), 'giu'), '[MASQUÉ]');
  return masked
    .replace(IBAN, '[IBAN MASQUÉ]')
    .replace(RIB, '[RIB MASQUÉ]')
    .replace(EMAIL, '[ADRESSE MASQUÉE]')
    .replace(PHONE, '[TÉLÉPHONE MASQUÉ]')
    .replace(CARD, '[NUMÉRO MASQUÉ]');
}

/** Never in a suggestion: bank data, a score of solvency, pressure or threat (ia/cas-de-test.json, g1 to g3). */
const FORBIDDEN = [
  /\bI\.?B\.?A\.?N\b/iu,
  /\bscore\b/iu,
  /\bsolvabilit/iu,
  /\bmenac/iu,
  /\bemployeur\b/iu,
  /\bfamille\b/iu,
  /\bsaisie/iu,
  /\bhuissier/iu,
  /\bcommissaire de justice/iu,
  /\bpoursuites? (?:imm[ée]diates?|judiciaires? certaines?)/iu,
];
export function refusedByGuard(texts: string[]): boolean {
  const iban = new RegExp(IBAN.source, 'iu');
  return texts.some((text) => FORBIDDEN.some((rule) => rule.test(text)) || iban.test(text));
}
