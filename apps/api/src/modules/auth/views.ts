import { formatSiren, type PartnerSession, type Session } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../platform/database/actor';
import { Database } from '../../platform/database/database';
import { unauthorized } from '../../platform/errors/api-error';

type Staff = Extract<Actor, { kind: 'staff' }>;
type Partner = Extract<Actor, { kind: 'partner' }>;
const initialsOf = (name: string) =>
  name
    .split(/[\s'’-]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');

/** What each portal knows of the person in front of it, read with their own rights. */
@Injectable()
export class SessionViews {
  constructor(@Inject(Database) private readonly database: Database) {}

  staff(actor: Staff): Promise<Session> {
    return this.database.run(actor, async (tx) => {
      const me = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { firstName: true, lastName: true, email: true, role: true, extension: true, theme: true, density: true, lowVision: true },
      });
      // Closed between the reading of the cookie and this one: PostgreSQL shows nothing to nobody.
      if (!me) throw unauthorized();
      const director = await tx.user.findFirst({ where: { role: 'DIRECTOR', status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true } });
      const open = await tx.delegation.findMany({
        where: { withdrawnAt: null, grantedById: director?.id ?? actor.userId },
        select: { kind: true },
        orderBy: { kind: 'asc' },
      });
      const { theme, density, lowVision, ...person } = me;
      return {
        userId: actor.userId,
        ...person,
        activeDelegations: open.map((delegation) => delegation.kind),
        directorName: director ? `${director.firstName} ${director.lastName}` : '',
        twoFactorEnabled: actor.session?.secondFactor ?? false,
        preferences: { theme, density, lowVision },
      };
    });
  }

  partner(actor: Partner): Promise<PartnerSession> {
    return this.database.run(actor, async (tx) => {
      const me = await tx.user.findUnique({ where: { id: actor.userId }, select: { firstName: true, lastName: true, email: true } });
      const creditor = await tx.creditor.findUnique({ where: { id: actor.creditorId }, select: { id: true, name: true, siren: true } });
      if (!me || !creditor) throw unauthorized();
      const [officer] = await tx.$queryRaw<{ name: string | null }[]>`SELECT app.portal_officer() AS name`;
      return {
        userId: actor.userId,
        ...me,
        creditor: { id: creditor.id, name: creditor.name, initials: initialsOf(creditor.name), siren: formatSiren(creditor.siren ?? '') },
        officer: officer?.name ?? '',
      };
    });
  }
}
