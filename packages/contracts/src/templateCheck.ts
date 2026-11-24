import Handlebars from 'handlebars';
import type { z } from 'zod';
import { MANDATORY_BLOCKS, MERGE_FIELD_CODES } from './mergeFields';
import { measureSms } from './sms';
import type { templateKind, TemplateCheck } from './templates';

/**
 * Controls run by the API on an imported template file. Allow lists only:
 * the Handlebars syntax tree for the fields, a strict grammar for the HTML.
 */
const BAILIFF_TERMS =
  /\b(sommations?|commandements?|saisies?(?:[- ][a-z]+)?|exploits?|significations?|huissiers?|commissaires? de justice|titres? exécutoires?)\b/giu;
const BLOCK_HELPERS = new Set(['if', 'unless', 'each']);
const FIRST_LETTER = ['dossier.premier_courrier_reference', 'dossier.premier_courrier_date'];
const ACCESS_CODE = 'debiteur.code_acces';
const TAGS = new Set(
  'html head body title style meta p br hr div span b strong i em u small sub sup h1 h2 h3 h4 ul ol li table thead tbody tfoot tr th td caption colgroup col img a blockquote section header footer main article'.split(
    ' ',
  ),
);
const ATTRIBUTES = new Set(
  'style class id align valign width height bgcolor border cellpadding cellspacing colspan rowspan scope role lang alt title charset name content href src'.split(
    ' ',
  ),
);
const FIELD = '';

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

/** CSS that loads, escapes or hides something. */
const forbiddenCss = (css: string) =>
  /[\\<>]|\/\*|url|image|@import|@font|@charset|@namespace|expression|javascript|behavior|-moz-binding|src\s*:|content\s*:|display\s*:\s*none|visibility|opacity|position\s*:|clip|text-indent|transform|font-size\s*:\s*0|(?:max-)?(?:height|width)\s*:\s*0(?![.\d])|color\s*:\s*transparent/iu.exec(
    css,
  )?.[0];

function checkAttribute(tag: string, name: string, value: string): string | null {
  if (!ATTRIBUTES.has(name)) return `attribut ${name}`;
  if (value.includes('&') || value.includes(FIELD)) return `valeur de ${name}`;
  if (name === 'style') return forbiddenCss(value) ?? null;
  if (name === 'src') return tag === 'img' && /^(?:https:\/\/media\.legarec\.fr\/[\w./-]+|cid:[\w.@-]+)$/u.test(value) ? null : `src ${value}`;
  if (name === 'href')
    return tag === 'a' && /^(?:https:\/\/(?:[a-z]+\.)?legarec\.fr(?:\/[\w./-]*)?|mailto:[\w.-]+@legarec\.fr|tel:\+?\d+)$/u.test(value) ? null : `href ${value}`;
  if (tag === 'meta' && name === 'content') return /^(?:text\/html; ?charset=utf-8|width=device-width.*|light)$/iu.test(value) ? null : `meta ${value}`;
  if (tag === 'meta' && name === 'name') return /^(?:viewport|color-scheme|supported-color-schemes)$/u.test(value) ? null : `meta ${value}`;
  return null;
}

/** Returns the first construct outside the grammar, with its position. */
function scanHtml(html: string): { index: number; found: string } | null {
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) return null;
    const rest = html.slice(open);
    const doctype = /^<!doctype html>/iu.exec(rest);
    if (doctype) {
      index = open + doctype[0].length;
      continue;
    }
    const closing = /^<\/([a-z][a-z0-9]*)\s*>/iu.exec(rest);
    if (closing && TAGS.has(closing[1]!.toLowerCase())) {
      index = open + closing[0].length;
      continue;
    }
    const tag = /^<([a-z][a-z0-9]*)((?:\s+[a-z][a-z-]*(?:="[^"<>]*")?)*)\s*\/?>/iu.exec(rest);
    if (!tag || !TAGS.has(tag[1]!.toLowerCase())) return { index: open, found: rest.slice(0, 40).split('\n')[0] ?? '<' };
    const name = tag[1]!.toLowerCase();
    for (const attribute of tag[2]!.matchAll(/([a-z][a-z-]*)(?:="([^"<>]*)")?/giu)) {
      const problem = checkAttribute(name, attribute[1]!.toLowerCase(), attribute[2] ?? '');
      if (problem) return { index: open, found: problem };
    }
    index = open + tag[0].length;
    if (name === 'style') {
      const end = html.toLowerCase().indexOf('</style', index);
      const css = html.slice(index, end < 0 ? undefined : end);
      const problem = end < 0 ? '<style>' : css.includes(FIELD) ? 'champ dans <style>' : forbiddenCss(css);
      if (problem) return { index, found: problem };
      index = end;
    }
  }
  return null;
}

