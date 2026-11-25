import { newPassword, ROLE_LABELS, role } from '@legarec/contracts';
import { api, ApiError } from '@legarec/platform';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { z } from 'zod';
import { Alerte } from './Alerte';
import { Bouton } from './Bouton';
import { Champ } from './Champ';
import { PageConnexion } from './PageConnexion';
import css from './PageConnexion.module.css';

const back = <Bouton variant="ghost" size="sm" label="← Retour à la connexion" href="/connexion" layout={{ alignSelf: 'flex-start' }} />;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await api(z.undefined(), '/auth/forgot-password', { method: 'POST', body: { email } });
    setSent(true);
  };
  return (
    <PageConnexion>
      <form className={css.step} onSubmit={(event) => void submit(event)}>
        {back}
        <div className={css.heading}>
          <h2>Mot de passe oublié</h2>
          <p>Nous vous envoyons un lien de réinitialisation, valable 1 heure.</p>
        </div>
        <Champ label="Adresse e-mail" type="email" size="lg" autocomplete="username" required value={email} onChange={setEmail} />
        {sent && <Alerte tone="success" text={`Si un compte existe pour ${email}, un lien vient d'être envoyé.`} />}
        <Bouton type="submit" size="lg" label="Envoyer le lien" onPress={() => {}} />
      </form>
    </PageConnexion>
  );
}

