import { creditorChoices, creditorCreated, creditorFile, formatCents, formatDate, isValidIban, newCreditor, type CreditorFile } from '@legarec/contracts';
import { Alerte, Badge, Bouton, Carte, Case, Champ, EtatListe, PageHeader, useConfirm, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import { AccessDenied } from '../error/ErrorPage';
import { AccountCard } from './AccountCard';
import { asMandate, asText, EMPTY_MANDATE, MandateFields, MandateTerms, MandateVersions, percentOf, type MandateText } from './MandateFields';
import css from './CreditorForm.module.css';

const EMPTY_IDENTITY = {
  legalName: '',
  name: '',
  sector: '',
  vatNumber: '',
  address: '',
  postalCode: '',
  city: '',
  managerId: null as string | null,
  portalEnabled: true,
};
const EMPTY_CONTACT = { name: '', title: '', email: '', phone: '', isMain: false };
const EMPTY_ACCOUNT = { holder: '', iban: '', bic: '' };
type Identity = typeof EMPTY_IDENTITY;
type Contact = typeof EMPTY_CONTACT;
type Errors = Record<string, string>;
const contactsOf = (file: CreditorFile): Contact[] => (file.contacts.length ? file.contacts : [{ ...EMPTY_CONTACT, isMain: true }]);
const errorsOf = (issues: readonly { path: readonly PropertyKey[]; message: string }[]): Errors =>
  Object.fromEntries(issues.map((issue) => [issue.path.map(String).join('.'), issue.message]));
/** VAT number that follows from the SIREN. */
const vatOf = (siren: string) => {
  const digits = siren.replace(/\s/gu, '');
  return /^\d{9}$/u.test(digits) ? `FR${String((12 + 3 * (Number(digits) % 97)) % 97).padStart(2, '0')}${digits}` : '';
};

export function CreditorFormPage() {
  const { id } = useParams();
  const user = useCurrentUser();
  const allowed = user.role === 'DIRECTOR' || user.role === 'COLLECTION_MANAGER';
  const choices = useApi(creditorChoices, '/creditors/choices', { enabled: allowed });
  const file = useApi(creditorFile, `/creditors/${id}/file`, { enabled: allowed && !!id });
  if (!allowed) return <AccessDenied />;
  const error = choices.error ?? file.error;
  if (!choices.data || (id && !file.data))
    return (
      <div className={layout.card}>
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void Promise.all([choices.refetch(), ...(id ? [file.refetch()] : [])])} />
      </div>
    );
  return id && file.data ? (
    <Change key={file.data.id} file={file.data} managers={choices.data.managers} />
  ) : (
    <Create managers={choices.data.managers} bankAccess={choices.data.bankAccess === 'EDIT'} rate={choices.data.defaults.amicableRateBp} />
  );
}

// ---------------------------------------------------------------- Fields shared by both screens

function IdentityFields({
  value,
  onChange,
  errors,
  managers,
  siren,
}: {
  value: Identity;
  onChange: (value: Identity) => void;
  errors: Errors;
  managers: { id: string; name: string }[];
  siren: { value: string; onChange?: (value: string) => void };
}) {
  const set = (key: keyof Identity) => (next: string) => onChange({ ...value, [key]: next });
  const field = (key: Exclude<keyof Identity, 'managerId' | 'portalEnabled'>, label: string, more: Partial<Parameters<typeof Champ>[0]> = {}) => (
    <Champ label={label} value={value[key]} error={errors[`identity.${key}`]} onChange={set(key)} autocomplete="off" {...more} />
  );
  return (
    <div className={layout.form}>
      <Champ
        label="SIREN"
        required
        readOnly={!siren.onChange}
        inputMode="numeric"
        autocomplete="off"
        value={siren.value}
        error={errors.siren}
        onChange={siren.onChange}
      />
      {field('legalName', 'Raison sociale', { required: true })}
      {field('name', 'Nom affiché', { required: true })}
      {field('sector', 'Secteur', { optional: true })}
      {field('vatNumber', 'N° de TVA', { optional: true, help: 'Calculé d’après le SIREN, modifiable' })}
      <Champ
        label="Gestionnaire du compte"
        type="select"
        optional
        help="Reçoit les messages du créancier"
        value={value.managerId ?? ''}
        error={errors['identity.managerId']}
        options={[{ value: '', label: 'À choisir' }, ...managers.map((manager) => ({ value: manager.id, label: manager.name }))]}
        onChange={(next) => onChange({ ...value, managerId: next || null })}
      />
      {field('address', 'Adresse', { required: true })}
      {field('postalCode', 'Code postal', { required: true, inputMode: 'numeric' })}
      {field('city', 'Ville', { required: true })}
    </div>
  );
}

