import { HOOK_BODIES } from '@legarec/contracts';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Hook } from '../../platform/access/access';
import { ResendEventsService } from './resend-events.service';

/** What the providers say of what was sent through them. Nobody signs in: the signature of each body is the proof. */
@ApiTags('hooks')
@Controller('hooks')
export class HooksController {
  constructor(@Inject(ResendEventsService) private readonly resend: ResendEventsService) {}

  /** An event of Resend about a reminder: 204 once written, or already known; 401 whatever is wrong with its signature. */
  @Post('resend')
  @Hook()
  @HttpCode(204)
  @ApiNoContentResponse()
  resendEvent(@Body({ schema: HOOK_BODIES['POST /hooks/resend'] }) body: Uint8Array) {
    return this.resend.receive(body);
  }
}
