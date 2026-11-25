import { bankAccountForm, formatDate, revealedIban, type CreditorFile } from '@legarec/contracts';
import { Alerte, Bouton, Carte, Champ, useConfirm, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useState } from 'react';
import { api } from '../../app/api';
import { useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';

const EMPTY = { holder: '', iban: '', bic: '', confirmedWith: '' };

/** Account of the remittances. The whole IBAN is asked for each time, noted each time, and kept nowhere. */
export function AccountCard({ file, onMoved }: { file: CreditorFile; onMoved: (error: unknown) => boolean }) {
  const user = useCurrentUser();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [shown, setShown] = useState<{ account: string; iban: string } | null>(null);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [withWhom, setWithWhom] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const account = file.bankAccount;
  const path = `/creditors/${file.id}/bank-accounts`;
  const onBehalf = user.role === 'DIRECTOR' ? [] : [{ k: 'Pour le compte de', v: `${user.directorName}, Directeur` }];
  const card = (body: React.ReactNode) => (
    <Carte title="4. Compte de reversement" badge={user.role === 'DIRECTOR' ? undefined : 'Pour le compte du Directeur'}>
      {body}
    </Carte>
  );
  if (file.bankAccess === 'NONE')
    return (
      <Carte title="4. Compte de reversement">
        <Alerte
          tone="neutral"
          icon="lock"
          title="Réservé au Directeur"
          text="La délégation administrative a été retirée. Le Directeur saisit et confirme ce compte."
        />
      </Carte>
    );
  const reveal = async () => {
    if (!account) return;
    try {
      const { iban } = await api(revealedIban, `${path}/${account.id}/reveal`, { method: 'POST' });
      setShown({ account: account.id, iban });
    } catch {
      toast({ message: 'L’IBAN n’a pas pu être affiché.', tone: 'danger' });
    }
  };
  const replace = () => {
    if (!form) return;
    const parsed = bankAccountForm.safeParse(form);
    setErrors(parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
    if (!parsed.success) return;
    const { data } = parsed;
    confirm({
      tone: 'danger',
      title: account ? 'Remplacer le compte de reversement ?' : 'Enregistrer le compte de reversement ?',
      body: 'Vérifiez chaque caractère avec le créancier : un IBAN erroné détourne les reversements. L’ancien compte reste dans l’historique.',
      details: [
        { k: 'Créancier', v: file.identity.name },
        ...(account ? [{ k: 'Ancien compte', v: account.masked }] : []),
        { k: 'Nouvel IBAN', v: data.iban.replace(/\s/gu, '').replace(/(.{4})(?=.)/gu, '$1 ') },
        { k: 'BIC', v: data.bic },
        { k: 'Confirmé', v: data.confirmedWith ? `Par téléphone, ${data.confirmedWith}` : 'Non : aucun reversement avant' },
        ...onBehalf,
      ],
      confirmLabel: account ? 'Remplacer le compte' : 'Enregistrer le compte',
      onConfirm: async () => {
        try {
          await change(path, { body: { replaces: account?.id ?? null, account: data } });
        } catch (error) {
          if (!onMoved(error)) throw error;
          return;
        }
        setForm(null);
        setShown(null);
        toast({ message: 'Compte de reversement enregistré.' });
      },
    });
  };
  const confirmAccount = () => {
    if (!account) return;
    if (!withWhom.trim()) return setErrors({ withWhom: 'Indiquez avec qui.' });
    setErrors({});
    confirm({
      title: 'Confirmer ce compte ?',
      body: 'Vous avez vérifié l’IBAN par téléphone, à un numéro déjà connu. Les reversements peuvent ensuite partir vers ce compte.',
      details: [{ k: 'Créancier', v: file.identity.name }, { k: 'Compte', v: account.masked }, { k: 'Avec', v: withWhom.trim() }, ...onBehalf],
      confirmLabel: 'Confirmer le compte',
      onConfirm: async () => {
        try {
          await change(`${path}/${account.id}/confirm`, { body: { confirmedWith: withWhom.trim() } });
        } catch (error) {
          if (!onMoved(error)) throw error;
          return;
        }
        setWithWhom('');
        toast({ message: 'Compte confirmé.' });
      },
    });
  };
  const field = (key: keyof typeof EMPTY, label: string, more: Partial<Parameters<typeof Champ>[0]> = {}) => (
    <Champ
      label={label}
      value={form?.[key] ?? ''}
      error={errors[key]}
      autocomplete="off"
      onChange={(value) => setForm((current) => (current ? { ...current, [key]: value } : current))}
      {...more}
    />
  );
  return card(
    <div className={layout.stack}>
      {account ? (
        <dl className={layout.facts}>
          {(
            [
              ['Titulaire', account.holder],
              ['IBAN', shown?.account === account.id ? shown.iban : account.masked],
              ['BIC', account.bic],
              ['Depuis le', formatDate(account.since)],
              ['Confirmé', account.confirmed ? `Par téléphone, ${formatDate(account.confirmed.on)}, ${account.confirmed.with}` : 'Non'],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={layout.body}>Aucun compte enregistré.</p>
      )}
      {account && !account.confirmed && (
        <>
          <Alerte tone="warning" title="IBAN à confirmer par téléphone" text="Avec l’interlocuteur, à un numéro déjà connu. Sans cela, aucun reversement." />
          <div className={layout.form}>
            <Champ label="Confirmé par téléphone avec" value={withWhom} error={errors.withWhom} autocomplete="off" onChange={setWithWhom} />
          </div>
          <div>
            <Bouton variant="secondary" size="sm" label="Confirmer le compte" onPress={confirmAccount} />
          </div>
        </>
      )}
      {form ? (
        <form
          className={layout.stack}
          noValidate
          autoComplete="off"
          aria-label="Compte de reversement"
          onSubmit={(event) => {
            event.preventDefault();
            replace();
          }}
        >
          <div className={layout.form}>
            {field('holder', 'Titulaire', { required: true })}
            {field('iban', 'IBAN', { required: true, mono: true })}
            {field('bic', 'BIC', { required: true, mono: true })}
            {field('confirmedWith', 'IBAN confirmé par téléphone avec', { optional: true, help: 'À un numéro déjà connu. Sans cela, aucun reversement.' })}
          </div>
          <div className={layout.end}>
            <Bouton variant="secondary" label="Annuler" onPress={() => (setForm(null), setErrors({}))} />
            <Bouton type="submit" label={account ? 'Remplacer le compte' : 'Enregistrer le compte'} />
          </div>
        </form>
      ) : (
        <div className={layout.inline}>
          {account && shown?.account !== account.id && <Bouton variant="secondary" size="sm" label="Afficher l’IBAN" onPress={() => void reveal()} />}
          {account && shown?.account === account.id && <Bouton variant="secondary" size="sm" label="Masquer l’IBAN" onPress={() => setShown(null)} />}
          <Bouton variant="secondary" size="sm" label={account ? 'Remplacer le compte' : 'Saisir le compte'} onPress={() => setForm(EMPTY)} />
        </div>
      )}
      <p className={layout.hint}>Chaque affichage est noté dans le journal d’audit. L’ancien compte est conservé.</p>
    </div>,
  );
}
