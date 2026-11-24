import type { mailboxData } from '@legarec/contracts';
import { Alerte, Bouton, Carte, Champ, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import type { z } from 'zod';
import { ApiError } from '../../app/api';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

type Sender = z.infer<typeof mailboxData>['sender'];
export interface StaffMessageFormProps {
  sender: Sender;
  recipient?: { email: string; name: string; isDebtor: boolean; caseId: string; reference: string };
  onClose: () => void;
}

/** Plain text only: the API splits it into paragraphs and escapes it, then sends it from the employee's OVH mailbox. */
export function StaffMessageForm({ sender, recipient, onClose }: StaffMessageFormProps) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [to, setTo] = useState(recipient?.email ?? '');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
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
      ],
      onConfirm: async () => {
        setFailure(null);
        try {
          await change('/emails/messages', { body: { to, subject, paragraphs, caseId: recipient?.caseId ?? null } });
          toast({ message: 'Message envoyé.' });
          onClose();
        } catch (error) {
          setFailure(
            error instanceof ApiError && error.status === 429
              ? `Quota OVH atteint pour ${sender.address}. Réessayez dans l’heure.`
              : 'La boîte OVH a refusé l’envoi. Rien n’est parti ; vous pouvez réessayer.',
          );
          throw error;
        }
      },
    });
  return (
    <Carte title="Nouveau message" description={`Envoyé depuis ${sender.address}, votre adresse`} actionLabel="Fermer" onAction={onClose}>
      <div className={layout.stack}>
        <div className={layout.form}>
          <Champ label="Destinataire" type="email" required value={to} placeholder="nom@entreprise.fr" onChange={setTo} />
          <Champ label="Objet" required value={subject} maxLength={150} onChange={setSubject} />
        </div>
        <Champ
          label="Message"
          type="textarea"
          rows={7}
          required
          value={text}
          help="Texte simple ; une ligne vide sépare deux paragraphes."
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
          <Bouton variant="secondary" label="Annuler" onPress={onClose} />
          <Bouton label="Envoyer" icon="send" disabled={!valid} onPress={send} />
        </div>
      </div>
    </Carte>
  );
}
