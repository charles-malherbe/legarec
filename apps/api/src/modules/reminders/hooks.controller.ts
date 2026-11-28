import { HOOK_BODIES } from '@legarec/contracts';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Hook } from '../../platform/access/access';
import { LetterEventsService } from './letter-events.service';
import { ResendEventsService } from './resend-events.service';

/** What the providers say of what was sent through them. Nobody signs in: the signature of a body, or the provider asked again. */
@ApiTags('hooks')
@Controller('hooks')
export class HooksController {
  constructor(
    @Inject(ResendEventsService) private readonly resend: ResendEventsService,
    @Inject(LetterEventsService) private readonly letters: LetterEventsService,
  ) {}

  /** An event of Resend about a reminder: 204 once written, or already known; 401 whatever is wrong with its signature. */
  @Post('resend')
  @Hook()
  @HttpCode(204)
  @ApiNoContentResponse()
  resendEvent(@Body({ schema: HOOK_BODIES['POST /hooks/resend'] }) body: Uint8Array) {
    return this.resend.receive(body);
  }

  /** An event of MySendingBox about a letter: 204 whatever it says. Unsigned: the worker asks MySendingBox itself. */
  @Post('mysendingbox')
  @Hook()
  @HttpCode(204)
  @ApiNoContentResponse()
  letterEvent(@Body({ schema: HOOK_BODIES['POST /hooks/mysendingbox'] }) body: Uint8Array) {
    return this.letters.receive(body);
  }
}
