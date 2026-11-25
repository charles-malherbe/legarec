import { dashboard as dashboardSchema, formatCents, type CaseStatus, type Dashboard } from '@legarec/contracts';
import {
  Avatar,
  Badge,
  Bouton,
  Case,
  EtatListe,
  Icone,
  PageHeader,
  Progression,
  Statut,
  Tableau,
  Toolbar,
  useToast,
  type AvatarProps,
  type Tone,
} from '@legarec/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { api } from '../../app/api';
import { useCreditorScope } from '../../app/creditorScope';
import { useCurrentUser } from '../../app/session';
import css from './Dashboard.module.css';

export const STATUS_TONE: Record<CaseStatus, Tone> = {
  OVERDUE: 'danger',
  PROMISE: 'warning',
  REMINDER: 'info',
  DISPUTE: 'violet',
  SETTLED: 'success',
  PLAN: 'warning',
  FORMAL_NOTICE: 'danger',
  LITIGATION: 'danger',
};
const FEED: Record<Dashboard['feed'][number]['kind'], { symbol: string; tone: Tone }> = {
  PAYMENT: { symbol: '€', tone: 'success' },
  CALL: { symbol: '☎', tone: 'marine' },
  MESSAGE: { symbol: '@', tone: 'info' },
  APPROVAL: { symbol: '✓', tone: 'marine' },
  ALERT: { symbol: '!', tone: 'danger' },
  SYSTEM: { symbol: 'i', tone: 'neutral' },
};
const PRESENCE: Record<Dashboard['team'][number]['presence'], AvatarProps['presence']> = { available: 'dispo', call: 'call', pause: 'pause', away: 'off' };
const PERIODS = [
  ['week', 'Cette semaine'],
  ['month', 'Ce mois'],
  ['year', '2026'],
] as const;

