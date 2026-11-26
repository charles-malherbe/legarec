export type FileKind = 'PDF' | 'DOCX' | 'PNG' | 'JPEG';

const starts = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(text, 0, 'latin1');

/** What a PDF may not carry: code that runs, or that opens something else. */
const ACTIVE_PDF = ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia', '/SubmitForm', '/ImportData'];
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
  // A Word document is a zip archive with its own entries; a macro-enabled one is refused.
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && contains(bytes, 'word/document.xml') && !contains(bytes, 'vbaProject.bin')) return 'DOCX';
  return null;
}

/** Accepted: the real type is that announced, and a PDF holds nothing active (names may be written `/J#61vaScript`: refused too). */
export function checkFile(bytes: Uint8Array, declared: string): FileKind | null {
  const kind = kindOf(bytes);
  if (!kind || DECLARED[kind] !== declared.split(';')[0]!.trim().toLowerCase()) return null;
  if (
    kind === 'PDF' &&
    (ACTIVE_PDF.some((name) => new RegExp(`${name.replace('/', '\\/')}(?![A-Za-z])`, 'u').test(Buffer.from(bytes).toString('latin1'))) ||
      /\/[A-Za-z]*#[0-9A-Fa-f]{2}/u.test(Buffer.from(bytes).toString('latin1')))
  )
    return null;
  return kind;
}

export const CONTENT_TYPES = DECLARED;
