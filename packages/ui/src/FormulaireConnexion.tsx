import { loginError, loginRequest, loginResponse, webauthnOptions, type LoginResponse } from '@legarec/contracts';
import { api, ApiError, openExternal } from '@legarec/platform';
import { PinInput } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useContext, useState } from 'react';
import { Link } from 'react-router';
import { Alerte } from './Alerte';
import { Bouton } from './Bouton';
import { Case } from './Case';
import { Champ } from './Champ';
import { Icone } from './Icone';
import { PageConnexion, PORTAILS, PortailContext } from './PageConnexion';
import css from './PageConnexion.module.css';

type Failure = { locked: boolean; attemptsLeft: number };

type OpenSession = Extract<LoginResponse, { status: 'OK' }>['session'];

export function FormulaireConnexion({ onSession }: { onSession: (session: OpenSession) => void }) {
  const name = useContext(PortailContext);
  const portal = PORTAILS[name];
  const other = PORTAILS[name === 'espace' ? 'partenaires' : 'espace'].domain;
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [methods, setMethods] = useState<('TOTP' | 'WEBAUTHN')[] | null>(null);
  const [wrongPortal, setWrongPortal] = useState<string | null>(null);
  const [codeError, setCodeError] = useState(false);
  const [backup, setBackup] = useState<string | null>(null);
  const [keyError, setKeyError] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm({ initialValues: { email: '', password: '', portal: name }, validate: schemaResolver(loginRequest, { sync: true }) });

  const finish = (result: LoginResponse) => {
    if (result.status === 'WRONG_PORTAL') setWrongPortal(result.url);
    else if (result.status === 'TWO_FACTOR') setMethods(result.methods);
    else onSession(result.session);
  };
  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setOffline(false);
    try {
      finish(await api(loginResponse, '/auth/login', { method: 'POST', body: { ...values, remember } }));
      setFailure(null);
    } catch (error) {
      const body = error instanceof ApiError ? loginError.safeParse(error.body) : undefined;
      if (!body?.success) setOffline(true);
      else setFailure({ locked: body.data.code === 'LOCKED', attemptsLeft: body.data.attemptsLeft ?? 0 });
    } finally {
      setBusy(false);
    }
  });
  const verify = async (code: string, method: 'TOTP' | 'BACKUP_CODE' = 'TOTP') => {
    setBusy(true);
    setCodeError(false);
    try {
      finish(await api(loginResponse, '/auth/two-factor', { method: 'POST', body: { method, code } }));
    } catch {
      setCodeError(true);
    } finally {
      setBusy(false);
    }
  };

  const signInWithKey = async () => {
    setBusy(true);
    setKeyError(false);
    try {
      const options = await api(webauthnOptions, '/auth/two-factor/webauthn', { method: 'POST' });
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const response = await startAuthentication({ optionsJSON: options as never });
      finish(await api(loginResponse, '/auth/two-factor', { method: 'POST', body: { method: 'WEBAUTHN', response } }));
    } catch {
      setKeyError(true);
    } finally {
      setBusy(false);
    }
  };

  if (methods) {
    return (
      <PageConnexion>
        <div className={css.step}>
          <Bouton variant="ghost" size="sm" label="← Retour" onPress={() => setMethods(null)} layout={{ alignSelf: 'flex-start' }} />
          <div className={css.heading}>
            <h2>Vérification en deux étapes</h2>
            <p>Saisissez le code à 6 chiffres affiché dans votre application d&apos;authentification.</p>
            <p>Obligatoire pour le rôle Développeur, recommandée pour les autres.</p>
          </div>
          <PinInput
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
          {codeError && <Alerte tone="danger" text="Code incorrect ou expiré. Vérifiez l’heure de votre téléphone, puis saisissez le nouveau code affiché." />}
          {methods.includes('WEBAUTHN') && (
            <Bouton variant="secondary" size="lg" icon="key" label="Utiliser une clé de sécurité" disabled={busy} onPress={() => void signInWithKey()} />
          )}
          {keyError && <Alerte tone="danger" text="La clé de sécurité n’a pas été reconnue. Réessayez ou utilisez un code." />}
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
  return (
    <PageConnexion>
      <form className={css.step} onSubmit={submit} noValidate>
        <div className={css.heading}>
          <span className={css.domain}>
            <Icone icon="lock" size={12} />
            {portal.domain}
          </span>
          <h2>{portal.title}</h2>
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
          <div className={css.password}>
            <Champ
              label="Mot de passe"
              type={visible ? 'text' : 'password'}
              size="lg"
              autocomplete="current-password"
              spellCheck={false}
              value={form.values.password}
              error={form.errors.password as string | undefined}
              onChange={(value) => form.setFieldValue('password', value)}
              layout={{ flex: 1 }}
            />
            <Bouton
              variant="ghost"
              size="lg"
              label={visible ? 'Masquer' : 'Afficher'}
              ariaLabel={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              onPress={() => setVisible(!visible)}
            />
          </div>
          <div className={css.row}>
            <Case label="Rester connecté" checked={remember} onToggle={setRemember} />
            <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
          </div>
        </div>
        {failure && (
          <Alerte
            tone={failure.locked ? 'danger' : 'warning'}
            text={
              failure.locked
                ? 'Compte bloqué pendant 15 minutes après 5 tentatives échouées. Vous pouvez aussi réinitialiser votre mot de passe.'
                : `E-mail ou mot de passe incorrect. Il vous reste ${failure.attemptsLeft} tentative${failure.attemptsLeft > 1 ? 's' : ''} avant le blocage temporaire du compte.`
            }
          />
        )}
        {offline && <Alerte tone="danger" text="Le service ne répond pas. Vérifiez votre connexion et réessayez." />}
        <div className={css.links}>
          <Bouton type="submit" size="lg" full label="Se connecter" loading={busy} disabled={failure?.locked} onPress={() => {}} />
          <span>Vous avez reçu une invitation ? Ouvrez le lien de votre e-mail pour activer votre compte.</span>
          <span>
            {name === 'espace' ? 'Vous êtes créancier ?' : 'Collaborateur Legarec ?'} <a href={`https://${other}`}>Aller sur {other}</a>
          </span>
          {name === 'espace' && (
            <>
              <span className={css.or}>ou</span>
              <Bouton variant="secondary" size="lg" full label="Continuer avec le SSO de l'entreprise" disabled />
            </>
          )}
        </div>
      </form>
    </PageConnexion>
  );
}
