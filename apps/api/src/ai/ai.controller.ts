import { Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Staff } from '../platform/access/access';
import { CONFIG, type Config } from '../platform/config/config';
import { Database } from '../platform/database/database';
import { ApiError, notFound } from '../platform/errors/api-error';
import { Commits } from '../platform/http/transaction.interceptor';
import { currentActor } from '../platform/http/context';
import { RateLimits } from '../platform/limits/rate-limits';
import { Outbox } from '../platform/queue/outbox';
import type { StaffActor } from '../modules/account/account.service';
import { SettingValues } from '../modules/settings/values';
import { aiSettings } from './ai.jobs';
import { aiSetup } from './provider';

/** The summary of a case (docs/ia.md): asked again by whoever acts on it, reported when it is wrong. */
@ApiTags('ai')
@Controller('staff/cases')
@Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
export class AiController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(RateLimits) private readonly limits: RateLimits,
  ) {}

  private async actsOn(id: string) {
    const [row] = await this.database.tx.$queryRaw<{ ok: boolean }[]>`SELECT app.can_act_on_case(officer_id) AS ok FROM cases WHERE id = ${id}::uuid`;
    if (!row) throw notFound();
    if (!row.ok) throw new ApiError(403, 'FORBIDDEN');
  }

  /** Off on the server, or in Paramètres › Assistant IA: 409 AI_OFF, nothing is asked. */
  @Post(':id/ai-summary')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async regenerate(@Param('id') id: string) {
    await this.actsOn(id);
    if (!aiSetup(this.config) || !aiSettings(await SettingValues.read(this.database.tx), 'ia4').on) throw new ApiError(409, 'AI_OFF');
    const by = (currentActor() as StaffActor).userId;
    // The budget is the firm's: twenty an hour per colleague; nothing new on the case, the worker does not call.
    await this.limits.take({ name: 'ai-summary', max: 20, seconds: 3600 }, by);
    await this.outbox.add({ queue: 'ai', name: 'case-summary', payload: { case: id, by } });
  }

  /** The last summary is wrong: kept in the journal as reported, no longer shown. */
  @Post(':id/ai-summary/report')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async report(@Param('id') id: string) {
    await this.actsOn(id);
    const { tx } = this.database;
    // The one shown: the last suggested, unless already reported.
    const last = await tx.aiSuggestion.findFirst({
      where: { caseId: id, outcome: 'SUGGESTED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, decision: true },
    });
    if (!last || last.decision === 'REPORTED') throw notFound();
    await tx.aiSuggestion.update({
      where: { id: last.id },
      // Who and when: set by PostgreSQL from the session.
      data: { decision: 'REPORTED' },
      select: { id: true },
    });
  }
}
