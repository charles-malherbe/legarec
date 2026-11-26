import {
  absenceForm,
  accountData,
  backupCodes,
  delegationsData,
  formatDate,
  passwordForm,
  profileForm,
  ROLE_LABELS,
  totpSetup,
  webauthnOptions,
  type AccountData,
  type AccountSession,
} from '@legarec/contracts';
import {
  Alerte,
  Avatar,
  Badge,
  Bouton,
  Carte,
  Case,
  Champ,
  CodesSecours,
  EtatListe,
  Icone,
  OFFLINE,
  Onglets,
  PageHeader,
  Reglage,
  Tableau,
  useConfirm,
  useToast,
} from '@legarec/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ZodType } from 'zod';
import { useApi, useChange } from '../../app/data';
import { ApiError } from '../../app/api';
import { SESSION_KEY, useCurrentUser, useUpdatePreferences } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import css from './Account.module.css';

const TABS = [
  ['profil', 'Profil'],
  ['securite', 'Sécurité et connexion'],
  ['notifications', 'Notifications'],
  ['preferences', 'Préférences'],
] as const;
const issues = (schema: ZodType, value: unknown) => {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
};

const LOCKED = 'Compte bloqué pendant 15 minutes après 5 tentatives échouées.';
const passwordError = (error: unknown) => {
  if (!(error instanceof ApiError) || error.status >= 500) return OFFLINE;
  // The screen goes back to the sign-in.
  if (error.status === 401) return '';
  if (error.status === 423) return LOCKED;
  return (error.body as { code?: string } | undefined)?.code === 'INVALID'
    ? 'Le nouveau mot de passe doit être différent de votre adresse e-mail.'
    : 'Mot de passe actuel incorrect.';
};

export function AccountPage() {
  const user = useCurrentUser();
  const { data, error, refetch } = useApi(accountData, '/account');
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('notifications');
  return (
    <>
      <PageHeader title="Mon compte" description={`${user.firstName} ${user.lastName} · ${ROLE_LABELS[user.role]}`} />
      <Onglets variant="underline" label="Sections du compte" items={TABS.map(([id, label]) => ({ label, selected: id === tab, pick: () => setTab(id) }))} />
      {!data ? (
        <div className={layout.card}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      ) : (
        <>
          {tab === 'profil' && <Profile data={data} />}
          {tab === 'securite' && <Security data={data} />}
          {tab === 'notifications' && <Notifications data={data} />}
          {tab === 'preferences' && <Preferences />}
        </>
      )}
    </>
  );
}

