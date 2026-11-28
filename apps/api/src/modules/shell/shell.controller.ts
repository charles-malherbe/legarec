import { formatCents, formatSiren, REQUEST_BODIES, searchHit, shellData, type CaseListItem, type SearchResult, type ShellData } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AnyStaff } from '../../platform/access/access';
import { Database } from '../../platform/database/database';
import { currentActor } from '../../platform/http/context';
import { CasesService } from '../cases/cases.service';
import { CreditorsService, initialsOf } from '../creditors/creditors.service';
import type { StaffActor } from '../account/account.service';
import { LitigationService } from '../litigation/litigation.service';
import { NotificationsService } from '../notifications/notifications.service';

const bodies = REQUEST_BODIES.staff;
/** Of each kind, under the search box. */
const HITS = 8;
const BELL = 7;
const ONLINE_MS = 5 * 60_000;

/** Frame of every screen: what the menu, the bell and the search show. */
@ApiTags('shell')
@Controller('staff')
@AnyStaff()
export class ShellController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CasesService) private readonly cases: CasesService,
    @Inject(CreditorsService) private readonly creditors: CreditorsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(LitigationService) private readonly litigation: LitigationService,
  ) {}

  @Get('shell')
  @ApiOkResponse({ standardSchema: shellData })
  async shell(): Promise<ShellData> {
    const bell = (await this.notifications.list(BELL)).map(({ id, text, meta, href, unread }) => ({ id, kind: 'SYSTEM' as const, text, meta, href, unread }));
    // Reminders, calls and messages: with their own modules.
    const counts = { teamOnline: 0, remindersToday: 0, litigationUrgent: 0, callQueue: 0, unreadEmails: 0, unreadSms: 0 };
    if (this.withoutCases()) return { creditors: [], counts, notifications: bell, recentCases: [] };
    const creditors = (await this.creditors.list()).map(({ id, name, initials, siren, debtors }) => ({ id, name, initials, siren, count: debtors }));
    const online = await this.database.tx.user.count({
      where: { status: 'ACTIVE', role: { in: ['DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER'] }, lastSeenAt: { gt: new Date(Date.now() - ONLINE_MS) } },
    });
    return {
      creditors: [{ id: 'all', name: 'Tous les créanciers', initials: '', count: creditors.reduce((total, item) => total + item.count, 0) }, ...creditors],
      // Litigation: the cases awaiting the agreement of their creditor, on which this person acts.
      counts: { ...counts, teamOnline: online, litigationUrgent: await this.litigation.waiting(currentActor() as StaffActor) },
      notifications: bell,
      recentCases: (await this.cases.recent()).map(debtorHit),
    };
  }

  /** Debtors, creditors and invoices that PostgreSQL shows to this person. */
  @Post('search')
  @HttpCode(200)
  @ApiOkResponse({ standardSchema: z.array(searchHit) })
  async search(@Body({ schema: bodies['POST /search'] }) { query }: z.infer<(typeof bodies)['POST /search']>): Promise<SearchResult[]> {
    if (!query || this.withoutCases()) return [];
    const found = await this.cases.named(query, HITS);
    const creditors = await this.creditors.named(query, HITS);
    const invoices = await this.cases.invoicesNamed(query, HITS);
    return [
      ...found.map(debtorHit),
      ...creditors.map((item): SearchResult => ({
        id: `c:${item.id}`,
        kind: 'CREDITOR',
        title: item.name,
        sub: [item.siren && `SIREN ${formatSiren(item.siren)}`, `${item.debtors} débiteur${item.debtors > 1 ? 's' : ''}`].filter(Boolean).join(' · '),
        href: `/creanciers/${item.id}`,
        initials: initialsOf(item.name),
      })),
      ...invoices.map((item): SearchResult => ({
        id: `f:${item.id}`,
        kind: 'INVOICE',
        title: item.number,
        sub: `${item.debtor} · ${item.creditor} · ${formatCents(Number(item.left), { decimals: 'always' })}`,
        href: `/debiteurs/${item.case_id}`,
        initials: initialsOf(item.debtor),
      })),
    ];
  }

  private withoutCases(): boolean {
    const actor = currentActor();
    return actor.kind !== 'staff' || actor.role === 'DEVELOPER';
  }
}

/** A case under the search box: its debtor, and what tells it apart from the cases of the same name. */
function debtorHit(item: CaseListItem): SearchResult {
  return {
    id: `d:${item.id}`,
    kind: 'DEBTOR',
    title: item.name,
    sub: `${item.identifier} · ${item.creditor} · ${item.statusLabel}`,
    href: `/debiteurs/${item.id}`,
    initials: initialsOf(item.name),
  };
}
