import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../../platform/config/config';
import { deriveKey, digest, Keyring } from '../../platform/crypto/keyring';

type Keys = Pick<Config, 'SESSION_SIGNING_KEY' | 'SESSION_SIGNING_KEY_PREVIOUS' | 'VAULT_MASTER_KEY' | 'VAULT_MASTER_KEY_PREVIOUS'>;
const bytes = (value: string | undefined) => (value ? [Buffer.from(value, 'base64')] : []);

/** Digests and secrets of the accounts: a copy of the database alone opens nothing. */
@Injectable()
export class AuthKeys {
  /** The current key, then the previous one while it is being renewed. */
  private readonly sessions: Buffer[];
  private readonly links: Buffer[];
  private readonly devices: Buffer;
  private readonly lookups: Buffer;
  /** Secrets of the authentication applications. */
  readonly vault: Keyring;

  constructor(@Inject(CONFIG) config: Keys) {
    const signing = [...bytes(config.SESSION_SIGNING_KEY), ...bytes(config.SESSION_SIGNING_KEY_PREVIOUS)];
    const [master, ...older] = [...bytes(config.VAULT_MASTER_KEY), ...bytes(config.VAULT_MASTER_KEY_PREVIOUS)] as [Buffer, ...Buffer[]];
    this.sessions = signing.map((key) => deriveKey(key, 'session'));
    this.links = signing.map((key) => deriveKey(key, 'link'));
    this.devices = deriveKey(signing[0]!, 'device');
    // Not from the signing key: renewing it must not forget a lock.
    this.lookups = deriveKey(master, 'lookup');
    this.vault = new Keyring(
      deriveKey(master, 'second-factor'),
      older.map((key) => deriveKey(key, 'second-factor')),
    );
  }

  sessionHash = (token: string): Buffer => digest(this.sessions[0]!, token);
  sessionHashes = (token: string): string[] => this.sessions.map((key) => digest(key, token).toString('hex'));
  linkHash = (token: string): Buffer => digest(this.links[0]!, token);
  linkHashes = (token: string): string[] => this.links.map((key) => digest(key, token).toString('hex'));
  deviceHash = (token: string): Buffer => digest(this.devices, token);
  /** Counter of the failures of an address or of an account, known or not. */
  attempt = (what: 'sign-in' | 'second-factor' | 'password' | 'debtor', of: string): Buffer => digest(this.lookups, `${what}:${of.trim().toLowerCase()}`);
}
