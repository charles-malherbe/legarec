import {
  formatCents,
  formatDate,
  REMITTANCE_STATE_LABELS,
  remittanceBatch,
  remittanceBatches,
  remittanceDraft,
  type RemittanceRow,
  type RemittanceState,
} from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, EtatListe, Onglets, PageHeader, Tableau, useConfirm, useToast, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { z } from 'zod';
import { useApi, useChange } from '../../app/data';
import css from './Remittances.module.css';

const TONES: Record<RemittanceState, Tone> = {
  READY: 'success',
  BELOW_MINIMUM: 'neutral',
  NO_ACCOUNT: 'danger',
  NO_MANDATE: 'danger',
  RETAINED: 'warning',
  PAID: 'marine',
};
const STEPS = [
  ['Préparation', 'Calculée par l’application sur les paiements définitifs'],
  ['Validation', 'Directeur, ou Responsable par délégation'],
  ['Virements', 'Saisis à la banque, puis marqués versés'],
  ['Relevés', 'Envoyés aux créanciers avec la facture'],
] as const;
const TABS = [
  ['draft', 'À valider'],
  ['todo', 'Virements à faire'],
  ['paid', 'Versés'],
] as const;
type Tab = (typeof TABS)[number][0];
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

/** The columns of a batch, the same whether it waits or was validated: nothing is typed by hand. */
function columns(onRetain?: (row: RemittanceRow) => void) {
  return [
    {
      key: 'creditor',
      label: 'Créancier',
      value: (row: RemittanceRow) => ({ text: row.creditor, sub: `${row.payments} encaissement${row.payments > 1 ? 's' : ''}`, strong: true }),
    },
    { key: 'collected', label: 'Encaissé', align: 'right' as const, value: (row: RemittanceRow) => formatCents(row.collected) },
    {
      key: 'fees',
      label: 'Honoraires TTC',
      align: 'right' as const,
      value: (row: RemittanceRow) => (row.feesGross ? { text: `− ${formatCents(row.feesGross)}`, sub: `${formatCents(row.feesNet)} HT` } : '—'),
    },
    {
      key: 'toPay',
      label: 'À verser',
      align: 'right' as const,
      value: (row: RemittanceRow) => ({
        text: row.state === 'BELOW_MINIMUM' ? 'reporté' : formatCents(row.toPay),
        // A credit note given back with this remittance (question 69, V2).
        sub: row.credits ? `dont ${formatCents(row.credits)} d’avoir` : undefined,
        strong: true,
      }),
    },
    { key: 'account', label: 'Compte', value: (row: RemittanceRow) => ({ text: row.account ?? '—', mono: true }) },
    {
      key: 'state',
      label: 'Contrôle',
      render: (row: RemittanceRow) => <Badge label={REMITTANCE_STATE_LABELS[row.state]} tone={TONES[row.state]} />,
    },
    ...(onRetain
      ? [
          {
            key: 'action',
            label: 'Action',
            render: (row: RemittanceRow) =>
              row.state === 'READY' ? <Bouton label="Retenir" variant="secondary" size="sm" onPress={() => onRetain(row)} /> : null,
          },
        ]
      : [
          { key: 'invoice', label: 'Facture', value: (row: RemittanceRow) => ({ text: row.invoice ?? '—', mono: true }) },
          { key: 'reason', label: 'Motif', value: (row: RemittanceRow) => row.reason ?? '' },
        ]),
  ];
}

