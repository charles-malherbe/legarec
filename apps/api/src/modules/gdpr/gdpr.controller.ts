import { gdprExport, gdprRegistry, REQUEST_BODIES, type GdprRequest } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff, StaffOrDelegate } from '../../platform/access/access';
import { Database } from '../../platform/database/database';
import { notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { Commits } from '../../platform/http/transaction.interceptor';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
const DAY_MS = 86_400_000;

/**
 * The registry of the requests of the debtors about their data. Written by whoever acts on the case; kept by the Director
 * and the manager acting for them. PostgreSQL checks who acts in each `app.gdpr_*` function.
 */
@ApiTags('gdpr')
@Controller('staff/gdpr/requests')
export class GdprController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Post()
  @Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async add(@Body({ schema: bodies['POST /gdpr/requests'] }) { caseId, kind, origin }: In<'POST /gdpr/requests'>) {
    await this.database.tx.$queryRaw`SELECT app.gdpr_request(${caseId}::uuid, ${kind}::gdpr_kind, ${origin})`;
  }

  @Get()
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @ApiOkResponse({ standardSchema: gdprRegistry })
  async list(): Promise<z.infer<typeof gdprRegistry>> {
    const rows = await this.database.tx.$queryRaw<
      {
        id: string;
        case_id: string;
        kind: GdprRequest['kind'];
        debtor: string;
        origin: string;
        received_on: Date;
        due_on: Date;
        status: GdprRequest['status'];
      }[]
    >`SELECT * FROM app.gdpr_registry()`;
    const today = Date.parse(`${dayOf(new Date())}T00:00:00Z`);
    return {
      items: rows.map((row) => ({
        id: row.id,
        caseId: row.case_id,
        kind: row.kind,
        debtor: row.debtor,
        origin: row.origin,
        receivedOn: dayOf(row.received_on),
        dueOn: dayOf(row.due_on),
        daysLeft: Math.round((row.due_on.getTime() - today) / DAY_MS),
        status: row.status,
      })),
    };
  }

  @Put(':id')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async answer(@Param('id') id: string, @Body({ schema: bodies['PUT /gdpr/requests/:id'] }) { status, reason }: In<'PUT /gdpr/requests/:id'>) {
    await this.database.tx.$executeRaw`SELECT app.gdpr_answer(${id}::uuid, ${status}::gdpr_status, ${reason ?? ''})`;
  }

  /** The file is named after the request, never after the debtor. */
  @Post(':id/export')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: gdprExport })
  async export(@Param('id') id: string): Promise<z.infer<typeof gdprExport>> {
    const [row] = await this.database.tx.$queryRaw<{ data: unknown }[]>`SELECT app.gdpr_export(${id}::uuid) AS data`;
    if (!row) throw notFound();
    return { fileName: `export-rgpd-${id}.json`, content: row.data };
  }
}
