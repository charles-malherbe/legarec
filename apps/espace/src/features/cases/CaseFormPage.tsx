import {
  addedInvoices,
  caseCheckResult,
  caseChoices,
  caseOpened,
  DEBTOR_KIND_LABELS,
  formatCents,
  formatDate,
  isCompanyNumber,
  LEGAL_FORMS,
  newCase,
  parseCents,
  SCENARIO_LABELS,
  type NewCase,
} from '@legarec/contracts';
import { Alerte, Bouton, Carte, Case, Champ, ChampAdresse, EtatListe, FicheSirene, PageHeader, useConfirm, useToast } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../../app/api';
import { useApi, useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import { AccessDenied } from '../error/ErrorPage';
import css from './CaseForm.module.css';

type Kind = NewCase['kind'];
type Errors = Record<string, string>;
const PHONE_LABELS = ['Mobile', 'Standard', 'Ligne directe'];
const EMAIL_LABELS = ['Comptabilité', 'Direction', 'Contact', 'Autre'];
const INVOICE = { number: '', externalRef: '', issuedOn: '', dueOn: '', amount: '', left: '' };
type InvoiceText = typeof INVOICE;
interface ContactText {
  kind: 'PHONE' | 'EMAIL';
  label: string;
  value: string;
  primary: boolean;
}
const EMPTY = {
  creditorId: '',
  externalReference: '',
  kind: 'COMPANY' as Kind,
  number: '',
  name: '',
  nameConfirmed: false,
  legalForm: '',
  address: '',
  postalCode: '',
  city: '',
  contactName: '',
  contactTitle: '',
};
const KIND_HELP: Record<Kind, string> = {
  COMPANY: 'SIRET ou SIREN',
  SOLE_TRADER: 'SIRET ou SIREN, sans score de risque',
  INDIVIDUAL: 'Ni 40 €, ni score de risque',
};
const errorsOf = (issues: readonly { path: readonly PropertyKey[]; message: string }[]): Errors =>
  Object.fromEntries(issues.map((issue) => [issue.path.map(String).join('.'), issue.message]));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

/** Opens a case: a debtor, their coordinates and their unpaid invoices (validated proposal 2). */
export function CaseFormPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const allowed = user.role === 'DIRECTOR' || user.role === 'COLLECTION_MANAGER';
  const { data, error, refetch } = useApi(caseChoices, '/cases/choices', { enabled: allowed });
  if (!allowed) return <AccessDenied />;
  if (!data)
    return (
      <div className={layout.card}>
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      </div>
    );
  if (data.creditors.length === 0)
    return (
      <div className={layout.card}>
        <EtatListe
          title="Aucun créancier"
          text="Ajoutez un créancier pour lui confier des dossiers."
          actionLabel="+ Nouveau créancier"
          onAction={() => void navigate('/creanciers/nouveau')}
        />
      </div>
    );
  return <Form choices={data} />;
}

