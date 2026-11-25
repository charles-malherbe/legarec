import { proofError, proofNeeded, SENSITIVE_ACTIONS, sensitiveAction, webauthnOptions } from '@legarec/contracts';
import { api, ApiError, onProofRequired } from '@legarec/platform';
import { FocusTrap, Portal } from '@mantine/core';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod';
import { Bouton } from './Bouton';
import { Champ } from './Champ';
import css from './Confirm.module.css';
import { OFFLINE, TOO_MANY } from './FormulaireConnexion';
import { Icone } from './Icone';

type Method = z.infer<typeof proofNeeded>['methods'][number];
interface Request {
  action: string;
  methods: Method[];
  answer: (given: boolean) => void;
}
const left = (count: number) => `Il vous reste ${count} tentative${count > 1 ? 's' : ''}.`;

/** Asks for a proof of identity when the API does, then lets the action go on. `onClosed`: the session was closed by the failures, or elsewhere. */
export function Reauthentification({ children, onClosed }: { children: ReactNode; onClosed: () => void }) {
  const [request, setRequest] = useState<Request | null>(null);
  /** Two actions at the same time: one window, one answer. */
  const waiting = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    const ask = async (method: string, path: string) => {
      let methods: Method[];
      try {
        ({ methods } = await api(proofNeeded, '/auth/proof'));
      } catch {
        return false;
      }
      const key = sensitiveAction(method, path);
      return new Promise<boolean>((answer) => setRequest({ action: key ? SENSITIVE_ACTIONS[key] : 'Action sensible', methods, answer }));
    };
    const stop = onProofRequired((method, path) => {
      waiting.current ??= ask(method, path).finally(() => {
        waiting.current = null;
      });
      return waiting.current;
    });
    return stop;
  }, []);
  // Nothing goes on once the screen it was asked for is gone.
  const pending = useRef<Request | null>(null);
  useEffect(() => {
    pending.current = request;
  }, [request]);
  useEffect(() => () => pending.current?.answer(false), []);
  const end = (given: boolean) => {
    request?.answer(given);
    setRequest(null);
  };
  return (
    <>
      {children}
      {request && (
        <Fenetre
          request={request}
          onEnd={end}
          onClosed={() => {
            end(false);
            onClosed();
          }}
        />
      )}
    </>
  );
}

function Fenetre({ request, onEnd, onClosed }: { request: Request; onEnd: (given: boolean) => void; onClosed: () => void }) {
  const { methods } = request;
  const [byKey, setByKey] = useState(methods.includes('WEBAUTHN') && !methods.includes('TOTP'));
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => void setTimeout(() => opener?.focus?.(), 0), [opener]);
  const titleId = useId();
  const textId = useId();
  const password = methods.includes('PASSWORD');

  const give = async (proof: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await api(z.undefined(), '/auth/proof', { method: 'POST', body: await proof() });
      onEnd(true);
    } catch (failure) {
      setValue('');
      const status = failure instanceof ApiError ? failure.status : 0;
      const known = failure instanceof ApiError ? proofError.safeParse(failure.body) : undefined;
      if (status === 401) return onClosed();
      if (status === 423 && known?.data?.closed) return setClosed(true);
      setError(
        status === 423
          ? 'Trop de tentatives. Réessayez dans 15 minutes. Rien n’a été enregistré.'
          : status === 429
            ? TOO_MANY
            : known?.data?.code === 'INVALID_PROOF'
              ? `${byKey ? 'Clé non reconnue.' : password ? 'Mot de passe incorrect.' : 'Code incorrect.'} ${left(known.data.attemptsLeft ?? 0)}`
              : byKey && !(failure instanceof ApiError)
                ? 'La clé de sécurité n’a pas été reconnue. Réessayez ou utilisez un code.'
                : status === 422
                  ? 'Cette preuve ne convient pas.'
                  : OFFLINE,
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = value.trim();
    if (!typed || busy) return;
    if (password) return void give(() => Promise.resolve({ method: 'PASSWORD', password: value }));
    const code = typed.replace(/\s/gu, '');
    // Eight digits: a backup code.
    void give(() => Promise.resolve({ method: code.replace(/\D/gu, '').length === 8 ? 'BACKUP_CODE' : 'TOTP', code }));
  };
  const useKey = () =>
    void give(async () => {
      const options = await api(webauthnOptions, '/auth/proof/webauthn', { method: 'POST' });
      const { startAuthentication } = await import('@simplewebauthn/browser');
      return { method: 'WEBAUTHN', response: await startAuthentication({ optionsJSON: options as never }) };
    });

  return (
    <Portal>
      <div className={css.overlay} data-modal-open="true" role="presentation">
        <FocusTrap active>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={textId}
            aria-busy={busy}
            tabIndex={-1}
            className={css.dialog}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              if (closed) onClosed();
              else if (!busy) onEnd(false);
            }}
          >
            <div className={css.head}>
              <span className={css.icon} data-tone={closed ? 'danger' : 'primary'}>
                <Icone icon="lock" size={20} />
              </span>
              <div className={css.text}>
                <h2 id={titleId} className={css.title}>
                  {closed ? 'Session fermée' : 'Confirmez que c’est bien vous'}
                </h2>
                <p id={textId} className={css.body}>
                  {closed
                    ? 'Trop de tentatives. Par sécurité, votre session est fermée. Rien n’a été enregistré.'
                    : 'Cette action est sensible. Rien n’est enregistré tant que vous n’avez pas confirmé.'}
                </p>
              </div>
            </div>
            {closed ? (
              <div className={css.foot}>
                <Bouton label="Aller à la connexion" autoFocus onPress={onClosed} />
              </div>
            ) : (
              <form onSubmit={submit} noValidate autoComplete="off">
                <dl className={css.details}>
                  <div className={css.detail}>
                    <dt>Action</dt>
                    <dd>{request.action}</dd>
                  </div>
                </dl>
                <div className={css.field}>
                  {byKey ? (
                    <>
                      <p className={css.body}>Insérez ou approchez votre clé de sécurité quand votre navigateur la demande.</p>
                      {error && (
                        <p role="alert" className={css.failed}>
                          {error}
                        </p>
                      )}
                    </>
                  ) : password ? (
                    <Champ label="Mot de passe" type="password" autocomplete="current-password" autoFocus value={value} error={error} onChange={setValue} />
                  ) : (
                    <Champ
                      label="Code à 6 chiffres"
                      inputMode="numeric"
                      autocomplete="one-time-code"
                      maxLength={11}
                      autoFocus
                      help="Affiché dans votre application. Un code de secours convient aussi."
                      value={value}
                      error={error}
                      onChange={setValue}
                    />
                  )}
                </div>
                <div className={css.foot}>
                  <span className={css.hint}>Échap pour annuler</span>
                  <Bouton variant="secondary" label="Annuler" disabled={busy} onPress={() => onEnd(false)} />
                  {methods.includes('WEBAUTHN') && (
                    <Bouton
                      variant="link"
                      label={byKey ? 'Utiliser un code' : 'Utiliser ma clé'}
                      disabled={busy}
                      onPress={() => {
                        setError('');
                        setValue('');
                        setByKey(!byKey);
                      }}
                    />
                  )}
                  {byKey ? (
                    <Bouton label="Utiliser ma clé" loading={busy} autoFocus onPress={useKey} />
                  ) : (
                    <Bouton type="submit" label="Confirmer" loading={busy} disabled={!value.trim()} onPress={() => {}} />
                  )}
                </div>
              </form>
            )}
          </div>
        </FocusTrap>
      </div>
    </Portal>
  );
}
