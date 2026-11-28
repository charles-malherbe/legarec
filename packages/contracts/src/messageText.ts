import { z } from 'zod';

/**
 * Text of a message written by an employee, with its few marks: `**bold**`, `*italic*`, a line `- ` for a bullet, a
 * line `1. ` for a numbered item; a blank line between two blocks; `\*` and `\\` for the characters themselves. The
 * editor of the espace writes it, a draft or a template keeps it as text, and the API reads it into blocks that the
 * template of the kit escapes (DECISIONS.md, 28/11/2026): no HTML ever comes from the browser.
 */
export const messageRun = z.object({ text: z.string().min(1), bold: z.literal(true).optional(), italic: z.literal(true).optional() });
export type MessageRun = z.infer<typeof messageRun>;
const runs = z.array(messageRun).min(1);
export const messageBlock = z.union([
  z.object({ paragraph: runs }).strict(),
  z.object({ bullets: z.array(runs).min(1) }).strict(),
  z.object({ numbers: z.array(runs).min(1) }).strict(),
]);
export type MessageBlock = z.infer<typeof messageBlock>;

const BULLET = /^[-•]\s+/u;
const NUMBER = /^\d{1,3}[.)]\s+/u;

/** `**` and `*` that open and close a mark; one left alone is a character. */
export function readRuns(line: string): MessageRun[] {
  const tokens: { kind: 'text' | '**' | '*'; value: string }[] = [];
  let text = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (char === '\\' && (line[index + 1] === '*' || line[index + 1] === '\\')) {
      text += line[index + 1];
      index += 1;
    } else if (char === '*') {
      if (text) tokens.push({ kind: 'text', value: text });
      text = '';
      const double = line[index + 1] === '*';
      tokens.push({ kind: double ? '**' : '*', value: double ? '**' : '*' });
      if (double) index += 1;
    } else text += char;
  }
  if (text) tokens.push({ kind: 'text', value: text });
  // A mark without its pair is written as typed.
  for (const kind of ['**', '*'] as const) {
    const marks = tokens.filter((token) => token.kind === kind);
    if (marks.length % 2 === 1) Object.assign(marks.at(-1) ?? {}, { kind: 'text' });
  }
  const result: MessageRun[] = [];
  let bold = false;
  let italic = false;
  for (const token of tokens) {
    if (token.kind === '**') bold = !bold;
    else if (token.kind === '*') italic = !italic;
    else {
      const last = result.at(-1);
      if (last && !!last.bold === bold && !!last.italic === italic) last.text += token.value;
      else result.push({ text: token.value, ...(bold ? { bold: true as const } : {}), ...(italic ? { italic: true as const } : {}) });
    }
  }
  return result.some((run) => run.text.trim()) ? result : [];
}

/** The blocks of a paragraph of text: a list when each of its lines is an item of the same kind. */
export function readBlock(paragraph: string): MessageBlock | null {
  const lines = paragraph
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const items = (pattern: RegExp) => lines.map((line) => readRuns(line.replace(pattern, ''))).filter((item) => item.length > 0);
  if (lines.every((line) => BULLET.test(line))) return { bullets: items(BULLET) };
  if (lines.every((line) => NUMBER.test(line))) return { numbers: items(NUMBER) };
  const read = readRuns(lines.join('\n'));
  return read.length > 0 ? { paragraph: read } : null;
}

/** The whole text, cut at blank lines. */
export const readMessage = (text: string): MessageBlock[] =>
  text
    .replace(/\r\n?/gu, '\n')
    .split(/\n[^\S\n]*\n/u)
    .flatMap((paragraph) => readBlock(paragraph) ?? []);

/** What the marks leave to read: the preview of an e-mail, a search. */
export const plainOf = (block: MessageBlock): string =>
  'paragraph' in block
    ? block.paragraph.map((run) => run.text).join('')
    : ('bullets' in block ? block.bullets : block.numbers).map((item) => item.map((run) => run.text).join('')).join(' · ');

const escapeMarks = (text: string) => text.replace(/[\\*]/gu, (char) => `\\${char}`);
/** Runs written back with their marks: what the editor saves. */
export function writeRuns(list: MessageRun[]): string {
  return list
    .map((run) => {
      const text = escapeMarks(run.text);
      // The marks hold the words, not the spaces around them: « **Bonjour** » rather than « ** Bonjour** ».
      const [, before = '', core = '', after = ''] = /^(\s*)([\s\S]*?)(\s*)$/u.exec(text) ?? [];
      if (!core) return text;
      const mark = (run.bold ? '**' : '') + (run.italic ? '*' : '');
      const close = (run.italic ? '*' : '') + (run.bold ? '**' : '');
      return `${before}${mark}${core}${close}${after}`;
    })
    .join('');
}
export const writeMessage = (blocks: MessageBlock[]): string =>
  blocks
    .map((block) =>
      'paragraph' in block
        ? writeRuns(block.paragraph)
        : 'bullets' in block
          ? block.bullets.map((item) => `- ${writeRuns(item)}`).join('\n')
          : block.numbers.map((item, index) => `${index + 1}. ${writeRuns(item)}`).join('\n'),
    )
    .filter(Boolean)
    .join('\n\n');
