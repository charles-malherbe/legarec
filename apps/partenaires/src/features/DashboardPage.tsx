import { formatCents, formatDate, PORTAL_STATUS_LABELS, portalDashboard, type PlanApproval, type PortalStatus } from '@legarec/contracts';
import { Alerte, Bouton, EtatListe, useConfirm, useToast } from '@legarec/ui';
import { Link } from 'react-router';
import css from '../app/Portal.module.css';
import { useApi, useChange, usePartner } from '../app/data';

export const STATUS_COLOR: Record<PortalStatus, string> = {
  NEW: 'var(--text-3)',
  REMINDING: 'var(--info)',
  PLAN: 'var(--warning)',
  LITIGATION: 'var(--danger)',
  SETTLED: 'var(--success)',
  LOST: 'var(--text-2)',
};

export function DashboardPage() {
  const user = usePartner();
  const { data, error, refetch } = useApi(portalDashboard, '/portal/dashboard');
  const total = data?.statuses.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const highest = Math.max(1, ...(data?.months.map((item) => item.amount) ?? []));
  return (
    <>
      <div className={css.heading}>
        <div>
          <h1>Bonjour {user.firstName}</h1>
          <p>Suivi de vos créances confiées à Legarec · année 2026</p>
        </div>
        <span className={css.hint}>
          Votre gestionnaire : <strong>{user.officer}</strong>
        </span>
      </div>
      {!data ? (
        <div className={css.panel}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      ) : (
        <>
          {data.approvals
            .filter((item) => item.status === 'PENDING')
            .map((item) => (
              <Approval key={item.id} item={item} />
            ))}
          <section aria-label="Indicateurs" className={css.kpis}>
            {data.kpis.map((item) => (
              <div key={item.label} className={css.kpi}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.hint}</small>
              </div>
            ))}
          </section>
          <div className={css.two}>
            <section aria-labelledby="rep-titre" className={css.panel}>
              <h2 id="rep-titre">Vos {total} dossiers par statut</h2>
              <div role="img" aria-label={data.statuses.map((item) => `${PORTAL_STATUS_LABELS[item.status]} ${item.count}`).join(', ')} className={css.bar}>
                {data.statuses.map((item) => (
                  <span key={item.status} style={{ flex: item.count, background: STATUS_COLOR[item.status] }} />
                ))}
              </div>
              <ul className={css.legend}>
                {data.statuses.map((item) => (
                  <li key={item.status}>
                    <Link to={`/dossiers?statut=${item.status}`}>
                      <span aria-hidden className={css.dot} style={{ background: STATUS_COLOR[item.status] }} />
                      {PORTAL_STATUS_LABELS[item.status]}
                      <strong>{item.count}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="mois-titre" className={css.panel}>
              <h2 id="mois-titre">Sommes recouvrées par mois</h2>
              <div
                role="img"
                aria-label={`Recouvré par mois : ${data.months.map((item) => `${item.label} ${formatCents(item.amount)}`).join(', ')}`}
                className={css.months}
              >
                {data.months.map((item) => (
                  <div key={item.label} className={css.month}>
                    <strong>{Math.round(item.amount / 100_000)} k€</strong>
                    <div className={css.column} style={{ height: Math.round((item.amount / highest) * 121) }} />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section aria-labelledby="act-titre" className={css.panel} data-flush>
            <h2 id="act-titre">Dernières actions sur vos dossiers</h2>
            <ul className={css.activity}>
              {data.activity.map((item) => (
                <li key={item.id}>
                  <span aria-hidden className={css.round} style={{ background: `var(--${item.tone})` }} />
                  <span>
                    <strong>{item.who}</strong> · {item.what}
                  </span>
                  <span className={css.when}>{item.when}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

/** Agreement of the creditor on a plan longer than the mandate allows. */
function Approval({ item }: { item: PlanApproval }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const decide = (accepted: boolean) =>
    confirm({
      tone: accepted ? 'primary' : 'danger',
      title: accepted ? 'Accepter cet échéancier ?' : 'Refuser cet échéancier ?',
      body: accepted
        ? 'Votre gestionnaire est prévenu et le plan est proposé au débiteur.'
        : 'Votre gestionnaire est prévenu et recherche une autre solution avec le débiteur.',
      details: [
        { k: 'Débiteur', v: item.debtor },
        { k: 'Dossier', v: item.reference },
        { k: 'Plan', v: `${item.months} mensualités de ${formatCents(item.installment)}` },
        { k: 'Total', v: formatCents(item.total) },
        { k: 'Première échéance', v: formatDate(item.firstOn) },
      ],
      reasonLabel: accepted ? undefined : 'Motif du refus',
      confirmLabel: accepted ? 'Accepter l’échéancier' : 'Refuser l’échéancier',
      onConfirm: async (reason) => {
        await change(`/portal/plans/${item.id}/decision`, { body: { accepted, reason } });
        toast({ message: accepted ? 'Échéancier accepté.' : 'Échéancier refusé.' });
      },
    });
  return (
    <Alerte
      tone="warning"
      title={`Votre accord est demandé : échéancier de ${item.months} mois pour ${item.debtor}`}
      text={`${item.months} mensualités de ${formatCents(item.installment)} à partir du ${formatDate(item.firstOn)}, soit ${formatCents(item.total)}. ${item.reason}`}
    >
      <div className={css.inline}>
        <Bouton size="sm" label="Accepter" ariaLabel={`Accepter : ${item.debtor}`} onPress={() => decide(true)} />
        <Bouton size="sm" variant="danger-outline" label="Refuser" ariaLabel={`Refuser : ${item.debtor}`} onPress={() => decide(false)} />
      </div>
    </Alerte>
  );
}
