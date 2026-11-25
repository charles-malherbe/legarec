import { formatCents, PORTAL_STATUS_LABELS, portalCases, portalStatus, type PortalCase, type PortalStatus } from '@legarec/contracts';
import { saveFile } from '@legarec/platform';
import { Badge, Bouton, EtatListe, Tableau, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import css from '../app/Portal.module.css';
import { useApi, usePartner } from '../app/data';

const TONES: Record<PortalStatus, Tone> = { NEW: 'neutral', REMINDING: 'info', PLAN: 'warning', LITIGATION: 'danger', SETTLED: 'success', LOST: 'neutral' };
const cell = (text: string) => `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
const toCsv = (items: PortalCase[]) =>
  [
    ['Débiteur', 'Référence', 'Confié', 'Recouvré', 'Statut'],
    ...items.map((item) => [item.debtor, item.reference, formatCents(item.entrusted), formatCents(item.recovered), PORTAL_STATUS_LABELS[item.status]]),
  ]
    .map((row) => row.map(cell).join(';'))
    .join('\r\n');

export function CasesPage() {
  const user = usePartner();
  const { data, error, refetch } = useApi(portalCases, '/portal/cases');
  const [params, setParams] = useSearchParams();
  const parsed = portalStatus.safeParse(params.get('statut'));
  const filter = parsed.success ? parsed.data : null;
  const [selected, setSelected] = useState<string | null>(null);
  const items = data?.items.filter((item) => !filter || item.status === filter) ?? [];
  const current = items.find((item) => item.id === selected) ?? items[0];
  const all = Object.values(data?.counts ?? {}).reduce((sum, count) => sum + count, 0);
  return (
    <>
      <div className={css.heading}>
        <div>
          <h1>Mes dossiers</h1>
          <p>Vous ne voyez que les dossiers de {user.creditor.name}.</p>
        </div>
        <Bouton
          variant="secondary"
          label="Exporter (CSV)"
          disabled={items.length === 0}
          onPress={() => saveFile(new Blob(['﻿', toCsv(items)], { type: 'text/csv;charset=utf-8' }), 'dossiers.csv')}
        />
      </div>
      {!data ? (
        <div className={css.panel}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      ) : (
        <>
          <div role="group" aria-label="Filtrer par statut" className={css.chips}>
            <button type="button" aria-pressed={!filter} onClick={() => setParams({})}>
              Tous <span>{all}</span>
            </button>
            {portalStatus.options.map((status) => (
              <button key={status} type="button" aria-pressed={filter === status} onClick={() => setParams({ statut: status })}>
                {PORTAL_STATUS_LABELS[status]} <span>{data.counts[status] ?? 0}</span>
              </button>
            ))}
          </div>
          {!current ? (
            <div className={css.panel}>
              <EtatListe kind="noresult" actionLabel="Voir tous les dossiers" onAction={() => setParams({})} />
            </div>
          ) : (
            <div className={css.split}>
              <section aria-label="Liste des dossiers" className={css.panel} data-flush>
                <Tableau
                  caption="Liste des dossiers"
                  hideCaption
                  bordered={false}
                  rows={items}
                  rowId={(row) => row.id}
                  activeRowId={current.id}
                  columns={[
                    {
                      key: 'debtor',
                      label: 'Débiteur',
                      render: (row) => (
                        <button type="button" className={css.pick} aria-pressed={row.id === current.id} onClick={() => setSelected(row.id)}>
                          {row.debtor}
                          <small>Réf. client {row.externalReference}</small>
                        </button>
                      ),
                    },
                    { key: 'entrusted', label: 'Confié', align: 'right', render: (row) => formatCents(row.entrusted) },
                    { key: 'recovered', label: 'Recouvré', align: 'right', render: (row) => formatCents(row.recovered) },
                    { key: 'status', label: 'Statut', render: (row) => <Badge label={PORTAL_STATUS_LABELS[row.status]} tone={TONES[row.status]} /> },
                    { key: 'last', label: 'Dernière action', render: (row) => row.last },
                  ]}
                />
              </section>
              <aside aria-label="Détail du dossier" className={css.panel}>
                <div>
                  <h2>{current.debtor}</h2>
                  <span className={css.hint}>
                    {current.reference} · {current.invoices}
                  </span>
                </div>
                <dl className={css.facts}>
                  <div>
                    <dt>Confié</dt>
                    <dd>{formatCents(current.entrusted)}</dd>
                  </div>
                  <div>
                    <dt>Recouvré</dt>
                    <dd>{formatCents(current.recovered)}</dd>
                  </div>
                </dl>
                <h2>Actions menées</h2>
                <ol className={css.steps}>
                  {current.steps.map((step) => (
                    <li key={step.title}>
                      {step.title}
                      <small>{step.date}</small>
                    </li>
                  ))}
                </ol>
                <Bouton variant="secondary" label="Écrire au gestionnaire à propos de ce dossier" href="/messages" />
              </aside>
            </div>
          )}
        </>
      )}
    </>
  );
}
