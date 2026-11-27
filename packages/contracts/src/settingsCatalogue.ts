import { FIRM_IDENTITY_FIELDS, firmIdentity } from './firm';
import type { SettingField, SettingsSection, SettingTable } from './settings';
import { CONTACT_DAYS, DEFAULT_CONTACT_HOURS, hoursProblem } from './contactHours';

/** Every setting, with its label, its possible values and its value until the firm changes it. Nothing here comes from a service. */

type Tone = SettingField['statusTone'];
type Block = SettingsSection['blocks'][number];

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
const off = { text: 'Non connecté', tone: 'neutral' as Tone };

export type SettingDefinition = {
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
export type SettingGroup = { label: string; items: SettingDefinition[] };
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
): SettingDefinition => ({ id, title, description, icon, status, tone, blocks, tables, notes });

export const firmGroups = (): SettingGroup[] => [
  {
    label: 'Organisation',
    items: [
      section('cabinet', 'Cabinet', 'Identité et obligations légales', 'building', '', 'neutral', [
        block('identity', 'Identité du cabinet', 'Apparaît sur les courriers, e-mails, SMS et dans les espaces débiteur et créancier.', [
          text('name', 'Raison sociale', 'Nom légal de la société', 'LEGAREC'),
          text('display', 'Nom affiché', 'Utilisé dans les e-mails et l’espace de paiement', 'Legarec – Cabinet de recouvrement'),
          text('address', 'Adresse du siège', '', '[ADRESSE DU CABINET]'),
          text('phone', 'Téléphone du service', 'Affiché aux débiteurs', '01 87 88 02 98'),
          text('hours', 'Horaires d’ouverture', 'Utilisés pour les appels et la réponse automatique', 'Lundi au vendredi, 9 h – 19 h'),
        ]),
        block('bank', 'Identifiants et compte dédié', 'Saisis par le Directeur seulement, après confirmation. Affichés aux débiteurs et sur les factures.', [
          text('siren', 'SIREN', '9 chiffres', '[SIREN]'),
          text('vat', 'N° de TVA intracommunautaire', '', '[N° TVA]'),
          text('iban', 'IBAN du compte dédié', 'Compte dédié aux fonds encaissés', '[IBAN DU COMPTE DÉDIÉ]'),
          text('bic', 'BIC', '', '[BIC]'),
          text('holder', 'Titulaire du compte', '', '[TITULAIRE DU COMPTE]'),
          text('bankName', 'Banque', '', '[BANQUE]'),
          text('chequePayee', 'Ordre des chèques', '', '[ORDRE DES CHÈQUES]'),
          text('chequeAddress', 'Adresse d’envoi des chèques', '', '[ADRESSE D’ENVOI DES CHÈQUES]'),
        ]),
        block('legal', 'Mentions légales', 'Reprises sur les factures, les contrats et les pages légales.', [
          text('legalForm', 'Forme juridique et capital', '', '[FORME JURIDIQUE ET CAPITAL]'),
          text('rcs', 'Capital et RCS', '', '[CAPITAL ET RCS]'),
          text('publisher', 'Directeur de la publication', '', '[DIRECTEUR DE LA PUBLICATION]'),
          text('host', 'Hébergeur', 'Nom, adresse, téléphone', '[HÉBERGEUR : nom, adresse, téléphone]'),
          text('lateRate', 'Taux des pénalités de retard', 'Factures du cabinet', '[TAUX DES PÉNALITÉS]'),
        ]),
        block('duties', 'Obligations de l’activité', 'Pièces exigées pour exercer le recouvrement amiable pour le compte d’autrui.', [
          value('insurance', 'Assurance RC professionnelle', 'Attestation à déposer', ''),
          value('funds', 'Compte dédié aux fonds encaissés', 'Voir Identifiants et compte dédié', ''),
          value('prosecutor', 'Déclaration au procureur', 'Justificatif à déposer', ''),
        ]),
      ]),
      section('users', 'Comptes utilisateurs', 'Équipe Legarec, accès des créanciers et invitations', 'users', '', 'neutral'),
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
              ['Valider un échéancier, une remise ou un abandon de créance', 'Non', 'Ses dossiers', 'Oui', 'Non'],
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
      section('kit', 'Kit média', 'Logos, couleurs et typographie à télécharger ou à partager par URL', 'image', '12 logos, 4 couleurs, 2 polices', 'neutral'),
    ],
  },
  {
    label: 'Recouvrement',
    items: [
      section('scenarios', 'Scénarios de relance', 'Étapes automatiques après l’échéance', 'route', '', 'neutral', [
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
          sw(
            'r1',
            'Échéancier au-delà de la durée maximale',
            'Validation par le Responsable du recouvrement (par le Directeur sur ses dossiers), puis accord du créancier',
            true,
            true,
          ),
          sw('r2', 'Remise ou abandon de créance', 'Toujours soumis à validation, quel que soit le montant', true, true),
          sw('r3', 'Passage en contentieux', 'Nécessite aussi l’accord écrit du créancier'),
          select('duration', 'Durée maximale sans validation', 'Au-delà, l’échéancier part en validation', ['6 mois', '3 mois', '12 mois']),
          select('notice', 'Délai minimum avant mise en demeure', 'Après la première échéance impayée', ['60 jours', '45 jours', '90 jours']),
        ]),
        block('goals', 'Objectifs', 'Facultatifs : vides, aucun ratio n’est affiché.', [
          text('monthly-goal', 'Encaissements par mois', 'En euros', ''),
          text('call-goal', 'Appels par jour', 'Par gestionnaire', ''),
        ]),
      ]),
      section('relances', 'Relances', 'Plafonds de contacts et plages horaires', 'bell', 'Plafonds par débiteur et par canal', 'neutral', [
        block('limits', 'Plafonds de contacts par débiteur', 'Au-delà, l’agenda des relances prévient et l’envoi automatique attend.', [
          select('calls', 'Appels', 'Par débiteur et par semaine', ['2', '1', '3']),
          select('emails', 'E-mails', 'Par débiteur et par semaine', ['2', '1', '3']),
          select('sms', 'SMS', 'Par débiteur et par semaine', ['1', '2', '3']),
          select('letters', 'Courriers', 'Par débiteur et par mois', ['2', '1', '3']),
        ]),
        // Set day by day (question 160): read by the API and the simulations through contactHours.
        block(
          'call-hours',
          'Plages des appels',
          'Heure de début et de fin, par exemple 09:00–19:00 ; vide : aucun appel ce jour-là. Jamais le dimanche ni un jour férié.',
          CONTACT_DAYS.map(([key, label]) => text(`call-${key}`, label, '', DEFAULT_CONTACT_HOURS.call[key])),
        ),
        block(
          'send-hours',
          'Plages des e-mails et SMS',
          'Heure de début et de fin, par exemple 09:00–19:00 ; vide : aucun envoi ce jour-là. Jamais le dimanche ni un jour férié.',
          CONTACT_DAYS.map(([key, label]) => text(`send-${key}`, label, '', DEFAULT_CONTACT_HOURS.send[key])),
        ),
      ]),
      section('modeles', 'Modèles de documents', 'Courriers, SMS, factures et contrats', 'file', '', 'neutral'),
    ],
  },
  {
    label: 'Communication',
    items: [
      section('sms', 'SMS', 'OVHcloud : expéditeur, plages, crédits', 'sms', '', 'neutral', [
        block('sending', 'Envoi des SMS · OVHcloud', 'Les SMS de relance partent par l’API SMS d’OVHcloud. Paramètres communs à tous les envois.', [
          value('provider', 'Fournisseur', 'Compte SMS OVHcloud, clé d’API dans Secrets et clés', 'OVHcloud SMS'),
          value('sender', 'Expéditeur', 'Numéro qui reçoit les réponses des débiteurs', '[NUMÉRO SMS]'),
          value('stop', 'Désinscription', 'Mention « STOP : répondez STOP » ajoutée à chaque SMS', 'Réponse STOP'),
          value('sms-hours', 'Plages d’envoi', 'Aucun envoi les dimanches et jours fériés', 'Celles des e-mails et SMS (Paramètres › Relances)'),
          value('credits', 'Crédits disponibles', 'Rechargement automatique sous 2 000 crédits', '—'),
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
      section('reversements', 'Reversements', 'Fréquence et commissions', 'euro', '', 'neutral', [
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
        '',
        'neutral',
        [
          block(
            'features',
            'Fonctions',
            'Désactivé en production jusqu’au contrat de sous-traitance et à l’hébergement dans l’UE. Chaque fonction s’active séparément. Les suggestions sont toujours marquées « Proposé par l’IA » et ne sont appliquées qu’après validation d’un collaborateur.',
            [
              sw(
                'ia1',
                'Transcription et résumé des appels',
                'Résumé et qualification proposés après l’appel (Appels). Uniquement si l’enregistrement a été annoncé.',
              ),
              sw('ia2', 'Tri et analyse des e-mails', 'Catégorie, dossier rattaché, montants et dates extraits (E-mails)'),
              sw('ia3', 'Brouillons de réponse', 'Proposés dans le ton du cabinet, à relire avant envoi (E-mails, SMS)'),
              sw('ia4', 'Synthèse des dossiers', 'Résumé en 5 lignes en tête de la fiche débiteur'),
              // Not in the mockup (question 179): off until the firm chooses it.
              sw(
                'ia4-auto',
                'Synthèse refaite automatiquement',
                'À chaque nouvel événement, le dossier est envoyé au fournisseur sans qu’un collaborateur l’ait ouvert.',
                false,
              ),
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
            text('budget', 'Budget mensuel', 'Au-delà, les fonctions passent en pause jusqu’au mois suivant ; alerte à 80 %.', '40 €'),
          ]),
        ],
        [table('ai-log', 'Journal de l’IA', 'Chaque suggestion est conservée avec la décision prise.', ['Date', 'Fonction', 'Collaborateur', 'Décision'], [])],
      ),
    ],
  },
  {
    label: 'Plateforme',
    items: [
      section('rgpd', 'Données personnelles', 'Conservation et droits RGPD', 'database', 'Durées de conservation validées', 'success', [
        block('retention', 'Durées de conservation', 'Validées par le cabinet le 24/11/2026.', [
          text('settled', 'Dossiers soldés', 'Données du débiteur et historique, en archive à accès restreint', '5 ans après clôture'),
          text('lost', 'Dossiers irrécouvrables', 'En archive à accès restreint', '5 ans après clôture'),
          text('invoices', 'Factures et pièces comptables', '', '10 ans'),
          text('recordings', 'Enregistrements d’appels', '', '6 mois'),
          text('audit', 'Journal d’audit', '', '1 an'),
        ]),
        block('rights', 'Droits des personnes', 'Demandes d’accès, de rectification, d’opposition ou d’effacement reçues des débiteurs.', [
          sw('g1', 'Mention d’information dans chaque relance', 'Désactivée : l’information est en ligne, sur la page Confidentialité', false, true),
          sw('g2', 'Anonymisation automatique', 'À l’expiration de la durée de conservation'),
        ]),
      ]),
    ],
  },
];

export const technicalGroups = (): SettingGroup[] => [
  {
    label: 'Communication',
    items: [
      section(
        'telephonie',
        'Téléphonie · 3CX',
        'Standard 3CX : postes, files, codes de qualification et options d’appel',
        'phone',
        '',
        'neutral',
        [
          block('pbx', 'Standard téléphonique · 3CX', 'Appels sortants et entrants, enregistrements et statuts des gestionnaires passent par 3CX.', [
            value('instance', 'Instance', '', 'legarec.on3cx.fr'),
            value('number', 'Numéro principal', '', '01 87 88 02 98'),
            value('queue', 'File entrante', '', '800 « Recouvrement » · distribution au plus disponible'),
            value('wrap', 'Post-appel', '', '60 s de pause pour qualifier'),
            value('records', 'Enregistrements', '', 'Récupérés de 3CX et rattachés au dossier · 6 mois'),
            value('sync', 'Dernière synchronisation', '', '—'),
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
          table('extensions', 'Postes des utilisateurs', '', ['Utilisateur', 'Poste 3CX', 'Files', 'Statut 3CX'], []),
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
        '',
        'neutral',
        [
          block('resend', 'E-mails transactionnels · Resend', 'Envoi par API et suivi de la distribution, rattaché automatiquement au dossier.', [
            value('state', 'Statut', 'Clé API de production dans Secrets et clés', '—'),
            value('domain', 'Domaine d’envoi', 'Enregistrements SPF et DKIM vérifiés chez Resend', 'mail.legarec.fr'),
            value('from', 'Expéditeur', 'Adresse sans réponse', 'LEGAREC <ne-pas-repondre@mail.legarec.fr>'),
            value('reply', 'Adresse de réponse', 'Relances 1 à 3 seulement : les réponses arrivent dans « E-mails » (OVH)', 'recouvrement@legarec.fr'),
            value('events', 'Événements suivis', 'Reçus par webhook et affichés dans l’historique du dossier', 'Distribué, ouvert, clic, rebond, plainte'),
            sw('e1', 'Suivi des ouvertures', 'Affiche « ouvert le… » dans l’historique du dossier'),
            sw('e2', 'Suivi des clics', 'Indique si le lien de paiement a été ouvert'),
          ]),
          block('ovh', 'Messagerie de l’équipe · OVH MX Plan', 'Boîtes e-mail du service, en SMTP pour l’envoi et en IMAP pour la réception.', [
            value('shared', 'Boîte partagée', 'Réception seule : personne n’écrit depuis cette boîte', 'recouvrement@legarec.fr'),
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
      section('boites', 'Boîtes e-mail', 'Boîtes OVH MX Plan : création, mots de passe, redirections, départs', 'send', '', 'neutral'),
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
        '',
        'neutral',
        [
          block('api', 'Accès API', 'Pour connecter le logiciel comptable d’un créancier ou un outil interne.', [
            value('url', 'Adresse de l’API', 'Back-end utilisé par l’application, l’espace créancier et les intégrations', 'https://api.legarec.fr'),
            value('hooks', 'Webhooks', 'Paiement reçu, statut de dossier modifié', '—'),
          ]),
        ],
        [
          table(
            'tools',
            'Intégrations',
            'Outils qui alimentent les factures et les échanges.',
            ['Outil', 'Usage', 'État'],
            [
              ['Logiciel comptable des créanciers', 'Import automatique des factures échues', off],
              ['Resend', 'E-mails transactionnels : quittances, liens de paiement, relances automatiques, codes', off],
              ['OVH MX Plan', 'Messagerie de l’équipe en SMTP / IMAP', off],
              ['MySendingBox', 'Lettres recommandées et courriers postaux · comptes test et production', off],
              ['OVHcloud Object Storage', 'Stockage S3 des documents, pièces et courriers', off],
              ['Signature électronique', 'Signature des échéanciers par le débiteur', off],
              ['Données entreprises', 'Vérification SIREN, procédures collectives', off],
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
          value('tfa', 'Double authentification', 'Proposée aux autres rôles dans Mon compte', '—'),
        ]),
        block('rules', 'Règles d’accès', 'Appliquées à tous les comptes, créanciers compris.', [
          sw('x1', 'Double authentification obligatoire pour le Développeur', 'Ce compte ne peut pas se connecter sans 2FA', true, true),
          sw('x5', 'Recommander la 2FA aux autres rôles', 'Rappel affiché à chaque connexion tant qu’elle n’est pas activée'),
          sw('x6', 'Bloquer le compte après 5 tentatives échouées', 'Blocage de 15 minutes, alerte envoyée à l’utilisateur', true, true),
          sw('x7', 'Déconnexion automatique après 30 minutes d’inactivité', 'S’applique à tous les comptes, créanciers compris', true, true),
          sw('x8', 'Journal d’audit', 'Chaque connexion et chaque action sensible est enregistrée (utilisateur, action, date, adresse IP)', true, true),
          sw('x2', 'Cloisonnement par créancier', 'Un gestionnaire ne voit que ses dossiers, un créancier que les siens', true, true),
          sw('x3', 'Masquer les IBAN des débiteurs', 'Visibles seulement par le Directeur', true, true),
        ]),
      ]),
      section('secrets', 'Secrets et clés', 'Clés d’API et mots de passe techniques, rotation et révocation', 'key', '', 'neutral', [
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
        '',
        'neutral',
        [],
        [
          table(
            'audit',
            'Journal d’audit',
            'Chaque connexion et chaque action sensible est enregistrée : utilisateur, pour le compte de qui, action, date, adresse IP.',
            ['Date', 'Utilisateur', 'Pour le compte de', 'Action', 'Adresse IP'],
            [],
          ),
        ],
      ),
    ],
  },
];

/** Identity, account and cheques of the firm: the Director alone, never under a delegation (question 116). */
export const isFirmIdentity = (section: string, field: string) => section === 'cabinet' && (FIRM_IDENTITY_FIELDS as string[]).includes(field);
const PHONE = /^(?:\+33|0)\s?[1-9](?:[\s.]?\d{2}){4}$/u;
const GOAL = /^\d{0,9}$/u;
const MAY_BE_EMPTY = ['monthly-goal', 'call-goal'];
/** The hours of Paramètres › Relances, day by day: empty is no contact that day (question 160). */
const HOURS_FIELDS = CONTACT_DAYS.flatMap(([key]) => [`call-${key}`, `send-${key}`]);

/** What cannot be recorded, by field, with the sentence shown beside it. The same rules for the screen, the simulations and the API. */
export function settingProblems(section: Pick<SettingDefinition, 'id' | 'blocks'>, changes: Record<string, string | boolean>): Record<string, string> {
  const problems: Record<string, string> = {};
  const fields = new Map(section.blocks.flatMap((item) => item.fields).map((field) => [field.id, field]));
  for (const [id, next] of Object.entries(changes)) {
    const field = fields.get(id);
    if (!field || field.locked || field.kind === 'value') continue;
    if ((field.kind === 'switch') !== (typeof next === 'boolean')) problems[id] = 'Cette valeur ne convient pas.';
    else if (typeof next === 'boolean') continue;
    else if (field.kind === 'select' && !field.options.includes(next)) problems[id] = 'Choisissez une valeur de la liste.';
    else if (isFirmIdentity(section.id, id)) {
      const parsed = firmIdentity.partial().safeParse({ [id]: next });
      if (!parsed.success) problems[id] = parsed.error.issues[0]?.message ?? 'Cette valeur ne convient pas.';
    } else if (section.id === 'relances' && HOURS_FIELDS.includes(id)) {
      const problem = hoursProblem(next);
      if (problem) problems[id] = problem;
    } else if (field.kind === 'text' && !next.trim() && !MAY_BE_EMPTY.includes(id)) problems[id] = 'Ce champ ne peut pas être vide.';
    else if (section.id === 'cabinet' && id === 'phone' && !PHONE.test(next)) problems[id] = 'Ce numéro de téléphone n’est pas valide.';
    else if (MAY_BE_EMPTY.includes(id) && !GOAL.test(next)) problems[id] = 'Saisissez un nombre entier.';
  }
  return problems;
}