function ContactFields({ value, onChange, errors }: { value: Contact[]; onChange: (value: Contact[]) => void; errors: Errors }) {
  const change = (index: number, some: Partial<Contact>) => onChange(value.map((item, position) => (position === index ? { ...item, ...some } : item)));
  return (
    <div className={layout.stack}>
      {errors.contacts && (
        <p role="alert" className={css.error}>
          {errors.contacts}
        </p>
      )}
      {value.map((contact, index) => {
        const rank = value.length > 1 ? `, interlocuteur ${index + 1}` : '';
        const field = (key: 'name' | 'title' | 'email' | 'phone', label: string, more: Partial<Parameters<typeof Champ>[0]> = {}) => (
          <Champ
            label={`${label}${rank}`}
            value={contact[key]}
            error={errors[`contacts.${index}.${key}`]}
            autocomplete="off"
            onChange={(next) => change(index, { [key]: next })}
            {...more}
          />
        );
        return (
          <fieldset key={index} className={css.contact}>
            <legend className={layout.hidden}>Interlocuteur {index + 1}</legend>
            <div className={layout.form}>
              {field('name', 'Nom', { required: true })}
              {field('title', 'Fonction', { optional: true })}
              {field('email', 'E-mail', { type: 'email', required: true })}
              {field('phone', 'Téléphone', { type: 'tel', optional: true })}
            </div>
            <div className={layout.between}>
              <label className={css.radio}>
                <input
                  type="radio"
                  name="main-contact"
                  checked={contact.isMain}
                  onChange={() => onChange(value.map((item, position) => ({ ...item, isMain: position === index })))}
                />
                Interlocuteur principal
              </label>
              {value.length > 1 && (
                <Bouton
                  variant="ghost"
                  size="sm"
                  label="Retirer"
                  ariaLabel={`Retirer : ${contact.name || `interlocuteur ${index + 1}`}`}
                  onPress={() => {
                    const rest = value.filter((_item, position) => position !== index);
                    onChange(rest.some((item) => item.isMain) ? rest : rest.map((item, position) => ({ ...item, isMain: position === 0 })));
                  }}
                />
              )}
            </div>
          </fieldset>
        );
      })}
      <div>
        <Bouton
          variant="secondary"
          size="sm"
          label="+ Ajouter un interlocuteur"
          disabled={value.length >= 20}
          onPress={() => onChange([...value, EMPTY_CONTACT])}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Creation

function Create({ managers, bankAccess, rate }: { managers: { id: string; name: string }[]; bankAccess: boolean; rate: number }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [siren, setSiren] = useState('');
  const [identity, setIdentity] = useState(EMPTY_IDENTITY);
  const [contacts, setContacts] = useState<Contact[]>([{ ...EMPTY_CONTACT, isMain: true }]);
  const [mandate, setMandate] = useState<MandateText>({ ...EMPTY_MANDATE, amicableRate: percentOf(rate) });
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [errors, setErrors] = useState<Errors>({});
  const typed = bankAccess && (account.holder || account.iban || account.bic);

  const submit = () => {
    const terms = asMandate(mandate);
    const parsed = newCreditor.safeParse({ siren, identity, contacts, mandate: terms });
    const found: Errors = parsed.success ? {} : errorsOf(parsed.error.issues);
    if (typed) {
      if (!account.holder.trim()) found['account.holder'] = 'Indiquez le titulaire.';
      if (!isValidIban(account.iban)) found['account.iban'] = 'Cet IBAN n’est pas valide.';
      if (!/^[A-Z]{6}[A-Z\d]{2}(?:[A-Z\d]{3})?$/u.test(account.bic.replace(/\s/gu, '').toUpperCase()))
        found['account.bic'] = 'Ce BIC n’est pas valide (8 ou 11 caractères).';
    }
    setErrors(found);
    if (!parsed.success || Object.keys(found).length) return;
    const { data } = parsed;
    confirm({
      title: 'Créer ce créancier ?',
      body: 'Le mandat s’applique aux dossiers ouverts à partir de sa date d’effet. Sans convention signée, la fiche affiche une alerte.',
      details: [
        { k: 'Créancier', v: `${data.identity.name} · SIREN ${data.siren}` },
        {
          k: 'Mandat',
          v: data.mandate.endsOn
            ? `Du ${formatDate(data.mandate.startsOn)} au ${formatDate(data.mandate.endsOn)}`
            : `Dès le ${formatDate(data.mandate.startsOn)}`,
        },
        { k: 'Honoraires', v: `${percentOf(data.mandate.amicableRateBp)} % HT, ${percentOf(data.mandate.litigationRateBp)} % HT en judiciaire` },
        { k: 'Frais d’ouverture', v: `${formatCents(data.mandate.openingFeeCents)} HT par dossier` },
        { k: 'Échéancier sans accord', v: `${data.mandate.planMonthsWithoutConsent} mois` },
        { k: 'Convention', v: 'À déposer' },
        { k: 'Compte', v: typed ? `•••• ${account.iban.replace(/\s/gu, '').slice(-4)}, à confirmer par un autre collaborateur` : 'À saisir' },
        ...(typed && user.role !== 'DIRECTOR' ? [{ k: 'Compte, pour le compte de', v: `${user.directorName}, Directeur` }] : []),
      ],
      confirmLabel: 'Créer le créancier',
      onConfirm: async () => {
        let id: string;
        try {
          ({ id } = await change('/creditors', { body: data, schema: creditorCreated }));
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
          setErrors({ siren: 'Un créancier porte déjà ce SIREN.' });
          toast({ message: 'Un créancier porte déjà ce SIREN.', tone: 'danger' });
          return;
        }
        // Recorded by itself: it needs a right of its own.
        const kept = typed
          ? await change(`/creditors/${id}/bank-accounts`, { body: { replaces: null, account } }).then(
              () => true,
              () => false,
            )
          : true;
        toast(
          kept
            ? { message: `${data.identity.name} créé.` }
            : { message: `${data.identity.name} créé. Le compte n’a pas été enregistré : saisissez-le de nouveau.`, tone: 'danger' },
        );
        await navigate(kept ? `/creanciers/${id}` : `/creanciers/${id}/modifier`);
      },
    });
  };
  return (
    <form
      className={layout.stack}
      noValidate
      autoComplete="off"
      aria-label="Nouveau créancier"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader title="Nouveau créancier" description="Fiche, interlocuteurs, mandat et compte de reversement" />
      <Carte title="1. Identité" description="Reprise sur les courriers, les factures et dans l’espace créancier">
        <IdentityFields
          value={identity}
          onChange={setIdentity}
          errors={errors}
          managers={managers}
          siren={{
            value: siren,
            onChange: (value) => {
              // Follows the SIREN until it is typed by hand.
              if (!identity.vatNumber || identity.vatNumber === vatOf(siren)) setIdentity({ ...identity, vatNumber: vatOf(value) });
              setSiren(value);
            },
          }}
        />
      </Carte>
      <Carte title="2. Interlocuteurs" description="Le principal reçoit les relevés, les factures et les demandes d’accord">
        <ContactFields value={contacts} onChange={setContacts} errors={errors} />
      </Carte>
      <Carte title="3. Mandat" description="Conditions appliquées aux dossiers confiés" badge="Convention à déposer" badgeTone="warning">
        <MandateFields value={mandate} onChange={setMandate} errors={errors} />
      </Carte>
      <Carte title="4. Compte de reversement" description="Directeur et, par délégation, Responsable du recouvrement. IBAN chiffré.">
        {bankAccess ? (
          <div className={layout.form}>
            <Champ
              label="Titulaire"
              value={account.holder}
              error={errors['account.holder']}
              autocomplete="off"
              onChange={(holder) => setAccount({ ...account, holder })}
            />
            <Champ
              label="IBAN"
              mono
              value={account.iban}
              error={errors['account.iban']}
              autocomplete="off"
              onChange={(iban) => setAccount({ ...account, iban })}
            />
            <Champ label="BIC" mono value={account.bic} error={errors['account.bic']} autocomplete="off" onChange={(bic) => setAccount({ ...account, bic })} />
          </div>
        ) : (
          <Alerte
            tone="neutral"
            icon="lock"
            title="Réservé au Directeur"
            text="La délégation administrative a été retirée. Le Directeur saisit ce compte ; sa confirmation par téléphone attend le retour de la délégation, car elle revient à un autre collaborateur."
          />
        )}
      </Carte>
      <Carte title="5. Espace créancier">
        <Case
          label="Accès à partenaires.legarec.fr"
          description="Les comptes s’invitent ensuite depuis Équipe."
          checked={identity.portalEnabled}
          onToggle={(portalEnabled) => setIdentity({ ...identity, portalEnabled })}
        />
      </Carte>
      <div className={css.bar}>
        <span>Créancier non enregistré</span>
        <span className={layout.inline}>
          <Bouton label="Annuler" variant="secondary" href="/creanciers" />
          <Bouton type="submit" label="Créer le créancier" />
        </span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Change

function Change({ file, managers }: { file: CreditorFile; managers: { id: string; name: string }[] }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  /** What the screen was opened with, or has been told of since. */
  const [base, setBase] = useState(file);
  const [identity, setIdentity] = useState<Identity>(file.identity);
  const [contacts, setContacts] = useState<Contact[]>(contactsOf(file));
  const [amending, setAmending] = useState<MandateText | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const path = `/creditors/${file.id}`;
  const last = file.mandates[0];
  const current = file.mandates.find((mandate) => mandate.state === 'CURRENT');
  const typed = JSON.stringify([identity, contacts]);
  const same = (other: CreditorFile) => typed === JSON.stringify([other.identity, contactsOf(other)]);
  const dirty = !same(file);
  if (file.version !== base.version && (same(base) || !dirty)) {
    setBase(file);
    setIdentity(file.identity);
    setContacts(contactsOf(file));
  }
  // Changed by someone else meanwhile: what is typed stays, and is not recorded over it unknowingly.
  const stale = file.version !== base.version && dirty && !same(base);
  const moved = (error: unknown) => {
    if (!(error instanceof ApiError) || error.status !== 409) return false;
    toast({ message: 'Cette fiche a changé entre-temps : vérifiez-la avant de recommencer. Rien n’a été enregistré.', tone: 'danger' });
    return true;
  };

  const save = async () => {
    const parsed = newCreditor.pick({ identity: true, contacts: true }).safeParse({ identity, contacts });
    setErrors(parsed.success ? {} : errorsOf(parsed.error.issues));
    if (!parsed.success) return;
    setSaving(true);
    try {
      await change(path, { method: 'PUT', body: { version: base.version, ...parsed.data } });
      const before = newCreditor.pick({ identity: true, contacts: true }).safeParse({ identity: base.identity, contacts: base.contacts });
      toast({
        message: `Fiche de ${parsed.data.identity.name} enregistrée.`,
        undo: before.success ? () => void change(path, { method: 'PUT', body: { version: base.version + 1, ...before.data } }) : undefined,
      });
    } catch (error) {
      if (!moved(error)) toast({ message: 'L’enregistrement n’a pas abouti. Votre saisie est conservée à l’écran : réessayez.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  const amend = () => {
    if (!amending || !last) return;
    const parsed = newCreditor.pick({ mandate: true }).safeParse({ mandate: asMandate(amending) });
    const found: Errors = parsed.success ? {} : errorsOf(parsed.error.issues);
    if (parsed.success && parsed.data.mandate.startsOn <= last.startsOn) found['mandate.startsOn'] = 'La date d’effet doit suivre celle du mandat modifié.';
    setErrors(found);
    if (!parsed.success || Object.keys(found).length) return;
    const { mandate } = parsed.data;
    confirm({
      title: 'Enregistrer cet avenant ?',
      body: 'Les dossiers ouverts à partir de la date d’effet suivent les nouvelles conditions. Les dossiers en cours gardent les leurs.',
      details: [
        { k: 'Créancier', v: file.identity.name },
        { k: 'Date d’effet', v: formatDate(mandate.startsOn) },
        { k: 'Honoraires amiable', v: `${percentOf(last.amicableRateBp)} % → ${percentOf(mandate.amicableRateBp)} % HT` },
        { k: 'Honoraires judiciaire', v: `${percentOf(last.litigationRateBp)} % → ${percentOf(mandate.litigationRateBp)} % HT` },
        { k: 'Dossiers inchangés', v: String(file.openCases) },
        { k: 'Document', v: 'À déposer' },
      ],
      confirmLabel: 'Enregistrer l’avenant',
      onConfirm: async () => {
        try {
          await change(`${path}/amendments`, { body: { amends: last.id, mandate } });
        } catch (error) {
          if (!moved(error)) throw error;
          return;
        }
        setAmending(null);
        toast({ message: 'Avenant enregistré.' });
      },
    });
  };
  return (
    <div className={layout.stack}>
      <Bouton label="Fiche du créancier" icon="arrow-left" variant="link" size="sm" href={`/creanciers/${file.id}`} layout={{ alignSelf: 'flex-start' }} />
      <PageHeader title={`Modifier ${file.identity.name}`} description="Fiche, interlocuteurs, mandat et compte de reversement" />
      {stale && (
        <Alerte
          tone="warning"
          title="Cette fiche a changé"
          text={`${file.updatedBy ?? 'Quelqu’un'} l’a modifiée (${file.updatedAt.toLowerCase()}). Rechargez avant d’enregistrer : votre saisie reste à l’écran.`}
          actionLabel="Recharger"
          onAction={() => setBase(file)}
        />
      )}
      {current && !current.hasContract && (
        <Alerte
          tone="warning"
          title="Convention signée à déposer"
          text={`Le mandat de ${file.identity.name} est actif depuis le ${formatDate(current.startsOn)} sans convention signée.`}
        />
      )}
      <form
        className={layout.stack}
        noValidate
        autoComplete="off"
        aria-label="Fiche du créancier"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Carte title="1. Identité" description="Reprise sur les courriers, les factures et dans l’espace créancier">
          <IdentityFields value={identity} onChange={setIdentity} errors={errors} managers={managers} siren={{ value: file.siren }} />
        </Carte>
        <Carte title="2. Interlocuteurs" description="Le principal reçoit les relevés, les factures et les demandes d’accord">
          <ContactFields value={contacts} onChange={setContacts} errors={errors} />
        </Carte>
        <Carte title="5. Espace créancier">
          <Case
            label="Accès à partenaires.legarec.fr"
            description="Les comptes s’invitent ensuite depuis Équipe."
            checked={identity.portalEnabled}
            onToggle={(portalEnabled) => setIdentity({ ...identity, portalEnabled })}
          />
        </Carte>
        {dirty && (
          <div className={css.bar} role="status">
            <span>Modifications non enregistrées</span>
            <span className={layout.inline}>
              <Bouton
                label="Annuler"
                variant="secondary"
                disabled={saving}
                onPress={() => {
                  setIdentity(file.identity);
                  setContacts(file.contacts);
                  setErrors({});
                }}
              />
              <Bouton type="submit" label="Enregistrer" loading={saving} disabled={stale} />
            </span>
          </div>
        )}
      </form>
      <Carte title="3. Mandat" description="Les conditions ne se corrigent que par un avenant daté">
        <div className={layout.stack}>
          {current ? (
            <>
              <p className={layout.body}>
                <Badge label="Mandat actif" tone="success" /> En vigueur depuis le {formatDate(current.startsOn)}
              </p>
              <MandateTerms mandate={current} />
            </>
          ) : (
            <Alerte tone="warning" title="Aucun mandat actif" text="Aucun dossier ne s’ouvre tant qu’aucun mandat n’est en vigueur." />
          )}
          {amending ? (
            <form
              className={layout.stack}
              noValidate
              autoComplete="off"
              aria-label="Avenant"
              onSubmit={(event) => {
                event.preventDefault();
                amend();
              }}
            >
              <MandateFields value={amending} onChange={setAmending} errors={errors} former={last} />
              <div className={layout.end}>
                <Bouton variant="secondary" label="Abandonner l’avenant" onPress={() => (setAmending(null), setErrors({}))} />
                <Bouton type="submit" label="Enregistrer l’avenant" />
              </div>
            </form>
          ) : (
            last && (
              <div>
                <Bouton variant="secondary" size="sm" label="Préparer un avenant" onPress={() => setAmending({ ...asText(last), startsOn: '', endsOn: '' })} />
              </div>
            )
          )}
          <MandateVersions versions={file.mandates} />
        </div>
      </Carte>
      <AccountCard file={file} onMoved={moved} />
    </div>
  );
}
