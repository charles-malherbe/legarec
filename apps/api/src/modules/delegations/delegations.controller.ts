import { delegationsData, REQUEST_BODIES, type Delegation } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Staff } from '../../platform/access/access';
import { RequiresProof } from '../../platform/access/proof';
import { Audit } from '../../platform/audit/audit';
import { Database } from '../../platform/database/database';
import { notFound } from '../../platform/errors/api-error';
import { Outbox } from '../../platform/queue/outbox';

const bodies = REQUEST_BODIES.staff;
const KINDS: Record<string, Delegation> = { technical: 'TECHNICAL', administrative: 'ADMINISTRATIVE' };

/** The Director alone gives or withdraws a delegation, with immediate effect; a delegate never takes one back. */
@ApiTags('delegations')
@Controller('staff/delegations')
@Staff('DIRECTOR')
export class DelegationsController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  @Get()
  @ApiOkResponse({ standardSchema: delegationsData })
  async data(): Promise<z.infer<typeof delegationsData>> {
    const { tx } = this.database;
    const open = await tx.delegation.findMany({ where: { withdrawnAt: null }, select: { kind: true } });
    const people = await tx.user.findMany({
      where: { role: { in: ['DEVELOPER', 'COLLECTION_MANAGER'] }, status: 'ACTIVE' },
      select: { role: true, firstName: true, lastName: true },
    });
    const holds = (kind: Delegation) => open.some((delegation) => delegation.kind === kind);
    const holder = (role: string) => {
      const person = people.find((item) => item.role === role);
      return person ? `${person.firstName} ${person.lastName}` : 'aucun titulaire';
    };
    return { technical: holds('TECHNICAL'), administrative: holds('ADMINISTRATIVE'), developer: holder('DEVELOPER'), manager: holder('COLLECTION_MANAGER') };
  }

  @RequiresProof()
  @Put(':kind')
  @HttpCode(204)
  @ApiNoContentResponse()
  async set(@Param('kind') name: string, @Body({ schema: bodies['PUT /delegations/:kind'] }) { active }: z.infer<(typeof bodies)['PUT /delegations/:kind']>) {
    const kind = Object.hasOwn(KINDS, name) ? KINDS[name] : undefined;
    if (!kind) throw notFound();
    const [row] = await this.database.tx.$queryRaw<{ id: string | null }[]>`SELECT app.set_delegation(${kind}::delegation_kind, ${active}) AS id`;
    // Already so: nothing to note nor to tell.
    if (!row?.id) return;
    await this.audit.log({
      action: active ? 'DELEGATION_GIVEN' : 'DELEGATION_WITHDRAWN',
      entity: { type: 'delegation', id: row.id },
      params: { delegation: kind },
    });
    await this.outbox.add({ queue: 'email', name: 'delegation-changed', payload: { delegationId: row.id, active } });
  }
}
