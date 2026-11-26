import type { depositAccepted, DepositItem, depositsData } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Database } from '../../platform/database/database';
import { conflict, notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';

/** The deposits shown at most: the oldest first, the team takes them in order. */
const SHOWN = 200;
type Line = { number: string; issuedOn: string; dueOn: string; amount: number };
const siretOf = (siret: string) => siret.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/u, '$1 $2 $3 $4');

/**
 * Claims deposited by creditors, waiting before they become cases (question 155). PostgreSQL decides who reads them (the
 * Director and the manager) and opens or refuses them (`app.accept_deposit`, `app.refuse_deposit`), each one audited.
 */
@Injectable()
export class DepositsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(): Promise<z.infer<typeof depositsData>> {
    const { tx } = this.database;
    const where = { status: 'PENDING' as const };
    const [rows, count] = await Promise.all([
      tx.claimDeposit.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: SHOWN }),
      tx.claimDeposit.count({ where }),
    ]);
    const creditors = new Map(
      (await tx.creditor.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.creditorId))] } }, select: { id: true, name: true } })).map((row) => [
        row.id,
        row.name,
      ]),
    );
    const items: DepositItem[] = rows.map((row) => ({
      id: row.id,
      creditorId: row.creditorId,
      creditor: creditors.get(row.creditorId) ?? '',
      debtor: row.debtorName ?? '',
      identifier: row.siret ? `SIRET ${siretOf(row.siret)}` : 'Particulier',
      address: row.address ?? '',
      email: row.email ?? '',
      phone: row.phone ?? '',
      invoices: ((row.invoices ?? []) as Line[]).map((line) => ({ number: line.number, issuedOn: line.issuedOn, dueOn: line.dueOn, amount: line.amount })),
      total: Number(row.totalCents),
      files: row.files.length,
      depositedOn: dayOf(row.createdAt),
    }));
    return { items, count };
  }

  /** Opened as a case held by nobody, under the mandate in force: the manager then gives it to an officer. */
  async accept(id: string, expectedTotal: number): Promise<z.infer<typeof depositAccepted>> {
    const [row] = await this.database.tx.$queryRaw<{ outcome: string | null; opened: string | null }[]>`
      SELECT outcome, opened FROM app.accept_deposit(${id}::uuid, ${expectedTotal}::bigint)`;
    if (!row?.outcome) throw notFound();
    if (row.outcome !== 'OPENED') throw conflict(row.outcome);
    return { caseId: row.opened! };
  }

  /** The reason is kept 30 days with the deposit, never in the audit. */
  async refuse(id: string, reason: string): Promise<void> {
    const [row] = await this.database.tx.$queryRaw<{ outcome: string | null }[]>`SELECT app.refuse_deposit(${id}::uuid, ${reason}) AS outcome`;
    if (!row?.outcome) throw notFound();
    if (row.outcome !== 'REFUSED') throw conflict(row.outcome);
  }
}
