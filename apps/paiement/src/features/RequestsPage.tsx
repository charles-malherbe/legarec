import { debtorRequest, DISPUTE_REASONS, formatCents, formatDate, parseCents, type DebtorRequest } from '@legarec/contracts';
import { Alerte, Bouton, Champ, DepotFichiers, Onglets, useConfirm } from '@legarec/ui';
import { useState, type ReactNode } from 'react';
import css from '../app/Debtor.module.css';
import { useChange } from '../app/data';
import { useCase } from '../app/Space';
import { ACCEPTED, sendFiles } from './uploads';

const KINDS = [
  ['PLAN', 'Proposer un échéancier'],
  ['DISPUTE', 'Contester la créance'],
  ['ALREADY_PAID', 'Signaler un paiement'],
  ['CALLBACK', 'Être rappelé'],
] as const;
const DONE: Record<DebtorRequest['kind'], string> = {
  PLAN: 'Demande envoyée. Elle est en attente de validation par un responsable. Les relances sont suspendues en attendant.',
  DISPUTE: 'Contestation enregistrée. Les relances sont suspendues pendant l’examen ; nous revenons vers vous par e-mail.',
  ALREADY_PAID: 'Merci, nous vérifions la réception de votre paiement. Une quittance vous sera remise quand il sera définitif.',
  CALLBACK: 'Demande enregistrée. Votre gestionnaire vous rappelle.',
};

export function RequestsPage() {
  const [kind, setKind] = useState<DebtorRequest['kind']>('PLAN');
  const [sent, setSent] = useState<DebtorRequest['kind'] | null>(null);
  const done = (value: DebtorRequest['kind']) => setSent(value);
  return (
    <section aria-label="Mes demandes" className={css.panel}>
      <h2>Que souhaitez-vous faire ?</h2>
      <Onglets
        variant="underline"
        label="Que souhaitez-vous faire ?"
        items={KINDS.map(([id, label]) => ({
          label,
          selected: id === kind,
          pick: () => {
            setKind(id);
            setSent(null);
          },
        }))}
      />
      {sent === kind && <Alerte tone="success" text={DONE[kind]} />}
      {kind === 'PLAN' && <PlanForm onDone={done} />}
      {kind === 'DISPUTE' && <DisputeForm onDone={done} />}
      {kind === 'ALREADY_PAID' && <PaidForm onDone={done} />}
      {kind === 'CALLBACK' && <CallbackForm onDone={done} />}
    </section>
  );
}

type OnDone = (kind: DebtorRequest['kind']) => void;

function useRequest(onDone: OnDone) {
  const item = useCase();
  const change = useChange();
  const confirm = useConfirm();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = (request: unknown, ask: { title: string; body: string; confirmLabel: string; details?: { k: string; v: string }[] }, files: File[] = []) => {
    const parsed = debtorRequest.safeParse(request);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    confirm({
      ...ask,
      details: [{ k: 'Dossier', v: item.reference }, ...(ask.details ?? [])],
      onConfirm: async () => {
        const body = files.length > 0 ? { ...parsed.data, attachments: await sendFiles(files) } : parsed.data;
        await change(`/debtor/cases/${item.id}/requests`, { body });
        onDone(parsed.data.kind);
      },
    });
  };
  return { item, errors, send };
}

function Form({ onSubmit, label, children }: { onSubmit: () => void; label: string; children: ReactNode }) {
  return (
    <form
      className={css.stack}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <div className={css.inline}>
        <Bouton type="submit" label={label} />
      </div>
    </form>
  );
}

function PlanForm({ onDone }: { onDone: OnDone }) {
  const { item, send } = useRequest(onDone);
  const [months, setMonths] = useState<2 | 3 | 6>(3);
  const [note, setNote] = useState('');
  const monthly = formatCents(Math.ceil(item.balance / months), { decimals: 'always' });
  return (
    <Form
      label="Envoyer ma demande d’échéancier"
      onSubmit={() =>
        send(
          { kind: 'PLAN', months, note },
          {
            title: 'Envoyer votre demande d’échéancier ?',
            body: `Vous proposez de régler en ${months} mensualités de ${monthly}. Un responsable étudie votre demande ; les relances sont suspendues en attendant sa réponse.`,
            confirmLabel: 'Envoyer ma demande',
          },
        )
      }
    >
      <p>
        Vous ne pouvez pas tout régler d’un coup ? Proposez un paiement en plusieurs fois. Votre demande sera examinée par un responsable, avec une réponse sous
        48 heures ouvrées.
      </p>
      <fieldset className={css.choice}>
        <legend>Nombre de mensualités</legend>
        {([2, 3, 6] as const).map((value) => (
          <label key={value} data-checked={value === months || undefined}>
            <input type="radio" name="months" checked={value === months} onChange={() => setMonths(value)} />
            <span className={css.text}>
              {value} mois
              <small>{formatCents(Math.ceil(item.balance / value), { decimals: 'always' })} par mois</small>
            </span>
          </label>
        ))}
      </fieldset>
      <Champ
        label="Votre situation"
        type="textarea"
        optional
        value={note}
        placeholder="Expliquez brièvement votre situation pour faciliter la validation."
        onChange={setNote}
      />
    </Form>
  );
}

