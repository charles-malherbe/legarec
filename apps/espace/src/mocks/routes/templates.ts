import { checkTemplate, MANDATORY_BLOCKS, MERGE_FIELDS, TEMPLATE_MAX_BYTES, type Session, type TemplateDetail } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { done, forbidden, guarded, notFound } from '../http';
import { administers } from './steering';

type Info = { request: Request; params: Record<string, unknown> };
const FIRST = 'Ce courrier fait suite à notre premier courrier {dossier.premier_courrier_reference} du {dossier.premier_courrier_date}.';
type Stored = Omit<
  TemplateDetail,
  'canImport' | 'canValidate' | 'validator' | 'samples' | 'source' | 'versions' | 'fileName' | 'fileSize' | 'block' | 'status' | 'pending'
> & {
  isReminder: boolean;
};
const t = (
  id: string,
  name: string,
  channel: string,
  kind: Stored['kind'],
  version: number,
  date: string,
  author: string,
  uses: number,
  usedBy: string,
  subject: string | null,
  body: string,
  more: Partial<Stored> = {},
): Stored => ({
  id,
  name,
  channel,
  kind,
  category: kind === 'INVOICE' || kind === 'CONTRACT' ? 'BILLING' : 'COLLECTION',
  version,
  date,
  author,
  uses,
  usedBy,
  subject,
  body,
  registered: false,
  quote: false,
  isReminder: false,
  lines: [],
  totals: [],
  ...more,
});
const line = (label: string, detail: string, amount: string) => ({ label, detail, amount });
const TEMPLATES: Stored[] = [
  t(
    'amiable',
    'Relance amiable',
    'Courrier',
    'LETTER',
    6,
    '12/09/2026',
    'Camille Laurent',
    214,
    'Scénario standard, étape J+15',
    'Facture(s) impayée(s) – dossier {dossier.reference}',
    'Madame, Monsieur,\n\nSauf erreur de notre part, les factures {creance.factures} émises par {creancier.nom} restent impayées à ce jour, pour un montant de {creance.principal}.\n\nNous vous remercions de bien vouloir régler cette somme avant le {date.limite}, par virement ou par chèque. Les modalités sont indiquées sur {paiement.lien}.\n\nSi votre règlement est déjà parti, merci de ne pas tenir compte de ce courrier. En cas de difficulté, contactez-nous : nous chercherons ensemble une solution.',
  ),
  t(
    'ferme',
    'Relance ferme',
    'Courrier',
    'LETTER',
    3,
    '12/09/2026',
    'Camille Laurent',
    128,
    'Scénario standard, étape J+30',
    'Deuxième relance – dossier {dossier.reference}',
    `Madame, Monsieur,\n\n${FIRST}\n\nMalgré celui-ci, les factures {creance.factures} restent impayées. La somme due s’élève désormais à {creance.total}, indemnités forfaitaires comprises.\n\nNous vous demandons de régler cette somme avant le {date.limite}. Moyens de paiement : {paiement.lien}.\n\nSans règlement ni prise de contact de votre part, {creancier.nom} pourra engager une procédure judiciaire.`,
    { isReminder: true },
  ),
  t(
    'demeure',
    'Mise en demeure',
    'LRAR',
    'LETTER',
    4,
    '03/10/2026',
    'Camille Laurent',
    21,
    'Scénario standard, étape J+60, après accord du créancier',
    'Mise en demeure de payer – dossier {dossier.reference}',
    `Madame, Monsieur,\n\n${FIRST}\n\nMalgré nos relances, les factures {creance.factures} émises par {creancier.nom} demeurent impayées.\n\nPar la présente, nous vous mettons en demeure de régler la somme de {creance.total} au plus tard le {date.limite}, soit :\n– principal : {creance.principal}\n– intérêts de retard : {creance.interets}\n– indemnités forfaitaires : {creance.indemnites}\n\nVous pouvez payer par virement ou par chèque. Les modalités sont indiquées sur {paiement.lien}.\n\nÀ défaut de règlement à cette date, {creancier.nom} pourra saisir la juridiction compétente.`,
    { registered: true, isReminder: true },
  ),
  t(
    'echeancier',
    'Proposition d’échéancier',
    'Courrier',
    'LETTER',
    2,
    '18/10/2026',
    'Thomas Giraud',
    37,
    'Rédiger un courrier, échéanciers',
    'Proposition d’échéancier – dossier {dossier.reference}',
    'Madame, Monsieur,\n\nComme convenu, {creancier.nom} accepte que la somme de {creance.total} soit réglée en {echeancier.mensualites} mensualités de {echeancier.montant}.\n\nPour valider cet échéancier, signez-le en ligne sur {paiement.lien} avant le {date.limite}. Les versements, par virement ou par chèque, commenceront le mois suivant.\n\nUn retard de paiement rendrait l’échéancier caduc et la totalité de la somme immédiatement exigible.',
  ),
  t(
    'attestation',
    'Attestation de solde',
    'Courrier',
    'LETTER',
    1,
    '02/06/2026',
    'Camille Laurent',
    19,
    'Clôture d’un dossier réglé',
    'Attestation de solde – dossier {dossier.reference}',
    'Madame, Monsieur,\n\nNous attestons que {debiteur.raison_sociale} a réglé l’intégralité des sommes dues à {creancier.nom} au titre des factures {creance.factures}.\n\nLe dossier {dossier.reference} est clos. Aucune autre somme ne vous sera réclamée à ce titre.',
  ),
  t(
    'rappel',
    'Rappel avant échéance',
    'E-mail',
    'EMAIL',
    5,
    '30/08/2026',
    'Thomas Giraud',
    402,
    'Scénario préventif, J−3',
    'Rappel : facture {creance.factures} à régler le {date.limite}',
    'Bonjour {debiteur.contact},\n\nPour rappel, le règlement de {creance.principal} à {creancier.nom} est attendu le {date.limite}.\n\nLes moyens de paiement sont indiqués ici : {paiement.lien}\n\nSi c’est déjà fait, merci et bonne journée.\nL’équipe Legarec',
  ),
  t(
    'sms',
    'Relance SMS J+21',
    'SMS',
    'SMS',
    7,
    '05/11/2026',
    'Camille Laurent',
    1196,
    'Scénario standard, étape J+21',
    null,
    'Legarec pour {creancier.nom} : {creance.principal} dus (dossier {dossier.reference}), courrier {dossier.premier_courrier_reference} du {dossier.premier_courrier_date}. Infos : {paiement.lien} ou 01 87 88 02 98.',
    { isReminder: true },
  ),
  t(
    'fac-com',
    'Facture de commission mensuelle',
    'Facture',
    'INVOICE',
    3,
    '28/09/2026',
    'Marie Dubreuil',
    5,
    'Facturation, émission mensuelle',
    'Commission de recouvrement – {document.periode}',
    'Commission calculée au taux de {commission.taux} sur les sommes recouvrées en {document.periode}, déduite du reversement du mois.\n\nÀ régler avant le {document.echeance}. Pour toute question : administratif@legarec.fr.',
    {
      lines: [
        line('Commission de recouvrement', 'Sommes recouvrées : 45 200,00 €', '5 424,00 €'),
        line('Frais refacturés', '3 lettres recommandées', '23,40 €'),
      ],
      totals: ['5 447,40 €', '1 089,48 €', '6 536,88 €'],
    },
  ),
  t(
    'fac-frais',
    'Refacturation de frais de procédure',
    'Facture',
    'INVOICE',
    2,
    '14/10/2026',
    'Marie Dubreuil',
    2,
    'Facturation, frais avancés',
    'Frais de procédure avancés – dossier {dossier.reference}',
    'Frais avancés par Legarec pour le compte de {client.nom} dans le dossier {dossier.reference}, sur justificatifs joints.\n\nÀ régler avant le {document.echeance}.',
    {
      lines: [
        line('Signification par commissaire de justice', 'Acte du 02/11/2026', '86,40 €'),
        line('Frais de greffe', 'Requête en injonction de payer', '33,47 €'),
      ],
      totals: ['119,87 €', '23,97 €', '143,84 €'],
    },
  ),
  t(
    'fac-forfait',
    'Facture forfaitaire',
    'Facture',
    'INVOICE',
    1,
    '05/05/2026',
    'Marie Dubreuil',
    1,
    'Facturation, prestations ponctuelles',
    'Prestation forfaitaire – {document.periode}',
    'Prestation réalisée pour {client.nom} selon le devis accepté.\n\nÀ régler avant le {document.echeance}.',
    { lines: [line('Mise en place du portefeuille', 'Import et contrôle de 248 créances', '1 200,00 €')], totals: ['1 200,00 €', '240,00 €', '1 440,00 €'] },
  ),
  t(
    'dev-amiable',
    'Devis recouvrement amiable',
    'Devis',
    'INVOICE',
    2,
    '21/09/2026',
    'Marie Dubreuil',
    3,
    'Facturation, prospects',
    'Proposition de recouvrement amiable pour {client.nom}',
    'Bonjour {client.contact},\n\nVoici notre proposition pour le recouvrement amiable de vos créances : aucune avance de frais, commission de {commission.taux} sur les seules sommes recouvrées.\n\nDevis valable 30 jours.',
    {
      quote: true,
      lines: [line('Commission sur sommes recouvrées', 'Taux appliqué sur encaissement', '{commission.taux}'), line('Frais de dossier', 'Offerts', '0,00 €')],
      totals: ['0,00 €', '0,00 €', '0,00 €'],
    },
  ),
  t(
    'con-convention',
    'Convention de recouvrement amiable',
    'Contrat',
    'CONTRACT',
    2,
    '12/03/2026',
    'Marie Dubreuil',
    1,
    'Facturation, contrats (signature électronique)',
    'Convention de recouvrement amiable entre Legarec et {client.nom}',
    'Article 1 – Objet\n{client.nom} confie à Legarec le recouvrement amiable de ses créances commerciales impayées.\n\nArticle 2 – Rémunération\nLegarec perçoit une commission de {commission.taux} des sommes effectivement recouvrées, déduite des reversements.\n\nArticle 3 – Reversements\nLes sommes encaissées sont reversées chaque mois, accompagnées d’un relevé détaillé.',
  ),
];
const example = Object.fromEntries(MERGE_FIELDS.map((item) => [item.code, item.example as string]));
const SAMPLES: TemplateDetail['samples'] = [
  {
    id: 'bp',
    label: 'Bâtiplus SAS · Matériaux Delta',
    values: {
      ...example,
      'debiteur.adresse': '14 rue des Forges\n69007 Lyon',
      'debiteur.contact': 'M. Julien Garnier',
      'creance.total': '49 448,40 €',
      'dossier.gestionnaire': 'Camille Laurent',
      'date.jour': '23 novembre 2026',
      'client.nom': 'Matériaux Delta',
      'client.adresse': 'ZI des Platanes\n38070 Saint-Quentin-Fallavier',
    },
  },
  {
    id: 'gh',
    label: 'Groupe Hélio · Médiatel',
    values: {
      ...example,
      'debiteur.raison_sociale': 'Groupe Hélio',
      'debiteur.adresse': '3 avenue Jean-Jaurès\n13002 Marseille',
      'debiteur.contact': 'Mme Nadia Ferhat',
      'creance.factures': 'F-2026-0533',
      'creance.principal': '36 750,00 €',
      'creance.interets': '642,80 €',
      'creance.indemnites': '40,00 €',
      'creance.total': '37 432,80 €',
      'creancier.nom': 'Médiatel',
      'creancier.adresse': '27 quai Perrache, 69002 Lyon',
      'dossier.reference': 'LGR-2026-05107',
      'dossier.gestionnaire': 'Sarah Morel',
      'client.nom': 'Médiatel',
      'client.adresse': '27 quai Perrache\n69002 Lyon',
      'client.contact': 'M. Olivier Brunet',
      'commission.taux': '10 %',
    },
  },
];
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const blockOf = (item: Stored) =>
  item.kind === 'SMS' ? 'mention_sms' : item.category === 'COLLECTION' ? 'mentions_recouvrement' : item.kind === 'CONTRACT' ? 'en_tete' : 'mentions_facture';
