import { PUBLIC_DATA } from '@legarec/platform';
import { http, HttpResponse } from 'msw';

/**
 * The public registers, for the tests only: they never reach the network. The demonstration leaves them out and reads
 * the real registers, which know every address of France (DECISIONS.md, 28/11/2026).
 */
export const ADDRESSES = [
  { label: '14 Rue des Forges 69007 Lyon', name: '14 Rue des Forges', postcode: '69007', city: 'Lyon' },
  { label: '14 Rue des Forgerons 69100 Villeurbanne', name: '14 Rue des Forgerons', postcode: '69100', city: 'Villeurbanne' },
];
const COMMUNES: Record<string, string[]> = {
  '69007': ['Lyon'],
  '54490': ['Avillers', 'Domprix', 'Joudreville', 'Murville', 'Piennes', 'Preutin-Higny', 'Xivry-Circourt'],
};
export const COMPANY = {
  siren: '512384920',
  nom_raison_sociale: 'BATIPLUS',
  nom_complet: 'BATIPLUS (BATIPLUS)',
  nature_juridique: '5710',
  etat_administratif: 'A',
  siege: {
    siret: '51238492000027',
    numero_voie: '8',
    type_voie: 'BD',
    libelle_voie: 'DU PORT',
    code_postal: '80000',
    libelle_commune: 'AMIENS',
  },
};

export const publicDataHandlers = [
  http.get(PUBLIC_DATA.addresses, ({ request }) => {
    const query = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase();
    return HttpResponse.json({ features: ADDRESSES.filter((item) => item.label.toLowerCase().includes(query)).map((properties) => ({ properties })) });
  }),
  http.get(PUBLIC_DATA.communes, ({ request }) =>
    HttpResponse.json((COMMUNES[new URL(request.url).searchParams.get('codePostal') ?? ''] ?? []).map((nom) => ({ nom }))),
  ),
  http.get(PUBLIC_DATA.companies, ({ request }) =>
    HttpResponse.json({ results: new URL(request.url).searchParams.get('q') === COMPANY.siren ? [COMPANY] : [] }),
  ),
  http.get(PUBLIC_DATA.ecbRate, () =>
    HttpResponse.json({
      dataSets: [{ series: { '0:0:0:0:0:0:0': { observations: { '0': [2.65] } } } }],
      structure: { dimensions: { observation: [{ values: [{ id: '2026-09-16' }] }] } },
    }),
  ),
];
