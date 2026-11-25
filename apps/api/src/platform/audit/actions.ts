/**
 * Every sensitive action, with the French sentence of the audit screen. Values between braces come from the parameters,
 * which PostgreSQL limits to identifiers, dates, roles, technical names and short numbers: nothing typed by anyone.
 */
export const AUDIT_ACTIONS = {
  CASE_NOTE_ADDED: 'Note ajoutée à un dossier',
  SETTING_CHANGED: 'Paramètres modifiés',
  SECRET_SAVED: 'Secret enregistré : {secret}',
  PLAN_APPROVED: 'Échéancier de {months} mois validé',
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function auditSentence(action: string, params: Record<string, unknown>): string {
  const sentence: string = AUDIT_ACTIONS[action as AuditAction] ?? action;
  return sentence.replace(/\{(\w+)\}/gu, (_whole, name: string) => String(params[name] ?? ''));
}
