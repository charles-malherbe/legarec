import { formatCents, formatDate, type DebtorCase } from '@legarec/contracts';
import { download, saveFile } from '@legarec/platform';
import { Alerte, Badge, Bouton, EtatListe, Tableau, useConfirm, useToast, type Tone } from '@legarec/ui';
import { useNavigate } from 'react-router';
import css from '../app/Debtor.module.css';
import { useChange } from '../app/data';
import { useCase } from '../app/Space';

const STATUS: Record<string, [string, Tone]> = {
  PAID: ['Payée', 'success'],
  DUE: ['À payer', 'warning'],
  UPCOMING: ['À venir', 'neutral'],
  LATE: ['En retard', 'danger'],
};
const euros = (value: number) => formatCents(value, { decimals: 'always' });
type Plan = NonNullable<DebtorCase['plan']>;

/** Downloads a file of the API under the neutral name it gives; a failure is said, never silent. */
function useDownload() {
  const toast = useToast();
  return async (path: string) => {
    try {
      const { blob, name } = await download(path);
      saveFile(blob, name);
    } catch {
      toast({ message: 'Le téléchargement n’a pas abouti. Réessayez dans un instant.', tone: 'danger' });
    }
  };
}

export function PlanPage() {
  const item = useCase();
  const navigate = useNavigate();
  const save = useDownload();
  return (
    <div className={css.columns}>
      <section aria-labelledby="plan-titre" className={css.panel}>
        <h2 id="plan-titre">{item.plan && !item.plan.acceptedOn ? 'Échéancier proposé' : 'Mes mensualités'}</h2>
        {!item.plan ? (
          <EtatListe
            kind="empty"
            title="Aucun échéancier"
            text="Vous pouvez proposer un paiement en plusieurs fois."
            actionLabel="Proposer un échéancier"
            onAction={() => void navigate('/espace/demandes')}
          />
        ) : item.plan.acceptedOn ? (
          <>
            <p role="status">Échéancier accepté le {formatDate(item.plan.acceptedOn)}. Les relances sont suspendues tant que les mensualités sont réglées.</p>
            <Installments plan={item.plan} withStatus />
            <div className={css.inline}>
              <Bouton label="Voir les moyens de paiement" href="/espace/payer" />
              <Bouton
                variant="secondary"
                label="Télécharger l’échéancier (PDF)"
                disabled={!item.plan.fingerprint}
                title={item.plan.fingerprint ? undefined : 'Document indisponible'}
                onPress={() => void save(`/debtor/cases/${item.id}/plan/file`)}
              />
            </div>
          </>
        ) : (
          <Proposed item={item} plan={item.plan} onDownload={() => void save(`/debtor/cases/${item.id}/plan/file`)} />
        )}
      </section>
      <aside className={css.stack}>
        <section aria-labelledby="hist-titre" className={css.panel}>
          <h2 id="hist-titre">Mes paiements</h2>
          {item.payments.length === 0 ? (
            <p>Aucun paiement reçu.</p>
          ) : (
            <ul className={css.list}>
              {item.payments.map((payment) => (
                <li key={payment.id}>
                  <span className={css.text}>
                    {euros(payment.amount)}
                    <small>
                      {formatDate(payment.date)} · {payment.method === 'TRANSFER' ? 'Virement' : 'Chèque'}
                    </small>
                  </span>
                  {payment.receiptId ? (
                    <Bouton
                      variant="link"
                      size="sm"
                      label="Quittance"
                      ariaLabel={`Quittance de ${euros(payment.amount)}`}
                      disabled={!payment.receiptFile}
                      title={payment.receiptFile ? undefined : 'Quittance en préparation'}
                      onPress={() => void save(`/debtor/cases/${item.id}/receipts/${payment.receiptId}/file`)}
                    />
                  ) : (
                    <Badge label="En attente" tone="neutral" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

function Installments({ plan, withStatus = false }: { plan: Plan; withStatus?: boolean }) {
  return (
    <Tableau
      caption="Mensualités"
      hideCaption
      rows={plan.installments}
      rowId={(row) => String(row.number)}
      columns={[
        { key: 'number', label: 'N°', render: (row) => `${row.number}/${plan.installments.length}` },
        { key: 'due', label: 'Échéance', render: (row) => formatDate(row.dueOn) },
        { key: 'amount', label: 'Montant', align: 'right', render: (row) => euros(row.amount) },
        ...(withStatus
          ? [
              {
                key: 'status',
                label: 'Statut',
                render: (row: Plan['installments'][number]) => <Badge label={STATUS[row.status]?.[0] ?? ''} tone={STATUS[row.status]?.[1] ?? 'neutral'} />,
              },
            ]
          : []),
      ]}
    />
  );
}

/** « Accepter cet échéancier » (question 76): the debtor accepts the very PDF it can read, as it was shown. */
function Proposed({ item, plan, onDownload }: { item: DebtorCase; plan: Plan; onDownload: () => void }) {
  const confirm = useConfirm();
  const change = useChange();
  const toast = useToast();
  const first = plan.installments[0];
  const ready = plan.fingerprint !== null;
  const accept = () =>
    confirm({
      title: 'Accepter cet échéancier ?',
      body: 'Vous vous engagez à régler chaque mensualité à sa date. La date de votre accord et l’empreinte du document sont conservées.',
      details: [
        { k: 'Dossier', v: item.reference },
        { k: 'Montant total', v: euros(plan.total) },
        { k: 'Mensualités', v: String(plan.installments.length) },
        ...(first ? [{ k: 'Première échéance', v: `${formatDate(first.dueOn)} · ${euros(first.amount)}` }] : []),
        { k: 'Moyen de paiement', v: plan.method === 'TRANSFER' ? 'Virement' : 'Chèque' },
      ],
      check: { label: 'J’ai lu l’échéancier et j’accepte de le respecter.', required: true },
      confirmLabel: 'Accepter l’échéancier',
      onConfirm: async () => {
        await change(`/debtor/cases/${item.id}/plan/acceptance`, {
          body: { fingerprint: plan.fingerprint, total: plan.total, months: plan.installments.length },
        });
        toast({ message: 'Échéancier accepté. Les relances sont suspendues tant que les mensualités sont réglées.' });
      },
    });
  return (
    <>
      <Alerte
        tone="info"
        text={`Legarec vous propose de régler ${euros(plan.total)} en ${plan.installments.length} mensualités. L’échéancier prend effet lorsque vous l’acceptez.`}
      />
      <Installments plan={plan} />
      {!ready && <p role="status">Le document de l’échéancier est en préparation : revenez dans quelques minutes pour l’accepter.</p>}
      <div className={css.inline}>
        <Bouton label="Accepter cet échéancier" disabled={!ready} onPress={accept} />
        <Bouton variant="secondary" label="Télécharger l’échéancier (PDF)" disabled={!ready} onPress={onDownload} />
      </div>
    </>
  );
}
