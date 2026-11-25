import {
  codeBySms,
  debtorAccess,
  debtorAccessError,
  debtorIdentifier,
  debtorLink,
  debtorSession,
  type DebtorAccessError,
  type DebtorIdentifier,
} from '@legarec/contracts';
import { api, ApiError } from '@legarec/platform';
import { Alerte, Bouton, Case, Champ, Onglets, useConfirm } from '@legarec/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import css from '../app/Debtor.module.css';
import { SESSION_KEY, useSession } from '../app/data';
import { Frame } from '../app/Frame';

const FAILURES: Record<DebtorAccessError['code'], (error: DebtorAccessError) => string> = {
  INVALID: (error) =>
    `Identifiant ou code incorrect. Il vous reste ${'attemptsLeft' in error ? error.attemptsLeft : 0} essai${'attemptsLeft' in error && error.attemptsLeft > 1 ? 's' : ''} avant le blocage.`,
  LOCKED: (error) => `Accès bloqué pendant ${'minutes' in error ? error.minutes : 15} minutes après 5 échecs. Vous pouvez nous appeler au 01 87 88 02 98.`,
  BLOCKED: () => 'Accès bloqué après 10 échecs. Votre gestionnaire est prévenu : un collaborateur doit vous donner un nouveau code. Appelez le 01 87 88 02 98.',
  TOO_MANY: () => 'Trop de demandes depuis cette connexion. Réessayez plus tard ou appelez le 01 87 88 02 98.',
};

export function AccessPage() {
  const { token } = useParams();
  const session = useSession();
  const link = useQuery({
    queryKey: ['link', token],
    queryFn: () => api(debtorLink, `/debtor/links/${encodeURIComponent(token ?? '')}`),
    enabled: !!token && session.data === null,
    retry: false,
  });
  if (session.isPending || (token && session.data === null && link.isPending)) return null;
  if (session.data) return <Navigate to="/espace" replace />;
  return <AccessForm initial={link.data?.identifier} unknownLink={link.isError} />;
}

function AccessForm({ initial, unknownLink }: { initial?: { kind: DebtorIdentifier['kind']; value: string }; unknownLink: boolean }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [kind, setKind] = useState<DebtorIdentifier['kind']>(initial?.kind ?? 'SIRET');
  const [value, setValue] = useState(initial?.value ?? '');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<{ value?: string; code?: string }>({});
  const [failure, setFailure] = useState<DebtorAccessError | null>(null);
  const [sms, setSms] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const report = (error: unknown) => {
    const body = error instanceof ApiError ? debtorAccessError.safeParse(error.body) : undefined;
    if (body?.success) setFailure(body.data);
    else setOffline(true);
  };
  const submit = async () => {
    const parsed = debtorAccess.safeParse({ identifier: { kind, value }, code, remember });
    setOffline(false);
    if (!parsed.success) {
      const find = (key: string) => parsed.error.issues.find((issue) => issue.path[0] === key)?.message;
      return setErrors({ value: find('identifier'), code: find('code') });
    }
    setErrors({});
    setBusy(true);
    try {
      // The code only travels in the request body, never in a URL.
      client.setQueryData(SESSION_KEY, await api(debtorSession, '/debtor/access', { method: 'POST', body: parsed.data }));
      await navigate('/espace');
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  const askSms = () => {
    const parsed = debtorIdentifier.safeParse({ kind, value });
    if (!parsed.success) return setErrors({ value: parsed.error.issues[0]?.message });
    setErrors({});
    confirm({
      title: 'Recevoir votre code par SMS ?',
      body: 'Le code est envoyé au numéro enregistré dans votre dossier.',
      details: [{ k: kind === 'SIRET' ? 'SIRET' : 'Référence', v: value }],
      confirmLabel: 'Envoyer le SMS',
      onConfirm: async () => {
        try {
          const result = await api(codeBySms, '/debtor/code-by-sms', { method: 'POST', body: parsed.data });
          setSms(
            result.maskedPhone
              ? `SMS au ${result.maskedPhone} : votre code est en route.`
              : 'Si un numéro est enregistré dans votre dossier, le code vient d’être envoyé.',
          );
        } catch (error) {
          report(error);
        }
      },
    });
  };
  const blocked = failure?.code === 'LOCKED' || failure?.code === 'BLOCKED';
  return (
    <Frame>
      <section aria-labelledby="acces-titre" className={css.narrow}>
        <form
          className={css.panel}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className={css.text}>
            <h1 id="acces-titre">Accéder à mon dossier</h1>
          </div>
          <p>Munissez-vous du courrier reçu : il porte votre code d’accès à 4 lettres.</p>
          {unknownLink && <Alerte tone="warning" text="Ce lien n’est plus valable. Saisissez votre identifiant." />}
          <Onglets
            label="Votre identifiant"
            items={[
              {
                label: 'Entreprise',
                selected: kind === 'SIRET',
                pick: () => {
                  setKind('SIRET');
                  setErrors({});
                },
              },
              {
                label: 'Particulier',
                selected: kind === 'REFERENCE',
                pick: () => {
                  setKind('REFERENCE');
                  setErrors({});
                },
              },
            ]}
          />
          <Champ
            size="lg"
            label={kind === 'SIRET' ? 'SIRET' : 'Référence du dossier'}
            help={kind === 'SIRET' ? '14 chiffres, avec ou sans espaces' : 'Indiquée en haut du courrier, de l’e-mail ou du SMS reçu'}
            value={value}
            error={errors.value}
            inputMode={kind === 'SIRET' ? 'numeric' : 'text'}
            autocomplete="off"
            spellCheck={false}
            onChange={setValue}
          />
          <div className={css.code}>
            <Champ
              size="lg"
              label="Code d’accès"
              help="4 lettres, sans I ni O. Minuscules acceptées."
              value={code}
              error={errors.code}
              maxLength={4}
              autocomplete="off"
              spellCheck={false}
              onChange={(next) => setCode(next.toUpperCase())}
            />
          </div>
          <Case label="Mémoriser cet appareil pendant 30 jours" checked={remember} onToggle={setRemember} />
          {failure && <Alerte tone={failure.code === 'INVALID' ? 'warning' : 'danger'} text={FAILURES[failure.code](failure)} />}
          {offline && <Alerte tone="danger" text="Le service ne répond pas. Réessayez dans quelques instants." />}
          {sms && <Alerte tone="success" text={sms} />}
          <Bouton type="submit" size="lg" full label="Accéder à mon dossier" loading={busy} disabled={blocked} />
          <Bouton variant="secondary" full icon="sms" label="Recevoir mon code par SMS" disabled={failure?.code === 'BLOCKED'} onPress={askSms} />
          <p className={css.hint}>Aucun compte à créer. Le code n’est jamais envoyé par e-mail.</p>
          <Bouton variant="link" size="sm" label="Je n’ai pas mon code : payer ou écrire au cabinet" href="/acces-limite" />
        </form>
      </section>
    </Frame>
  );
}
