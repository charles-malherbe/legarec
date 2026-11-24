import {
  canAccessTechnicalSettings,
  hasDelegation,
  type GdprRequest,
  type Mailbox,
  type SecretItem,
  type Session,
  type SettingField,
  type SettingsHub,
  type SettingsSection,
  type SettingTable,
} from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { audit, auditEntries, resetAudit } from '../audit';
import { done, forbidden, guarded, notFound } from '../http';
import { administers } from './steering';

type Info = { request: Request; params: Record<string, unknown> };
type Tone = SettingField['statusTone'];
type Block = SettingsSection['blocks'][number];
const staff = (session: Session) => session.role !== 'CREDITOR';

const base = { description: '', value: '', checked: false, options: [] as string[], locked: false, status: null, statusTone: 'neutral' as Tone };
const text = (id: string, label: string, description: string, value: string): SettingField => ({ ...base, id, kind: 'text', label, description, value });
const select = (id: string, label: string, description: string, options: string[]): SettingField => ({
  ...base,
  id,
  kind: 'select',
  label,
  description,
  options,
  value: options[0]!,
});
const sw = (id: string, label: string, description: string, checked = true, locked = false): SettingField => ({
  ...base,
  id,
  kind: 'switch',
  label,
  description,
  checked,
  locked,
});
const value = (id: string, label: string, description: string, shown: string, status: string | null = null, statusTone: Tone = 'neutral'): SettingField => ({
  ...base,
  id,
  kind: 'value',
  label,
  description,
  value: shown,
  status,
  statusTone,
});
const block = (id: string, title: string, description: string, fields: SettingField[]): Block => ({ id, title, description, fields });
const table = (id: string, title: string, description: string, columns: string[], rows: SettingTable['rows']): SettingTable => ({
  id,
  title,
  description,
  columns,
  rows,
});
const ok = (label: string) => ({ text: label, tone: 'success' as Tone });

type Definition = {
  id: string;
  title: string;
  description: string;
  icon: string;
  status: string;
  tone: Tone;
  blocks: Block[];
  tables?: SettingTable[];
  notes?: string[];
};
type Group = { label: string; items: Definition[] };
const section = (
  id: string,
  title: string,
  description: string,
  icon: string,
  status: string,
  tone: Tone,
  blocks: Block[] = [],
  tables: SettingTable[] = [],
  notes: string[] = [],
): Definition => ({ id, title, description, icon, status, tone, blocks, tables, notes });

