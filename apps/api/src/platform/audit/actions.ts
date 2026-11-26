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
  PROOF_GIVEN: 'Identité confirmée avant une action sensible',
  PROOF_REFUSED: 'Confirmation d’identité refusée',
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
  // Creditors
  CREDITOR_CREATED: 'Créancier créé',
  CREDITOR_CHANGED: 'Fiche d’un créancier modifiée',
  MANDATE_AMENDED: 'Avenant enregistré',
  CREDITOR_ACCOUNT_CHANGED: 'Compte de reversement enregistré',
  CREDITOR_ACCOUNT_CONFIRMED: 'Compte de reversement confirmé par téléphone',
  CREDITOR_IBAN_SHOWN: 'IBAN d’un créancier affiché',
  // Cases
  CASE_OPENED: 'Dossier ouvert',
  CASES_ASSIGNED: 'Dossiers attribués : {count}',
  CASE_DEPOSITED: 'Créance déposée par un créancier : {count} factures',
  CASE_INVOICES_ADDED: 'Factures ajoutées à un dossier : {count}',
  // Debtors
  DEBTOR_SIGNED_IN: 'Connexion d’un débiteur',
  DEBTOR_ACCESS_BLOCKED: 'Accès d’un débiteur bloqué après dix codes faux',
  DEBTOR_ACCESS_ALERT: 'Accès débiteur : plus de 200 codes faux en une heure, adresses en cause suspendues 15 minutes',
  // Documents
  DOCUMENT_ATTACHED: 'Document importé et rattaché à un dossier',
  DOCUMENT_TO_FILE: 'Document importé, à classer',
  DOCUMENT_SHARED: 'Document partagé au créancier',
  DOCUMENT_DOWNLOADED: 'Document téléchargé hors de ses dossiers',
  // Templates
  TEMPLATE_IMPORTED: 'Modèle importé',
  TEMPLATE_RESTORED: 'Version d’un modèle restaurée',
  TEMPLATE_SUBMITTED: 'Modèle soumis à validation',
  TEMPLATE_CANCELLED: 'Import d’un modèle annulé',
  TEMPLATE_PUBLISHED: 'Modèle publié',
  TEMPLATE_REJECTED: 'Modèle refusé',
  // Money
  PAYMENT_RECORDED: 'Paiement enregistré',
  PAYMENT_SETTLED: 'Paiement définitif, quittance émise',
  PAYMENT_BOUNCED: 'Chèque impayé enregistré',
  PLAN_ASKED: 'Échéancier demandé : {count} mensualités',
  PLAN_REFUSED: 'Échéancier de {months} mois refusé',
  PLAN_CREDITOR_APPROVED: 'Échéancier de {months} mois accepté par le créancier',
  PLAN_CREDITOR_REFUSED: 'Échéancier de {months} mois refusé par le créancier',
  ECB_RATE_SAVED: 'Taux de la BCE saisi pour le semestre du {day}',
  LEGAL_RATE_SAVED: 'Taux légal des particuliers saisi pour le semestre du {day}',
  CONTACT_ADDED: 'Coordonnée d’un débiteur ajoutée',
  CONTACT_CHANGED: 'Coordonnée d’un débiteur modifiée',
  // Platform
  ACCESS_CODE_RENEWED: 'Code d’accès régénéré',
  DEBTOR_CORRECTED: 'Nom ou type d’un débiteur corrigé',
  CASE_NOTE_ADDED: 'Note ajoutée à un dossier',
  SETTING_CHANGED: 'Paramètres modifiés : {count}',
  FIRM_IDENTITY_CHANGED: 'Identifiants du cabinet modifiés : {count}',
  SECRET_SAVED: 'Secret enregistré : {secret}',
  SECRET_RENEWED: 'Secret renouvelé : {secret}',
  SECRET_REVOKE_ASKED: 'Révocation demandée : {secret}',
  SECRET_REVOKED: 'Secret révoqué : {secret}',
  SECRET_KEPT: 'Révocation refusée : {secret}',
  PLAN_APPROVED: 'Échéancier de {months} mois validé',
  // Litigation (question 163)
  LITIGATION_OPENED: 'Dossier passé en contentieux',
  LITIGATION_CONSENT_NOTED: 'Accord écrit du créancier noté pour le contentieux',
  LITIGATION_STAGE_CHANGED: 'Contentieux : étape {stage} sur 4',
  LITIGATION_CLOSED: 'Procédure contentieuse close',
  // Remittances
  REMITTANCES_VALIDATED: 'Lot de reversements validé : {count} virements',
  REMITTANCE_RETAINED: 'Créancier retenu du lot de reversements',
  REMITTANCES_PAID: 'Reversements marqués comme versés',
  CREDIT_NOTE_ISSUED: 'Avoir émis',
  CREDIT_NOTE_DRAFT_SAVED: 'Brouillon d’avoir enregistré',
  CREDIT_NOTE_DRAFT_DELETED: 'Brouillon d’avoir supprimé',
  // Registry of the RGPD
  GDPR_REQUEST_ADDED: 'Demande RGPD enregistrée',
  GDPR_REQUEST_ANSWERED: 'Demande RGPD traitée',
  GDPR_REQUEST_REFUSED: 'Demande RGPD refusée',
  GDPR_REQUEST_OPEN: 'Demande RGPD rouverte',
  GDPR_EXPORTED: 'Export RGPD des données d’un débiteur',
  GDPR_ERASED: 'Données d’un débiteur anonymisées à sa demande : {count} dossiers',
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