function PasswordFields({
  email,
  first,
  second,
  onFirst,
  onSecond,
  labels,
}: {
  email: string;
  first: string;
  second: string;
  onFirst: (v: string) => void;
  onSecond: (v: string) => void;
  labels: [string, string];
}) {
  return (
    <>
      <Champ label={labels[0]} type="password" size="lg" autocomplete="new-password" value={first} onChange={onFirst} />
      <Champ label={labels[1]} type="password" size="lg" autocomplete="new-password" value={second} onChange={onSecond} />
      <ul aria-label="Règles du mot de passe" className={css.rules}>
        {passwordRules(email, first, second).map(([label, ok]) => (
          <li key={label} data-ok={ok || undefined}>
            <span aria-hidden className={css.mark}>
              {ok ? '✓' : '·'}
            </span>
            {label}
            <span hidden>{ok ? ' : respectée' : ''}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
export function passwordRules(email: string, first: string, second: string): [string, boolean][] {
  return [
    ['12 caractères minimum', newPassword.safeParse(first).success],
    ['Différent de l’adresse e-mail', first.length > 0 && !email.toLowerCase().includes(first.toLowerCase())],
    ['Les deux saisies sont identiques', first.length > 0 && first === second],
  ];
}
const isAllowed = (...args: Parameters<typeof passwordRules>) => passwordRules(...args).every(([, ok]) => ok);
const linkInfo = z.object({ email: z.email(), firstName: z.string(), invitedBy: z.string().optional(), role: role.optional(), twoFactorRequired: z.boolean() });

function useLink(kind: 'reset' | 'invitation') {
  const { token = '' } = useParams();
  const query = useQuery({ queryKey: [kind, token], queryFn: () => api(linkInfo, `/auth/${kind}/${token}`), retry: false });
  return { token, ...query, expired: query.error instanceof ApiError && query.error.status === 410 };
}

export function ResetPasswordPage() {
  const { token, data, expired } = useLink('reset');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await api(z.undefined(), `/auth/reset/${token}`, { method: 'POST', body: { password: first } });
    setDone(true);
  };
  return (
    <PageConnexion>
      <form className={css.step} onSubmit={(event) => void submit(event)}>
        {back}
        <div className={css.heading}>
          <h2>Nouveau mot de passe</h2>
          {data && <p>Pour {data.email} · lien valable 1 heure.</p>}
        </div>
        {expired && <Alerte tone="danger" text="Ce lien a expiré (validité 1 heure). Demandez-en un nouveau depuis « Mot de passe oublié »." />}
        {data && !done && (
          <PasswordFields
            email={data.email}
            first={first}
            second={second}
            onFirst={setFirst}
            onSecond={setSecond}
            labels={['Nouveau mot de passe', 'Confirmer le mot de passe']}
          />
        )}
        {done && <Alerte tone="success" text="Mot de passe modifié. Vos autres sessions ont été fermées ; reconnectez-vous." />}
        {data && !done && (
          <Bouton type="submit" size="lg" label="Enregistrer le mot de passe" disabled={!isAllowed(data.email, first, second)} onPress={() => {}} />
        )}
      </form>
    </PageConnexion>
  );
}

const activation = z.object({ totpKey: z.string() });
const backup = z.object({ backupCodes: z.array(z.string()) });

export function ActivationPage() {
  const { token, data, expired } = useLink('invitation');
  const [step, setStep] = useState(1);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [key, setKey] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [wrongCode, setWrongCode] = useState(false);
  const choosePassword = async () => {
    const result = await api(activation, `/auth/invitation/${token}/password`, { method: 'POST', body: { password: first } });
    setKey(result.totpKey);
    setStep(2);
  };
  const verify = async () => {
    setWrongCode(false);
    try {
      const result = await api(backup, `/auth/invitation/${token}/totp`, { method: 'POST', body: { code } });
      setCodes(result.backupCodes);
      setStep(3);
    } catch {
      setWrongCode(true);
    }
  };
  const titles = [`Bienvenue, ${data?.firstName ?? ''}`, 'Double authentification', 'Codes de secours'];
  const texts = [
    `Invitation de ${data?.invitedBy ?? ''} · rôle ${data?.role ? ROLE_LABELS[data.role] : ''} · lien valable 72 h. Choisissez votre mot de passe.`,
    'Ajoutez une seconde vérification à la connexion. Obligatoire pour le rôle Développeur.',
    'Ils vous permettent de vous connecter si vous perdez votre téléphone.',
  ];
  return (
    <PageConnexion>
      <div className={css.step}>
        {back}
        {expired && <Alerte tone="danger" text="Cette invitation a expiré (validité 72 heures). Demandez-en une nouvelle à la personne qui vous a invité." />}
        {data && (
          <>
            <div className={css.heading}>
              <span className={css.eyebrow}>Activation · étape {step} sur 3</span>
              <h2>{titles[step - 1]}</h2>
              <p>{texts[step - 1]}</p>
            </div>
            {step === 1 && (
              <>
                <PasswordFields
                  email={data.email}
                  first={first}
                  second={second}
                  onFirst={setFirst}
                  onSecond={setSecond}
                  labels={['Mot de passe', 'Confirmer']}
                />
                <Bouton size="lg" label="Continuer" disabled={!isAllowed(data.email, first, second)} onPress={() => void choosePassword()} />
              </>
            )}
            {step === 2 && (
              <>
                <div className={css.secret}>
                  Ajoutez Legarec dans Google Authenticator, Microsoft Authenticator ou 1Password, puis saisissez la clé : <code>{key}</code>
                </div>
                <Champ
                  label="Code à 6 chiffres affiché dans l'application"
                  size="lg"
                  inputMode="numeric"
                  autocomplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(value) => setCode(value.replace(/\D/g, ''))}
                  error={wrongCode ? 'Code incorrect ou expiré.' : undefined}
                />
                <Bouton size="lg" label="Vérifier le code" disabled={code.length !== 6} onPress={() => void verify()} />
                {!data.twoFactorRequired && (
                  <Bouton variant="ghost" size="sm" label="Plus tard (recommandé pour votre rôle, non obligatoire)" href="/connexion" />
                )}
              </>
            )}
            {step === 3 && (
              <>
                <div className={css.codes}>
                  {codes.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <p>Chaque code ne sert qu&apos;une fois. Conservez-les hors de l&apos;application (gestionnaire de mots de passe, coffre papier).</p>
                <Bouton size="lg" label="J'ai conservé mes codes · accéder à Legarec" href="/connexion" />
              </>
            )}
          </>
        )}
      </div>
    </PageConnexion>
  );
}
