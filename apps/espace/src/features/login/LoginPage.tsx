import { loginError, loginRequest, loginResponse } from '@legarec/contracts';
import { Alerte, Bouton, Case, Champ, Icone } from '@legarec/ui';
import { openExternal } from '@legarec/platform';
import { PinInput } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../../app/api';
import { SESSION_KEY } from '../../app/session';
import css from './Login.module.css';
import { LoginLayout } from './LoginLayout';

type Failure = { locked: boolean; attemptsLeft: number };

export function LoginPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [methods, setMethods] = useState<('TOTP' | 'WEBAUTHN')[] | null>(null);
  const [wrongPortal, setWrongPortal] = useState<string | null>(null);
  const [codeError, setCodeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm({ initialValues: { email: '', password: '', portal: 'espace' as const }, validate: schemaResolver(loginRequest, { sync: true }) });

  const finish = async (result: ReturnType<typeof loginResponse.parse>) => {
    if (result.status === 'WRONG_PORTAL') setWrongPortal(result.url);
    else if (result.status === 'TWO_FACTOR') setMethods(result.methods);
    else {
      client.setQueryData(SESSION_KEY, result.session);
      await navigate('/');
    }
  };
  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    try {
      await finish(await api(loginResponse, '/auth/login', { method: 'POST', body: { ...values, remember } }));
      setFailure(null);
    } catch (error) {
      const body = error instanceof ApiError ? loginError.safeParse(error.body) : undefined;
      if (!body?.success) throw error;
      setFailure({ locked: body.data.code === 'LOCKED', attemptsLeft: body.data.attemptsLeft ?? 0 });
    } finally {
      setBusy(false);
    }
  });
  const verify = async (code: string) => {
    setBusy(true);
    setCodeError(false);
    try {
      await finish(await api(loginResponse, '/auth/two-factor', { method: 'POST', body: { method: 'TOTP', code } }));
    } catch {
      setCodeError(true);
    } finally {
      setBusy(false);
    }
  };

  if (methods) {
    return (
      <LoginLayout>
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
            <Bouton variant="secondary" size="lg" icon="key" label="Utiliser une clé de sécurité" disabled title="Disponible avec l’API" />
          )}
        </div>
      </LoginLayout>
    );
  }
  return (
    <LoginLayout>
      <form className={css.step} onSubmit={submit} noValidate>
        <div className={css.heading}>
          <span className={css.domain}>
            <Icone icon="lock" size={12} />
            espace.legarec.fr
          </span>
          <h2>Connexion à l’espace Legarec</h2>
          <p>Réservé aux collaborateurs du cabinet.</p>
        </div>
        {wrongPortal && (
          <Alerte
            tone="info"
            text="Ce compte est un compte créancier : connectez-vous sur partenaires.legarec.fr, l’adresse des créanciers."
            actionLabel="Aller sur partenaires.legarec.fr"
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
        <div className={css.links}>
          <Bouton type="submit" size="lg" full label="Se connecter" loading={busy} disabled={failure?.locked} onPress={() => {}} />
          <span>Vous avez reçu une invitation ? Ouvrez le lien de votre e-mail pour activer votre compte.</span>
          <span>
            Vous êtes créancier ? <a href="https://partenaires.legarec.fr">Aller sur partenaires.legarec.fr</a>
          </span>
          <span className={css.or}>ou</span>
          <Bouton variant="secondary" size="lg" full label="Continuer avec le SSO de l'entreprise" disabled />
        </div>
      </form>
    </LoginLayout>
  );
}
