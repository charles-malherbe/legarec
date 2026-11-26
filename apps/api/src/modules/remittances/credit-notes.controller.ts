import { creditNotesData, REQUEST_BODIES, type CreditNoteFollowUp, type CreditNoteScope } from '@legarec/contracts';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { StaffOrDelegate } from '../../platform/access/access';
import { Database } from '../../platform/database/database';
import { conflict, forbidden } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { Commits } from '../../platform/http/transaction.interceptor';
import { PLACEHOLDER } from '../../platform/pdf/pdf';
import { nextPayoutDay } from '../partners/payouts';
import { SettingValues } from '../settings/values';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
type Data = z.infer<typeof creditNotesData>;
interface Read {
  invoices: (Omit<Data['invoices'][number], 'client'> & { creditorId: string })[];
  items: (Omit<Data['items'][number], 'client' | 'invoiceStatus'> & { creditorId: string; invoiceLeft: number })[];
  drafts: (Omit<Data['drafts'][number], 'client' | 'lines'> & { creditorId: string; lines: { line_id: string; net_cents: number }[] })[];
  nextNumber: string;
}
/** The identity of the firm printed on a credit note: nothing leaves while one of them is still between brackets. */
const FIRM_FIELDS = ['name', 'address', 'phone', 'siren', 'vat', 'rcs'] as const;
const linesOf = (lines: { lineId: string; net: number }[]) => JSON.stringify(lines.map((line) => ({ line_id: line.lineId, net_cents: line.net })));

/**
 * Credit notes of the firm (docs/propositions, « Avoir »): the Director, or the manager acting for them, as all of the
 * billing. Every amount is checked again by `app.issue_credit_note`, under the lock of the remittances.
 */
@ApiTags('remittances')
@Controller('staff/credit-notes')
@StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
export class CreditNotesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  @ApiOkResponse({ standardSchema: creditNotesData })
  async list(): Promise<Data> {
    const tx = this.database.tx;
    const [{ data }] = (await tx.$queryRaw<{ data: Read }[]>`SELECT app.credit_notes() AS data`) as [{ data: Read }];
    const ids = [...new Set([...data.invoices, ...data.items, ...data.drafts].map((item) => item.creditorId))];
    const creditors = new Map(
      (
        await tx.creditor.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, legalName: true, address: true, postalCode: true, city: true, siren: true, vatNumber: true },
        })
      ).map((item) => [
        item.id,
        {
          id: item.id,
          name: item.name,
          legalName: item.legalName || item.name,
          address: [item.address, [item.postalCode, item.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
          siren: item.siren,
          vatNumber: item.vatNumber || null,
        },
      ]),
    );
    const clientOf = (id: string) => creditors.get(id) ?? { id, name: '', legalName: '', address: '', siren: null, vatNumber: null };
    const values = await SettingValues.read(tx);
    const firm = (field: string) => values.text('firm', 'cabinet', field);
    return {
      invoices: data.invoices.map(({ creditorId, ...invoice }) => ({ ...invoice, client: clientOf(creditorId) })),
      items: data.items.map(({ creditorId, invoiceLeft, ...item }) => ({
        ...item,
        client: clientOf(creditorId),
        invoiceStatus: invoiceLeft > 0 ? ('PARTIAL' as const) : ('CANCELLED' as const),
      })),
      drafts: data.drafts.map(({ creditorId, lines, ...draft }) => ({
        ...draft,
        client: clientOf(creditorId).name,
        lines: lines.map((line) => ({ lineId: line.line_id, net: line.net_cents })),
        updatedAt: new Date(draft.updatedAt).toISOString(),
      })),
      nextNumber: data.nextNumber,
      nextRemittance: nextPayoutDay(values.text('firm', 'reversements', 'frequency') || 'Mensuelle, le 15', dayOf(new Date())),
      firm: {
        name: firm('name'),
        address: firm('address'),
        phone: firm('phone'),
        siren: firm('siren'),
        vat: firm('vat'),
        rcs: firm('rcs'),
      },
    };
  }

  /** Issued: numbered, immutable; refused if the invoice changed since it was shown (409 CHANGED) or the firm is incomplete. */
  @Post()
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: z.object({ id: z.string(), number: z.string() }) })
  async issue(@Body({ schema: bodies['POST /credit-notes'] }) body: In<'POST /credit-notes'>): Promise<{ id: string; number: string }> {
    const tx = this.database.tx;
    // Who acts first: the state of the firm is told to those who may issue only.
    const [{ allowed }] = (await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.acts_as_director('ADMINISTRATIVE') AS allowed`) as [{ allowed: boolean }];
    if (!allowed) throw forbidden();
    const values = await SettingValues.read(tx);
    const missing = FIRM_FIELDS.map((field) => values.text('firm', 'cabinet', field)).filter((value) => !value.trim() || PLACEHOLDER.test(value));
    if (missing.length) throw conflict('FIRM_INCOMPLETE', { missing: missing.map((value) => value.match(PLACEHOLDER)?.[0] ?? '').filter(Boolean) });
    const [made] = await tx.$queryRaw<{ id: string; number: string }[]>`
      SELECT credit_note AS id, credit_number AS number FROM app.issue_credit_note(${body.invoiceId}::uuid, ${body.scope}::credit_note_scope,
        ${linesOf(body.lines)}::jsonb, ${body.reason}, ${body.followUp}::credit_note_follow_up, ${body.expectedLeft}::bigint, ${body.draftId}::uuid)`;
    return made!;
  }

  @Post('drafts')
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: z.object({ id: z.string() }) })
  async create(@Body({ schema: bodies['POST /credit-notes/drafts'] }) body: In<'POST /credit-notes/drafts'>): Promise<{ id: string }> {
    return { id: await this.save(null, body) };
  }

  @Put('drafts/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async change(@Param('id') id: string, @Body({ schema: bodies['PUT /credit-notes/drafts/:id'] }) body: In<'PUT /credit-notes/drafts/:id'>) {
    await this.save(id, body);
  }

  @Delete('drafts/:id')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string) {
    await this.database.tx.$executeRaw`SELECT app.delete_credit_note_draft(${id}::uuid)`;
  }

  private async save(
    id: string | null,
    body: { invoiceId: string; scope: CreditNoteScope; lines: { lineId: string; net: number }[]; reason: string; followUp: CreditNoteFollowUp | null },
  ) {
    const [saved] = await this.database.tx.$queryRaw<{ id: string }[]>`
      SELECT app.save_credit_note_draft(${id}::uuid, ${body.invoiceId}::uuid, ${body.scope}::credit_note_scope, ${linesOf(body.lines)}::jsonb, ${body.reason},
        ${body.followUp}::credit_note_follow_up) AS id`;
    return saved!.id;
  }
}
