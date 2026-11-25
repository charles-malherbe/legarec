import { backupCodes, linkInfo, loginError, newPassword, ROLE_LABELS, totpKey } from '@legarec/contracts';
import { api, ApiError } from '@legarec/platform';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { z } from 'zod';
import { Alerte } from './Alerte';
import { Bouton } from './Bouton';
import { Champ } from './Champ';
import { CodesSecours, SaisieApplication } from './DoubleAuthentification';
import { OFFLINE, TOO_MANY } from './FormulaireConnexion';
import { PageConnexion } from './PageConnexion';
import css from './PageConnexion.module.css';

const back = <Bouton variant="ghost" size="sm" label="← Retour à la connexion" href="/connexion" layout={{ alignSelf: 'flex-start' }} />;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure('');
    try {
      await api(z.undefined(), '/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (error) {
      setSent(false);
      const status = error instanceof ApiError ? error.status : 0;
      setFailure(status === 429 ? TOO_MANY : status === 422 ? 'Saisissez une adresse e-mail valide.' : OFFLINE);
    }
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
        {failure && <Alerte tone="danger" text={failure} />}
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
const isExpired = (error: unknown) => error instanceof ApiError && error.status === 410;

function useLink(kind: 'reset' | 'invitation') {
  const { token = '' } = useParams();
  // Used while its page is open, or replaced by another one.
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const query = useQuery({ queryKey: [kind, token], queryFn: () => api(linkInfo, `/auth/${kind}/${token}`), retry: false, refetchOnReconnect: false });
  const { isError, error } = query;
  return {
    token,
    data: gone ? undefined : query.data,
    expired: gone || isExpired(error),
    failed: failed || (isError && !isExpired(error)),
    busy,
    /** Once at a time: a second click would find the link used. The page says when it has expired, or when the service does not answer. */
    run: async (step: () => Promise<void>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setFailed(false);
      try {
        await step();
      } catch (caught) {
        if (isExpired(caught)) setGone(true);
        else setFailed(true);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
  };
}

export function ResetPasswordPage() {
  const { token, data, expired, failed, busy, run } = useLink('reset');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await run(async () => {
      await api(z.undefined(), `/auth/reset/${token}`, { method: 'POST', body: { password: first } });
      setDone(true);
    });
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
        {failed && <Alerte tone="danger" text={OFFLINE} />}
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
          <Bouton
            type="submit"
            size="lg"
            label="Enregistrer le mot de passe"
            loading={busy}
            disabled={!isAllowed(data.email, first, second)}
            onPress={() => {}}
          />
        )}
      </form>
    </PageConnexion>
  );
}

export function ActivationPage() {
  const { token, data, expired, failed, busy, run } = useLink('invitation');
  const [step, setStep] = useState(1);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [key, setKey] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [wrongCode, setWrongCode] = useState<string>();
  const choosePassword = () =>
    run(async () => {
      setKey((await api(totpKey, `/auth/invitation/${token}/password`, { method: 'POST', body: { password: first } })).totpKey);
      setStep(2);
    });
  const verify = (code: string) => {
    setWrongCode(undefined);
    return run(async () => {
      try {
        setCodes((await api(backupCodes, `/auth/invitation/${token}/totp`, { method: 'POST', body: { code } })).backupCodes);
        setStep(3);
      } catch (error) {
        const known = error instanceof ApiError ? loginError.safeParse(error.body) : undefined;
        if (!known?.success) throw error;
        // The account is open: what is locked is the second factor, which may be set up later.
        setWrongCode(known.data.code === 'LOCKED' ? 'Compte bloqué pendant 15 minutes après 5 tentatives échouées.' : 'Code incorrect ou expiré.');
      }
    });
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
        {failed && <Alerte tone="danger" text={OFFLINE} />}
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
                <Bouton size="lg" label="Continuer" loading={busy} disabled={!isAllowed(data.email, first, second)} onPress={() => void choosePassword()} />
              </>
            )}
            {step === 2 && (
              <>
                <SaisieApplication totpKey={key} error={wrongCode} busy={busy} onVerify={(code) => void verify(code)} />
                {!data.twoFactorRequired && (
                  <Bouton variant="ghost" size="sm" label="Plus tard (recommandé pour votre rôle, non obligatoire)" href="/connexion" />
                )}
              </>
            )}
            {step === 3 && (
              <>
                <CodesSecours codes={codes} />
                <Bouton size="lg" label="J'ai conservé mes codes · accéder à Legarec" href="/connexion" />
              </>
            )}
          </>
        )}
      </div>
    </PageConnexion>
  );
}
