import { DOCUMENT_CATEGORIES, documentCategory, documentsData, formatDate, type DocumentCategory, type DocumentItem } from '@legarec/contracts';
import { Badge, Bouton, EtatListe, PageHeader, Pagination, Tableau, Toolbar, useConfirm, useToast, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import { listState, matches } from '../../shared/listState';
import css from './Documents.module.css';

const TONE: Record<DocumentCategory, Tone> = {
  REMINDER_LETTER: 'info',
  FORMAL_NOTICE: 'warning',
  PAYMENT_PLAN: 'success',
  INVOICE: 'marine',
  EVIDENCE: 'neutral',
  COURT: 'danger',
  REMITTANCE: 'teal',
  RECEIPT: 'success',
};

export function DocumentsPage() {
  const scope = useCreditorScope();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, isPending, error, refetch } = useApi(documentsData, '/documents');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<DocumentCategory | 'all'>('all');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const rows = (data?.items ?? []).filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      (scope.id === 'all' || item.creditorId === scope.id) &&
      matches(query, item.name, item.debtor, item.creditor),
  );
  const current = rows.find((item) => item.id === selected) ?? rows[0];
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Aucun document',
    emptyText: 'Importez des fichiers ou générez un courrier : ils sont classés automatiquement par dossier.',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });
  const share = (item: DocumentItem) =>
    confirm({
      title: 'Partager ce document au créancier ?',
      body: 'Le document devient visible dans l’espace créancier.',
      confirmLabel: 'Partager',
      details: [
        { k: 'Document', v: item.name },
        { k: 'Créancier', v: item.creditor },
      ],
      onConfirm: async () => {
        await change(`/documents/${item.id}/share`);
        toast({ message: 'Document partagé au créancier.' });
      },
    });
  const send = (item: DocumentItem) =>
    confirm({
      title: 'Envoyer ce document ?',
      body: 'L’envoi part immédiatement et est ajouté à l’historique du dossier.',
      confirmLabel: 'Envoyer',
      details: [
        { k: 'Document', v: item.name },
        { k: 'Destinataire', v: item.debtor },
      ],
      onConfirm: async () => {
        await change(`/documents/${item.id}/send`);
        toast({ message: 'Document envoyé.' });
      },
    });
  const category_ = (id: DocumentCategory | 'all', label: string, count: number | undefined) => (
    <button key={id} type="button" className={css.category} aria-pressed={category === id} onClick={() => setCategory(id)}>
      <span>{label}</span>
      <span className={layout.num}>{count?.toLocaleString('fr-FR')}</span>
    </button>
  );
  return (
    <>
      <PageHeader
        title="Documents"
        loading={isPending}
        description={data ? `${data.total.toLocaleString('fr-FR')} documents · ${data.size} · classés par créancier et par débiteur` : ' '}
        actions={[
          { label: 'Importer des fichiers', disabled: true },
          { label: '+ Nouveau courrier', primary: true, kbd: 'N', href: '/documents/rediger' },
        ]}
      />
      <div className={css.grid3}>
        <nav aria-label="Catégories de documents" className={layout.card} style={{ padding: 'var(--sp-2)' }}>
          {category_('all', 'Tous les documents', data?.total)}
          {documentCategory.options.map((id) => category_(id, DOCUMENT_CATEGORIES[id], data?.counts[id]))}
        </nav>
        <section aria-label="Liste des documents" className={layout.card}>
          <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
            <Toolbar
              label="Filtrer les documents"
              placeholder="Nom, débiteur, n° de facture…"
              query={query}
              onQuery={setQuery}
              views={[
                { label: 'Liste', selected: view === 'list', pick: () => setView('list') },
                { label: 'Vignettes', selected: view === 'grid', pick: () => setView('grid') },
              ]}
            />
          </div>
          {view === 'grid' && !state ? (
            <div className={css.tiles}>
              {rows.map((item) => (
                <button key={item.id} type="button" className={css.tile} aria-pressed={item.id === current?.id} onClick={() => setSelected(item.id)}>
                  <span aria-hidden className={css.thumb}>
                    <Badge label={item.kind} tone={TONE[item.category]} />
                  </span>
                  <strong>{item.name}</strong>
                  <span className={layout.hint}>
                    {item.debtor} · {formatDate(item.date)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Tableau
              caption="Documents"
              hideCaption
              tight
              bordered={false}
              rows={rows}
              rowId={(row) => row.id}
              activeRowId={current?.id}
              state={state}
              columns={[
                {
                  key: 'name',
                  label: 'Document',
                  sortValue: (row) => row.name,
                  render: (row) => (
                    <button type="button" className={css.pick} aria-pressed={row.id === current?.id} onClick={() => setSelected(row.id)}>
                      <Badge label={row.kind} tone={TONE[row.category]} />
                      <span className={layout.text}>
                        <span className={layout.strong}>{row.name}</span>
                        <span className={layout.hint}>
                          {DOCUMENT_CATEGORIES[row.category]} · {row.size}
                        </span>
                      </span>
                    </button>
                  ),
                },
                { key: 'debtor', label: 'Débiteur · créancier', value: (row) => ({ text: row.debtor, sub: row.creditor }) },
                { key: 'status', label: 'Statut', render: (row) => <Badge label={row.status} tone={row.tone} /> },
                { key: 'date', label: 'Date', align: 'right', sortValue: (row) => row.date, value: (row) => formatDate(row.date) },
              ]}
            />
          )}
          {!state && data && (
            <Pagination
              total={query || category !== 'all' ? rows.length : data.total}
              page={page}
              size={size}
              unit="documents"
              label="Pagination des documents"
              onPage={setPage}
              onSize={setSize}
            />
          )}
        </section>
        {current ? (
          <aside aria-label="Aperçu du document" className={layout.card}>
            <div className={css.preview}>
              <span className={layout.between}>
                <strong>LEGAREC</strong>
                <span>{formatDate(current.date)}</span>
              </span>
              <span>{current.debtor}</span>
              <strong>{current.title}</strong>
              <span>Pour le compte de {current.creditor}</span>
            </div>
            <div className={layout.stack} style={{ padding: 'var(--sp-5)' }}>
              <div className={layout.text}>
                <h2 className={css.h2}>{current.name}</h2>
                <span className={layout.hint}>
                  {DOCUMENT_CATEGORIES[current.category]} · {current.kind} · {current.size}
                </span>
              </div>
              <dl className={layout.facts}>
                <div>
                  <dt>Dossier</dt>
                  <dd>
                    {current.caseId ? (
                      <Link to={`/debiteurs/${current.caseId}`} className={layout.link}>
                        {current.debtor}
                      </Link>
                    ) : (
                      current.debtor
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Créancier</dt>
                  <dd>{current.creditor}</dd>
                </div>
                <div>
                  <dt>Créé par</dt>
                  <dd>{current.author}</dd>
                </div>
                <div>
                  <dt>Statut</dt>
                  <dd>{current.status}</dd>
                </div>
                <div>
                  <dt>Suivi</dt>
                  <dd>{current.tracking}</dd>
                </div>
              </dl>
              <div className={layout.inline}>
                <Bouton label="Télécharger" disabled title="URL présignée fournie par l’API" />
                <Bouton variant="secondary" label="Partager au créancier" onPress={() => share(current)} />
                <Bouton variant="secondary" label="Envoyer" onPress={() => send(current)} />
                <Bouton variant="secondary" label="Historique (2)" disabled />
              </div>
            </div>
          </aside>
        ) : (
          <div className={layout.card}>
            <EtatListe kind={isPending ? 'loading' : 'empty'} title="Aucun document sélectionné" text="Choisissez un document pour voir son aperçu." compact />
          </div>
        )}
      </div>
    </>
  );
}
