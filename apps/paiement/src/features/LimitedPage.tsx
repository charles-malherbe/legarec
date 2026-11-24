import { limitedMessage, paymentInfo } from '@legarec/contracts';
import { Alerte, Bouton, Champ, DepotFichiers, EtatListe, useConfirm } from '@legarec/ui';
import { useState } from 'react';
import css from '../app/Debtor.module.css';
import { useApi, useChange } from '../app/data';
import { Frame } from '../app/Frame';
import { PaymentMeans } from './PaymentMeans';
import { ACCEPTED, sendFiles } from './uploads';

const EMPTY = { name: '', email: '', reference: '', text: '' };

/** Without the code: payment instructions and messages only. No amount, no creditor, not even in the footer. */
export function LimitedPage() {
  const { data, error, refetch } = useApi(paymentInfo, '/debtor/limited/payment');
  const change = useChange();
  const confirm = useConfirm();
  const [form, setForm] = useState(EMPTY);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const set = (key: keyof typeof EMPTY) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => {
    const parsed = limitedMessage.safeParse({ ...form, attachments: [] });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
    setErrors({});
    confirm({
      title: 'Envoyer ce message au cabinet ?',
      body: parsed.data.text,
      details: [
        { k: 'Nom', v: parsed.data.name },
        { k: 'Pièces jointes', v: String(files.length) },
      ],
      confirmLabel: 'Envoyer le message',
      onConfirm: async () => {
        await change('/debtor/limited/messages', { body: { ...parsed.data, attachments: await sendFiles(files) } });
        setForm(EMPTY);
        setFiles([]);
        setSent(true);
      },
    });
  };
  return (
    <Frame>
      <div className={css.heading}>
        <h1>Accès limité</h1>
        <p>Sans votre code d’accès, aucune information sur votre dossier n’est affichée. Vous pouvez payer ou nous écrire.</p>
      </div>
      <div className={css.columns}>
        <form
          aria-labelledby="ecrire-titre"
          className={css.panel}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h2 id="ecrire-titre">Écrire au cabinet</h2>
          {sent && <Alerte tone="success" text="Message reçu par Legarec. Nous vous répondons sous un jour ouvré." />}
          <div className={css.form}>
            <Champ label="Votre nom" autocomplete="name" value={form.name} error={errors.name} onChange={set('name')} />
            <Champ label="Votre e-mail" type="email" optional autocomplete="email" value={form.email} error={errors.email} onChange={set('email')} />
            <Champ label="Référence du dossier" optional value={form.reference} error={errors.reference} onChange={set('reference')} />
          </div>
          <Champ label="Votre message" type="textarea" value={form.text} error={errors.text} onChange={set('text')} />
          <DepotFichiers label="Ajouter une pièce" hint="PDF ou image, 10 Mo max." accept={ACCEPTED} multiple files={files} onChange={setFiles} />
          <div className={css.inline}>
            <Bouton type="submit" label="Envoyer" />
            <Bouton variant="link" label="J’ai mon code d’accès" href="/" />
          </div>
        </form>
        <aside className={css.stack}>
          <section aria-labelledby="consignes-titre" className={css.panel}>
            <h2 id="consignes-titre">Consignes de paiement</h2>
            {data ? <PaymentMeans payment={data} /> : <EtatListe kind={error ? 'error' : 'loading'} compact onAction={() => void refetch()} />}
          </section>
        </aside>
      </div>
    </Frame>
  );
}
