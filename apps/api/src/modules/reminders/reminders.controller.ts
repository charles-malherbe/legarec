import { agenda, REQUEST_BODIES, reminderPlanned, reminderTargets } from '@legarec/contracts';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { currentActor } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import type { StaffActor } from '../account/account.service';
import { RemindersService } from './reminders.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
const me = () => currentActor() as StaffActor;

/** The agenda of the reminders: whoever reads cases; the Developer reads none. */
@ApiTags('reminders')
@Controller('staff/reminders')
@Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
export class RemindersController {
  constructor(@Inject(RemindersService) private readonly reminders: RemindersService) {}

  @Get()
  @ApiOkResponse({ standardSchema: agenda })
  agenda() {
    return this.reminders.agenda(me());
  }

  @Get('targets')
  @ApiOkResponse({ standardSchema: reminderTargets })
  targets() {
    return this.reminders.targets(me());
  }

  @Post()
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: reminderPlanned })
  plan(@Body({ schema: bodies['POST /reminders'] }) body: In<'POST /reminders'>) {
    return this.reminders.plan(me(), body);
  }

  @Put(':id')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async change(@Param('id') id: string, @Body({ schema: bodies['PUT /reminders/:id'] }) body: In<'PUT /reminders/:id'>) {
    await this.reminders.change(me(), id, body);
  }

  @Delete(':id')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string) {
    await this.reminders.remove(me(), id);
  }
}
