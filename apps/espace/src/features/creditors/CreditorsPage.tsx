import { creditorListItem, formatCents } from '@legarec/contracts';
import { Badge, EtatListe, Indicateur, PageHeader, Progression, Toolbar } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { useApi } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import { listState, matches } from '../../shared/listState';
import css from './Creditors.module.css';

const SORTS = [
  ['outstanding', 'Encours'],
  ['rate', 'Taux'],
  ['name', 'Nom'],
] as const;

export function CreditorsPage() {
  const user = useCurrentUser();
  const canCreate = user.role === 'DIRECTOR' || user.role === 'COLLECTION_MANAGER';
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('outstanding');
  const { data = [], isPending, error, refetch } = useApi(z.array(creditorListItem), '/creditors');
  const rows = data
    .filter((item) => matches(query, item.name, item.sector, item.siren))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'fr') : b[sort] - a[sort]));
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Aucun créancier',
    emptyText: 'Ajoutez un créancier pour lui confier des dossiers.',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });
  const sum = (key: 'debtors' | 'invoices' | 'outstanding' | 'recovered') => data.reduce((total, item) => total + item[key], 0);
  return (
    <>
      <PageHeader
        title="Créanciers"
        loading={isPending}
        statsLabel="Portefeuille des créanciers"
        description={
          isPending
            ? ' '
            : `${data.length} mandats actifs · ${sum('debtors')} débiteurs · ${sum('invoices').toLocaleString('fr-FR')} factures impayées confiées`
        }
        stats={[
          { label: 'Encours confié', value: formatCents(sum('outstanding')), sub: `${sum('invoices').toLocaleString('fr-FR')} factures` },
          { label: 'Recouvré en 2026', value: formatCents(sum('recovered')), sub: '55 % du montant confié', tone: 'success' },
          { label: 'Commission moyenne', value: '8 % HT', sub: 'sur les sommes encaissées' },
          {
            label: 'Conventions à renouveler',
            value: String(data.filter((item) => item.status === 'RENEWAL').length),
            sub: data.find((item) => item.status === 'RENEWAL')?.statusLabel ?? ' ',
            tone: 'warning',
          },
        ]}
        actions={[
          { label: 'Importer des créances', disabled: true },
          ...(canCreate ? [{ label: '+ Nouveau créancier', primary: true, kbd: 'N', href: '/creanciers/nouveau' }] : []),
        ]}
      />
      {data.length > 0 && (
        <>
          <div className={css.path}>
            {['Votre cabinet', `${data.length} créanciers`, `${sum('debtors')} débiteurs`, `${sum('invoices').toLocaleString('fr-FR')} factures`].map(
              (label, index) => (
                <span key={label} className={layout.inline}>
                  {index > 0 && (
                    <span aria-hidden className={layout.muted}>
                      →
                    </span>
                  )}
                  <span className={css.pathItem} data-rank={index}>
                    {label}
                  </span>
                </span>
              ),
            )}
          </div>
          <section aria-label="Indicateurs du portefeuille" className={css.kpis}>
            <Indicateur size="lg" label="Encours confié" value={formatCents(sum('outstanding'))} />
            <Indicateur size="lg" label="Recouvré en 2026" value={formatCents(sum('recovered'))} />
            <Indicateur size="lg" label="Honoraires facturés 2026" value={formatCents(13407000)} />
            <Indicateur size="lg" label="À reverser au 15 décembre" value={formatCents(8624000)} />
          </section>
        </>
      )}
      <Toolbar
        label="Filtrer les créanciers"
        placeholder="Rechercher un créancier, SIREN, secteur…"
        query={query}
        onQuery={setQuery}
        views={SORTS.map(([id, label]) => ({ label, selected: id === sort, pick: () => setSort(id) }))}
        note="Trier par"
      />
      {state ? (
        <div className={layout.card}>
          <EtatListe {...state} />
        </div>
      ) : (
        <section aria-label="Liste des créanciers" className={layout.grid}>
          {rows.map((item) => (
            <article key={item.id} className={css.card}>
              <div className={css.head}>
                <span aria-hidden className={layout.initials} data-dark>
                  {item.initials}
                </span>
                <span className={`${layout.text} ${layout.grow}`}>
                  <Link to={`/creanciers/${item.id}`} className={layout.strong}>
                    {item.name}
                  </Link>
                  <span className={layout.muted}>{item.sector}</span>
                </span>
                <Badge label={item.statusLabel} tone={item.status === 'ACTIVE' ? 'success' : 'warning'} />
              </div>
              <dl className={css.figures}>
                {(
                  [
                    ['Débiteurs', item.debtors],
                    ['Factures impayées', item.invoices],
                    ['Encours confié', formatCents(item.outstanding)],
                    ['Recouvré 2026', formatCents(item.recovered)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className={layout.tightStack}>
                <span className={layout.between}>
                  <span className={layout.muted}>Taux de recouvrement</span>
                  <strong className={layout.num}>{item.rate} %</strong>
                </span>
                <Progression value={item.rate} tone="marine" size="md" label={`Taux de recouvrement de ${item.name}`} />
              </div>
              <div className={css.foot}>
                <span className={layout.muted}>
                  Honoraires {item.fee} · {item.owner}
                </span>
                <Link to={`/creanciers/${item.id}`} className={layout.link} aria-label={`Portefeuille → ${item.name}`}>
                  Portefeuille →
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
