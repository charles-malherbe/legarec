import { allocatePayment, formatCents, formatDate, newPayment, parseCents, PAYMENT_STATUS_LABELS, type CaseDetail, type Payment } from '@legarec/contracts';
import { Badge, Bouton, Carte, Case, Champ, Onglets, Tableau, useConfirm, useToast, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

const TONE: Record<Payment['status'], Tone> = {
  RECEIVED: 'info',
  DEPOSITED: 'warning',
  CASHED: 'success',
  BOUNCED: 'danger',
  RECONCILED: 'success',
  TO_RECONCILE: 'warning',
};
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());

export function PaymentForm({ data, onClose }: { data: CaseDetail; onClose: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [method, setMethod] = useState<'CHEQUE' | 'TRANSFER'>('CHEQUE');
  const [amount, setAmount] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [bank, setBank] = useState('');
  const [receivedOn, setReceivedOn] = useState(today);
  const [depositedOn, setDepositedOn] = useState('');
  const [label, setLabel] = useState(data.reference);
  const [reconciled, setReconciled] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const value = parseCents(amount) ?? 0;
  const split = allocatePayment(value, { interest: data.interest, principal: data.principal, fees: data.fees });

  const submit = () => {
    const parsed = newPayment.safeParse(
      method === 'CHEQUE'
        ? { method, amount: value, chequeNumber, bank, receivedOn, depositedOn: depositedOn || null }
        : { method, amount: value, receivedOn, label, reconciled },
    );
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    const body = parsed.data;
    confirm({
      title: 'Enregistrer ce paiement ?',
      body:
        method === 'CHEQUE'
          ? 'La quittance sera générée à l’encaissement du chèque.'
          : reconciled
            ? 'Le virement est rapproché du dossier : la quittance est générée immédiatement.'
            : 'La quittance sera générée au rapprochement du virement.',
      confirmLabel: 'Enregistrer le paiement',
      details: [
        { k: 'Dossier', v: `${data.name} · ${data.reference}` },
        { k: 'Moyen', v: method === 'CHEQUE' ? `Chèque ${chequeNumber} · ${bank}` : `Virement · ${label}` },
        { k: 'Montant', v: formatCents(value) },
        { k: 'Imputation prévue', v: `Intérêts ${formatCents(split.interest)} · principal ${formatCents(split.principal)}` },
      ],
      onConfirm: async () => {
        await change(`/cases/${data.id}/payments`, { body });
        toast({ message: 'Paiement enregistré.' });
        onClose();
      },
    });
  };
  return (
    <Carte title="Enregistrer un paiement" description="Chèque ou virement uniquement" actionLabel="Fermer" onAction={onClose}>
      <div className={layout.stack}>
        <Onglets
          label="Moyen de paiement"
          items={[
            { label: 'Chèque', selected: method === 'CHEQUE', pick: () => setMethod('CHEQUE') },
            { label: 'Virement', selected: method === 'TRANSFER', pick: () => setMethod('TRANSFER') },
          ]}
          layout={{ alignSelf: 'flex-start' }}
        />
        <div className={layout.form}>
          <Champ label="Montant" inputMode="decimal" suffix="€" required value={amount} error={errors.amount} onChange={setAmount} />
          {method === 'CHEQUE' ? (
            <>
              <Champ label="Numéro du chèque" inputMode="numeric" required value={chequeNumber} error={errors.chequeNumber} onChange={setChequeNumber} />
              <Champ label="Banque" required value={bank} error={errors.bank} onChange={setBank} />
              <Champ label="Date de réception" type="date" required value={receivedOn} error={errors.receivedOn} onChange={setReceivedOn} />
              <Champ label="Date de remise" type="date" optional value={depositedOn} error={errors.depositedOn} onChange={setDepositedOn} />
            </>
          ) : (
            <>
              <Champ label="Date du virement" type="date" required value={receivedOn} error={errors.receivedOn} onChange={setReceivedOn} />
              <Champ label="Libellé reçu" required value={label} error={errors.label} onChange={setLabel} />
            </>
          )}
        </div>
        {method === 'TRANSFER' && (
          <Case label="Rapproché avec ce dossier" description="Le libellé et le montant correspondent." checked={reconciled} onToggle={setReconciled} />
        )}
        {value > 0 && (
          <p className={layout.muted}>
            Imputation : intérêts {formatCents(split.interest)}, principal {formatCents(split.principal)}, frais {formatCents(split.fees)}
            {split.remainder > 0 && `, trop-perçu ${formatCents(split.remainder)}`}. Le calcul définitif est fait par l’API.
          </p>
        )}
        <div className={layout.end}>
          <Bouton variant="secondary" label="Annuler" onPress={onClose} />
          <Bouton label="Enregistrer le paiement" onPress={submit} />
        </div>
      </div>
    </Carte>
  );
}

export function PaymentsCard({ data }: { data: CaseDetail }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const settle = (payment: Payment, status: 'CASHED' | 'BOUNCED' | 'RECONCILED') => {
    const bounced = status === 'BOUNCED';
    confirm({
      tone: bounced ? 'danger' : 'primary',
      title: bounced ? 'Déclarer ce chèque impayé ?' : status === 'CASHED' ? 'Confirmer l’encaissement ?' : 'Rapprocher ce virement ?',
      body: bounced
        ? 'Le paiement est annulé, le montant dû est rétabli et le suivi du dossier reprend.'
        : 'Le paiement devient définitif et la quittance est générée.',
      confirmLabel: bounced ? 'Déclarer impayé' : 'Confirmer',
      reasonLabel: bounced ? 'Motif du rejet' : undefined,
      details: [
        { k: 'Dossier', v: data.name },
        { k: 'Montant', v: formatCents(payment.amount) },
        ...(payment.chequeNumber ? [{ k: 'Chèque', v: payment.chequeNumber }] : []),
      ],
      onConfirm: async (reason) => {
        await change(`/cases/${data.id}/payments/${payment.id}`, { method: 'PUT', body: { status, reason } });
        toast({
          message: bounced ? 'Chèque impayé : paiement annulé, suivi repris.' : 'Paiement définitif, quittance générée.',
          tone: bounced ? 'danger' : 'success',
        });
      },
    });
  };
  return (
    <Carte title="Paiements et quittances" padding="none">
      <Tableau
        caption="Paiements"
        hideCaption
        bordered={false}
        rows={data.payments}
        rowId={(row) => row.id}
        emptyTitle="Aucun paiement enregistré"
        columns={[
          { key: 'date', label: 'Reçu le', value: (row) => formatDate(row.receivedOn) },
          {
            key: 'method',
            label: 'Moyen',
            value: (row) =>
              row.method === 'CHEQUE' ? { text: 'Chèque', sub: `${row.chequeNumber} · ${row.bank}` } : { text: 'Virement', sub: row.label ?? undefined },
          },
          {
            key: 'amount',
            label: 'Montant',
            align: 'right',
            value: (row) => ({ text: formatCents(row.amount), strong: true, sub: `dont intérêts ${formatCents(row.allocation.interest)}` }),
          },
          { key: 'status', label: 'Statut', render: (row) => <Badge label={PAYMENT_STATUS_LABELS[row.status]} tone={TONE[row.status]} /> },
          {
            key: 'actions',
            label: 'Suite',
            render: (row) => (
              <span className={layout.inline}>
                {row.receiptId && (
                  <Link to="/documents" className={layout.link}>
                    Quittance
                  </Link>
                )}
                {data.canAct && row.method === 'CHEQUE' && (row.status === 'RECEIVED' || row.status === 'DEPOSITED') && (
                  <>
                    <Bouton variant="secondary" size="xs" label="Encaissé" onPress={() => settle(row, 'CASHED')} />
                    <Bouton variant="danger-outline" size="xs" label="Impayé" onPress={() => settle(row, 'BOUNCED')} />
                  </>
                )}
                {data.canAct && row.status === 'TO_RECONCILE' && (
                  <Bouton variant="secondary" size="xs" label="Rapprocher" onPress={() => settle(row, 'RECONCILED')} />
                )}
              </span>
            ),
          },
        ]}
      />
    </Carte>
  );
}
