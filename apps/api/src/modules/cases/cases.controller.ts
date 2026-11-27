import {
  accessCodeResponse,
  caseCheckResult,
  caseChoices,
  caseDetail,
  caseList,
  caseOpened,
  caseSearchQuery,
  REQUEST_BODIES,
  sendingOutcome,
} from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff, StaffOrDelegate } from '../../platform/access/access';
import { currentActor } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import { RateLimits, type RateLimit } from '../../platform/limits/rate-limits';
import { AccessCodes } from '../debtor-access/access-codes';
import { SendingsService } from '../reminders/sendings.service';
import { CasesService, type StaffActor } from './cases.service';
import { ContactsService } from './contacts.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
const me = () => currentActor() as StaffActor;
const REMINDERS: RateLimit = { name: 'case-reminders', max: 120, seconds: 3_600 };
const WithCases = () => Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER');
/** Whoever opens a case (D1). */
const Opens = () => Staff('DIRECTOR', 'COLLECTION_MANAGER');

@ApiTags('cases')
@Controller('staff/cases')
export class CasesController {
  constructor(
    @Inject(CasesService) private readonly cases: CasesService,
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(AccessCodes) private readonly codes: AccessCodes,
    @Inject(SendingsService) private readonly sendings: SendingsService,
    @Inject(RateLimits) private readonly limits: RateLimits,
  ) {}

  @Post('search')
  @WithCases()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: caseList })
  search(
    @Body({ schema: bodies['POST /cases/search'] }) { query }: In<'POST /cases/search'>,
    @Query({ schema: caseSearchQuery }) filters: z.infer<typeof caseSearchQuery>,
  ) {
    return this.cases.search(query, filters);
  }

  @Get('choices')
  @Opens()
  @ApiOkResponse({ standardSchema: caseChoices })
  choices() {
    return this.cases.choices(me());
  }

  /** In a body: the number of a sole trader names a person. */
  @Post('check')
  @Opens()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: caseCheckResult })
  check(@Body({ schema: bodies['POST /cases/check'] }) { creditorId, number }: In<'POST /cases/check'>) {
    return this.cases.check(creditorId, number);
  }

  @Post('assign')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  assign(@Body({ schema: bodies['POST /cases/assign'] }) { ids, officerId }: In<'POST /cases/assign'>) {
    return this.cases.assign(ids, officerId);
  }

  /**
   * The next e-mail reminder of each case chosen in the list (question 220). All the cases are read and acted on by the
   * caller, or nothing is done; then each one follows the rules of a single reminder: what they refuse is left out, with
   * its reason (`sendingOutcome`).
   */
  @Post('reminders')
  @WithCases()
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: sendingOutcome })
  async remindMany(@Body({ schema: bodies['POST /cases/reminders'] }) { ids }: In<'POST /cases/reminders'>) {
    // One request of the same count as a single reminder: the caps of each debtor stay the rule.
    await this.limits.take(REMINDERS, me().userId);
    return this.sendings.remindMany(ids);
  }

  @Post()
  @Opens()
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: caseOpened })
  open(@Body({ schema: bodies['POST /cases'] }) body: In<'POST /cases'>) {
    return this.cases.open(me(), body);
  }

  @Get(':id')
  @WithCases()
  @ApiOkResponse({ standardSchema: caseDetail })
  detail(@Param('id') id: string) {
    return this.cases.detail(me(), id);
  }

  @Post(':id/invoices')
  @Opens()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  addInvoices(@Param('id') id: string, @Body({ schema: bodies['POST /cases/:id/invoices'] }) body: In<'POST /cases/:id/invoices'>) {
    return this.cases.addToCase(me(), id, body);
  }

  @Get(':id/access-code')
  @WithCases()
  @ApiOkResponse({ standardSchema: accessCodeResponse })
  accessCode(@Param('id') id: string) {
    return this.codes.show(id);
  }

  @Post(':id/access-code/regenerate')
  @WithCases()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  renewAccessCode(
    @Param('id') id: string,
    @Body({ schema: bodies['POST /cases/:id/access-code/regenerate'] }) { version }: In<'POST /cases/:id/access-code/regenerate'>,
  ) {
    return this.codes.renew(id, version);
  }

  @Post(':id/notes')
  @WithCases()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  addNote(@Param('id') id: string, @Body({ schema: bodies['POST /cases/:id/notes'] }) { text }: In<'POST /cases/:id/notes'>) {
    return this.cases.addNote(id, text);
  }

  /**
   * A reminder to the debtor, from a case one acts on. Refused with its reason (409, `sendingRefusal`) when the rules of the
   * firm forbid it: caps of the debtor, hours, first letter, individual, closed case, values of the firm between brackets.
   */
  @Post(':id/reminders')
  @WithCases()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async remind(@Param('id') id: string, @Body({ schema: bodies['POST /cases/:id/reminders'] }) body: In<'POST /cases/:id/reminders'>) {
    // Far above what a day of work asks: a script gone wrong stops here, before the caps of each debtor.
    await this.limits.take(REMINDERS, me().userId);
    return this.sendings.remind(id, body);
  }

  /** The Director and the manager in their own right (question 138): the debtor of all its cases, for all the creditors. */
  @Put(':id/debtor')
  @Staff('DIRECTOR', 'COLLECTION_MANAGER')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  correctDebtor(@Param('id') id: string, @Body({ schema: bodies['PUT /cases/:id/debtor'] }) body: In<'PUT /cases/:id/debtor'>) {
    return this.cases.correctDebtor(id, body);
  }

  @Post(':id/coordinates')
  @WithCases()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  addContact(@Param('id') id: string, @Body({ schema: bodies['POST /cases/:id/coordinates'] }) body: In<'POST /cases/:id/coordinates'>) {
    return this.contacts.add(me(), id, body);
  }

  @Put(':id/coordinates/:coordinateId')
  @WithCases()
  @HttpCode(204)
  @ApiNoContentResponse()
  changeContact(
    @Param('id') id: string,
    @Param('coordinateId') contactId: string,
    @Body({ schema: bodies['PUT /cases/:id/coordinates/:coordinateId'] }) body: In<'PUT /cases/:id/coordinates/:coordinateId'>,
  ) {
    return this.contacts.change(id, contactId, body);
  }
}
