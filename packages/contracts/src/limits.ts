/** Ceiling of a text typed by someone: the message of the form, and the same refusal by the API. */
export const atMost = (characters: number) => ({ error: `Ce texte ne peut pas dépasser ${characters.toLocaleString('fr-FR')} caractères.` });

/** Longest e-mail address allowed by the standard. */
export const EMAIL_MAX = 254;
export const ID_MAX = 64;
/** SIREN, SIRET, VAT number, BIC: as long as they may be written, spaces included. */
export const NUMBER_MAX = 30;
export const NAME_MAX = 80;
