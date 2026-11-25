import { creditorChoices, creditorCreated, creditorDetail, creditorFile, creditorListItem, REQUEST_BODIES, revealedIban } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Staff, StaffOrDelegate } from '../../platform/access/access';
import { RequiresProof } from '../../platform/access/proof';
import { currentActor } from '../../platform/http/context';
import { Commits, OneTimeAnswer } from '../../platform/http/transaction.interceptor';
import { CreditorsService, type StaffActor } from './creditors.service';

const bodies = REQUEST_BODIES.staff;
const me = () => currentActor() as StaffActor;

@ApiTags('creditors')
@Controller('staff/creditors')
export class CreditorsController {
  constructor(@Inject(CreditorsService) private readonly creditors: CreditorsService) {}

  @Get()
  @Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
  @ApiOkResponse({ standardSchema: z.array(creditorListItem) })
  list() {
    return this.creditors.list();
  }

  @Get('choices')
  @Staff('DIRECTOR', 'COLLECTION_MANAGER')
  @ApiOkResponse({ standardSchema: creditorChoices })
  choices() {
    return this.creditors.choices(me());
  }

  @Get(':id')
  @Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
  @ApiOkResponse({ standardSchema: creditorDetail })
  detail(@Param('id') id: string) {
    return this.creditors.detail(me(), id);
  }

  @Get(':id/file')
  @Staff('DIRECTOR', 'COLLECTION_MANAGER')
  @ApiOkResponse({ standardSchema: creditorFile })
  file(@Param('id') id: string) {
    return this.creditors.file(me(), id);
  }

  @Post()
  @Staff('DIRECTOR', 'COLLECTION_MANAGER')
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: creditorCreated })
  create(@Body({ schema: bodies['POST /creditors'] }) body: z.infer<(typeof bodies)['POST /creditors']>) {
    return this.creditors.create(me(), body);
  }

  @Put(':id')
  @Staff('DIRECTOR', 'COLLECTION_MANAGER')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  change(@Param('id') id: string, @Body({ schema: bodies['PUT /creditors/:id'] }) body: z.infer<(typeof bodies)['PUT /creditors/:id']>) {
    return this.creditors.change(me(), id, body);
  }

  @Post(':id/amendments')
  @Staff('DIRECTOR', 'COLLECTION_MANAGER')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  amend(@Param('id') id: string, @Body({ schema: bodies['POST /creditors/:id/amendments'] }) body: z.infer<(typeof bodies)['POST /creditors/:id/amendments']>) {
    return this.creditors.amend(me(), id, body);
  }

  @RequiresProof()
  @Post(':id/bank-accounts')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  replace(
    @Param('id') id: string,
    @Body({ schema: bodies['POST /creditors/:id/bank-accounts'] }) body: z.infer<(typeof bodies)['POST /creditors/:id/bank-accounts']>,
  ) {
    return this.creditors.replaceAccount(me(), id, body);
  }

  @RequiresProof()
  @Post(':id/bank-accounts/:accountId/confirm')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  confirm(
    @Param('id') id: string,
    @Param('accountId') accountId: string,
    @Body({ schema: bodies['POST /creditors/:id/bank-accounts/:accountId/confirm'] })
    { confirmedWith }: z.infer<(typeof bodies)['POST /creditors/:id/bank-accounts/:accountId/confirm']>,
  ) {
    return this.creditors.confirmAccount(me(), id, accountId, confirmedWith);
  }

  @Post(':id/bank-accounts/:accountId/reveal')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @Commits()
  @OneTimeAnswer()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: revealedIban })
  reveal(@Param('id') id: string, @Param('accountId') accountId: string) {
    return this.creditors.reveal(id, accountId);
  }
}
