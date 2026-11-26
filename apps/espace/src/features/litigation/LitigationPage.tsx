import { formatCents, formatDate, LITIGATION_STAGES, litigationData, type LitigationCase } from '@legarec/contracts';
import { Badge, Bouton, Carte, Champ, EtatListe, PageHeader, Pagination, Tableau, Toolbar, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import { pageOf } from '../../shared/paging';
import { listState, matches } from '../../shared/listState';
import css from './Litigation.module.css';

const ALL_PARTNERS = 'Tous les intervenants';
const OUTCOMES = { SETTLED: 'Recouvré', LOST: 'Irrécouvrable' } as const;

/** Court and partner, typed freely by whoever acts on the case; remounted when the file changes. */
function FollowUp({ item, onSave }: { item: LitigationCase; onSave: (court: string, partnerName: string) => Promise<void> }) {
  const [court, setCourt] = useState(item.court);
  const [partnerName, setPartnerName] = useState(item.partnerName);
  const [saving, setSaving] = useState(false);
  const unchanged = court.trim() === item.court && partnerName.trim() === item.partnerName;
  return (
    <form
      className={css.followUp}
      onSubmit={(event) => {
        event.preventDefault();
        if (unchanged || saving) return;
        setSaving(true);
        void onSave(court.trim(), partnerName.trim()).finally(() => setSaving(false));
      }}
    >
      <Champ label="Juridiction" value={court} maxLength={200} optional onChange={setCourt} />
      <Champ label="Intervenant" value={partnerName} maxLength={200} optional help="Avocat ou commissaire de justice" onChange={setPartnerName} />
      <Bouton type="submit" variant="secondary" label="Enregistrer" loading={saving} disabled={unchanged} />
    </form>
  );
}

export function LitigationPage() {
  const scope = useCreditorScope();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, isPending, error, refetch } = useApi(litigationData, '/litigation');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState(-1);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [partner, setPartner] = useState(ALL_PARTNERS);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const partners = [ALL_PARTNERS, ...[...new Set((data?.cases ?? []).map((item) => item.partnerName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'))];
  const rows = (data?.cases ?? []).filter(
    (item) =>
      (stage < 0 || item.stage === stage) &&
      (scope.id === 'all' || item.creditorId === scope.id) &&
      (partner === ALL_PARTNERS || item.partnerName === partner) &&
      matches(query, item.debtor, item.identifier, item.court, item.creditor, item.partnerName),
  );
  const current = data?.cases.find((item) => item.id === selected) ?? rows[0];
  const paged = pageOf(rows, page, size);
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
  const labelOf = (index: number) => LITIGATION_STAGES[index]?.label ?? '';
  const summary = (item: LitigationCase) => [
    { k: 'Débiteur', v: `${item.debtor} · ${item.identifier}` },
    { k: 'Créancier', v: item.creditor },
    { k: 'Montant', v: formatCents(item.amount) },
  ];
  const advance = (item: LitigationCase) => {
    const next = LITIGATION_STAGES[item.stage + 1];
    if (!next || next.code === 'CLOSED') return;
    confirm({
      title: `Passer à l’étape « ${next.label} » ?`,
      body: `Cette étape peut engager des frais de procédure et sera visible par ${item.creditor} dans son espace. Elle ne peut pas être annulée.`,
      confirmLabel: 'Confirmer l’étape',
      details: [...summary(item), { k: 'Étape actuelle', v: labelOf(item.stage) }, { k: 'Nouvelle étape', v: next.label }],
      onConfirm: async () => {
        await change(`/litigation/${item.id}/stage`, { body: { stage: next.code, version: item.version } });
        toast({ message: `Étape enregistrée : ${next.label}.` });
      },
    });
  };
  const close = (item: LitigationCase) => {
    const outcome = item.balance === 0 ? 'SETTLED' : 'LOST';
    confirm({
      tone: 'danger',
      title: 'Clore la procédure ?',
      body:
        outcome === 'SETTLED'
          ? `Plus rien n’est dû : le dossier est clos comme soldé. ${item.creditor} le verra dans son espace. La clôture ne peut pas être annulée.`
          : `Il reste ${formatCents(item.balance)} à payer : le dossier est clos comme irrécouvrable. ${item.creditor} le verra dans son espace. La clôture ne peut pas être annulée.`,
      confirmLabel: 'Clore la procédure',
      details: [...summary(item), { k: 'Reste dû', v: formatCents(item.balance) }, { k: 'Issue', v: OUTCOMES[outcome] }],
      onConfirm: async () => {
        await change(`/litigation/${item.id}/stage`, { body: { stage: 'CLOSED', expectedOutcome: outcome, version: item.version } });
        toast({ message: `Procédure close : ${OUTCOMES[outcome].toLowerCase()}.` });
      },
    });
  };
  const noteConsent = (item: LitigationCase) =>
    confirm({
      title: 'Noter l’accord du créancier ?',
      body: `Le mandat de ${item.creditor} exige son accord écrit avant toute étape qui engage des frais. Une fois noté, l’accord ne peut plus être retiré ; votre nom et la date sont conservés.`,
      confirmLabel: 'Noter l’accord',
      details: summary(item),
      check: { label: 'Accord écrit du créancier reçu', required: true },
      onConfirm: async () => {
        await change(`/litigation/${item.id}/consent`, { body: { version: item.version } });
        toast({ message: 'Accord du créancier noté.' });
      },
    });
  const describe = async (item: LitigationCase, court: string, partnerName: string) => {
    const save = (values: { court: string; partnerName: string }, version: number) =>
      change(`/litigation/${item.id}`, { method: 'PUT', body: { ...values, version } });
    try {
      await save({ court, partnerName }, item.version);
      toast({
        message: 'Juridiction et intervenant enregistrés.',
        // Each save adds one to the version: undoing writes the former values on the next one.
        undo: () => void save({ court: item.court, partnerName: item.partnerName }, item.version + 1),
      });
    } catch {
      toast({ message: 'L’enregistrement n’a pas abouti : rechargez la page, puis réessayez.', tone: 'danger' });
    }
  };
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
          { label: `Titres exécutoires (${new Date().getFullYear()})`, value: String(s?.titles ?? ''), sub: 'obtenus dans l’année', tone: 'success' },
          { label: 'En attente d’accord créancier', value: String(s?.waiting ?? ''), sub: 'avant engagement de frais', tone: 'warning' },
        ]}
        actions={[{ label: '+ Transférer un dossier', primary: true, kbd: 'N', href: '/debiteurs' }]}
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
        filters={[{ label: 'Intervenant', value: partner, options: partners, onChange: setPartner }]}
        views={[
          { label: 'Tableau', selected: view === 'board', pick: () => setView('board') },
          { label: 'Liste', selected: view === 'list', pick: () => setView('list') },
        ]}
      />
      {view === 'board' ? (
        <Carte title="Avancement des procédures" description="Sélectionnez un dossier pour afficher son suivi ci-dessous" padding="none">
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
                          <span>depuis le {formatDate(row.stageSince)}</span>
                          {row.consent === 'WAITING' && (
                            <Badge label="Accord créancier attendu" tone="warning" icon="clock" layout={{ alignSelf: 'flex-start', whiteSpace: 'normal' }} />
                          )}
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
            rows={paged.shown}
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
                      {row.creditor} · {row.identifier}
                    </span>
                  </button>
                ),
              },
              { key: 'stage', label: 'Étape', sortValue: (row) => row.stage, value: (row) => labelOf(row.stage) },
              { key: 'since', label: 'Depuis le', sortValue: (row) => row.stageSince, value: (row) => formatDate(row.stageSince) },
              { key: 'partner', label: 'Intervenant', value: (row) => row.partnerName || '—' },
              {
                key: 'consent',
                label: 'Accord créancier',
                render: (row) => (row.consent === 'WAITING' ? <Badge label="Attendu" tone="warning" /> : row.consent === 'RECEIVED' ? 'Reçu' : 'Non exigé'),
              },
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
              total={paged.total}
              page={paged.current}
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
        <Carte
          title={current.debtor}
          description={`${labelOf(current.stage)} depuis le ${formatDate(current.stageSince)} · ${current.identifier}`}
          actionLabel="Ouvrir le dossier"
          actionIcon="arrow-right"
          actionHref={`/debiteurs/${current.caseId}`}
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
                <dt>Accord du créancier</dt>
                <dd>{current.consent === 'WAITING' ? 'Attendu' : current.consent === 'RECEIVED' ? 'Reçu' : 'Non exigé par le mandat'}</dd>
              </div>
              {!current.canAct && (
                <>
                  <div>
                    <dt>Juridiction</dt>
                    <dd>{current.court || '—'}</dd>
                  </div>
                  <div>
                    <dt>Intervenant</dt>
                    <dd>{current.partnerName || '—'}</dd>
                  </div>
                </>
              )}
            </dl>
            {current.canAct && (
              <FollowUp key={`${current.id}:${current.version}`} item={current} onSave={(court, partnerName) => describe(current, court, partnerName)} />
            )}
            <h3 className={css.subtitle}>Historique de la procédure</h3>
            <ol className={layout.timeline}>
              {current.events.map((event, index) => (
                <li key={`${event.title}:${event.date}:${index}`}>
                  <span aria-hidden className={layout.dot} data-tone={index === current.events.length - 1 ? 'info' : 'success'} />
                  <span className={layout.text}>
                    <strong className={layout.strong}>{event.title}</strong>
                    <span className={layout.hint}>
                      {formatDate(event.date)} · {event.who}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {current.canAct && (
              <div className={layout.inline}>
                {current.consent === 'WAITING' ? (
                  <Bouton label="Noter l’accord du créancier" onPress={() => noteConsent(current)} />
                ) : (
                  current.stage < 3 && <Bouton label={`Passer à : ${labelOf(current.stage + 1)}`} onPress={() => advance(current)} />
                )}
                <Bouton variant="secondary" label="Clore la procédure" onPress={() => close(current)} />
              </div>
            )}
          </div>
        </Carte>
      )}
    </>
  );
}
