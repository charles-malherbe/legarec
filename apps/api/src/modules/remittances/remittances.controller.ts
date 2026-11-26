import { REQUEST_BODIES, remittanceBatch, remittanceBatches, remittanceDraft, type RemittanceRow, type RemittanceState } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { StaffOrDelegate } from '../../platform/access/access';
import { Database } from '../../platform/database/database';
import { notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { Commits } from '../../platform/http/transaction.interceptor';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
interface Row {
  creditor_id: string;
  creditor: string;
  state: RemittanceState;
  payments: number;
  collected_cents: bigint;
  fee_net_cents: bigint;
  fee_vat_cents: bigint;
  to_pay_cents: bigint;
  bank_account_id: string | null;
  account: string | null;
  invoice?: string | null;
  reason?: string | null;
  credit_cents: bigint;
}
const rowOf = (row: Row): RemittanceRow => ({
  creditorId: row.creditor_id,
  creditor: row.creditor,
  state: row.state,
  payments: row.payments,
  collected: Number(row.collected_cents),
  feesNet: Number(row.fee_net_cents),
  feesVat: Number(row.fee_vat_cents),
  feesGross: Number(row.fee_net_cents + row.fee_vat_cents),
  credits: Number(row.credit_cents),
  toPay: Number(row.to_pay_cents),
  accountId: row.bank_account_id,
  account: row.account,
  invoice: row.invoice ?? null,
  reason: row.reason ?? null,
});
const yesterday = () => {
  const today = dayOf(new Date());
  return new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
};

/**
 * Remittances to the creditors: the Director, or the manager acting for them (docs/propositions, « Validation des
 * reversements »). Every amount comes from `app.remittance_draft()`, the same for what is shown and what is validated.
 */
@ApiTags('remittances')
@Controller('staff/remittances')
@StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
export class RemittancesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** What the next batch would be, with everything settled until yesterday (R2). */
  @Get('draft')
  @ApiOkResponse({ standardSchema: remittanceDraft })
  async draft(): Promise<z.infer<typeof remittanceDraft>> {
    const until = yesterday();
    const rows = (await this.database.tx.$queryRaw<Row[]>`SELECT * FROM app.remittance_draft(${until}::date)`).map(rowOf);
    const ready = rows.filter((row) => row.state === 'READY');
    return { until, rows, total: ready.reduce((sum, row) => sum + row.toPay, 0), transfers: ready.length };
  }

  @Post()
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: z.object({ id: z.string() }) })
  async validate(@Body({ schema: bodies['POST /remittances'] }) body: In<'POST /remittances'>): Promise<{ id: string }> {
    const [row] = await this.database.tx.$queryRaw<{ id: string }[]>`
      SELECT app.validate_remittances(${body.until}::date,
        ${JSON.stringify(body.expected.map((item) => ({ creditor_id: item.creditorId, to_pay_cents: item.toPay, bank_account_id: item.accountId })))}::jsonb,
        ${body.retained.map((item) => item.creditorId)}::uuid[], ${body.retained.map((item) => item.reason)}::text[]) AS id`;
    return { id: row!.id };
  }

  @Get()
  @ApiOkResponse({ standardSchema: remittanceBatches })
  list(): Promise<z.infer<typeof remittanceBatches>> {
    return this.batches(null);
  }

  private async batches(wanted: string | null): Promise<z.infer<typeof remittanceBatches>> {
    const rows = await this.database.tx.$queryRaw<
      {
        id: string;
        covers_until: Date;
        status: 'VALIDATED' | 'PAID';
        total_cents: bigint;
        transfers: number;
        validated_at: Date;
        validated_by: string;
        paid_on: Date | null;
      }[]
    >`SELECT * FROM app.remittance_batches(${wanted}::uuid)`;
    return {
      items: rows.map((row) => ({
        id: row.id,
        until: dayOf(row.covers_until),
        status: row.status,
        total: Number(row.total_cents),
        transfers: row.transfers,
        validatedAt: row.validated_at.toISOString(),
        validatedBy: row.validated_by,
        paidOn: row.paid_on ? dayOf(row.paid_on) : null,
      })),
    };
  }

  @Get(':id')
  @ApiOkResponse({ standardSchema: remittanceBatch })
  async detail(@Param('id') id: string): Promise<z.infer<typeof remittanceBatch>> {
    const [batch] = (await this.batches(id)).items;
    if (!batch) throw notFound();
    const rows = await this.database.tx.$queryRaw<Row[]>`SELECT * FROM app.remittance_batch(${id}::uuid)`;
    return { ...batch, rows: rows.map(rowOf) };
  }

  /** The transfers made at the bank (R5). */
  @Post(':id/paid')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async paid(@Param('id') id: string, @Body({ schema: bodies['POST /remittances/:id/paid'] }) body: In<'POST /remittances/:id/paid'>) {
    await this.database.tx.$executeRaw`SELECT app.mark_remittances_paid(${id}::uuid, ${body.paidOn}::date, ${body.expectedTotal}::bigint)`;
  }
}
