// GSM 03.38 basic set. « ê » and « ç » (lowercase) are absent, which is what switches a message to UCS-2.
const GSM = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
const GSM_EXTENDED = new Set('^{}\\[~]|€\f');

export function measureSms(text: string) {
  const chars = [...text];
  const unicodeChars = [...new Set(chars.filter((char) => !GSM.has(char) && !GSM_EXTENDED.has(char)))];
  const unicode = unicodeChars.length > 0;
  const length = unicode ? text.length : chars.reduce((sum, char) => sum + (GSM_EXTENDED.has(char) ? 2 : 1), 0);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return { length, unicode, unicodeChars, limit: single, segments: length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi) };
}
