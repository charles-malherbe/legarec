import { reportsData, reportsQuery, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Put, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { forbidden, notFound } from '../../platform/errors/api-error';
import { ReportsService } from './reports.service';

const bodies = REQUEST_BODIES.staff;

/** The Developer reads no case: no figure of the portfolio for them. */
@ApiTags('reports')
@Controller('staff/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get()
  @Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
  @ApiOkResponse({ standardSchema: reportsData })
  read(@Query({ schema: reportsQuery }) { creditor }: z.infer<typeof reportsQuery>) {
    return this.reports.read(creditor);
  }

  /**
   * A scheduled report switched on or off: the Director and the manager. No report is sent yet (lots Q and R), so none
   * exists: every identifier is unknown, and nothing is stored that would look like a sending switched on.
   */
  @Put('scheduled/:id')
  @Staff('DIRECTOR', 'COLLECTION_MANAGER')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  async toggle(
    @Param('id') _id: string,
    @Body({ schema: bodies['PUT /reports/scheduled/:id'] }) _body: z.infer<(typeof bodies)['PUT /reports/scheduled/:id']>,
  ): Promise<never> {
    if (!(await this.reports.mayToggle())) throw forbidden();
    throw notFound();
  }
}