/** Validation des reversements (docs/propositions, écran 3): the Director, or the manager acting for them. */
export function RemittancesPage() {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('draft');
  const [retained, setRetained] = useState<{ creditorId: string; reason: string }[]>([]);
  const draft = useApi(remittanceDraft, '/remittances/draft');
  const batches = useApi(remittanceBatches, '/remittances');
  const data = draft.data;
  const kept = (row: RemittanceRow) => retained.some((item) => item.creditorId === row.creditorId);
  const rows = (data?.rows ?? []).map((row) =>
    kept(row) ? { ...row, state: 'RETAINED' as const, reason: retained.find((item) => item.creditorId === row.creditorId)!.reason } : row,
  );
  const ready = rows.filter((row) => row.state === 'READY');
  const total = ready.reduce((sum, row) => sum + row.toPay, 0);
  const sum = (pick: (row: RemittanceRow) => number) => ready.reduce((all, row) => all + pick(row), 0);
  const deferred = rows.filter((row) => row.state === 'BELOW_MINIMUM');
  const blocked = rows.filter((row) => row.state === 'NO_ACCOUNT' || row.state === 'NO_MANDATE');
  const todo = (batches.data?.items ?? []).filter((item) => item.status === 'VALIDATED');
  const paid = (batches.data?.items ?? []).filter((item) => item.status === 'PAID');

  const retain = (row: RemittanceRow) =>
    confirm({
      tone: 'danger',
      title: `Retenir ${row.creditor} de ce lot ?`,
      body: 'Ses encaissements passent dans le lot suivant. Le motif est noté au journal d’audit.',
      confirmLabel: 'Retenir le créancier',
      reasonLabel: 'Motif de la retenue',
      reasonPlaceholder: 'Ex. : litige sur le mandat, compte à vérifier…',
      details: [
        { k: 'Créancier', v: row.creditor },
        { k: 'Montant', v: formatCents(row.toPay) },
        { k: 'Lot suivant', v: 'ses encaissements y passent' },
      ],
      onConfirm: (reason) => {
        setRetained((list) => [...list, { creditorId: row.creditorId, reason }]);
        toast({ message: `${row.creditor} retenu de ce lot.`, undo: () => setRetained((list) => list.filter((item) => item.creditorId !== row.creditorId)) });
      },
    });

  const validate = () =>
    data &&
    confirm({
      title: 'Valider le lot de reversements ?',
      body: 'Une facture de commission est émise pour chaque créancier versé. Les virements restent à saisir à la banque.',
      confirmLabel: 'Valider le lot',
      details: [
        { k: 'Période', v: `paiements définitifs jusqu’au ${formatDate(data.until)}` },
        { k: 'Créanciers versés', v: String(ready.length) },
        { k: 'Encaissé', v: formatCents(sum((row) => row.collected)) },
        { k: 'Honoraires TTC', v: formatCents(sum((row) => row.feesGross)) },
        { k: 'À verser', v: formatCents(total) },
        ...(retained.length ? [{ k: 'Retenus', v: String(retained.length) }] : []),
      ],
      onConfirm: async () => {
        await change('/remittances', {
          schema: z.object({ id: z.string() }),
          body: {
            until: data.until,
            expected: ready.map((row) => ({ creditorId: row.creditorId, toPay: row.toPay, accountId: row.accountId })),
            retained,
          },
        });
        setRetained([]);
        setTab('todo');
        toast({ message: `Lot validé : ${ready.length} virement${ready.length > 1 ? 's' : ''} à faire, ${formatCents(total)}.` });
      },
    });

  const markPaid = (batch: z.infer<typeof remittanceBatches>['items'][number]) =>
    confirm({
      title: 'Marquer ces reversements comme versés ?',
      body: 'À faire une fois les virements saisis à la banque. Les relevés et les factures partent ensuite aux créanciers.',
      confirmLabel: 'Marquer comme versés',
      details: [
        { k: 'Lot', v: `paiements jusqu’au ${formatDate(batch.until)}` },
        { k: 'Total', v: formatCents(batch.total) },
        { k: 'Virements', v: String(batch.transfers) },
        { k: 'Date des virements', v: formatDate(today()) },
      ],
      onConfirm: async () => {
        await change(`/remittances/${batch.id}/paid`, { body: { paidOn: today(), expectedTotal: batch.total } });
        toast({ message: `Reversements du lot marqués comme versés le ${formatDate(today())}.` });
      },
    });

  return (
    <>
      <PageHeader
        title="Reversements"
        loading={draft.isPending}
        description={data ? `Prochain lot · paiements définitifs jusqu’au ${formatDate(data.until)}` : ' '}
        statsLabel="Lot à valider"
        stats={[
          { label: 'À verser', value: data ? formatCents(total) : '', sub: `${ready.length} virement${ready.length > 1 ? 's' : ''}` },
          { label: 'Encaissé', value: data ? formatCents(sum((row) => row.collected)) : '', sub: `${sum((row) => row.payments)} encaissements` },
          {
            label: 'Honoraires TTC',
            value: data ? formatCents(sum((row) => row.feesGross)) : '',
            sub: `${ready.filter((row) => row.feesGross > 0).length} factures de commission`,
          },
          {
            label: 'Reporté',
            value: data ? formatCents(deferred.reduce((all, row) => all + row.collected, 0)) : '',
            sub: `${deferred.length} créancier${deferred.length > 1 ? 's' : ''} sous le seuil`,
            tone: deferred.length ? 'warning' : undefined,
          },
        ]}
        actions={[
          { label: 'Facturation', href: '/facturation' },
          ...(tab === 'draft' && ready.length ? [{ label: 'Valider le lot', primary: true, kbd: 'N', onPress: validate }] : []),
        ]}
      />
      <Onglets
        label="Étapes des reversements"
        items={TABS.map(([id, label]) => ({
          label,
          count: id === 'draft' ? ready.length : id === 'todo' ? todo.length : paid.length,
          selected: tab === id,
          pick: () => setTab(id),
        }))}
      />
      <ol className={css.steps} aria-label="Déroulement d’un lot">
        {STEPS.map(([title, text], index) => (
          <li key={title} className={css.step} aria-current={(tab === 'draft' ? 1 : tab === 'todo' ? 2 : 3) === index ? 'step' : undefined}>
            <span className={css.number} aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
          </li>
        ))}
      </ol>
      {tab === 'draft' && (
        <>
          {blocked.map((row) => (
            <Alerte
              key={row.creditorId}
              tone="warning"
              title={`${row.creditor} : ${REMITTANCE_STATE_LABELS[row.state].toLowerCase()}`}
              text={
                row.state === 'NO_ACCOUNT'
                  ? 'Aucun compte de reversement confirmé par téléphone : ses encaissements attendent le lot suivant.'
                  : 'Un dossier encaissé n’a pas de mandat : sa commission ne peut pas être calculée.'
              }
              actionLabel="Voir le créancier"
              actionHref={`/creanciers/${row.creditorId}`}
            />
          ))}
          <Carte title="Lot à valider" badge="À valider" badgeTone="warning" description="Calculé par l’application, non modifiable à la main." padding="none">
            <Tableau
              caption="Reversements du lot à valider"
              hideCaption
              columns={columns(retain)}
              rows={rows}
              rowId={(row) => row.creditorId}
              dense
              tight
              state={
                draft.error
                  ? { kind: 'error', onAction: () => void draft.refetch() }
                  : draft.isPending
                    ? { kind: 'loading' }
                    : rows.length
                      ? undefined
                      : { kind: 'empty', title: 'Rien à reverser', text: 'Aucun chèque encaissé ni virement rapproché depuis le dernier lot.' }
              }
            />
            <p className={css.note}>
              <strong>
                {ready.length} virement{ready.length > 1 ? 's' : ''} · {formatCents(total)} à verser.
              </strong>{' '}
              Seuls comptent les chèques encaissés et les virements rapprochés. Honoraires retenus TVA comprise ; frais refacturés jamais déduits.
            </p>
          </Carte>
        </>
      )}
      {tab !== 'draft' && <Batches items={tab === 'todo' ? todo : paid} onPaid={tab === 'todo' ? markPaid : undefined} loading={batches.isPending} />}
    </>
  );
}

