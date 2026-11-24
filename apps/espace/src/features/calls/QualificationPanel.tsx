import { CALL_OUTCOMES, formatCents, formatDate, parseCents, TCX_CODES, type CallQualification, type CallTarget } from '@legarec/contracts';
import { Alerte, Badge, Bouton, Case, Champ, SuggestionIA, useConfirm } from '@legarec/ui';
import { useImperativeHandle, useState, type Dispatch, type Ref } from 'react';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';
import { clock, qualificationErrors, type CallEvent, type CallState } from './callMachine';
import css from './Calls.module.css';
import { Coordinates } from './Coordinates';

export interface QualificationHandle {
  save: () => void;
  pick: (index: number) => void;
}
const RECALLS = [
  ['1h', 'Dans 1 h', 'aujourd’hui à 16:30'],
  ['tomorrow', 'Demain 10:00', 'demain à 10:00'],
  ['friday', 'Vendredi 9:00', 'vendredi à 9:00'],
  ['custom', 'Autre date…', 'date à choisir dans l’agenda'],
] as const;
interface Props {
  ref: Ref<QualificationHandle>;
  target: CallTarget;
  state: CallState;
  dispatch: Dispatch<CallEvent>;
  acw: string | null;
  onDial: (value: string) => void;
  /** `sent` is true when a message left: the sheet can no longer be undone. */
  onSaved: (label: string, sent: boolean) => void;
}

