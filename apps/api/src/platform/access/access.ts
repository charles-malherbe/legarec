import type { Delegation, Role } from '@legarec/contracts';
import { SetMetadata } from '@nestjs/common';
import type { Actor } from '../database/actor';

export type StaffRole = Exclude<Role, 'CREDITOR'>;
export type Portal = 'staff' | 'partner' | 'debtor' | 'public' | 'hook' | 'service' | 'health';

export type AccessRule =
  | { portal: 'staff'; anonymous?: boolean; roles?: readonly StaffRole[]; delegation?: Delegation }
  | { portal: 'partner' | 'debtor'; anonymous?: boolean }
  | { portal: 'public' | 'hook' | 'health' }
  | { portal: 'service'; scope: string };

export const ACCESS = Symbol('legarec:access');
const rule = (value: AccessRule) => SetMetadata(ACCESS, value);

/** A route without one of these decorators stops the API from starting. */
export const Staff = (...roles: StaffRole[]) => rule({ portal: 'staff', roles });
/** Allowed to these roles, and to the holder of a delegation of the Director, who then acts on their behalf. */
export const StaffOrDelegate = (delegation: Delegation, ...roles: StaffRole[]) => rule({ portal: 'staff', roles, delegation });
/** Any signed-in collaborator. */
export const AnyStaff = () => rule({ portal: 'staff' });
export const Partner = () => rule({ portal: 'partner' });
export const Debtor = () => rule({ portal: 'debtor' });
/** Before signing in: login, forgotten password, invitation. */
export const Anonymous = (portal: 'staff' | 'partner' | 'debtor') => rule({ portal, anonymous: true });
export const Public = () => rule({ portal: 'public' });
export const Hook = () => rule({ portal: 'hook' });
export const ServiceAccount = (scope: string) => rule({ portal: 'service', scope });
export const Health = () => rule({ portal: 'health' });

/** First segment of the path of each portal: a route cannot leave its own. */
export const PREFIX: Record<Portal, string> = {
  staff: '/staff',
  partner: '/partner',
  debtor: '/debtor',
  public: '/public',
  hook: '/hooks',
  service: '/service',
  health: '/health',
};

/** Finds out who is calling. Nobody before the accounts exist; replaced by the sessions. */
export interface ActorResolver {
  resolve(portal: Portal, request: { headers: Record<string, unknown> }): Promise<Actor | null>;
}
export const ACTOR_RESOLVER = Symbol('ACTOR_RESOLVER');
export class NobodyResolver implements ActorResolver {
  resolve(): Promise<null> {
    return Promise.resolve(null);
  }
}

const KIND: Partial<Record<Portal, Actor['kind']>> = { staff: 'staff', partner: 'partner', debtor: 'debtor', service: 'service' };

/** Actor allowed by a rule: `null` when the caller must sign in, `false` when they may not. */
export function allow(access: AccessRule, actor: Actor | null): Actor | null | false {
  if (access.portal === 'public') return { kind: 'public' };
  if (access.portal === 'hook') return { kind: 'hook' };
  if (access.portal === 'health') return { kind: 'public' };
  if ('anonymous' in access && access.anonymous) return { kind: 'anonymous' };
  if (!actor) return null;
  if (actor.kind !== KIND[access.portal]) return false;
  if (access.portal !== 'staff' || actor.kind !== 'staff') return actor;
  if (!access.roles || access.roles.includes(actor.role)) return actor;
  if (access.delegation && actor.delegations.includes(access.delegation)) return { ...actor, actingFor: access.delegation };
  return false;
}
