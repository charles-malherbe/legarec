import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../../platform/config/config';
import { deriveKey, Keyring, type Binding } from '../../platform/crypto/keyring';

/** Values of the vault: encrypted here, bound to their line. */
@Injectable()
export class Vault {
  private readonly keys: Keyring;

  constructor(@Inject(CONFIG) config: Pick<Config, 'VAULT_MASTER_KEY' | 'VAULT_MASTER_KEY_PREVIOUS'>) {
    const key = (value: string) => deriveKey(Buffer.from(value, 'base64'), 'vault');
    this.keys = new Keyring(key(config.VAULT_MASTER_KEY), config.VAULT_MASTER_KEY_PREVIOUS ? [key(config.VAULT_MASTER_KEY_PREVIOUS)] : []);
  }

  seal = (id: string, value: string): Buffer => this.keys.encrypt(value, this.binding(id));
  open = (id: string, cipher: Uint8Array): string => this.keys.decrypt(cipher, this.binding(id)).toString();

  /** Anything else kept under the same key: bound to its own line and column. */
  sealFor = (binding: Binding, value: string): Buffer => this.keys.encrypt(value, binding);
  openFor = (binding: Binding, cipher: Uint8Array): string => this.keys.decrypt(cipher, binding).toString();

  private binding(id: string) {
    return { table: 'vault_secrets', id, column: 'value_cipher' };
  }
}
