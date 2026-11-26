import { inflateRawSync } from 'node:zlib';

/** What an Excel file of 5000 lines needs, far above: a sheet of 20 MB, 40 MB in all, 200 files. */
export const ZIP_LIMITS = { entries: 200, entry: 20 * 1024 * 1024, total: 40 * 1024 * 1024 };
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;

/**
 * Whether an archive keeps within `ZIP_LIMITS`, read before any library: the reader of Excel files reserves the memory each
 * file announces, so neither what the archive says nor what it hides is trusted. Every file is inflated here with a ceiling,
 * the sizes it announces must be the real ones, and the files must follow one another with nothing between them.
 */
export function withinZipLimits(bytes: Uint8Array, limits = ZIP_LIMITS): boolean {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const from = Math.max(0, data.length - 22 - 0xffff);
  let end = -1;
  for (let index = data.length - 22; index >= from; index -= 1) {
    if (data.readUInt32LE(index) === EOCD) {
      end = index;
      break;
    }
  }
  if (end < 0) return false;
  const count = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directory = data.readUInt32LE(end + 16);
  if (count === 0 || count > limits.entries || directory + directorySize !== end) return false;
  let at = directory;
  let next = 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || data.readUInt32LE(at) !== CENTRAL) return false;
    const flags = data.readUInt16LE(at + 8);
    const method = data.readUInt16LE(at + 10);
    const compressed = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const header = data.readUInt32LE(at + 42);
    at += 46 + data.readUInt16LE(at + 28) + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
    // Encrypted, ZIP64 or out of order: never in a file made by a spreadsheet for this use.
    if (flags & 1 || compressed === 0xffffffff || size === 0xffffffff || header !== next || size > limits.entry || total + size > limits.total) return false;
    if (header + 30 > directory || data.readUInt32LE(header) !== LOCAL) return false;
    const localCompressed = data.readUInt32LE(header + 18);
    const localSize = data.readUInt32LE(header + 22);
    if (!(flags & 8) && (localCompressed !== compressed || localSize !== size)) return false;
    if (localSize > limits.entry) return false;
    const start = header + 30 + data.readUInt16LE(header + 26) + data.readUInt16LE(header + 28);
    if (start + compressed > directory) return false;
    const body = data.subarray(start, start + compressed);
    let real: number;
    if (method === 0) real = compressed;
    else if (method === 8) {
      try {
        real = inflateRawSync(body, { maxOutputLength: Math.max(1, size) }).length;
      } catch {
        return false;
      }
    } else return false;
    if (real !== size) return false;
    total += size;
    next = start + compressed;
    if (flags & 8) {
      const signed = next + 4 <= directory && data.readUInt32LE(next) === DESCRIPTOR;
      next += signed ? 16 : 12;
    }
  }
  return at === end && next === directory;
}
