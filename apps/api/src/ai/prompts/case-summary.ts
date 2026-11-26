import { z } from 'zod';

/** Versioned: a change of the text is a new version, kept in the journal of each suggestion. */
export const CASE_SUMMARY_VERSION = 'synthese-dossier-v1';
export const CASE_SUMMARY_KEYS = ['Situation', 'Promesses', 'Dernier contact', 'Blocage', 'Suggestion'] as const;

export const caseSummaryOutput = z.object({
  lines: z
    .array(z.object({ k: z.enum(CASE_SUMMARY_KEYS), v: z.string().trim().min(1).max(220) }))
    .length(5)
    .refine((lines) => CASE_SUMMARY_KEYS.every((key, index) => lines[index]?.k === key), { error: 'order' }),
});
export type CaseSummary = z.infer<typeof caseSummaryOutput>;

export const CASE_SUMMARY_SYSTEM = `Tu aides un cabinet de recouvrement amiable français à relire un dossier.
Tu rédiges une synthèse en cinq lignes, en français, factuelle et neutre, à partir des seules données fournies.
Règles fixes :
- Tu proposes, un collaborateur décide : jamais de décision, jamais de note ni de score de solvabilité.
- Aucune pression ni menace, aucune procédure présentée comme certaine, aucun frais non dû, jamais l'employeur ni la famille du débiteur.
- Aucune donnée bancaire. Montants au format français (48 200 €), dates JJ/MM.
- Si une donnée manque, écris « Non renseigné ».
Réponds uniquement par un objet JSON : {"lines":[{"k":"Situation","v":"…"},{"k":"Promesses","v":"…"},{"k":"Dernier contact","v":"…"},{"k":"Blocage","v":"…"},{"k":"Suggestion","v":"…"}]}, chaque « v » en 220 caractères au plus.`;

export interface CaseFacts {
  reference: string;
  status: string;
  creditor: string;
  debtorKind: string;
  outstanding: string;
  daysLate: number | null;
  invoices: { number: string; dueOn: string; left: string }[];
  plan: string | null;
  events: { on: string; title: string; detail: string | null }[];
}
/** What the case says, nothing more: no name of the debtor, no contact detail, no access code. */
export function caseSummaryInput(facts: CaseFacts): string {
  return [
    `Dossier ${facts.reference} · statut : ${facts.status} · créancier : ${facts.creditor} · débiteur : ${facts.debtorKind}`,
    `Reste dû : ${facts.outstanding}${facts.daysLate ? ` · ${facts.daysLate} jours de retard` : ''}`,
    `Factures ouvertes : ${facts.invoices.map((item) => `${item.number} (échéance ${item.dueOn}, reste ${item.left})`).join(' ; ') || 'aucune'}`,
    `Échéancier : ${facts.plan ?? 'aucun'}`,
    'Historique, du plus récent au plus ancien :',
    ...facts.events.map((event) => `- ${event.on} · ${event.title}${event.detail ? ` · ${event.detail}` : ''}`),
  ].join('\n');
}
