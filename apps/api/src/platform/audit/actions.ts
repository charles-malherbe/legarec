import { ROLE_LABELS, type Role } from '@legarec/contracts';

/**
 * Every sensitive action, with the French sentence of the audit screen. Values between braces come from the parameters,
 * which PostgreSQL limits to identifiers, dates, roles, technical names and short numbers: nothing typed by anyone.
 */
export const AUDIT_ACTIONS = {
  // Sign-in
  SIGNED_IN: 'Connexion réussie',
  SIGN_IN_REFUSED: 'Connexion refusée',
  WRONG_PORTAL: 'Connexion sur le mauvais portail',
  PASSWORD_ACCEPTED: 'Mot de passe accepté, double authentification attendue',
  SECOND_FACTOR_REFUSED: 'Code de double authentification refusé',
  ACCOUNT_LOCKED: 'Compte bloqué 15 minutes après 5 échecs',
  BACKUP_CODE_USED: 'Connexion avec un code de secours',
  PASSWORD_RESET_ASKED: 'Lien de réinitialisation demandé',
  PASSWORD_RESET: 'Mot de passe réinitialisé',
  ACCOUNT_ACTIVATED: 'Compte activé',
  // One's own account
  NAME_CHANGED: 'Nom modifié dans Mon compte',
  PASSWORD_CHANGED: 'Mot de passe modifié',
  PASSWORD_REFUSED: 'Mot de passe actuel refusé dans Mon compte',
  SECOND_FACTOR_ENABLED: 'Double authentification activée',
  SECOND_FACTOR_DISABLED: 'Double authentification désactivée',
  SESSIONS_CLOSED: 'Sessions fermées : {count}',
  // Accounts of the others
  MEMBER_INVITED: 'Invitation créée ({role})',
  INVITATION_CANCELLED: 'Invitation annulée ({role})',
  MEMBER_DISABLED: 'Compte désactivé ({role})',
  MEMBER_ENABLED: 'Compte réactivé ({role})',
  MEMBER_ROLE_CHANGED: 'Rôle modifié : {from} → {to}',
  MEMBER_EXTENSION_CHANGED: 'Poste 3CX modifié',
  RESET_LINK_SENT: 'Lien de réinitialisation envoyé',
  SECOND_FACTOR_REQUIRED: 'Double authentification exigée',
  SECOND_FACTOR_RESET: 'Double authentification réinitialisée',
  ACCOUNT_UNLOCKED: 'Compte débloqué',
  DELEGATION_GIVEN: 'Délégation {delegation} redonnée',
  DELEGATION_WITHDRAWN: 'Délégation {delegation} retirée',
  LINK_DRAWN: 'Lien créé depuis le serveur',
  DIRECTOR_CREATED: 'Compte du Directeur créé depuis le serveur',
  // Platform
  CASE_NOTE_ADDED: 'Note ajoutée à un dossier',
  SETTING_CHANGED: 'Paramètres modifiés',
  SECRET_SAVED: 'Secret enregistré : {secret}',
  PLAN_APPROVED: 'Échéancier de {months} mois validé',
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

const WORDS: Record<string, string> = { ...ROLE_LABELS, TECHNICAL: 'technique', ADMINISTRATIVE: 'administrative' } satisfies Record<Role, string> &
  Record<string, string>;

export function auditSentence(action: string, params: Record<string, unknown>): string {
  const sentence: string = AUDIT_ACTIONS[action as AuditAction] ?? action;
  return sentence.replace(/\{(\w+)\}/gu, (_whole, name: string) => {
    const value = String(params[name] ?? '');
    return Object.hasOwn(WORDS, value) ? WORDS[value]! : value;
  });
}
