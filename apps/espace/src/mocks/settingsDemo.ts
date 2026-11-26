import type { SettingField, SettingGroup, SettingTable } from '@legarec/contracts';

/** What the mockup shows of services that the simulations do not have. */
type Tone = SettingField['statusTone'];
const ok = (label: string) => ({ text: label, tone: 'success' as Tone });
const STATUS: Record<string, [string, Tone]> = {
  cabinet: ['RC professionnelle à renouveler dans 40 jours', 'warning'],
  users: ['8 comptes actifs', 'neutral'],
  scenarios: ['Scénario B2B actif · 6 étapes', 'success'],
  modeles: ['12 modèles', 'neutral'],
  sms: ['OVHcloud connecté · 1 196 SMS ce mois', 'success'],
  reversements: ['Prochain reversement le 1er décembre', 'info'],
  ia: ['Désactivé en production · 6,40 € sur 40 € ce mois', 'info'],
  telephonie: ['3CX connecté · 4 postes', 'success'],
  emails: ['Resend et OVH connectés', 'success'],
  boites: ['1 boîte à reconnecter', 'warning'],
  integrations: ['5 intégrations actives', 'success'],
  secrets: ['2 secrets à renouveler', 'warning'],
  audit: ['Dernière action il y a 2 min', 'neutral'],
};
const FIELDS: Record<string, Partial<SettingField>> = {
  'cabinet.insurance': { description: 'Attestation 2026 · expire le 31/12/2026', status: 'À renouveler dans 40 jours', statusTone: 'warning' },
  'cabinet.funds': { description: '[IBAN DU COMPTE DÉDIÉ]', status: 'À vérifier', statusTone: 'warning' },
  'cabinet.prosecutor': { description: 'Justificatif déposé le 14/01/2024', status: 'À jour', statusTone: 'success' },
  'sms.provider': { status: 'Connecté', statusTone: 'success' },
  'sms.credits': { value: '18 420 SMS' },
  'telephonie.instance': { status: 'Connecté', statusTone: 'success' },
  'telephonie.sync': { value: 'il y a 20 s' },
  'emails.state': { value: 'Connecté', status: 'Actif', statusTone: 'success' },
  'emails.domain': { status: 'Vérifié', statusTone: 'success' },
  'emails.shared': { status: 'Synchronisée', statusTone: 'success' },
  'integrations.hooks': { value: '2 points de terminaison actifs' },
  'securite.tfa': { value: '7 comptes sur 8' },
  'ia.budget': { description: 'Au-delà, les fonctions passent en pause jusqu’au mois suivant ; alerte à 80 %. 6,40 € consommés ce mois.' },
};
const ROWS: Record<string, SettingTable['rows']> = {
  'ai-log': [
    ['23/11 10:42', 'Résumé d’appel', 'Camille Laurent', ok('Acceptée')],
    ['23/11 10:15', 'Brouillon de réponse', 'Camille Laurent', { text: 'Modifiée', tone: 'info' }],
    ['23/11 09:58', 'Tri des e-mails', 'Thomas Giraud', ok('Acceptée')],
    ['22/11 17:20', 'Synthèse du dossier', 'Hugo Benali', { text: 'Signalée', tone: 'warning' }],
    ['22/11 16:03', 'Tri des e-mails', 'Sarah Morel', { text: 'Corrigée', tone: 'info' }],
    ['22/11 14:47', 'Résumé d’appel', 'Thomas Giraud', { text: 'Ignorée', tone: 'neutral' }],
  ],
  extensions: [
    ['Camille Laurent', '101', '800', ok('En appel')],
    ['Hugo Benali', '102', '800', { text: 'Disponible', tone: 'info' }],
    ['Sarah Morel', '103', '800', { text: 'Pause', tone: 'warning' }],
    ['Thomas Giraud', '104', '800', { text: 'Absent', tone: 'neutral' }],
  ],
  audit: [
    ['21/11/2026 11:58', 'Camille Laurent', '', 'Validation d’un échéancier de 8 mois', '91.168.•••.12'],
    ['21/11/2026 10:44', 'Marie Dubreuil', '', 'Export des données (Rapports)', '91.168.•••.40'],
    ['21/11/2026 09:02', 'Camille Laurent', '', 'Connexion réussie (2FA)', '91.168.•••.12'],
    ['21/11/2026 08:57', 'Inconnu', '', '3 tentatives de connexion échouées (compte hb)', '185.22.•••.7'],
    ['20/11/2026 18:30', 'Nora Petit', 'Marie Dubreuil', 'Modification de la configuration des webhooks', '10.0.•••.3'],
    ['20/11/2026 16:12', 'Marie Dubreuil', '', 'Création du compte de Lucas Perrin', '91.168.•••.40'],
    ['20/11/2026 14:05', 'Claire Besson', '', 'Connexion à l’espace créancier', '78.192.•••.88'],
  ],
};
const tables = (items: SettingTable[] = []) =>
  items.map((item) => ({
    ...item,
    ...(item.id === 'ai-log'
      ? { description: `${item.description} 30 derniers jours : 82 % acceptées telles quelles, 13 % modifiées, 5 % ignorées, 3 signalements.` }
      : {}),
    rows:
      item.id === 'tools'
        ? item.rows.map((row) => (['Signature électronique', 'Données entreprises'].includes(String(row[0])) ? row : [...row.slice(0, 2), ok('Connecté')]))
        : (ROWS[item.id] ?? item.rows),
  }));

export const asInMockup = (groups: SettingGroup[]): SettingGroup[] =>
  groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      status: STATUS[item.id]?.[0] ?? item.status,
      tone: STATUS[item.id]?.[1] ?? item.tone,
      blocks: item.blocks.map((block) => ({ ...block, fields: block.fields.map((field) => ({ ...field, ...FIELDS[`${item.id}.${field.id}`] })) })),
      tables: tables(item.tables),
    })),
  }));
