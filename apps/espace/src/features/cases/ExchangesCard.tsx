import { DELIVERY_LABELS, type CaseDetail, type Exchange } from '@legarec/contracts';
import { Badge, Bouton, Carte, Champ, Onglets, useConfirm, useToast, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

const CHANNEL: Record<Exchange['channel'], { label: string; tone: Tone }> = {
  EMAIL_IN: { label: 'E-mail reçu', tone: 'info' },
  EMAIL_OUT: { label: 'E-mail envoyé', tone: 'marine' },
  CALL: { label: 'Appel', tone: 'success' },
  SMS_IN: { label: 'SMS reçu', tone: 'info' },
  SMS_OUT: { label: 'SMS envoyé', tone: 'marine' },
  LETTER: { label: 'Courrier', tone: 'neutral' },
  REGISTERED_LETTER: { label: 'LRAR', tone: 'neutral' },
  PORTAL_IN: { label: 'Espace débiteur', tone: 'teal' },
  PORTAL_OUT: { label: 'Réponse · espace débiteur', tone: 'marine' },
};
const DELIVERY: Record<NonNullable<Exchange['delivery']>, Tone> = { SENT: 'neutral', DELIVERED: 'info', ACKNOWLEDGED: 'success', FAILED: 'danger' };
const FILTERS = [
  ['all', 'Tous'],
  ['portal', 'Espace débiteur'],
  ['proof', 'Preuves d’envoi'],
] as const;

export function ExchangesCard({ data }: { data: CaseDetail }) {
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [reply, setReply] = useState('');
  const items = data.exchanges.filter((item) => filter === 'all' || (filter === 'portal' ? item.channel.startsWith('PORTAL') : item.delivery !== null));
  const send = () =>
    confirm({
      title: 'Envoyer cette réponse au débiteur ?',
      body: 'Elle apparaît dans son espace débiteur ; un e-mail l’avertit sans reprendre le contenu.',
      confirmLabel: 'Envoyer la réponse',
      details: [
        { k: 'Débiteur', v: data.name },
        { k: 'Message', v: reply.slice(0, 120) },
      ],
      onConfirm: async () => {
        await change(`/cases/${data.id}/portal-messages`, { body: { text: reply } });
        setReply('');
        toast({ message: 'Réponse envoyée dans l’espace débiteur.' });
      },
    });
  return (
    <Carte title="Échanges avec le débiteur" padding="none">
      <div style={{ padding: 'var(--sp-3) var(--sp-5)' }} className={layout.between}>
        <Onglets label="Filtrer les échanges" items={FILTERS.map(([id, label]) => ({ label, selected: id === filter, pick: () => setFilter(id) }))} />
        {data.canAct && (
          <span className={layout.inline}>
            <Link to="/appels" className={layout.link}>
              Appeler
            </Link>
            <Link to="/e-mails" className={layout.link}>
              E-mail
            </Link>
            <Link to="/sms" className={layout.link}>
              SMS
            </Link>
          </span>
        )}
      </div>
      <ul className={layout.list}>
        {items.map((item) => (
          <li key={item.id}>
            <Badge label={CHANNEL[item.channel].label} tone={CHANNEL[item.channel].tone} />
            <span className={`${layout.text} ${layout.grow}`}>
              <strong className={layout.strong}>{item.title}</strong>
              <span className={layout.muted}>{item.text}</span>
              <span className={layout.inline}>
                {!item.verified && <Badge label="non vérifié" tone="warning" />}
                {item.delivery && <Badge label={DELIVERY_LABELS[item.delivery]} tone={DELIVERY[item.delivery]} variant="outline" />}
                {item.acknowledgmentId && (
                  <Link to="/documents" className={layout.link}>
                    Voir l’accusé de réception
                  </Link>
                )}
              </span>
            </span>
            <span className={layout.hint}>{item.when}</span>
          </li>
        ))}
        {items.length === 0 && (
          <li>
            <span className={layout.muted}>Aucun échange pour ce filtre.</span>
          </li>
        )}
      </ul>
      {data.canAct && (
        <div className={layout.stack} style={{ padding: 'var(--sp-4) var(--sp-5)', borderTop: '1px solid var(--surface-3)' }}>
          <Champ label="Répondre dans l’espace débiteur" type="textarea" rows={3} value={reply} onChange={setReply} />
          <div className={layout.end}>
            <Bouton label="Envoyer la réponse" icon="send" disabled={!reply.trim()} onPress={send} />
          </div>
        </div>
      )}
    </Carte>
  );
}
