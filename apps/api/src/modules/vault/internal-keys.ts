import type { InternalSecret } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { deriveKey, Keyring } from '../../platform/crypto/keyring';
import { Database, type Transaction } from '../../platform/database/database';
import { conflict } from '../../platform/errors/api-error';
import { Vault } from './vault';

/** What an older key wrote is encrypted again before the next renewal: these are for what was being written meanwhile. */
const KEPT = 5;
/** Renewed from the screen: that of the mailboxes, with the mailboxes. */
const RENEWABLE: readonly string[] = ['ACCESS_CODE_KEY', 'LOOKUP_KEY'] satisfies InternalSecret[];
interface Row {
  id: string;
  value_cipher: Uint8Array;
}
const draw = () => randomBytes(32).toString('base64');
const read = async (tx: Transaction, name: InternalSecret): Promise<Row | undefined> =>
  (await tx.$queryRaw<Row[]>`SELECT id, value_cipher FROM app.internal_key(${name}::secret_name)`)[0];

/** Keys drawn by the API and kept in the vault, the current one first. Read with the transaction that needs them. */
@Injectable()
export class InternalKeys {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Vault) private readonly vault: Vault,
  ) {}

  async ring(name: InternalSecret): Promise<Keyring> {
    const [current, ...previous] = await this.keys(name);
    return new Keyring(current!, previous);
  }

  async keys(name: InternalSecret): Promise<Buffer[]> {
    return keysIn(this.database.tx, this.vault, name);
  }

  /** The previous ones still open what they wrote. */
  async renew(name: InternalSecret): Promise<void> {
    const { tx } = this.database;
    const row = await read(tx, name);
    if (!row || !RENEWABLE.includes(name)) throw conflict('CHANGED');
    const known = JSON.parse(this.vault.open(row.id, row.value_cipher)) as string[];
    // A digest is never written again: what it was made with stays for good.
    const values = [draw(), ...known].slice(0, name === 'LOOKUP_KEY' ? undefined : KEPT);
    const [done] = await tx.$queryRaw<{ done: boolean }[]>`
      SELECT app.renew_internal_key(${row.id}::uuid, ${this.vault.seal(row.id, JSON.stringify(values))}, ${row.value_cipher}, ${(await this.ring(name)).id}) AS done`;
    if (!done!.done) throw conflict('RESEAL_PENDING');
  }
}

export async function keysIn(tx: Transaction, vault: Vault, name: InternalSecret): Promise<Buffer[]> {
  let row = await read(tx, name);
  if (!row) {
    const id = randomUUID();
    await tx.$executeRaw`SELECT app.first_internal_key(${id}::uuid, ${name}::secret_name, ${vault.seal(id, JSON.stringify([draw()]))})`;
    // That of someone else, when both drew one at the same time.
    row = await read(tx, name);
  }
  return (JSON.parse(vault.open(row!.id, row!.value_cipher)) as string[]).map((value) => deriveKey(Buffer.from(value, 'base64'), name));
}