function Profile({ data }: { data: AccountData }) {
  const user = useCurrentUser();
  const change = useChange();
  const toast = useToast();
  const [names, setNames] = useState({ firstName: user.firstName, lastName: user.lastName });
  const [absence, setAbsence] = useState(data.absence);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saveNames = async () => {
    const found = issues(profileForm, names);
    setErrors(found ?? {});
    if (found) return;
    const before = { firstName: user.firstName, lastName: user.lastName };
    await change('/account/profile', { method: 'PUT', body: names });
    toast({ message: 'Profil enregistré.', undo: () => void change('/account/profile', { method: 'PUT', body: before }).then(() => setNames(before)) });
  };
  const saveAbsence = async () => {
    const found = issues(absenceForm, absence);
    setErrors(found ?? {});
    if (found) return;
    const before = data.absence;
    await change('/account/absence', { method: 'PUT', body: absence });
    toast({ message: 'Absence enregistrée.', undo: () => void change('/account/absence', { method: 'PUT', body: before }).then(() => setAbsence(before)) });
  };
  return (
    <div className={layout.columns}>
      <div className={layout.wide}>
        <Carte title="Informations personnelles">
          <form
            className={layout.stack}
            onSubmit={(event) => {
              event.preventDefault();
              void saveNames();
            }}
          >
            <Avatar title={`${user.firstName} ${user.lastName}`} size={48} />
            <div className={layout.form}>
              <Champ
                label="Prénom"
                value={names.firstName}
                error={errors.firstName}
                autocomplete="given-name"
                onChange={(firstName) => setNames({ ...names, firstName })}
              />
              <Champ
                label="Nom"
                value={names.lastName}
                error={errors.lastName}
                autocomplete="family-name"
                onChange={(lastName) => setNames({ ...names, lastName })}
              />
              <Champ label="E-mail" type="email" value={user.email} readOnly />
              <Champ label="Fonction" value={ROLE_LABELS[user.role]} readOnly />
              <Champ
                label="Poste 3CX"
                value={user.extension ?? 'Aucun'}
                readOnly
                help="Modifiable par le Développeur. Le renvoi vers le mobile se règle dans 3CX."
              />
            </div>
            <div>
              <span className={layout.hint}>Signature e-mail, ajoutée automatiquement à vos messages</span>
              <p className={css.signature}>{data.signature.join('\n')}</p>
            </div>
            <div className={layout.end}>
              <Bouton type="submit" label="Enregistrer" />
            </div>
          </form>
        </Carte>
      </div>
      <div className={layout.aside}>
        {user.role === 'DIRECTOR' && <Delegations />}
        {user.role !== 'DEVELOPER' && (
          <Carte
            title="Absence et remplacement"
            description="Pendant votre absence, votre remplaçant reçoit des notifications neutres, sans accès à vos dossiers ; le Responsable peut les réattribuer."
          >
            <form
              className={layout.stack}
              onSubmit={(event) => {
                event.preventDefault();
                void saveAbsence();
              }}
            >
              <Champ
                label="Remplaçant"
                type="select"
                value={absence.substituteId}
                options={[{ value: '', label: 'Aucun' }, ...data.substitutes.map((item) => ({ value: item.id, label: item.name }))]}
                onChange={(substituteId) => setAbsence({ ...absence, substituteId })}
              />
              <div className={layout.form}>
                <Champ label="Du" type="date" value={absence.from} onChange={(from) => setAbsence({ ...absence, from })} />
                <Champ label="Au" type="date" value={absence.to} error={errors.to} onChange={(to) => setAbsence({ ...absence, to })} />
              </div>
              <Case
                label="Envoyer une réponse automatique aux débiteurs"
                checked={absence.autoReply}
                onToggle={(autoReply) => setAbsence({ ...absence, autoReply })}
              />
              <div className={layout.end}>
                <Bouton type="submit" variant="secondary" size="sm" label="Enregistrer l’absence" />
              </div>
            </form>
          </Carte>
        )}
      </div>
    </div>
  );
}

/** One click each way, with an « Annuler »: the Director keeps every right during a delegation. */
function Delegations() {
  const { data } = useApi(delegationsData, '/delegations');
  const change = useChange();
  const client = useQueryClient();
  const toast = useToast();
  if (!data) return null;
  const set = async (kind: 'technical' | 'administrative', active: boolean, silent = false) => {
    try {
      await change(`/delegations/${kind}`, { method: 'PUT', body: { active } });
    } catch {
      toast({ message: 'La délégation n’a pas été modifiée.', tone: 'danger' });
      return;
    }
    await client.invalidateQueries({ queryKey: SESSION_KEY });
    if (!silent) toast({ message: active ? 'Délégation redonnée.' : 'Délégation retirée.', undo: () => void set(kind, !active, true) });
  };
  return (
    <Carte title="Délégations" description="Vous gardez tous vos droits. Le retrait prend effet immédiatement." padding="none">
      <Reglage
        first
        label="Technique"
        description={`Développeur : ${data.developer}. Paramètres techniques, intégrations, boîtes OVH, support des comptes.`}
        checked={data.technical}
        onToggle={(next) => void set('technical', next)}
      />
      <Reglage
        label="Administrative"
        description={`Responsable du recouvrement : ${data.manager}. Facturation, reversements, modèles, invitations, paramètres du cabinet.`}
        checked={data.administrative}
        onToggle={(next) => void set('administrative', next)}
      />
    </Carte>
  );
}

