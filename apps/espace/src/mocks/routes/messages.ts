import { outgoingMessage, ROLE_LABELS, type EmailDraft, type EmailThread, type MessageTemplate, type SmsThread } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { done, forbidden, guarded, notFound, staffWithCases } from '../http';
import { actsOn, caseOfEmail, contactsOf, readable } from './cases';
import type { Session } from '@legarec/contracts';

type Info = { request: Request; params: Record<string, unknown> };
const mail = (
  item: Partial<EmailThread> &
    Pick<
      EmailThread,
      'id' | 'category' | 'from' | 'subject' | 'body' | 'caseId' | 'debtor' | 'creditor' | 'creditorId' | 'reference' | 'due' | 'time' | 'date'
    >,
): EmailThread => ({
  source: 'EMAIL',
  verified: true,
  recategorized: false,
  unread: false,
  email: 'contact@exemple.example',
  attachment: null,
  archived: false,
  replies: [],
  ai: null,
  ...item,
});
const seedMails = (): EmailThread[] => [
  mail({
    id: 'm1',
    category: 'PAYMENT_PLAN',
    unread: true,
    from: 'Julien Ferrand',
    email: 'j.ferrand@batiplus.example',
    caseId: 'demo',
    debtor: 'Bâtiplus SAS',
    creditor: 'Matériaux Delta',
    creditorId: 'md',
    reference: 'LGR-2026-00142',
    due: 4820000,
    time: '09:42',
    date: 'sam. 21 nov. 2026, 09:42',
    subject: 'Re: Relance – factures F-2026-0712, 0745, 0790',
    body: 'Bonjour Madame Laurent,\n\nSuite à notre échange téléphonique de ce matin, je vous confirme le virement de 18 600 € correspondant à la facture F-2026-0712, au plus tard le 28 novembre.\n\nPour le solde de 29 600 €, nous traversons une période de trésorerie tendue. Serait-il possible de l’étaler sur quatre mensualités à partir de décembre ?\n\nBien cordialement,\nJulien Ferrand\nDirecteur administratif et financier',
    ai: {
      summary:
        'Julien Ferrand confirme le virement de 18 600 € (F-2026-0712) au plus tard le 28/11 et demande d’étaler le solde de 29 600 € sur quatre mensualités dès décembre.',
      facts: [
        { k: 'Dossier rattaché', v: 'Bâtiplus SAS · LGR-2026-00142' },
        { k: 'Promesse', v: '18 600 € le 28/11/2026' },
        { k: 'Demande', v: 'Échéancier 4 × 7 400 € pour 29 600 €' },
      ],
      actions: ['Créer un échéancier', 'Enregistrer la promesse'],
      draft:
        'Bonjour Monsieur Ferrand,\n\nMerci pour votre message. Je note votre virement de 18 600 € pour la facture F-2026-0712, attendu au plus tard le 28 novembre.\n\nPour le solde de 29 600 €, je soumets votre demande de quatre mensualités de 7 400 € à Matériaux Delta et reviens vers vous dès sa réponse.\n\nBien cordialement,\nCamille Laurent',
    },
  }),
  mail({
    id: 'm2',
    category: 'DISPUTE',
    unread: true,
    from: 'Sophie Arnaud',
    email: 'compta@ateliermistral.example',
    caseId: 'mistral',
    debtor: 'Atelier Mistral',
    creditor: 'Matériaux Delta',
    creditorId: 'md',
    reference: 'LGR-2026-00170',
    due: 1832000,
    time: '08:15',
    date: 'sam. 21 nov. 2026, 08:15',
    subject: 'Contestation facture F-2026-0874',
    body: 'Bonjour,\n\nNous contestons la facture F-2026-0874 : la livraison du 2 octobre était incomplète (2 palettes manquantes sur 6, voir bon de livraison joint).\n\nNous réglerons la partie livrée dès réception d’un avoir pour le reste.\n\nCordialement,\nSophie Arnaud',
    attachment: 'BL-2026-10-02.pdf',
    ai: {
      summary:
        'Atelier Mistral conteste la facture F-2026-0874 : livraison incomplète (2 palettes sur 6), bon de livraison joint. Paiement de la partie livrée après avoir.',
      facts: [
        { k: 'Dossier rattaché', v: 'Atelier Mistral · LGR-2026-00170' },
        { k: 'Facture contestée', v: 'F-2026-0874 · 18 320 €' },
        { k: 'Pièce', v: 'Bon de livraison (PDF)' },
        { k: 'Point à vérifier', v: 'Quantités livrées auprès de Matériaux Delta' },
      ],
      actions: ['Ouvrir un litige', 'Demander un avoir'],
      draft:
        'Bonjour Madame Arnaud,\n\nNous avons bien reçu votre contestation de la facture F-2026-0874 et le bon de livraison. Nous transmettons ces éléments à Matériaux Delta pour vérification des quantités livrées.\n\nLes relances sur cette facture sont suspendues pendant l’examen. Nous revenons vers vous dès la réponse du créancier.\n\nCordialement,\nCamille Laurent',
    },
  }),
  mail({
    id: 'p1',
    source: 'DEBTOR_PORTAL',
    verified: false,
    category: 'PAYMENT',
    unread: true,
    from: 'Bâtiplus SAS',
    caseId: 'demo',
    debtor: 'Bâtiplus SAS',
    creditor: 'Matériaux Delta',
    creditorId: 'md',
    reference: 'LGR-2026-00142',
    due: 4820000,
    time: 'Hier',
    date: 'ven. 20 nov. 2026, 17:20',
    subject: 'Message de l’espace débiteur',
    body: 'Vous trouverez ci-joint notre justificatif de virement.',
    attachment: 'justificatif.pdf',
  }),
  mail({
    id: 'm3',
    category: 'PAYMENT',
    from: 'Nordis Logistique',
    email: 'paiements@nordis.example',
    caseId: 'nordis',
    debtor: 'Nordis Logistique',
    creditor: 'Énergies Rhône',
    creditorId: 'er',
    reference: 'LGR-2026-00163',
    due: 2140000,
    time: 'Hier',
    date: 'ven. 20 nov. 2026, 17:03',
    subject: 'Avis de virement – 12 500 €',
    body: 'Bonjour,\n\nVeuillez trouver ci-joint l’avis de virement de 12 500 € émis ce jour, en règlement partiel du dossier LGR-2026-00163.\n\nLe solde de 8 900 € sera réglé le 15 décembre comme convenu.\n\nService comptabilité fournisseurs',
    attachment: 'Avis-virement-20112026.pdf',
    ai: {
      summary: 'Nordis Logistique annonce un virement de 12 500 € (paiement partiel) et le solde de 8 900 € le 15/12.',
      facts: [
        { k: 'Dossier rattaché', v: 'Nordis Logistique · LGR-2026-00163' },
        { k: 'Paiement annoncé', v: '12 500 € le 20/11/2026' },
        { k: 'Promesse', v: '8 900 € le 15/12/2026' },
      ],
      actions: ['Rapprocher le paiement', 'Accuser réception'],
      draft:
        'Bonjour,\n\nMerci pour l’avis de virement de 12 500 €. Nous vous confirmerons sa bonne réception dès son rapprochement.\n\nNous notons le règlement du solde de 8 900 € le 15 décembre.\n\nCordialement,\nCamille Laurent',
    },
  }),
  mail({
    id: 'm4',
    category: 'PROMISE',
    unread: true,
    from: 'Nadia Roussel',
    email: 'n.roussel@groupehelio.example',
    caseId: 'helio',
    debtor: 'Groupe Hélio',
    creditor: 'Médiatel',
    creditorId: 'mt',
    reference: 'LGR-2026-00151',
    due: 3675000,
    time: 'Hier',
    date: 'ven. 20 nov. 2026, 11:20',
    subject: 'Re: Relance n°2',
    body: 'Bonjour,\n\nLe règlement de vos deux factures est en cours de validation par notre direction financière. Il devrait partir dans le prochain cycle de paiement, le 30 novembre.\n\nJe reviens vers vous dès confirmation.\n\nNadia Roussel',
    ai: {
      summary: 'Groupe Hélio indique que le règlement est en validation et devrait partir le 30/11.',
      facts: [
        { k: 'Dossier rattaché', v: 'Groupe Hélio · LGR-2026-00151' },
        { k: 'Promesse', v: '36 750 € autour du 30/11/2026' },
        { k: 'Prochaine action', v: 'Rappel le 01/12 si rien n’est reçu' },
      ],
      actions: ['Enregistrer la promesse', 'Programmer un rappel'],
      draft:
        'Bonjour Madame Roussel,\n\nMerci pour votre retour. Je note un règlement de 36 750 € prévu pour le 30 novembre.\n\nBien cordialement,\nCamille Laurent',
    },
  }),
  mail({
    id: 'm5',
    category: 'BOUNCE',
    from: 'Mail Delivery System',
    email: 'mailer-daemon@legarec.fr',
    caseId: 'valmont',
    debtor: 'Garage Valmont',
    creditor: 'TransAlp Leasing',
    creditorId: 'tl',
    reference: 'LGR-2026-00098',
    due: 2390000,
    time: '19 nov.',
    date: 'jeu. 19 nov. 2026, 14:51',
    subject: 'Échec de remise : compta@garagevalmont.example',
    body: 'Votre message « Relance n°3 – LGR-2026-00098 » n’a pas pu être remis à compta@garagevalmont.example.\n\nMotif : boîte aux lettres inexistante (550 5.1.1).',
    ai: {
      summary: 'L’adresse compta@garagevalmont.example n’existe plus : la relance n°3 n’a pas été remise.',
      facts: [
        { k: 'Dossier rattaché', v: 'Garage Valmont · LGR-2026-00098' },
        { k: 'Adresse en échec', v: 'compta@garagevalmont.example' },
        { k: 'Proposition', v: 'Chercher une autre adresse ou passer au courrier' },
      ],
      actions: ['Mettre à jour le contact', 'Envoyer par courrier'],
      draft: null,
    },
  }),
  mail({
    id: 'm6',
    category: 'PAYMENT',
    from: 'Marc Durand',
    email: 'contact@fromagerie-durand.example',
    caseId: 'durand',
    debtor: 'Fromagerie Durand',
    creditor: 'Énergies Rhône',
    creditorId: 'er',
    reference: 'LGR-2026-00181',
    due: 624000,
    time: '18 nov.',
    date: 'mer. 18 nov. 2026, 10:07',
    subject: 'Question sur la facture F-2026-0902',
    body: 'Bonjour,\n\nPouvez-vous me renvoyer votre RIB ? Je souhaite régler la facture F-2026-0902 cette semaine.\n\nMerci,\nMarc Durand',
    ai: {
      summary: 'Marc Durand demande le RIB pour régler la facture F-2026-0902 cette semaine.',
      facts: [
        { k: 'Dossier rattaché', v: 'Fromagerie Durand · LGR-2026-00181' },
        { k: 'Intention', v: 'Paiement de F-2026-0902 cette semaine' },
        { k: 'Réponse attendue', v: 'Lien vers l’espace débiteur (RIB, consignes chèque)' },
      ],
      actions: ['Envoyer le RIB'],
      draft:
        'Bonjour Monsieur Durand,\n\nVous trouverez le RIB et les consignes pour les chèques dans votre espace sur paiement.legarec.fr. Indiquez la référence LGR-2026-00181 dans le libellé de votre virement.\n\nMerci et bonne journée,\nCamille Laurent',
    },
  }),
];
const out = (id: string, text: string, meta: string, automatic: string | null = null, failed = false): SmsThread['messages'][number] => ({
  id,
  direction: 'OUT',
  text,
  meta,
  automatic,
  failed,
});
const inc = (id: string, text: string, meta: string): SmsThread['messages'][number] => ({ id, direction: 'IN', text, meta, automatic: null, failed: false });
const seedSms = (): SmsThread[] => [
  {
    id: 's1',
    linked: true,
    stopped: false,
    caseId: 'durand',
    name: 'Fromagerie Durand',
    contact: 'M. Marc Durand',
    phone: '06 12 •• •• 48',
    creditor: 'Énergies Rhône',
    creditorId: 'er',
    due: 624000,
    late: '21 j',
    status: 'REMINDER',
    time: '10:42',
    unread: 2,
    next: 'Aucun : scénario suspendu (réponse reçue)',
    messages: [
      out(
        '1',
        'LEGAREC pour Energies Rhone : 2 factures restent impayees (6 240 EUR). Votre espace : [LIEN ESPACE DEBITEUR]. STOP : répondez STOP',
        'Envoyé le 21/11 à 10:00 · distribué',
        'Relance SMS automatique J+21',
      ),
      inc('2', 'Bonjour, j’ai demandé le RIB par mail mercredi, toujours rien reçu.', '10:38'),
      inc('3', 'Je peux payer cette semaine.', '10:42'),
    ],
  },
  {
    id: 's2',
    linked: true,
    stopped: false,
    caseId: 'mercier',
    name: 'Julie Mercier',
    contact: 'Mme Julie Mercier',
    phone: '06 74 •• •• 02',
    creditor: 'Crédit Horizon',
    creditorId: 'ch',
    due: 120000,
    late: '—',
    status: 'PROMISE',
    time: '09:15',
    unread: 1,
    next: 'Rappel d’échéance le 28/11 à 10:00',
    messages: [
      out(
        '1',
        'LEGAREC pour Credit Horizon : votre échéance de 240 EUR est attendue le 01/12. STOP : répondez STOP',
        'Envoyé le 20/11 · distribué',
        'Rappel avant échéance',
      ),
      inc('2', 'Est-ce possible de décaler au 05/12 ? Mon salaire arrive le 4.', '09:15'),
    ],
  },
  {
    id: 's3',
    linked: true,
    stopped: false,
    caseId: 'helio',
    name: 'Groupe Hélio',
    contact: 'Mme Nadia Roussel',
    phone: '06 33 •• •• 91',
    creditor: 'Médiatel',
    creditorId: 'mt',
    due: 3675000,
    late: '38 j',
    status: 'REMINDER',
    time: 'Hier',
    unread: 0,
    next: 'Relance n°3 le 25/11 à 09:00',
    messages: [
      out(
        '1',
        'LEGAREC pour Mediatel : sauf erreur, 36 750 EUR restent dus. Merci de nous contacter au 01 87 88 02 98. STOP : répondez STOP',
        'Envoyé le 12/11 · distribué',
        'Relance SMS automatique J+30',
      ),
      inc('2', 'Le paiement est en validation, départ prévu le 30/11.', 'Hier 16:20'),
      out('3', 'Merci Madame Roussel, nous notons un règlement le 30/11. Bonne journée.', 'Hier 16:41 · distribué · Camille Laurent'),
    ],
  },
  {
    id: 's4',
    linked: true,
    stopped: true,
    caseId: 'nordis',
    name: 'Nordis Logistique',
    contact: 'Service comptable',
    phone: '06 51 •• •• 77',
    creditor: 'Énergies Rhône',
    creditorId: 'er',
    due: 890000,
    late: '45 j',
    status: 'PROMISE',
    time: '20 nov.',
    unread: 0,
    next: 'Aucun : réponse STOP',
    messages: [
      out(
        '1',
        'LEGAREC : nous confirmons la réception de votre virement de 12 500 EUR. Solde restant : 8 900 EUR au 15/12. Merci.',
        '20/11 · distribué · Camille Laurent',
      ),
      inc('2', 'STOP', '20/11 18:02'),
    ],
  },
  {
    id: 's5',
    linked: true,
    stopped: false,
    caseId: 'valmont',
    name: 'Garage Valmont',
    contact: 'M. Paul Valmont',
    phone: '06 09 •• •• 15',
    creditor: 'TransAlp Leasing',
    creditorId: 'tl',
    due: 2390000,
    late: '97 j',
    status: 'OVERDUE',
    time: '19 nov.',
    unread: 0,
    next: 'Aucun : passage en contentieux en attente',
    messages: [
      out(
        '1',
        'LEGAREC pour TransAlp Leasing : 23 900 EUR restent dus malgre nos rappels. Contact : 01 87 88 02 98. STOP : répondez STOP',
        '19/11 · non distribué : numéro injoignable',
        'Relance SMS automatique J+90',
        true,
      ),
    ],
  },
  {
    id: 'u1',
    linked: false,
    stopped: false,
    caseId: null,
    name: 'Numéro inconnu',
    contact: 'Numéro inconnu',
    phone: '07 58 •• •• 31',
    creditor: 'À rattacher',
    creditorId: null,
    due: null,
    late: '—',
    status: null,
    time: '08:50',
    unread: 1,
    next: '—',
    messages: [inc('1', 'Bonjour, vous avez appelé hier, c’est à quel sujet ?', '08:50')],
  },
];
let mails = seedMails();
let sms = seedSms();
export const mailState = { failNext: false, sentThisHour: 12 };
export const resetMessages = () => {
  drafts.clear();
  mails = seedMails();
  sms = seedSms();
  mailState.failNext = false;
  mailState.sentThisHour = 12;
};
const ids = (session: Session) => new Set([...readable(session).map((item) => item.id), ...(session.role === 'CLAIMS_OFFICER' ? [] : ['mercier'])]);
/** The Director reads every message but only answers on their own cases. */
const mayAnswer = (session: Session, caseId: string | null) => ids(session).has(caseId ?? '') && (session.role !== 'DIRECTOR' || caseId === 'lagarde');

