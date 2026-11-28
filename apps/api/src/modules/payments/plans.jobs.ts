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

const day = (value: Date) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(value);
const euros = (cents: number) => formatCents(cents, { decimals: 'always' });

/**
 * The PDF of a plan, once it waits for its debtor: what the debtor reads and accepts in its space (question 76), and whose
 * fingerprint is kept with its agreement. Values of the firm still between brackets: it waits, as the receipt does.
 */
/** `templates`: the folder `templates/pdf`, next to the sources as to the built programs. */
export const planJobs = (storage: Storage, pdf: PdfRenderer, templates: string): Record<string, JobDefinition> => {
  const template = Handlebars.compile(readFileSync(join(templates, 'payment-plan.hbs'), 'utf8'), { strict: true });
  return {
    'plan-pdf': {
      // The team asks for a plan; the creditor's agreement makes a long one come to the debtor; plans already waiting at the
      // migration were queued by the application.
      from: ['STAFF', 'CREDITOR', 'SYSTEM'],
      repeatable: true,
      run: async ({ payload, authorize }) => {
        const id = String(payload.plan);
        const seen = async (tx: Transaction) => (await tx.paymentPlan.count({ where: { id } })) === 1;
        const asApplication = await authorize(seen);
        const facts = await asApplication(async (tx) => {
          const plan = await tx.paymentPlan.findUnique({
            where: { id },
            select: {
              status: true,
              documentId: true,
              caseId: true,
              creditorId: true,
              totalCents: true,
              method: true,
              installments: { orderBy: { number: 'asc' }, select: { number: true, dueOn: true, amountCents: true } },
              case: { select: { reference: true, debtor: { select: { name: true } }, creditor: { select: { name: true } } } },
            },
          });
          return plan && { plan, values: await SettingValues.read(tx) };
        });
        if (!facts) throw new GiveUp('UNKNOWN_PLAN');
        const { plan, values } = facts;
        // Already written, or no longer proposed (accepted, refused, cancelled in the meantime): nothing to write.
        if (plan.documentId || plan.status !== 'WAITING_DEBTOR') return;
        const firm = (field: string) => values.text('firm', 'cabinet', field);
        const count = plan.installments.length;
        const html = template({
          firm: { name: firm('name'), address: firm('address'), phone: firm('phone'), siren: firm('siren') },
          creditor: { name: plan.case.creditor.name },
          debtor: { name: plan.case.debtor.name },
          case: { reference: plan.case.reference },
          plan: { total: euros(plan.totalCents), count, transfer: plan.method === 'TRANSFER' },
          installments: plan.installments.map((row) => ({ number: `${row.number}/${count}`, dueOn: day(row.dueOn), amount: euros(row.amountCents) })),
          payment: {
            holder: firm('holder'),
            iban: firm('iban'),
            bic: firm('bic'),
            chequePayee: firm('chequePayee'),
            chequeAddress: firm('chequeAddress'),
          },
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
                caseId: plan.caseId,
                creditorId: plan.creditorId,
                category: 'PAYMENT_PLAN',
                kind: 'PDF',
                title: `Échéancier ${plan.case.reference}`,
                originalName: `echeancier-${plan.case.reference}.pdf`,
                storageKey: stored.key,
                sizeBytes: stored.size,
                sha256: stored.sha256,
                source: 'GENERATED',
                visibleToDebtor: true,
                scanStatus: 'CLEAN',
                scannedAt: new Date(),
              },
              select: { id: true },
            });
            // Once, and only while it is proposed: the debtor accepts this file and no other.
            const { count: written } = await tx.paymentPlan.updateMany({
              where: { id, documentId: null, status: 'WAITING_DEBTOR' },
              data: { documentId: document.id, documentSha256: stored.sha256 },
            });
            if (!written) throw new GiveUp('ALREADY_WRITTEN');
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
