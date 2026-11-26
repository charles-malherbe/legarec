import { inflateRawSync, inflateSync } from 'node:zlib';

export type FileKind = 'PDF' | 'DOCX' | 'PNG' | 'JPEG';

const starts = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
const latin = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
/** Decompressed at most, in all, for one file: beyond it the file is refused rather than read further (zip bomb). */
const INFLATED_MAX = 64 * 1024 * 1024;

/** What a PDF may not carry: code that runs, actions that start alone, or that open something else. */
const ACTIVE_PDF = ['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'RichMedia', 'SubmitForm', 'ImportData', 'AA', 'XFA', 'GoToR', 'GoToE', 'Rendition'];
const ACTIVE = new RegExp(`/(?:${ACTIVE_PDF.join('|')})(?![A-Za-z0-9])`, 'u');
const DECLARED: Record<FileKind, string> = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
};

/** The real type of a file, read in its first bytes; null when it is none of the accepted ones. */
export function kindOf(bytes: Uint8Array): FileKind | null {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'PDF';
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'PNG';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'JPEG';
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && latin(bytes).includes('word/document.xml')) return 'DOCX';
  return null;
}

/**
 * The text of a PDF, its compressed streams opened (objects included, since PDF 1.5): null when a stream cannot be opened
 * or opens to too much. Names written in hexadecimal (`/J#61vaScript`) are refused by the caller.
 */
function pdfText(bytes: Uint8Array): string | null {
  const raw = latin(bytes);
  const parts = [raw];
  let total = 0;
  const streams = /stream\r?\n/gu;
  for (let found = streams.exec(raw); found; found = streams.exec(raw)) {
    const start = found.index + found[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) return null;
    const dictionary = raw.slice(Math.max(0, raw.lastIndexOf('<<', found.index)), found.index);
    if (/\/FlateDecode/u.test(dictionary)) {
      try {
        const opened = inflateSync(Buffer.from(bytes.buffer, bytes.byteOffset + start, end - start), { maxOutputLength: INFLATED_MAX - total });
        total += opened.byteLength;
        parts.push(opened.toString('latin1'));
      } catch {
        // Images and fonts may end with a few bytes too many: only a stream that holds objects must open.
        if (/\/Type\s*\/(?:ObjStm|XRef)/u.test(dictionary)) return null;
      }
    } else if (/\/Type\s*\/ObjStm/u.test(dictionary) && /\/Filter/u.test(dictionary)) {
      // Objects compressed some other way: unreadable here, refused.
      return null;
    }
    streams.lastIndex = end + 'endstream'.length;
  }
  return parts.join('\n');
}

/** Entries of a Word document: neither macro, nor embedded object, nor ActiveX, nor a relation to the outside. */
function docxIsPlain(bytes: Uint8Array): boolean {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  let offset = 0;
  let entries = 0;
  while (offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50) {
    const flags = data.readUInt16LE(offset + 6);
    const method = data.readUInt16LE(offset + 8);
    const size = data.readUInt32LE(offset + 18);
    const nameLength = data.readUInt16LE(offset + 26);
    const extraLength = data.readUInt16LE(offset + 28);
    const name = data.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    // Sizes given after the data, or out of the file: not read further.
    if (flags & 0x08 || start + size > data.length || (entries += 1) > 2000) return false;
    if (/(?:^|\/)(?:embeddings|activeX)\/|vbaProject|\.bin$/iu.test(name)) return false;
    if (name.endsWith('.rels')) {
      let xml: string;
      try {
        const part = data.subarray(start, start + size);
        const opened = method === 8 ? inflateRawSync(part, { maxOutputLength: INFLATED_MAX - total }) : method === 0 ? part : null;
        if (!opened) return false;
        total += opened.byteLength;
        xml = opened.toString('utf8');
      } catch {
        return false;
      }
      if (/TargetMode\s*=\s*["']External["']/iu.test(xml) || /attachedTemplate|oleObject|subDocument/iu.test(xml)) return false;
    }
    offset = start + size;
  }
  return entries > 0;
}

/** Accepted: the real type is that announced, and nothing active is inside (PDF and Word). */
export function checkFile(bytes: Uint8Array, declared: string): FileKind | null {
  const kind = kindOf(bytes);
  if (!kind || DECLARED[kind] !== declared.split(';')[0]!.trim().toLowerCase()) return null;
  if (kind === 'PDF') {
    const text = pdfText(bytes);
    if (text === null || ACTIVE.test(text) || /\/[A-Za-z]*#[0-9A-Fa-f]{2}/u.test(text)) return null;
  }
  if (kind === 'DOCX' && !docxIsPlain(bytes)) return null;
  return kind;
}

/** The text of a file as far as it can be read here (PDF streams opened), for the invoice numbers it carries. */
export function readableText(bytes: Uint8Array, kind: FileKind): string {
  return kind === 'PDF' ? (pdfText(bytes) ?? '') : '';
}

export const CONTENT_TYPES = DECLARED;