const onMail = (resolve: (item: EmailThread, info: Info) => Response | Promise<Response>, answer = false) =>
  guarded<Info>(staffWithCases, (info, session) => {
    const item = mails.find((entry) => entry.id === info.params.id);
    if (!item) return notFound();
    return (answer ? mayAnswer(session, item.caseId) : ids(session).has(item.caseId)) ? resolve(item, info) : forbidden();
  });
const onSms = (resolve: (item: SmsThread, info: Info, session: Session) => Response | Promise<Response>, answer = false) =>
  guarded<Info>(staffWithCases, (info, session) => {
    const item = sms.find((entry) => entry.id === info.params.id);
    if (!item) return notFound();
    const ok = item.linked ? (answer ? mayAnswer(session, item.caseId) : ids(session).has(item.caseId ?? '')) : session.role === 'COLLECTION_MANAGER';
    return ok ? resolve(item, info, session) : forbidden();
  });

const TEMPLATES: MessageTemplate[] = [
  {
    id: 'amiable',
    use: 'NEW',
    name: 'Relance amiable n°1',
    subject: 'Votre dossier',
    text: 'Bonjour,\n\nSauf erreur de notre part, votre dossier présente toujours un solde impayé. Les moyens de paiement, virement ou chèque, sont indiqués dans votre espace débiteur.',
  },
  {
    id: 'promesse',
    use: 'NEW',
    name: 'Confirmation de promesse',
    subject: 'Confirmation de votre engagement',
    text: 'Bonjour,\n\nNous avons bien noté votre engagement de paiement. Merci d’indiquer la référence de votre dossier sur votre virement ou au dos de votre chèque.',
  },
  {
    id: 'echeancier',
    use: 'BOTH',
    name: 'Proposition d’échéancier',
    subject: 'Proposition d’échéancier',
    text: 'Bonjour,\n\nComme convenu, nous vous proposons un règlement en plusieurs mensualités. Vous pouvez consulter et signer la proposition dans votre espace débiteur.',
  },
  {
    id: 'paiement',
    use: 'REPLY',
    name: 'Accusé de réception paiement',
    subject: 'Votre paiement',
    text: 'Bonjour,\n\nNous accusons réception de votre message. Votre paiement est en cours de vérification ; une quittance vous sera remise dès qu’il sera définitif.',
  },
  {
    id: 'contestation',
    use: 'REPLY',
    name: 'Réponse à contestation',
    subject: 'Votre contestation',
    text: 'Bonjour,\n\nNous avons bien reçu votre contestation. Elle est examinée avec notre client ; les relances sont suspendues pendant cet examen.',
  },
  {
    id: 'ferme',
    use: 'REPLY',
    name: 'Relance ferme',
    subject: 'Votre dossier',
    text: 'Bonjour,\n\nMalgré nos précédents échanges, votre dossier présente toujours un solde impayé. Nous vous remercions de procéder au règlement, par virement ou par chèque, ou de nous proposer un échéancier.',
  },
];
const AUTOMATIC = [
  ['au1', 'demo', 'Relance n°2 — relance ferme', 'Aujourd’hui 08:00', 'OPENED'],
  ['au2', 'helio', 'Relance n°1 — rappel amiable', 'Aujourd’hui 08:00', 'DELIVERED'],
  ['au3', 'valmont', 'Relance n°1 — rappel amiable', 'Hier 08:00', 'FAILED'],
  ['au4', 'nordis', 'Rappel avant échéance', 'Hier 08:00', 'DELIVERED'],
  ['au5', 'lagarde', 'Rappel avant échéance', '19 nov. 08:00', 'OPENED'],
] as const;
/** Drafts belong to their author only. */
const drafts = new Map<string, EmailDraft[]>();
const draftsOf = (session: Session) => drafts.get(session.userId) ?? [];

