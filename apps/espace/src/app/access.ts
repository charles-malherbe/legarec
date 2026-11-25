import { canAccessBilling, canAccessTechnicalSettings, hasDelegation, type Session } from '@legarec/contracts';

/** Mirrors the API rules to show the refusal screen; the API is the real control. */
export function canOpen(path: string, user: Session): boolean {
  if (path.startsWith('/parametres/techniques')) return canAccessTechnicalSettings(user);
  if (path.startsWith('/facturation')) return canAccessBilling(user);
  if (path.startsWith('/equipe')) return user.role !== 'CLAIMS_OFFICER';
  const caseRoutes = ['/creanciers', '/debiteurs', '/relances', '/echeanciers', '/contentieux', '/appels', '/e-mails', '/sms', '/documents', '/rapports'];
  if (user.role === 'DEVELOPER') return !caseRoutes.some((route) => path.startsWith(route));
  return true;
}

/** Screens used under a delegation of the Director show the « Pour le compte du Directeur » banner. */
export function delegationFor(path: string, user: Session): string | null {
  if (path.startsWith('/parametres/techniques') && hasDelegation(user, 'TECHNICAL')) return 'technique';
  const administrative = ['/facturation', '/parametres'];
  if (administrative.some((route) => path.startsWith(route)) && hasDelegation(user, 'ADMINISTRATIVE')) return 'administrative';
  return null;
}
