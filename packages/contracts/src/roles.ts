import { z } from 'zod';

export const role = z.enum(['DEVELOPER', 'DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER', 'CREDITOR']);
export type Role = z.infer<typeof role>;

export const ROLE_LABELS: Record<Role, string> = {
  DEVELOPER: 'Développeur',
  DIRECTOR: 'Directeur',
  COLLECTION_MANAGER: 'Responsable du recouvrement',
  CLAIMS_OFFICER: 'Gestionnaire de créances',
  CREDITOR: 'Créancier',
};

/** Roles held by a single person; the API refuses a second holder. */
export const UNIQUE_ROLES: readonly Role[] = ['DEVELOPER', 'DIRECTOR', 'COLLECTION_MANAGER'];

export const delegation = z.enum(['TECHNICAL', 'ADMINISTRATIVE']);
export type Delegation = z.infer<typeof delegation>;

/** The only role that may receive each delegation of the Director. */
export const DELEGATE_ROLE: Record<Delegation, Role> = { TECHNICAL: 'DEVELOPER', ADMINISTRATIVE: 'COLLECTION_MANAGER' };

export const preferences = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  density: z.enum(['comfortable', 'compact']),
  lowVision: z.boolean(),
});
export const session = z.object({
  userId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  role,
  activeDelegations: z.array(delegation),
  directorName: z.string(),
  twoFactorEnabled: z.boolean(),
  extension: z.string().nullable(),
  preferences,
});
export type Session = z.infer<typeof session>;

type Actor = Pick<Session, 'role' | 'activeDelegations' | 'userId'>;

export function hasDelegation(actor: Actor, kind: Delegation): boolean {
  return DELEGATE_ROLE[kind] === actor.role && actor.activeDelegations.includes(kind);
}

/** Case access rules. The API enforces them; the UI only mirrors them to hide actions. */
export function canReadCase(actor: Actor, item: { officerId: string | null; officerRole: Role | null }): boolean {
  switch (actor.role) {
    case 'DIRECTOR':
      return true;
    case 'COLLECTION_MANAGER':
      return item.officerId === null || item.officerId === actor.userId || item.officerRole === 'CLAIMS_OFFICER';
    case 'CLAIMS_OFFICER':
      return item.officerId === actor.userId;
    default:
      return false;
  }
}

export function canActOnCase(actor: Actor, item: { officerId: string | null; officerRole: Role | null }): boolean {
  if (actor.role === 'DIRECTOR') return item.officerId === actor.userId;
  return canReadCase(actor, item);
}

export function canAccessTechnicalSettings(actor: Pick<Session, 'role'>): boolean {
  return actor.role === 'DEVELOPER' || actor.role === 'DIRECTOR';
}

export function canAccessBilling(actor: Actor): boolean {
  return actor.role === 'DIRECTOR' || hasDelegation(actor, 'ADMINISTRATIVE');
}
