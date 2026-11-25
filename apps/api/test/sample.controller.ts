import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Anonymous, AnyStaff, Debtor, Partner, Public, Staff, StaffOrDelegate } from '../src/platform/access/access';
import { Audit } from '../src/platform/audit/audit';
import { Database } from '../src/platform/database/database';
import { notFound } from '../src/platform/errors/api-error';
import { Commits, OneTimeAnswer } from '../src/platform/http/transaction.interceptor';
import { Outbox } from '../src/platform/queue/outbox';

const note = z.object({ text: z.string().min(1).max(20), password: z.string().optional() });

/** Routes of the tests only: one per kind of rule, so that the platform is proved before any real route. */
@Controller('staff/sample')
export class StaffSampleController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  @Get('cases')
  @AnyStaff()
  cases() {
    return this.database.tx.case.findMany({ select: { id: true, creditor: { select: { name: true } } } });
  }

  @Get('cases/:id')
  @AnyStaff()
  async one(@Param('id') id: string) {
    const found = await this.database.tx.case.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw notFound();
    await this.database.tx.$executeRaw`SELECT app.note_consultation(${id}::uuid)`;
    return found;
  }

  @Post('cases/:id/notes')
  @AnyStaff()
  @Commits()
  @HttpCode(204)
  async addNote(@Param('id') id: string, @Body({ schema: note }) body: z.infer<typeof note>) {
    await this.database.tx.$executeRaw`SELECT app.add_case_event(${id}::uuid, 'NOTE', 'Note', ${body.text}, 'neutral'::event_tone, false)`;
    await this.audit.log({ action: 'CASE_NOTE_ADDED', entity: { type: 'case', id } });
    await this.outbox.add({ queue: 'maintenance', name: 'sample', payload: { caseId: id } });
  }

  @Post('number')
  @Staff('DIRECTOR')
  @Commits()
  async number() {
    const [row] = await this.database.tx.$queryRaw<{ for_year: number; number: number }[]>`SELECT * FROM app.next_number('SAMPLE')`;
    return { number: row!.number };
  }

  @Post('password')
  @StaffOrDelegate('TECHNICAL', 'DIRECTOR')
  @Commits()
  @OneTimeAnswer()
  password() {
    return { password: 'mot-de-passe-affiche-une-fois' };
  }

  @Post('settings')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @HttpCode(204)
  async settings() {
    await this.audit.log({ action: 'SETTING_CHANGED' });
  }

  @Post('fail')
  @AnyStaff()
  @Commits()
  async fail(@Body({ schema: note }) body: z.infer<typeof note>) {
    await this.audit.log({ action: 'SECRET_SAVED', params: { secret: 'NEVER_KEPT' } });
    throw new Error(`unexpected ${body.text}`);
  }

  @Post('leak')
  @AnyStaff()
  async leak() {
    await this.audit.log({ action: 'PLAN_APPROVED', params: { reference: 'LGR-2026-00001' } });
  }

  @Post('refused')
  @AnyStaff()
  refused() {
    return this.database.tx.user.findMany({ select: { disabledReason: true } });
  }
}

@Controller('partner/sample')
export class PartnerSampleController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('cases')
  @Partner()
  cases() {
    return this.database.tx.case.findMany({ select: { id: true, reference: true, creditor: { select: { name: true } } } });
  }
}

@Controller('debtor/sample')
export class DebtorSampleController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('cases')
  @Debtor()
  cases() {
    return this.database.tx.case.findMany({ select: { id: true, reference: true } });
  }

  @Post('access')
  @Anonymous('debtor')
  @HttpCode(204)
  access() {}
}

@Controller('public/sample')
export class PublicSampleController {
  @Get()
  @Public()
  values() {
    return { ok: true };
  }
}

export const SAMPLE_CONTROLLERS = [StaffSampleController, PartnerSampleController, DebtorSampleController, PublicSampleController];

@Controller('staff/forgotten')
export class ForgottenController {
  @Get()
  open() {
    return { open: true };
  }
}

@Controller('partner/elsewhere')
export class ElsewhereController {
  @Get()
  @AnyStaff()
  open() {
    return { open: true };
  }
}
