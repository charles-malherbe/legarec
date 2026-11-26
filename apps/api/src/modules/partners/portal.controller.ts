import { importDone, importReport, portalCase, portalCases, portalDashboard, portalPayouts, REQUEST_BODIES, uploadedFile } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Partner } from '../../platform/access/access';
import { uploadedType } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import { Database } from '../../platform/database/database';
import { ClaimImports } from './imports';
import { payouts } from './payouts';
import { PortalService } from './portal.service';

const bodies = REQUEST_BODIES.partner;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;

/** partenaires.legarec.fr: a creditor and nothing but its own cases. */
@ApiTags('partner')
@Controller('partner/portal')
export class PortalController {
  constructor(
    @Inject(PortalService) private readonly portal: PortalService,
    @Inject(ClaimImports) private readonly imports: ClaimImports,
    @Inject(Database) private readonly database: Database,
  ) {}

  @Get('dashboard')
  @Partner()
  @ApiOkResponse({ standardSchema: portalDashboard })
  dashboard() {
    return this.portal.dashboard();
  }

  /** Its remittances: those made, and the next one as computed today. */
  @Get('payouts')
  @Partner()
  @ApiOkResponse({ standardSchema: portalPayouts })
  payouts() {
    return payouts(this.database.tx);
  }

  @Get('cases')
  @Partner()
  @ApiOkResponse({ standardSchema: portalCases })
  cases() {
    return this.portal.cases();
  }

  @Get('cases/:id')
  @Partner()
  @ApiOkResponse({ standardSchema: portalCase })
  detail(@Param('id') id: string) {
    return this.portal.detail(id);
  }

  /** Agreement of the creditor on a long plan (question 86): after the manager, before the debtor. */
  @Post('plans/:id/decision')
  @Partner()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  decide(@Param('id') id: string, @Body({ schema: bodies['POST /portal/plans/:id/decision'] }) { accepted, reason }: In<'POST /portal/plans/:id/decision'>) {
    return this.portal.decide(id, accepted, reason);
  }

  /** A claim opens a case held by nobody: the manager takes it. */
  @Post('claims')
  @Partner()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  deposit(@Body({ schema: bodies['POST /portal/claims'] }) body: In<'POST /portal/claims'>) {
    return this.portal.deposit(body);
  }

  /** The body is the file alone, without its name. */
  @Post('attachments')
  @Partner()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: uploadedFile })
  attach(@Body({ schema: bodies['POST /portal/attachments'] }) bytes: Uint8Array) {
    return this.portal.upload(bytes, uploadedType());
  }

  /** A CSV or Excel file of claims, read line by line: nothing is created before the confirmation. */
  @Post('imports')
  @Partner()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: importReport })
  readImport(@Body({ schema: bodies['POST /portal/imports'] }) bytes: Uint8Array) {
    return this.imports.read(bytes, uploadedType());
  }

  @Post('imports/:id/confirm')
  @Partner()
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: importDone })
  confirm(@Param('id') id: string) {
    return this.imports.confirm(id);
  }
}
