import {
  DOCUMENT_CATEGORIES,
  documentCategory,
  documentsData,
  formatDate,
  importedDocument,
  type DocumentCategory,
  type DocumentItem,
} from '@legarec/contracts';
import { ApiError, download, saveFile, upload } from '@legarec/platform';
import { Alerte, Badge, Bouton, DepotFichiers, EtatListe, PageHeader, Pagination, Tableau, Toolbar, useConfirm, useToast, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCreditorScope } from '../../app/creditorScope';
import { useApi, useChange } from '../../app/data';
import { opens, shown } from '../../app/features';
import layout from '@legarec/ui/layout.module.css';
import { pageOf } from '../../shared/paging';
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
  const [creditor, setCreditor] = useState('all');
  const [files, setFiles] = useState<File[]>([]);
  const [importProblem, setImportProblem] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const rows = (data?.items ?? []).filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      (scope.id === 'all' || item.creditorId === scope.id) &&
      (creditor === 'all' || item.creditor === creditor) &&
      matches(query, item.name, item.debtor, item.creditor),
  );
  const current = rows.find((item) => item.id === selected) ?? rows[0];
  const paged = pageOf(rows, page, size);
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
  const importFiles = () => {
    setImportProblem('');
    confirm({
      title: `Importer ${files.length} fichier${files.length > 1 ? 's' : ''} ?`,
      body: 'Les fichiers sont rattachés automatiquement à leur dossier par numéro de facture. Les fichiers non reconnus restent à classer.',
      confirmLabel: 'Importer',
      details: files.map((file) => ({ k: 'Fichier', v: file.name })),
      onConfirm: async () => {
        // Each file is received on its own: the ones already sent are never sent twice.
        let pending = files;
        let attached = 0;
        try {
          for (const file of files) {
            const { status } = await upload(importedDocument, '/documents/import', file);
            if (status === 'ATTACHED') attached += 1;
            pending = pending.filter((item) => item !== file);
          }
          const left = files.length - attached;
          toast({ message: `Fichiers importés : ${attached} rattaché${attached > 1 ? 's' : ''}, ${left} à classer.` });
        } catch {
          const sent = files.length - pending.length;
          setImportProblem(
            `${sent} fichier${sent > 1 ? 's' : ''} importé${sent > 1 ? 's' : ''}, ${pending.length} en échec. Les fichiers restants sont conservés : réessayez pour ceux-là seulement.`,
          );
        }
        setFiles(pending);
        await refetch();
      },
    });
  };
  // Read once ClamAV found it clean: until then, the API says so.
  const fetchFile = async (item: DocumentItem) => {
    try {
      const { blob, name } = await download(`/documents/${encodeURIComponent(item.id)}/file`);
      saveFile(blob, name);
    } catch (error) {
      toast({
        message:
          error instanceof ApiError && error.status === 409
            ? 'Ce document n’est pas encore disponible : l’analyse antivirus est en cours.'
            : 'Le document n’a pas pu être téléchargé. Réessayez dans un instant.',
      });
    }
  };
  const share = (item: DocumentItem) =>
    confirm({
      title: 'Partager ce document au créancier ?',
      body: 'Le document devient visible dans l’espace créancier. Vérifiez qu’il ne contient pas le code d’accès du débiteur : ce code ouvre les dossiers de tous ses créanciers.',
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
          { label: 'Importer des fichiers', onPress: () => document.querySelector<HTMLElement>('#import-documents button')?.focus() },
          ...(opens('/documents/rediger') ? [{ label: '+ Nouveau courrier', primary: true, kbd: 'N', href: '/documents/rediger' }] : []),
        ]}
      />
      <div className={css.grid3}>
        <div className={layout.stack}>
          <nav aria-label="Catégories de documents" className={layout.card} style={{ padding: 'var(--sp-2)' }}>
            {category_('all', 'Tous les documents', data?.total)}
            {documentCategory.options.map((id) => category_(id, DOCUMENT_CATEGORIES[id], data?.counts[id]))}
          </nav>
          <div id="import-documents" className={layout.stack}>
            <DepotFichiers
              label="Déposez vos fichiers ici"
              hint="PDF, Word, images · 25 Mo max. Rattachement automatique au dossier par n° de facture."
              accept=".pdf,.docx,.png,.jpg,.jpeg"
              maxMb={25}
              multiple
              files={files}
              onChange={setFiles}
            />
            {importProblem && <Alerte tone="danger" compact text={importProblem} />}
            {files.length > 0 && <Bouton full label={`Importer (${files.length})`} onPress={importFiles} />}
          </div>
        </div>
        <section aria-label="Liste des documents" className={layout.card}>
          <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
            <Toolbar
              label="Filtrer les documents"
              placeholder="Nom, débiteur, n° de facture…"
              query={query}
              onQuery={setQuery}
              filters={[
                {
                  label: 'Créancier',
                  value: creditor,
                  options: [
                    { value: 'all', label: 'Tous' },
                    ...[...new Set((data?.items ?? []).map((item) => item.creditor))].map((value) => ({ value, label: value })),
                  ],
                  onChange: setCreditor,
                },
              ]}
              views={[
                { label: 'Liste', selected: view === 'list', pick: () => setView('list') },
                { label: 'Vignettes', selected: view === 'grid', pick: () => setView('grid') },
              ]}
            />
          </div>
          {view === 'grid' && !state ? (
            <div className={css.tiles}>
              {paged.shown.map((item) => (
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
              rows={paged.shown}
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
              total={paged.total}
              page={paged.current}
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
                <Bouton label="Télécharger" onPress={() => void fetchFile(current)} />
                <Bouton variant="secondary" label="Partager au créancier" onPress={() => share(current)} />
                {shown('document-sending') && <Bouton variant="secondary" label="Envoyer" onPress={() => send(current)} />}
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
