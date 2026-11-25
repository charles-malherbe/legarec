import type { Delegation, Role } from '@legarec/contracts';
import { SetMetadata } from '@nestjs/common';
import type { Actor } from '../database/actor';
import type { Portal } from '../http/origin';

export { PREFIX, type Portal } from '../http/origin';

export type StaffRole = Exclude<Role, 'CREDITOR'>;

export type AccessRule =
  | { portal: 'staff'; anonymous?: boolean; roles?: readonly StaffRole[]; delegations?: readonly Delegation[] }
  | { portal: 'partner' | 'debtor'; anonymous?: boolean }
  | { portal: 'public' | 'hook' | 'health' }
  | { portal: 'service'; scope: string };

export const ACCESS = Symbol('legarec:access');
const rule = (value: AccessRule) => SetMetadata(ACCESS, value);

/** A route without one of these decorators stops the API from starting. */
export const Staff = (...roles: StaffRole[]) => rule({ portal: 'staff', roles });
/** Allowed to these roles, and to the holder of one of these delegations of the Director, who then acts on their behalf. */
export const StaffOrDelegate = (delegation: Delegation | readonly Delegation[], ...roles: StaffRole[]) =>
  rule({ portal: 'staff', roles, delegations: typeof delegation === 'string' ? [delegation] : delegation });
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

/** Finds out who is calling, from the cookie of the portal. */
export interface ActorResolver {
  resolve(portal: Portal, request: { headers: Record<string, unknown> }): Promise<Actor | null>;
}
export const ACTOR_RESOLVER = Symbol('ACTOR_RESOLVER');

/** Nobody has to be signed in. */
export const isOpen = (access: AccessRule) =>
  access.portal === 'public' || access.portal === 'hook' || access.portal === 'health' || ('anonymous' in access && access.anonymous === true);

const KIND: Partial<Record<Portal, Actor['kind']>> = { staff: 'staff', partner: 'partner', debtor: 'debtor', service: 'service' };

/** Actor allowed by a rule: `null` when the caller must sign in, `false` when they may not. */
export function allow(access: AccessRule, actor: Actor | null): Actor | null | false {
  if (access.portal === 'public' || access.portal === 'health') return { kind: 'public' };
  if (access.portal === 'hook') return { kind: 'hook' };
  if ('anonymous' in access && access.anonymous) return { kind: 'anonymous' };
  if (!actor) return null;
  if (actor.kind !== KIND[access.portal]) return false;
  if (access.portal === 'service') return actor.kind === 'service' && actor.scopes.includes(access.scope) ? actor : false;
  if (access.portal !== 'staff' || actor.kind !== 'staff') return actor;
  if (!access.roles || access.roles.includes(actor.role)) return actor;
  const held = access.delegations?.find((kind) => actor.delegations.includes(kind));
  return held ? { ...actor, actingFor: held } : false;
}
