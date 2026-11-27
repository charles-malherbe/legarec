import type { CaseDetail, LetterTemplate, ReminderChannel } from '@legarec/contracts';
import { formatCents, formatDate, reminderAmount, SENDING_REFUSALS, sendingRefusal } from '@legarec/contracts';
import { Alerte, Bouton, Carte, Champ, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { ApiError } from '../../app/api';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

/** The labels of the screen, and the codes the API reads. */
const CHANNELS: { value: ReminderChannel; label: string }[] = [
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'REGISTERED_LETTER', label: 'Courrier recommandé' },
  { value: 'SMS', label: 'SMS' },
];
type Template = Extract<LetterTemplate, 'FRIENDLY' | 'FIRM' | 'FORMAL_NOTICE'>;
const TEMPLATES: { value: Template; label: string }[] = [
  { value: 'FIRM', label: 'Relance ferme (niveau 3)' },
  { value: 'FRIENDLY', label: 'Rappel amiable' },
  { value: 'FORMAL_NOTICE', label: 'Mise en demeure' },
];
/** The validated e-mail each template leaves with (question 212): what it announces depends on it. */
const LEVELS: Record<Template, number> = { FRIENDLY: 1, FIRM: 2, FORMAL_NOTICE: 3 };
const labelOf = <T extends string>(items: { value: T; label: string }[], value: T) => items.find((item) => item.value === value)?.label ?? value;
/** Why the API refused, in the words of the firm; null for any other failure. */
const refusalOf = (error: unknown): string | null => {
  const code = error instanceof ApiError && error.status === 409 ? sendingRefusal.safeParse((error.body as { code?: unknown } | null)?.code) : null;
  return code?.success ? SENDING_REFUSALS[code.data] : null;
};

export function ReminderForm({ data, onClose }: { data: CaseDetail; onClose: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [channel, setChannel] = useState<ReminderChannel>('EMAIL');
  const [template, setTemplate] = useState<Template>('FIRM');
  const [recipient, setRecipient] = useState(data.mainContact.email);
  const [refusal, setRefusal] = useState<string | null>(null);
  // An e-mail only leaves for an address of the case: the API refuses any other.
  const addresses = data.contacts.filter((contact) => contact.kind === 'EMAIL').map((contact) => contact.value);
  const numbers = data.invoices.map((invoice) => invoice.number).join(', ');
  const [message, setMessage] = useState(
    `Madame, Monsieur,\n\nNous intervenons pour le compte de notre client ${data.creditor}. Malgré nos précédentes relances, les factures ${numbers}, d'un montant total de ${formatCents(data.principal)}, restent impayées. Nous vous remercions de procéder au règlement sous 8 jours.${data.firstLetter ? `\n\nRéférence de notre premier courrier : ${data.firstLetter.reference} du ${formatDate(data.firstLetter.date)}.` : ''}`,
  );
  const registered = channel === 'REGISTERED_LETTER';
  const byEmail = channel === 'EMAIL';
  /** Every reminder after the first letter recalls its reference and date. */
  const blocked = !data.firstLetter && template !== 'FRIENDLY';
  const pickChannel = (next: string) => {
    const picked = CHANNELS.find((item) => item.value === next)?.value ?? 'EMAIL';
    setChannel(picked);
    setRefusal(null);
    const { email, phone, address } = data.mainContact;
    setRecipient(picked === 'SMS' ? phone : picked === 'EMAIL' ? email : address);
  };
  const send = () =>
    confirm({
      title: 'Envoyer cette relance ?',
      tone: registered ? 'danger' : 'primary',
      body: `${registered ? 'Une lettre recommandée ne peut plus être annulée une fois envoyée. ' : ''}La relance part immédiatement ; l’envoi est ajouté à l’historique du dossier. Les mentions obligatoires du modèle sont ajoutées automatiquement.`,
      confirmLabel: 'Envoyer la relance',
      details: [
        { k: 'Débiteur', v: data.name },
        { k: 'Canal', v: labelOf(CHANNELS, channel) },
        { k: 'Modèle', v: labelOf(TEMPLATES, template) },
        { k: 'Destinataire', v: recipient },
        // What the e-mail of this level announces (question 213). For the other channels, not open yet, nothing exact to show.
        ...(byEmail ? [{ k: 'Montant', v: formatCents(reminderAmount(LEVELS[template], data)) }] : []),
        { k: 'Premier courrier', v: data.firstLetter ? `${data.firstLetter.reference} du ${formatDate(data.firstLetter.date)}` : 'Cette relance' },
      ],
      onConfirm: async () => {
        try {
          // An e-mail leaves with the validated text of its template: no typed text is sent nor kept.
          await change(`/cases/${data.id}/reminders`, { body: { channel, template, recipient, ...(byEmail ? {} : { message }) } });
        } catch (error) {
          const reason = refusalOf(error);
          if (!reason) throw error;
          // Refused by a rule of the firm: nothing has left, and the form says why.
          setRefusal(reason);
          return;
        }
        toast({ message: 'Relance envoyée.' });
        onClose();
      },
    });
  return (
    <Carte title={`Nouvelle relance — niveau ${data.remindersSent + 1}`} actionLabel="Fermer" onAction={onClose}>
      <div className={layout.stack}>
        <div className={layout.form}>
          <Champ label="Canal" type="select" value={channel} options={CHANNELS} onChange={pickChannel} />
          <Champ
            label="Modèle"
            type="select"
            value={template}
            options={TEMPLATES}
            onChange={(next) => {
              setTemplate(TEMPLATES.find((item) => item.value === next)?.value ?? 'FIRM');
              setRefusal(null);
            }}
          />
          {byEmail && addresses.length > 0 ? (
            <Champ label="Destinataire" type="select" value={recipient} options={addresses} onChange={setRecipient} />
          ) : (
            <Champ label="Destinataire" value={recipient} onChange={setRecipient} />
          )}
        </div>
        {byEmail ? (
          <Alerte tone="info" compact text="Par e-mail, la relance part avec le texte validé du modèle." />
        ) : (
          <Champ label="Message" type="textarea" rows={7} value={message} onChange={setMessage} />
        )}
        {blocked && (
          <Alerte
            tone="danger"
            compact
            text="Aucun premier courrier n’est enregistré pour ce dossier : une relance doit rappeler sa référence et sa date. Envoyez d’abord le rappel amiable."
          />
        )}
        {refusal && <Alerte tone="danger" compact text={`La relance n’est pas partie : ${refusal}.`} />}
        <div className={layout.end}>
          <Bouton variant="secondary" label="Annuler" onPress={onClose} />
          <Bouton label="Envoyer la relance" disabled={blocked || !recipient.trim() || (!byEmail && !message.trim())} onPress={send} />
        </div>
      </div>
    </Carte>
  );
}
