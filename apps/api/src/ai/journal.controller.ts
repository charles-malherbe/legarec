import { AI_JOURNAL_PAGE, aiJournal, aiJournalQuery } from '@legarec/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../platform/access/access';
import { Database } from '../platform/database/database';

interface Line {
  id: string;
  created_at: Date;
  feature: 'CASE_SUMMARY';
  outcome: z.infer<typeof aiJournal>['items'][number]['outcome'];
  decision: z.infer<typeof aiJournal>['items'][number]['decision'];
  model: string | null;
  prompt_version: string;
  input_summary: string;
  input_tokens: number;
  output_tokens: number;
  cost_micro: bigint;
  colleague: string | null;
  case_reference: string | null;
}
interface Totals {
  total: bigint;
  suggested: bigint;
  accepted: bigint;
  modified: bigint;
  ignored: bigint;
  reported: bigint;
}

/**
 * The journal of the assistant (docs/ia.md), in Paramètres › Assistant IA: every try, with what was sent in short, the
 * model, the version of the prompt, the decision and the cost; never the suggestion nor the text sent. The Director and
 * the Developer only (question 178); PostgreSQL checks it again, and gives the reference of a case to whoever may read it.
 */
@ApiTags('ai')
@Controller('staff/ai')
@Staff('DIRECTOR', 'DEVELOPER')
export class AiJournalController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('journal')
  @ApiOkResponse({ standardSchema: aiJournal })
  async journal(
    @Query({ schema: aiJournalQuery }) { page = 1, size = AI_JOURNAL_PAGE }: z.infer<typeof aiJournalQuery>,
  ): Promise<z.infer<typeof aiJournal>> {
    const { tx } = this.database;
    const lines = await tx.$queryRaw<Line[]>`SELECT * FROM app.ai_journal(${size}::integer, ${(page - 1) * size}::integer)`;
    const [totals] = await tx.$queryRaw<Totals[]>`SELECT * FROM app.ai_journal_totals()`;
    return {
      items: lines.map((line) => ({
        id: line.id,
        at: line.created_at.toISOString(),
        feature: line.feature,
        caseReference: line.case_reference,
        input: line.input_summary,
        model: line.model,
        promptVersion: line.prompt_version,
        outcome: line.outcome,
        decision: line.decision,
        colleague: line.colleague,
        tokens: line.input_tokens + line.output_tokens,
        costMicro: Number(line.cost_micro),
      })),
      page,
      pageSize: size,
      total: Number(totals?.total ?? 0n),
      last30Days: {
        suggested: Number(totals?.suggested ?? 0n),
        accepted: Number(totals?.accepted ?? 0n),
        modified: Number(totals?.modified ?? 0n),
        ignored: Number(totals?.ignored ?? 0n),
        reported: Number(totals?.reported ?? 0n),
      },
    };
  }
}
