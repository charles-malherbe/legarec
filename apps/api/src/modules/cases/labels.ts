import type { CaseListItem } from '@legarec/contracts';

export const STATUS_LABELS: Record<CaseListItem['status'], string> = {
  NEW: 'Nouveau',
  OVERDUE: 'En retard',
  REMINDER: 'En relance',
  FORMAL_NOTICE: 'Mise en demeure',
  PROMISE: 'Promesse',
  PLAN: 'Échéancier',
  DISPUTE: 'Litige',
  LITIGATION: 'Contentieux',
  SETTLED: 'Réglé',
  LOST: 'Irrécouvrable',
};
