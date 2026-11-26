import type { Transaction } from '../../platform/database/database';
import { GiveUp, TryLater } from '../../platform/queue/errors';
import type { JobDefinition } from '../../platform/queue/jobs';
import type { Scanner } from '../../platform/scanner/scanner';
import type { Storage } from '../../platform/storage/storage';

/**
 * ClamAV reads each file received, before anyone may open it. Infected: the file is erased, the row stays (who sent what,
 * when). Without an antivirus (production without `CLAMAV_URL`), the files wait, unread.
 */
export const documentJobs = (storage: Storage, scanner: Scanner | null): Record<string, JobDefinition> => ({
  'scan-document': {
    from: ['STAFF', 'CREDITOR', 'DEBTOR'],
    repeatable: true,
    run: async ({ payload, authorize }) => {
      const id = String(payload.document);
      // Whoever sent it still sees it: then the application reads it.
      const seen = async (tx: Transaction) => (await tx.document.count({ where: { id } })) === 1;
      const asApplication = await authorize(seen);
      const found = await asApplication((tx) => tx.document.findUnique({ where: { id }, select: { storageKey: true, scanStatus: true } }));
      if (!found) throw new GiveUp('UNKNOWN_DOCUMENT');
      if (found.scanStatus !== 'PENDING') return;
      if (!scanner) throw new TryLater('NO_ANTIVIRUS');
      let verdict: 'CLEAN' | 'INFECTED';
      try {
        verdict = await scanner.scan(await storage.read(found.storageKey));
      } catch {
        throw new TryLater('ANTIVIRUS_UNAVAILABLE');
      }
      await asApplication((tx) => tx.document.updateMany({ where: { id, scanStatus: 'PENDING' }, data: { scanStatus: verdict, scannedAt: new Date() } }));
      if (verdict === 'INFECTED') await storage.remove(found.storageKey);
    },
  },
});
