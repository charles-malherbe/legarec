import { Keyring } from '../../platform/crypto/keyring';
import type { Transaction } from '../../platform/database/database';
import { GiveUp } from '../../platform/queue/errors';
import type { JobDefinition, Run } from '../../platform/queue/jobs';
import { keysIn } from '../vault/internal-keys';
import type { Vault } from '../vault/vault';
import { bindingOf } from './access-codes';

const BATCH = 200;
const inCharge = async (tx: Transaction) => {
  const [row] = await tx.$queryRaw<{ may: boolean }[]>`SELECT app.acts_as_director('TECHNICAL') AS may`;
  return row?.may === true;
};

/** What an older key wrote is encrypted again. Those that no key opens are left as they are, and counted. */
export async function reseal(asApplication: Run, vault: Vault): Promise<{ resealed: number; unreadable: number }> {
  const counts = { resealed: 0, unreadable: 0 };
  let last = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const read = await asApplication(async (tx) => {
      const [current, ...previous] = await keysIn(tx, vault, 'ACCESS_CODE_KEY');
      const ring = new Keyring(current!, previous);
      const rows = await tx.debtorAccessCode.findMany({
        where: { debtorId: { gt: last } },
        select: { debtorId: true, codeCipher: true },
        orderBy: { debtorId: 'asc' },
        take: BATCH,
      });
      for (const { debtorId, codeCipher } of rows.filter((row) => ring.isOutdated(row.codeCipher))) {
        const binding = bindingOf(debtorId);
        let code: Buffer;
        try {
          code = ring.decrypt(codeCipher, binding);
        } catch {
          counts.unreadable += 1;
          continue;
        }
        // A code that was renewed meanwhile stays.
        const { count } = await tx.debtorAccessCode.updateMany({
          where: { debtorId, codeCipher },
          data: { codeCipher: new Uint8Array(ring.encrypt(code, binding)) },
        });
        counts.resealed += count;
      }
      return rows;
    });
    if (read.length < BATCH) return counts;
    last = read.at(-1)!.debtorId;
  }
}

/** Started by a renewal of the key, and every night for what it would have left. */
export const accessCodeJobs = (vault: Vault): Record<string, JobDefinition> => ({
  'reseal-access-codes': {
    from: ['STAFF'],
    repeatable: true,
    run: async ({ authorize }) => {
      const { unreadable } = await reseal(await authorize(inCharge), vault);
      if (unreadable) throw new GiveUp('UNREADABLE_CODES');
    },
  },
});
