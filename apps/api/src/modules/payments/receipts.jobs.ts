import { formatCents } from '@legarec/contracts';
import Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Transaction } from '../../platform/database/database';
import { FirmIncomplete, type PdfRenderer } from '../../platform/pdf/pdf';
import { GiveUp, TryLater } from '../../platform/queue/errors';
import type { JobDefinition } from '../../platform/queue/jobs';
import type { Storage } from '../../platform/storage/storage';
import { SettingValues } from '../settings/values';

const day = (value: Date) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }).format(value);
const LABELS = { INTEREST: 'Intérêts de retard', PRINCIPAL: 'Principal', FEES: 'Indemnités forfaitaires', OVERPAYMENT: 'Trop-perçu' } as const;

/**
 * The PDF of a receipt, once its payment is final. Values of the firm still between brackets: it waits, and is written as soon
 * as the Director has typed them. Generated here, it is clean and carries no access code.
 */
/** `templates`: the folder `templates/pdf`, next to the sources as to the built programs. */
export const receiptJobs = (storage: Storage, pdf: PdfRenderer, templates: string): Record<string, JobDefinition> => {
  const template = Handlebars.compile(readFileSync(join(templates, 'receipt.hbs'), 'utf8'), { strict: true });
  return {
    'receipt-pdf': {
      from: ['STAFF'],
      repeatable: true,
      run: async ({ payload, authorize }) => {
        const id = String(payload.receipt);
        const seen = async (tx: Transaction) => (await tx.receipt.count({ where: { id } })) === 1;
        const asApplication = await authorize(seen);
        const facts = await asApplication(async (tx) => {
          const receipt = await tx.receipt.findUnique({
            where: { id },
            select: {
              number: true,
              issuedAt: true,
              documentId: true,
              caseId: true,
              creditorId: true,
              payment: {
                select: {
                  method: true,
                  amountCents: true,
                  receivedOn: true,
                  allocations: { select: { component: true, amountCents: true, reversesId: true } },
                },
              },
              case: { select: { reference: true, debtor: { select: { name: true } }, creditor: { select: { name: true } } } },
            },
          });
          return receipt && { receipt, values: await SettingValues.read(tx) };
        });
        if (!facts) throw new GiveUp('UNKNOWN_RECEIPT');
        const { receipt, values } = facts;
        if (receipt.documentId) return;
        const firm = (field: string) => values.text('firm', 'cabinet', field);
        const sums = new Map<string, number>();
        for (const entry of receipt.payment.allocations.filter((item) => item.reversesId === null))
          sums.set(entry.component, (sums.get(entry.component) ?? 0) + entry.amountCents);
        const html = template({
          firm: { name: firm('name'), address: firm('address'), phone: firm('phone'), siren: firm('siren') },
          receipt: { number: receipt.number, date: day(receipt.issuedAt) },
          creditor: { name: receipt.case.creditor.name },
          debtor: { name: receipt.case.debtor.name },
          case: { reference: receipt.case.reference },
          payment: {
            method: receipt.payment.method === 'CHEQUE' ? 'Chèque' : 'Virement',
            receivedOn: day(receipt.payment.receivedOn),
            amount: formatCents(receipt.payment.amountCents, { decimals: 'always' }),
          },
          lines: (Object.keys(LABELS) as (keyof typeof LABELS)[])
            .filter((component) => sums.get(component))
            .map((component) => ({ label: LABELS[component], amount: formatCents(sums.get(component)!, { decimals: 'always' }) })),
        });
        let bytes: Buffer;
        try {
          bytes = await pdf.render(html);
        } catch (error) {
          if (error instanceof FirmIncomplete) throw new TryLater('FIRM_INCOMPLETE');
          throw error;
        }
        const stored = await storage.put(bytes);
        try {
          await asApplication(async (tx) => {
            const document = await tx.document.create({
              data: {
                caseId: receipt.caseId,
                creditorId: receipt.creditorId,
                category: 'RECEIPT',
                kind: 'PDF',
                title: `Quittance ${receipt.number}`,
                originalName: `quittance-${receipt.number}.pdf`,
                storageKey: stored.key,
                sizeBytes: stored.size,
                sha256: stored.sha256,
                source: 'GENERATED',
                // Downloaded by its debtor from its space.
                visibleToDebtor: true,
                scanStatus: 'CLEAN',
                scannedAt: new Date(),
              },
              select: { id: true },
            });
            // Once: a receipt never changes afterwards.
            const { count } = await tx.receipt.updateMany({ where: { id, documentId: null }, data: { documentId: document.id } });
            if (!count) throw new GiveUp('ALREADY_WRITTEN');
          });
        } catch (error) {
          await storage.remove(stored.key);
          if (error instanceof GiveUp && error.code === 'ALREADY_WRITTEN') return;
          throw error;
        }
      },
    },
  };
};
