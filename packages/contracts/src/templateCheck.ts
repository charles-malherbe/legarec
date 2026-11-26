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
/** A guess only for a code of a sensible length: the distance costs the product of both lengths. */
const closest = (code: string) =>
  code.length > 60
    ? undefined
    : MERGE_FIELD_CODES.map((item) => ({ item, score: distance(code, item) }))
        .filter((entry) => entry.score <= 4)
        .sort((a, b) => a.score - b.score)[0]?.item;

/** Marks a block boundary, a comment or a partial in the scanned text. */
const BLOCK = '\uE001';
const MARKERS = /[\uE000\uE001]/u;
const PROPERTIES = new Set(
  'margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-width border-style border-color border-radius border-collapse border-spacing width min-width max-width height min-height line-height font-family font-size font-weight font-style color background-color text-align text-decoration text-transform letter-spacing vertical-align white-space list-style list-style-type table-layout word-break overflow-wrap display page-break-before page-break-after page-break-inside break-before break-after break-inside size'.split(
    ' ',
  ),
);
const SHOWN = new Set(['block', 'inline', 'inline-block', 'table', 'table-row', 'table-cell', 'list-item']);
const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff' };

function luminance(color: string): number | null {
  const named = NAMED[color.toLowerCase()] ?? color;
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(named)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((char) => char + char).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((at) => {
    const value = parseInt(full.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** The text must stay readable on its own background (white and near-black by default). */
function unreadable(color: string | undefined, background: string | undefined): boolean {
  const front = luminance(color ?? '#222222');
  const back = luminance(background ?? '#ffffff');
  if (front === null || back === null) return true;
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05) < 3;
}
/** Allowed properties and plain values only: no function, no escape, no negative nor tiny size. */
function forbiddenDeclarations(css: string): string | null {
  if (!/^[\w\s.,%#"':;-]*$/u.test(css)) return css.trim().slice(0, 40) || 'style';
  const found: Record<string, string> = {};
  for (const declaration of css
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [, name = '', value = ''] = /^([a-z-]+)\s*:\s*(.+)$/iu.exec(declaration) ?? [];
    const property = name.toLowerCase();
    if (!PROPERTIES.has(property)) return declaration.slice(0, 40);
    if (/(?:^|[\s,])-[\d.]/u.test(value)) return declaration;
    if (property === 'display' && !SHOWN.has(value.toLowerCase())) return declaration;
    if (property === 'font-size' && !(/^(?:[6-9]|[1-7]\d)(?:\.\d+)?(?:px|pt)$/u.test(value) || /^(?:0\.[6-9]\d*|[1-4](?:\.\d+)?)(?:em|rem)$/u.test(value)))
      return declaration;
    if (property === 'line-height' && !/^(?:normal|0\.[89]\d*|[1-3](?:\.\d+)?|(?:[89]|[1-9]\d)px)$/u.test(value)) return declaration;
    if (
      /^(?:max-)?(?:width|height)$/u.test(property) &&
      !/^(?:auto|none|(?:100|[1-9]\d)(?:\.\d+)?%|[1-9]\d{0,3}(?:\.\d+)?(?:px|pt|mm|cm|em)|(?:[1-9]\d?)%)$/u.test(value)
    )
      return declaration;
    if (property === 'letter-spacing' && !/^(?:normal|[0-4](?:\.\d+)?px|0(?:\.\d+)?em)$/u.test(value)) return declaration;
    if (property === 'color' || property === 'background-color') found[property] = value;
  }
  return (found.color || found['background-color']) && unreadable(found.color, found['background-color'])
    ? `couleur illisible (${found.color ?? found['background-color']})`
    : null;
}
function forbiddenSheet(css: string): string | null {
  let rest = css;
  while (rest.trim()) {
    const rule = /^\s*(@page\s*|[a-z][\w\s.#,>-]*|[.#][\w\s.#,>-]*)\{([^{}]*)\}/iu.exec(rest);
    if (!rule) return rest.trim().slice(0, 40);
    const problem = forbiddenDeclarations(rule[2]!);
    if (problem) return problem;
    rest = rest.slice(rule[0].length);
  }
  return null;
}

function checkAttribute(tag: string, name: string, value: string): string | null {
  if (!ATTRIBUTES.has(name)) return `attribut ${name}`;
  if (value.includes('&') || MARKERS.test(value)) return `valeur de ${name}`;
  if (name === 'style') return forbiddenDeclarations(value);
  if (name === 'bgcolor') return unreadable(undefined, value) ? `bgcolor ${value}` : null;
  if (name === 'width' || name === 'height') return /^[1-9]\d{0,3}%?$/u.test(value) ? null : `${name} ${value}`;
  if (name === 'src') return tag === 'img' && /^(?:https:\/\/media\.legarec\.fr\/[\w./-]+|cid:[\w.@-]+)$/u.test(value) ? null : `src ${value}`;
  if (name === 'href')
    return tag === 'a' && /^(?:https:\/\/(?:[a-z]+\.)?legarec\.fr(?:\/[\w./-]*)?|mailto:[\w.-]+@legarec\.fr|tel:\+?\d+)$/u.test(value) ? null : `href ${value}`;
  if (tag === 'meta' && name === 'content') return /^(?:text\/html; ?charset=utf-8|width=device-width[\w=., -]*|light)$/iu.test(value) ? null : `meta ${value}`;
  if (tag === 'meta' && name === 'name') return /^(?:viewport|color-scheme|supported-color-schemes)$/u.test(value) ? null : `meta ${value}`;
  return null;
}

/** Elements whose content is not shown as ordinary text: no field, block nor partial inside. */
const RAW = new Set(['style', 'title', 'colgroup']);

/**
 * Returns the first construct outside the grammar, with its position.
 * A tag holds no marker, so it is whole in every branch: what is scanned is what is rendered.
 */
function scanHtml(html: string): { index: number; found: string } | null {
  // Once: read again at each tag, it made a large file slow to check.
  const lower = html.toLowerCase();
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) return null;
    // A tag is read within its first characters, never the whole rest of the file each time.
    const rest = html.slice(open, open + 20_000);
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
    const tag = /^<([a-z][a-z0-9]*)((?:[ \t\r\n]+[a-z][a-z-]*(?:="[^"<>\uE000\uE001]*")?)*)[ \t\r\n]*\/?>/iu.exec(rest);
    if (!tag || !TAGS.has(tag[1]!.toLowerCase())) return { index: open, found: rest.slice(0, 40).split('\n')[0] ?? '<' };
    const name = tag[1]!.toLowerCase();
    const seen = new Set<string>();
    for (const attribute of tag[2]!.matchAll(/([a-z][a-z-]*)(?:="([^"]*)")?/giu)) {
      const key = attribute[1]!.toLowerCase();
      const problem = seen.has(key) ? `attribut ${key} répété` : checkAttribute(name, key, attribute[2] ?? '');
      if (problem) return { index: open, found: problem };
      seen.add(key);
    }
    index = open + tag[0].length;
    if (RAW.has(name)) {
      const end = lower.indexOf(`</${name}>`, index);
      const content = html.slice(index, end < 0 ? undefined : end);
      const problem =
        end < 0
          ? `<${name}> non fermé`
          : MARKERS.test(content)
            ? `champ ou bloc dans <${name}>`
            : name === 'style'
              ? forbiddenSheet(content)
              : name === 'title' && content.includes('<')
                ? '<title>'
                : null;
      if (problem) return { index, found: problem };
      if (name !== 'colgroup') index = end;
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

  if (source.includes('�') || source.includes('\0') || MARKERS.test(source)) fail('Fichier illisible', 'Enregistrez-le en UTF-8');
  else pass(`Fichier ${sms ? 'texte' : 'HTML'} valide, encodé en UTF-8`);

  // Whitespace control would make the rendered text differ from the one checked here.
  if (/\{\{\{?~|~\}?\}\}/u.test(source)) fail('Contrôle des espaces interdit', 'Retirez les tildes {{~ et ~}}');

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
      fail(`Code d’accès interdit, ligne ${line}`, 'Le code d’accès n’est pas autorisé dans un modèle importé de ce type');
      return null;
    }
    return path.original;
  };
  const lines = source.split('\n');
  /** Character that follows a field: the link to the portal must fill the whole attribute. */
  const afterField = (node: Node) => lines[node.loc.end.line - 1]?.[node.loc.end.column];
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
          // A comment shows nothing, and hides no markup either: it would reach the preview as it is.
          if (/[<>]/u.test((node as hbs.AST.CommentStatement).value)) fail(`Commentaire refusé, ligne ${line}`, 'Un commentaire ne contient aucune balise');
          html += BLOCK + '\n'.repeat(node.loc.end.line - line);
          break;
        case 'MustacheStatement': {
          const mustache = node as hbs.AST.MustacheStatement;
          const written = (lines[line - 1] ?? '').slice(node.loc.start.column);
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
            html +=
              code === 'paiement.lien' && /<a(?:\s+[a-z-]+="[^"]*")*\s+href="$/u.test(html) && afterField(node) === '"' ? 'https://paiement.legarec.fr' : FIELD;
          }
          break;
        }
        case 'PartialStatement': {
          const partial = node as hbs.AST.PartialStatement;
          const name = partial.name.type === 'PathExpression' ? (partial.name as hbs.AST.PathExpression).original : '';
          if (!MANDATORY_BLOCKS.some((item) => item.code === name) || !simple(partial)) fail(`Bloc inconnu, ligne ${line}`, `{{> ${name || '?'}}}`);
          else if (root) blocks.add(name);
          html += BLOCK;
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
          html += BLOCK;
          walk(block.program.body, false);
          html += BLOCK;
          if (block.inverse) walk(block.inverse.body, false);
          html += BLOCK;
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
      .replace(/<[^>]*>|[\uE000\uE001]/gu, '')
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
    const measure = measureSms(html.replace(/[\uE000\uE001]/gu, ''));
    if (measure.unicode)
      warnings.push({ level: 'WARNING', label: 'SMS limité à 70 caractères', detail: `Caractères en cause : ${measure.unicodeChars.join(' ')}` });
  }
  return result(fields);
}
