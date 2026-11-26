import { litigationData, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { currentActor } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import type { StaffActor } from '../account/account.service';
import { LitigationService } from './litigation.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
const me = () => currentActor() as StaffActor;

/** Litigation in a minimal follow-up: whoever reads cases; the Developer reads none. */
@ApiTags('litigation')
@Controller('staff')
@Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
export class LitigationController {
  constructor(@Inject(LitigationService) private readonly litigation: LitigationService) {}

  @Post('cases/litigation')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async open(@Body({ schema: bodies['POST /cases/litigation'] }) body: In<'POST /cases/litigation'>) {
    await this.litigation.open(me(), body);
  }

  @Get('litigation')
  @ApiOkResponse({ standardSchema: litigationData })
  list() {
    return this.litigation.list(me());
  }

  @Put('litigation/:id')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async describe(@Param('id') id: string, @Body({ schema: bodies['PUT /litigation/:id'] }) body: In<'PUT /litigation/:id'>) {
    await this.litigation.describe(me(), id, body);
  }

  @Post('litigation/:id/stage')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async advance(@Param('id') id: string, @Body({ schema: bodies['POST /litigation/:id/stage'] }) body: In<'POST /litigation/:id/stage'>) {
    await this.litigation.advance(me(), id, body);
  }

  @Post('litigation/:id/consent')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async consent(@Param('id') id: string, @Body({ schema: bodies['POST /litigation/:id/consent'] }) body: In<'POST /litigation/:id/consent'>) {
    await this.litigation.consent(me(), id, body);
  }
}
