import { formatCents, teamData, type Agent } from '@legarec/contracts';
import { Avatar, Badge, Bouton, Carte, EtatListe, PageHeader, Pagination, Progression, Tableau, Toolbar, type AvatarProps, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '../../shared/layout.module.css';
import { listState, matches } from '../../shared/listState';
import { MembersCard } from './MembersCard';
import css from './Team.module.css';

const PRESENCE: Record<Agent['presence'], { avatar: AvatarProps['presence']; tone: Tone }> = {
  CALL: { avatar: 'call', tone: 'success' },
  AVAILABLE: { avatar: 'dispo', tone: 'info' },
  PAUSE: { avatar: 'pause', tone: 'warning' },
  AWAY: { avatar: 'off', tone: 'neutral' },
};
const PERIODS = [
  ['day', 'Aujourd’hui', 'Aujourd’hui, samedi 21 novembre'],
  ['week', '7 jours', '7 derniers jours'],
  ['month', '30 jours', '30 derniers jours'],
] as const;

export function TeamPage() {
  const user = useCurrentUser();
  // The Developer supports accounts but sees neither activity nor calls.
  if (user.role === 'DEVELOPER')
    return (
      <>
        <PageHeader title="Équipe" description="Comptes des collaborateurs et postes 3CX" />
        <MembersCard />
      </>
    );
  return <Activity />;
}

function Activity() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('day');
  const { data, isPending, error, refetch } = useApi(teamData, `/team?period=${period}`);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('cl');
  const [who, setWho] = useState('all');
  const [playing, setPlaying] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const agents = data?.agents ?? [];
  const current = agents.find((item) => item.id === selected) ?? agents[0];
  const total = (key: 'calls' | 'goal' | 'reached' | 'promises' | 'promisedAmount' | 'cashed') => agents.reduce((sum, item) => sum + item[key], 0);
  const calls = (data?.calls ?? []).filter(
    (item) => (who === 'all' || item.agentId === who) && matches(query, item.agent, item.debtor, item.creditor, item.siret),
  );
  const state = listState({
    pending: isPending,
    error,
    count: calls.length,
    query,
    empty: 'Aucun appel',
    emptyText: 'Aucun appel passé sur la période pour ce gestionnaire.',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro SIRET, SIREN ou de facture.',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });
  const online = agents.filter((item) => item.presence !== 'AWAY').length;
  const peak = Math.max(1, ...(current?.hours ?? [1]));
  return (
    <>
      <PageHeader
        title="Équipe"
        loading={isPending}
        description="Activité des gestionnaires et appels passés · réservé aux responsables et à la direction"
        status={data && { label: `${online} gestionnaires en ligne sur ${agents.length}`, tone: 'success' }}
        statsLabel="Activité de l'équipe"
        stats={[
          {
            label: 'Appels passés',
            value: data ? `${total('calls').toLocaleString('fr-FR')} / ${total('goal').toLocaleString('fr-FR')}` : '',
            bar: data ? (total('calls') / Math.max(1, total('goal'))) * 100 : 0,
            barTone: 'marine',
            sub: 'objectif de l’équipe',
          },
          {
            label: 'Taux de joignabilité',
            value: data ? `${Math.round((total('reached') / Math.max(1, total('calls'))) * 100)} %` : '',
            sub: `${total('reached')} débiteurs joints`,
          },
          { label: 'Promesses obtenues', value: data ? `${total('promises')} · ${formatCents(total('promisedAmount'))}` : '', sub: '78 % tenues sur 30 jours' },
          { label: 'Encaissé', value: data ? formatCents(total('cashed')) : '', sub: 'paiements reçus sur la période', tone: 'success' },
          { label: 'Durée moyenne', value: '4 min 05', sub: 'par appel abouti' },
        ]}
        actions={[
          { label: 'Exporter le rapport', disabled: true },
          { label: 'Objectifs de l’équipe', primary: true, kbd: 'N', href: '/parametres' },
        ]}
      />
      <Toolbar
        label="Période et filtres"
        tabsLabel="Période"
        placeholder="Gestionnaire, débiteur, SIRET…"
        query={query}
        onQuery={setQuery}
        tabs={PERIODS.map(([id, label]) => ({ label, selected: id === period, pick: () => setPeriod(id) }))}
      />
      {!data ? (
        <div className={layout.card}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      ) : (
        <div className={layout.columns}>
          <div className={layout.wide}>
            <Carte
              title="Gestionnaires"
              description={`${PERIODS.find(([id]) => id === period)?.[2]} · cliquez sur une ligne pour le détail`}
              padding="none"
              footer="Statuts et appels synchronisés avec 3CX. Les gestionnaires sont informés de ce suivi (article L1222-4 du Code du travail). Enregistrements d'appels : accès réservé aux responsables, conservation 6 mois."
            >
              <Tableau
                caption="Gestionnaires"
                hideCaption
                tight
                bordered={false}
                rows={agents}
                rowId={(row) => row.id}
                activeRowId={current?.id}
                columns={[
                  {
                    key: 'name',
                    label: 'Gestionnaire',
                    render: (row) => (
                      <button
                        type="button"
                        aria-pressed={row.id === current?.id}
                        className={css.pick}
                        onClick={() => {
                          setSelected(row.id);
                          setWho(row.id);
                        }}
                      >
                        <Avatar title={row.name} size={32} />
                        <span className={layout.text}>
                          <span className={layout.strong}>{row.name}</span>
                          <span className={layout.hint}>{row.scope}</span>
                        </span>
                      </button>
                    ),
                  },
                  { key: 'status', label: 'Statut', render: (row) => <Badge label={row.status} tone={PRESENCE[row.presence].tone} dot /> },
                  {
                    key: 'calls',
                    label: 'Appels passés',
                    render: (row) => (
                      <span className={layout.tightStack}>
                        <Progression
                          value={row.goal ? (row.calls / row.goal) * 100 : 0}
                          tone={row.goal && row.calls / row.goal >= 0.7 ? 'success' : 'or'}
                          size="md"
                          label={`Appels de ${row.name}`}
                        />
                        <span className={layout.hint}>
                          {row.goal ? `${row.calls.toLocaleString('fr-FR')} / ${row.goal.toLocaleString('fr-FR')}` : 'Absent'}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'reached',
                    label: 'Joints',
                    align: 'right',
                    value: (row) => (row.calls ? `${row.reached} · ${Math.round((row.reached / row.calls) * 100)} %` : '—'),
                  },
                  {
                    key: 'promises',
                    label: 'Promesses',
                    align: 'right',
                    value: (row) => (row.promises ? `${row.promises} · ${formatCents(row.promisedAmount)}` : '—'),
                  },
                  { key: 'cashed', label: 'Encaissé', align: 'right', value: (row) => (row.cashed ? formatCents(row.cashed) : '—') },
                  { key: 'average', label: 'Durée moy.', align: 'right', value: (row) => row.average },
                ]}
              />
            </Carte>
          </div>
          <aside className={layout.aside} aria-label="Détail du gestionnaire">
            {current && (
              <Carte
                title={current.name}
                description={`${current.roleLabel} · ${current.scope}`}
                badge={current.status}
                badgeTone={PRESENCE[current.presence].tone}
              >
                <div className={layout.stack}>
                  {current.live && <p className={layout.body}>{current.live}</p>}
                  <div className={layout.tightStack}>
                    <span className={layout.between}>
                      <span>Objectif d&apos;appels</span>
                      <strong className={layout.num}>{current.goal ? `${current.calls} / ${current.goal}` : 'Absent'}</strong>
                    </span>
                    <Progression value={current.goal ? (current.calls / current.goal) * 100 : 0} tone="marine" size="md" label="Objectif d'appels" />
                  </div>
                  <div
                    role="img"
                    aria-label={`Appels par heure de ${current.name}, de 8 h à 18 h : ${current.hours.map((value, index) => `${8 + index} h ${value}`).join(', ')}`}
                  >
                    <span className={layout.muted}>Appels par heure</span>
                    <div className={css.hours}>
                      {current.hours.map((value, index) => (
                        <span key={index}>
                          <i style={{ height: `${(value / peak) * 100}%` }} />
                          <small>{8 + index}</small>
                        </span>
                      ))}
                    </div>
                  </div>
                  <dl className={layout.facts}>
                    <div>
                      <dt>Portefeuille suivi</dt>
                      <dd>{current.book}</dd>
                    </div>
                    <div>
                      <dt>Promesses tenues (30 j)</dt>
                      <dd>{current.kept} %</dd>
                    </div>
                    <div>
                      <dt>Première connexion</dt>
                      <dd>{current.login}</dd>
                    </div>
                    <div>
                      <dt>Temps en pause</dt>
                      <dd>{current.pause}</dd>
                    </div>
                  </dl>
                </div>
              </Carte>
            )}
            <Carte title="Points d'attention" padding="none">
              <ul className={layout.list}>
                {data.alerts.map((text) => (
                  <li key={text}>
                    <span aria-hidden className={layout.dot} data-tone="warning" />
                    <span className={layout.grow}>{text}</span>
                  </li>
                ))}
              </ul>
            </Carte>
          </aside>
        </div>
      )}
      <Carte
        title="Appels passés"
        description={`${calls.length} appel${calls.length > 1 ? 's' : ''} · ${who === 'all' ? 'toute l’équipe' : agents.find((item) => item.id === who)?.name} · aujourd’hui`}
        padding="none"
      >
        <div role="group" aria-label="Gestionnaire affiché" className={layout.chips} style={{ padding: 'var(--sp-3) var(--sp-5)' }}>
          {[{ id: 'all', name: 'Tous' }, ...agents.filter((item) => item.calls)].map((item) => (
            <button key={item.id} type="button" className={layout.chip} aria-pressed={who === item.id} onClick={() => setWho(item.id)}>
              {item.name.split(' ')[0]}
            </button>
          ))}
        </div>
        <Tableau
          caption="Appels passés"
          hideCaption
          tight
          bordered={false}
          rows={calls}
          rowId={(row) => row.id}
          state={state}
          columns={[
            { key: 'time', label: 'Heure', value: (row) => row.time },
            { key: 'agent', label: 'Gestionnaire', value: (row) => row.agent },
            {
              key: 'debtor',
              label: 'Débiteur',
              render: (row) => (
                <span className={layout.text}>
                  {row.caseId ? (
                    <Link to={`/debiteurs/${row.caseId}`} className={layout.strong}>
                      {row.debtor}
                    </Link>
                  ) : (
                    <strong className={layout.strong}>{row.debtor}</strong>
                  )}
                  <span className={layout.hint}>
                    {row.creditor} · SIRET {row.siret}
                  </span>
                </span>
              ),
            },
            { key: 'direction', label: 'Sens', value: (row) => (row.direction === 'OUT' ? 'Sortant' : 'Entrant') },
            { key: 'duration', label: 'Durée', align: 'right', value: (row) => row.duration },
            { key: 'result', label: 'Résultat', render: (row) => <Badge label={row.result} tone={row.tone} /> },
            {
              key: 'recording',
              label: 'Enregistrement',
              render: (row) =>
                row.recording === 'AVAILABLE' ? (
                  <Bouton
                    variant="secondary"
                    size="sm"
                    icon={playing === row.id ? 'pause' : 'play'}
                    label={playing === row.id ? 'Pause' : 'Écouter'}
                    ariaLabel={`${playing === row.id ? 'Pause' : 'Écouter'} : appel ${row.time}, ${row.debtor}`}
                    pressed={playing === row.id}
                    onPress={() => setPlaying(playing === row.id ? null : row.id)}
                  />
                ) : (
                  <span className={layout.hint}>{row.recording === 'LIVE' ? 'Disponible après l’appel' : 'Non enregistré (refus ou messagerie)'}</span>
                ),
            },
          ]}
        />
        {!state && data && (
          <Pagination
            total={query || who !== 'all' ? calls.length : data.callsTotal}
            page={page}
            size={size}
            unit="appels"
            label="Pagination des appels"
            onPage={setPage}
            onSize={setSize}
          />
        )}
      </Carte>
      <MembersCard />
    </>
  );
}