type Node = hbs.AST.Statement;
export function checkTemplate(
  template: { kind: z.infer<typeof templateKind>; category: 'COLLECTION' | 'BILLING'; isReminder: boolean; block: string },
  source: string,
): { accepted: boolean; checks: TemplateCheck[]; fields: string[] } {
  const errors: TemplateCheck[] = [];
  const warnings: TemplateCheck[] = [];
  const passed: TemplateCheck[] = [];
  const fail = (label: string, detail = '') => errors.push({ level: 'ERROR', label, detail });
  const pass = (label: string, detail = '') => passed.push({ level: 'OK', label, detail });
  const result = (fields: Set<string>) => ({ accepted: errors.length === 0, checks: [...errors, ...warnings, ...passed], fields: [...fields] });
  const sms = template.kind === 'SMS';
  const fields = new Set<string>();
  /** Shown whatever the data: outside any condition or loop. */
  const always = new Set<string>();
  const blocks = new Set<string>();

  if (source.includes('�') || source.includes('\0') || source.includes(FIELD)) fail('Fichier illisible', 'Enregistrez-le en UTF-8');
  else pass(`Fichier ${sms ? 'texte' : 'HTML'} valide, encodé en UTF-8`);

  let program: hbs.AST.Program;
  try {
    program = Handlebars.parseWithoutProcessing(source);
  } catch (error) {
    fail('Syntaxe des champs incorrecte', error instanceof Error ? (error.message.split('\n')[0] ?? '') : '');
    return result(fields);
  }
  const knownField = (expression: hbs.AST.Expression, line: number, shown: string): string | null => {
    const path = expression as hbs.AST.PathExpression;
    if (path.type !== 'PathExpression' || path.data || path.depth !== 0 || !MERGE_FIELD_CODES.includes(path.original)) {
      const code = path.type === 'PathExpression' ? path.original : shown;
      const guess = closest(code);
      fail(`Champ inconnu, ligne ${line}`, `{{${code}}}${guess ? ` : vouliez-vous dire {{${guess}}} ?` : ''}`);
      return null;
    }
    if (path.original === ACCESS_CODE && template.kind !== 'LETTER') {
      fail(`Code d’accès interdit, ligne ${line}`, 'Le code d’accès ne figure que dans un courrier');
      return null;
    }
    return path.original;
  };
  const simple = (node: { params: unknown[]; hash?: hbs.AST.Hash }) => node.params.length === 0 && !node.hash?.pairs.length;
  let html = '';
  const walk = (body: Node[], root: boolean) => {
    for (const node of body) {
      const line = node.loc.start.line;
      switch (node.type) {
        case 'ContentStatement':
          html += (node as hbs.AST.ContentStatement).original;
          break;
        case 'CommentStatement':
          html += '\n'.repeat(node.loc.end.line - line);
          break;
        case 'MustacheStatement': {
          const mustache = node as hbs.AST.MustacheStatement;
          const written = (source.split('\n')[line - 1] ?? '').slice(node.loc.start.column);
          if (!mustache.escaped || /^\{\{~?[{&]/u.test(written)) {
            fail(`Champ non protégé, ligne ${line}`, 'Utilisez deux accolades');
            break;
          }
          if (!simple(mustache)) fail(`Champ inconnu, ligne ${line}`, 'Un champ ne prend aucun paramètre');
          const code = knownField(mustache.path as hbs.AST.Expression, line, 'expression');
          if (code) {
            fields.add(code);
            if (root) always.add(code);
            // The only field allowed inside a tag: the link to the debtors' portal.
            html += code === 'paiement.lien' && /href="$/u.test(html) ? 'https://paiement.legarec.fr' : FIELD;
          }
          break;
        }
        case 'PartialStatement': {
          const partial = node as hbs.AST.PartialStatement;
          const name = partial.name.type === 'PathExpression' ? (partial.name as hbs.AST.PathExpression).original : '';
          if (!MANDATORY_BLOCKS.some((item) => item.code === name) || !simple(partial)) fail(`Bloc inconnu, ligne ${line}`, `{{> ${name || '?'}}}`);
          else if (root) blocks.add(name);
          break;
        }
        case 'BlockStatement': {
          const block = node as hbs.AST.BlockStatement;
          const helper = block.path.type === 'PathExpression' ? block.path.original : '';
          if (!BLOCK_HELPERS.has(helper) || block.params.length !== 1 || block.hash?.pairs.length || block.program.blockParams?.length) {
            fail(`Bloc inconnu, ligne ${line}`, `{{#${helper || '?'}}}`);
            break;
          }
          knownField(block.params[0]!, line, 'expression');
          walk(block.program.body, false);
          if (block.inverse) walk(block.inverse.body, false);
          break;
        }
        default:
          fail(`Instruction interdite, ligne ${line}`, node.type);
      }
    }
  };
  walk(program.body, true);
  if (errors.every((item) => !/^(Champ|Bloc|Code)/u.test(item.label)))
    pass(`${fields.size} champ${fields.size > 1 ? 's' : ''} de fusion reconnu${fields.size > 1 ? 's' : ''}`);

  if (blocks.has(template.block)) pass('Bloc imposé présent', `{{> ${template.block}}}`);
  else fail('Bloc imposé absent', `{{> ${template.block}}} doit figurer dans le fichier, hors de toute condition`);

  const problem = sms ? (/<[a-z!/]/iu.test(html) ? { index: html.search(/<[a-z!/]/iu), found: 'balise HTML' } : null) : scanHtml(html);
  if (problem) fail(`Script, formulaire ou ressource externe, ligne ${lineOf(html, problem.index)}`, `Élément non autorisé : ${problem.found}`);
  else pass('Aucun script, formulaire ni ressource externe');

  if (template.isReminder) {
    const missing = FIRST_LETTER.filter((code) => !always.has(code));
    if (missing.length > 0) fail('Rappel du premier courrier absent', `Ajoutez ${missing.map((code) => `{{${code}}}`).join(' et ')}, hors de toute condition`);
    else pass('Référence et date du premier courrier présentes');
  }
  if (template.category === 'COLLECTION') {
    const plain = html
      .replace(/<[^>]*>/gu, '')
      .replace(/&nbsp;|&#160;|\u00a0|\u202f/giu, ' ')
      .replace(/&(?:shy|zwnj|zwj);|[\u00ad\u200b-\u200d]/giu, '')
      .replace(/\s+/gu, ' ');
    const terms = [...new Set([...plain.matchAll(BAILIFF_TERMS)].map((match) => match[0].toLowerCase()))];
    if (terms.length > 0)
      warnings.push({
        level: 'WARNING',
        label: 'Termes proches d’un acte de commissaire de justice',
        detail: `${terms.join(', ')} : à valider avant de soumettre`,
      });
  }
  if (sms) {
    const measure = measureSms(html.replaceAll(FIELD, ''));
    if (measure.unicode)
      warnings.push({ level: 'WARNING', label: 'SMS limité à 70 caractères', detail: `Caractères en cause : ${measure.unicodeChars.join(' ')}` });
  }
  return result(fields);
}
