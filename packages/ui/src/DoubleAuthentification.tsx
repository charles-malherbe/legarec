import { useState, type FormEvent } from 'react';
import { Bouton } from './Bouton';
import { Champ } from './Champ';
import css from './PageConnexion.module.css';

/** The key goes into the application of the telephone, which shows a code in return. */
export function SaisieApplication({ totpKey, error, busy, onVerify }: { totpKey: string; error?: string; busy?: boolean; onVerify: (code: string) => void }) {
  const [code, setCode] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onVerify(code);
  };
  return (
    <form className={css.contents} onSubmit={submit}>
      <div className={css.secret}>
        Ajoutez Legarec dans Google Authenticator, Microsoft Authenticator ou 1Password, puis saisissez la clé : <code>{totpKey}</code>
      </div>
      <Champ
        label="Code à 6 chiffres affiché dans l'application"
        size="lg"
        inputMode="numeric"
        autocomplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(value) => setCode(value.replace(/\D/g, ''))}
        error={error}
      />
      <Bouton type="submit" size="lg" label="Vérifier le code" loading={busy} disabled={code.length !== 6} onPress={() => {}} />
    </form>
  );
}

/** Shown once: the API never gives them again. */
export function CodesSecours({ codes }: { codes: string[] }) {
  return (
    <>
      <div className={css.codes}>
        {codes.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <p>Chaque code ne sert qu&apos;une fois. Conservez-les hors de l&apos;application (gestionnaire de mots de passe, coffre papier).</p>
    </>
  );
}
