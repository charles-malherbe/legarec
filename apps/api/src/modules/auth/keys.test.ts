import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthKeys } from './keys';

const key = () => randomBytes(32).toString('base64');
const config = () => ({ SESSION_SIGNING_KEY: key(), SESSION_SIGNING_KEY_PREVIOUS: undefined, VAULT_MASTER_KEY: key(), VAULT_MASTER_KEY_PREVIOUS: undefined });
const hex = (digest: Buffer) => digest.toString('hex');

describe('keys of the accounts', () => {
  it('are one for each use: what opens one opens no other', () => {
    const keys = new AuthKeys(config());
    const digests = [
      keys.sessionHash('x'),
      keys.linkHash('x'),
      keys.deviceHash('x'),
      keys.attempt('sign-in', 'x'),
      keys.attempt('second-factor', 'x'),
      keys.attempt('password', 'x'),
    ];
    expect(new Set(digests.map(hex)).size).toBe(digests.length);
  });

  it('count the same address as one, however it is typed', () => {
    const keys = new AuthKeys(config());
    expect(hex(keys.attempt('sign-in', ' Alba@Exemple.TEST '))).toBe(hex(keys.attempt('sign-in', 'alba@exemple.test')));
    expect(hex(keys.attempt('sign-in', 'alba2@exemple.test'))).not.toBe(hex(keys.attempt('sign-in', 'alba@exemple.test')));
  });

  it('open what was given before their renewal, until the previous ones are withdrawn', () => {
    const before = config();
    const [old, at] = [new AuthKeys(before), { table: 'second_factors', id: '1', column: 'secret_cipher' }];
    const secret = old.vault.encrypt('SECRET', at);
    const renewed = { ...config(), SESSION_SIGNING_KEY_PREVIOUS: before.SESSION_SIGNING_KEY, VAULT_MASTER_KEY_PREVIOUS: before.VAULT_MASTER_KEY };
    const during = new AuthKeys(renewed);
    expect(during.sessionHashes('x')).toEqual([hex(during.sessionHash('x')), hex(old.sessionHash('x'))]);
    expect(during.linkHashes('x')).toEqual([hex(during.linkHash('x')), hex(old.linkHash('x'))]);
    expect(during.vault.decrypt(secret, at).toString()).toBe('SECRET');
    const after = new AuthKeys({ ...renewed, SESSION_SIGNING_KEY_PREVIOUS: undefined, VAULT_MASTER_KEY_PREVIOUS: undefined });
    expect(after.sessionHashes('x')).toEqual([hex(during.sessionHash('x'))]);
    expect(() => after.vault.decrypt(secret, at)).toThrow('Unknown key version');
  });

  it('keep a lock when the signing key alone is renewed', () => {
    const before = config();
    const after = new AuthKeys({ ...before, SESSION_SIGNING_KEY: key() });
    expect(hex(after.attempt('sign-in', 'x'))).toBe(hex(new AuthKeys(before).attempt('sign-in', 'x')));
    expect(hex(after.sessionHash('x'))).not.toBe(hex(new AuthKeys(before).sessionHash('x')));
  });
});