const firmGroups = (): Group[] => [
  {
    label: 'Organisation',
    items: [
      section('cabinet', 'Cabinet', 'Identité et obligations légales', 'building', 'RC professionnelle à renouveler dans 40 jours', 'warning', [
        block('identity', 'Identité du cabinet', 'Apparaît sur les courriers, e-mails, SMS et dans les espaces débiteur et créancier.', [
          text('name', 'Raison sociale', 'Nom légal de la société', 'LEGAREC'),
          text('display', 'Nom affiché', 'Utilisé dans les e-mails et l’espace de paiement', 'Legarec – Cabinet de recouvrement'),
          text('siren', 'SIREN', '9 chiffres', '[SIREN]'),
          text('address', 'Adresse du siège', '', '[ADRESSE DU CABINET]'),
          text('phone', 'Téléphone du service', 'Affiché aux débiteurs', '01 87 88 02 98'),
          text('hours', 'Horaires d’ouverture', 'Utilisés pour les appels et la réponse automatique', 'Lundi au vendredi, 9 h – 19 h'),
        ]),
        block('duties', 'Obligations de l’activité', 'Pièces exigées pour exercer le recouvrement amiable pour le compte d’autrui.', [
          value('insurance', 'Assurance RC professionnelle', 'Attestation 2026 · expire le 31/12/2026', '', 'À renouveler dans 40 jours', 'warning'),
          value('funds', 'Compte dédié aux fonds encaissés', '[IBAN DU COMPTE DÉDIÉ]', '', 'Vérifié', 'success'),
          value('prosecutor', 'Déclaration au procureur', 'Justificatif déposé le 14/01/2024', '', 'À jour', 'success'),
        ]),
      ]),
      section('users', 'Comptes utilisateurs', 'Équipe Legarec, accès des créanciers et invitations', 'users', '8 comptes actifs', 'neutral'),
      section(
        'roles',
        'Rôles et permissions',
        'Qui peut faire quoi',
        'shield',
        '5 rôles',
        'neutral',
        [],
        [
          table(
            'permissions',
            'Rôles et permissions',
            'Directeur, Responsable du recouvrement et Développeur sont des rôles uniques. « Par délégation » : droit du Directeur, actif tant que la délégation n’est pas retirée.',
            ['Action', 'Développeur', 'Directeur', 'Responsable du recouvrement', 'Gestionnaire de créances'],
            [
              ['Configuration technique (API, e-mails, boîtes OVH, journaux)', 'Par délégation', 'Oui', 'Non', 'Non'],
              ['Paramètres du cabinet et seuil des échéanciers', 'Non', 'Oui', 'Par délégation', 'Non'],
              ['Inviter, désactiver ou changer le rôle d’un compte', 'Support des comptes', 'Oui', 'Par délégation', 'Non'],
              ['Voir les tableaux de bord globaux (CA, taux de recouvrement)', 'Non', 'Oui', 'Son équipe', 'Non'],
              ['Voir les dossiers', 'Non', 'Tous', 'Équipe et sans gestionnaire', 'Ses dossiers'],
              ['Gérer les créanciers (clients)', 'Non', 'Oui', 'Oui', 'Lecture'],
              ['Affecter les dossiers aux gestionnaires', 'Non', 'Oui', 'Par délégation', 'Non'],
              ['Valider un échéancier, une remise ou un abandon de créance', 'Non', 'Oui', 'Oui', 'Non'],
              ['Traiter un dossier (relances, notes, appels)', 'Non', 'Ses dossiers', 'Ses dossiers et ceux de l’équipe', 'Ses dossiers'],
              ['Proposer un échéancier', 'Non', 'Ses dossiers', 'Oui', 'Oui'],
              ['Valider les modèles de documents', 'Non', 'Oui', 'Par délégation', 'Non'],
              ['Facturation et reversements', 'Non', 'Oui', 'Par délégation', 'Non'],
              ['Exporter les données', 'Non', 'Oui', 'Oui', 'Non'],
            ],
          ),
        ],
        ['Les créanciers se connectent sur partenaires.legarec.fr et ne voient que leurs propres dossiers.'],
      ),
      section('kit', 'Kit média', 'Logos, couleurs et typographie à télécharger ou à partager par URL', 'image', '4 logos, 4 couleurs, 2 polices', 'neutral'),
    ],
  },
  {
    label: 'Recouvrement',
    items: [
      section('scenarios', 'Scénarios de relance', 'Étapes automatiques après l’échéance', 'route', 'Scénario B2B actif · 6 étapes', 'success', [
        block('steps', 'Scénarios de relance', 'Les étapes se déclenchent après l’échéance de chaque facture et apparaissent dans l’agenda des relances.', [
          select('scenario', 'Scénario', '', ['Professionnels (B2B), standard', 'Particuliers (B2C)', 'Grands comptes']),
          sw('s1', 'J−3 · E-mail · Rappel avant échéance', 'Modèle « Rappel courtois »'),
          sw('s2', 'J+7 · E-mail · Relance n°1, rappel amiable', 'Avec relevé de compte et lien de paiement'),
          sw('s3', 'J+21 · SMS · Relance SMS', 'Lien de paiement court'),
          sw('s4', 'J+30 · E-mail · Relance n°2, relance ferme', 'Mention des pénalités de retard'),
          sw('s5', 'J+45 · Appel · Appel du gestionnaire', 'Tâche ajoutée à la file d’appels'),
          sw('s6', 'J+60 · LRAR · Mise en demeure', 'Seulement si le créancier l’autorise', false),
        ]),
        block('guards', 'Suspensions', '', [
          sw('suspend', 'Suspendre le scénario si une promesse ou un litige est enregistré', ''),
          sw('weekend', 'Ne rien envoyer le week-end et les jours fériés', ''),
        ]),
      ]),
      section('regles', 'Règles et validations', 'Frais, pénalités, seuils de validation', 'scale', '3 validations obligatoires', 'neutral', [
        block('fees', 'Frais et pénalités', 'Appliqués automatiquement aux créances entre professionnels, jamais à un particulier.', [
          value(
            'indemnity',
            'Indemnité forfaitaire',
            '40 € par facture impayée (article L441-10 du Code de commerce)',
            '40 € par facture',
            'Active',
            'success',
          ),
          select('interest', 'Intérêts de retard', 'Taux appliqué par défaut si le contrat du créancier n’en prévoit pas', [
            'Taux BCE majoré de 10 points',
            'Taux prévu au contrat du créancier',
            'Aucun',
          ]),
        ]),
        block('approvals', 'Validations', 'Actions qui nécessitent l’accord d’un Responsable du recouvrement ou du Directeur.', [
          sw('r1', 'Échéancier au-delà de la durée maximale', 'Validation par un Responsable du recouvrement ou le Directeur', true, true),
          sw('r2', 'Remise ou abandon de créance', 'Toujours soumis à validation, quel que soit le montant', true, true),
          sw('r3', 'Passage en contentieux', 'Nécessite aussi l’accord écrit du créancier'),
          select('duration', 'Durée maximale sans validation', 'Au-delà, l’échéancier part en validation', ['6 mois', '3 mois', '12 mois']),
          select('notice', 'Délai minimum avant mise en demeure', 'Après la première échéance impayée', ['60 jours', '45 jours', '90 jours']),
        ]),
      ]),
      section('relances', 'Relances', 'Plafonds de contacts et plages horaires', 'bell', 'Plafonds par débiteur et par canal', 'neutral', [
        block('limits', 'Plafonds de contacts par débiteur', 'Au-delà, l’agenda des relances prévient et l’envoi automatique attend.', [
          select('calls', 'Appels', 'Par débiteur et par semaine', ['[PLAFOND À VALIDER]', '1', '2', '3']),
          select('emails', 'E-mails', 'Par débiteur et par semaine', ['[PLAFOND À VALIDER]', '1', '2', '3']),
          select('sms', 'SMS', 'Par débiteur et par semaine', ['[PLAFOND À VALIDER]', '1', '2', '3']),
          select('letters', 'Courriers', 'Par débiteur et par mois', ['[PLAFOND À VALIDER]', '1', '2', '3']),
        ]),
        block('hours', 'Plages horaires', 'Aucun contact hors de ces plages, ni les dimanches et jours fériés.', [
          text('call-hours', 'Appels', '', 'Lundi au vendredi 9:00–19:00 · samedi 9:00–12:00'),
          text('send-hours', 'E-mails et SMS', '', 'Lundi au samedi, 9 h – 19 h'),
        ]),
      ]),
      section('modeles', 'Modèles de documents', 'Courriers, SMS, factures et contrats', 'file', '12 modèles', 'neutral'),
    ],
  },
  {
    label: 'Communication',
    items: [
      section('sms', 'SMS', 'OVHcloud : expéditeur, plages, crédits', 'sms', 'OVHcloud connecté · 1 196 SMS ce mois', 'success', [
        block('sending', 'Envoi des SMS · OVHcloud', 'Les SMS de relance partent par l’API SMS d’OVHcloud. Paramètres communs à tous les envois.', [
          value('provider', 'Fournisseur', 'Compte SMS OVHcloud, clé d’API dans Secrets et clés', 'OVHcloud SMS', 'Connecté', 'success'),
          value('sender', 'Expéditeur', 'Numéro qui reçoit les réponses des débiteurs', '[NUMÉRO SMS]'),
          text('stop', 'Numéro de désinscription', 'Mention « STOP » ajoutée à chaque SMS', '[NUMÉRO STOP]'),
          text('sms-hours', 'Plages d’envoi', 'Aucun envoi les dimanches et jours fériés', 'Lundi au samedi, 9 h – 19 h'),
          value('credits', 'Crédits disponibles', 'Rechargement automatique sous 2 000 crédits', '18 420 SMS'),
          sw('m1', 'Mention « STOP » obligatoire', 'Ajoutée automatiquement à la fin de chaque SMS', true, true),
          sw('m2', 'Lien de paiement raccourci', 'Inséré dans les SMS de relance'),
          sw('m3', 'Accusés de distribution', 'Les SMS non distribués apparaissent en rouge dans la conversation'),
        ]),
      ]),
    ],
  },
  {
    label: 'Paiements',
    items: [
      section('reversements', 'Reversements', 'Fréquence et commissions', 'euro', 'Prochain reversement le 1er décembre', 'info', [
        block('remittances', 'Reversements aux créanciers', 'Calcul des sommes encaissées, des commissions et des virements.', [
          select('frequency', 'Fréquence', '', ['Mensuelle, le 15', 'Bimensuelle, le 1er et le 15', 'Hebdomadaire, le lundi']),
          text('commission', 'Commission par défaut', 'Peut être modifiée dans la fiche de chaque créancier', '8 % HT des sommes recouvrées'),
          text('minimum', 'Seuil minimum', 'En dessous, le montant est reporté au reversement suivant', '100 €'),
          sw('v1', 'Validation du Directeur avant virement', 'Le lot de reversements attend son accord, ou celui du Responsable par délégation'),
          sw('v2', 'Relevé envoyé au créancier', 'PDF et CSV, disponibles aussi dans son espace'),
        ]),
      ]),
    ],
  },
  {
    label: 'Intelligence artificielle',
    items: [
      section(
        'ia',
        'Assistant IA',
        'Fonctions activées, garde-fous, budget et journal',
        'sparkle',
        '4 fonctions actives · 38,40 € sur 150 € ce mois',
        'info',
        [
          block(
            'features',
            'Fonctions',
            'Chaque fonction s’active séparément. Les suggestions sont toujours marquées « Proposé par l’IA » et ne sont appliquées qu’après validation d’un collaborateur.',
            [
              sw(
                'ia1',
                'Transcription et résumé des appels',
                'Résumé et qualification proposés après l’appel (Appels). Uniquement si l’enregistrement a été annoncé.',
              ),
              sw('ia2', 'Tri et analyse des e-mails', 'Catégorie, dossier rattaché, montants et dates extraits (E-mails)'),
              sw('ia3', 'Brouillons de réponse', 'Proposés dans le ton du cabinet, à relire avant envoi (E-mails, SMS)'),
              sw('ia4', 'Synthèse des dossiers', 'Résumé en 5 lignes en tête de la fiche débiteur'),
              sw('ia5', 'Lecture des factures importées', 'Pré-remplissage des créances déposées en PDF par les créanciers', false),
              sw('ia6', 'Recherche en langage courant', 'Dans la recherche rapide (touche /)', false),
            ],
          ),
          block('guards', 'Garde-fous', 'Règles fixes, non désactivables. Textes et périmètre à valider avec votre juriste et votre DPO.', [
            sw(
              'g-ia1',
              'Validation humaine obligatoire',
              'Aucun envoi, échéancier, procédure ou enregistrement ne part sans le clic d’un collaborateur',
              true,
              true,
            ),
            sw('g-ia2', 'Pas de décision automatique sur les débiteurs', 'L’IA suggère et explique, elle ne décide jamais (RGPD, article 22)', true, true),
            sw(
              'g-ia3',
              'Transcription liée au consentement',
              'Rien n’est enregistré ni analysé tant que l’annonce de l’enregistrement n’est pas cochée',
              true,
              true,
            ),
            sw('g-ia4', 'Données minimisées', 'IBAN, données bancaires et pièces d’identité masqués avant envoi à l’IA', true, true),
            sw('g-ia5', 'Mentions obligatoires hors IA', 'Les mentions légales des courriers et e-mails viennent toujours des modèles validés', true, true),
          ]),
          block('budget', 'Fournisseur et budget', 'Contrat de sous-traitance (DPA) à signer avant la mise en service.', [
            value(
              'models',
              'Modèles',
              'Un modèle rapide et économique pour le tri et l’extraction, un modèle avancé pour les synthèses et les brouillons.',
              'Choisis par l’API',
            ),
            select('hosting', 'Hébergement des traitements', 'Où les données envoyées à l’IA sont traitées.', ['À choisir', 'Europe']),
            text(
              'budget',
              'Budget mensuel',
              'Au-delà, les fonctions passent en pause jusqu’au mois suivant ; alerte à 80 %. 38,40 € consommés ce mois.',
              '150 €',
            ),
          ]),
        ],
        [
          table(
            'ai-log',
            'Journal de l’IA',
            'Chaque suggestion est conservée avec la décision prise. 30 derniers jours : 82 % acceptées telles quelles, 13 % modifiées, 5 % ignorées, 3 signalements.',
            ['Date', 'Fonction', 'Collaborateur', 'Décision'],
            [
              ['23/11 10:42', 'Résumé d’appel', 'Camille Laurent', ok('Acceptée')],
              ['23/11 10:15', 'Brouillon de réponse', 'Camille Laurent', { text: 'Modifiée', tone: 'info' }],
              ['23/11 09:58', 'Tri des e-mails', 'Thomas Giraud', ok('Acceptée')],
              ['22/11 17:20', 'Synthèse du dossier', 'Hugo Benali', { text: 'Signalée', tone: 'warning' }],
              ['22/11 16:03', 'Tri des e-mails', 'Sarah Morel', { text: 'Corrigée', tone: 'info' }],
              ['22/11 14:47', 'Résumé d’appel', 'Thomas Giraud', { text: 'Ignorée', tone: 'neutral' }],
            ],
          ),
        ],
      ),
    ],
  },
  {
    label: 'Plateforme',
    items: [
      section('rgpd', 'Données personnelles', 'Conservation et droits RGPD', 'database', 'Durées de conservation à valider', 'warning', [
        block('retention', 'Durées de conservation', 'À valider avec votre délégué à la protection des données (DPO).', [
          text('settled', 'Dossiers soldés', 'Données du débiteur et historique', '[DURÉE À VALIDER]'),
          text('lost', 'Dossiers irrécouvrables', '', '[DURÉE À VALIDER]'),
          text('recordings', 'Enregistrements d’appels', '', '[DURÉE À VALIDER]'),
          text('audit', 'Journal d’audit', '', '[DURÉE À VALIDER]'),
        ]),
        block('rights', 'Droits des personnes', 'Demandes d’accès, de rectification, d’opposition ou d’effacement reçues des débiteurs.', [
          sw('g1', 'Mention d’information dans chaque relance', 'Rappelle au débiteur ses droits et le contact du DPO'),
          sw('g2', 'Anonymisation automatique', 'À l’expiration de la durée de conservation'),
        ]),
      ]),
    ],
  },
];

