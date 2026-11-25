import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 1;
const KEY_ID_BYTES = 4;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + KEY_ID_BYTES;

const keyId = (key: Buffer) => createHash('sha256').update('legarec-key-id').update(key).digest().subarray(0, KEY_ID_BYTES);

/** Where a value is stored. Bound to the ciphertext: copied to another row, it no longer opens. */
export interface Binding {
  table: string;
  id: string;
  column: string;
}
const aad = (binding: Binding, header: Buffer) => Buffer.concat([header, Buffer.from(`${binding.table}\u0000${binding.id}\u0000${binding.column}`)]);

/** AES-256-GCM with the key version in the header, so that a key can be renewed without any cut. */
export class Keyring {
  private readonly keys = new Map<string, Buffer>();
  private readonly currentId: Buffer;

  constructor(
    private readonly current: Buffer,
    previous: readonly Buffer[] = [],
  ) {
    for (const key of [current, ...previous]) {
      if (key.length !== 32) throw new Error('A key is 32 bytes long');
      this.keys.set(keyId(key).toString('hex'), key);
    }
    this.currentId = keyId(current);
  }

  encrypt(value: string | Buffer, binding: Binding): Buffer {
    const header = Buffer.concat([Buffer.from([VERSION]), this.currentId]);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.current, iv);
    cipher.setAAD(aad(binding, header));
    const data = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([header, iv, cipher.getAuthTag(), data]);
  }

  decrypt(blob: Uint8Array, binding: Binding): Buffer {
    const bytes = Buffer.from(blob);
    if (bytes.length < HEADER_BYTES + IV_BYTES + TAG_BYTES || bytes[0] !== VERSION) throw new Error('Unknown ciphertext');
    const header = bytes.subarray(0, HEADER_BYTES);
    const key = this.keys.get(header.subarray(1).toString('hex'));
    if (!key) throw new Error('Unknown key version');
    const iv = bytes.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
    const tag = bytes.subarray(HEADER_BYTES + IV_BYTES, HEADER_BYTES + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(binding, header));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES + IV_BYTES + TAG_BYTES)), decipher.final()]);
  }

  /** True when the value was written with an older key and should be encrypted again. */
  isOutdated(blob: Uint8Array): boolean {
    return !Buffer.from(blob).subarray(1, HEADER_BYTES).equals(this.currentId);
  }
}

/** One key per use: the leak of one of them opens nothing else. */
export function deriveKey(master: Buffer, usage: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, 'legarec', usage, 32));
}

/** Keyed digest of a token or of an identifier: a copy of the database alone does not give it back. */
export function digest(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export function sameDigest(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Opaque token: 256 bits for a session or an invitation. */
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