export function DashboardPage() {
  const user = useCurrentUser();
  const scope = useCreditorScope();
  const client = useQueryClient();
  const toast = useToast();
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');
  const key = ['dashboard', scope.id];
  const { data, error, refetch, isPending } = useQuery({
    queryKey: key,
    queryFn: () => api(dashboardSchema, `/dashboard?creditor=${scope.id}`),
    enabled: user.role !== 'DEVELOPER',
  });
  const { data: shell } = useQuery<{ creditors: { id: string; name: string }[] }>({ queryKey: ['shell'], enabled: false });

  if (user.role === 'DEVELOPER') return <TechnicalHome firstName={user.firstName} />;
  const setDone = async (id: string, done: boolean) => {
    await api(z.undefined(), `/dashboard/priorities/${id}`, { method: 'PUT', body: { done } });
    await client.invalidateQueries({ queryKey: key });
  };
  const toggle = async (id: string, done: boolean) => {
    await setDone(id, done);
    toast({ message: done ? 'Priorité marquée comme faite.' : 'Priorité à refaire.', undo: () => void setDone(id, !done) });
  };
  const creditorName = shell?.creditors.find((item) => item.id === scope.id)?.name ?? 'Tous les créanciers';
  const scopeText = scope.id === 'all' ? 'tous les créanciers' : creditorName;
  const date = data ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' }).format(new Date(data.date)) : '';
  const current = data?.periods[period];
  const done = data?.priorities.filter((item) => item.done).length ?? 0;
  const portfolio = data ? { GLOBAL: 'chiffres du cabinet', TEAM: scopeText, PERSONAL: 'vos dossiers' }[data.scope] : scopeText;

  return (
    <>
      <PageHeader
        title={`Bonjour ${user.firstName}`}
        loading={isPending}
        description={data ? `${date.charAt(0).toUpperCase()}${date.slice(1)} · ${portfolio} · voici l'essentiel avant votre session d'appels` : ' '}
        statsLabel="Indicateurs clés"
        stats={[
          {
            label: 'Encours total',
            value: data ? formatCents(data.outstanding) : '',
            sub: data ? `${data.debtors} débiteurs · ${data.invoices.toLocaleString('fr-FR')} factures` : ' ',
          },
          { label: 'Échu à plus de 30 jours', value: data ? formatCents(data.overdue30) : '', tone: 'danger', sub: data?.overdue30Sub ?? ' ' },
          {
            label: 'Recouvré',
            value: current ? formatCents(current.recovered) : '',
            tone: 'success',
            bar: current?.targetRatio,
            barTone: 'or',
            sub: current?.recoveredSub ?? ' ',
          },
          {
            label: 'Factures recouvrées',
            value: data ? `${data.invoicesRecovered.toLocaleString('fr-FR')} / ${data.invoicesEntrusted.toLocaleString('fr-FR')}` : '',
            sub: data ? `${Math.round((data.invoicesRecovered / data.invoicesEntrusted) * 100)} % des factures confiées` : ' ',
          },
          { label: 'DSO moyen', value: data ? `${data.dsoDays} jours` : '', sub: data?.dsoSub ?? ' ' },
        ]}
        actions={[
          { label: 'Exporter', disabled: true },
          { label: 'Démarrer ma session d’appels', href: '/appels' },
          { label: '+ Nouveau dossier', primary: true, kbd: 'N', href: '/debiteurs' },
        ]}
      />
      <Toolbar
        label="Période"
        tabsLabel="Période"
        noSearch
        tabs={PERIODS.map(([id, label]) => ({ label, selected: id === period, pick: () => setPeriod(id) }))}
        scope={{ name: creditorName, onReset: scope.id === 'all' ? undefined : () => scope.setId('all') }}
        note={current?.note}
      />
      {error ? (
        <EtatListe kind="error" onAction={() => void refetch()} />
      ) : !data ? (
        <EtatListe kind="loading" count={6} />
      ) : (
        <>
          <div className={css.row}>
            <section aria-labelledby="actions-titre" className={css.card} data-grow="2">
              <div className={css.head}>
                <div>
                  <h2 id="actions-titre">Priorités du jour</h2>
                  <span className={css.sub}>Classées par montant et par urgence</span>
                </div>
                <div className={css.progress}>
                  <span>
                    {done} / {data.priorities.length} faites
                  </span>
                  <Progression
                    value={data.priorities.length ? (done / data.priorities.length) * 100 : 0}
                    tone="success"
                    size="md"
                    label="Priorités faites"
                    layout={{ width: 96 }}
                  />
                </div>
              </div>
              {data.priorities.length === 0 ? (
                <EtatListe kind="empty" title="Aucune priorité aujourd’hui" />
              ) : (
                <ul className={css.list}>
                  {data.priorities.map((item) => (
                    <li key={item.id} className={css.priority} data-done={item.done || undefined}>
                      <Case hideLabel label={`Marquer « ${item.title} » comme fait`} checked={item.done} onToggle={(next) => void toggle(item.id, next)} />
                      <span aria-hidden className={css.tile} data-tone={STATUS_TONE[item.tone]}>
                        <Icone icon={item.icon === 'check' ? 'check-circle' : item.icon} size={16} />
                      </span>
                      <div className={css.text}>
                        <span className={css.title}>{item.title}</span>
                        <span className={css.meta}>{item.meta}</span>
                      </div>
                      <span className={css.tag}>
                        <Badge label={item.tag} tone={STATUS_TONE[item.tone]} />
                      </span>
                      <Bouton variant="secondary" size="sm" label={item.cta} ariaLabel={`${item.cta} : ${item.title}`} href={item.href} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="flux-titre" className={css.card} data-grow="1">
              <div className={css.head}>
                <h2 id="flux-titre">En direct</h2>
                <Statut label="Mis à jour à l'instant" tone="success" />
              </div>
              <ol className={css.feed}>
                {data.feed.map((item) => (
                  <li key={item.id}>
                    <span aria-hidden className={css.symbol} data-tone={FEED[item.kind].tone}>
                      {FEED[item.kind].symbol}
                    </span>
                    <span className={css.text}>
                      <span className={css.feedText}>{item.text}</span>
                      <span className={css.hint}>{item.meta}</span>
                    </span>
                    <span className={css.hint}>{item.time}</span>
                  </li>
                ))}
              </ol>
              <Link to="/notifications" className={css.more}>
                Toutes les notifications →
              </Link>
            </section>
          </div>
          <div className={css.row}>
            <MonthlyChart data={data} />
            <section aria-labelledby="balance-titre" className={css.card} data-grow="1b" data-padded>
              <div>
                <h2 id="balance-titre">Balance âgée</h2>
                <span className={css.sub}>Encours de {formatCents(data.outstanding)} par ancienneté</span>
              </div>
              <div role="img" aria-label={data.aging.map((item) => `${item.label} ${item.percent} %`).join(', ')} className={css.stack}>
                {data.aging.map((item, index) => (
                  <span key={item.label} data-rank={index} style={{ width: `${item.percent}%` }} />
                ))}
              </div>
              <ul className={css.aging}>
                {data.aging.map((item, index) => (
                  <li key={item.label}>
                    <span aria-hidden className={css.swatch} data-rank={index} />
                    <span className={css.agingLabel}>{item.label}</span>
                    <span className={css.percent}>{item.percent} %</span>
                    <strong>{formatCents(item.amount)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className={css.row} data-top>
            <section aria-labelledby="mandants-titre" className={css.card} data-grow="3">
              <div className={css.head}>
                <h2 id="mandants-titre">Encours par créancier</h2>
                <Link to="/creanciers">Tous les créanciers →</Link>
              </div>
              <Tableau
                caption="Encours par créancier"
                hideCaption
                tight
                bordered={false}
                rows={data.creditors}
                rowId={(row) => row.id}
                columns={[
                  {
                    key: 'name',
                    label: 'Créancier',
                    render: (row) => (
                      <span className={css.text}>
                        <Link to={`/creanciers/${row.id}`} className={css.strong}>
                          {row.name}
                        </Link>
                        <span className={css.hint}>
                          SIREN {row.siren} · {row.sector}
                        </span>
                      </span>
                    ),
                  },
                  { key: 'debtors', label: 'Débiteurs', align: 'right', value: (row) => String(row.debtors) },
                  { key: 'invoices', label: 'Factures', align: 'right', value: (row) => String(row.invoices) },
                  { key: 'outstanding', label: 'Encours', align: 'right', value: (row) => ({ text: formatCents(row.outstanding), strong: true }) },
                  { key: 'recovered', label: 'Recouvré 2026', align: 'right', value: (row) => formatCents(row.recovered) },
                  {
                    key: 'rate',
                    label: 'Taux',
                    width: '180px',
                    render: (row) => <Progression value={row.rate} tone="marine" size="md" showValue label={`Taux de ${row.name}`} />,
                  },
                ]}
              />
            </section>
            <div className={css.column}>
              <section aria-labelledby="top-titre" className={css.card}>
                <div className={css.head}>
                  <h2 id="top-titre">Principaux débiteurs</h2>
                  <Link to="/debiteurs">Tous →</Link>
                </div>
                <ul className={css.list}>
                  {data.topDebtors.map((item) => (
                    <li key={item.id}>
                      <Link to={`/debiteurs/${item.id}`} className={css.debtor}>
                        <span className={css.text}>
                          <span className={css.strong}>{item.name}</span>
                          <span className={css.meta}>
                            {item.creditor} · SIRET {item.siret}
                          </span>
                        </span>
                        <span className={css.amount}>
                          <strong>{formatCents(item.amount)}</strong>
                          <Badge label={`${item.statusLabel} · ${item.daysLate} j`} tone={STATUS_TONE[item.status]} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
              {data.scope !== 'PERSONAL' && (
                <section aria-labelledby="team-titre" className={css.card}>
                  <div className={css.head}>
                    <h2 id="team-titre">Équipe aujourd&apos;hui</h2>
                    <Link to="/equipe">Suivi détaillé →</Link>
                  </div>
                  <ul className={css.team}>
                    {data.team.map((item) => (
                      <li key={item.id}>
                        <Avatar title={item.name} size={32} presence={PRESENCE[item.presence]} />
                        <span className={css.text}>
                          <span className={css.teamRow}>
                            <span>{item.name}</span>
                            <span className={css.hint}>{item.calls === null ? 'En congé' : `${item.calls} / ${item.target}`}</span>
                          </span>
                          <Progression
                            value={item.calls === null ? 0 : (item.calls / item.target) * 100}
                            tone={item.calls !== null && item.calls / item.target >= 0.75 ? 'success' : 'or'}
                            label={`Appels de ${item.name}`}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function MonthlyChart({ data }: { data: Dashboard }) {
  const max = Math.max(...data.months.map((item) => item.amount), data.monthlyTarget) * 1.075;
  const thousands = (value: number) => `${Math.round(value / 100_000)} k€`;
  const last = data.months.at(-1);
  const ratio = last ? Math.round((last.amount / data.monthlyTarget) * 100) : 0;
  return (
    <section aria-labelledby="mois-titre" className={css.card} data-grow="1.4" data-padded>
      <div className={css.chartHead}>
        <div>
          <h2 id="mois-titre">Montants recouvrés</h2>
          <span className={css.sub}>6 derniers mois · objectif mensuel {formatCents(data.monthlyTarget)}</span>
        </div>
        <span className={css.target}>Novembre : {ratio} % de l&apos;objectif</span>
      </div>
      <div
        role="img"
        aria-label={`Recouvré par mois : ${data.months.map((item) => `${item.label} ${thousands(item.amount)}`).join(', ')} ; objectif ${thousands(data.monthlyTarget)}`}
        className={css.chart}
      >
        <div className={css.targetLine} style={{ bottom: `${(data.monthlyTarget / max) * 80 + 12}%` }}>
          <span>Objectif {thousands(data.monthlyTarget)}</span>
        </div>
        {data.months.map((item, index) => (
          <div key={item.label} className={css.month}>
            <span className={css.value} data-last={index === data.months.length - 1 || undefined}>
              {thousands(item.amount)}
            </span>
            <span className={css.bar} data-last={index === data.months.length - 1 || undefined} style={{ height: `${(item.amount / max) * 80}%` }} />
            <span className={css.hint}>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Developer has no access to cases: no portfolio figure is requested nor shown. */
function TechnicalHome({ firstName }: { firstName: string }) {
  return (
    <>
      <PageHeader
        title={`Bonjour ${firstName}`}
        description="Administration technique et support des collaborateurs"
        actions={[{ label: 'Paramètres techniques', primary: true, href: '/parametres/techniques' }]}
      />
      <EtatListe
        kind="empty"
        title="Aucun dossier pour ce rôle"
        text="Votre rôle donne accès aux paramètres techniques, aux intégrations et au support des comptes."
      />
    </>
  );
}