const technicalGroups = (): Group[] => [
  {
    label: 'Communication',
    items: [
      section(
        'telephonie',
        'Téléphonie · 3CX',
        'Standard 3CX : postes, files, codes de qualification et options d’appel',
        'phone',
        '3CX connecté · 4 postes',
        'success',
        [
          block('pbx', 'Standard téléphonique · 3CX', 'Appels sortants et entrants, enregistrements et statuts des gestionnaires passent par 3CX.', [
            value('instance', 'Instance', '', 'legarec.on3cx.fr', 'Connecté', 'success'),
            value('number', 'Numéro principal', '', '01 87 88 02 98'),
            value('queue', 'File entrante', '', '800 « Recouvrement » · distribution au plus disponible'),
            value('wrap', 'Post-appel', '', '60 s de pause pour qualifier'),
            value('records', 'Enregistrements', '', 'Récupérés de 3CX et rattachés au dossier · 6 mois'),
            value('sync', 'Dernière synchronisation', '', 'il y a 20 s'),
          ]),
          block('calls', 'Téléphonie', 'Numéros, plages d’appel et options du dialer.', [
            select('shown', 'Numéro affiché', 'Vu par le débiteur lors des appels sortants', [
              '01 87 88 02 98 (numéro principal 3CX)',
              'Ligne directe du gestionnaire (poste 3CX)',
            ]),
            sw('t1', 'Enregistrer les appels', 'Message d’information diffusé au début de chaque appel'),
            sw('t2', 'Composition automatique', 'Le numéro suivant de la file est appelé à la fin de la qualification'),
            sw('t4', 'Fiche débiteur à l’appel entrant', '3CX reconnaît le numéro et ouvre le dossier du débiteur'),
            sw('t3', 'Transcription des appels', 'Résumé ajouté à l’historique du dossier', false),
          ]),
        ],
        [
          table(
            'extensions',
            'Postes des utilisateurs',
            '',
            ['Utilisateur', 'Poste 3CX', 'Files', 'Statut 3CX'],
            [
              ['Camille Laurent', '101', '800', ok('En appel')],
              ['Hugo Benali', '102', '800', { text: 'Disponible', tone: 'info' }],
              ['Sarah Morel', '103', '800', { text: 'Pause', tone: 'warning' }],
              ['Thomas Giraud', '104', '800', { text: 'Absent', tone: 'neutral' }],
            ],
          ),
          table(
            'codes',
            'Codes de qualification envoyés à 3CX',
            'Chaque fiche enregistrée dans Appels renvoie son code à 3CX, qui l’ajoute au rapport d’appels.',
            ['Code'],
            ['PROMESSE', 'ECHEANCIER', 'RAPPEL', 'LITIGE', 'DEJA_PAYE', 'ABSENT', 'NON_REPONSE', 'FAUX_NUMERO'].map((code) => [code]),
          ),
        ],
        ['Le secret de l’API est rangé dans Paramètres techniques › Secrets et clés.'],
      ),
      section(
        'emails',
        'E-mails',
        'Resend pour les e-mails automatiques, OVH pour la messagerie',
        'mail',
        'Resend et OVH connectés',
        'success',
        [
          block('resend', 'E-mails transactionnels · Resend', 'Envoi par API et suivi de la distribution, rattaché automatiquement au dossier.', [
            value('state', 'Statut', 'Clé API de production dans Secrets et clés', 'Connecté', 'Actif', 'success'),
            value('domain', 'Domaine d’envoi', 'Enregistrements SPF et DKIM vérifiés chez Resend', 'mail.legarec.fr', 'Vérifié', 'success'),
            value('from', 'Expéditeur', 'Adresse sans réponse', 'LEGAREC <ne-pas-repondre@mail.legarec.fr>'),
            value('reply', 'Adresse de réponse', 'Relances 1 à 3 seulement : les réponses arrivent dans « E-mails » (OVH)', 'recouvrement@legarec.fr'),
            value('events', 'Événements suivis', 'Reçus par webhook et affichés dans l’historique du dossier', 'Distribué, ouvert, clic, rebond, plainte'),
            sw('e1', 'Suivi des ouvertures', 'Affiche « ouvert le… » dans l’historique du dossier'),
            sw('e2', 'Suivi des clics', 'Indique si le lien de paiement a été ouvert'),
          ]),
          block('ovh', 'Messagerie de l’équipe · OVH MX Plan', 'Boîtes e-mail du service, en SMTP pour l’envoi et en IMAP pour la réception.', [
            value('shared', 'Boîte partagée', 'Réception seule : personne n’écrit depuis cette boîte', 'recouvrement@legarec.fr', 'Synchronisée', 'success'),
            value('smtp', 'Serveur d’envoi (SMTP)', 'Envoi depuis l’adresse de chaque collaborateur', 'smtp.mail.ovh.net · port 465 · SSL/TLS'),
            value('imap', 'Serveur de réception (IMAP)', 'Synchronisation toutes les 1 à 2 minutes', 'ssl0.ovh.net · port 993 · SSL/TLS'),
          ]),
        ],
        [
          table(
            'routes',
            'Répartition des envois',
            'Les e-mails automatiques partent par Resend. Les e-mails des débiteurs et créanciers arrivent dans la boîte partagée recouvrement@legarec.fr ; chacun répond depuis son adresse professionnelle (initiales@legarec.fr).',
            ['Type d’e-mail', 'Envoyé par', 'Adresse d’expédition'],
            [
              ...[
                'Relances automatiques des scénarios',
                'Liens vers l’espace de paiement',
                'Quittances',
                'Réinitialisation du mot de passe et codes',
                'Relevés de reversement',
                'Notifications de l’équipe',
              ].map((label) => [label, { text: 'Resend', tone: 'info' as Tone }, 'ne-pas-repondre@mail.legarec.fr']),
              ...['E-mails écrits par un gestionnaire', 'Réponses aux débiteurs et créanciers'].map((label) => [
                label,
                { text: 'OVH MX Plan', tone: 'marine' as Tone },
                'adresse du collaborateur',
              ]),
            ],
          ),
        ],
        [
          'DNS : Resend envoie depuis le sous-domaine mail.legarec.fr, qui porte ses propres enregistrements SPF, DKIM et MX de retour. Le SPF et le DKIM d’OVH restent sur legarec.fr. Les deux configurations sont indépendantes : ne pas ajouter Resend au SPF de legarec.fr.',
        ],
      ),
      section('boites', 'Boîtes e-mail', 'Boîtes OVH MX Plan : création, mots de passe, redirections, départs', 'send', '1 boîte à reconnecter', 'warning'),
    ],
  },
  {
    label: 'Plateforme',
    items: [
      section(
        'integrations',
        'Intégrations et API',
        'Outils connectés',
        'plug',
        '5 intégrations actives',
        'success',
        [
          block('api', 'Accès API', 'Pour connecter le logiciel comptable d’un créancier ou un outil interne.', [
            value('url', 'Adresse de l’API', 'Back-end utilisé par l’application, l’espace créancier et les intégrations', 'https://api.legarec.fr'),
            value('hooks', 'Webhooks', 'Paiement reçu, statut de dossier modifié', '2 points de terminaison actifs'),
          ]),
        ],
        [
          table(
            'tools',
            'Intégrations',
            'Outils qui alimentent les factures et les échanges.',
            ['Outil', 'Usage', 'État'],
            [
              ['Logiciel comptable des créanciers', 'Import automatique des factures échues', ok('Connecté')],
              ['Resend', 'E-mails transactionnels : quittances, liens de paiement, relances automatiques, codes', ok('Connecté')],
              ['OVH MX Plan', 'Messagerie de l’équipe en SMTP / IMAP', ok('Connecté')],
              ['MySendingBox', 'Lettres recommandées et courriers postaux · comptes test et production', ok('Connecté')],
              ['Scaleway Object Storage', 'Stockage S3 des documents, pièces et courriers', ok('Connecté')],
              ['Signature électronique', 'Signature des échéanciers par le débiteur', { text: 'Non connecté', tone: 'neutral' }],
              ['Données entreprises', 'Vérification SIREN, procédures collectives', { text: 'Non connecté', tone: 'neutral' }],
            ],
          ),
          table(
            'domains',
            'Domaines et sous-domaines',
            'Sous-domaines confirmés et leur destination.',
            ['Adresse', 'Usage', 'Dirige vers', 'État'],
            [
              ['legarec.fr', 'Domaine principal : site du cabinet, adresses e-mail OVH', 'Site public (hors application)', ok('Confirmé')],
              ['espace.legarec.fr', 'Portail interne de l’équipe', 'Application, accès équipe', ok('Confirmé')],
              [
                'partenaires.legarec.fr',
                'Portail créanciers : suivi de l’avancement, transmission des pièces',
                'Application, espace créancier',
                ok('Confirmé'),
              ],
              ['paiement.legarec.fr', 'Portail débiteurs : RIB, chèque, échéancier', 'Application, espace de paiement', ok('Confirmé')],
              ['api.legarec.fr', 'API back-end : données, webhooks, API créanciers', 'Serveur back-end', ok('Confirmé')],
              ['legarec.on3cx.fr', 'Standard téléphonique', '3CX (hébergé par 3CX)', ok('Confirmé')],
              ['media.legarec.fr', 'Logos du kit média', 'Stockage de fichiers statiques', ok('Confirmé')],
              ['mail.legarec.fr', 'Envoi des e-mails automatiques (ne-pas-repondre@mail.legarec.fr)', 'Resend', ok('Confirmé')],
            ],
          ),
        ],
      ),
      section('securite', 'Sécurité', 'Connexion et accès', 'lock', 'Double authentification obligatoire pour le Développeur', 'success', [
        block('facts', 'Connexion', '', [
          value('passwords', 'Mots de passe', 'Stockés uniquement hachés (Argon2)', '12 caractères minimum'),
          value('reset', 'Réinitialisation', 'Envoyé par e-mail, usage unique', 'Lien valable 1 heure'),
          value('tfa', 'Double authentification', 'Proposée aux autres rôles dans Mon compte', '7 comptes sur 8'),
        ]),
        block('rules', 'Règles d’accès', 'Appliquées à tous les comptes, créanciers compris.', [
          sw('x1', 'Double authentification obligatoire pour le Développeur', 'Ce compte ne peut pas se connecter sans 2FA', true, true),
          sw('x5', 'Recommander la 2FA aux autres rôles', 'Rappel affiché à chaque connexion tant qu’elle n’est pas activée'),
          sw('x6', 'Bloquer le compte après 5 tentatives échouées', 'Blocage de 15 minutes, alerte envoyée à l’utilisateur', true, true),
          sw('x7', 'Déconnexion automatique après 30 minutes d’inactivité', 'S’applique à tous les comptes, créanciers compris', true, true),
          sw('x8', 'Journal d’audit', 'Chaque connexion et chaque action sensible est enregistrée (utilisateur, action, date, adresse IP)', true, true),
          sw('x2', 'Cloisonnement par créancier', 'Un gestionnaire ne voit que ses dossiers, un créancier que les siens', true, true),
          sw('x3', 'Masquer les IBAN des débiteurs', 'Visibles seulement par le Directeur'),
        ]),
      ]),
      section('secrets', 'Secrets et clés', 'Clés d’API et mots de passe techniques, rotation et révocation', 'key', '2 secrets à renouveler', 'warning', [
        block('rules', 'Règles de gestion', '', [
          sw('k1', 'Rotation automatique', 'Les clés compatibles sont renouvelées tous les 90 jours, sans interruption de service'),
          sw('k2', 'Alerte avant expiration', 'Le Développeur est prévenu 15 jours avant l’expiration d’un secret'),
          sw('k3', 'Double validation pour révoquer', 'Une révocation en production demande l’accord du Directeur'),
        ]),
      ]),
      section(
        'audit',
        'Journal d’audit',
        'Connexions et actions sensibles',
        'list',
        'Dernière action il y a 2 min',
        'neutral',
        [],
        [
          table(
            'audit',
            'Journal d’audit',
            'Chaque connexion et chaque action sensible est enregistrée : utilisateur, pour le compte de qui, action, date, adresse IP.',
            ['Date', 'Utilisateur', 'Pour le compte de', 'Action', 'Adresse IP'],
            [
              ['21/11/2026 11:58', 'Camille Laurent', '', 'Validation d’un échéancier de 8 mois', '91.168.•••.12'],
              ['21/11/2026 10:44', 'Marie Dubreuil', '', 'Export des données (Rapports)', '91.168.•••.40'],
              ['21/11/2026 09:02', 'Camille Laurent', '', 'Connexion réussie (2FA)', '91.168.•••.12'],
              ['21/11/2026 08:57', 'Inconnu', '', '3 tentatives de connexion échouées (compte hb)', '185.22.•••.7'],
              ['20/11/2026 18:30', 'Nora Petit', 'Marie Dubreuil', 'Modification de la configuration des webhooks', '10.0.•••.3'],
              ['20/11/2026 16:12', 'Marie Dubreuil', '', 'Création du compte de Lucas Perrin', '91.168.•••.40'],
              ['20/11/2026 14:05', 'Claire Besson', '', 'Connexion à l’espace créancier', '78.192.•••.88'],
            ],
          ),
        ],
      ),
    ],
  },
];

