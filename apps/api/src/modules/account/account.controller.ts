import { accountData, backupCodes, REQUEST_BODIES, totpSetup, webauthnOptions } from '@legarec/contracts';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { AnyStaff } from '../../platform/access/access';
import { currentActor } from '../../platform/http/context';
import { NoTransaction } from '../../platform/http/transaction.interceptor';
import { AccountService, type StaffActor } from './account.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
const me = () => currentActor() as StaffActor;

@ApiTags('account')
@Controller('staff/account')
@AnyStaff()
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Get()
  @NoTransaction()
  @ApiOkResponse({ standardSchema: accountData })
  data() {
    return this.account.data(me());
  }

  @Put('profile')
  @HttpCode(204)
  @ApiNoContentResponse()
  saveProfile(@Body({ schema: bodies['PUT /account/profile'] }) body: In<'PUT /account/profile'>) {
    return this.account.saveProfile(me(), body);
  }

  @Put('absence')
  @HttpCode(204)
  @ApiNoContentResponse()
  saveAbsence(@Body({ schema: bodies['PUT /account/absence'] }) body: In<'PUT /account/absence'>) {
    return this.account.saveAbsence(me(), body);
  }

  @Put('notifications')
  @HttpCode(204)
  @ApiNoContentResponse()
  savePreferences(@Body({ schema: bodies['PUT /account/notifications'] }) body: In<'PUT /account/notifications'>) {
    return this.account.savePreferences(me(), body);
  }

  @Put('password')
  @NoTransaction()
  @HttpCode(204)
  @ApiNoContentResponse()
  changePassword(@Body({ schema: bodies['PUT /account/password'] }) body: In<'PUT /account/password'>) {
    return this.account.changePassword(me(), body);
  }

  @Post('two-factor/totp')
  @NoTransaction()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: totpSetup })
  startTotp() {
    return this.account.startTotp(me());
  }

  @Post('two-factor/totp/verify')
  @NoTransaction()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: backupCodes })
  verifyTotp(@Body({ schema: bodies['POST /account/two-factor/totp/verify'] }) { code }: In<'POST /account/two-factor/totp/verify'>) {
    return this.account.verifyTotp(me(), code);
  }

  @Post('two-factor/webauthn')
  @NoTransaction()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: webauthnOptions })
  keyOptions() {
    return this.account.keyOptions(me());
  }

  @Post('two-factor/webauthn/verify')
  @NoTransaction()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: backupCodes })
  verifyKey(@Body({ schema: bodies['POST /account/two-factor/webauthn/verify'] }) body: In<'POST /account/two-factor/webauthn/verify'>) {
    return this.account.verifyKey(me(), body);
  }

  @Delete('two-factor')
  @NoTransaction()
  @HttpCode(204)
  @ApiNoContentResponse()
  disable() {
    return this.account.disable(me());
  }

  @Delete('sessions/:id')
  @NoTransaction()
  @HttpCode(204)
  @ApiNoContentResponse()
  closeSession(@Param('id') id: string) {
    return this.account.closeSession(me(), id);
  }

  @Delete('sessions')
  @NoTransaction()
  @HttpCode(204)
  @ApiNoContentResponse()
  async closeOthers() {
    await this.account.closeOthers(me());
  }
}
