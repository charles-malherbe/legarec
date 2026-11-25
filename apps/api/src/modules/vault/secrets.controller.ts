import { INTERNAL_SECRETS, REQUEST_BODIES, secretsData, SERVICE_SECRETS, type InternalSecret, type SecretItem } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { Staff, StaffOrDelegate } from '../../platform/access/access';
import { RequiresProof } from '../../platform/access/proof';
import { Audit } from '../../platform/audit/audit';
import { CONFIG, type Config } from '../../platform/config/config';
import { Database } from '../../platform/database/database';
import { conflict, invalid, notFound } from '../../platform/errors/api-error';
import { ago, capitalized } from '../../platform/format';
import { Commits } from '../../platform/http/transaction.interceptor';
import { Outbox } from '../../platform/queue/outbox';
import { InternalKeys } from './internal-keys';
import { Vault } from './vault';

const bodies = REQUEST_BODIES.staff;
const SERVICE: Record<string, string> = { ...SERVICE_SECRETS, ...INTERNAL_SECRETS };
const ROTATION = { 30: 'DAYS_30', 90: 'DAYS_90', MANUAL: 'MANUAL' } as const;
const DAYS = { DAYS_30: 30, DAYS_90: 90, MANUAL: null } as const;
/** Told that long before its end. */
const WARNING_DAYS = 15;
const DAY_MS = 86_400_000;

/** Keys of the services: written, renewed, revoked, never read again. */
@ApiTags('vault')
@Controller('staff/secrets')
export class SecretsController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Vault) private readonly vault: Vault,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(InternalKeys) private readonly keys: InternalKeys,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get()
  @Staff('DIRECTOR', 'DEVELOPER')
  @ApiOkResponse({ standardSchema: secretsData })
  async list(): Promise<z.infer<typeof secretsData>> {
    const found = await this.database.tx.vaultSecret.findMany({
      select: { id: true, name: true, kind: true, status: true, rotation: true, rotatedAt: true, lastUsedAt: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    const now = new Date();
    const environment = this.config.NODE_ENV === 'production' ? 'Production' : 'Développement';
    return {
      items: found.map(({ id, name, kind, status, rotation, rotatedAt, lastUsedAt }): SecretItem => {
        const days = DAYS[rotation];
        const ending = status === 'VALID' && days !== null && rotatedAt.getTime() + (days - WARNING_DAYS) * DAY_MS <= now.getTime();
        return {
          id,
          name,
          internal: kind === 'INTERNAL',
          service: SERVICE[name] ?? name,
          environment,
          used: lastUsedAt ? ago(lastUsedAt, now) : 'jamais',
          rotated: capitalized(ago(rotatedAt, now)),
          status: ending ? 'EXPIRING' : status,
        };
      }),
    };
  }

  @RequiresProof()
  @Post()
  @StaffOrDelegate('TECHNICAL', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async save(@Body({ schema: bodies['POST /secrets'] }) { name, value, rotation }: z.infer<(typeof bodies)['POST /secrets']>): Promise<void> {
    const { tx } = this.database;
    if (await tx.vaultSecret.findFirst({ where: { name, status: { not: 'REVOKED' } }, select: { id: true } })) throw conflict('SECRET_EXISTS');
    const id = randomUUID();
    await tx.$executeRaw`SELECT app.save_secret(${id}::uuid, ${name}::secret_name, ${this.vault.seal(id, value)}, ${ROTATION[rotation]}::secret_rotation)`;
    await this.audit.log({ action: 'SECRET_SAVED', entity: { type: 'secret', id }, params: { secret: name } });
  }

  @RequiresProof()
  @Post(':id/rotate')
  @StaffOrDelegate('TECHNICAL', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async renew(@Param('id') id: string, @Body({ schema: bodies['POST /secrets/:id/rotate'] }) { value }: z.infer<(typeof bodies)['POST /secrets/:id/rotate']>) {
    const { name, kind } = await this.find(id);
    // A key of a service is created there and pasted here; an internal one is drawn here, and never typed.
    if ((kind === 'SERVICE') !== Boolean(value)) throw invalid({ fields: ['value'] });
    if (value) await this.database.tx.$executeRaw`SELECT app.renew_secret(${id}::uuid, ${this.vault.seal(id, value)})`;
    else {
      await this.keys.renew(name as InternalSecret);
      if (name === 'ACCESS_CODE_KEY') await this.outbox.add({ queue: 'maintenance', name: 'reseal-access-codes', payload: {} });
    }
    await this.audit.log({ action: 'SECRET_RENEWED', entity: { type: 'secret', id }, params: { secret: name } });
  }

  @RequiresProof()
  @Post(':id/revoke')
  @StaffOrDelegate('TECHNICAL', 'DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async revoke(@Param('id') id: string): Promise<void> {
    const { name } = await this.service(id);
    const [row] = await this.database.tx.$queryRaw<{ status: string }[]>`SELECT app.revoke_secret(${id}::uuid)::text AS status`;
    const action = row?.status === 'REVOKED' ? 'SECRET_REVOKED' : 'SECRET_REVOKE_ASKED';
    await this.audit.log({ action, entity: { type: 'secret', id }, params: { secret: name } });
  }

  @Post(':id/keep')
  @Staff('DIRECTOR')
  @Commits()
  @HttpCode(204)
  @ApiNoContentResponse()
  async keep(@Param('id') id: string): Promise<void> {
    const { name } = await this.service(id);
    await this.database.tx.$executeRaw`SELECT app.keep_secret(${id}::uuid)`;
    await this.audit.log({ action: 'SECRET_KEPT', entity: { type: 'secret', id }, params: { secret: name } });
  }

  /** Internal keys are never revoked. */
  private async service(id: string): Promise<{ name: string }> {
    const found = await this.find(id);
    if (found.kind !== 'SERVICE') throw notFound();
    return found;
  }

  private async find(id: string): Promise<{ name: string; kind: string }> {
    const found = await this.database.tx.vaultSecret.findUnique({ where: { id }, select: { name: true, kind: true } });
    if (!found) throw notFound();
    return found;
  }
}