function Batches({
  items,
  onPaid,
  loading,
}: {
  items: z.infer<typeof remittanceBatches>['items'];
  onPaid?: (batch: z.infer<typeof remittanceBatches>['items'][number]) => void;
  loading: boolean;
}) {
  if (loading) return <EtatListe kind="loading" />;
  if (!items.length) return <EtatListe kind="empty" title={onPaid ? 'Aucun virement à faire' : 'Aucun reversement versé'} />;
  return (
    <>
      {items.map((batch) => (
        <BatchCard key={batch.id} id={batch.id} onPaid={onPaid ? () => onPaid(batch) : undefined} />
      ))}
    </>
  );
}

function BatchCard({ id, onPaid }: { id: string; onPaid?: () => void }) {
  const { data, isPending, error, refetch } = useApi(remittanceBatch, `/remittances/${id}`);
  if (!data) return <EtatListe kind={error ? 'error' : isPending ? 'loading' : 'empty'} onAction={() => void refetch()} />;
  return (
    <Carte
      title={`Lot du ${formatDate(data.validatedAt.slice(0, 10))}`}
      badge={data.status === 'PAID' ? `Versé le ${formatDate(data.paidOn ?? '')}` : 'Virements à faire'}
      badgeTone={data.status === 'PAID' ? 'success' : 'warning'}
      description={`Paiements jusqu’au ${formatDate(data.until)} · validé par ${data.validatedBy} · ${formatCents(data.total)} en ${data.transfers} virement${data.transfers > 1 ? 's' : ''}`}
      padding="none"
      footer={onPaid ? <Bouton label="Marquer comme versés" variant="primary" onPress={onPaid} /> : undefined}
    >
      <Tableau
        caption={`Reversements du lot du ${formatDate(data.validatedAt.slice(0, 10))}`}
        columns={columns()}
        rows={data.rows}
        rowId={(row) => row.creditorId}
        dense
        tight
      />
    </Carte>
  );
}
