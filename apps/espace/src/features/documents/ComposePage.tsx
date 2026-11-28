import {
  COMPOSE_CHANNELS,
  composeChannelOf,
  composeData,
  fixedIndemnity,
  formatCents,
  formatDate,
  formatLongDate,
  L111_8,
  LETTER_TEMPLATES,
  letterAmount,
  letterSchedule,
  letterTemplate,
  letterTotals,
  ROLE_LABELS,
  sendingOutcome,
  skippedText,
  type SendingOutcome,
  type LetterRecipient,
  type LetterTemplate,
} from '@legarec/contracts';
import { Alerte, Bouton, Carte, Case, Champ, EtatListe, Interrupteur, Onglets, PageHeader, useConfirm, useToast } from '@legarec/ui';
import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { z } from 'zod';
import { useApi, useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import css from './Documents.module.css';

type Data = z.infer<typeof composeData>;
/** The labels of the list « Envoi », in the order of the mock-up; the API reads their codes. */
const CHANNELS = Object.values(COMPOSE_CHANNELS);

/** What a grouped sending left out, after what it did: « 2 non envoyés : … ». */
const withSkipped = (outcome: SendingOutcome, done: string) => {
  const left = skippedText(outcome);
  return left ? `${done} ${left}.` : done;
};

export function ComposePage() {
  const [creditor, setCreditor] = useState('all');
  const [age, setAge] = useState('31-60');
  const { data, isPending, error, refetch } = useApi(composeData, `/documents/compose?creditor=${encodeURIComponent(creditor)}&age=${encodeURIComponent(age)}`);
  // The form stays in place while the API recounts the selection.
  const [last, setLast] = useState(data);
  if (data && data !== last) setLast(data);
  const shown = data ?? last;
  const header = (
    <PageHeader
      title="Rédiger un courrier"
      description="Choisissez un modèle et un destinataire : le document se remplit avec les données du dossier."
      actions={[{ label: 'Gérer les modèles', href: '/parametres/modeles' }]}
    />
  );
  if (!shown)
    return (
      <>
        {header}
        <div className={layout.card}>
          <EtatListe kind={error ? 'error' : isPending ? 'loading' : 'empty'} onAction={() => void refetch()} />
        </div>
      </>
    );
  if (shown.recipients.length === 0)
    return (
      <>
        {header}
        <div className={layout.card}>
          <EtatListe kind="empty" title="Aucun dossier à traiter" text="Les courriers se rédigent depuis les dossiers qui vous sont attribués." />
        </div>
      </>
    );
  return (
    <>
      {header}
      <Editor data={shown} filters={{ creditor, setCreditor, age, setAge, fresh: !!data, failed: !!error, retry: () => void refetch() }} />
    </>
  );
}

interface Filters {
  creditor: string;
  setCreditor: (value: string) => void;
  age: string;
  setAge: (value: string) => void;
  /** False while the API recounts: no batch may leave on an old count. */
  fresh: boolean;
  failed: boolean;
  retry: () => void;
}

function StepTitle({ number, label }: { number: number; label: string }) {
  return (
    <h2 className={css.stepTitle}>
      <span aria-hidden className={css.stepNumber}>
        {number}
      </span>
      {label}
    </h2>
  );
}

function Editor({ data, filters }: { data: Data; filters: Filters }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [template, setTemplate] = useState<LetterTemplate>('FORMAL_NOTICE');
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [index, setIndex] = useState(0);
  const [channel, setChannel] = useState(LETTER_TEMPLATES.FORMAL_NOTICE.channel);
  const [delay, setDelay] = useState(8);
  const [months, setMonths] = useState(4);
  const [table, setTable] = useState(true);
  const [pay, setPay] = useState(true);
  const [indemnity, setIndemnity] = useState(true);
  const [marked, setMarked] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const batch = mode === 'batch' && data.batch;
  const creditorName = batch ? batch.creditors.find((item) => item.id === filters.creditor)?.name : undefined;
  // In a batch, the examples belong to the selection; the API counts all of it.
  const examples = creditorName ? data.recipients.filter((item) => item.creditor === creditorName) : data.recipients;
  const position = examples.length > 0 ? index % examples.length : 0;
  const recipient = examples[position] ?? data.recipients[0]!;
  const definition = LETTER_TEMPLATES[template];
  const reminder = template === 'FRIENDLY' || template === 'FIRM' || template === 'FORMAL_NOTICE';
  const allowsIndemnity = (template === 'FIRM' || template === 'FORMAL_NOTICE') && (!!batch || fixedIndemnity(recipient) > 0);
  const notSettled = template === 'CLEARANCE' && (!!batch || !recipient.settled);
  const recallsFirstLetter = reminder && template !== 'FRIENDLY';
  const missingFirstLetter = !batch && recallsFirstLetter && !recipient.firstLetter;
  const excluded = batch && recallsFirstLetter ? batch.withoutFirstLetter : 0;
  const pick = (next: LetterTemplate) => {
    setTemplate(next);
    setChannel(LETTER_TEMPLATES[next].channel);
    setDone(null);
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const ids = letterTemplate.options;
    const next = (ids.indexOf(template) + step + ids.length) % ids.length;
    pick(ids[next]!);
    event.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus();
  };
  const count = batch ? batch.debtors - excluded : 1;
  const downloadOnly = channel === COMPOSE_CHANNELS.DOWNLOAD;
  const blocked = missingFirstLetter || notSettled || (!!batch && (!filters.fresh || count <= 0));
  const AGES: Record<string, string> = { '31-60': '31 – 60 jours', '0-30': '0 – 30 jours', '60+': '+ 60 jours' };
  const selection = batch
    ? [
        { k: 'Créancier', v: batch.creditors.find((item) => item.id === filters.creditor)?.name ?? 'Tous' },
        { k: 'Ancienneté', v: AGES[filters.age] ?? filters.age },
      ]
    : [];
  const options = [
    ...(reminder ? [{ k: 'Délai', v: `${delay} jours` }] : []),
    ...(allowsIndemnity ? [{ k: 'Indemnité de 40 €', v: indemnity ? (batch ? 'Oui, professionnels seulement' : 'Oui') : 'Non' }] : []),
  ];
  const compose = (target: string) => ({
    template,
    caseIds: batch ? null : [recipient.caseId],
    filters: batch ? { creditor: filters.creditor, age: filters.age } : null,
    // The API refuses the batch if its own count differs from the one confirmed.
    expected: count,
    channel: composeChannelOf(target),
    delay,
    months,
    options: { table, pay, indemnity: indemnity && allowsIndemnity },
  });
  const send = () =>
    confirm({
      title: downloadOnly
        ? `Générer ${batch ? `${count} documents` : 'ce document'} ?`
        : batch
          ? `Générer et envoyer ${count} documents ?`
          : `Envoyer ce document à ${recipient.name} ?`,
      body: `${channel.startsWith('Lettre recommandée') ? 'Une lettre recommandée ne peut plus être annulée une fois envoyée. Son coût reste à la charge du créancier.' : downloadOnly ? 'Rien n’est envoyé : le document est généré pour téléchargement.' : 'L’envoi part immédiatement.'} Chaque document est ajouté à l’historique du dossier et visible par le créancier.`,
      confirmLabel: downloadOnly ? 'Générer' : batch ? `Envoyer les ${count} documents` : 'Envoyer',
      tone: channel.startsWith('Lettre recommandée') ? 'danger' : 'primary',
      details: [
        { k: 'Modèle', v: definition.label },
        { k: 'Destinataire', v: batch ? `${count} débiteurs sélectionnés` : recipient.name },
        ...selection,
        { k: 'Envoi', v: channel },
        ...(excluded > 0 ? [{ k: 'Exclus', v: `${excluded} débiteurs sans premier courrier` }] : []),
        ...options,
        ...(batch ? [] : [{ k: 'Montant', v: formatCents(letterAmount(template, recipient, indemnity && allowsIndemnity)) }]),
      ],
      onConfirm: async () => {
        const outcome = await change('/documents/compose', { body: compose(channel), schema: sendingOutcome });
        setDone(
          withSkipped(
            outcome,
            downloadOnly
              ? `${batch ? `${outcome.queued} documents générés` : 'Document généré'}, sans envoi.`
              : batch
                ? `${outcome.queued} documents générés et mis en file d’envoi.`
                : `Document généré et envoyé à ${recipient.name}.`,
          ),
        );
      },
    });
  const generate = () =>
    confirm({
      title: `Générer ${batch ? `${count} documents` : 'ce document'} ?`,
      body: 'Rien n’est envoyé : le document est généré pour téléchargement. Chaque document est ajouté à l’historique du dossier et visible par le créancier.',
      confirmLabel: 'Générer',
      details: [
        { k: 'Modèle', v: definition.label },
        { k: 'Destinataire', v: batch ? `${count} débiteurs sélectionnés` : recipient.name },
        ...selection,
        ...(excluded > 0 ? [{ k: 'Exclus', v: `${excluded} débiteurs sans premier courrier` }] : []),
      ],
      onConfirm: async () => {
        const outcome = await change('/documents/compose', { body: compose(COMPOSE_CHANNELS.DOWNLOAD), schema: sendingOutcome });
        setDone(withSkipped(outcome, batch ? `${outcome.queued} documents générés, sans envoi.` : 'Document généré, sans envoi.'));
      },
    });
  const draft = async () => {
    try {
      await change('/documents/compose/draft', { body: { template, caseId: recipient.caseId } });
      toast({ message: 'Brouillon enregistré.' });
    } catch {
      toast({ message: 'Le brouillon n’a pas été enregistré. Réessayez.' });
    }
  };
  return (
    <>
      {done && (
        <Alerte tone="success" title={done} text="Le document est classé dans le dossier et dans la bibliothèque.">
          <span className={layout.inline}>
            <Link to="/documents" className={layout.link}>
              Voir dans la bibliothèque
            </Link>
            <Bouton variant="ghost" size="sm" label="Nouveau document" onPress={() => setDone(null)} />
          </span>
        </Alerte>
      )}
      <div className={css.compose}>
        <div className={layout.stack}>
          <Carte>
            <StepTitle number={1} label="Modèle" />
            <div className={layout.stack}>
              <div role="radiogroup" aria-label="Modèle" className={css.choices} onKeyDown={move}>
                {letterTemplate.options.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    tabIndex={template === id ? 0 : -1}
                    aria-checked={template === id}
                    className={css.choice}
                    onClick={() => pick(id)}
                  >
                    <strong>{LETTER_TEMPLATES[id].label}</strong>
                    <span className={layout.hint}>{LETTER_TEMPLATES[id].hint}</span>
                  </button>
                ))}
              </div>
              <Link to={`/parametres/modeles/${definition.slug}`} className={layout.link}>
                Voir le modèle et son fichier HTML →
              </Link>
            </div>
          </Carte>
          <Carte>
            <div className={css.stepHead}>
              <StepTitle number={2} label="Destinataire" />
              {data.batch && (
                <Onglets
                  label="Mode d'envoi"
                  items={[
                    {
                      label: 'Un débiteur',
                      selected: mode === 'single',
                      pick: () => {
                        setMode('single');
                        setDone(null);
                      },
                    },
                    {
                      label: 'Envoi groupé',
                      selected: mode === 'batch',
                      pick: () => {
                        setMode('batch');
                        setDone(null);
                      },
                    },
                  ]}
                />
              )}
            </div>
            <div className={layout.stack}>
              {batch ? (
                <>
                  <div className={layout.form}>
                    <Champ
                      label="Créancier"
                      type="select"
                      value={filters.creditor}
                      options={[{ value: 'all', label: 'Tous' }, ...batch.creditors.map((item) => ({ value: item.id, label: item.name }))]}
                      onChange={filters.setCreditor}
                    />
                    <Champ
                      label="Ancienneté"
                      type="select"
                      value={filters.age}
                      options={[
                        { value: '31-60', label: '31 – 60 jours' },
                        { value: '0-30', label: '0 – 30 jours' },
                        { value: '60+', label: '+ 60 jours' },
                      ]}
                      onChange={filters.setAge}
                    />
                  </div>
                  <p className={layout.body}>
                    <strong>{batch.debtors} débiteurs</strong> correspondent ({batch.invoices} factures · {formatCents(batch.amount)}). Les litiges et les
                    promesses en cours sont exclus.
                  </p>
                </>
              ) : (
                <div className={css.rows}>
                  {data.recipients.map((item, position) => (
                    <button
                      key={item.caseId}
                      type="button"
                      aria-pressed={position === index}
                      className={`${css.choice} ${css.row}`}
                      onClick={() => {
                        setIndex(position);
                        setDone(null);
                      }}
                    >
                      <span className={css.recipient}>
                        <span className={layout.text}>
                          <strong>{item.name}</strong>
                          <span className={layout.hint}>
                            {item.creditor} · {item.invoices.length} facture(s)
                          </span>
                        </span>
                        <strong className={layout.num}>{formatCents(letterTotals(item, false).principal)}</strong>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Carte>
          <Carte>
            <StepTitle number={3} label="Options" />
            <div className={layout.stack}>
              <Champ label="Envoi" type="select" value={channel} options={CHANNELS} onChange={setChannel} />
              {reminder && (
                <div className={layout.between}>
                  <span className={layout.muted}>Délai de paiement accordé</span>
                  <span role="group" aria-label="Délai de paiement accordé" className={css.segment}>
                    {[8, 15, 30].map((value) => (
                      <button key={value} type="button" aria-pressed={delay === value} onClick={() => setDelay(value)}>
                        {value} j
                      </button>
                    ))}
                  </span>
                </div>
              )}
              {template === 'PAYMENT_PLAN' && (
                <div className={layout.between}>
                  <span className={layout.muted}>Nombre de mensualités</span>
                  <span className={layout.inline}>
                    <Bouton
                      variant="secondary"
                      icon="minus"
                      iconOnly
                      label="Une mensualité de moins"
                      disabled={months <= 2}
                      onPress={() => setMonths(months - 1)}
                    />
                    <strong aria-live="polite">{months}</strong>
                    <Bouton
                      variant="secondary"
                      icon="plus"
                      iconOnly
                      label="Une mensualité de plus"
                      disabled={months >= 12}
                      onPress={() => setMonths(months + 1)}
                    />
                  </span>
                </div>
              )}
              <div className={layout.between}>
                <span className={layout.muted}>{template === 'PAYMENT_PLAN' ? 'Joindre le calendrier' : 'Joindre le détail des factures'}</span>
                <Interrupteur
                  label={template === 'PAYMENT_PLAN' ? 'Joindre le calendrier' : 'Joindre le détail des factures'}
                  checked={table}
                  onToggle={setTable}
                />
              </div>
              <div className={layout.between}>
                <span className={layout.muted}>Ajouter les moyens de paiement</span>
                <Interrupteur label="Ajouter les moyens de paiement" checked={pay} onToggle={setPay} />
              </div>
              {allowsIndemnity && (
                <div className={layout.between}>
                  <span className={layout.muted}>Ajouter l’indemnité forfaitaire (40 € / facture)</span>
                  <Interrupteur label="Ajouter l’indemnité forfaitaire (40 € / facture)" checked={indemnity} onToggle={setIndemnity} />
                </div>
              )}
              {recipient.isIndividual && reminder && <span className={layout.hint}>Particulier : pas d’indemnité forfaitaire de 40 €.</span>}
            </div>
          </Carte>
          {batch && filters.failed && (
            <Alerte
              tone="danger"
              compact
              text="La sélection n’a pas pu être recomptée : l’envoi est bloqué."
              actionLabel="Réessayer"
              onAction={filters.retry}
            />
          )}
          {batch && !filters.fresh && !filters.failed && (
            <p role="status" className={layout.hint}>
              Comptage des débiteurs en cours…
            </p>
          )}
          {batch && filters.fresh && count <= 0 && <Alerte tone="info" compact text="Aucun débiteur ne correspond à cette sélection." />}
          {excluded > 0 && (
            <Alerte
              tone="warning"
              compact
              text={
                excluded > 1
                  ? `${excluded} débiteurs n’ont aucun premier courrier enregistré : ils sont exclus de cet envoi.`
                  : 'Un débiteur n’a aucun premier courrier enregistré : il est exclu de cet envoi.'
              }
            />
          )}
          {notSettled && (
            <Alerte
              tone="danger"
              compact
              text={
                batch
                  ? 'L’attestation de solde ne s’envoie pas en groupe : choisissez un dossier soldé.'
                  : 'Ce dossier n’est pas soldé : l’attestation ne peut pas être envoyée.'
              }
            />
          )}
          {missingFirstLetter && (
            <Alerte
              tone="danger"
              compact
              text="Aucun premier courrier n’est enregistré pour ce dossier : une relance doit rappeler sa référence et sa date. Envoyez d’abord la relance amiable."
            />
          )}
          <div className={css.actions}>
            {!batch && <Bouton variant="secondary" label="Enregistrer le brouillon" onPress={() => void draft()} />}
            {!downloadOnly && <Bouton variant="secondary" label="Générer le PDF" disabled={blocked} onPress={generate} />}
            <Bouton
              full
              label={downloadOnly ? 'Générer le PDF' : batch ? `Générer et envoyer (${count})` : 'Générer et envoyer'}
              disabled={blocked}
              onPress={send}
            />
          </div>
        </div>
        <section aria-label="Aperçu du document">
          <div className={css.previewHead}>
            <span className={layout.inline}>
              <strong>Aperçu</strong>
              {batch && examples.length > 0 && (
                <>
                  <Bouton
                    variant="secondary"
                    size="sm"
                    icon="chevron-left"
                    iconOnly
                    label="Destinataire précédent"
                    onPress={() => setIndex((position + examples.length - 1) % examples.length)}
                  />
                  <span className={layout.hint}>
                    Exemple {position + 1} sur {examples.length}
                  </span>
                  <Bouton
                    variant="secondary"
                    size="sm"
                    icon="chevron-right"
                    iconOnly
                    label="Destinataire suivant"
                    onPress={() => setIndex((position + 1) % examples.length)}
                  />
                </>
              )}
            </span>
            <Case label="Surligner les champs remplis automatiquement" checked={marked} onToggle={setMarked} />
          </div>
          <div className={css.paper}>
            {examples.length === 0 ? (
              <Alerte tone="info" compact text="Aucun exemple à afficher pour cette sélection." />
            ) : (
              <Letter
                firm={data.firm}
                recipient={recipient}
                template={template}
                delay={delay}
                months={months}
                table={table}
                pay={pay && template !== 'CLEARANCE'}
                indemnity={indemnity && allowsIndemnity && fixedIndemnity(recipient) > 0}
                marked={marked}
                registered={channel.startsWith('Lettre recommandée')}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

interface LetterProps {
  firm: Data['firm'];
  recipient: LetterRecipient;
  template: LetterTemplate;
  delay: number;
  months: number;
  table: boolean;
  pay: boolean;
  indemnity: boolean;
  marked: boolean;
  registered: boolean;
}

function Letter({ firm, recipient, template, delay, months, table, pay, indemnity, marked, registered }: LetterProps) {
  const totals = letterTotals(recipient, indemnity);
  const money = (value: number) => <mark>{formatCents(value)}</mark>;
  const schedule = template === 'PAYMENT_PLAN' ? letterSchedule(totals.principal, months) : [];
  const body = {
    FRIENDLY: (
      <>
        <p>
          Sauf erreur de notre part, nous n’avons pas reçu le règlement des factures ci-dessous, d’un montant total de {money(totals.principal)}, dont le
          recouvrement amiable nous a été confié par notre client <mark>{recipient.creditor}</mark>.
        </p>
        <p>
          Il s’agit peut-être d’un simple oubli. Nous vous remercions de procéder au règlement sous <mark>{delay} jours</mark>.
        </p>
        <p>Si votre paiement a été effectué entre-temps, merci de ne pas tenir compte de ce courrier.</p>
      </>
    ),
    FIRM: (
      <>
        <p>
          Malgré notre précédent rappel du <mark>{recipient.lastReminder ? formatDate(recipient.lastReminder) : '—'}</mark>, les factures ci-dessous restent
          impayées pour un montant de {money(totals.principal)}.
        </p>
        <p>
          Nous vous demandons de régler cette somme sous <mark>{delay} jours</mark>. À défaut, notre client <mark>{recipient.creditor}</mark> pourra nous
          autoriser à engager une procédure judiciaire.
        </p>
        {indemnity && (
          <p>
            Conformément à l’article L441-10 du Code de commerce, une indemnité forfaitaire pour frais de recouvrement de 40 € par facture est due, soit{' '}
            {money(totals.indemnity)}.
          </p>
        )}
      </>
    ),
    FORMAL_NOTICE: (
      <>
        <p>
          En vertu du mandat qui nous a été confié par <mark>{recipient.creditor}</mark>, nous vous mettons en demeure de régler la somme de{' '}
          {money(totals.total)}, soit {money(totals.principal)} en principal, {money(totals.interest)} d’intérêts
          {indemnity && <> et {money(totals.indemnity)} d’indemnités forfaitaires de recouvrement</>}.
        </p>
        <p>
          À défaut de règlement dans un délai de <mark>{delay} jours</mark> à compter de la réception de la présente, notre client se réserve le droit d’engager
          à votre encontre une procédure judiciaire, sans autre avis.
        </p>
        <p>La présente vaut mise en demeure au sens de l’article 1344 du Code civil.</p>
      </>
    ),
    PAYMENT_PLAN: (
      <>
        <p>
          Suite à notre échange, et avec l’accord de notre client <mark>{recipient.creditor}</mark>, nous vous proposons de régler la somme de{' '}
          {money(totals.principal)} en <mark>{months} mensualités</mark> selon le calendrier ci-dessous.
        </p>
        <p>
          Pour accepter, il vous suffit de signer électroniquement ce plan depuis votre espace. Tout incident de paiement rendra le solde restant immédiatement
          exigible.
        </p>
      </>
    ),
    CLEARANCE: (
      <>
        <p>
          Nous attestons que <mark>{recipient.name}</mark> a réglé l’intégralité des sommes dues à notre client <mark>{recipient.creditor}</mark> au titre des
          factures ci-dessous, soit {money(totals.principal)}.
        </p>
        <p>
          Le dossier <mark>{recipient.reference}</mark> est clos. Aucune autre somme n’est due à ce titre.
        </p>
      </>
    ),
  }[template];
  const parts = [
    template === 'FORMAL_NOTICE' && totals.interest > 0 && `intérêts ${formatCents(totals.interest)}`,
    totals.indemnity > 0 && `indemnités ${formatCents(totals.indemnity)}`,
  ].filter((item): item is string => !!item);
  const user = useCurrentUser();
  const signer = { name: `${user.firstName} ${user.lastName}`, role: ROLE_LABELS[user.role] };
  return (
    <article className={css.sheet} data-marked={marked || undefined}>
      <div className={css.letterHead}>
        <span className={layout.text}>
          <strong className={css.firm}>{firm.name}</strong>
          <span>Cabinet de recouvrement</span>
          <span>{firm.address}</span>
          <span>{firm.phone}</span>
        </span>
        <span className={`${layout.text} ${css.right}`}>
          <span>
            Réf. : <mark>{recipient.reference}</mark>
          </span>
          <span>Dossier suivi par {signer.name}</span>
        </span>
      </div>
      <div className={css.address}>
        <mark className={css.strong}>{recipient.name}</mark>
        <mark>À l&apos;attention de {recipient.contact}</mark>
        {recipient.address.map((line) => (
          <mark key={line}>{line}</mark>
        ))}
      </div>
      <span className={css.right}>Paris, le {formatLongDate(new Date())}</span>
      {registered && <strong className={css.registered}>Lettre recommandée avec accusé de réception</strong>}
      <strong>Objet : {LETTER_TEMPLATES[template].subject}</strong>
      <p>Madame, Monsieur,</p>
      {body}
      {recipient.firstLetter && template !== 'FRIENDLY' && template !== 'CLEARANCE' && (
        <p>
          Référence de notre premier courrier : <mark>{recipient.firstLetter.reference}</mark>, envoyé le <mark>{formatDate(recipient.firstLetter.date)}</mark>.
        </p>
      )}
      {table && (
        <table className={css.table}>
          <thead>
            <tr>
              <th scope="col">{schedule.length > 0 ? 'Échéance' : 'Facture'}</th>
              <th scope="col">{schedule.length > 0 ? 'Date' : 'Échéance'}</th>
              <th scope="col">Montant</th>
            </tr>
          </thead>
          <tbody>
            {schedule.length > 0
              ? schedule.map((item, position) => (
                  <tr key={item.date} className={css.filled}>
                    <td>
                      Mensualité {position + 1}/{months}
                    </td>
                    <td>{formatDate(item.date)}</td>
                    <td>{formatCents(item.amount)}</td>
                  </tr>
                ))
              : recipient.invoices.map((item) => (
                  <tr key={item.number} className={css.filled}>
                    <td>{item.number}</td>
                    <td>{formatDate(item.due)}</td>
                    <td>{formatCents(item.amount)}</td>
                  </tr>
                ))}
            <tr>
              <td colSpan={2}>
                <strong>{template === 'CLEARANCE' ? 'Total réglé' : `Total dû${parts.length > 0 ? ` (dont ${parts.join(', ')})` : ''}`}</strong>
              </td>
              <td className={css.filled}>
                <strong>{formatCents(letterAmount(template, recipient, indemnity))}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {pay && (
        <p className={css.payment}>
          Virement : IBAN du compte dédié [IBAN DU COMPTE DÉDIÉ], référence <mark>{recipient.reference}</mark> en libellé. Chèque : à l’ordre de [ORDRE DES
          CHÈQUES], envoyé à [ADRESSE D&apos;ENVOI DES CHÈQUES], référence au dos. Votre espace : paiement.legarec.fr, code d’accès <mark>••••</mark>.
        </p>
      )}
      <p>Nous vous prions d&apos;agréer, Madame, Monsieur, l&apos;expression de nos salutations distinguées.</p>
      <span className={layout.text}>
        <strong>{signer.name}</strong>
        <span>
          {signer.role}, pour le compte de <mark>{recipient.creditor}</mark>
        </span>
      </span>
      <div className={css.legal}>
        {firm.name}, {firm.address}, SIREN {firm.siren}, exerce une activité de recouvrement amiable pour le compte d’autrui. Créancier : {recipient.creditor},
        [ADRESSE DU CRÉANCIER].{' '}
        {template !== 'CLEARANCE' && (
          <>
            Fondement : factures {recipient.invoices.map((item) => item.number).join(', ')}. Somme à payer :{' '}
            {formatCents(letterAmount(template, recipient, indemnity))}, selon les modalités indiquées dans ce courrier. Article L111-8 du Code des procédures
            civiles d’exécution : {L111_8}
          </>
        )}
      </div>
    </article>
  );
}
