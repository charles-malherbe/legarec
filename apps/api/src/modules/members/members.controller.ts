import { membersData, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff, StaffOrDelegate } from '../../platform/access/access';
import { RequiresProof } from '../../platform/access/proof';
import { currentActor } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import type { StaffActor } from '../account/account.service';
import { MembersService } from './members.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
const me = () => currentActor() as StaffActor;
/** The Director, or the manager on their behalf. */
const Administers = () => StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR');
/** The Director, the Developer for the team, or the manager. */
const Supports = () => StaffOrDelegate(['TECHNICAL', 'ADMINISTRATIVE'], 'DIRECTOR');

@ApiTags('members')
@Controller('staff/members')
export class MembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Get()
  @Staff('DIRECTOR', 'COLLECTION_MANAGER', 'DEVELOPER')
  @ApiOkResponse({ standardSchema: membersData })
  list() {
    return this.members.list(me());
  }

  @Post()
  @Administers()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  invite(@Body({ schema: bodies['POST /members'] }) body: In<'POST /members'>) {
    return this.members.invite(body);
  }

  @Delete(':id')
  @Administers()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  cancelInvitation(@Param('id') id: string) {
    return this.members.cancelInvitation(id);
  }

  @Post(':id/disable')
  @Administers()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  disable(@Param('id') id: string, @Body({ schema: bodies['POST /members/:id/disable'] }) body: In<'POST /members/:id/disable'>) {
    return this.members.disable(me(), id, body);
  }

  @Post(':id/enable')
  @Administers()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  enable(@Param('id') id: string) {
    return this.members.enable(id);
  }

  @RequiresProof()
  @Put(':id/role')
  @Administers()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  changeRole(@Param('id') id: string, @Body({ schema: bodies['PUT /members/:id/role'] }) { role }: In<'PUT /members/:id/role'>) {
    return this.members.changeRole(me(), id, role);
  }

  @Put(':id/extension')
  @StaffOrDelegate('TECHNICAL')
  @HttpCode(204)
  @ApiNoContentResponse()
  setExtension(@Param('id') id: string, @Body({ schema: bodies['PUT /members/:id/extension'] }) { extension }: In<'PUT /members/:id/extension'>) {
    return this.members.setExtension(id, extension);
  }

  @Post(':id/reset-link')
  @Supports()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  sendResetLink(@Param('id') id: string) {
    return this.members.support(me(), id, 'RESET_LINK');
  }

  @Post(':id/require-2fa')
  @Supports()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  requireSecondFactor(@Param('id') id: string) {
    return this.members.support(me(), id, 'SECOND_FACTOR_REQUIRED');
  }

  @RequiresProof()
  @Post(':id/reset-2fa')
  @Supports()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  resetSecondFactor(@Param('id') id: string) {
    return this.members.support(me(), id, 'SECOND_FACTOR_RESET');
  }

  @Post(':id/unlock')
  @Supports()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  unlock(@Param('id') id: string) {
    return this.members.support(me(), id, 'ACCOUNT_UNLOCKED');
  }
}