let groups = { firm: firmGroups(), technical: technicalGroups() };
const scopeOf = (value: unknown) => (value === 'techniques' ? 'technical' : 'firm');
const canRead = (scope: 'firm' | 'technical', session: Session) => (scope === 'technical' ? canAccessTechnicalSettings(session) : staff(session));
const canEdit = (scope: 'firm' | 'technical', session: Session) =>
  scope === 'technical' ? session.role === 'DIRECTOR' || hasDelegation(session, 'TECHNICAL') : administers(session);
const seesMembers = (session: Session) => session.role !== 'CLAIMS_OFFICER';
/** The GDPR registry names debtors: no access for the Developer, nor beyond one's duty for officers. */
const keepsRegistry = (session: Session) => administers(session);

const seedSecrets = (): SecretItem[] =>
  (
    [
      ['k-resend', 'RESEND_API_KEY', 'Resend', 'il y a 2 min', '02/10/2026', 'VALID'],
      ['k-box', 'MAILBOX_SECRETS_KEY', 'Boîtes OVH (chiffrement des mots de passe)', 'il y a 1 min', '24/08/2026', 'EXPIRING'],
      ['k-ovh', 'OVH_API_APP_SECRET', 'API OVHcloud (boîtes e-mail)', 'il y a 1 h', '24/08/2026', 'VALID'],
      ['k-msb', 'MYSENDINGBOX_API_KEY', 'MySendingBox (lettres recommandées)', 'il y a 4 min', '15/09/2026', 'VALID'],
      ['k-s3', 'SCW_SECRET_KEY', 'Scaleway Object Storage (fichiers)', 'il y a 3 min', '15/09/2026', 'VALID'],
      ['k-sms', 'OVH_SMS_APP_SECRET', 'OVHcloud SMS', 'il y a 14 min', '30/09/2026', 'VALID'],
      ['k-3cx', 'TCX_API_CLIENT_SECRET', '3CX (API Call Control)', 'en continu', '01/09/2026', 'EXPIRING'],
      ['k-session', 'SESSION_SIGNING_KEY', 'Plateforme Legarec', 'en continu', '06/11/2026', 'VALID'],
    ] as const
  ).map(([id, name, service, used, rotated, status]) => ({ id, name, service, environment: 'Production', used, rotated, status }));
