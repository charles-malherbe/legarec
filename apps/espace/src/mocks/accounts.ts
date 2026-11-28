import type { Session } from '@legarec/contracts';

const base = {
  directorName: 'Marie Dubreuil',
  activeDelegations: ['TECHNICAL', 'ADMINISTRATIVE'] as Session['activeDelegations'],
  twoFactorEnabled: false,
  preferences: { theme: 'light', density: 'comfortable', lowVision: false, menuCollapsed: false, menuClosedGroups: [] } as Session['preferences'],
};

/** Fictitious demonstration accounts; only used by MSW. */
export const ACCOUNTS: Session[] = [
  { ...base, userId: 'cl', firstName: 'Camille', lastName: 'Laurent', email: 'cl@legarec.fr', role: 'COLLECTION_MANAGER', extension: '101' },
  { ...base, userId: 'hb', firstName: 'Hugo', lastName: 'Benali', email: 'hb@legarec.fr', role: 'CLAIMS_OFFICER', extension: '102' },
  { ...base, userId: 'ad', firstName: 'Marie', lastName: 'Dubreuil', email: 'mdu@legarec.fr', role: 'DIRECTOR', extension: null },
  { ...base, userId: 'dev', firstName: 'Nora', lastName: 'Petit', email: 'support@legarec.fr', role: 'DEVELOPER', extension: null, twoFactorEnabled: true },
];
export const DEMO_PASSWORD = 'motdepasse12';
