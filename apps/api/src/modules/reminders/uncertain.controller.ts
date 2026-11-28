import { REQUEST_BODIES, uncertainSendings } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { Commits } from '../../platform/http/transaction.interceptor';
import { UncertainSendingsService } from './uncertain.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;

/** Sendings that nobody can say left or not: decided by the Collection manager, or the Director on their cases. */
@ApiTags('reminders')
@Controller('staff/sendings')
@Staff('DIRECTOR', 'COLLECTION_MANAGER')
export class UncertainSendingsController {
  constructor(@Inject(UncertainSendingsService) private readonly sendings: UncertainSendingsService) {}

  @Get('uncertain')
  @ApiOkResponse({ standardSchema: uncertainSendings })
  list() {
    return this.sendings.list();
  }

  @Put(':id/settlement')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  settle(@Param('id') id: string, @Body({ schema: bodies['PUT /sendings/:id/settlement'] }) body: In<'PUT /sendings/:id/settlement'>) {
    return this.sendings.settle(id, body.outcome);
  }
}