function Form({ choices }: { choices: { creditors: { id: string; name: string }[]; officers: { id: string; name: string }[]; mayAssign: boolean } }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [params] = useSearchParams();
  const asked = params.get('creancier') ?? '';
  const [form, setForm] = useState({ ...EMPTY, creditorId: choices.creditors.some((creditor) => creditor.id === asked) ? asked : '' });
  const [contacts, setContacts] = useState<ContactText[]>([]);
  const [invoices, setInvoices] = useState<InvoiceText[]>([INVOICE]);
  const [officer, setOfficer] = useState('');
  const [scenario, setScenario] = useState<NewCase['scenario'] | ''>('');
  const [errors, setErrors] = useState<Errors>({});
  const [failed, setFailed] = useState(false);

  const individual = form.kind === 'INDIVIDUAL';
  const [number] = useDebouncedValue(form.number, 300);
  const known = !individual && isCompanyNumber(number) ? number : '';
  // In the body of a request: the number of a sole trader names a person.
  const check = useQuery({
    queryKey: ['case-check', form.creditorId, known],
    queryFn: () => api(caseCheckResult, '/cases/check', { method: 'POST', body: { creditorId: form.creditorId, number: known } }),
    enabled: form.creditorId !== '',
    gcTime: 0,
  });
  const state = form.creditorId ? check.data : undefined;
  const mandate = state?.mandate ?? null;
  const open = known ? (state?.open ?? null) : null;

  const parsedInvoices = invoices.map((invoice) => ({
    ...invoice,
    amount: parseCents(invoice.amount) ?? Number.NaN,
    left: parseCents(invoice.left) ?? Number.NaN,
  }));
  const principal = parsedInvoices.reduce((sum, invoice) => sum + (Number.isFinite(invoice.left) ? invoice.left : 0), 0);
  const day = today();
  const overdue = parsedInvoices.filter((invoice) => invoice.dueOn && invoice.dueOn < day);
  const early = invoices.filter((invoice) => invoice.dueOn && invoice.dueOn >= day);
  const indemnity = !individual && mandate?.fixedIndemnity ? overdue.length * 4000 : 0;
  const daysLate = Math.max(0, ...overdue.map((invoice) => Math.round((Date.parse(day) - Date.parse(invoice.dueOn)) / 86_400_000)));
  const creditorName = choices.creditors.find((creditor) => creditor.id === form.creditorId)?.name ?? '';
  const expected = { principal, invoices: invoices.length };

  const set = (some: Partial<typeof EMPTY>) => {
    setFailed(false);
    setForm((current) => ({ ...current, ...some }));
  };
  const field = (key: Exclude<keyof typeof EMPTY, 'kind' | 'nameConfirmed'>, label: string, more: Partial<Parameters<typeof Champ>[0]> = {}) => (
    <Champ label={label} value={form[key]} error={errors[key]} autocomplete="off" onChange={(value) => set({ [key]: value })} {...more} />
  );
  const refused = (error: unknown): string | null => {
    if (!(error instanceof ApiError) || error.status !== 409) return null;
    return (
      {
        CASE_EXISTS: 'Un dossier est déjà ouvert pour ce débiteur chez ce créancier.',
        DEBTOR_MISMATCH:
          'Ce SIREN est déjà enregistré sous un autre nom ou un autre type de débiteur : vérifiez-les, ou faites corriger le débiteur depuis l’un de ses dossiers.',
        NO_MANDATE: 'Aucun mandat actif : aucun dossier ne s’ouvre.',
        INVOICE_EXISTS: 'Une de ces factures figure déjà dans le dossier.',
        CASE_CLOSED: 'Ce dossier est clos.',
      }[String((error.body as { code?: unknown } | undefined)?.code)] ?? 'La situation a changé entre-temps : vérifiez avant de recommencer.'
    );
  };
  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      const reason = refused(error);
      if (!reason) {
        setFailed(true);
        throw error;
      }
      await check.refetch();
      toast({ message: `${reason} Rien n’a été enregistré.`, tone: 'danger' });
    }
  };

  const add = () => {
    if (!open) return;
    const parsed = addedInvoices.safeParse({ version: open.version, invoices: parsedInvoices, expected });
    setErrors(parsed.success ? {} : errorsOf(parsed.error.issues));
    if (!parsed.success) return;
    confirm({
      title: `Ajouter ${invoices.length} facture${invoices.length > 1 ? 's' : ''} à ce dossier ?`,
      body: 'Les factures s’ajoutent au dossier ouvert. Aucun message ne part.',
      details: [
        { k: 'Dossier', v: `${open.reference} · ${open.name}` },
        { k: 'Factures', v: parsed.data.invoices.map((invoice) => invoice.number).join(', ') },
        { k: 'Principal ajouté', v: formatCents(principal, { decimals: 'always' }) },
        { k: 'Indemnités ajoutées', v: formatCents(indemnity, { decimals: 'always' }) },
      ],
      confirmLabel: 'Ajouter les factures',
      onConfirm: () =>
        attempt(async () => {
          await change(`/cases/${open.id}/invoices`, { body: parsed.data });
          toast({ message: `Factures ajoutées au dossier ${open.reference}.` });
          await navigate(`/debiteurs/${open.id}`);
        }),
    });
  };
  const submit = () => {
    if (open) return add();
    const parsed = newCase.safeParse({
      ...form,
      number: individual ? '' : form.number,
      legalForm: individual ? '' : form.legalForm,
      mandateId: mandate?.id ?? '',
      contacts,
      invoices: parsedInvoices,
      scenario: scenario || mandate?.scenario,
      toMe: officer === 'me',
      expected,
    });
    // The rules on several fields are only checked once each field is right.
    const wrongNumber: Errors = !individual && !isCompanyNumber(form.number) ? { number: 'Ce SIRET ou ce SIREN n’est pas valide.' } : {};
    setErrors(parsed.success ? {} : { ...wrongNumber, ...errorsOf(parsed.error.issues) });
    if (!parsed.success || !mandate) return;
    const { data } = parsed;
    const given = choices.officers.find((person) => person.id === officer);
    confirm({
      title: 'Ouvrir ce dossier ?',
      body: 'Aucun message ne part à l’ouverture : la première relance attend l’envoi du premier courrier.',
      details: [
        { k: 'Créancier', v: creditorName },
        { k: 'Débiteur', v: `${data.name}${individual ? ' · particulier' : ` · ${data.number}`}` },
        { k: 'Factures', v: String(data.invoices.length) },
        { k: 'Principal', v: formatCents(principal, { decimals: 'always' }) },
        { k: 'Indemnités', v: formatCents(indemnity, { decimals: 'always' }) },
        { k: 'Gestionnaire', v: given?.name ?? (officer === 'me' ? `${user.firstName} ${user.lastName}` : 'À attribuer') },
        ...(given && user.role !== 'DIRECTOR' ? [{ k: 'Attribution, pour le compte de', v: `${user.directorName}, Directeur` }] : []),
      ],
      confirmLabel: 'Ouvrir le dossier',
      onConfirm: () =>
        attempt(async () => {
          const { id, reference } = await change('/cases', { body: data, schema: caseOpened });
          // Giving it to someone else is a right of its own.
          const assigned = given
            ? await change('/cases/assign', { body: { ids: [id], officerId: given.id } }).then(
                () => true,
                () => false,
              )
            : true;
          toast(
            assigned
              ? { message: `Dossier ${reference} ouvert.` }
              : { message: `Dossier ${reference} ouvert, mais pas attribué : attribuez-le depuis la liste.`, tone: 'danger' },
          );
          await navigate(`/debiteurs/${id}`);
        }),
    });
  };
  const changeContact = (index: number, some: Partial<ContactText>) =>
    setContacts(
      contacts.map((contact, position) => {
        if (position === index) return { ...contact, ...some };
        return some.primary && contact.kind === contacts[index]!.kind ? { ...contact, primary: false } : contact;
      }),
    );
  const addContact = (kind: ContactText['kind']) =>
    setContacts([
      ...contacts,
      {
        kind,
        label: (kind === 'PHONE' ? PHONE_LABELS : EMAIL_LABELS)[0]!,
        value: '',
        primary: !contacts.some((contact) => contact.kind === kind && contact.primary),
      },
    ]);
  const blocked = form.creditorId !== '' && state !== undefined && !mandate;

  return (
    <form
      className={layout.stack}
      noValidate
      autoComplete="off"
      aria-label="Nouveau débiteur"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader title="Nouveau débiteur" description="Ouvre un dossier : un débiteur, ses coordonnées et ses factures impayées" />
      {failed && <Alerte tone="danger" title="L’enregistrement n’a pas abouti" text="Rien n’a été créé. Votre saisie est conservée à l’écran : réessayez." />}
      <Carte title="1. Créancier">
        <div className={layout.stack}>
          <div className={layout.form}>
            {field('creditorId', 'Créancier', {
              type: 'select',
              required: true,
              options: [{ value: '', label: 'Choisir' }, ...choices.creditors.map((creditor) => ({ value: creditor.id, label: creditor.name }))],
            })}
            {field('externalReference', 'Réf. créancier', { optional: true, help: 'Numéro de client chez le créancier' })}
          </div>
          {mandate && (
            <dl className={layout.facts}>
              <div>
                <dt>Mandat</dt>
                <dd>Actif depuis le {formatDate(mandate.since)}</dd>
              </div>
              {mandate.terms.map((term) => (
                <div key={term.label}>
                  <dt>{term.label}</dt>
                  <dd>{term.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {mandate && !mandate.hasContract && (
            <Alerte
              tone="warning"
              title="Convention signée à déposer"
              text="Le mandat est actif, mais sa convention signée manque sur la fiche du créancier."
              actionLabel="Voir le créancier"
              actionHref={`/creanciers/${form.creditorId}?onglet=convention`}
            />
          )}
          {blocked && (
            <Alerte
              tone="danger"
              title="Aucun mandat actif"
              text={
                state?.startsOn
                  ? `Le mandat de ${creditorName} prend effet le ${formatDate(state.startsOn)}. Aucun dossier ne s’ouvre avant.`
                  : `Aucun mandat de ${creditorName} n’est en vigueur. Aucun dossier ne s’ouvre.`
              }
              actionLabel="Voir le créancier"
              actionHref={`/creanciers/${form.creditorId}?onglet=convention`}
            />
          )}
        </div>
      </Carte>
      <Carte title="2. Débiteur">
        <div className={layout.stack}>
          <fieldset className={css.kinds}>
            <legend>Type de débiteur</legend>
            {(Object.keys(DEBTOR_KIND_LABELS) as Kind[]).map((kind) => (
              <label key={kind} className={css.kind} data-on={form.kind === kind || undefined}>
                <input type="radio" name="kind" checked={form.kind === kind} onChange={() => set({ kind, nameConfirmed: false })} />
                <span className={layout.text}>
                  <span className={layout.strong}>{DEBTOR_KIND_LABELS[kind]}</span>
                  <span className={layout.hint}>{KIND_HELP[kind]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className={layout.form}>
            {!individual && field('number', 'SIRET ou SIREN', { required: true, inputMode: 'numeric' })}
            {field('name', individual ? 'Nom et prénom' : 'Raison sociale', { required: true })}
            {!individual &&
              field('legalForm', 'Forme juridique', {
                type: 'select',
                optional: true,
                help: 'Inconnue : pas de score de risque',
                options: [{ value: '', label: 'Inconnue' }, ...Object.entries(LEGAL_FORMS).map(([value, label]) => ({ value, label }))],
              })}
            {!individual && (
              <FicheSirene
                number={form.number}
                onUse={(record) =>
                  set({
                    name: record.name,
                    legalForm: record.legalCategory in LEGAL_FORMS ? record.legalCategory : form.legalForm,
                    address: record.line,
                    postalCode: record.postalCode,
                    city: record.city,
                  })
                }
              />
            )}
            <ChampAdresse
              required
              value={{ address: form.address, postalCode: form.postalCode, city: form.city }}
              errors={{ address: errors.address, postalCode: errors.postalCode, city: errors.city }}
              onChange={set}
            />
          </div>
          {errors.nameConfirmed && (
            <p role="alert" className={css.error}>
              {errors.nameConfirmed}
            </p>
          )}
          <Case
            label={individual ? 'Nom confirmé' : 'Raison sociale confirmée'}
            description="C’est bien le débiteur nommé sur les factures."
            checked={form.nameConfirmed}
            onToggle={(nameConfirmed) => set({ nameConfirmed })}
          />
          {individual && (
            <Alerte
              tone="info"
              text="Pas d’indemnité de 40 €. Intérêts au taux légal, après mise en demeure seulement. Identifiant de connexion : la référence du dossier."
            />
          )}
          {known && state?.known && (
            <Alerte
              tone="info"
              text={`Ce SIREN est déjà enregistré : ${state.known.name} (${DEBTOR_KIND_LABELS[state.known.kind].toLowerCase()}). Le dossier portera ce nom.`}
            />
          )}
          {open && (
            <Alerte
              tone="warning"
              title={open.canAct ? `${open.name} a déjà un dossier chez ${creditorName}` : 'Lecture seule'}
              text={
                open.canAct
                  ? `${open.reference}, suivi par ${open.officer ?? 'personne'}. Les factures saisies s’ajoutent à ce dossier.`
                  : `Ce dossier est suivi par ${open.officer ?? 'un autre collaborateur'}. Vous pouvez le consulter ; votre consultation est notée dans l’historique. L’ajout de factures revient au Responsable du recouvrement.`
              }
              actionLabel="Voir le dossier"
              actionHref={`/debiteurs/${open.id}`}
            />
          )}
          {known && (state?.others.length ?? 0) > 0 && (
            <Alerte
              tone="info"
              title="Ce débiteur doit aussi à un autre créancier"
              text={`${state!.others.map((other) => `${other.creditor} · ${other.invoices} facture${other.invoices > 1 ? 's' : ''}`).join(', ')}. Dossiers, coordonnées et paiements restent séparés ; le code d’accès et les plafonds de contact sont communs.`}
            />
          )}
        </div>
      </Carte>
      {!open && (
        <Carte
          title="3. Coordonnées"
          badge="Non vérifiées"
          badgeTone="warning"
          description={creditorName ? `Transmises par ${creditorName}, propres à ce créancier` : 'Propres à ce créancier'}
        >
          <div className={layout.stack}>
            <div className={layout.form}>
              {field('contactName', 'Interlocuteur', { optional: true })}
              {field('contactTitle', 'Fonction', { optional: true })}
            </div>
            {contacts.map((contact, index) => {
              const kind = contact.kind === 'PHONE' ? 'Téléphone' : 'E-mail';
              return (
                <fieldset key={index} className={css.line}>
                  <legend className={layout.hidden}>{`${kind} ${index + 1}`}</legend>
                  <div className={layout.form}>
                    <Champ
                      label={`Libellé, ${kind.toLowerCase()} ${index + 1}`}
                      type="select"
                      value={contact.label}
                      options={contact.kind === 'PHONE' ? PHONE_LABELS : EMAIL_LABELS}
                      onChange={(label) => changeContact(index, { label })}
                    />
                    <Champ
                      label={`${kind} ${index + 1}`}
                      type={contact.kind === 'PHONE' ? 'tel' : 'email'}
                      value={contact.value}
                      error={errors[`contacts.${index}.value`]}
                      autocomplete="off"
                      onChange={(value) => changeContact(index, { value })}
                    />
                  </div>
                  <div className={layout.between}>
                    <label className={css.radio}>
                      <input type="radio" name={`primary-${contact.kind}`} checked={contact.primary} onChange={() => changeContact(index, { primary: true })} />
                      Principal
                    </label>
                    <Bouton
                      variant="ghost"
                      size="sm"
                      label="Retirer"
                      ariaLabel={`Retirer : ${kind.toLowerCase()} ${index + 1}`}
                      onPress={() => setContacts(contacts.filter((_item, position) => position !== index))}
                    />
                  </div>
                </fieldset>
              );
            })}
            <div className={layout.inline}>
              <Bouton variant="secondary" size="sm" label="+ Ajouter un numéro" disabled={contacts.length >= 20} onPress={() => addContact('PHONE')} />
              <Bouton variant="secondary" size="sm" label="+ Ajouter une adresse" disabled={contacts.length >= 20} onPress={() => addContact('EMAIL')} />
            </div>
          </div>
        </Carte>
      )}
      <Carte title="4. Factures impayées" description="Une ligne par facture. Le PDF de la facture se joindra depuis le dossier.">
        <div className={layout.stack}>
          {errors.invoices && (
            <p role="alert" className={css.error}>
              {errors.invoices}
            </p>
          )}
          {invoices.map((invoice, index) => {
            const suffix = invoices.length > 1 ? `, facture ${index + 1}` : '';
            const cell = (key: keyof InvoiceText, label: string, more: Partial<Parameters<typeof Champ>[0]> = {}) => (
              <Champ
                label={`${label}${suffix}`}
                value={invoice[key]}
                error={errors[`invoices.${index}.${key}`]}
                autocomplete="off"
                onChange={(value) =>
                  setInvoices(
                    invoices.map((item, position) =>
                      position === index ? { ...item, [key]: value, ...(key === 'amount' && item.left === item.amount ? { left: value } : {}) } : item,
                    ),
                  )
                }
                {...more}
              />
            );
            return (
              <fieldset key={index} className={css.line}>
                <legend className={layout.hidden}>Facture {index + 1}</legend>
                <div className={layout.form}>
                  {cell('number', 'N° de facture', { required: true })}
                  {cell('externalRef', 'Réf. créancier de la facture', { optional: true })}
                  {cell('issuedOn', 'Émise le', { type: 'date', required: true })}
                  {cell('dueOn', 'Échéance', { type: 'date', required: true })}
                  {cell('amount', 'Montant TTC', { inputMode: 'decimal', suffix: '€', required: true })}
                  {cell('left', 'Reste dû', { inputMode: 'decimal', suffix: '€', required: true })}
                </div>
                {invoices.length > 1 && (
                  <div className={layout.end}>
                    <Bouton
                      variant="ghost"
                      size="sm"
                      label="Retirer"
                      ariaLabel={`Retirer : facture ${index + 1}`}
                      onPress={() => setInvoices(invoices.filter((_item, position) => position !== index))}
                    />
                  </div>
                )}
              </fieldset>
            );
          })}
          {early.map((invoice, index) => (
            <Alerte
              key={index}
              tone="info"
              text={`${invoice.number || 'Une facture'} est due le ${formatDate(invoice.dueOn)} : acceptée et signalée, sans intérêts ni indemnité avant cette date.`}
            />
          ))}
          <div>
            <Bouton
              variant="secondary"
              size="sm"
              label="+ Ajouter une facture"
              disabled={invoices.length >= 50}
              onPress={() => setInvoices([...invoices, INVOICE])}
            />
          </div>
        </div>
      </Carte>
      {!open && (
        <Carte title="5. Suivi">
          <div className={layout.stack}>
            <div className={layout.form}>
              <Champ
                label="Gestionnaire"
                type="select"
                value={officer}
                help={choices.mayAssign && user.role !== 'DIRECTOR' && officer && officer !== 'me' ? 'Attribution pour le compte du Directeur' : undefined}
                options={[
                  { value: '', label: 'À attribuer' },
                  { value: 'me', label: 'Moi-même' },
                  ...(choices.mayAssign ? choices.officers.map((person) => ({ value: person.id, label: person.name })) : []),
                ]}
                onChange={setOfficer}
              />
              <Champ
                label="Scénario de relance"
                type="select"
                help="Celui du mandat, modifiable"
                value={scenario || (mandate?.scenario ?? 'BUSINESS')}
                options={Object.entries(SCENARIO_LABELS).map(([value, label]) => ({ value, label }))}
                onChange={(value) => setScenario(value as NewCase['scenario'])}
              />
            </div>
            <Alerte tone="info" text="Aucun message ne part à l’ouverture : la première relance attend l’envoi du premier courrier (LR-AAAA-NNNN)." />
          </div>
        </Carte>
      )}
      <Carte title="Récapitulatif">
        <dl className={layout.facts}>
          {(
            [
              ['Factures', String(invoices.length)],
              ['Principal', formatCents(principal, { decimals: 'always' })],
              [`Indemnités (${indemnity / 4000} × 40 €)`, formatCents(indemnity, { decimals: 'always' })],
              ['Retard max.', `${daysLate} j`],
              ['Total hors intérêts', formatCents(principal + indemnity, { decimals: 'always' })],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Carte>
      <div className={css.bar}>
        <span>Dossier non enregistré</span>
        <span className={layout.inline}>
          <Bouton label="Annuler" variant="secondary" href="/debiteurs" />
          <Bouton
            type="submit"
            label={open ? 'Ajouter les factures' : 'Ouvrir le dossier'}
            disabled={blocked || (open !== null && !open.canAct) || check.isFetching}
          />
        </span>
      </div>
    </form>
  );
}
