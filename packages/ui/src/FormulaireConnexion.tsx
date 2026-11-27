import { loginError, loginRequest, loginResponse, setupDone, totpSetup, webauthnOptions, type LoginResponse } from '@legarec/contracts';
import { api, ApiError, openExternal } from '@legarec/platform';
import { PinInput } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useContext, useState } from 'react';
import { Link } from 'react-router';
import { Alerte } from './Alerte';
import { Bouton } from './Bouton';
import { Case } from './Case';
import { Champ } from './Champ';
import { CodesSecours, SaisieApplication } from './DoubleAuthentification';
import { Icone } from './Icone';
import { PageConnexion, PORTAILS, PortailContext } from './PageConnexion';
import css from './PageConnexion.module.css';

type Failure = { kind: 'WRONG'; attemptsLeft: number } | { kind: 'LOCKED' | 'CODES_LOCKED' | 'TOO_MANY' | 'OFFLINE' | 'TOO_LATE' };
type OpenSession = Extract<LoginResponse, { status: 'OK' }>['session'];

const WRONG_CODE = 'Code incorrect ou expiré. Vérifiez l’heure de votre téléphone, puis saisissez le nouveau code affiché.';
export const TOO_MANY = 'Trop de tentatives depuis votre réseau. Réessayez dans quelques minutes.';
export const OFFLINE = 'Le service ne répond pas. Vérifiez votre connexion et réessayez.';
const LOCKED = 'Compte bloqué pendant 15 minutes après 5 tentatives échouées.';

function messageOf(failure: Failure): string {
  switch (failure.kind) {
    case 'LOCKED':
      return `${LOCKED} Vous pouvez aussi réinitialiser votre mot de passe.`;
    case 'CODES_LOCKED':
      return LOCKED;
    case 'TOO_MANY':
      return TOO_MANY;
    case 'OFFLINE':
      return OFFLINE;
    case 'TOO_LATE':
      return 'Votre connexion a expiré : saisissez de nouveau votre mot de passe.';
    default:
      return `E-mail ou mot de passe incorrect. Il vous reste ${failure.attemptsLeft} tentative${failure.attemptsLeft > 1 ? 's' : ''} avant le blocage temporaire du compte.`;
  }
}
const codeOf = (error: unknown) => {
  const body = error instanceof ApiError ? loginError.safeParse(error.body) : undefined;
  return body?.success ? body.data : { code: 'OFFLINE' as const, attemptsLeft: undefined };
};
const failureOf = (error: unknown): Failure => {
  const { code, attemptsLeft = 0 } = codeOf(error);
  if (code === 'INVALID_CREDENTIALS') return { kind: 'WRONG', attemptsLeft };
  return { kind: code === 'LOCKED' || code === 'TOO_MANY' ? code : code === 'UNAUTHORIZED' ? 'TOO_LATE' : 'OFFLINE' };
};

