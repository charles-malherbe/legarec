import type { BillingLine, BillingType } from '@legarec/contracts';

interface Template {
  id: string;
  label: string;
  hint: string;
  lines: BillingLine[];
}
const line = (label: string, quantity: string, unitPrice: string): BillingLine => ({ label, quantity, unitPrice });

export const TYPES: Record<BillingType, { label: string; hint: string; issue: string; legal: string; templates: Template[] }> = {
  INVOICE: {
    label: 'Facture',
    hint: 'Commission, frais refacturés',
    issue: 'Émettre la facture',
    legal:
      'Paiement à 30 jours, ou par déduction du reversement. Pénalités de retard : [TAUX DES PÉNALITÉS]. Indemnité forfaitaire pour frais de recouvrement : 40 € (article L441-10 du Code de commerce). Escompte pour paiement anticipé : néant. Catégorie de l’opération : prestation de services. [CAPITAL ET RCS]',
    templates: [
      {
        id: 'commission',
        label: 'Facture de commission mensuelle',
        hint: 'Commission sur les sommes recouvrées, déduite du reversement',
        lines: [
          line('Commission de recouvrement · 8 % de 62 180,00 € encaissés en novembre 2026', '1', '4974,40'),
          line('Frais d’ouverture de dossier · nouveaux débiteurs', '3', '15,00'),
        ],
      },
      {
        id: 'frais',
        label: 'Refacturation de frais de procédure',
        hint: 'Frais de commissaire de justice et de greffe avancés',
        lines: [
          line('Frais de commissaire de justice · signification (Charpentes Bellet)', '1', '89,67'),
          line('Frais de greffe · requête en injonction de payer', '1', '35,21'),
        ],
      },
      {
        id: 'forfait',
        label: 'Facture forfaitaire',
        hint: 'Mise en place ou traitement spécifique',
        lines: [line('Mise en place du portefeuille et import des factures depuis l’ERP', '1', '450,00')],
      },
    ],
  },
  QUOTE: {
    label: 'Devis',
    hint: 'Prospects et nouveaux mandats',
    issue: 'Envoyer le devis',
    legal:
      'Devis valable 30 jours. Bon pour accord : signature électronique ou retour du devis signé. Les frais de procédure réels sont refacturés sur justificatif.',
    templates: [
      {
        id: 'amiable',
        label: 'Devis recouvrement amiable',
        hint: 'Commission et frais de dossier',
        lines: [line('Frais d’ouverture de dossier', '40', '15,00'), line('Commission de 8 % sur encaissements (estimation sur 120 000 €)', '1', '9600,00')],
      },
      {
        id: 'judiciaire',
        label: 'Devis recouvrement judiciaire',
        hint: 'Honoraires et frais de procédure estimés',
        lines: [line('Honoraires · procédure d’injonction de payer', '1', '350,00'), line('Frais de commissaire de justice (estimation)', '1', '180,00')],
      },
      {
        id: 'audit',
        label: 'Devis audit de portefeuille',
        hint: 'Analyse des créances avant mandat',
        lines: [line('Audit de portefeuille · jusqu’à 500 factures', '1', '1200,00')],
      },
    ],
  },
  CONTRACT: {
    label: 'Contrat',
    hint: 'Convention, avenant, mandat',
    issue: 'Envoyer pour signature',
    legal:
      'Le cabinet agit au nom et pour le compte du créancier, dans le respect des articles R124-1 et suivants du Code des procédures civiles d’exécution. Les fonds encaissés sont reversés sur un compte dédié.',
    templates: [
      { id: 'convention', label: 'Convention de recouvrement amiable', hint: 'Contrat cadre avec un créancier', lines: [] },
      { id: 'avenant', label: 'Avenant tarifaire', hint: 'Modifie le taux ou les frais d’une convention', lines: [] },
      { id: 'mandat', label: 'Mandat de recouvrement judiciaire', hint: 'Autorise les procédures pour un dossier', lines: [] },
    ],
  },
};
export const CONTRACT_TERMS = [
  ['rate', 'Taux de commission', '8 % HT'],
  ['fee', 'Frais d’ouverture par dossier', '15 € HT'],
  ['start', 'Date d’effet', '01/01/2027'],
  ['term', 'Durée', '12 mois, reconductible'],
  ['notice', 'Préavis de résiliation', '3 mois'],
  ['plan', 'Échéancier sans accord du créancier', 'jusqu’à 6 mois'],
].map(([id, label, value]) => ({ id: id ?? '', label: label ?? '', value: value ?? '' }));
