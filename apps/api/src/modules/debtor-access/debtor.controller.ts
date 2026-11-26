import { debtorCase, debtorSession, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Anonymous, Debtor } from '../../platform/access/access';
import { currentActor } from '../../platform/http/context';
import { DebtorSignIn } from '../auth/debtor-sign-in';
import { DebtorViews } from './debtor-views';

const bodies = REQUEST_BODIES.debtor;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
const me = () => (currentActor() as { kind: 'debtor'; debtorId: string }).debtorId;

/** paiement.legarec.fr: no account, an identifier and a code. */
@ApiTags('debtor')
@Controller('debtor')
export class DebtorController {
  constructor(
    @Inject(DebtorSignIn) private readonly signIn: DebtorSignIn,
    @Inject(DebtorViews) private readonly views: DebtorViews,
  ) {}

  @Get('session')
  @Debtor()
  @ApiOkResponse({ standardSchema: debtorSession })
  session() {
    return this.views.session(me());
  }

  /** Same answer for an unknown identifier and a wrong code: `INVALID`, `LOCKED`, `BLOCKED`, `TOO_MANY`. */
  @Post('access')
  @Anonymous('debtor')
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: debtorSession })
  async access(@Body({ schema: bodies['POST /debtor/access'] }) { identifier, code, remember }: In<'POST /debtor/access'>) {
    const debtorId = await this.signIn.access(identifier, code, remember);
    return this.signIn.asDebtor(debtorId, () => this.views.session(debtorId));
  }

  @Post('logout')
  @Anonymous('debtor')
  @HttpCode(204)
  @ApiNoContentResponse()
  logout() {
    return this.signIn.close();
  }

  @Get('cases/:id')
  @Debtor()
  @ApiOkResponse({ standardSchema: debtorCase })
  detail(@Param('id') id: string) {
    return this.views.detail(id);
  }
}
