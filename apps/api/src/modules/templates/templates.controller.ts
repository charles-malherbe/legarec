import { REQUEST_BODIES, templateDetail, templatesData } from '@legarec/contracts';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { AnyStaff, Staff, StaffOrDelegate } from '../../platform/access/access';
import { currentActor } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import type { StaffActor } from '../cases/cases.service';
import { TemplatesService } from './templates.service';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
/** Import, restore, submit: the Director and the manager (PostgreSQL checks it again). */
const Edits = () => Staff('DIRECTOR', 'COLLECTION_MANAGER');

@ApiTags('templates')
@Controller('staff/templates')
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @Get()
  @AnyStaff()
  @ApiOkResponse({ standardSchema: templatesData })
  list() {
    return this.templates.list();
  }

  @Get(':id')
  @AnyStaff()
  @ApiOkResponse({ standardSchema: templateDetail })
  detail(@Param('id') id: string) {
    return this.templates.detail(currentActor() as StaffActor, id);
  }

  @Post(':id/import')
  @Edits()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  import(@Param('id') id: string, @Body({ schema: bodies['POST /templates/:id/import'] }) { source, fileName }: In<'POST /templates/:id/import'>) {
    return this.templates.import(id, source, fileName);
  }

  @Delete(':id/import')
  @Edits()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  cancel(@Param('id') id: string) {
    return this.templates.cancel(id, false);
  }

  @Post(':id/import/undo')
  @Edits()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  undo(@Param('id') id: string) {
    return this.templates.cancel(id, true);
  }

  @Post(':id/restore')
  @Edits()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  restore(@Param('id') id: string, @Body({ schema: bodies['POST /templates/:id/restore'] }) { version }: In<'POST /templates/:id/restore'>) {
    return this.templates.restore(id, version);
  }

  @Post(':id/submit')
  @Edits()
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  submit(@Param('id') id: string, @Body({ schema: bodies['POST /templates/:id/submit'] }) { acknowledged }: In<'POST /templates/:id/submit'>) {
    return this.templates.submit(id, acknowledged);
  }

  /** The Director, or the manager on their behalf. */
  @Post(':id/review')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  review(@Param('id') id: string, @Body({ schema: bodies['POST /templates/:id/review'] }) { approved, reason }: In<'POST /templates/:id/review'>) {
    return this.templates.review(id, approved, reason);
  }
}