let secrets = seedSecrets();

const SHARED = 'recouvrement@legarec.fr';
const box = (id: string, local: string, holder: string | null, kind: Mailbox['kind'], usedMb: number, connection: Mailbox['connection'] = 'OK'): Mailbox => ({
  id,
  address: `${local}@legarec.fr`,
  holder,
  kind,
  usedMb,
  sizeMb: 5000,
  connection,
  protected: kind === 'SHARED',
  redirections: [],
  autoReply: null,
});
const seedBoxes = (): Mailbox[] => [
  box('b1', 'recouvrement', null, 'SHARED', 2140),
  box('b2', 'cl', 'Camille Laurent', 'MEMBER', 1280),
  box('b3', 'tg', 'Thomas Giraud', 'MEMBER', 910),
  box('b4', 'hb', 'Hugo Benali', 'MEMBER', 640, 'PASSWORD_NEEDED'),
  box('b5', 'sm', 'Sarah Morel', 'MEMBER', 720),
  box('b6', 'administratif', null, 'FUNCTION', 330),
];
let boxes = seedBoxes();
let boxHistory: { id: string; when: string; who: string; onBehalfOf: string | null; what: string }[] = [];
const logBox = (session: Session, what: string) => {
  audit(session, what, 'TECHNICAL');
  boxHistory = [
    {
      id: `h${boxHistory.length + 1}`,
      when: 'À l’instant',
      who: `${session.firstName} ${session.lastName}`,
      onBehalfOf: session.role === 'DIRECTOR' ? null : session.directorName,
      what,
    },
    ...boxHistory,
  ];
};
/** Fictitious password, drawn at random for each call like the API would do. */
const drawPassword = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[byte % 56]).join('');

