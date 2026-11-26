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

/** By their name: the card « Convention » of a creditor, the four lines of a case (mockup « Dossier »), the two of an opening (proposal 2). */
export function termsOf(mandate: Mandate, view: 'creditor' | 'case' | 'opening'): { label: string; value: string }[] {
  const amicable = `${percent(mandate.amicableRateBp)} HT du recouvré`;
  const plan = `≤ ${mandate.planMonthsWithoutConsent} mois`;
  const discount = `≤ ${percent(mandate.discountMaxBp)}`;
  const litigation = mandate.litigationNeedsConsent ? 'Sur accord écrit' : 'Sans accord écrit';
  const indemnity = mandate.fixedIndemnity ? '40 € / facture (professionnels)' : 'Non réclamée';
  const terms: [string, string][] =
    view === 'case'
      ? [
          ['Honoraires', amicable],
          ['Échéancier sans accord', plan],
          ['Remise autorisée', discount],
          ['Contentieux', litigation],
        ]
      : view === 'opening'
        ? [
            ['Honoraires amiable', amicable],
            ['Indemnité forfaitaire', indemnity],
          ]
        : [
            ['Honoraires amiable', amicable],
            ['Honoraires judiciaire', `${percent(mandate.litigationRateBp)} HT`],
            ...(mandate.openingFeeCents
              ? ([['Frais d’ouverture', `${(mandate.openingFeeCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT par dossier`]] as [
                  string,
                  string,
                ][])
              : []),
            ['Indemnité forfaitaire', indemnity],
            ['Échéancier sans accord', plan],
            ['Remise autorisée', discount],
            ['Passage en contentieux', litigation],
            ['Reporting', `Mensuel, le ${mandate.reportingDay}`],
            ['Intérêts de retard', MANDATE_INTEREST_LABELS[mandate.interestMode]],
          ];
  return terms.map(([label, value]) => ({ label, value }));
}
