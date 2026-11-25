import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../database/database';
import type { AuditAction } from './actions';

export interface AuditEntry {
  action: AuditAction;
  entity?: { type: string; id: string };
  /** Identifiers, dates, roles, technical names (`RESEND_API_KEY`) and short numbers. PostgreSQL refuses anything else. */
  params?: Record<string, string | number | boolean>;
}

/** Who, what, when, on behalf of whom and from where: PostgreSQL fills the rest from the context of the transaction. */
@Injectable()
export class Audit {
  constructor(@Inject(Database) private readonly database: Database) {}

  async log({ action, entity, params = {} }: AuditEntry): Promise<void> {
    await this.database.tx.$executeRaw`SELECT app.log(${action}, ${entity?.type ?? null}, ${entity?.id ?? null}::uuid, ${JSON.stringify(params)}::jsonb)`;
  }
}