export const messageHandlers = [
  http.post(
    '/api/emails/drafts',
    guarded<Info>(staffWithCases, async ({ request }, session) => {
      const raw = (await request.json()) as Omit<EmailDraft, 'id' | 'updated'> & { id?: string };
      const body = { ...raw, caseId: raw.caseId || null };
      if (body.caseId && !actsOn(session, body.caseId)) return forbidden();
      const id = body.id && draftsOf(session).some((item) => item.id === body.id) ? body.id : crypto.randomUUID();
      drafts.set(session.userId, [
        { id, to: body.to, subject: body.subject, text: body.text, caseId: body.caseId, updated: 'à l’instant' },
        ...draftsOf(session).filter((item) => item.id !== id),
      ]);
      return HttpResponse.json({ id });
    }),
  ),
  http.delete(
    '/api/emails/drafts/:id',
    guarded<Info>(staffWithCases, ({ params }, session) => {
      drafts.set(
        session.userId,
        draftsOf(session).filter((item) => item.id !== params.id),
      );
      return done();
    }),
  ),
  http.get(
    '/api/emails',
    guarded(staffWithCases, (_info, session) => {
      const visible = mails.filter((item) => ids(session).has(item.caseId));
      return HttpResponse.json({
        sender: {
          name: `${session.firstName} ${session.lastName.toUpperCase()}`,
          address: session.email,
          roleLabel: ROLE_LABELS[session.role],
          phone: '01 87 88 02 98',
          extension: session.extension,
          firmAddress: '[ADRESSE DU CABINET]',
          website: 'www.legarec.fr',
          sentThisHour: mailState.sentThisHour,
          hourlyQuota: 180,
        },
        syncedMinutesAgo: 1,
        threads: visible.map((item) => ({ ...item, canAct: mayAnswer(session, item.caseId) })),
        total: session.role === 'CLAIMS_OFFICER' ? visible.length : 128,
        drafts: draftsOf(session).map((item) => {
          const target = item.caseId && actsOn(session, item.caseId) ? readable(session).find((entry) => entry.id === item.caseId) : undefined;
          return { ...item, recipient: target ? { name: target.name, reference: target.reference } : null };
        }),
        templates: TEMPLATES,
        automatic: AUTOMATIC.flatMap(([id, caseId, subject, when, status]) => {
          const item = readable(session).find((entry) => entry.id === caseId);
          return item ? [{ id, caseId, debtor: item.name, creditorId: item.creditorId, creditor: item.creditor, subject, when, status }] : [];
        }),
        folders: { inbox: 12, drafts: draftsOf(session).length, automatic: session.role === 'CLAIMS_OFFICER' ? 2 : 48 },
        stats: { unread: 12, todo: 4, delay: '3 h 20', automatic: 34 },
      });
    }),
  ),
  http.post(
    '/api/emails/messages',
    guarded<Info>(staffWithCases, async ({ request }, session) => {
      const parsed = outgoingMessage.safeParse(await request.json());
      if (!parsed.success) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      const { caseId, to, statement } = parsed.data;
      if (caseId && !actsOn(session, caseId)) return forbidden();
      // From a case, only to the contacts recorded on it: neither the message nor the statement may reach a third party.
      if (caseId && !contactsOf(caseId).includes(to.toLowerCase())) return HttpResponse.json({ code: 'NOT_A_CONTACT' }, { status: 422 });
      if (statement && !caseId) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      // Outside a case, the API still recognises a debtor's address.
      const target = caseId ?? caseOfEmail(to);
      if (target && !actsOn(session, target)) return forbidden();
      if (mailState.sentThisHour >= 180) return HttpResponse.json({ code: 'QUOTA' }, { status: 429 });
      if (mailState.failNext) {
        mailState.failNext = false;
        return HttpResponse.json({ code: 'SMTP_REFUSED' }, { status: 502 });
      }
      mailState.sentThisHour += 1;
      return done();
    }),
  ),
  http.post(
    '/api/emails/:id/read',
    onMail((item) => {
      item.unread = false;
      return done();
    }, true),
  ),
  http.put(
    '/api/emails/:id/archive',
    onMail(async (item, { request }) => {
      item.archived = ((await request.json()) as { archived: boolean }).archived;
      return done();
    }, true),
  ),
  http.put(
    '/api/emails/:id/category',
    onMail(async (item, { request }) => {
      item.category = ((await request.json()) as { category: EmailThread['category'] }).category;
      item.recategorized = true;
      return done();
    }, true),
  ),
  http.post(
    '/api/emails/:id/replies',
    onMail(async (item, { request }) => {
      const { text } = (await request.json()) as { text: string };
      const failed = mailState.failNext && item.source === 'EMAIL';
      mailState.failNext = false;
      item.replies = [
        ...item.replies.filter((entry) => entry.status === 'SENT'),
        { id: `r${item.replies.length}`, text, status: failed ? 'FAILED' : 'SENT', when: 'à l’instant' },
      ];
      return done();
    }, true),
  ),
  http.get(
    '/api/sms',
    guarded(staffWithCases, (_info, session) => {
      const visible = sms.filter((item) => (item.linked ? ids(session).has(item.caseId ?? '') : session.role === 'COLLECTION_MANAGER'));
      return HttpResponse.json({
        threads: visible.map((item) => ({ ...item, canAct: item.linked ? mayAnswer(session, item.caseId) : session.role === 'COLLECTION_MANAGER' })),
        total: session.role === 'CLAIMS_OFFICER' ? visible.length : 64,
        stopNotice: 'STOP : répondez STOP',
        stats: session.role === 'CLAIMS_OFFICER' ? null : { sent: 1284, delivered: 97.2, answers: 18, stops: 8 },
      });
    }),
  ),
  http.post(
    '/api/sms/:id/read',
    onSms((item) => {
      item.unread = 0;
      return done();
    }, true),
  ),
  http.post(
    '/api/sms/:id/messages',
    onSms(async (item, { request }, session) => {
      const { text } = (await request.json()) as { text: string };
      item.messages = [...item.messages, out(`o${item.messages.length}`, text, `À l’instant · envoi en cours · ${session.firstName} ${session.lastName}`)];
      return done();
    }, true),
  ),
  http.post(
    '/api/sms/:id/link',
    onSms(async (item, { request }, session) => {
      const { caseId } = (await request.json()) as { caseId: string };
      const found = readable(session).find((entry) => entry.id === caseId);
      if (!found) return notFound();
      Object.assign(item, {
        linked: true,
        caseId,
        name: found.name,
        creditor: found.creditor,
        creditorId: found.creditorId,
        due: found.amount,
        late: `${found.daysLate ?? 0} j`,
        status: 'REMINDER',
        next: 'Selon le scénario',
      });
      return done();
    }),
  ),
];
