import { portalCase, portalCases, portalDashboard, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Partner } from '../../platform/access/access';
import { Commits } from '../../platform/http/transaction.interceptor';
import { PortalService } from './portal.service';

const bodies = REQUEST_BODIES.partner;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;

/** partenaires.legarec.fr: a creditor and nothing but its own cases. */
@ApiTags('partner')
@Controller('partner/portal')
export class PortalController {
  constructor(@Inject(PortalService) private readonly portal: PortalService) {}

  @Get('dashboard')
  @Partner()
  @ApiOkResponse({ standardSchema: portalDashboard })
  dashboard() {
    return this.portal.dashboard();
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
}
