import { Keyring } from '../../platform/crypto/keyring';
import type { Transaction } from '../../platform/database/database';
import type { JobDefinition } from '../../platform/queue/jobs';
import { keysIn } from '../vault/internal-keys';
import type { Vault } from '../vault/vault';
import { bindingOf } from './access-codes';

const BATCH = 200;
const inCharge = async (tx: Transaction) => {
  const [row] = await tx.$queryRaw<{ may: boolean }[]>`SELECT app.acts_as_director('TECHNICAL') AS may`;
  return row?.may === true;
};

/** After a renewal of the key: what an older one wrote is encrypted again. */
export const accessCodeJobs = (vault: Vault): Record<string, JobDefinition> => ({
  'reseal-access-codes': {
    from: ['STAFF'],
    repeatable: true,
    run: async ({ authorize }) => {
      const asApplication = await authorize(inCharge);
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
          for (const { debtorId, codeCipher } of rows) {
            if (!ring.isOutdated(codeCipher)) continue;
            const binding = bindingOf(debtorId);
            // A code that was renewed meanwhile stays.
            await tx.debtorAccessCode.updateMany({
              where: { debtorId, codeCipher },
              data: { codeCipher: new Uint8Array(ring.encrypt(ring.decrypt(codeCipher, binding), binding)) },
            });
          }
          return rows;
        });
        if (read.length < BATCH) return;
        last = read.at(-1)!.debtorId;
      }
    },
  },
});
