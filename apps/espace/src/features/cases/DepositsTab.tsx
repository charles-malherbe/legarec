import { depositAccepted, depositRefusal, formatCents, formatDate, type DepositItem, type depositsData } from '@legarec/contracts';
import { Bouton, Tableau, useConfirm, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { ApiError } from '../../app/api';
import { useChange } from '../../app/data';
import { listState } from '../../shared/listState';

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

/**
 * Claims deposited by creditors, waiting for the Director or the manager before they become cases (question 155). What the
 * creditor gave is shown as it gave it: the name is checked once the case is open.
 */
export function DepositsTab({
  data,
  pending,
  error,
  onRetry,
}: {
  data: z.infer<typeof depositsData> | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const rows = data?.items ?? [];
  const state = listState({
    pending,
    error,
    count: rows.length,
    query: '',
    empty: 'Aucune créance déposée à valider',
    emptyText: 'Les créances déposées par les créanciers dans leur portail attendent ici avant de devenir des dossiers.',
    noResultText: '',
    errorTitle: 'Impossible de charger les créances déposées',
    onRetry,
    onClear: () => undefined,
  });
  const details = (row: DepositItem) => [
    { k: 'Créancier', v: row.creditor },
    { k: 'Débiteur (nom donné)', v: `${row.debtor} · ${row.identifier}` },
    { k: 'Adresse', v: row.address || '—' },
    { k: 'Contacts (non vérifiés)', v: [row.email, row.phone].filter(Boolean).join(' · ') || '—' },
    {
      k: 'Factures',
      v: `${row.invoices.map((line) => `${line.number} (${formatCents(line.amount)}, échue le ${formatDate(line.dueOn)})`).join(', ')} · ${formatCents(row.total)}`,
    },
    { k: 'Pièces', v: row.files ? plural(row.files, 'pièce') : 'Aucune' },
  ];
  const changed = (failure: unknown) => {
    if (!(failure instanceof ApiError) || failure.status !== 409) throw failure;
    const exists = (failure.body as { code?: string } | undefined)?.code === 'CASE_EXISTS';
    toast({
      tone: 'danger',
      message: exists
        ? 'Un dossier de ce créancier est déjà ouvert pour ce débiteur : refusez ce dépôt ou complétez le dossier.'
        : 'Ce dépôt vient de changer : vérifiez-le avant de décider.',
    });
  };
  const open = (row: DepositItem) =>
    confirm({
      title: 'Ouvrir le dossier ?',
      body: 'Le dossier s’ouvre sans gestionnaire, sous le mandat en vigueur du créancier. Le nom donné par le créancier reste à vérifier dans son historique.',
      details: details(row),
      confirmLabel: 'Ouvrir le dossier',
      onConfirm: async () => {
        let caseId: string;
        try {
          ({ caseId } = await change(`/deposits/${row.id}/accept`, { body: { expectedTotal: row.total }, schema: depositAccepted }));
        } catch (failure) {
          return changed(failure);
        }
        toast({ message: 'Dossier ouvert.' });
        void navigate(`/debiteurs/${caseId}`);
      },
    });
  const refuse = (row: DepositItem) =>
    confirm({
      tone: 'danger',
      title: 'Refuser cette créance ?',
      body: 'Aucun dossier n’est ouvert. Le motif est gardé 30 jours avec le dépôt. Le créancier n’en est pas informé automatiquement : prévenez-le vous-même.',
      details: details(row),
      reasonLabel: 'Motif du refus',
      reasonHelp: 'Obligatoire, 5 caractères au moins · gardé 30 jours avec le dépôt, jamais dans le journal d’audit',
      confirmLabel: 'Refuser la créance',
      onConfirm: async (reason) => {
        const parsed = depositRefusal.safeParse({ reason });
        if (!parsed.success) return toast({ tone: 'danger', message: parsed.error.issues[0]?.message ?? 'Motif invalide.' });
        try {
          await change(`/deposits/${row.id}/refuse`, { body: parsed.data });
        } catch (failure) {
          return changed(failure);
        }
        toast({ message: 'Créance refusée.' });
      },
    });
  return (
    <section aria-label="Créances déposées à valider" className={layout.card}>
      <Tableau
        caption="Créances déposées à valider"
        hideCaption
        tight
        bordered={false}
        rows={rows}
        rowId={(row) => row.id}
        rowLabel={(row) => row.debtor}
        state={state}
        columns={[
          {
            key: 'debtor',
            label: 'Débiteur (nom donné)',
            render: (row) => (
              <span className={layout.text}>
                <strong className={layout.strong}>{row.debtor}</strong>
                <span className={layout.hint}>{row.identifier}</span>
              </span>
            ),
          },
          { key: 'creditor', label: 'Créancier', value: (row) => row.creditor },
          {
            key: 'invoices',
            label: 'Factures',
            align: 'right',
            render: (row) => (
              <span className={layout.text}>
                <strong className={layout.num}>{formatCents(row.total)}</strong>
                <span className={layout.hint}>
                  {plural(row.invoices.length, 'facture')}
                  {row.files ? ` · ${plural(row.files, 'pièce')}` : ''}
                </span>
              </span>
            ),
          },
          { key: 'on', label: 'Déposée le', value: (row) => formatDate(row.depositedOn) },
          {
            key: 'actions',
            label: 'Décision',
            align: 'right',
            render: (row) => (
              <span className={layout.inline}>
                <Bouton size="sm" label="Ouvrir le dossier" ariaLabel={`Ouvrir le dossier de ${row.debtor}`} onPress={() => open(row)} />
                <Bouton variant="danger-outline" size="sm" label="Refuser" ariaLabel={`Refuser la créance de ${row.debtor}`} onPress={() => refuse(row)} />
              </span>
            ),
          },
        ]}
      />
    </section>
  );
}
