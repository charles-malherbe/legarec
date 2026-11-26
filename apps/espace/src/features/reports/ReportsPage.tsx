import { formatCents, reportsData, shellData } from '@legarec/contracts';
import { Avatar, Carte, EtatListe, Interrupteur, PageHeader, Progression, Tableau, Toolbar, useToast } from '@legarec/ui';
import { BarChart } from '@mantine/charts';
import '@mantine/charts/styles.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCreditorScope } from '../../app/creditorScope';
import { api } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

const PERIODS = [
  ['month', 'Mois'],
  ['quarter', 'Trimestre'],
  ['year', 'Année'],
] as const;
const OUTCOME = { success: 'success', teal: 'info', warning: 'warning', neutral: 'marine', danger: 'danger' } as const;

export function ReportsPage() {
  const scope = useCreditorScope();
  const change = useChange();
  const toast = useToast();
  const { data, isPending, error, refetch } = useApi(reportsData, `/reports?creditor=${scope.id}`);
  // Already read by the shell: the name of the creditor that is picked.
  const { data: shell } = useQuery({ queryKey: ['shell'], queryFn: () => api(shellData, '/shell'), enabled: false });
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('year');
  const current = data?.periods[period];
  const bars = current?.bars.filter((item) => item.entrusted > 0) ?? [];
  const thousands = (value: number) => `${Math.round(value / 100_000)} k€`;
  const toggle = async (id: string, active: boolean) => {
    await change(`/reports/scheduled/${id}`, { method: 'PUT', body: { active } });
    toast({
      message: active ? 'Rapport programmé activé.' : 'Rapport programmé désactivé.',
      undo: () => void change(`/reports/scheduled/${id}`, { method: 'PUT', body: { active: !active } }),
    });
  };
  return (
    <>
      <PageHeader
        title="Rapports"
        loading={isPending}
        description={current ? `${current.text} · ${data.scope === 'PERSONAL' ? 'vos dossiers' : 'tous créanciers'}` : ' '}
        statsLabel="Indicateurs de la période"
        stats={(current?.kpis ?? []).map((item) => ({
          label: item.label,
          value: item.value,
          sub: item.delta,
          tone: item.tone === 'bad' ? 'danger' : 'default',
        }))}
        actions={[
          { label: 'Exporter Excel', disabled: true },
          { label: 'Générer le PDF', primary: true, kbd: 'N', disabled: true },
        ]}
      />
      <Toolbar
        label="Période et créancier"
        tabsLabel="Période"
        noSearch
        tabs={PERIODS.map(([id, label]) => ({ label, selected: id === period, pick: () => setPeriod(id) }))}
        scope={{
          name: scope.id === 'all' ? 'Tous les créanciers' : (shell?.creditors.find((item) => item.id === scope.id)?.name ?? 'Créancier'),
          onReset: scope.id === 'all' ? undefined : () => scope.setId('all'),
        }}
      />
      {error || !data ? (
        <div className={layout.card}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      ) : (
        <>
          <div className={layout.columns}>
            <div className={layout.wide}>
              <Carte title="Créances confiées et montants recouvrés">
                <div
                  role="img"
                  aria-label={`Confié et recouvré en milliers d’euros : ${bars.map((item) => `${item.label} ${thousands(item.entrusted)} et ${thousands(item.recovered)}`).join(', ')}`}
                >
                  <BarChart
                    h={240}
                    data={(current?.bars ?? []).map((item) => ({ label: item.label, Confié: item.entrusted / 100, Recouvré: item.recovered / 100 }))}
                    dataKey="label"
                    series={[
                      { name: 'Confié', color: 'var(--data-1)' },
                      { name: 'Recouvré', color: 'var(--marine)' },
                    ]}
                    withLegend
                    legendProps={{ verticalAlign: 'top' }}
                    gridAxis="y"
                    tickLine="none"
                    valueFormatter={(value) => `${Math.round(value / 1000)} k€`}
                    barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
                    textColor="var(--text-2)"
                    gridColor="var(--border)"
                  />
                </div>
              </Carte>
            </div>
            <aside className={layout.aside} aria-label="Issue des dossiers">
              <Carte title="Issue des dossiers clos">
                <div className={layout.stack}>
                  {data.outcomes.map((item) => (
                    <div key={item.label} className={layout.tightStack}>
                      <span className={layout.between}>
                        <span>{item.label}</span>
                        <strong className={layout.num}>{item.percent} %</strong>
                      </span>
                      <Progression value={item.percent} tone={OUTCOME[item.tone]} size="md" label={item.label} />
                    </div>
                  ))}
                  {data.promisesKept !== null && (
                    <p className={layout.body}>
                      Promesses de paiement tenues : <strong>{data.promisesKept} %</strong>
                    </p>
                  )}
                </div>
              </Carte>
            </aside>
          </div>
          <div className={layout.columns}>
            {data.team.length > 0 && (
              <div className={layout.wide}>
                <Carte title={data.scope === 'PERSONAL' ? 'Vos résultats' : 'Performance des gestionnaires'} padding="none">
                  <Tableau
                    caption="Performance des gestionnaires"
                    hideCaption
                    bordered={false}
                    rows={data.team}
                    rowId={(row) => row.id}
                    columns={[
                      {
                        key: 'name',
                        label: 'Gestionnaire',
                        render: (row) => (
                          <span className={layout.inline}>
                            <Avatar title={row.name} size={32} />
                            <strong>{row.name}</strong>
                          </span>
                        ),
                      },
                      { key: 'cases', label: 'Dossiers', align: 'right', sortValue: (row) => row.cases, value: (row) => String(row.cases) },
                      // Unknown while the telephony is not connected: a dash, not a zero.
                      {
                        key: 'calls',
                        label: 'Appels',
                        align: 'right',
                        sortValue: (row) => row.calls ?? -1,
                        value: (row) => (row.calls === null ? '—' : String(row.calls)),
                      },
                      { key: 'promises', label: 'Promesses', align: 'right', value: (row) => (row.promises === null ? '—' : String(row.promises)) },
                      {
                        key: 'recovered',
                        label: 'Recouvré',
                        align: 'right',
                        sortValue: (row) => row.recovered,
                        value: (row) => ({ text: formatCents(row.recovered), strong: true }),
                      },
                      { key: 'rate', label: 'Taux', align: 'right', value: (row) => `${row.rate} %` },
                    ]}
                  />
                </Carte>
              </div>
            )}
            {data.scheduled.length > 0 && (
              <aside className={layout.aside} aria-label="Rapports programmés">
                <Carte title="Rapports programmés" padding="none">
                  <ul className={layout.list}>
                    {data.scheduled.map((item) => (
                      <li key={item.id}>
                        <span className={`${layout.text} ${layout.grow}`}>
                          <strong className={layout.strong}>{item.title}</strong>
                          <span className={layout.hint}>{item.meta}</span>
                        </span>
                        <Interrupteur label={`Activer le rapport ${item.title}`} checked={item.active} onToggle={(next) => void toggle(item.id, next)} />
                      </li>
                    ))}
                  </ul>
                </Carte>
              </aside>
            )}
          </div>
        </>
      )}
    </>
  );
}
