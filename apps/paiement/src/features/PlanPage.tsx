import { formatCents, formatDate } from '@legarec/contracts';
import { Badge, Bouton, EtatListe, Tableau, type Tone } from '@legarec/ui';
import { useNavigate } from 'react-router';
import css from '../app/Debtor.module.css';
import { useCase } from '../app/Space';

const STATUS: Record<string, [string, Tone]> = {
  PAID: ['Payée', 'success'],
  DUE: ['À payer', 'warning'],
  UPCOMING: ['À venir', 'neutral'],
  LATE: ['En retard', 'danger'],
};
const euros = (value: number) => formatCents(value, { decimals: 'always' });

export function PlanPage() {
  const item = useCase();
  const navigate = useNavigate();
  return (
    <div className={css.columns}>
      <section aria-labelledby="plan-titre" className={css.panel}>
        <h2 id="plan-titre">Mes mensualités</h2>
        {!item.plan ? (
          <EtatListe
            kind="empty"
            title="Aucun échéancier"
            text="Vous pouvez proposer un paiement en plusieurs fois."
            actionLabel="Proposer un échéancier"
            onAction={() => void navigate('/espace/demandes')}
          />
        ) : (
          <>
            <p role="status">Échéancier accepté le {formatDate(item.plan.acceptedOn)}. Les relances sont suspendues tant que les mensualités sont réglées.</p>
            <Tableau
              caption="Mes mensualités"
              hideCaption
              rows={item.plan.installments}
              rowId={(row) => String(row.number)}
              columns={[
                { key: 'number', label: 'N°', render: (row) => `${row.number}/${item.plan?.installments.length}` },
                { key: 'due', label: 'Échéance', render: (row) => formatDate(row.dueOn) },
                { key: 'amount', label: 'Montant', align: 'right', render: (row) => euros(row.amount) },
                {
                  key: 'status',
                  label: 'Statut',
                  render: (row) => <Badge label={STATUS[row.status]?.[0] ?? ''} tone={STATUS[row.status]?.[1] ?? 'neutral'} />,
                },
              ]}
            />
            <div className={css.inline}>
              <Bouton label="Voir les moyens de paiement" href="/espace/payer" />
              <Bouton variant="secondary" label="Télécharger l’échéancier (PDF)" disabled title="Disponible avec l’API" />
            </div>
          </>
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
                      disabled
                      title="Disponible avec l’API"
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
