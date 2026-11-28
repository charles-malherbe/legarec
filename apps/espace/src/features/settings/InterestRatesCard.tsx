import { formatDate, interestRates, todayInParis } from '@legarec/contracts';
import { ecbRateOn } from '@legarec/platform';
import { Bouton, Carte, Champ, EtatListe, Tableau, useConfirm, useToast } from '@legarec/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

/**
 * Hors maquette (question 146) : taux saisis chaque semestre (question 75). Le taux de la BCE sert entre professionnels,
 * majoré de 10 points, quand le mandat ne prévoit pas de taux ; le taux légal sert aux particuliers, après la mise en demeure.
 */
const KINDS = [
  { value: 'ECB', label: 'Taux de la BCE (professionnels, + 10 points)' },
  { value: 'LEGAL_INDIVIDUAL', label: 'Taux légal (particuliers)' },
];
const KIND_LABELS: Record<string, string> = { ECB: 'Taux de la BCE', LEGAL_INDIVIDUAL: 'Taux légal (particuliers)' };
const percent = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
const semesterLabel = (day: string) => `${day.slice(5, 7) === '01' ? '1er' : '2d'} semestre ${day.slice(0, 4)}`;
/** The semester before, the current one (chosen first) and the next two. */
function semesters(today: string) {
  const year = Number(today.slice(0, 4));
  const current = Number(today.slice(5, 7)) <= 6 ? 0 : 1;
  return [-1, 0, 1, 2].map((step) => {
    const index = current + step;
    return `${year + Math.floor(index / 2)}-${((index % 2) + 2) % 2 === 0 ? '01' : '07'}-01`;
  });
}
/** `2,15` → 215 points de base; null when it is not a rate. */
const parseRate = (text: string) => {
  const match = /^(\d{1,2})(?:[,.](\d{1,2}))?\s*%?$/u.exec(text.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : null;
};

export function InterestRatesCard() {
  const { data, error, refetch } = useApi(interestRates, '/interest-rates');
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const choices = semesters(todayInParis());
  const [kind, setKind] = useState('ECB');
  const [semester, setSemester] = useState(choices[1] ?? '');
  const [rate, setRate] = useState('');
  const [problem, setProblem] = useState<string>();
  // The ECB publishes its rate: proposed for a semester begun, typed only once a person chose it.
  const begun = semester <= todayInParis();
  const published = useQuery({
    queryKey: ['ecb-rate', semester],
    queryFn: ({ signal }) => ecbRateOn(semester, signal),
    enabled: kind === 'ECB' && begun,
    staleTime: 60 * 60 * 1000,
  }).data;
  const proposal = kind === 'ECB' && begun ? published : null;
  const save = () => {
    const rateBp = parseRate(rate);
    if (rateBp === null || rateBp > 5000) {
      setProblem('Saisissez un taux, par exemple 2,15.');
      return;
    }
    setProblem(undefined);
    confirm({
      title: 'Enregistrer ce taux ?',
      body: 'Les intérêts des dossiers concernés sont recalculés avec ce taux.',
      details: [
        { k: 'Taux', v: KIND_LABELS[kind] ?? kind },
        { k: 'Semestre', v: semesterLabel(semester) },
        { k: 'Valeur', v: percent(rateBp) },
      ],
      confirmLabel: 'Enregistrer le taux',
      onConfirm: async () => {
        const shown = data?.items.find((item) => item.kind === kind && item.validFrom === semester)?.rateBp ?? null;
        await change('/interest-rates', { method: 'PUT', body: { kind, validFrom: semester, rateBp, expected: shown } });
        setRate('');
        toast({ message: 'Taux enregistré.' });
      },
    });
  };
  return (
    <Carte title="Taux d’intérêt" description="Publiés chaque semestre : à saisir par le Directeur." padding="none">
      {!data ? (
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      ) : (
        <div className={layout.stack}>
          {data.items.length === 0 ? (
            <EtatListe kind="empty" title="Aucun taux saisi" text="Sans taux, aucun intérêt n’est calculé pour le semestre." />
          ) : (
            <Tableau
              caption="Taux d’intérêt saisis"
              hideCaption
              bordered={false}
              rows={data.items}
              rowId={(row) => `${row.kind}-${row.validFrom}`}
              columns={[
                { key: 'semester', label: 'Semestre', render: (row) => semesterLabel(row.validFrom) },
                { key: 'kind', label: 'Taux', render: (row) => KIND_LABELS[row.kind] },
                { key: 'rate', label: 'Valeur', render: (row) => percent(row.rateBp) },
                { key: 'by', label: 'Saisi par', render: (row) => `${row.enteredBy} · ${formatDate(row.updatedAt)}` },
              ]}
            />
          )}
          {data.canEdit && (
            <div className={layout.inline} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Champ label="Taux" type="select" value={kind} options={KINDS} onChange={setKind} />
              <Champ
                label="Semestre"
                type="select"
                value={semester}
                options={choices.map((value) => ({ value, label: semesterLabel(value) }))}
                onChange={setSemester}
              />
              <Champ label="Valeur" value={rate} suffix="%" inputMode="decimal" placeholder="2,15" error={problem} onChange={setRate} />
              <Bouton label="Enregistrer le taux" onPress={save} />
            </div>
          )}
          {data.canEdit && proposal && (
            <p className={layout.hint}>
              Taux publié par la Banque centrale européenne, en vigueur au {formatDate(semester)} : {proposal.rate.toLocaleString('fr-FR')} % (depuis le{' '}
              {formatDate(proposal.since)}).{' '}
              <Bouton
                variant="link"
                size="sm"
                label="Reprendre ce taux"
                ariaLabel={`Reprendre le taux de ${proposal.rate.toLocaleString('fr-FR')} %`}
                onPress={() => setRate(proposal.rate.toLocaleString('fr-FR', { minimumFractionDigits: 2 }))}
              />
            </p>
          )}
        </div>
      )}
    </Carte>
  );
}
