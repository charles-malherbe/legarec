import {
  formatCents,
  formatDate,
  MANDATE_INTEREST_LABELS,
  parseCents,
  PLAN_MONTHS,
  SCENARIO_LABELS,
  type MandateForm,
  type MandateVersion,
} from '@legarec/contracts';
import { Badge, Case, Champ, Tableau } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';

/** Terms as they are typed. */
export interface MandateText {
  startsOn: string;
  endsOn: string;
  amicableRate: string;
  litigationRate: string;
  openingFee: string;
  planMonths: string;
  discountMax: string;
  litigationNeedsConsent: boolean;
  deferSmallRemittances: boolean;
  interestMode: MandateForm['interestMode'];
  contractRate: string;
  fixedIndemnity: boolean;
  reportingDay: string;
  scenario: MandateForm['scenario'];
}
export const EMPTY_MANDATE: MandateText = {
  startsOn: '',
  endsOn: '',
  amicableRate: '',
  litigationRate: '',
  openingFee: '',
  planMonths: '6',
  discountMax: '5',
  litigationNeedsConsent: true,
  deferSmallRemittances: false,
  interestMode: 'ECB_PLUS_TEN',
  contractRate: '',
  fixedIndemnity: true,
  reportingDay: '5',
  scenario: 'BUSINESS',
};
/** 750 → « 7,5 » */
export const percentOf = (bp: number) => (bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
/** Two decimals at most; anything else is refused by the schema. */
const basisPoints = (value: string) => {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/u.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : Number.NaN;
};
export const asMandate = (text: MandateText) => ({
  startsOn: text.startsOn,
  endsOn: text.endsOn || null,
  amicableRateBp: basisPoints(text.amicableRate),
  litigationRateBp: basisPoints(text.litigationRate),
  openingFeeCents: text.openingFee.trim() ? (parseCents(text.openingFee) ?? Number.NaN) : 0,
  planMonthsWithoutConsent: Number(text.planMonths),
  discountMaxBp: basisPoints(text.discountMax),
  litigationNeedsConsent: text.litigationNeedsConsent,
  deferSmallRemittances: text.deferSmallRemittances,
  interestMode: text.interestMode,
  contractRateBp: text.interestMode === 'CONTRACT' ? (text.contractRate.trim() ? basisPoints(text.contractRate) : null) : null,
  fixedIndemnity: text.fixedIndemnity,
  reportingDay: Number(text.reportingDay),
  scenario: text.scenario,
});
export const asText = (mandate: MandateForm): MandateText => ({
  startsOn: mandate.startsOn,
  endsOn: mandate.endsOn ?? '',
  amicableRate: percentOf(mandate.amicableRateBp),
  litigationRate: percentOf(mandate.litigationRateBp),
  openingFee: mandate.openingFeeCents ? (mandate.openingFeeCents / 100).toFixed(2).replace('.', ',') : '',
  planMonths: String(mandate.planMonthsWithoutConsent),
  discountMax: percentOf(mandate.discountMaxBp),
  litigationNeedsConsent: mandate.litigationNeedsConsent,
  deferSmallRemittances: mandate.deferSmallRemittances,
  interestMode: mandate.interestMode,
  contractRate: mandate.contractRateBp === null ? '' : percentOf(mandate.contractRateBp),
  fixedIndemnity: mandate.fixedIndemnity,
  reportingDay: String(mandate.reportingDay),
  scenario: mandate.scenario,
});
const optionsOf = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** `former`: the mandate that an amendment changes. */
export function MandateFields({
  value,
  onChange,
  errors,
  former,
}: {
  value: MandateText;
  onChange: (value: MandateText) => void;
  errors: Record<string, string>;
  former?: MandateVersion;
}) {
  const set = (key: keyof MandateText) => (next: string | boolean) => onChange({ ...value, [key]: next });
  const was = (key: 'amicableRateBp' | 'litigationRateBp') => (former ? `Aujourd’hui : ${percentOf(former[key])} %` : undefined);
  const error = (key: string) => errors[`mandate.${key}`];
  return (
    <div className={layout.stack}>
      <div className={layout.form}>
        <Champ label="Date d’effet" type="date" required value={value.startsOn} error={error('startsOn')} onChange={set('startsOn')} />
        <Champ label="Fin" type="date" optional help="Vide : durée indéterminée" value={value.endsOn} error={error('endsOn')} onChange={set('endsOn')} />
      </div>
      <h3 className={layout.strong}>Rémunération</h3>
      <div className={layout.form}>
        <Champ
          label="Honoraires amiable"
          required
          inputMode="decimal"
          suffix="% HT"
          help={was('amicableRateBp') ?? 'Des sommes encaissées'}
          value={value.amicableRate}
          error={error('amicableRateBp')}
          onChange={set('amicableRate')}
        />
        <Champ
          label="Honoraires judiciaire"
          required
          inputMode="decimal"
          suffix="% HT"
          help={was('litigationRateBp')}
          value={value.litigationRate}
          error={error('litigationRateBp')}
          onChange={set('litigationRate')}
        />
        <Champ
          label="Frais d’ouverture"
          optional
          inputMode="decimal"
          suffix="€ HT"
          help="Par dossier"
          value={value.openingFee}
          error={error('openingFeeCents')}
          onChange={set('openingFee')}
        />
      </div>
      <h3 className={layout.strong}>Accords du créancier</h3>
      <div className={layout.form}>
        <Champ
          label="Échéancier sans accord"
          type="select"
          help="Au-delà : Responsable, puis créancier"
          value={value.planMonths}
          error={error('planMonthsWithoutConsent')}
          options={PLAN_MONTHS.map((months) => ({ value: String(months), label: `${months} mois` }))}
          onChange={set('planMonths')}
        />
        <Champ
          label="Remise autorisée"
          inputMode="decimal"
          suffix="%"
          help="Toujours soumise à validation"
          value={value.discountMax}
          error={error('discountMaxBp')}
          onChange={set('discountMax')}
        />
      </div>
      <Case
        label="Contentieux sur accord écrit"
        description="Le créancier valide avant tout engagement de frais."
        checked={value.litigationNeedsConsent}
        onToggle={set('litigationNeedsConsent')}
      />
      <Case
        label="Report des reversements sous 100 €"
        description="Seulement si la convention le prévoit ; sinon, reversé chaque mois."
        checked={value.deferSmallRemittances}
        onToggle={set('deferSmallRemittances')}
      />
      <h3 className={layout.strong}>Sommes réclamées au débiteur</h3>
      <div className={layout.form}>
        <Champ
          label="Intérêts de retard"
          type="select"
          value={value.interestMode}
          options={optionsOf(MANDATE_INTEREST_LABELS)}
          onChange={(next) => onChange({ ...value, interestMode: next as MandateText['interestMode'] })}
        />
        {value.interestMode === 'CONTRACT' && (
          <Champ
            label="Taux du contrat"
            required
            inputMode="decimal"
            suffix="%"
            help="Si le contrat prévoit un taux"
            value={value.contractRate}
            error={error('contractRateBp')}
            onChange={set('contractRate')}
          />
        )}
      </div>
      <Case
        label="Indemnité forfaitaire de 40 € par facture"
        description="Débiteurs professionnels seulement, jamais un particulier."
        checked={value.fixedIndemnity}
        onToggle={set('fixedIndemnity')}
      />
      <h3 className={layout.strong}>Suivi</h3>
      <div className={layout.form}>
        <Champ
          label="Scénario de relance"
          type="select"
          value={value.scenario}
          options={optionsOf(SCENARIO_LABELS)}
          onChange={(next) => onChange({ ...value, scenario: next as MandateText['scenario'] })}
        />
        <Champ
          label="Rapport mensuel"
          type="number"
          prefix="Le"
          suffix="du mois"
          value={value.reportingDay}
          error={error('reportingDay')}
          onChange={set('reportingDay')}
        />
      </div>
    </div>
  );
}

export function MandateTerms({ mandate }: { mandate: MandateVersion }) {
  const terms: [string, string][] = [
    ['Honoraires amiable', `${percentOf(mandate.amicableRateBp)} % HT du recouvré`],
    ['Honoraires judiciaire', `${percentOf(mandate.litigationRateBp)} % HT`],
    ['Frais d’ouverture', mandate.openingFeeCents ? `${formatCents(mandate.openingFeeCents, { decimals: 'always' })} HT par dossier` : 'Aucun'],
    ['Indemnité forfaitaire', mandate.fixedIndemnity ? '40 € / facture (professionnels)' : 'Non réclamée'],
    ['Échéancier sans accord', `≤ ${mandate.planMonthsWithoutConsent} mois`],
    ['Remise autorisée', `≤ ${percentOf(mandate.discountMaxBp)} %`],
    ['Passage en contentieux', mandate.litigationNeedsConsent ? 'Sur accord écrit' : 'Sans accord écrit'],
    ['Reporting', `Mensuel, le ${mandate.reportingDay}`],
  ];
  return (
    <dl className={layout.facts}>
      {terms.map(([label, text]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATE = { CURRENT: ['En vigueur', 'success'], TO_COME: ['À venir', 'info'], ENDED: ['Clos', 'neutral'] } as const;

export function MandateVersions({ versions }: { versions: MandateVersion[] }) {
  return (
    <Tableau
      caption="Versions du mandat"
      rows={versions}
      rowId={(row) => row.id}
      columns={[
        {
          key: 'period',
          label: 'Période',
          render: (row) => (row.endsOn ? `Du ${formatDate(row.startsOn)} au ${formatDate(row.endsOn)}` : `Depuis le ${formatDate(row.startsOn)}`),
        },
        { key: 'amicable', label: 'Amiable', render: (row) => `${percentOf(row.amicableRateBp)} %` },
        { key: 'litigation', label: 'Judiciaire', render: (row) => `${percentOf(row.litigationRateBp)} %` },
        { key: 'document', label: 'Document', render: (row) => (row.hasContract ? 'Convention signée (PDF)' : 'À déposer') },
        { key: 'state', label: 'État', render: (row) => <Badge label={STATE[row.state][0]} tone={STATE[row.state][1]} /> },
      ]}
    />
  );
}
