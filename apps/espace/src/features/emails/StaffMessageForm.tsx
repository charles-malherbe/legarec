import type { EmailDraft, mailboxData, MessageTemplate } from '@legarec/contracts';
import { Alerte, Bouton, Carte, Case, Champ, EditeurTexte, useConfirm, useToast } from '@legarec/ui';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ApiError } from '../../app/api';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

const draftSaved = z.object({ id: z.string() });
type Sender = z.infer<typeof mailboxData>['sender'];
export interface MessageRecipient {
  email: string;
  name: string;
  isDebtor: boolean;
  caseId: string;
  reference: string;
}
export interface StaffMessageFormProps {
  sender: Sender;
  recipient?: MessageRecipient;
  templates?: MessageTemplate[];
  draft?: EmailDraft;
  /** Address known beforehand, outside any debtor's case (a creditor's contact). */
  initialTo?: string;
  onClose: () => void;
}

/**
 * Text with its marks only (bold, italic, lists: `messageText.ts`), never HTML: the API reads it into blocks that the
 * template escapes, then sends it from the employee's OVH mailbox.
 */
export function StaffMessageForm({ sender, recipient, templates = [], draft, initialTo = '', onClose }: StaffMessageFormProps) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [to, setTo] = useState(draft?.to ?? recipient?.email ?? initialTo);
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [text, setText] = useState(draft?.text ?? '');
  const [template, setTemplate] = useState('');
  const [statement, setStatement] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The form opens below the button: bring the keyboard to it.
  useEffect(() => document.getElementById('message-to')?.focus(), []);
  const left = sender.hourlyQuota - sender.sentThisHour;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const valid = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to.trim()) && subject.trim() && paragraphs.length > 0 && left > 0;
  const send = () =>
    confirm({
      title: 'Envoyer ce message ?',
      body: 'Il part de votre boîte OVH, avec votre signature. Une copie est placée dans vos éléments envoyés et dans l’historique du dossier.',
      confirmLabel: 'Envoyer',
      details: [
        { k: 'De', v: `${sender.name} <${sender.address}>` },
        { k: 'À', v: to },
        { k: 'Objet', v: subject },
        ...(recipient ? [{ k: 'Dossier', v: `${recipient.name} · ${recipient.reference}` }] : []),
        ...(statement ? [{ k: 'Pièce jointe', v: 'Relevé de compte' }] : []),
      ],
      onConfirm: async () => {
        setFailure(null);
        try {
          await change('/emails/messages', { body: { to, subject, paragraphs, caseId: recipient?.caseId ?? draft?.caseId ?? null, statement } });
        } catch (error) {
          setFailure(
            error instanceof ApiError && error.status === 429
              ? `Quota OVH atteint pour ${sender.address}. Réessayez dans l’heure.`
              : 'La boîte OVH a refusé l’envoi. Rien n’est parti ; vous pouvez réessayer.',
          );
          throw error;
        }
        // The message has left: a failed clean-up must not suggest sending it again.
        const cleaned = draft
          ? await change(`/emails/drafts/${draft.id}`, { method: 'DELETE' }).then(
              () => true,
              () => false,
            )
          : true;
        toast({ message: cleaned ? 'Message envoyé.' : 'Message envoyé. Le brouillon n’a pas pu être supprimé : supprimez-le, ne le renvoyez pas.' });
        onClose();
      },
    });
  const pick = (id: string) => {
    const next = templates.find((item) => item.id === id);
    setTemplate(id);
    if (!next) return;
    const before = { subject, text };
    setSubject(subject || next.subject);
    setText(next.text);
    if (before.text.trim())
      toast({
        message: `Modèle « ${next.name} » inséré.`,
        undo: () => {
          setSubject(before.subject);
          setText(before.text);
          setTemplate('');
        },
      });
  };
  const saveDraft = async () => {
    try {
      await change('/emails/drafts', { body: { id: draft?.id, to, subject, text, caseId: recipient?.caseId ?? draft?.caseId ?? null }, schema: draftSaved });
      toast({ message: 'Brouillon enregistré.' });
      onClose();
    } catch {
      toast({ message: 'Le brouillon n’a pas été enregistré. Votre texte est conservé à l’écran : réessayez.' });
    }
  };
  return (
    <Carte title="Nouveau message" description={`Envoyé depuis ${sender.address}, votre adresse`} actionLabel="Fermer" onAction={onClose}>
      <div className={layout.stack}>
        <div className={layout.form}>
          <Champ
            label="Destinataire"
            type="email"
            required
            autoFocus
            readOnly={!!recipient}
            help={recipient ? 'Adresse du contact du dossier. Choisissez un autre contact depuis la fiche débiteur.' : undefined}
            fieldId="message-to"
            value={to}
            placeholder="nom@entreprise.fr"
            onChange={setTo}
          />
          {templates.length > 0 && (
            <Champ
              label="Modèle"
              type="select"
              value={template}
              options={[{ value: '', label: 'Aucun (message libre)' }, ...templates.map((item) => ({ value: item.id, label: item.name }))]}
              onChange={pick}
            />
          )}
          <Champ label="Objet" required value={subject} maxLength={150} onChange={setSubject} />
        </div>
        <EditeurTexte
          label="Message"
          required
          value={text}
          help="Gras, italique et listes avec la barre d’outils (Ctrl+B, Ctrl+I) ; Entrée commence un nouveau paragraphe."
          onChange={setText}
        />
        <div
          className={layout.notice}
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
          aria-label="Aperçu de la signature"
          role="group"
        >
          <strong>{sender.name}</strong>
          <span className={layout.muted}>{sender.roleLabel}</span>
          <span className={layout.muted}>
            {sender.address} · {sender.phone}
            {sender.extension && ` · poste ${sender.extension}`}
          </span>
          <span className={layout.muted}>
            {sender.firmAddress} · {sender.website}
          </span>
          <span className={layout.hint}>
            {recipient?.isDebtor
              ? 'Les mentions du recouvrement amiable (article L111-8) sont ajoutées en bas du message.'
              : 'Vous pouvez répondre directement à ce message.'}
          </span>
        </div>
        {left <= 20 && (
          <Alerte
            tone={left <= 0 ? 'danger' : 'warning'}
            compact
            text={
              left <= 0
                ? `Quota OVH atteint (${sender.hourlyQuota} e-mails par heure). Réessayez dans l’heure.`
                : `Encore ${left} envois possibles cette heure depuis votre boîte.`
            }
          />
        )}
        {failure && <Alerte tone="danger" title="Échec de l’envoi" text={failure} actionLabel="Nouvelle tentative" onAction={send} />}
        <div className={layout.end}>
          {recipient && <Case label="Joindre le relevé de compte" checked={statement} onToggle={setStatement} />}
          <Bouton variant="secondary" label="Annuler" onPress={onClose} />
          <Bouton variant="secondary" label="Enregistrer le brouillon" disabled={!text.trim() && !subject.trim()} onPress={() => void saveDraft()} />
          <Bouton label="Envoyer" icon="send" disabled={!valid} onPress={send} />
        </div>
      </div>
    </Carte>
  );
}
