import { canAccessBilling, formatDate, GDPR_LABELS, gdprExport, gdprRegistry, type GdprRequest } from '@legarec/contracts';
import { saveFile } from '@legarec/platform';
import { Badge, Bouton, Carte, EtatListe, Tableau, useConfirm, useToast } from '@legarec/ui';
import { useApi, useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '../../shared/layout.module.css';

/** Register of the people's requests; one month to answer. Named debtors: Director or administrative delegate only. */
export function GdprRegistryCard() {
  const user = useCurrentUser();
  const allowed = canAccessBilling(user);
  const { data, error, refetch } = useApi(gdprRegistry, '/gdpr/requests', { enabled: allowed });
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  if (!allowed) return null;
  const answer = (item: GdprRequest, status: 'ANSWERED' | 'REFUSED') =>
    confirm({
      tone: status === 'REFUSED' ? 'danger' : 'primary',
      title: status === 'ANSWERED' ? 'Marquer cette demande comme traitée ?' : 'Refuser cette demande ?',
      body: status === 'ANSWERED' ? 'La réponse doit avoir été envoyée au débiteur.' : 'Le refus doit être motivé auprès du débiteur.',
      details: [
        { k: 'Débiteur', v: item.debtor },
        { k: 'Demande', v: GDPR_LABELS[item.kind] },
        { k: 'Échéance', v: formatDate(item.dueOn) },
      ],
      reasonLabel: status === 'REFUSED' ? 'Motif du refus' : 'Réponse apportée',
      confirmLabel: status === 'ANSWERED' ? 'Marquer comme traitée' : 'Refuser la demande',
      onConfirm: async (reason) => {
        await change(`/gdpr/requests/${item.id}`, { method: 'PUT', body: { status, reason } });
        toast({ message: 'Registre mis à jour.' });
      },
    });
  const download = (item: GdprRequest) =>
    confirm({
      title: 'Exporter les données de ce débiteur ?',
      body: 'Le fichier contient des données personnelles. L’export est inscrit au journal d’audit.',
      details: [{ k: 'Débiteur', v: item.debtor }],
      confirmLabel: 'Exporter les données',
      onConfirm: async () => {
        const file = await change(`/gdpr/requests/${item.id}/export`, { schema: gdprExport });
        saveFile(new Blob([JSON.stringify(file.content, null, 2)], { type: 'application/json' }), file.fileName);
      },
    });
  const open = data?.items.filter((item) => item.status === 'OPEN').length ?? 0;
  return (
    <Carte title="Registre des demandes" description={data ? `${open} demandes en cours · un mois pour répondre` : ''} padding="none">
      {!data ? (
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EtatListe kind="empty" title="Aucune demande" text="Les demandes enregistrées depuis les fiches débiteur apparaissent ici." />
      ) : (
        <Tableau
          caption="Registre des demandes"
          hideCaption
          bordered={false}
          rows={data.items}
          rowId={(row) => row.id}
          columns={[
            {
              key: 'debtor',
              label: 'Débiteur',
              render: (row) => (
                <span className={layout.text}>
                  <span className={layout.strong}>{row.debtor}</span>
                  <span className={layout.hint}>{row.origin}</span>
                </span>
              ),
            },
            { key: 'kind', label: 'Demande', render: (row) => GDPR_LABELS[row.kind] },
            { key: 'received', label: 'Reçue le', render: (row) => formatDate(row.receivedOn) },
            {
              key: 'due',
              label: 'À traiter avant le',
              render: (row) => (
                <span className={layout.inline}>
                  {formatDate(row.dueOn)}
                  {row.status === 'OPEN' ? (
                    <Badge label={`${row.daysLeft} jours`} tone={row.daysLeft <= 10 ? 'danger' : 'info'} />
                  ) : (
                    <Badge label={row.status === 'ANSWERED' ? 'Traitée' : 'Refusée'} tone={row.status === 'ANSWERED' ? 'success' : 'neutral'} />
                  )}
                </span>
              ),
            },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) =>
                row.status === 'OPEN' ? (
                  <span className={layout.inline}>
                    <Bouton variant="secondary" size="xs" label="Exporter" ariaLabel={`Exporter les données : ${row.debtor}`} onPress={() => download(row)} />
                    <Bouton variant="secondary" size="xs" label="Traitée" ariaLabel={`Traitée : ${row.debtor}`} onPress={() => answer(row, 'ANSWERED')} />
                    <Bouton variant="ghost" size="xs" label="Refuser" ariaLabel={`Refuser : ${row.debtor}`} onPress={() => answer(row, 'REFUSED')} />
                  </span>
                ) : null,
            },
          ]}
        />
      )}
    </Carte>
  );
}
