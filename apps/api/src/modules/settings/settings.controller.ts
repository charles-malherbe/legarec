import {
  hasDelegation,
  isFirmIdentity,
  REQUEST_BODIES,
  settingProblems,
  settingsHub,
  settingsSection,
  type SettingDefinition,
  type SettingTable,
} from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { AnyStaff, StaffOrDelegate } from '../../platform/access/access';
import { auditSentence } from '../../platform/audit/actions';
import { Audit } from '../../platform/audit/audit';
import type { Actor } from '../../platform/database/actor';
import { Database } from '../../platform/database/database';
import { forbidden, invalid, notFound } from '../../platform/errors/api-error';
import { capitalized, ago, moment } from '../../platform/format';
import { currentActor } from '../../platform/http/context';
import { Commits } from '../../platform/http/transaction.interceptor';
import { Vault } from '../vault/vault';
import { keyOf, SettingValues, type Scope, type Value } from './values';

type StaffActor = Extract<Actor, { kind: 'staff' }>;
const body = REQUEST_BODIES.staff['PUT /settings/:scope/:id'];
const SCOPES: Record<string, Scope> = { firm: 'firm', techniques: 'technical' };
const SHOWN = 500;
/** Nobody needs the whole address of a colleague to recognise it. */
const maskedIp = (ip: string | null) => {
  if (!ip) return '—';
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.•••.${parts[3]}` : `${ip.split(':').slice(0, 2).join(':')}:•••`;
};

@ApiTags('settings')
@Controller('staff/settings')
export class SettingsController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Vault) private readonly vault: Vault,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  @Get(':scope')
  @AnyStaff()
  @ApiOkResponse({ standardSchema: settingsHub })
  async hub(@Param('scope') name: string): Promise<z.infer<typeof settingsHub>> {
    const actor = currentActor() as StaffActor;
    const scope = this.scope(name, actor);
    const values = await SettingValues.read(this.database.tx);
    const status = await this.statuses(scope, values);
    return {
      canEdit: this.canEdit(scope, actor),
      groups: values.groups(scope).map(({ label, items }) => ({
        label,
        tiles: items
          .filter((item) => item.id !== 'users' || actor.role !== 'CLAIMS_OFFICER')
          .map(({ id, title, description, icon, ...item }) => ({ id, title, description, icon, status: item.status, statusTone: item.tone, ...status[id] })),
      })),
    };
  }

  @Get(':scope/:id')
  @AnyStaff()
  @ApiOkResponse({ standardSchema: settingsSection })
  async section(@Param('scope') name: string, @Param('id') id: string): Promise<z.infer<typeof settingsSection>> {
    const actor = currentActor() as StaffActor;
    const scope = this.scope(name, actor);
    const item = (await SettingValues.read(this.database.tx)).section(scope, id);
    if (!item) throw notFound();
    return {
      id,
      canEdit: this.canEdit(scope, actor),
      blocks: item.blocks.map((block) => ({
        ...block,
        fields: block.fields.map((field) => ({
          ...field,
          locked: field.locked || (actor.role !== 'DIRECTOR' && scope === 'firm' && isFirmIdentity(id, field.id)),
        })),
      })),
      tables: await Promise.all((item.tables ?? []).map((table) => this.table(table))),
      notes: item.notes ?? [],
    };
  }

  @Put(':scope/:id')
  @StaffOrDelegate(['ADMINISTRATIVE', 'TECHNICAL'], 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async save(@Param('scope') name: string, @Param('id') id: string, @Body({ schema: body }) sent: z.infer<typeof body>): Promise<void> {
    const { tx } = this.database;
    const actor = currentActor() as StaffActor;
    const scope = this.scope(name, actor);
    if (!this.canEdit(scope, actor)) throw forbidden();
    // One after the other: the former value that is kept is the one that is replaced.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('settings', 0))`;
    const item = (await SettingValues.read(tx)).section(scope, id);
    if (!item) throw notFound();
    const changes = this.changes(item, sent);
    const problems = settingProblems(item, Object.fromEntries(changes.map(({ field, next }) => [field, next])));
    if (Object.keys(problems).length) throw invalid({ fields: Object.keys(problems) });
    if (!changes.length) return;
    const identity = changes.filter(({ field }) => scope === 'firm' && isFirmIdentity(id, field));
    if (identity.length && actor.role !== 'DIRECTOR') throw forbidden();
    const known = new Set((await tx.setting.findMany({ where: { key: { startsWith: `${scope}.${id}.` } }, select: { key: true } })).map((row) => row.key));
    for (const { field, next, former } of changes) {
      const key = keyOf(scope, id, field);
      const version = randomUUID();
      const previous = known.has(key)
        ? this.vault.sealFor({ table: 'setting_versions', id: version, column: 'previous_cipher' }, JSON.stringify(former))
        : null;
      await tx.$executeRaw`SELECT app.save_setting(${key}, ${JSON.stringify(next)}::jsonb, ${version}::uuid, ${previous})`;
    }
    // The fields by their number: neither their name nor their value is written there.
    if (identity.length) await this.audit.log({ action: 'FIRM_IDENTITY_CHANGED', params: { count: identity.length } });
    if (changes.length > identity.length) await this.audit.log({ action: 'SETTING_CHANGED', params: { count: changes.length - identity.length } });
  }

  private changes(item: SettingDefinition, sent: Record<string, Value>): { field: string; next: Value; former: Value }[] {
    const fields = new Map(item.blocks.flatMap((block) => block.fields).map((field) => [field.id, field]));
    return Object.entries(sent).flatMap(([id, next]) => {
      const field = fields.get(id);
      if (!field || field.locked || field.kind === 'value') return [];
      const former = field.kind === 'switch' ? field.checked : field.value;
      return next === former ? [] : [{ field: id, next, former }];
    });
  }

  private scope(name: string, actor: StaffActor): Scope {
    const scope = Object.hasOwn(SCOPES, name) ? SCOPES[name] : undefined;
    if (!scope) throw notFound();
    if (scope === 'technical' && actor.role !== 'DEVELOPER' && actor.role !== 'DIRECTOR') throw forbidden();
    return scope;
  }

  private canEdit(scope: Scope, actor: StaffActor): boolean {
    const who = { role: actor.role, activeDelegations: [...actor.delegations], userId: actor.userId };
    return actor.role === 'DIRECTOR' || hasDelegation(who, scope === 'technical' ? 'TECHNICAL' : 'ADMINISTRATIVE');
  }

  /** What the API knows by itself; the services tell theirs with their own lot. */
  private async statuses(scope: Scope, values: SettingValues): Promise<Record<string, { status: string; statusTone: 'neutral' | 'warning' }>> {
    const { tx } = this.database;
    if (scope === 'firm') {
      const missing = values
        .section('firm', 'cabinet')!
        .blocks.flatMap((block) => block.fields)
        .filter((field) => field.kind === 'text' && /\[/u.test(field.value)).length;
      const active = await tx.user.count({ where: { status: 'ACTIVE' } });
      return {
        users: { status: active === 1 ? '1 compte actif' : `${active} comptes actifs`, statusTone: 'neutral' },
        ...(missing ? { cabinet: { status: missing === 1 ? '1 valeur à compléter' : `${missing} valeurs à compléter`, statusTone: 'warning' as const } } : {}),
      };
    }
    const last = await tx.auditEntry.findFirst({ select: { occurredAt: true }, orderBy: { occurredAt: 'desc' } });
    return last ? { audit: { status: `Dernière action ${ago(last.occurredAt)}`, statusTone: 'neutral' } } : {};
  }

  private async table(table: SettingTable): Promise<SettingTable> {
    const { tx } = this.database;
    if (table.id === 'extensions') {
      const people = await tx.user.findMany({
        where: { extension: { not: null }, status: 'ACTIVE' },
        select: { firstName: true, lastName: true, extension: true },
        orderBy: { extension: 'asc' },
      });
      return { ...table, rows: people.map((person) => [`${person.firstName} ${person.lastName}`, person.extension!, '—', '—']) };
    }
    if (table.id === 'audit') {
      const entries = await tx.$queryRaw<
        { occurred_at: Date; actor_label: string; behalf: string | null; action: string; params: Record<string, unknown>; ip: string | null }[]
      >`
        SELECT a.occurred_at, a.actor_label, u.first_name || ' ' || u.last_name AS behalf, a.action, a.params, host(a.ip) AS ip
        FROM audit_log a LEFT JOIN users u ON u.id = a.on_behalf_of_id ORDER BY a.occurred_at DESC LIMIT ${SHOWN}`;
      return {
        ...table,
        rows: entries.map((entry) => [
          moment(entry.occurred_at),
          entry.actor_label,
          entry.behalf ?? '',
          capitalized(auditSentence(entry.action, entry.params)),
          maskedIp(entry.ip),
        ]),
      };
    }
    return table;
  }
}
