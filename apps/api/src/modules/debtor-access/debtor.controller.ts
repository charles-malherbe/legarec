import { debtorCase, debtorMessages, debtorSession, REQUEST_BODIES, uploadedFile } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Anonymous, Debtor } from '../../platform/access/access';
import { Staff } from '../../platform/access/access';
import { currentActor, uploadedType } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import { PortalMessages } from './portal-messages';
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
    @Inject(PortalMessages) private readonly messages: PortalMessages,
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

  @Get('cases/:id/messages')
  @Debtor()
  @ApiOkResponse({ standardSchema: debtorMessages })
  list(@Param('id') id: string) {
    return this.messages.list(id);
  }

  /** The access code is taken out of what the debtor writes, before anything keeps it. */
  @Post('cases/:id/messages')
  @Debtor()
  @HttpCode(204)
  @ApiNoContentResponse()
  write(
    @Param('id') id: string,
    @Body({ schema: bodies['POST /debtor/cases/:id/messages'] }) { text, attachmentKind, attachments }: In<'POST /debtor/cases/:id/messages'>,
  ) {
    return this.messages.write(id, text, attachmentKind, attachments);
  }

  @Post('cases/:id/messages/read')
  @Debtor()
  @HttpCode(204)
  @ApiNoContentResponse()
  read(@Param('id') id: string) {
    return this.messages.read(id);
  }

  @Post('cases/:id/requests')
  @Debtor()
  @HttpCode(204)
  @ApiNoContentResponse()
  request(@Param('id') id: string, @Body({ schema: bodies['POST /debtor/cases/:id/requests'] }) request: In<'POST /debtor/cases/:id/requests'>) {
    return this.messages.request(id, request);
  }

  /** The body is the file alone, without its name. */
  @Post('attachments')
  @Debtor()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: uploadedFile })
  attach(@Body({ schema: bodies['POST /debtor/attachments'] }) bytes: Uint8Array) {
    return this.messages.upload(bytes, uploadedType());
  }
}

/** The answers of the team in the space of the debtor. */
@ApiTags('cases')
@Controller('staff/cases/:id/portal-messages')
export class StaffPortalController {
  constructor(@Inject(PortalMessages) private readonly messages: PortalMessages) {}

  @Post()
  @Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  answer(@Param('id') id: string, @Body({ schema: REQUEST_BODIES.staff['POST /cases/:id/portal-messages'] }) { text }: { text: string }) {
    return this.messages.answer(id, text);
  }
}