function DisputeForm({ onDone }: { onDone: OnDone }) {
  const { item, errors, send } = useRequest(onDone);
  const [reason, setReason] = useState<string>(DISPUTE_REASONS[0]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  return (
    <Form
      label="Envoyer ma contestation"
      onSubmit={() =>
        send(
          { kind: 'DISPUTE', reason, text, attachments: [] },
          {
            title: 'Envoyer votre contestation ?',
            body: 'Les relances sont suspendues pendant l’examen. Nous vous répondons par e-mail.',
            confirmLabel: 'Envoyer ma contestation',
            details: [{ k: 'Motif', v: reason }],
          },
          files,
        )
      }
    >
      <p>
        Vous estimez ne pas devoir tout ou partie de cette somme ? Expliquez-nous pourquoi et joignez vos justificatifs. Le dossier sera examiné avec{' '}
        {item.creditor}.
      </p>
      <Champ label="Motif" type="select" value={reason} options={[...DISPUTE_REASONS]} onChange={setReason} />
      <Champ label="Explication" type="textarea" value={text} error={errors.text} onChange={setText} />
      <DepotFichiers
        label="Ajouter un justificatif"
        hint="Preuve de paiement, bon de livraison, courrier… PDF ou image, 10 Mo max."
        accept={ACCEPTED}
        multiple
        files={files}
        onChange={setFiles}
      />
    </Form>
  );
}

function PaidForm({ onDone }: { onDone: OnDone }) {
  const { errors, send } = useRequest(onDone);
  const [paidOn, setPaidOn] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('TRANSFER');
  const [files, setFiles] = useState<File[]>([]);
  const value = parseCents(amount);
  return (
    <Form
      label="Signaler ce paiement"
      onSubmit={() =>
        send(
          { kind: 'ALREADY_PAID', paidOn, amount: value, method, attachments: [] },
          {
            title: 'Signaler ce paiement ?',
            body: 'Nous vérifions sa réception avant de mettre à jour votre dossier.',
            confirmLabel: 'Signaler ce paiement',
            details: [
              { k: 'Montant', v: value === null ? '' : formatCents(value, { decimals: 'always' }) },
              { k: 'Date', v: paidOn && formatDate(paidOn) },
              { k: 'Moyen', v: method === 'TRANSFER' ? 'Virement' : 'Chèque' },
            ],
          },
          files,
        )
      }
    >
      <div className={css.form}>
        <Champ label="Date du paiement" type="date" value={paidOn} error={errors.paidOn} onChange={setPaidOn} />
        <Champ label="Montant (€)" inputMode="decimal" value={amount} error={errors.amount} onChange={setAmount} />
        <Champ
          label="Moyen"
          type="select"
          value={method}
          options={[
            { value: 'TRANSFER', label: 'Virement' },
            { value: 'CHEQUE', label: 'Chèque' },
          ]}
          onChange={setMethod}
        />
      </div>
      <DepotFichiers label="Ajouter un justificatif" hint="PDF ou image, 10 Mo max." accept={ACCEPTED} multiple files={files} onChange={setFiles} />
    </Form>
  );
}

function CallbackForm({ onDone }: { onDone: OnDone }) {
  const { errors, send } = useRequest(onDone);
  const [phone, setPhone] = useState('');
  const [slot, setSlot] = useState('MORNING');
  const label = slot === 'MORNING' ? 'Le matin, 9 h – 12 h' : 'L’après-midi, 14 h – 19 h';
  return (
    <Form
      label="Demander à être rappelé"
      onSubmit={() =>
        send(
          { kind: 'CALLBACK', phone, slot },
          {
            title: 'Demander à être rappelé ?',
            body: 'Votre gestionnaire vous rappelle du lundi au vendredi.',
            confirmLabel: 'Envoyer ma demande',
            details: [
              { k: 'Numéro', v: phone },
              { k: 'Moment', v: label },
            ],
          },
        )
      }
    >
      <div className={css.form}>
        <Champ label="Votre numéro" type="tel" autocomplete="tel" value={phone} error={errors.phone} onChange={setPhone} />
        <Champ
          label="Moment préféré"
          type="select"
          value={slot}
          options={[
            { value: 'MORNING', label: 'Le matin, 9 h – 12 h' },
            { value: 'AFTERNOON', label: 'L’après-midi, 14 h – 19 h' },
          ]}
          onChange={setSlot}
        />
      </div>
    </Form>
  );
}
