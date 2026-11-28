import type { UncertainSendings } from '@legarec/contracts';
import { UNCERTAIN_BLOCK_HOURS } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../platform/database/database';

const isLetter = (template: string): template is 'FRIENDLY' | 'FIRM' | 'FORMAL_NOTICE' => ['FRIENDLY', 'FIRM', 'FORMAL_NOTICE'].includes(template);

/**
 * E-mails and registered letters « incertains » that no answer of the provider has settled: a person decides (the Collection manager, or the Director on
 * the cases they act on). PostgreSQL asks the role, the right on the case and the 48 hours again (`app.settle_sending`).
 */
@Injectable()
export class UncertainSendingsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** The oldest first, 200 at most: those of the cases the caller acts on, asked 48 hours ago at least. */
  async list(): Promise<UncertainSendings> {
    const rows = await this.database.tx.$queryRaw<{ id: string; case_id: string; reference: string; debtor: string; level: number | null; channel: 'EMAIL' | 'REGISTERED_LETTER'; template: string; created_at: Date }[]>`
      SELECT s.id, s.case_id, c.reference, d.name AS debtor, s.level, s.channel::text AS channel, s.template, s.created_at
      FROM sendings s JOIN cases c ON c.id = s.case_id JOIN debtors d ON d.id = c.debtor_id
      WHERE s.status = 'UNCERTAIN' AND s.channel IN ('EMAIL', 'REGISTERED_LETTER') AND s.created_at <= now() - make_interval(hours => ${UNCERTAIN_BLOCK_HOURS}::int)
        AND c.anonymized_at IS NULL AND app.can_act_on_case(c.officer_id)
      ORDER BY s.created_at, s.id LIMIT 200`;
    return {
      items: rows.map((row) => ({
        id: row.id,
        caseId: row.case_id,
        reference: row.reference,
        debtor: row.debtor,
        channel: row.channel,
        level: row.level,
        letter: row.channel === 'REGISTERED_LETTER' && isLetter(row.template) ? row.template : null,
        askedAt: row.created_at.toISOString(),
      })),
    };
  }

  /** « Partie » or « Non partie »: 404 unknown, 403 not the caller's to decide, 409 already settled or too recent. */
  async settle(id: string, outcome: 'SENT' | 'NOT_SENT'): Promise<void> {
    await this.database.tx.$executeRaw`SELECT app.settle_sending(${id}::uuid, ${outcome})`;
  }
}
