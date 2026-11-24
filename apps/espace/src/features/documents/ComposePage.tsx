import {
  composeData,
  fixedIndemnity,
  formatCents,
  formatDate,
  formatLongDate,
  LETTER_TEMPLATES,
  letterSchedule,
  letterTemplate,
  letterTotals,
  ROLE_LABELS,
  type LetterRecipient,
  type LetterTemplate,
} from '@legarec/contracts';
import { Alerte, Bouton, Carte, Case, Champ, EtatListe, Interrupteur, Onglets, PageHeader, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import type { z } from 'zod';
import { useApi, useChange } from '../../app/data';
import { useCurrentUser } from '../../app/session';
import layout from '@legarec/ui/layout.module.css';
import css from './Documents.module.css';

type Data = z.infer<typeof composeData>;
const CHANNELS = [
  'E-mail avec PDF joint',
  'E-mail avec lien de signature',
  'Lettre recommandée avec AR (MySendingBox)',
  'Courrier simple (MySendingBox)',
  'Télécharger seulement',
];

export function ComposePage() {
  const { data, isPending, error, refetch } = useApi(composeData, '/documents/compose');
  const header = (
    <PageHeader
      title="Rédiger un courrier"
      description="Choisissez un modèle et un destinataire : le document se remplit avec les données du dossier."
      actions={[{ label: 'Gérer les modèles', href: '/parametres/modeles' }]}
    />
  );
  if (!data)
    return (
      <>
        {header}
        <div className={layout.card}>
          <EtatListe kind={error ? 'error' : isPending ? 'loading' : 'empty'} onAction={() => void refetch()} />
        </div>
      </>
    );
  if (data.recipients.length === 0)
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
      <Editor data={data} />
    </>
  );
}

