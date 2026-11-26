import {
  AI_DECISION_LABELS,
  AI_FEATURE_LABELS,
  AI_JOURNAL_PAGE,
  AI_OUTCOME_LABELS,
  aiJournal,
  canAccessTechnicalSettings,
  formatDateTime,
  formatMicroEuros,
  type AiJournal,
  type AiJournalEntry,
} from '@legarec/contracts';
import { ApiError } from '@legarec/platform';
import { Badge, Carte, EtatListe, Pagination, Tableau } from '@legarec/ui';
import { useState } from 'react';
import { useApi } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';

type Tone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const DECISION_TONES: Record<AiJournalEntry['decision'], Tone> = {
  PENDING: 'neutral',
  ACCEPTED: 'success',
  MODIFIED: 'info',
  IGNORED: 'neutral',
  REPORTED: 'warning',
};
const OUTCOME_TONES: Record<Exclude<AiJournalEntry['outcome'], 'SUGGESTED'>, Tone> = {
  REFUSED_BY_GUARD: 'warning',
  FAILED: 'danger',
  OVER_BUDGET: 'warning',
};
const percent = (part: number, whole: number) => `${Math.round((part * 100) / whole)} %`;

/** « 30 derniers jours : 82 % acceptées telles quelles, 13 % modifiées, 5 % ignorées, 3 signalements. » */
export function journalSummary({ last30Days: days }: AiJournal): string {
  const decided = days.accepted + days.modified + days.ignored;
  if (decided === 0 && days.reported === 0) return '';
  const shares = decided
    ? `${percent(days.accepted, decided)} acceptées telles quelles, ${percent(days.modified, decided)} modifiées, ${percent(days.ignored, decided)} ignorées, `
    : '';
  return ` 30 derniers jours : ${shares}${days.reported} ${days.reported > 1 ? 'signalements' : 'signalement'}.`;
}

/**
 * The journal of the assistant (docs/ia.md): every suggestion with the decision taken, what was sent in short, the model,
 * the version of the prompt and the cost; never the suggestion itself. The Director and the Developer only; the API says
 * which case to whoever may read it.
 */
export function AiJournalCard({ title, description }: { title: string; description: string }) {
  const user = useCurrentUser();
  const allowed = canAccessTechnicalSettings(user);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(AI_JOURNAL_PAGE);
  const { data, error, refetch } = useApi(aiJournal, `/ai/journal?page=${page}&size=${size}`, { enabled: allowed });
  const refused = !allowed || (error instanceof ApiError && error.status === 403);
  return (
    <Carte title={title} description={data && !refused ? `${description}${journalSummary(data)}` : description} padding="none">
      {refused ? (
        <EtatListe kind="empty" title="Accès réservé" text="Le journal de l’IA est réservé au Directeur et au Développeur." />
      ) : !data ? (
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      ) : data.total === 0 ? (
        <EtatListe
          kind="empty"
          title="Aucune suggestion pour le moment"
          text="Chaque suggestion de l’IA apparaîtra ici avec la décision prise, dès que l’assistant sera activé."
        />
      ) : (
        <div className={layout.stack}>
          <Tableau
            caption={title}
            hideCaption
            bordered={false}
            tight
            rows={data.items}
            rowId={(row) => row.id}
            columns={[
              { key: 'date', label: 'Date', width: '120px', value: (row) => formatDateTime(row.at) },
              { key: 'fn', label: 'Fonction', value: (row) => AI_FEATURE_LABELS[row.feature] },
              { key: 'dossier', label: 'Dossier', width: '140px', value: (row) => row.caseReference ?? '—' },
              { key: 'user', label: 'Collaborateur', value: (row) => row.colleague ?? '—' },
              {
                key: 'decision',
                label: 'Décision',
                render: (row) =>
                  row.outcome === 'SUGGESTED' ? (
                    <Badge label={AI_DECISION_LABELS[row.decision]} tone={DECISION_TONES[row.decision]} />
                  ) : (
                    <Badge label={AI_OUTCOME_LABELS[row.outcome]} tone={OUTCOME_TONES[row.outcome]} />
                  ),
              },
              {
                key: 'sent',
                label: 'Entrée envoyée',
                width: '280px',
                value: (row) => ({ text: row.input, sub: `${row.model ?? 'Aucun modèle'} · ${row.promptVersion}` }),
              },
              { key: 'cost', label: 'Coût', align: 'right', value: (row) => formatMicroEuros(row.costMicro) },
            ]}
          />
          <Pagination
            label="Pages du journal de l’IA"
            unit="suggestions"
            total={data.total}
            page={page}
            size={size}
            onPage={setPage}
            onSize={(next) => {
              setSize(next);
              setPage(1);
            }}
          />
        </div>
      )}
    </Carte>
  );
}
