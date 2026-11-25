import { canAccessBilling, caseList, formatCents, type CaseFilter } from '@legarec/contracts';
import { Avatar, Badge, Bouton, Champ, PageHeader, Pagination, Tableau, Toolbar, useConfirm, useToast } from '@legarec/ui';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../app/api';
import { useCreditorScope } from '../../app/creditorScope';
import { useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import { listState } from '../../shared/listState';
import { STATUS_TONE } from '../dashboard/DashboardPage';

const TABS: [CaseFilter, string][] = [
  ['all', 'Tous'],
  ['overdue', 'En retard'],
  ['reminder', 'En relance'],
  ['promise', 'Promesse / échéancier'],
  ['dispute', 'Litige'],
  ['settled', 'Réglés'],
];
const AGES = [
  ['all', 'Toute ancienneté'],
  ['0-30', '0 – 30 j'],
  ['31-60', '31 – 60 j'],
  ['61-90', '61 – 90 j'],
  ['90+', '+ 90 j'],
].map(([value, label]) => ({ value: value ?? '', label: label ?? '' }));
const OFFICERS = [
  ['all', 'Tous les gestionnaires'],
  ['cl', 'Camille Laurent'],
  ['hb', 'Hugo Benali'],
  ['sm', 'Sarah Morel'],
  ['tg', 'Thomas Giraud'],
].map(([value, label]) => ({ value: value ?? '', label: label ?? '' }));

export function CasesPage() {
  const user = useCurrentUser();
  const scope = useCreditorScope();
  const confirm = useConfirm();
  const toast = useToast();
  const change = useChange();
  const [query, setQuery] = useState('');
  const [search] = useDebouncedValue(query, 250);
  const [tab, setTab] = useState<CaseFilter>('all');
  const [age, setAge] = useState('all');
  const [officer, setOfficer] = useState('all');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  // The search may hold a name or a SIRET: it is sent in the body, never in the URL.
  const params = new URLSearchParams({ creditor: scope.id, status: tab, age, officer, page: String(page), size: String(size) });
  const { data, isPending, error, refetch } = useApiSearch(`/cases/search?${params}`, search);
  const rows = data?.items ?? [];
  const chosen = rows.filter((row) => selected.includes(row.id));
  const total = chosen.reduce((sum, row) => sum + row.amount, 0);
  const plural = chosen.length > 1 ? 's' : '';
  const names = chosen.map((row) => row.name).join(', ');
  const tabs: [CaseFilter, string][] = user.role === 'COLLECTION_MANAGER' && data?.counts.unassigned ? [...TABS, ['unassigned', 'Sans gestionnaire']] : TABS;
  const state = listState({
    pending: isPending,
    error,
    count: rows.length,
    query,
    empty: 'Aucun débiteur dans ce statut',
    emptyText: 'Les débiteurs apparaissent ici dès que leurs factures sont importées.',
    noResultText: 'Vérifiez l’orthographe, ou cherchez par numéro SIRET, SIREN ou de facture.',
    errorTitle: 'Impossible de charger les débiteurs',
    onRetry: () => void refetch(),
    onClear: () => setQuery(''),
  });

  const sendReminders = () =>
    confirm({
      title: `Envoyer une relance à ${chosen.length} débiteur${plural} ?`,
      body: 'Chaque débiteur reçoit la prochaine relance de son scénario (e-mail via Resend ou SMS), avec le lien de son espace débiteur.',
      details: [{ k: 'Débiteurs', v: names }],
      confirmLabel: 'Envoyer les relances',
      onConfirm: async () => {
        await change('/cases/reminders', { body: { ids: selected } });
        toast({ message: `${chosen.length} relance(s) programmée(s) pour envoi immédiat.` });
        setSelected([]);
      },
    });
  const toLitigation = () =>
    confirm({
      tone: 'danger',
      title: `Passer ${chosen.length} dossier${plural} en contentieux ?`,
      body: 'Les relances amiables s’arrêtent. Une demande d’accord est envoyée à chaque créancier avant tout engagement de frais.',
      details: [
        { k: 'Débiteurs', v: names },
        { k: 'Montant total', v: formatCents(total) },
      ],
      reasonLabel: 'Motif du passage en contentieux',
      confirmLabel: 'Passer en contentieux',
      onConfirm: async (reason) => {
        await change('/cases/litigation', { body: { ids: selected, reason } });
        toast({ message: `${chosen.length} dossier(s) transmis au contentieux · demandes d’accord envoyées aux créanciers.` });
        setSelected([]);
      },
    });
  const assign = (officerId: string, name: string) =>
    confirm({
      title: `Attribuer ${chosen.length} dossier${plural} à ${name} ?`,
      body: 'Le changement de gestionnaire est noté dans l’historique de chaque dossier.',
      details: [
        { k: 'Débiteurs', v: names },
        { k: 'Nouveau gestionnaire', v: name },
      ],
      confirmLabel: 'Attribuer',
      onConfirm: async () => {
        await change('/cases/assign', { body: { ids: selected, officerId } });
        toast({ message: 'Dossiers attribués.' });
        setSelected([]);
        setTarget('');
      },
    });
  const mayAssign = canAccessBilling(user);
  const s = data?.stats;
  return (
    <>
      <PageHeader
        title="Débiteurs"
        loading={isPending}
        statsLabel="Indicateurs du portefeuille"
        description={data ? `${data.counts.all} débiteurs · ${s?.invoices.toLocaleString('fr-FR')} factures impayées · identification par SIRET` : ' '}
        stats={[
          { label: 'Encours total', value: s ? formatCents(s.outstanding) : '', sub: s ? `${s.invoices.toLocaleString('fr-FR')} factures` : ' ' },
          { label: 'En retard', value: String(s?.overdue ?? ''), tone: 'danger', sub: s ? `${formatCents(s.overdueAmount)} à plus de 60 j` : ' ' },
          { label: 'Promesses à contrôler', value: String(s?.promises ?? ''), tone: 'warning', sub: s ? `dont ${s.promisesToday} aujourd’hui` : ' ' },
          { label: 'Recouvré en novembre', value: s ? formatCents(s.recovered) : '', tone: 'success', sub: s ? `${s.targetRatio} % de l’objectif` : ' ' },
        ]}
        actions={[
          { label: 'Importer des factures', href: '/creanciers/md' },
          { label: 'Exporter', disabled: true },
          { label: '+ Nouveau débiteur', primary: true, kbd: 'N', disabled: true },
        ]}
      />
      <Toolbar
        label="Filtrer les débiteurs"
        tabsLabel="Statut"
        placeholder="Débiteur, SIRET, n° de facture…"
        query={query}
        onQuery={(value) => {
          setQuery(value);
          setPage(1);
        }}
        tabs={tabs.map(([id, label]) => ({
          label,
          count: data?.counts[id] ?? '',
          selected: id === tab,
          pick: () => {
            setTab(id);
            setPage(1);
            setSelected([]);
          },
        }))}
        scope={{
          name: scope.id === 'all' ? 'Tous les créanciers' : (rows[0]?.creditor ?? 'Créancier'),
          onReset: scope.id === 'all' ? undefined : () => scope.setId('all'),
        }}
        filters={[
          { label: 'Ancienneté', value: age, options: AGES, onChange: setAge },
          ...(user.role === 'CLAIMS_OFFICER' ? [] : [{ label: 'Gestionnaire', value: officer, options: OFFICERS, onChange: setOfficer }]),
        ]}
      />
      <section aria-label="Liste des dossiers" className={layout.card}>
        <Tableau
          caption="Dossiers"
          hideCaption
          tight
          bordered={false}
          rows={rows}
          rowId={(row) => row.id}
          rowLabel={(row) => row.name}
          state={state}
          selection={
            rows.some((row) => row.canAct)
              ? { selected, onChange: (ids) => setSelected(ids.filter((id) => rows.find((row) => row.id === id)?.canAct)) }
              : undefined
          }
          columns={[
            {
              key: 'name',
              label: 'Débiteur',
              sortValue: (row) => row.name,
              render: (row) => (
                <span className={layout.text}>
                  <Link to={`/debiteurs/${row.id}`} className={layout.strong}>
                    {row.name}
                  </Link>
                  <span className={layout.hint}>
                    {row.reference} · {row.identifier}
                  </span>
                </span>
              ),
            },
            { key: 'creditor', label: 'Créancier', value: (row) => row.creditor },
            { key: 'invoices', label: 'Factures', value: (row) => row.invoicesLabel },
            {
              key: 'amount',
              label: 'Montant dû',
              align: 'right',
              sortValue: (row) => row.amount,
              value: (row) => ({ text: formatCents(row.amount), strong: true }),
            },
            {
              key: 'late',
              label: 'Retard',
              align: 'right',
              sortValue: (row) => row.daysLate ?? -1,
              render: (row) => (
                <span className={row.status === 'OVERDUE' || row.status === 'FORMAL_NOTICE' ? layout.danger : undefined}>
                  {row.daysLate === null ? '—' : `${row.daysLate} j`}
                </span>
              ),
            },
            { key: 'status', label: 'Statut', render: (row) => <Badge label={row.statusLabel} tone={STATUS_TONE[row.status]} /> },
            { key: 'next', label: 'Prochaine action', value: (row) => ({ text: row.nextAction, sub: row.nextDate }) },
            {
              key: 'officer',
              label: 'Gestionnaire',
              render: (row) => (row.officer ? <Avatar title={row.officer} size={32} /> : <Badge label="À attribuer" tone="warning" />),
            },
          ]}
        />
        {!state && data && (
          <Pagination
            total={data.total}
            page={page}
            size={size}
            unit="débiteurs"
            label="Pagination des débiteurs"
            onPage={setPage}
            onSize={(value) => {
              setSize(value);
              setPage(1);
            }}
          />
        )}
      </section>
      {chosen.length > 0 && (
        <div role="region" aria-label="Actions groupées" data-dark className={layout.bulk}>
          <span>
            {chosen.length} sélectionné{plural} · {formatCents(total)}
          </span>
          <Bouton variant="dark" size="sm" label="Envoyer une relance" onPress={sendReminders} />
          {mayAssign && (
            <>
              <Champ
                label="Attribuer à"
                hideLabel
                type="select"
                value={target}
                options={[
                  { value: '', label: 'Attribuer à…' },
                  { value: user.userId, label: 'Moi-même' },
                  ...OFFICERS.filter((item) => !['all', user.userId].includes(item.value)),
                ]}
                onChange={setTarget}
              />
              <Bouton
                variant="dark"
                size="sm"
                label="Attribuer"
                disabled={!target}
                onPress={() =>
                  assign(target, target === user.userId ? `${user.firstName} ${user.lastName}` : (OFFICERS.find((item) => item.value === target)?.label ?? ''))
                }
              />
            </>
          )}
          <Bouton variant="danger" size="sm" label="Passer en contentieux" onPress={toLitigation} />
          <Bouton variant="dark" size="sm" label="Désélectionner" onPress={() => setSelected([])} />
        </div>
      )}
    </>
  );
}

function useApiSearch(path: string, query: string) {
  return useQuery({ queryKey: [path, query], queryFn: () => api(caseList, path, { method: 'POST', body: { query } }), placeholderData: keepPreviousData });
}
