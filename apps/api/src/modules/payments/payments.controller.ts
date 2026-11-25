import { interestRates, planSimulation, plansData, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff, StaffOrDelegate } from '../../platform/access/access';
import { Audit } from '../../platform/audit/audit';
import { Database } from '../../platform/database/database';
import { currentActor } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import type { StaffActor } from '../cases/cases.service';
import { CasesService } from '../cases/cases.service';
import { Ledgers } from './ledger';
import { Plans } from './plans';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
const me = () => currentActor() as StaffActor;
const WithCases = () => Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER');

/** Cheques and transfers typed by hand, on the cases one acts on. */
@ApiTags('payments')
@Controller('staff/cases/:id/payments')
export class PaymentsController {
  constructor(
    @Inject(CasesService) private readonly cases: CasesService,
    @Inject(Ledgers) private readonly ledgers: Ledgers,
  ) {}

  @Post()
  @WithCases()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async record(@Param('id') id: string, @Body({ schema: bodies['POST /cases/:id/payments'] }) body: In<'POST /cases/:id/payments'>) {
    await this.cases.acting(id);
    await this.ledgers.record(id, body);
  }

  @Put(':paymentId')
  @WithCases()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async change(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body({ schema: bodies['PUT /cases/:id/payments/:paymentId'] }) { status, reason, version }: In<'PUT /cases/:id/payments/:paymentId'>,
  ) {
    await this.cases.acting(id);
    await this.ledgers.change(id, paymentId, status, reason ?? '', version);
  }
}

@ApiTags('payment-plans')
@Controller('staff/payment-plans')
export class PlansController {
  constructor(@Inject(Plans) private readonly plans: Plans) {}

  @Get()
  @WithCases()
  @ApiOkResponse({ standardSchema: plansData })
  list() {
    return this.plans.list(me());
  }

  @Get('simulation/:id')
  @WithCases()
  @ApiOkResponse({ standardSchema: planSimulation })
  simulation(@Param('id') id: string) {
    return this.plans.simulation(id);
  }

  @Post()
  @WithCases()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  create(@Body({ schema: bodies['POST /payment-plans'] }) body: In<'POST /payment-plans'>) {
    return this.plans.create(body);
  }

  /** The manager only (question 86): PostgreSQL checks it again. */
  @Put('requests/:id')
  @Staff('COLLECTION_MANAGER')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  decide(@Param('id') id: string, @Body({ schema: bodies['PUT /payment-plans/requests/:id'] }) body: In<'PUT /payment-plans/requests/:id'>) {
    return this.plans.decide(id, body.decision, body.reason, body.version);
  }
}

/** Rates of each semester (question 75): read by the team, typed by the Director or the manager on their behalf. */
@ApiTags('interest-rates')
@Controller('staff/interest-rates')
export class InterestRatesController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  @Get()
  @Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER', 'DEVELOPER')
  @ApiOkResponse({ standardSchema: interestRates })
  async list(): Promise<z.infer<typeof interestRates>> {
    const { tx } = this.database;
    const rows = await tx.interestRate.findMany({ orderBy: [{ validFrom: 'desc' }, { kind: 'asc' }] });
    const people = new Map(
      (await tx.user.findMany({ where: { id: { in: rows.map((row) => row.enteredBy) } }, select: { id: true, firstName: true, lastName: true } })).map(
        (user) => [user.id, `${user.firstName} ${user.lastName}`],
      ),
    );
    const actor = me();
    return {
      items: rows.map((row) => ({
        kind: row.kind,
        validFrom: row.validFrom.toISOString().slice(0, 10),
        rateBp: row.rateBp,
        enteredBy: people.get(row.enteredBy) ?? '',
        updatedAt: row.updatedAt.toISOString(),
      })),
      canEdit: actor.role === 'DIRECTOR' || actor.actingFor === 'ADMINISTRATIVE',
    };
  }

  @Put()
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async save(@Body({ schema: bodies['PUT /interest-rates'] }) { kind, validFrom, rateBp, expected }: In<'PUT /interest-rates'>) {
    await this.database.tx
      .$executeRaw`SELECT app.save_interest_rate(${kind}::interest_rate_kind, ${validFrom}::date, ${rateBp}::integer, ${expected}::integer)`;
    await this.audit.log({ action: kind === 'ECB' ? 'ECB_RATE_SAVED' : 'LEGAL_RATE_SAVED', params: { day: validFrom } });
  }
}
