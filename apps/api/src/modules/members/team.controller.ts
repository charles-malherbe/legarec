import { formatCents, ROLE_LABELS, teamData, teamQuery } from '@legarec/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { Database } from '../../platform/database/database';
import { forbidden } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';

type Data = z.infer<typeof teamData>;
interface Read {
  role: string | null;
  agents: {
    id: string;
    name: string;
    role: 'CLAIMS_OFFICER' | 'COLLECTION_MANAGER';
    debtors: number;
    outstanding: number;
    cashed: number;
    creditors: string[];
  }[];
}
/** Today, the last 7 days, the last 30 days: today included. */
const DAYS = { day: 0, week: 6, month: 29 } as const;
const plural = (count: number, word: string) => `${count.toLocaleString('fr-FR')} ${word}${count > 1 ? 's' : ''}`;

/**
 * The activity of the screen « Équipe »: the Director and the manager, on the cases PostgreSQL lets each read (the manager
 * and the officers hold none that either of them does not read). Known today: the portfolio each one follows and what was
 * cashed on it. Presence, calls, goals of calls, promises and durations come from the telephony (lot T): `telephony: false`
 * says their fields hold nothing, and no call is listed.
 */
@ApiTags('members')
@Controller('staff/team')
@Staff('DIRECTOR', 'COLLECTION_MANAGER')
export class TeamController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  @ApiOkResponse({ standardSchema: teamData })
  async read(@Query({ schema: teamQuery }) { period }: z.infer<typeof teamQuery>): Promise<Data> {
    const today = dayOf(new Date());
    const since = new Date(Date.parse(`${today}T12:00:00Z`) - DAYS[period] * 86_400_000).toISOString().slice(0, 10);
    const [{ data }] = (await this.database.tx.$queryRaw<{ data: Read }[]>`
      SELECT jsonb_build_object(
        'role', app.staff_role(),
        'agents', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.first_name || ' ' || u.last_name, 'role', u.role,
            'debtors', (SELECT count(DISTINCT c.debtor_id) FROM cases c WHERE c.officer_id = u.id AND c.closed_on IS NULL),
            'outstanding', (SELECT coalesce(sum(i.principal_cents - i.principal_paid_cents), 0) FROM case_invoices i JOIN cases c ON c.id = i.case_id
              WHERE c.officer_id = u.id AND c.closed_on IS NULL),
            'cashed', (SELECT coalesce(sum(p.amount_cents), 0) FROM payments p JOIN cases c ON c.id = p.case_id
              WHERE c.officer_id = u.id AND p.status <> 'BOUNCED' AND p.received_on >= ${since}::date AND p.received_on <= ${today}::date),
            'creditors', (SELECT coalesce(jsonb_agg(k.name ORDER BY k.name), '[]') FROM creditors k
              WHERE k.id IN (SELECT c.creditor_id FROM cases c WHERE c.officer_id = u.id AND c.closed_on IS NULL))
          ) ORDER BY u.last_name, u.first_name, u.id), '[]')
          FROM users u WHERE u.status = 'ACTIVE' AND u.role IN ('CLAIMS_OFFICER', 'COLLECTION_MANAGER'))
      ) AS data`) as [{ data: Read }];
    // The role as PostgreSQL knows it: individual figures are for the Director and the manager alone.
    if (data.role !== 'DIRECTOR' && data.role !== 'COLLECTION_MANAGER') throw forbidden();
    return {
      agents: data.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        roleLabel: ROLE_LABELS[agent.role],
        scope:
          agent.creditors.length === 0
            ? 'Aucun dossier en cours'
            : agent.creditors.length > 3
              ? plural(agent.creditors.length, 'créancier')
              : agent.creditors.join(', '),
        book: `${plural(agent.debtors, 'débiteur')} · ${formatCents(agent.outstanding)}`,
        cashed: agent.cashed,
        // Unknown without the telephony: none of these is a figure, and the screen shows none.
        presence: 'AWAY',
        status: '—',
        calls: 0,
        goal: 0,
        reached: 0,
        promises: 0,
        promisedAmount: 0,
        average: '—',
        kept: 0,
        login: '—',
        pause: '—',
        live: null,
        hours: [],
      })),
      calls: [],
      callsTotal: 0,
      alerts: [],
      telephony: false,
    };
  }
}
