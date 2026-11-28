import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Health } from '../platform/access/access';
import { Database } from '../platform/database/database';
import { ApiError } from '../platform/errors/api-error';
import { NoTransaction } from '../platform/http/transaction.interceptor';
import { VALKEY, type Valkey } from '../platform/queue/valkey';

export const healthAnswer = z.object({ status: z.literal('ok') });

/** Answered to the monitoring (Hyperping): alive or not, and nothing about how. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(VALKEY) private readonly valkey: Valkey,
  ) {}

  @Get()
  @Health()
  @NoTransaction()
  @ApiOkResponse({ standardSchema: healthAnswer })
  async check(): Promise<z.infer<typeof healthAnswer>> {
    try {
      await Promise.all([this.database.ping(), this.valkey.ping()]);
    } catch {
      throw new ApiError(503, 'UNAVAILABLE');
    }
    return { status: 'ok' };
  }
}
