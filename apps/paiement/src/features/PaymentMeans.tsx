import type { PaymentInfo } from '@legarec/contracts';
import { Bouton, Onglets, useToast } from '@legarec/ui';
import { useState } from 'react';
import css from '../app/Debtor.module.css';

/** Transfer or cheque only: no online payment form anywhere. */
export function PaymentMeans({ payment }: { payment: PaymentInfo }) {
  const [means, setMeans] = useState<'transfer' | 'cheque'>('transfer');
  const toast = useToast();
  const copy = async (value: string, message: string) => {
    await navigator.clipboard.writeText(value);
    toast({ message });
  };
  const reference = payment.reference ?? 'Référence imprimée sur votre courrier';
  return (
    <>
      <Onglets
        label="Moyen de paiement"
        items={[
          { label: 'Virement', selected: means === 'transfer', pick: () => setMeans('transfer') },
          { label: 'Chèque', selected: means === 'cheque', pick: () => setMeans('cheque') },
        ]}
        layout={{ alignSelf: 'flex-start' }}
      />
      {means === 'transfer' ? (
        <>
          <dl className={css.facts}>
            <div>
              <dt>Bénéficiaire</dt>
              <dd>{payment.beneficiary}</dd>
            </div>
            <div>
              <dt>IBAN</dt>
              <dd>{payment.iban}</dd>
            </div>
            <div>
              <dt>BIC</dt>
              <dd>{payment.bic}</dd>
            </div>
            <div>
              <dt>Référence à indiquer (obligatoire)</dt>
              <dd>{reference}</dd>
            </div>
          </dl>
          <div className={css.inline}>
            <Bouton variant="secondary" size="sm" icon="copy" label="Copier l’IBAN" onPress={() => void copy(payment.iban, 'IBAN copié.')} />
            {payment.reference && (
              <Bouton variant="secondary" size="sm" icon="copy" label="Copier la référence" onPress={() => void copy(reference, 'Référence copiée.')} />
            )}
            <Bouton variant="secondary" size="sm" icon="download" label="Télécharger le RIB (PDF)" disabled title="Disponible avec l’API" />
          </div>
          <p className={css.hint}>Le dossier est mis à jour dès réception du virement (1 à 2 jours ouvrés).</p>
        </>
      ) : (
        <>
          <dl className={css.facts}>
            <div>
              <dt>À l’ordre de</dt>
              <dd>{payment.chequeOrder}</dd>
            </div>
            <div>
              <dt>À envoyer à</dt>
              <dd>{payment.chequeAddress}</dd>
            </div>
            <div>
              <dt>Au dos du chèque (obligatoire)</dt>
              <dd>{reference}</dd>
            </div>
          </dl>
          <p className={css.hint}>Le dossier est mis à jour après l’encaissement du chèque.</p>
        </>
      )}
    </>
  );
}