function Security({ data }: { data: AccountData }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const savePassword = async () => {
    const found = issues(passwordForm, form);
    setErrors(found ?? {});
    if (found) return;
    try {
      await change('/account/password', { method: 'PUT', body: form });
      setForm({ current: '', next: '' });
      toast({ message: 'Mot de passe modifié.' });
    } catch (error) {
      setErrors({ current: passwordError(error) });
    }
  };
  const signOut = (targets: AccountSession[], all: boolean) =>
    confirm({
      tone: 'danger',
      title: all ? 'Déconnecter les autres sessions ?' : `Déconnecter « ${targets[0]?.device} » ?`,
      body: all
        ? 'Tous vos autres appareils devront se reconnecter. À faire si un appareil a été perdu, volé ou partagé.'
        : 'Cet appareil devra se reconnecter avec votre mot de passe.',
      details: targets.map((item) => ({ k: item.device, v: item.meta })),
      confirmLabel: all ? 'Déconnecter les autres sessions' : 'Déconnecter',
      onConfirm: async () => {
        await change(`/account/sessions${all ? '' : `/${targets[0]?.id}`}`, { method: 'DELETE' });
        toast({ message: all ? 'Autres sessions déconnectées.' : 'Session déconnectée.' });
      },
    });
  const others = data.sessions.filter((item) => !item.current);
  return (
    <div className={layout.columns}>
      <div className={layout.wide}>
        <Carte title="Mot de passe">
          <form
            className={layout.stack}
            onSubmit={(event) => {
              event.preventDefault();
              void savePassword();
            }}
          >
            <Champ
              label="Mot de passe actuel"
              type="password"
              autocomplete="current-password"
              value={form.current}
              error={errors.current}
              onChange={(current) => setForm({ ...form, current })}
            />
            <Champ
              label="Nouveau mot de passe"
              type="password"
              autocomplete="new-password"
              value={form.next}
              error={errors.next}
              onChange={(next) => setForm({ ...form, next })}
            />
            <p className={layout.muted}>
              12 caractères minimum, avec au moins un chiffre et un caractère spécial. Dernière modification : {formatDate(data.passwordChangedOn)}. Votre
              session se ferme automatiquement après 30 minutes d’inactivité.
            </p>
            <div>
              <Bouton type="submit" variant="secondary" label="Mettre à jour le mot de passe" />
            </div>
          </form>
        </Carte>
        <TwoFactor data={data} />
      </div>
      <div className={layout.aside}>
        <Carte title="Sessions actives" padding="none">
          <ul className={layout.list}>
            {data.sessions.map((item) => (
              <li key={item.id}>
                <Icone icon={item.mobile ? 'phone' : 'layers'} size={18} />
                <span className={`${layout.text} ${layout.grow}`}>
                  <span className={layout.strong}>{item.device}</span>
                  <span className={layout.hint}>{item.meta}</span>
                </span>
                {item.current ? (
                  <Badge label="Cette session" tone="success" />
                ) : (
                  <Bouton variant="secondary" size="sm" label="Déconnecter" ariaLabel={`Déconnecter : ${item.device}`} onPress={() => signOut([item], false)} />
                )}
              </li>
            ))}
          </ul>
          {others.length > 0 && (
            <div className={css.pad}>
              <Bouton variant="danger-outline" size="sm" label="Déconnecter les autres sessions" onPress={() => signOut(others, true)} />
            </div>
          )}
        </Carte>
      </div>
    </div>
  );
}

/** The window that asks for a proof was closed: nothing has failed. */
const notProved = (caught: unknown) => caught instanceof ApiError && caught.status === 403;