export function QualificationPanel({ ref, target, state, dispatch, acw, onDial, onSaved }: Props) {
  const change = useChange();
  const confirm = useConfirm();
  const first = target.invoices[0];
  const [who, setWho] = useState('main');
  const [otherName, setOtherName] = useState('');
  const [promise, setPromise] = useState(first ? (first.amount / 100).toLocaleString('fr-FR') : '');
  const [promiseDate, setPromiseDate] = useState('2026-11-28');
  const [method, setMethod] = useState<'TRANSFER' | 'CHEQUE'>('TRANSFER');
  const [invoices, setInvoices] = useState<string[]>(first ? [first.number] : []);
  const [months, setMonths] = useState('6');
  const [recall, setRecall] = useState<(typeof RECALLS)[number][0]>('tomorrow');
  const [reason, setReason] = useState('Marchandise ou prestation non conforme');
  const [paidOn, setPaidOn] = useState('2026-11-18');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState(target.note);
  const [recap, setRecap] = useState(false);
  const [voicemail, setVoicemail] = useState(true);
  const [smsLink, setSmsLink] = useState(false);
  const [suspend, setSuspend] = useState(true);
  const [askCreditor, setAskCreditor] = useState(true);
  const [editing, setEditing] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [previous, setPrevious] = useState<{ notes: string; outcome: CallState['outcome']; promise: string; promiseDate: string; invoices: string[] } | null>(
    null,
  );
  const amount = parseCents(promise);
  const errors = qualificationErrors(state, { promise: amount, invoices, paymentReference, editing });
  const outcome = CALL_OUTCOMES.find((item) => item.code === state.outcome);
  const contact =
    who === 'main' ? target.contact : who === 'other' ? otherName || 'autre interlocuteur' : who === 'desk' ? 'standard' : 'interlocuteur non identifié';
  const recallText = RECALLS.find(([id]) => id === recall)?.[2];
  const plan = Math.ceil(target.amount / Number(months) / 100) * 100;

  const pick = (index: number) => {
    const item = CALL_OUTCOMES[index];
    if (!item) return;
    dispatch({ type: 'outcome', outcome: item.code });
    setTried(false);
  };
  const save = async () => {
    if (errors.length > 0 || !state.outcome || saving) {
      setTried(true);
      return;
    }
    const sheet: CallQualification = {
      outcome: state.outcome,
      tcxCode: TCX_CODES[state.outcome],
      interlocutor: contact,
      notes,
      promise: state.outcome === 'PROMISE_TO_PAY' && amount ? { amount, date: promiseDate, method, invoices } : null,
      alreadyPaid: state.outcome === 'ALREADY_PAID' ? { paidOn, reference: paymentReference.trim() } : null,
      dispute: state.outcome === 'DISPUTE' ? { reason, suspendReminders: suspend, askCreditor } : null,
      absent: state.outcome === 'ABSENT' ? { voicemail, smsLink } : null,
      months: state.outcome === 'PAYMENT_PLAN' ? Number(months) : null,
      recall: state.outcome === 'CALLBACK' ? recall : null,
      announced: state.announced,
      sendRecap: recap,
    };
    const sendings = [
      recap && 'E-mail au débiteur',
      sheet.absent?.smsLink && 'SMS avec le lien de l’espace débiteur',
      sheet.dispute?.askCreditor && `Demande d’avis à ${target.creditor}`,
    ].filter((item): item is string => !!item);
    const store = async () => {
      await change(`/calls/${target.caseId}/qualification`, { body: sheet });
      onSaved(outcome?.label ?? '', sendings.length > 0);
    };
    if (sendings.length > 0) {
      confirm({
        title: 'Enregistrer la fiche et envoyer ?',
        body: 'Les envois partent immédiatement et sont ajoutés à l’historique du dossier.',
        details: [
          { k: 'Débiteur', v: target.debtor },
          { k: 'Résultat', v: outcome?.label ?? '' },
          { k: 'Envois', v: sendings.join(' · ') },
        ],
        confirmLabel: 'Enregistrer et envoyer',
        onConfirm: store,
      });
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      await store();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  useImperativeHandle(ref, () => ({ save: () => void save(), pick }));

  const ai = target.ai;
  const aiMode = !ai ? null : !state.announced && (state.inCall || state.secs > 0) ? 'paused' : state.inCall ? 'live' : state.secs > 0 ? 'post' : null;
  const apply = () => {
    if (!ai) return;
    setPrevious({ notes, outcome: state.outcome, promise, promiseDate, invoices });
    dispatch({ type: 'outcome', outcome: ai.outcome });
    if (ai.amount !== null) setPromise((ai.amount / 100).toLocaleString('fr-FR'));
    if (ai.date) setPromiseDate(ai.date);
    if (ai.invoices.length > 0) setInvoices(ai.invoices);
    setNotes(ai.summary);
    dispatch({ type: 'ai', status: 'applied' });
    void change(`/calls/${target.caseId}/ai-decision`, { body: { decision: 'ACCEPTED' } });
  };
  const next: Record<string, string> = {
    PROMISE_TO_PAY: `contrôle du paiement le ${formatDate(promiseDate).slice(0, 5)} · relance automatique à J+2 si rien n’est reçu.`,
    PAYMENT_PLAN: `proposition de ${months} mensualités à envoyer${Number(months) > 6 ? ' après validation d’un responsable.' : ' au débiteur pour signature.'}`,
    CALLBACK: `rappel ${recallText}, ajouté à votre file 3CX et à l’agenda.`,
    DISPUTE: `relances suspendues · dossier transmis à ${target.creditor} pour avis sous 8 jours.`,
    ALREADY_PAID: 'rapprochement bancaire sous 48 h · justificatif demandé par e-mail.',
    ABSENT: 'nouvel essai demain à 10:00 · SMS avec lien de l’espace débiteur envoyé au mobile.',
    NO_ANSWER: 'nouvel essai dans 2 h (3 tentatives maximum par jour).',
    WRONG_NUMBER: 'appeler un autre numéro du débiteur, ou lancer une recherche de coordonnées.',
  };
  const steps = [
    ['Interlocuteur', who !== 'none' || !!state.outcome],
    ['Résultat', !!state.outcome],
    ['Coordonnées', !!state.outcome && !editing],
  ] as const;

  return (
    <section aria-labelledby="qualif-titre" className={`${layout.card} ${css.panel}`}>
      <div className={css.panelHead}>
        <div className={layout.between}>
          <span className={layout.text}>
            <h2 id="qualif-titre" className={css.h2}>
              Qualifier l&apos;appel
            </h2>
            <span className={layout.muted}>
              {target.debtor} · {contact}
            </span>
          </span>
          <Badge label={outcome ? `Code 3CX : ${TCX_CODES[outcome.code]}` : 'À qualifier'} tone={outcome ? 'success' : 'warning'} />
        </div>
        <ol className={css.steps} aria-label="Étapes de la qualification">
          {steps.map(([label, ok]) => (
            <li key={label} data-done={ok || undefined}>
              {label}
              <span className={layout.hidden}>{ok ? ' : fait' : ' : à faire'}</span>
            </li>
          ))}
        </ol>
        {acw && (
          <div role="status" className={layout.muted}>
            Post-appel 3CX · {acw} · vous ne recevez pas d&apos;appel tant que la fiche n&apos;est pas enregistrée
          </div>
        )}
      </div>
      <div className={css.panelBody} tabIndex={0} role="group" aria-label="Fiche de qualification">
        {ai && aiMode === 'paused' && (
          <SuggestionIA title="Assistant IA · en attente du consentement" note="Proposé par l’IA, à vérifier. Rien n’est enregistré sans votre validation.">
            <p className={layout.body}>
              Transcription en pause : rien n&apos;est enregistré ni analysé tant que l&apos;annonce de l&apos;enregistrement n&apos;a pas été faite au
              débiteur.
            </p>
            <Bouton variant="secondary" size="sm" label="L’annonce a été faite" onPress={() => dispatch({ type: 'announce' })} />
          </SuggestionIA>
        )}
        {ai && aiMode === 'live' && (
          <SuggestionIA title="Assistant IA · transcription en direct" note="Proposé par l’IA, à vérifier. Rien n’est enregistré sans votre validation.">
            <ol aria-label="Transcription en direct, derniers échanges" className={css.lines}>
              {ai.lines.map((line) => (
                <li key={line.text}>
                  <b>{line.who} :</b> {line.text}
                </li>
              ))}
            </ol>
            <div className={layout.chips}>
              <span className={layout.hint}>Relevé :</span>
              {ai.chips.map((chip) => (
                <Badge key={chip} label={chip} tone="violet" variant="outline" />
              ))}
            </div>
          </SuggestionIA>
        )}
        {ai && aiMode === 'post' && (
          <SuggestionIA
            title="Assistant IA · résumé de l’appel"
            facts={ai.facts}
            status={state.ai}
            applyLabel="Appliquer à la fiche"
            appliedText="Suggestion appliquée : vérifiez le résultat, le montant et les notes avant d’enregistrer."
            ignoredText="Suggestion ignorée. Qualifiez l’appel manuellement."
            note="Proposé par l’IA, à vérifier. Rien n’est enregistré sans votre validation."
            onApply={apply}
            onIgnore={() => {
              dispatch({ type: 'ai', status: 'ignored' });
              void change(`/calls/${target.caseId}/ai-decision`, { body: { decision: 'IGNORED' } });
            }}
            onUndo={() => {
              if (previous) {
                setNotes(previous.notes);
                setPromise(previous.promise);
                setPromiseDate(previous.promiseDate);
                setInvoices(previous.invoices);
                dispatch({ type: 'outcome', outcome: previous.outcome });
              }
              dispatch({ type: 'ai', status: 'proposed' });
            }}
          >
            <p className={layout.body}>{ai.summary}</p>
          </SuggestionIA>
        )}
        <Champ
          label="1. Interlocuteur"
          type="select"
          value={who}
          options={[
            { value: 'main', label: `${target.contact} · ${target.role}` },
            { value: 'other', label: "Autre personne de l'entreprise" },
            { value: 'desk', label: 'Standard / accueil' },
            { value: 'none', label: 'Personne non identifiée' },
          ]}
          onChange={setWho}
        />
        {who === 'other' && <Champ label="Nom de l'interlocuteur" value={otherName} placeholder="Nom et prénom" onChange={setOtherName} />}
        <fieldset className={css.fieldset}>
          <legend>
            2. Résultat de l&apos;appel <span className={layout.hint}>· touches 1 à 8</span>
          </legend>
          <div className={css.outcomes}>
            {CALL_OUTCOMES.map((item, index) => (
              <button key={item.code} type="button" aria-pressed={state.outcome === item.code} className={css.outcome} onClick={() => pick(index)}>
                <kbd>{index + 1}</kbd>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {state.outcome === 'PROMISE_TO_PAY' && (
          <div className={css.box2}>
            <div className={layout.form}>
              <Champ
                label="Montant promis"
                inputMode="decimal"
                suffix="€"
                value={promise}
                error={tried && !amount ? 'Indiquez le montant promis.' : undefined}
                onChange={setPromise}
              />
              <Champ label="Date de paiement" type="date" value={promiseDate} onChange={setPromiseDate} />
            </div>
            <div className={layout.chips}>
              {first && (
                <button type="button" className={layout.chip} onClick={() => setPromise((first.amount / 100).toLocaleString('fr-FR'))}>
                  Facture {first.number} · {formatCents(first.amount)}
                </button>
              )}
              <button type="button" className={layout.chip} onClick={() => setPromise((Math.round(target.amount / 2) / 100).toLocaleString('fr-FR'))}>
                La moitié · {formatCents(Math.round(target.amount / 2))}
              </button>
              <button type="button" className={layout.chip} onClick={() => setPromise((target.amount / 100).toLocaleString('fr-FR'))}>
                Totalité · {formatCents(target.amount)}
              </button>
            </div>
            <Champ
              label="Moyen de paiement"
              type="select"
              value={method}
              options={[
                { value: 'TRANSFER', label: 'Virement' },
                { value: 'CHEQUE', label: 'Chèque' },
              ]}
              onChange={(value) => setMethod(value as 'TRANSFER' | 'CHEQUE')}
            />
            <div role="group" aria-label="Factures concernées" className={layout.tightStack}>
              <span className={layout.muted}>Factures concernées</span>
              {target.invoices.map((invoice) => (
                <Case
                  key={invoice.number}
                  checked={invoices.includes(invoice.number)}
                  label={`${invoice.number} · échue le ${formatDate(invoice.due).slice(0, 5)} · ${formatCents(invoice.amount)}`}
                  onToggle={(on) => setInvoices(on ? [...invoices, invoice.number] : invoices.filter((item) => item !== invoice.number))}
                />
              ))}
            </div>
          </div>
        )}
        {state.outcome === 'PAYMENT_PLAN' && (
          <div className={css.box2}>
            <Champ label="Mensualités souhaitées" type="select" value={months} options={['3', '6', '8', '12']} onChange={setMonths} />
            <span>
              {months} mensualités de {formatCents(plan)} pour {formatCents(target.amount)}
            </span>
            <span className={Number(months) > 6 ? layout.danger : layout.success}>
              {Number(months) > 6
                ? 'Plus de 6 mois : validation d’un responsable puis accord du créancier.'
                : 'Dans la limite autorisée : envoi direct au débiteur.'}
            </span>
          </div>
        )}
        {state.outcome === 'CALLBACK' && (
          <div className={css.box2}>
            <div className={layout.chips}>
              {RECALLS.map(([id, label]) => (
                <button key={id} type="button" className={layout.chip} aria-pressed={recall === id} onClick={() => setRecall(id)}>
                  {label}
                </button>
              ))}
            </div>
            <span>
              Rappel prévu : <strong>{recallText}</strong> · ajouté à votre file et à l&apos;agenda
            </span>
          </div>
        )}
        {state.outcome === 'DISPUTE' && (
          <div className={css.box2}>
            <Champ
              label="Motif de la contestation"
              type="select"
              value={reason}
              options={['Marchandise ou prestation non conforme', 'Montant erroné', 'Facture non reçue', 'Avoir en attente', 'Autre motif']}
              onChange={setReason}
            />
            <Case label="Suspendre les relances automatiques le temps de l'analyse" checked={suspend} onToggle={setSuspend} />
            <Case label="Demander l'avis du créancier dans son espace" checked={askCreditor} onToggle={setAskCreditor} />
          </div>
        )}
        {state.outcome === 'ALREADY_PAID' && (
          <div className={css.box2}>
            <div className={layout.form}>
              <Champ label="Payé le" type="date" value={paidOn} onChange={setPaidOn} />
              <Champ
                label="Référence du paiement"
                value={paymentReference}
                placeholder="N° de virement, chèque…"
                error={tried && !paymentReference.trim() ? 'Indiquez la référence.' : undefined}
                onChange={setPaymentReference}
              />
            </div>
          </div>
        )}
        {state.outcome === 'ABSENT' && (
          <div className={css.box2}>
            <Case label="Message vocal laissé (sans mention du montant ni de la dette)" checked={voicemail} onToggle={setVoicemail} />
            <Case label="Envoyer un SMS avec le lien de l’espace débiteur au mobile" checked={smsLink} onToggle={setSmsLink} />
          </div>
        )}
        {state.outcome === 'WRONG_NUMBER' && (
          <Alerte
            tone="neutral"
            compact
            text="Marquez le numéro appelé comme invalide ci-dessous. Saisissez le bon numéro s'il vous a été donné, ou choisissez un autre numéro du débiteur."
          />
        )}
        <Coordinates target={target} onEditing={setEditing} onDial={onDial} openPhone={state.outcome === 'WRONG_NUMBER'} />
        <p className={css.next}>
          <strong>Prochaine action :</strong> {state.outcome ? next[state.outcome] : 'choisissez un résultat (touches 1 à 8) pour générer l’action suivante.'}
        </p>
        <Champ label="Notes d'appel" type="textarea" rows={3} value={notes} onChange={setNotes} />
      </div>
      <div className={css.panelFoot}>
        {tried && errors.length > 0 && <Alerte tone="danger" compact title="À compléter avant d'enregistrer :" text={errors.join(' · ')} />}
        {failed && <Alerte tone="danger" compact text="La fiche n’a pas été enregistrée. Vos saisies sont conservées : réessayez." />}
        <span className={layout.hint}>
          {outcome
            ? `Récapitulatif : ${outcome.label.toLowerCase()} · ${contact} · durée ${clock(state.secs)} · code 3CX ${TCX_CODES[outcome.code]}`
            : 'Le résumé et le code 3CX apparaissent ici une fois le résultat choisi.'}
        </span>
        <Case
          label={
            state.outcome === 'PROMISE_TO_PAY'
              ? 'Envoyer l’e-mail de confirmation de promesse avec le lien de l’espace débiteur'
              : 'Envoyer un récapitulatif de l’échange par e-mail'
          }
          checked={recap}
          onToggle={setRecap}
        />
        <Bouton size="lg" full label="Enregistrer et appel suivant" kbd="Ctrl Entrée" loading={saving} onPress={() => void save()} />
      </div>
    </section>
  );
}