const sourceOf = (item: Stored) => {
  const body = item.body.replace(/\{([^{}\s]+)\}/g, '{{$1}}');
  if (item.kind === 'SMS') return `${body} {{> mention_sms}}\n`;
  const paragraphs = body.split(/\n\s*\n/).map((text) => `  <p>${escape(text).replace(/\n/g, '<br>')}</p>`);
  return `<!doctype html>\n<html lang="fr">\n<body>\n  {{> en_tete}}\n${paragraphs.join('\n')}\n  {{> ${blockOf(item)}}}\n</body>\n</html>\n`;
};
const render = (source: string) =>
  source
    .replace(/\{\{>\s*([\w]+)\s*\}\}/g, (_all, code: string) => `<p>[${escape(MANDATORY_BLOCKS.find((item) => item.code === code)?.content ?? code)}]</p>`)
    .replace(/\{\{[^}#/]*?([\w]+\.[\w]+)\s*\}\}/g, (_all, code: string) => escape(example[code] ?? ''));
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

type Progress = { status: TemplateDetail['status']; pending: TemplateDetail['pending']; by: string; bump: number };
let progress: Record<string, Progress> = {};
export const resetTemplates = () => {
  progress = {};
};
const staff = (session: Session) => session.role !== 'CREDITOR';
const imports = (session: Session) => session.role === 'DIRECTOR' || session.role === 'COLLECTION_MANAGER';
const detail = (item: Stored, session: Session): TemplateDetail => {
  const state = progress[item.id] ?? { status: 'PUBLISHED', pending: null, by: '', bump: 0 };
  const version = item.version + state.bump;
  const extension = item.kind === 'SMS' ? 'txt' : 'html';
  const { isReminder: _isReminder, ...shown } = item;
  return {
    ...shown,
    version,
    block: blockOf(item),
    status: state.status,
    pending: state.pending,
    fileName: `${slug(item.name)}-v${version}.${extension}`,
    fileSize: item.kind === 'SMS' ? '0,2 Ko' : item.kind === 'INVOICE' ? '7,8 Ko' : '6,4 Ko',
    source: sourceOf(item),
    canImport: imports(session),
    canValidate: administers(session),
    validator: session.activeDelegations.includes('ADMINISTRATIVE') ? 'Directeur, ou Responsable par délégation' : 'Directeur',
    samples: SAMPLES,
    versions: [
      { number: version, what: 'Version en service', who: `${item.author} · ${item.date} · validée par Marie Dubreuil`, state: 'PUBLISHED' },
      ...[1, 2]
        .filter((back) => version - back >= 1)
        .map((back) => ({
          number: version - back,
          what: back === 1 ? 'Délai de paiement passé de 15 à 8 jours' : 'Ajout du lien vers l’espace débiteur',
          who: back === 1 ? 'Hugo Benali · 14/08/2026' : `${item.author} · 02/05/2026`,
          state: 'ARCHIVED' as const,
        })),
    ],
  };
};
const onTemplate = (allow: (session: Session) => boolean, resolve: (item: Stored, session: Session, info: Info) => Response | Promise<Response>) =>
  guarded<Info>(allow, (info, session) => {
    const item = TEMPLATES.find((entry) => entry.id === info.params.id);
    return item ? resolve(item, session, info) : notFound();
  });

export const templateHandlers = [
  http.get(
    '/api/templates',
    guarded(staff, () =>
      HttpResponse.json({ items: TEMPLATES.map(({ id, name, channel, category, date, uses }) => ({ id, name, channel, category, date, uses })) }),
    ),
  ),
  http.get(
    '/api/templates/:id',
    onTemplate(staff, (item, session) => HttpResponse.json(detail(item, session))),
  ),
  http.post(
    '/api/templates/:id/import',
    onTemplate(imports, async (item, session, { request }) => {
      const { source, fileName } = (await request.json()) as { source: string; fileName: string };
      if (new Blob([source]).size > TEMPLATE_MAX_BYTES) return HttpResponse.json({ code: 'FILE_TOO_LARGE' }, { status: 413 });
      const report = checkTemplate({ ...item, block: blockOf(item) }, source);
      const pending = { fileName, accepted: report.accepted, checks: report.checks, previewHtml: report.accepted ? render(source) : '' };
      progress[item.id] = { status: report.accepted ? 'IMPORTED' : 'PUBLISHED', pending, by: session.userId, bump: progress[item.id]?.bump ?? 0 };
      return done();
    }),
  ),
  http.delete(
    '/api/templates/:id/import',
    onTemplate(imports, (item) => {
      progress[item.id] = { status: 'PUBLISHED', pending: null, by: '', bump: progress[item.id]?.bump ?? 0 };
      return done();
    }),
  ),
  http.post(
    '/api/templates/:id/restore',
    onTemplate(imports, (item, session) => {
      progress[item.id] = { status: 'RESTORED', pending: null, by: session.userId, bump: progress[item.id]?.bump ?? 0 };
      return done();
    }),
  ),
  http.post(
    '/api/templates/:id/submit',
    onTemplate(imports, async (item, _session, { request }) => {
      const state = progress[item.id];
      const { acknowledged } = (await request.json()) as { acknowledged: boolean };
      if (!state || state.status === 'PUBLISHED' || state.status === 'WAITING') return forbidden();
      if (state.pending?.checks.some((check) => check.level === 'WARNING') && !acknowledged) return HttpResponse.json({ code: 'WARNINGS' }, { status: 422 });
      state.status = 'WAITING';
      return done();
    }),
  ),
  http.post(
    '/api/templates/:id/review',
    onTemplate(administers, async (item, _session, { request }) => {
      const state = progress[item.id];
      const { approved } = (await request.json()) as { approved: boolean };
      if (state?.status !== 'WAITING') return forbidden();
      progress[item.id] = { status: 'PUBLISHED', pending: null, by: '', bump: state.bump + (approved ? 1 : 0) };
      return done();
    }),
  ),
  http.post(
    '/api/templates/:id/test',
    onTemplate(imports, () => done()),
  ),
];
