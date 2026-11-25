import fc from 'fast-check';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveKey, digest, Keyring, newToken, sameDigest } from './keyring';

const at = (id: string, column = 'value_cipher') => ({ table: 'vault_secrets', id, column });

describe('keyring', () => {
  it('gives back any value, and never shows it in the ciphertext', () => {
    const ring = new Keyring(randomBytes(32));
    fc.assert(
      fc.property(fc.string({ minLength: 8 }), (value) => {
        const blob = ring.encrypt(value, at('1'));
        expect(ring.decrypt(blob, at('1')).toString()).toBe(value);
        expect(blob.includes(Buffer.from(value))).toBe(false);
      }),
    );
  });

  it('never produces the same ciphertext twice', () => {
    const ring = new Keyring(randomBytes(32));
    expect(ring.encrypt('KXPM', at('1')).equals(ring.encrypt('KXPM', at('1')))).toBe(false);
  });

  it('refuses a value copied to another row, column or table, and any altered byte', () => {
    const ring = new Keyring(randomBytes(32));
    const blob = ring.encrypt('secret', at('1'));
    expect(() => ring.decrypt(blob, at('2'))).toThrow();
    expect(() => ring.decrypt(blob, at('1', 'other'))).toThrow();
    expect(() => ring.decrypt(blob, { ...at('1'), table: 'users' })).toThrow();
    for (let index = 0; index < blob.length; index += 1) {
      const altered = Buffer.from(blob);
      altered[index] = altered[index]! ^ 1;
      expect(() => ring.decrypt(altered, at('1'))).toThrow();
    }
  });

  it('opens older values during a renewal, then only those still listed', () => {
    const [before, after] = [randomBytes(32), randomBytes(32)];
    const blob = new Keyring(before).encrypt('secret', at('1'));
    const both = new Keyring(after, [before]);
    expect(both.decrypt(blob, at('1')).toString()).toBe('secret');
    expect(both.isOutdated(blob)).toBe(true);
    expect(both.isOutdated(both.encrypt('secret', at('1')))).toBe(false);
    expect(() => new Keyring(after).decrypt(blob, at('1'))).toThrow('Unknown key version');
  });

  it('refuses a key that is too short', () => {
    expect(() => new Keyring(randomBytes(16))).toThrow();
  });
});

describe('derived keys and digests', () => {
  it('differ for each use', () => {
    const master = randomBytes(32);
    expect(deriveKey(master, 'session').equals(deriveKey(master, 'link'))).toBe(false);
    expect(deriveKey(master, 'session').equals(deriveKey(master, 'session'))).toBe(true);
  });
  it('compare without giving anything away on the length', () => {
    const key = randomBytes(32);
    expect(sameDigest(digest(key, 'a'), digest(key, 'a'))).toBe(true);
    expect(sameDigest(digest(key, 'a'), digest(key, 'b'))).toBe(false);
    expect(sameDigest(digest(key, 'a'), Buffer.alloc(3))).toBe(false);
  });
  it('draws tokens of 256 bits', () => {
    expect(Buffer.from(newToken(), 'base64url')).toHaveLength(32);
    expect(newToken()).not.toBe(newToken());
  });
});
