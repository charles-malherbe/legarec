import { formatCents, portalPayouts } from '@legarec/contracts';
import { Bouton, EtatListe, Tableau } from '@legarec/ui';
import css from '../app/Portal.module.css';
import { useApi } from '../app/data';

export function PayoutsPage() {
  const { data, error, refetch } = useApi(portalPayouts, '/portal/payouts');
  return (
    <>
      <div className={css.heading}>
        <div>
          <h1>Reversements</h1>
          <p>{data?.rateLabel ?? 'Sommes encaissées pour votre compte'}</p>
        </div>
      </div>
      {!data ? (
        <div className={css.panel}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      ) : (
        <>
          <section aria-label="Prochain reversement" className={css.kpis}>
            <div className={css.kpi}>
              <span>Prochain reversement · {data.next.date}</span>
              <strong>{formatCents(data.next.net)}</strong>
              <small>
                {formatCents(data.next.collected)} encaissés − {formatCents(data.next.fee)} de commission
              </small>
            </div>
            <div className={css.kpi}>
              <span>Reversé en 2026</span>
              <strong>{formatCents(data.year.paid)}</strong>
              <small>sur {formatCents(data.year.recovered)} recouvrés</small>
            </div>
            <div className={css.kpi}>
              <span>Commissions 2026</span>
              <strong>{formatCents(data.year.fees)}</strong>
              <small>8 % HT des sommes recouvrées</small>
            </div>
          </section>
          <section aria-label="Historique des reversements" className={css.panel} data-flush>
            {data.items.length === 0 ? (
              <EtatListe kind="empty" title="Aucun reversement" text="Vos reversements apparaîtront ici." />
            ) : (
              <Tableau
                caption="Historique des reversements"
                hideCaption
                bordered={false}
                rows={data.items}
                rowId={(row) => row.id}
                columns={[
                  {
                    key: 'date',
                    label: 'Date',
                    render: (row) => (
                      <span className={css.pick}>
                        {row.date}
                        <small>{row.count} encaissements</small>
                      </span>
                    ),
                  },
                  { key: 'collected', label: 'Encaissé', align: 'right', render: (row) => formatCents(row.collected) },
                  { key: 'fee', label: 'Commission', align: 'right', render: (row) => `− ${formatCents(row.fee)}` },
                  { key: 'net', label: 'Net reversé', align: 'right', render: (row) => formatCents(row.net) },
                  {
                    key: 'statement',
                    label: 'Relevé',
                    render: (row) => (
                      <span className={css.inline}>
                        <Bouton variant="link" size="sm" label="PDF" ariaLabel={`PDF : relevé du ${row.date}`} disabled title="Disponible avec l’API" />
                        <Bouton variant="link" size="sm" label="CSV" ariaLabel={`CSV : relevé du ${row.date}`} disabled title="Disponible avec l’API" />
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