const seedRegistry = (): GdprRequest[] => [
  {
    id: 'g1',
    receivedOn: '2026-11-03',
    dueOn: '2026-12-03',
    daysLeft: 9,
    kind: 'ACCESS',
    debtor: 'Paul Meunier',
    caseId: 'meunier',
    origin: 'E-mail du débiteur',
    status: 'OPEN',
  },
  {
    id: 'g2',
    receivedOn: '2026-11-17',
    dueOn: '2026-12-17',
    daysLeft: 23,
    kind: 'RECTIFICATION',
    debtor: 'Atelier Mistral',
    caseId: 'demo',
    origin: 'Courrier',
    status: 'OPEN',
  },
];
let registry = seedRegistry();
export const addGdprRequest = (item: Pick<GdprRequest, 'kind' | 'debtor' | 'caseId' | 'origin'>) => {
  registry = [...registry, { ...item, id: `g${registry.length + 1}`, receivedOn: '2026-11-24', dueOn: '2026-12-24', daysLeft: 30, status: 'OPEN' }];
};
export const resetSettings = () => {
  resetAudit();
  groups = { firm: firmGroups(), technical: technicalGroups() };
  secrets = seedSecrets();
  boxes = seedBoxes();
  boxHistory = [];
  registry = seedRegistry();
};

