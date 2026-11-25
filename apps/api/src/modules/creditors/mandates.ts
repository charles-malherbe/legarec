import { MANDATE_INTEREST_LABELS } from '@legarec/contracts';
import type { Transaction } from '../../platform/database/database';
import { dayOf } from '../../platform/format';

type Mandate = NonNullable<Awaited<ReturnType<Transaction['mandate']['findFirst']>>>;
/** A date without a time, as it is written. */
export const dayText = (date: Date) => date.toISOString().slice(0, 10);
export const percent = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

const today = () => dayOf(new Date());
export function stateOf(mandate: { startsOn: Date; endsOn: Date | null }): 'CURRENT' | 'TO_COME' | 'ENDED' {
  if (dayText(mandate.startsOn) > today()) return 'TO_COME';
  return mandate.endsOn !== null && dayText(mandate.endsOn) < today() ? 'ENDED' : 'CURRENT';
}
export function currentOf<T extends { startsOn: Date; endsOn: Date | null }>(mandates: T[]): T | undefined {
  return mandates.find((mandate) => stateOf(mandate) === 'CURRENT');
}

/** Card « Convention de mandat »; an officer reads what they need to act. */
export function termsOf(mandate: Mandate, short: boolean): { label: string; value: string }[] {
  const terms: [string, string][] = [
    ['Honoraires amiable', `${percent(mandate.amicableRateBp)} HT du recouvré`],
    ['Honoraires judiciaire', `${percent(mandate.litigationRateBp)} HT`],
    ...(mandate.openingFeeCents
      ? ([['Frais d’ouverture', `${(mandate.openingFeeCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT par dossier`]] as [
          string,
          string,
        ][])
      : []),
    ['Indemnité forfaitaire', mandate.fixedIndemnity ? '40 € / facture (professionnels)' : 'Non réclamée'],
    ['Échéancier sans accord', `≤ ${mandate.planMonthsWithoutConsent} mois`],
    ['Remise autorisée', `≤ ${percent(mandate.discountMaxBp)}`],
    ['Passage en contentieux', mandate.litigationNeedsConsent ? 'Sur accord écrit' : 'Sans accord écrit'],
    ['Reporting', `Mensuel, le ${mandate.reportingDay}`],
    ['Intérêts de retard', MANDATE_INTEREST_LABELS[mandate.interestMode]],
  ];
  return terms.slice(0, short ? 8 : undefined).map(([label, value]) => ({ label, value }));
}
