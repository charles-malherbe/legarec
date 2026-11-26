import { dashboard, dashboardQuery, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Put, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { currentActor } from '../../platform/http/context';
import type { StaffActor } from '../account/account.service';
import { DashboardService } from './dashboard.service';

const bodies = REQUEST_BODIES.staff;
const me = () => currentActor() as StaffActor;

/** The Developer reads no case: no figure of the portfolio for them. */
@ApiTags('dashboard')
@Controller('staff/dashboard')
@Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOkResponse({ standardSchema: dashboard })
  read(@Query({ schema: dashboardQuery }) { creditor }: z.infer<typeof dashboardQuery>) {
    const actor = me();
    return this.dashboard.read(actor.role, actor.userId, creditor);
  }

  @Put('priorities/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async mark(
    @Param('id') id: string,
    @Body({ schema: bodies['PUT /dashboard/priorities/:id'] }) { done }: z.infer<(typeof bodies)['PUT /dashboard/priorities/:id']>,
  ) {
    await this.dashboard.mark(me().userId, id, done);
  }
}
