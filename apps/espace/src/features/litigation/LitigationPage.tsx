import { formatCents, LITIGATION_STAGES, litigationData, type LitigationCase } from '@legarec/contracts';
import { Badge, Bouton, Carte, EtatListe, PageHeader, Pagination, Tableau, Toolbar, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import { listState, matches } from '../../shared/listState';
import css from './Litigation.module.css';

const PARTNERS = ['Tous les partenaires', 'Me Durieux', 'Me Roche', 'Étude Garnier'];
const day = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options }).format(new Date(iso));

export function LitigationPage() {
  const scope = useCreditorScope();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, isPending, error, refetch } = useApi(litigationData, '/litigation');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState(-1);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [partner, setPartner] = useState(PARTNERS[0] ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const rows = (data?.cases ?? []).filter(
    (item) =>
      (stage < 0 || item.stage === stage) &&
      (scope.id === 'all' || item.creditorId === scope.id) &&
      (partner === PARTNERS[0] || item.partner.startsWith(partner)) &&
      matches(query, item.debtor, item.siret, item.court, item.creditor, item.procedure),
  );
  const current = data?.cases.find((item) => item.id === selected) ?? rows[0];
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Aucune procédure en cours',
    emptyText: 'Les dossiers passés en contentieux apparaissent ici.',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro SIRET, SIREN ou de facture.',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });
  const act = (item: LitigationCase) =>
    confirm({
      title: `${item.action} ?`,
      body: `Cette étape engage des frais de procédure et sera visible par ${item.creditor} dans son espace. Vérifiez que l’accord du créancier couvre cette étape.`,
      confirmLabel: 'Confirmer et envoyer',
      details: [
        { k: 'Débiteur', v: `${item.debtor} · SIRET ${item.siret}` },
        { k: 'Montant', v: formatCents(item.amount) },
        { k: 'Procédure', v: item.procedure },
        { k: 'Partenaire', v: item.partner },
      ],
      onConfirm: async () => {
        await change(`/litigation/${item.id}/action`);
        toast({ message: 'Demande envoyée.' });
      },
    });
  const s = data?.stats;
  const stages = LITIGATION_STAGES.map((item, index) => ({
    ...item,
    index,
    count: data?.stageTotals[index]?.count ?? 0,
    amount: data?.stageTotals[index]?.amount ?? 0,
  })).filter((item) => stage < 0 || item.index === stage);
  return (
    <>
      <PageHeader
        title="Contentieux"
        loading={isPending}
        statsLabel="Indicateurs du contentieux"
        description={s ? `${s.count} dossiers en phase judiciaire · ${formatCents(s.amount)} · tous créanciers` : ' '}
        stats={[
          { label: 'Montant en contentieux', value: s ? formatCents(s.amount) : '', sub: s ? `${s.count} dossiers` : ' ' },
          { label: 'Frais de procédure avancés', value: s ? formatCents(s.advancedFees) : '', sub: 'à la charge du créancier sauf décision du juge' },
          { label: 'Titres exécutoires (2026)', value: String(s?.titles ?? ''), sub: '▲ 4 sur un an', tone: 'success' },
          { label: 'En attente d’accord créancier', value: String(s?.waiting ?? ''), sub: 'avant engagement de frais', tone: 'warning' },
          { label: 'Délais sous 15 jours', value: String(s?.soon ?? ''), sub: 'dont 2 urgents', tone: 'danger' },
        ]}
        actions={[
          { label: 'Partenaires (avocats, commissaires)', disabled: true },
          { label: '+ Transférer un dossier', primary: true, kbd: 'N', href: '/debiteurs' },
        ]}
      />
      <Toolbar
        label="Filtrer les procédures"
        tabsLabel="Étape de la procédure"
        placeholder="Débiteur, SIRET, juridiction…"
        query={query}
        onQuery={setQuery}
        tabs={[
          { label: 'Toutes', count: s?.count ?? '', selected: stage < 0, pick: () => setStage(-1) },
          ...LITIGATION_STAGES.map((item, index) => ({
            label: item.label,
            count: data?.stageTotals[index]?.count ?? '',
            selected: stage === index,
            pick: () => setStage(index),
          })),
        ]}
        scope={{
          name: scope.id === 'all' ? 'Tous les créanciers' : (rows[0]?.creditor ?? 'Créancier'),
          onReset: scope.id === 'all' ? undefined : () => scope.setId('all'),
        }}
        filters={[{ label: 'Partenaire', value: partner, options: PARTNERS, onChange: setPartner }]}
        views={[
          { label: 'Tableau', selected: view === 'board', pick: () => setView('board') },
          { label: 'Liste', selected: view === 'list', pick: () => setView('list') },
        ]}
      />
      {view === 'board' ? (
        <Carte title="Avancement des procédures" description="Sélectionnez un dossier pour afficher ses actes ci-dessous" padding="none">
          {state ? (
            <EtatListe {...state} />
          ) : (
            <div className={css.scroll} tabIndex={0} role="group" aria-label="Étapes de la procédure">
              <div className={css.board} data-single={stage >= 0 || undefined}>
                {stages.map((item) => {
                  const cards = rows.filter((row) => row.stage === item.index);
                  return (
                    <div key={item.label} className={css.column}>
                      <div className={css.columnHead} data-stage={item.index}>
                        <span className={layout.between}>
                          <strong>{item.label}</strong>
                          <Badge label={String(item.count)} />
                        </span>
                        <span className={layout.hint}>
                          {formatCents(item.amount)} · {item.hint}
                        </span>
                      </div>
                      {cards.map((row) => (
                        <button key={row.id} type="button" className={css.card} aria-pressed={row.id === current?.id} onClick={() => setSelected(row.id)}>
                          <span className={layout.between}>
                            <strong>{row.debtor}</strong>
                            <strong className={layout.num}>{formatCents(row.amount)}</strong>
                          </span>
                          <span className={layout.hint}>{row.creditor}</span>
                          <span>{row.step}</span>
                          <Badge
                            label={row.due}
                            tone={row.urgent ? 'danger' : 'neutral'}
                            icon="clock"
                            layout={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}
                          />
                        </button>
                      ))}
                      {stage < 0 && item.count > cards.length && !query && (
                        <Bouton
                          variant="link"
                          size="sm"
                          label={`+ ${item.count - cards.length} autres dossiers`}
                          ariaLabel={`+ ${item.count - cards.length} autres dossiers : ${item.label}`}
                          onPress={() => setStage(item.index)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Carte>
      ) : (
        <Carte title="Procédures" description={`${rows.length} dossiers`} padding="none">
          <Tableau
            caption="Procédures"
            hideCaption
            tight
            bordered={false}
            rows={rows}
            rowId={(row) => row.id}
            activeRowId={current?.id}
            state={state}
            columns={[
              {
                key: 'debtor',
                label: 'Débiteur',
                render: (row) => (
                  <button type="button" aria-pressed={row.id === current?.id} className={css.rowButton} onClick={() => setSelected(row.id)}>
                    <span className={layout.strong}>{row.debtor}</span>
                    <span className={layout.hint}>
                      {row.creditor} · SIRET {row.siret}
                    </span>
                  </button>
                ),
              },
              { key: 'procedure', label: 'Procédure', value: (row) => row.procedure },
              { key: 'step', label: 'Étape actuelle', value: (row) => row.step },
              { key: 'due', label: 'Échéance', render: (row) => <span className={row.urgent ? layout.danger : undefined}>{row.due}</span> },
              {
                key: 'amount',
                label: 'Montant',
                align: 'right',
                sortValue: (row) => row.amount,
                value: (row) => ({ text: formatCents(row.amount), strong: true }),
              },
            ]}
          />
          {!state && s && (
            <Pagination
              total={stage < 0 && !query ? s.count : rows.length}
              page={page}
              size={size}
              unit="procédures"
              label="Pagination des procédures"
              onPage={setPage}
              onSize={setSize}
            />
          )}
        </Carte>
      )}
      {current && data && (
        <div className={layout.columns}>
          <div className={layout.wide}>
            <Carte
              title={current.debtor}
              description={`${current.procedure} · SIRET ${current.siret}`}
              actionLabel="Ouvrir le dossier"
              actionIcon="arrow-right"
              actionHref={`/debiteurs/${current.id}`}
            >
              <div className={layout.stack}>
                <dl className={css.facts}>
                  <div>
                    <dt>Créancier</dt>
                    <dd>{current.creditor}</dd>
                  </div>
                  <div>
                    <dt>Montant</dt>
                    <dd>{formatCents(current.amount)}</dd>
                  </div>
                  <div>
                    <dt>Juridiction</dt>
                    <dd>{current.court}</dd>
                  </div>
                  <div>
                    <dt>Partenaire</dt>
                    <dd>{current.partner}</dd>
                  </div>
                </dl>
                <h3 className={css.subtitle}>Actes de la procédure</h3>
                <ol className={layout.timeline}>
                  {current.acts.map((act_) => (
                    <li key={act_.title}>
                      <span aria-hidden className={layout.dot} data-tone={act_.state === 'DONE' ? 'success' : act_.state === 'NOW' ? 'info' : undefined} />
                      <span className={layout.text}>
                        <span className={layout.inline}>
                          <strong className={layout.strong}>{act_.title}</strong>
                          {act_.state === 'NOW' && <Badge label="En cours" tone="marine" />}
                        </span>
                        <span className={layout.hint}>{act_.date}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                {current.canAct && (
                  <div className={layout.inline}>
                    <Bouton label={current.actionSent ? 'Demande envoyée ✓' : current.action} disabled={current.actionSent} onPress={() => act(current)} />
                    <Bouton variant="secondary" label="Ajouter un acte" disabled />
                    <Bouton variant="secondary" label="Informer le créancier" disabled />
                  </div>
                )}
              </div>
            </Carte>
          </div>
          <aside className={layout.aside} aria-label="Délais">
            <Carte title="Délais à surveiller" description="15 prochains jours · délais légaux et échéances" padding="none">
              {data.deadlines.map((item) => (
                <button
                  key={item.caseId}
                  type="button"
                  className={layout.rowButton}
                  aria-current={item.caseId === current.id}
                  onClick={() => setSelected(item.caseId)}
                >
                  <span className={css.date} data-tone={item.tone}>
                    <strong>{day(item.date, { day: '2-digit' })}</strong>
                    <span>{day(item.date, { month: 'short' })}</span>
                  </span>
                  <span className={layout.text}>
                    <strong className={layout.strong}>{item.title}</strong>
                    <span className={layout.hint}>{item.who}</span>
                  </span>
                </button>
              ))}
            </Carte>
          </aside>
        </div>
      )}
    </>
  );
}