function Editor({ data }: { data: Data }) {
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
  const recipient = data.recipients[index] ?? data.recipients[0]!;
  const definition = LETTER_TEMPLATES[template];
  const reminder = template === 'FRIENDLY' || template === 'FIRM' || template === 'FORMAL_NOTICE';
  const allowsIndemnity = (template === 'FIRM' || template === 'FORMAL_NOTICE') && fixedIndemnity(recipient) > 0;
  const recallsFirstLetter = reminder && template !== 'FRIENDLY';
  const missingFirstLetter = !batch && recallsFirstLetter && !recipient.firstLetter;
  const excluded = batch && recallsFirstLetter ? batch.withoutFirstLetter : 0;
  const pick = (next: LetterTemplate) => {
    setTemplate(next);
    setChannel(LETTER_TEMPLATES[next].channel);
    setDone(null);
  };
  const count = batch ? batch.debtors - excluded : 1;
  const downloadOnly = channel === 'Télécharger seulement';
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
        { k: 'Envoi', v: channel },
        ...(excluded > 0 ? [{ k: 'Exclus', v: `${excluded} débiteurs sans premier courrier` }] : []),
        ...(batch ? [] : [{ k: 'Montant', v: formatCents(letterTotals(recipient, indemnity && allowsIndemnity).total) }]),
      ],
      onConfirm: async () => {
        await change('/documents/compose', {
          body: {
            template,
            caseIds: batch ? null : [recipient.caseId],
            channel,
            delay,
            months,
            options: { table, pay, indemnity: indemnity && allowsIndemnity },
          },
        });
        setDone(
          downloadOnly
            ? `${batch ? `${count} documents générés` : 'Document généré'}, sans envoi.`
            : batch
              ? `${count} documents générés et mis en file d’envoi.`
              : `Document généré et envoyé à ${recipient.name}.`,
        );
      },
    });
  const draft = async () => {
    await change('/documents/compose/draft', { body: { template, caseId: recipient.caseId } });
    toast({ message: 'Brouillon enregistré.' });
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
          <Carte title="1. Modèle">
            <div className={layout.stack}>
              <div role="radiogroup" aria-label="Modèle" className={css.choices}>
                {letterTemplate.options.map((id) => (
                  <button key={id} type="button" role="radio" aria-checked={template === id} className={css.choice} onClick={() => pick(id)}>
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
          <Carte title="2. Destinataire">
            <div className={layout.stack}>
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
                  layout={{ alignSelf: 'flex-start' }}
                />
              )}
              {batch ? (
                <p className={layout.body}>
                  <strong>{batch.debtors} débiteurs</strong> correspondent ({batch.invoices} factures · {formatCents(batch.amount)}). Les litiges et les
                  promesses en cours sont exclus.
                </p>
              ) : (
                <div className={layout.tightStack}>
                  {data.recipients.map((item, position) => (
                    <button
                      key={item.caseId}
                      type="button"
                      aria-pressed={position === index}
                      className={css.choice}
                      onClick={() => {
                        setIndex(position);
                        setDone(null);
                      }}
                    >
                      <span className={layout.between}>
                        <strong>{item.name}</strong>
                        <strong className={layout.num}>{formatCents(letterTotals(item, false).principal)}</strong>
                      </span>
                      <span className={layout.hint}>
                        {item.creditor} · {item.invoices.length} facture(s)
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Carte>
          <Carte title="3. Options">
            <div className={layout.stack}>
              <Champ label="Envoi" type="select" value={channel} options={CHANNELS} onChange={setChannel} />
              {reminder && (
                <div className={layout.tightStack}>
                  <span className={layout.muted} id="delai">
                    Délai de paiement accordé
                  </span>
                  <div role="group" aria-labelledby="delai" className={layout.chips}>
                    {[8, 15, 30].map((value) => (
                      <button key={value} type="button" className={layout.chip} aria-pressed={delay === value} onClick={() => setDelay(value)}>
                        {value} j
                      </button>
                    ))}
                  </div>
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
                <span>{template === 'PAYMENT_PLAN' ? 'Joindre le calendrier' : 'Joindre le détail des factures'}</span>
                <Interrupteur label="Joindre le détail" checked={table} onToggle={setTable} />
              </div>
              <div className={layout.between}>
                <span>Ajouter les moyens de paiement</span>
                <Interrupteur label="Ajouter les moyens de paiement" checked={pay} onToggle={setPay} />
              </div>
              {allowsIndemnity && (
                <div className={layout.between}>
                  <span>Ajouter l’indemnité forfaitaire (40 € / facture)</span>
                  <Interrupteur label="Ajouter l’indemnité forfaitaire" checked={indemnity} onToggle={setIndemnity} />
                </div>
              )}
              {recipient.isIndividual && reminder && <span className={layout.hint}>Particulier : pas d’indemnité forfaitaire de 40 €.</span>}
            </div>
          </Carte>
          {excluded > 0 && (
            <Alerte tone="warning" compact text={`${excluded} débiteurs n’ont aucun premier courrier enregistré : ils sont exclus de cet envoi.`} />
          )}
          {missingFirstLetter && (
            <Alerte
              tone="danger"
              compact
              text="Aucun premier courrier n’est enregistré pour ce dossier : une relance doit rappeler sa référence et sa date. Envoyez d’abord la relance amiable."
            />
          )}
          <div className={layout.end}>
            <Bouton variant="secondary" label="Enregistrer le brouillon" onPress={() => void draft()} />
            <Bouton
              label={downloadOnly ? 'Générer le PDF' : batch ? `Générer et envoyer (${count})` : 'Générer et envoyer'}
              disabled={missingFirstLetter}
              onPress={send}
            />
          </div>
        </div>
        <section aria-label="Aperçu du document" className={layout.card}>
          <div className={layout.between} style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
            <span className={layout.inline}>
              <strong>Aperçu</strong>
              {batch && (
                <>
                  <Bouton
                    variant="secondary"
                    size="sm"
                    icon="chevron-left"
                    iconOnly
                    label="Destinataire précédent"
                    onPress={() => setIndex((index + data.recipients.length - 1) % data.recipients.length)}
                  />
                  <span className={layout.hint}>
                    {index + 1} / {count}
                  </span>
                  <Bouton
                    variant="secondary"
                    size="sm"
                    icon="chevron-right"
                    iconOnly
                    label="Destinataire suivant"
                    onPress={() => setIndex((index + 1) % data.recipients.length)}
                  />
                </>
              )}
            </span>
            <Case label="Surligner les champs remplis automatiquement" checked={marked} onToggle={setMarked} />
          </div>
          <div className={css.paper}>
            <Letter
              firm={data.firm}
              recipient={recipient}
              template={template}
              delay={delay}
              months={months}
              table={table}
              pay={pay && template !== 'CLEARANCE'}
              indemnity={indemnity && allowsIndemnity}
              marked={marked}
              registered={channel.startsWith('Lettre recommandée')}
            />
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
          Malgré notre précédent rappel du <mark>{formatDate(recipient.lastReminder)}</mark>, les factures ci-dessous restent impayées pour un montant de{' '}
          {money(totals.principal)}.
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
      <div className={layout.between}>
        <span className={layout.text}>
          <strong className={css.firm}>{firm.name}</strong>
          <span>Cabinet de recouvrement</span>
          <span>{firm.address}</span>
          <span>{firm.phone}</span>
        </span>
        <span className={layout.text}>
          <span>
            Réf. : <mark>{recipient.reference}</mark>
          </span>
          <span>Dossier suivi par {signer.name}</span>
        </span>
      </div>
      <div className={css.address}>
        <mark>{recipient.name}</mark>
        <span>
          À l&apos;attention de <mark>{recipient.contact}</mark>
        </span>
        {recipient.address.map((line) => (
          <mark key={line}>{line}</mark>
        ))}
      </div>
      <span>Paris, le {formatLongDate(new Date())}</span>
      {registered && <strong>Lettre recommandée avec accusé de réception</strong>}
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
                  <tr key={item.date}>
                    <td>
                      Mensualité {position + 1}/{months}
                    </td>
                    <td>{formatDate(item.date)}</td>
                    <td>{formatCents(item.amount)}</td>
                  </tr>
                ))
              : recipient.invoices.map((item) => (
                  <tr key={item.number}>
                    <td>{item.number}</td>
                    <td>{formatDate(item.due)}</td>
                    <td>{formatCents(item.amount)}</td>
                  </tr>
                ))}
            <tr>
              <td colSpan={2}>
                <strong>{template === 'CLEARANCE' ? 'Total réglé' : `Total dû${parts.length > 0 ? ` (dont ${parts.join(', ')})` : ''}`}</strong>
              </td>
              <td>
                <strong>{formatCents(template === 'FORMAL_NOTICE' ? totals.total : totals.principal + totals.indemnity)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {pay && (
        <p>
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
        {'{{> mentions_recouvrement}}'} : {firm.name}, {firm.address}, SIREN {firm.siren}, exerce une activité de recouvrement amiable pour le compte d’autrui.
        Créancier : {recipient.creditor} [ADRESSE DU CRÉANCIER]. [MENTIONS R124-4 ET L111-8 À VALIDER PAR LE JURISTE] [INFORMATION RGPD À VALIDER]
      </div>
    </article>
  );
}