const edits = (session: Session) => canEdit('technical', session);
const onBox = (resolve: (item: Mailbox, session: Session, info: Info) => Response | Promise<Response>) =>
  guarded<Info>(edits, (info, session) => {
    const item = boxes.find((entry) => entry.id === info.params.id);
    return item ? resolve(item, session, info) : notFound();
  });

export const settingsHandlers = [
  http.get(
    '/api/settings/:scope',
    guarded<Info>(staff, ({ params }, session) => {
      const scope = scopeOf(params.scope);
      if (!canRead(scope, session)) return forbidden();
      const hub: SettingsHub = {
        canEdit: canEdit(scope, session),
        groups: groups[scope].map((group) => ({
          label: group.label,
          tiles: group.items
            .filter((item) => item.id !== 'users' || seesMembers(session))
            .map((item) => ({ id: item.id, title: item.title, description: item.description, icon: item.icon, status: item.status, statusTone: item.tone })),
        })),
      };
      return HttpResponse.json(hub);
    }),
  ),
  http.get(
    '/api/settings/:scope/:id',
    guarded<Info>(staff, ({ params }, session) => {
      const scope = scopeOf(params.scope);
      if (!canRead(scope, session)) return forbidden();
      const item = groups[scope].flatMap((group) => group.items).find((entry) => entry.id === params.id);
      if (!item) return notFound();
      const tables = (item.tables ?? []).map((entry) =>
        entry.id === 'audit'
          ? { ...entry, rows: [...auditEntries().map((line) => [line.date, line.who, line.onBehalfOf, line.what, '—']), ...entry.rows] }
          : entry,
      );
      return HttpResponse.json({ id: item.id, canEdit: canEdit(scope, session), blocks: item.blocks, tables, notes: item.notes ?? [] });
    }),
  ),
  http.put(
    '/api/settings/:scope/:id',
    guarded<Info>(staff, async ({ params, request }, session) => {
      const scope = scopeOf(params.scope);
      if (!canEdit(scope, session)) return forbidden();
      const item = groups[scope].flatMap((group) => group.items).find((entry) => entry.id === params.id);
      if (!item) return notFound();
      const changes = (await request.json()) as Record<string, string | boolean>;
      audit(session, `Paramètres modifiés : ${item.title}`, scope === 'technical' ? 'TECHNICAL' : 'ADMINISTRATIVE');
      item.blocks = item.blocks.map((entry) => ({
        ...entry,
        fields: entry.fields.map((field) => {
          const next = changes[field.id];
          if (next === undefined || field.locked || field.kind === 'value') return field;
          return typeof next === 'boolean' ? { ...field, checked: next } : { ...field, value: next };
        }),
      }));
      return done();
    }),
  ),
  http.get(
    '/api/secrets',
    guarded(canAccessTechnicalSettings, () => HttpResponse.json({ items: secrets })),
  ),
  http.post(
    '/api/secrets',
    guarded<Info>(edits, async ({ request }, session) => {
      // The value is never kept nor sent back.
      const { name, service } = (await request.json()) as { name: string; service: string };
      audit(session, `Secret ajouté : ${name}`, 'TECHNICAL');
      secrets = [...secrets, { id: `k${secrets.length}`, name, service, environment: 'Production', used: 'jamais', rotated: 'Aujourd’hui', status: 'VALID' }];
      return done();
    }),
  ),
  http.post(
    '/api/secrets/:id/:action',
    guarded<Info>(edits, ({ params }, session) => {
      const item = secrets.find((entry) => entry.id === params.id);
      if (!item) return notFound();
      const director = session.role === 'DIRECTOR';
      // Revoking in production needs the Director: the Developer only asks for it.
      const next = {
        rotate: { status: 'VALID' as const, rotated: 'Aujourd’hui' },
        revoke: { status: director ? ('REVOKED' as const) : ('REVOKE_PENDING' as const) },
        keep: director ? { status: 'VALID' as const } : null,
      }[String(params.action)];
      if (!next) return forbidden();
      secrets = secrets.map((entry) => (entry === item ? { ...entry, ...next } : entry));
      audit(
        session,
        `Secret ${item.name} : ${{ rotate: 'renouvelé', revoke: director ? 'révoqué' : 'révocation demandée', keep: 'révocation refusée' }[String(params.action)]}`,
        'TECHNICAL',
      );
      return done();
    }),
  ),
  http.get(
    '/api/mailboxes',
    guarded(canAccessTechnicalSettings, () =>
      HttpResponse.json({
        items: boxes,
        sizes: [1000, 5000, 10000],
        holders: [
          { id: 'lp', name: 'Lucas Perrin' },
          { id: 'nf', name: 'Nadia Faure' },
        ],
        history: boxHistory,
      }),
    ),
  ),
  http.post(
    '/api/mailboxes',
    guarded<Info>(edits, async ({ request }, session) => {
      const body = (await request.json()) as { local: string; holderId: string | null; sizeMb: number };
      if (boxes.some((item) => item.address === `${body.local}@legarec.fr`)) return HttpResponse.json({ code: 'ADDRESS_TAKEN' }, { status: 409 });
      const holder = { lp: 'Lucas Perrin', nf: 'Nadia Faure' }[body.holderId ?? ''] ?? null;
      const item = { ...box(`b${boxes.length + 1}`, body.local, holder, holder ? 'MEMBER' : 'FUNCTION', 0), sizeMb: body.sizeMb };
      boxes = [...boxes, item];
      logBox(session, `Boîte ${item.address} créée`);
      return HttpResponse.json({ password: drawPassword() });
    }),
  ),
  http.post(
    '/api/mailboxes/:id/password',
    onBox((item, session) => {
      if (item.protected) return forbidden();
      boxes = boxes.map((entry) => (entry.id === item.id ? { ...entry, connection: 'OK' } : entry));
      logBox(session, `Mot de passe de ${item.address} changé`);
      return HttpResponse.json({ password: drawPassword() });
    }),
  ),
  http.post(
    '/api/mailboxes/:id/redirections',
    onBox(async (item, session, { request }) => {
      const { to } = (await request.json()) as { to: string };
      boxes = boxes.map((entry) =>
        entry.id === item.id ? { ...entry, redirections: [...entry.redirections, { id: `r${entry.redirections.length + 1}`, to }] } : entry,
      );
      logBox(session, `Redirection de ${item.address} vers ${to}`);
      return done();
    }),
  ),
  http.put(
    '/api/mailboxes/:id/redirections/:redirection',
    onBox(async (item, session, { request, params }) => {
      const { to } = (await request.json()) as { to: string };
      boxes = boxes.map((entry) =>
        entry.id === item.id ? { ...entry, redirections: entry.redirections.map((r) => (r.id === params.redirection ? { ...r, to } : r)) } : entry,
      );
      logBox(session, `Redirection de ${item.address} modifiée vers ${to}`);
      return done();
    }),
  ),
  http.delete(
    '/api/mailboxes/:id/redirections/:redirection',
    onBox((item, session, { params }) => {
      boxes = boxes.map((entry) => (entry.id === item.id ? { ...entry, redirections: entry.redirections.filter((r) => r.id !== params.redirection) } : entry));
      logBox(session, `Redirection de ${item.address} supprimée`);
      return done();
    }),
  ),
  http.put(
    '/api/mailboxes/:id/auto-reply',
    onBox(async (item, session, { request }) => {
      // The shared mailbox only receives: not even an automatic reply leaves it.
      if (item.protected) return forbidden();
      const autoReply = (await request.json()) as NonNullable<Mailbox['autoReply']>;
      boxes = boxes.map((entry) => (entry.id === item.id ? { ...entry, autoReply } : entry));
      logBox(session, `Réponse automatique de ${item.address} enregistrée`);
      return done();
    }),
  ),
  http.delete(
    '/api/mailboxes/:id/auto-reply',
    onBox((item, session) => {
      boxes = boxes.map((entry) => (entry.id === item.id ? { ...entry, autoReply: null } : entry));
      logBox(session, `Réponse automatique de ${item.address} supprimée`);
      return done();
    }),
  ),
  http.post(
    '/api/mailboxes/:id/delete',
    onBox(async (item, session, { request }) => {
      const { address } = (await request.json()) as { address: string };
      if (item.protected || item.address === SHARED) return forbidden();
      if (address !== item.address) return HttpResponse.json({ code: 'ADDRESS_MISMATCH' }, { status: 422 });
      boxes = boxes.filter((entry) => entry.id !== item.id);
      logBox(session, `Boîte ${item.address} supprimée`);
      return done();
    }),
  ),
  http.get(
    '/api/gdpr/requests',
    guarded(keepsRegistry, () => HttpResponse.json({ items: registry })),
  ),
  http.put(
    '/api/gdpr/requests/:id',
    guarded<Info>(keepsRegistry, async ({ params, request }, session) => {
      audit(session, 'Registre RGPD : demande traitée', 'ADMINISTRATIVE');
      const { status } = (await request.json()) as { status: GdprRequest['status'] };
      registry = registry.map((item) => (item.id === params.id ? { ...item, status } : item));
      return done();
    }),
  ),
  http.post(
    '/api/gdpr/requests/:id/export',
    guarded<Info>(keepsRegistry, ({ params }, session) => {
      audit(session, 'Export RGPD des données d’un débiteur', 'ADMINISTRATIVE');
      const item = registry.find((entry) => entry.id === params.id);
      return item
        ? HttpResponse.json({
            fileName: `export-rgpd-${item.id}.json`,
            content: { debtor: item.debtor, case: item.caseId, data: 'Données fictives de démonstration' },
          })
        : notFound();
    }),
  ),
];
