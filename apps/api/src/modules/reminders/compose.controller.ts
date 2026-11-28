import { composeData, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { Commits } from '../../platform/http/transaction.interceptor';
import { ComposeService } from './compose.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;

/** « Rédiger un courrier »: whoever acts on cases. */
@ApiTags('documents')
@Controller('staff/documents/compose')
@Staff('DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER')
export class ComposeController {
  constructor(@Inject(ComposeService) private readonly service: ComposeService) {}

  @Get()
  @ApiOkResponse({ standardSchema: composeData })
  data() {
    return this.service.data();
  }

  @Post()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  compose(@Body({ schema: bodies['POST /documents/compose'] }) body: In<'POST /documents/compose'>) {
    return this.service.compose(body);
  }

  @Post('draft')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  draft(@Body({ schema: bodies['POST /documents/compose/draft'] }) _body: In<'POST /documents/compose/draft'>) {
    return this.service.draft();
  }
}
