/**
 * The fixed guards (docs/ia.md, « Garde-fous »): what never leaves for the provider, and what an answer may never say.
 * The input is built from the case and not from free text where possible; these masks are the second line.
 */
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/gu;
const CARD = /\b(?:\d[ -]?){13,19}\b/gu;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gu;
const PHONE = /(?:\+33|\b0)[1-9](?:[ .-]?\d{2}){4}\b/gu;
/** Bank data, identity documents, contact details: masked before anything is sent. */
export function minimize(text: string): string {
  return text.replace(IBAN, '[IBAN MASQUÉ]').replace(CARD, '[NUMÉRO MASQUÉ]').replace(EMAIL, '[ADRESSE MASQUÉE]').replace(PHONE, '[TÉLÉPHONE MASQUÉ]');
}

/** Never in a suggestion: bank data, a score of solvency, pressure or threat (ia/cas-de-test.json, g1 to g3). */
const FORBIDDEN = [/\bIBAN\b/iu, /\bscore\b/iu, /\bsolvabilit/iu, /\bmenac/iu, /\bemployeur\b/iu, /\bfamille\b/iu, /\bsaisie\b.*\bimm[ée]diate/iu];
export function refusedByGuard(texts: string[]): boolean {
  const iban = new RegExp(IBAN.source, 'u');
  return texts.some((text) => FORBIDDEN.some((rule) => rule.test(text)) || iban.test(text));
}