export function FormulaireConnexion({ onSession }: { onSession: (session: OpenSession) => void }) {
  const name = useContext(PortailContext);
  const portal = PORTAILS[name];
  const other = PORTAILS[name === 'espace' ? 'partenaires' : 'espace'].domain;
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [methods, setMethods] = useState<('TOTP' | 'WEBAUTHN')[] | null>(null);
  const [setupKey, setSetupKey] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ codes: string[]; session: OpenSession } | null>(null);
  const [wrongPortal, setWrongPortal] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  /** A refused code leaves the field empty, ready for the next one. */
  const [tries, setTries] = useState(0);
  const [backup, setBackup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm({ initialValues: { email: '', password: '', portal: name }, validate: schemaResolver(loginRequest, { sync: true }) });

  const restart = (next: Failure | null = null) => {
    setMethods(null);
    setSetupKey(null);
    setBackup(null);
    setCodeError(null);
    setFailure(next);
  };
  const finish = async (result: LoginResponse) => {
    if (result.status === 'WRONG_PORTAL') setWrongPortal(result.url);
    else if (result.status === 'TWO_FACTOR') setMethods(result.methods);
    else if (result.status === 'SETUP_REQUIRED') setSetupKey((await api(totpSetup, '/auth/setup/totp', { method: 'POST' })).key);
    else onSession(result.session);
  };
  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    try {
      await finish(await api(loginResponse, '/auth/login', { method: 'POST', body: { ...values, remember } }));
      setFailure(null);
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  });
  /** Second factor: five wrong codes close everything, and the sign-in starts again. */
  const prove = async (step: () => Promise<void>, wrong = WRONG_CODE) => {
    setBusy(true);
    setCodeError(null);
    try {
      await step();
    } catch (error) {
      const { code } = codeOf(error);
      setTries((count) => count + 1);
      if (code === 'LOCKED') restart({ kind: 'CODES_LOCKED' });
      else if (code === 'UNAUTHORIZED') restart({ kind: 'TOO_LATE' });
      else setCodeError(code === 'TOO_MANY' ? TOO_MANY : code === 'OFFLINE' && (error instanceof ApiError || error instanceof TypeError) ? OFFLINE : wrong);
    } finally {
      setBusy(false);
    }
  };
  const verify = (code: string, method: 'TOTP' | 'BACKUP_CODE' = 'TOTP') =>
    prove(async () => finish(await api(loginResponse, '/auth/two-factor', { method: 'POST', body: { method, code } })));
  const signInWithKey = () =>
    prove(async () => {
      const options = await api(webauthnOptions, '/auth/two-factor/webauthn', { method: 'POST' });
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const response = await startAuthentication({ optionsJSON: options as never });
      await finish(await api(loginResponse, '/auth/two-factor', { method: 'POST', body: { method: 'WEBAUTHN', response } }));
    }, 'La clé de sécurité n’a pas été reconnue. Réessayez ou utilisez un code.');
  const setUp = (code: string) =>
    prove(async () => {
      const { session, backupCodes } = await api(setupDone, '/auth/setup/totp/verify', { method: 'POST', body: { code } });
      setOpened({ codes: backupCodes, session });
    }, 'Code incorrect ou expiré.');

  const goBack = <Bouton variant="ghost" size="sm" label="← Retour" onPress={() => restart()} layout={{ alignSelf: 'flex-start' }} />;
  if (opened)
    return (
      <PageConnexion>
        <div className={css.step}>
          <div className={css.heading}>
            <h1>Codes de secours</h1>
            <p>Ils vous permettent de vous connecter si vous perdez votre téléphone.</p>
          </div>
          <CodesSecours codes={opened.codes} />
          <Bouton size="lg" label="J'ai conservé mes codes · accéder à Legarec" onPress={() => onSession(opened.session)} />
        </div>
      </PageConnexion>
    );
  if (setupKey !== null)
    return (
      <PageConnexion>
        <div className={css.step}>
          {goBack}
          <div className={css.heading}>
            <h1>Double authentification</h1>
            <p>Ajoutez une seconde vérification à la connexion. Obligatoire pour le rôle Développeur.</p>
          </div>
          <SaisieApplication totpKey={setupKey} error={codeError ?? undefined} busy={busy} onVerify={(code) => void setUp(code)} />
        </div>
      </PageConnexion>
    );
  if (methods) {
    return (
      <PageConnexion>
        <div className={css.step}>
          {goBack}
          <div className={css.heading}>
            <h1>Vérification en deux étapes</h1>
            <p>Saisissez le code à 6 chiffres affiché dans votre application d&apos;authentification.</p>
            <p>Obligatoire pour le rôle Développeur, recommandée pour les autres.</p>
          </div>
          <PinInput
            key={tries}
            unstyled
            length={6}
            type="number"
            oneTimeCode
            autoFocus
            aria-label="Code de vérification"
            classNames={{ root: css.pin, input: css.pinInput }}
            disabled={busy}
            onComplete={(code) => void verify(code)}
            getInputProps={(index) => ({ 'aria-label': `Chiffre ${index + 1} du code` })}
          />
          {codeError && <Alerte tone="danger" text={codeError} />}
          {methods.includes('WEBAUTHN') && (
            <Bouton variant="secondary" size="lg" icon="key" label="Utiliser une clé de sécurité" disabled={busy} onPress={() => void signInWithKey()} />
          )}
          {backup === null ? (
            <Bouton variant="link" size="sm" label="Utiliser un code de secours" onPress={() => setBackup('')} layout={{ alignSelf: 'flex-start' }} />
          ) : (
            <form
              className={css.fields}
              onSubmit={(event) => {
                event.preventDefault();
                void verify(backup.trim(), 'BACKUP_CODE');
              }}
            >
              <Champ label="Code de secours" size="lg" mono autocomplete="off" spellCheck={false} value={backup} onChange={setBackup} />
              <Bouton type="submit" size="lg" full label="Se connecter avec ce code" loading={busy} disabled={!backup.trim()} />
            </form>
          )}
        </div>
      </PageConnexion>
    );
  }
  const locked = failure?.kind === 'LOCKED' || failure?.kind === 'CODES_LOCKED';
  return (
    <PageConnexion>
      <form className={css.step} onSubmit={submit} noValidate>
        <div className={css.heading}>
          <span className={css.domain}>
            <Icone icon="lock" size={12} />
            {portal.domain}
          </span>
          <h1>{portal.title}</h1>
          <p>{portal.text}</p>
        </div>
        {wrongPortal && (
          <Alerte
            tone="info"
            text={
              name === 'espace'
                ? 'Ce compte est un compte créancier : connectez-vous sur partenaires.legarec.fr, l’adresse des créanciers.'
                : 'Ce compte est un compte Legarec : connectez-vous sur espace.legarec.fr, l’adresse des collaborateurs.'
            }
            actionLabel={`Aller sur ${other}`}
            onAction={() => openExternal(wrongPortal)}
          />
        )}
        <div className={css.fields}>
          <Champ
            label="Adresse e-mail"
            type="email"
            size="lg"
            autocomplete="username"
            value={form.values.email}
            error={form.errors.email as string | undefined}
            onChange={(value) => form.setFieldValue('email', value)}
          />
          <Champ
            label="Mot de passe"
            type={visible ? 'text' : 'password'}
            size="lg"
            autocomplete="current-password"
            spellCheck={false}
            capsLockWarning
            value={form.values.password}
            error={form.errors.password as string | undefined}
            onChange={(value) => form.setFieldValue('password', value)}
            action={
              <Bouton
                variant="ghost"
                size="sm"
                label={visible ? 'Masquer' : 'Afficher'}
                ariaLabel={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                onPress={() => setVisible(!visible)}
              />
            }
          />
          <div className={css.row}>
            <Case label="Rester connecté" checked={remember} onToggle={setRemember} />
            <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
          </div>
        </div>
        {failure && <Alerte tone={failure.kind === 'WRONG' ? 'warning' : 'danger'} text={messageOf(failure)} />}
        <div className={css.links}>
          <Bouton type="submit" size="lg" full label="Se connecter" loading={busy} disabled={locked} onPress={() => {}} />
          <span>Vous avez reçu une invitation ? Ouvrez le lien de votre e-mail pour activer votre compte.</span>
          <span>
            {name === 'espace' ? 'Vous êtes créancier ?' : 'Collaborateur Legarec ?'} <a href={`https://${other}`}>Aller sur {other}</a>
          </span>
        </div>
      </form>
    </PageConnexion>
  );
}
