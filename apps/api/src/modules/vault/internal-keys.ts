import type { InternalSecret } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { deriveKey, Keyring } from '../../platform/crypto/keyring';
import { Database, type Transaction } from '../../platform/database/database';
import { conflict } from '../../platform/errors/api-error';
import { Vault } from './vault';

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

  async renew(name: InternalSecret): Promise<void> {
    const { tx } = this.database;
    const row = await read(tx, name);
    if (!row || !RENEWABLE.includes(name)) throw conflict('CHANGED');
    // No former one is ever thrown away: whatever it wrote, or is writing now, still opens, and a digest is never made again.
    const values = [draw(), ...(JSON.parse(this.vault.open(row.id, row.value_cipher)) as string[])];
    await tx.$executeRaw`SELECT app.renew_internal_key(${row.id}::uuid, ${this.vault.seal(row.id, JSON.stringify(values))}, ${row.value_cipher})`;
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
