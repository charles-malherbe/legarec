import type { CaseDetail } from '@legarec/contracts';
import { formatCents, formatDate } from '@legarec/contracts';
import { Alerte, Bouton, Carte, Champ, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

const CHANNELS = ['E-mail', 'Courrier recommandé', 'SMS'];
const FRIENDLY = 'Rappel amiable';
const TEMPLATES = ['Relance ferme (niveau 3)', 'Rappel amiable', 'Mise en demeure'];

export function ReminderForm({ data, onClose }: { data: CaseDetail; onClose: () => void }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [channel, setChannel] = useState(CHANNELS[0] ?? '');
  const [template, setTemplate] = useState(TEMPLATES[0] ?? '');
  const [recipient, setRecipient] = useState(data.mainContact.email);
  const numbers = data.invoices.map((invoice) => invoice.number).join(', ');
  const [message, setMessage] = useState(
    `Madame, Monsieur,\n\nNous intervenons pour le compte de notre client ${data.creditor}. Malgré nos précédentes relances, les factures ${numbers}, d'un montant total de ${formatCents(data.principal)}, restent impayées. Nous vous remercions de procéder au règlement sous 8 jours.${data.firstLetter ? `\n\nRéférence de notre premier courrier : ${data.firstLetter.reference} du ${formatDate(data.firstLetter.date)}.` : ''}`,
  );
  const registered = channel === 'Courrier recommandé';
  /** Every reminder after the first letter recalls its reference and date. */
  const blocked = !data.firstLetter && template !== FRIENDLY;
  const pickChannel = (next: string) => {
    setChannel(next);
    const { email, phone, address } = data.mainContact;
    setRecipient(next === 'SMS' ? phone : next === 'E-mail' ? email : address);
  };
  const send = () =>
    confirm({
      title: 'Envoyer cette relance ?',
      tone: registered ? 'danger' : 'primary',
      body: `${registered ? 'Une lettre recommandée ne peut plus être annulée une fois envoyée. ' : ''}La relance part immédiatement ; l’envoi est ajouté à l’historique du dossier. Les mentions obligatoires du modèle sont ajoutées automatiquement.`,
      confirmLabel: 'Envoyer la relance',
      details: [
        { k: 'Débiteur', v: data.name },
        { k: 'Canal', v: channel },
        { k: 'Modèle', v: template },
        { k: 'Destinataire', v: recipient },
        { k: 'Montant', v: formatCents(data.amount) },
        { k: 'Premier courrier', v: data.firstLetter ? `${data.firstLetter.reference} du ${formatDate(data.firstLetter.date)}` : 'Cette relance' },
      ],
      onConfirm: async () => {
        await change(`/cases/${data.id}/reminders`, { body: { channel, template, recipient, message } });
        toast({ message: 'Relance envoyée.' });
        onClose();
      },
    });
  return (
    <Carte title={`Nouvelle relance — niveau ${data.remindersSent + 1}`} actionLabel="Fermer" onAction={onClose}>
      <div className={layout.stack}>
        <div className={layout.form}>
          <Champ label="Canal" type="select" value={channel} options={CHANNELS} onChange={pickChannel} />
          <Champ label="Modèle" type="select" value={template} options={TEMPLATES} onChange={setTemplate} />
          <Champ label="Destinataire" value={recipient} onChange={setRecipient} />
        </div>
        <Champ label="Message" type="textarea" rows={7} value={message} onChange={setMessage} />
        {blocked && (
          <Alerte
            tone="danger"
            compact
            text="Aucun premier courrier n’est enregistré pour ce dossier : une relance doit rappeler sa référence et sa date. Envoyez d’abord le rappel amiable."
          />
        )}
        <div className={layout.end}>
          <Bouton variant="secondary" label="Annuler" onPress={onClose} />
          <Bouton label="Envoyer la relance" disabled={blocked || !recipient.trim() || !message.trim()} onPress={send} />
        </div>
      </div>
    </Carte>
  );
}
