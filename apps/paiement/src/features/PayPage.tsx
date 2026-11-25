import { formatCents } from '@legarec/contracts';
import { Bouton } from '@legarec/ui';
import css from '../app/Debtor.module.css';
import { useCase } from '../app/Space';
import { PaymentMeans } from './PaymentMeans';

export function PayPage() {
  const item = useCase();
  return (
    <div className={css.columns}>
      <section aria-labelledby="payer-titre" className={css.panel}>
        <h2 id="payer-titre">Payer {formatCents(item.balance, { decimals: 'always' })}</h2>
        <p>Vous pouvez régler la totalité ou une partie ; le solde restant reste dû.</p>
        <PaymentMeans payment={item.payment} />
      </section>
      <aside className={css.stack}>
        <section className={css.panel}>
          <h2>Vous avez déjà payé ?</h2>
          <p>Signalez votre paiement et joignez un justificatif : votre dossier est mis à jour plus vite.</p>
          <Bouton variant="secondary" label="Signaler un paiement" href="/espace/demandes" />
        </section>
      </aside>
    </div>
  );
}
