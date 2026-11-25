import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../database/database';

export interface AuditEntry {
  /** `PLAN_APPROVED`, `SECRET_SAVED`… */
  action: string;
  entity?: { type: string; id: string };
  /** What happened, in French, for the audit screen. No name, reference, amount of a debtor, code nor secret. */
  summary: string;
}

const LOOKS_PERSONAL = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/u,
  /LGR-\d{4}-\d{5}/u,
  /\b\d{9}\b/u,
  /\b(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}\b/u,
  /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,}/u,
];

/** Who, what, when, on behalf of whom and from where: PostgreSQL fills the rest from the context of the transaction. */
@Injectable()
export class Audit {
  constructor(@Inject(Database) private readonly database: Database) {}

  async log(entry: AuditEntry): Promise<void> {
    if (LOOKS_PERSONAL.some((pattern) => pattern.test(entry.summary))) throw new Error(`Personal data in the audit summary of ${entry.action}`);
    await this.database.tx.$executeRaw`SELECT app.log(${entry.action}, ${entry.entity?.type ?? null}, ${entry.entity?.id ?? null}::uuid, ${entry.summary})`;
  }
}