function TwoFactor({ data }: { data: AccountData }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [setup, setSetup] = useState<{ image: string; key: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const { twoFactor } = data;
  const startTotp = async () => {
    setError('');
    try {
      const result = await change('/account/two-factor/totp', { schema: totpSetup });
      const { toDataURL } = await import('qrcode');
      setSetup({ key: result.key, image: await toDataURL(result.uri, { margin: 1, width: 180 }) });
    } catch (caught) {
      if (!notProved(caught)) setError(OFFLINE);
    }
  };
  const verify = async () => {
    try {
      const result = await change('/account/two-factor/totp/verify', { body: { code: code.replace(/\s/g, '') }, schema: backupCodes });
      setCodes(result.backupCodes);
      setSetup(null);
      setCode('');
      toast({ message: 'Double authentification activée.' });
    } catch (caught) {
      if (notProved(caught)) return;
      const status = caught instanceof ApiError ? caught.status : 0;
      setError(status === 422 ? 'Code incorrect. Vérifiez l’heure de votre appareil et réessayez.' : status === 423 ? LOCKED : OFFLINE);
    }
  };
  const startKey = async () => {
    setError('');
    try {
      const options = await change('/account/two-factor/webauthn', { schema: webauthnOptions });
      const { startRegistration } = await import('@simplewebauthn/browser');
      const response = await startRegistration({ optionsJSON: options as never });
      setCodes((await change('/account/two-factor/webauthn/verify', { body: response, schema: backupCodes })).backupCodes);
      toast({ message: 'Clé de sécurité enregistrée.' });
    } catch (caught) {
      if (!notProved(caught)) setError('La clé de sécurité n’a pas été enregistrée. Réessayez ou choisissez l’application d’authentification.');
    }
  };
  const disable = () =>
    confirm({
      tone: 'danger',
      title: 'Désactiver la double authentification ?',
      body: 'Votre compte ne sera plus protégé que par votre mot de passe.',
      details: [{ k: 'Méthode actuelle', v: twoFactor.method === 'WEBAUTHN' ? 'Clé de sécurité' : 'Application d’authentification' }],
      confirmLabel: 'Désactiver',
      onConfirm: async () => {
        await change('/account/two-factor', { method: 'DELETE' });
        toast({ message: 'Double authentification désactivée.' });
      },
    });
  return (
    <Carte
      title="Double authentification"
      badge={twoFactor.enabled ? 'Activée' : 'Non activée'}
      badgeTone={twoFactor.enabled ? 'success' : 'warning'}
      description={
        twoFactor.enabled && twoFactor.since
          ? `${twoFactor.method === 'WEBAUTHN' ? 'Clé de sécurité' : 'Application d’authentification'} · activée le ${formatDate(twoFactor.since)}`
          : 'Proposée à tous les rôles, obligatoire pour le Développeur.'
      }
    >
      <div className={layout.stack}>
        {error && <Alerte tone="danger" text={error} />}
        {codes.length > 0 ? (
          <>
            <span className={layout.strong}>Codes de secours</span>
            <p className={layout.body}>Ils vous permettent de vous connecter si vous perdez votre téléphone.</p>
            <CodesSecours codes={codes} />
            <div className={layout.inline}>
              <Bouton size="sm" label="J'ai conservé mes codes" onPress={() => setCodes([])} />
            </div>
          </>
        ) : setup ? (
          <form
            className={layout.stack}
            onSubmit={(event) => {
              event.preventDefault();
              void verify();
            }}
          >
            <p className={layout.body}>Scannez ce code avec votre application d’authentification, ou saisissez la clé, puis entrez le code affiché.</p>
            <img src={setup.image} width={180} height={180} alt="Code QR à scanner avec l’application d’authentification" />
            <span className={layout.strong}>{setup.key}</span>
            <Champ label="Code à 6 chiffres" value={code} inputMode="numeric" autocomplete="one-time-code" maxLength={7} onChange={setCode} />
            <div className={layout.inline}>
              <Bouton type="submit" size="sm" label="Activer" />
              <Bouton variant="secondary" size="sm" label="Annuler" onPress={() => setSetup(null)} />
            </div>
          </form>
        ) : (
          <div className={layout.inline}>
            <Bouton
              variant="secondary"
              size="sm"
              label={twoFactor.enabled ? 'Changer d’application' : 'Utiliser une application'}
              onPress={() => void startTotp()}
            />
            <Bouton variant="secondary" size="sm" icon="key" label="Utiliser une clé de sécurité" onPress={() => void startKey()} />
            {twoFactor.enabled && !twoFactor.mandatory && <Bouton variant="danger-outline" size="sm" label="Désactiver" onPress={disable} />}
          </div>
        )}
      </div>
    </Carte>
  );
}

function Notifications({ data }: { data: AccountData }) {
  const change = useChange();
  const toast = useToast();
  const save = async (body: Partial<AccountData>, before: Partial<AccountData>) => {
    await change('/account/notifications', { method: 'PUT', body });
    toast({ message: 'Préférences enregistrées.', undo: () => void change('/account/notifications', { method: 'PUT', body: before }) });
  };
  const toggle = (id: string, key: 'inApp' | 'email') =>
    void save(
      { notifications: data.notifications.map((item) => (item.id === id ? { ...item, [key]: !item[key] } : item)) },
      { notifications: data.notifications },
    );
  return (
    <Carte
      title="Préférences de notification"
      description="Choisissez comment être prévenu pour chaque événement. Seuls vos créanciers sont concernés."
      padding="none"
    >
      {data.notifications.length === 0 ? (
        <EtatListe kind="empty" title="Aucune notification de dossier" text="Votre rôle n’accède à aucun dossier." />
      ) : (
        <Tableau
          caption="Préférences de notification"
          hideCaption
          bordered={false}
          rows={data.notifications}
          rowId={(row) => row.id}
          columns={[
            {
              key: 'event',
              label: 'Événement',
              render: (row) => (
                <span className={layout.text}>
                  <span className={layout.strong}>{row.label}</span>
                  <span className={layout.hint}>{row.detail}</span>
                </span>
              ),
            },
            {
              key: 'inApp',
              label: 'Dans l’app',
              render: (row) => <Case label={`${row.label} dans l’app`} hideLabel checked={row.inApp} onToggle={() => toggle(row.id, 'inApp')} />,
            },
            {
              key: 'email',
              label: 'E-mail',
              render: (row) => <Case label={`${row.label} par e-mail`} hideLabel checked={row.email} onToggle={() => toggle(row.id, 'email')} />,
            },
          ]}
        />
      )}
      <div className={`${layout.between} ${css.pad}`}>
        <Case
          label="Résumé quotidien par e-mail, chaque jour à 8:00"
          checked={data.dailySummary}
          onToggle={(dailySummary) => void save({ dailySummary }, { dailySummary: data.dailySummary })}
        />
        <Case
          label="Ne pas déranger en dehors de 8:00–19:00"
          checked={data.quietHours}
          onToggle={(quietHours) => void save({ quietHours }, { quietHours: data.quietHours })}
        />
      </div>
    </Carte>
  );
}

function Preferences() {
  const { preferences } = useCurrentUser();
  const update = useUpdatePreferences();
  const toast = useToast();
  const set = (next: Partial<typeof preferences>) => {
    void update(next);
    toast({ message: 'Préférence enregistrée.', undo: () => void update(preferences) });
  };
  return (
    <Carte title="Préférences d’affichage">
      <div className={layout.stack}>
        <div className={layout.form}>
          <Champ label="Langue" value="Français" readOnly />
          <Champ label="Fuseau horaire" value="Europe/Paris" readOnly />
        </div>
        <Choice
          label="Thème"
          value={preferences.theme}
          options={[
            ['light', 'Clair'],
            ['dark', 'Sombre'],
            ['system', 'Automatique'],
          ]}
          onChange={(theme) => set({ theme })}
        />
        <Choice
          label="Densité des tableaux"
          value={preferences.density}
          options={[
            ['comfortable', 'Confortable'],
            ['compact', 'Compacte'],
          ]}
          onChange={(density) => set({ density })}
        />
        <Case label="Mode malvoyant : textes agrandis et contrastes renforcés" checked={preferences.lowVision} onToggle={(lowVision) => set({ lowVision })} />
      </div>
    </Carte>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <fieldset className={css.choice}>
      <legend>{label}</legend>
      {options.map(([id, text]) => (
        <label key={id} data-checked={id === value || undefined}>
          <input type="radio" name={label} checked={id === value} onChange={() => onChange(id)} />
          {text}
        </label>
      ))}
    </fieldset>
  );
}
