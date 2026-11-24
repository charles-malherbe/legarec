import { z } from 'zod';
import { MANDATORY_BLOCKS, MERGE_FIELD_CODES } from './mergeFields';
import { measureSms } from './sms';

export const templateKind = z.enum(['LETTER', 'EMAIL', 'SMS', 'INVOICE', 'CONTRACT']);
export const templateStatus = z.enum(['PUBLISHED', 'IMPORTED', 'RESTORED', 'WAITING']);
export const templateCheck = z.object({ level: z.enum(['OK', 'WARNING', 'ERROR']), label: z.string(), detail: z.string() });
export type TemplateCheck = z.infer<typeof templateCheck>;
export const templateImport = z.object({ fileName: z.string(), accepted: z.boolean(), checks: z.array(templateCheck), previewHtml: z.string() });
export type TemplateImport = z.infer<typeof templateImport>;
export const templateSummary = z.object({
  id: z.string(),
  name: z.string(),
  channel: z.string(),
  category: z.enum(['COLLECTION', 'BILLING']),
  date: z.string(),
  uses: z.number().int(),
});
export const templatesData = z.object({ items: z.array(templateSummary) });
export const templateDetail = templateSummary.extend({
  kind: templateKind,
  registered: z.boolean(),
  quote: z.boolean(),
  version: z.number().int(),
  author: z.string(),
  usedBy: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  lines: z.array(z.object({ label: z.string(), detail: z.string(), amount: z.string() })),
  totals: z.array(z.string()),
  fileName: z.string(),
  fileSize: z.string(),
  source: z.string(),
  block: z.string(),
  status: templateStatus,
  canImport: z.boolean(),
  canValidate: z.boolean(),
  validator: z.string(),
  pending: templateImport.nullable(),
  versions: z.array(z.object({ number: z.number().int(), what: z.string(), who: z.string(), state: z.enum(['PUBLISHED', 'ARCHIVED']) })),
  samples: z.array(z.object({ id: z.string(), label: z.string(), values: z.record(z.string(), z.string()) })),
});
export type TemplateDetail = z.infer<typeof templateDetail>;

/** 500 KB, as announced on the import screen. */
export const TEMPLATE_MAX_BYTES = 500_000;
const BAILIFF_TERMS = /\b(sommation|commandement|saisie(?:-[a-z]+)?|exploit|signification|huissier|commissaire de justice|titre exécutoire)\b/giu;
const FORBIDDEN_HTML =
  /<\s*(script|iframe|object|embed|form|input|button|link|base|meta\s+http-equiv)\b|\son[a-z]+\s*=|javascript:|@import|url\(\s*['"]?\s*(?:https?:)?\/\/|\bsrc(?:set)?\s*=\s*['"]?\s*(?!cid:|https:\/\/media\.legarec\.fr\/)/iu;

const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}
const closest = (code: string) =>
  MERGE_FIELD_CODES.map((item) => ({ item, score: distance(code, item) }))
    .filter((entry) => entry.score <= 4)
    .sort((a, b) => a.score - b.score)[0]?.item;

/** Controls run by the API on an imported template file. */
export function checkTemplate(
  template: { kind: z.infer<typeof templateKind>; category: 'COLLECTION' | 'BILLING'; isReminder: boolean; block: string },
  source: string,
): { accepted: boolean; checks: TemplateCheck[]; fields: string[] } {
  const errors: TemplateCheck[] = [];
  const warnings: TemplateCheck[] = [];
  const passed: TemplateCheck[] = [];
  const fail = (label: string, detail = '') => errors.push({ level: 'ERROR', label, detail });
  const pass = (label: string, detail = '') => passed.push({ level: 'OK', label, detail });
  const sms = template.kind === 'SMS';
  const fields = new Set<string>();

  if (source.includes('�') || source.includes('\0')) fail('Fichier illisible', 'Enregistrez-le en UTF-8');
  else pass(`Fichier ${sms ? 'texte' : 'HTML'} valide, encodé en UTF-8`);

  for (const match of source.matchAll(/\{\{\{?\s*([^{}]*?)\s*\}?\}\}/gu)) {
    const inner = match[1]!;
    const line = lineOf(source, match.index);
    if (match[0].startsWith('{{{') || inner.startsWith('&')) {
      fail(`Champ non protégé, ligne ${line}`, `${match[0]} : utilisez deux accolades`);
      continue;
    }
    if (inner.startsWith('!') || /^\/(if|unless|each)$/u.test(inner) || inner === 'else') continue;
    if (inner.startsWith('>')) {
      const partial = inner.slice(1).trim();
      if (!MANDATORY_BLOCKS.some((item) => item.code === partial)) fail(`Bloc inconnu, ligne ${line}`, `{{> ${partial}}}`);
      continue;
    }
    const code = inner.replace(/^#(if|unless|each)\s+/u, '');
    if (MERGE_FIELD_CODES.includes(code)) fields.add(code);
    else {
      const guess = closest(code);
      fail(`Champ inconnu, ligne ${line}`, `{{${code}}}${guess ? ` : vouliez-vous dire {{${guess}}} ?` : ''}`);
    }
  }
  if (!errors.some((item) => /^Champ|^Bloc inconnu/u.test(item.label)))
    pass(`${fields.size} champ${fields.size > 1 ? 's' : ''} de fusion reconnu${fields.size > 1 ? 's' : ''}`);

  if (new RegExp(`\\{\\{>\\s*${template.block}\\s*\\}\\}`, 'u').test(source)) pass('Bloc imposé présent', `{{> ${template.block}}}`);
  else fail('Bloc imposé absent', `{{> ${template.block}}} doit figurer dans le fichier`);

  const forbidden = FORBIDDEN_HTML.exec(source);
  if (forbidden) fail(`Script, formulaire ou ressource externe, ligne ${lineOf(source, forbidden.index)}`, forbidden[0].trim());
  else pass('Aucun script, formulaire ni ressource externe');

  if (template.isReminder) {
    const missing = ['dossier.premier_courrier_reference', 'dossier.premier_courrier_date'].filter((code) => !fields.has(code));
    if (missing.length > 0) fail('Rappel du premier courrier absent', `Ajoutez ${missing.map((code) => `{{${code}}}`).join(' et ')}`);
    else pass('Référence et date du premier courrier présentes');
  }
  if (template.category === 'COLLECTION') {
    const terms = [...new Set([...source.matchAll(BAILIFF_TERMS)].map((match) => match[0].toLowerCase()))];
    if (terms.length > 0)
      warnings.push({
        level: 'WARNING',
        label: 'Termes proches d’un acte de commissaire de justice',
        detail: `${terms.join(', ')} : à valider avant de soumettre`,
      });
  }
  if (sms) {
    const measure = measureSms(source.replace(/\{\{[^}]*\}\}/gu, ''));
    if (measure.unicode)
      warnings.push({ level: 'WARNING', label: 'SMS limité à 70 caractères', detail: `Caractères en cause : ${measure.unicodeChars.join(' ')}` });
  }
  return { accepted: errors.length === 0, checks: [...errors, ...warnings, ...passed], fields: [...fields] };
}
