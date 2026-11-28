import { z } from 'zod';

/**
 * Public registers of the French State and of the euro area, read from the browser (DECISIONS.md, 28/11/2026): none
 * needs a key, and the API never calls a service during a request. What leaves is only what is typed in the field being
 * filled (an address, a postal code, a company number), never a name of the case, a reference or an access code; no
 * cookie, no referrer. A register that does not answer leaves the field to be typed by hand: each answer is a proposal.
 */
export const PUBLIC_DATA = {
  /** API Adresse of the Base Adresse Nationale, run by the IGN on the Géoplateforme. */
  addresses: 'https://data.geopf.fr/geocodage/search',
  /** API Géo (découpage administratif): the communes of a postal code. */
  communes: 'https://geo.api.gouv.fr/communes',
  /** API Recherche d'entreprises, built on the Sirene register of the Insee. */
  companies: 'https://recherche-entreprises.api.gouv.fr/search',
  /** Data portal of the European Central Bank: rate of the main refinancing operations. */
  ecbRate: 'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV',
} as const;

async function read<T extends z.ZodType>(schema: T, url: string, signal?: AbortSignal): Promise<z.infer<T> | null> {
  try {
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface AddressHit {
  /** The whole address, as proposed. */
  label: string;
  /** Number and street, or place called, without the commune. */
  line: string;
  postalCode: string;
  city: string;
}
const addressAnswer = z.object({
  features: z.array(
    z.object({
      properties: z.object({ label: z.string(), name: z.string(), postcode: z.string().optional(), city: z.string().optional() }),
    }),
  ),
});

/** Addresses of France matching what is typed, the most likely first; from 3 characters. */
export async function suggestAddresses(text: string, signal?: AbortSignal): Promise<AddressHit[]> {
  const query = text.trim();
  if (query.length < 3) return [];
  const params = new URLSearchParams({ q: query.slice(0, 200), limit: '5', autocomplete: '1', index: 'address' });
  const answer = await read(addressAnswer, `${PUBLIC_DATA.addresses}?${params}`, signal);
  return (answer?.features ?? []).flatMap(({ properties: item }) =>
    item.postcode && item.city ? [{ label: item.label, line: item.name, postalCode: item.postcode, city: item.city }] : [],
  );
}

const communesAnswer = z.array(z.object({ nom: z.string() }));
/** Communes served by a postal code of 5 digits: often one, sometimes several (54490: seven). */
export async function communesOf(postalCode: string, signal?: AbortSignal): Promise<string[]> {
  if (!/^\d{5}$/u.test(postalCode)) return [];
  const params = new URLSearchParams({ codePostal: postalCode, fields: 'nom', format: 'json' });
  const answer = await read(communesAnswer, `${PUBLIC_DATA.communes}?${params}`, signal);
  return [...new Set((answer ?? []).map((item) => item.nom))].sort((a, b) => a.localeCompare(b, 'fr'));
}

export interface CompanyRecord {
  siren: string;
  /** SIRET of the head office. */
  siret: string;
  name: string;
  /** Legal category of the Insee, 4 digits (5499: SARL…). */
  legalCategory: string;
  /** False once the company has ceased. */
  active: boolean;
  line: string;
  postalCode: string;
  city: string;
  vatNumber: string;
}
const companyAnswer = z.object({
  results: z.array(
    z.object({
      siren: z.string(),
      nom_raison_sociale: z.string().nullable().optional(),
      nom_complet: z.string(),
      nature_juridique: z.string().nullable().optional(),
      etat_administratif: z.string().nullable().optional(),
      siege: z.object({
        siret: z.string(),
        numero_voie: z.string().nullable().optional(),
        indice_repetition: z.string().nullable().optional(),
        type_voie: z.string().nullable().optional(),
        libelle_voie: z.string().nullable().optional(),
        complement_adresse: z.string().nullable().optional(),
        code_postal: z.string().nullable().optional(),
        libelle_commune: z.string().nullable().optional(),
      }),
    }),
  ),
});
const STREET_TYPES: Record<string, string> = {
  AV: 'avenue',
  AVENUE: 'avenue',
  BD: 'boulevard',
  BOULEVARD: 'boulevard',
  CHE: 'chemin',
  CHEMIN: 'chemin',
  IMP: 'impasse',
  IMPASSE: 'impasse',
  PL: 'place',
  PLACE: 'place',
  QUAI: 'quai',
  RTE: 'route',
  ROUTE: 'route',
  RUE: 'rue',
  ALL: 'allée',
  ALLEE: 'allée',
};
/** The register writes in capitals: « 20 AVENUE DE SEGUR » becomes « 20 avenue de Segur ». */
const softened = (text: string) =>
  text
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/\b(De|Du|Des|La|Le|Les|Et|D'|L')(?=\s|\p{L})/gu, (word) => word.toLowerCase());

/** The register entry of a SIREN (9 digits) or a SIRET (14 digits); null if unknown or out of reach. */
export async function findCompany(number: string, signal?: AbortSignal): Promise<CompanyRecord | null> {
  const digits = number.replace(/\s/gu, '');
  if (!/^(\d{9}|\d{14})$/u.test(digits)) return null;
  const siren = digits.slice(0, 9);
  const params = new URLSearchParams({ q: siren, per_page: '1', page: '1' });
  const answer = await read(companyAnswer, `${PUBLIC_DATA.companies}?${params}`, signal);
  const found = answer?.results.find((item) => item.siren === siren);
  if (!found) return null;
  const office = found.siege;
  const street = [office.numero_voie, office.indice_repetition, office.type_voie && (STREET_TYPES[office.type_voie] ?? office.type_voie), office.libelle_voie]
    .filter(Boolean)
    .join(' ');
  return {
    siren,
    siret: office.siret,
    name: found.nom_raison_sociale ?? found.nom_complet,
    legalCategory: found.nature_juridique ?? '',
    active: found.etat_administratif !== 'C',
    line: softened([street, office.complement_adresse].filter(Boolean).join(', ')).replace(
      /^(\d+) (Bis|Ter)\b/u,
      (_, n: string, x: string) => `${n} ${x.toLowerCase()}`,
    ),
    postalCode: office.code_postal ?? '',
    city: office.libelle_commune ? softened(office.libelle_commune) : '',
    vatNumber: vatNumberOf(siren),
  };
}

/** French intracommunity VAT number of a SIREN: FR, a key of 2 digits, the SIREN. */
export function vatNumberOf(siren: string): string {
  const digits = siren.replace(/\s/gu, '');
  if (!/^\d{9}$/u.test(digits)) return '';
  const key = (12 + 3 * (Number(digits) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${digits}`;
}

export interface PublishedRate {
  /** In percent, as published: 2.65. */
  rate: number;
  /** Day it applies from, YYYY-MM-DD. */
  since: string;
}
const ecbAnswer = z.object({
  dataSets: z.array(z.object({ series: z.record(z.string(), z.object({ observations: z.record(z.string(), z.array(z.number().nullable())) })) })),
  structure: z.object({ dimensions: z.object({ observation: z.array(z.object({ values: z.array(z.object({ id: z.string() })) })) }) }),
});
/**
 * Rate of the main refinancing operations of the ECB in force on a day (YYYY-MM-DD; the last one without), the base of
 * the late payment rate between professionals: the one of 1 January or 1 July holds for the whole semester.
 */
export async function ecbRateOn(day?: string, signal?: AbortSignal): Promise<PublishedRate | null> {
  const params = new URLSearchParams({ lastNObservations: '1', format: 'jsondata', detail: 'dataonly', ...(day ? { endPeriod: day } : {}) });
  const answer = await read(ecbAnswer, `${PUBLIC_DATA.ecbRate}?${params}`, signal);
  const series = answer && Object.values(answer.dataSets[0]?.series ?? {})[0];
  const days = answer?.structure.dimensions.observation[0]?.values ?? [];
  const [index, values] = Object.entries(series?.observations ?? {}).at(-1) ?? [];
  const rate = values?.[0];
  const since = index === undefined ? undefined : days[Number(index)]?.id;
  return typeof rate === 'number' && since ? { rate, since } : null;
}
