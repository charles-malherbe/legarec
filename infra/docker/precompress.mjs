// Compresses the files of a built portal once, at the strongest level, next to each file (.zst, .br, .gz): Caddy serves
// them as they are (file_server precompressed) instead of compressing at each request. Run at build time only.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync, zstdCompressSync } from 'node:zlib';

const TEXT = /\.(?:js|mjs|css|html|svg|json|webmanifest|txt|xml)$/u;
const SMALLEST = 1024;
const root = process.argv[2];
if (!root) throw new Error('Usage: node precompress.mjs <folder>');

const files = (folder) =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });

let before = 0;
let after = 0;
for (const path of files(root)) {
  if (!TEXT.test(path) || statSync(path).size < SMALLEST) continue;
  const raw = readFileSync(path);
  const zst = zstdCompressSync(raw, { params: { [constants.ZSTD_c_compressionLevel]: 19 } });
  const br = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
  });
  // A compressed copy no smaller than the file is useless: the file is served as it is.
  if (zst.length < raw.length) writeFileSync(`${path}.zst`, zst);
  if (br.length < raw.length) writeFileSync(`${path}.br`, br);
  const gz = gzipSync(raw, { level: 9 });
  if (gz.length < raw.length) writeFileSync(`${path}.gz`, gz);
  before += raw.length;
  after += Math.min(raw.length, br.length);
}
console.log(`Précompression : ${Math.round(before / 1024)} Ko → ${Math.round(after / 1024)} Ko (brotli)`);
