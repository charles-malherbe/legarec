import { REQUEST_BODIES, ticketSent } from '@legarec/contracts';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { AnyStaff } from '../../platform/access/access';
import type { Actor } from '../../platform/database/actor';
import { Database } from '../../platform/database/database';
import { currentActor } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import { RateLimits, type RateLimit } from '../../platform/limits/rate-limits';
import { Outbox } from '../../platform/queue/outbox';

const body = REQUEST_BODIES.staff['POST /support-tickets'];
/** Each one is an e-mail. */
const TICKETS: RateLimit = { name: 'support-ticket', max: 10, seconds: 3_600 };

@ApiTags('support')
@Controller('staff/support-tickets')
@AnyStaff()
export class SupportController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(RateLimits) private readonly limits: RateLimits,
  ) {}

  @Post()
  @Commits()
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: ticketSent })
  async open(@Body({ schema: body }) { subject, message }: z.infer<typeof body>): Promise<z.infer<typeof ticketSent>> {
    await this.limits.take(TICKETS, (currentActor() as Extract<Actor, { kind: 'staff' }>).userId);
    const [row] = await this.database.tx.$queryRaw<{ ticket: string; ticket_number: string }[]>`SELECT * FROM app.open_ticket(${subject}, ${message})`;
    await this.outbox.add({ queue: 'email', name: 'support-ticket', payload: { ticketId: row!.ticket } });
    return { number: row!.ticket_number };
  }
}
