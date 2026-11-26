import { depositAccepted, depositsData, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { Commits } from '../../platform/http/transaction.interceptor';
import { DepositsService } from './deposits.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;

/** Claims deposited by creditors, opened or refused by the Director and the manager in their own right (question 155). */
@ApiTags('deposits')
@Controller('staff/deposits')
@Staff('DIRECTOR', 'COLLECTION_MANAGER')
export class DepositsController {
  constructor(@Inject(DepositsService) private readonly deposits: DepositsService) {}

  @Get()
  @ApiOkResponse({ standardSchema: depositsData })
  list() {
    return this.deposits.list();
  }

  @Post(':id/accept')
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: depositAccepted })
  accept(@Param('id') id: string, @Body({ schema: bodies['POST /deposits/:id/accept'] }) { expectedTotal }: In<'POST /deposits/:id/accept'>) {
    return this.deposits.accept(id, expectedTotal);
  }

  @Post(':id/refuse')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  refuse(@Param('id') id: string, @Body({ schema: bodies['POST /deposits/:id/refuse'] }) { reason }: In<'POST /deposits/:id/refuse'>) {
    return this.deposits.refuse(id, reason);
  }
}
