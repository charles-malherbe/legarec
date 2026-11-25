import { notificationItem, type NotificationItem } from '@legarec/contracts';
import { Badge, Bouton, Carte, Case, EtatListe, PageHeader, useToast, type Tone } from '@legarec/ui';
import { useState } from 'react';
import { z } from 'zod';
import { useApi, useChange } from '../../app/data';
import layout from '@legarec/ui/layout.module.css';

const KIND: Record<NotificationItem['kind'], { label: string; plural: string; tone: Tone }> = {
  PAYMENT: { label: 'Paiement', plural: 'Paiements', tone: 'success' },
  MESSAGE: { label: 'Message', plural: 'Messages', tone: 'info' },
  REMINDER: { label: 'Échéance', plural: 'Échéances et relances', tone: 'warning' },
  LITIGATION: { label: 'Contentieux', plural: 'Contentieux', tone: 'danger' },
  CREDITOR: { label: 'Créancier', plural: 'Créanciers', tone: 'marine' },
  SYSTEM: { label: 'Système', plural: 'Système', tone: 'neutral' },
};
const DAYS = [
  ['TODAY', 'Aujourd’hui'],
  ['YESTERDAY', 'Hier'],
  ['EARLIER', 'Plus tôt'],
] as const;

export function NotificationsPage() {
  const change = useChange();
  const toast = useToast();
  const { data = [], isPending, error, refetch } = useApi(z.array(notificationItem), '/notifications');
  const [kind, setKind] = useState<NotificationItem['kind'] | 'all'>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const unread = data.filter((item) => item.unread);
  const rows = data.filter((item) => (kind === 'all' || item.kind === kind) && (!onlyUnread || item.unread));
  const set = (ids: string[], value: boolean) => change('/notifications', { method: 'PUT', body: { ids, unread: value } });
  const readAll = async () => {
    const ids = unread.map((item) => item.id);
    await set(ids, false);
    toast({ message: 'Toutes les notifications sont lues.', undo: () => void set(ids, true) });
  };
  const chip = (id: typeof kind, label: string, count: number) => (
    <button key={id} type="button" className={layout.chip} aria-pressed={kind === id} onClick={() => setKind(id)}>
      {label} <span className={layout.num}>{count}</span>
    </button>
  );
  return (
    <>
      <PageHeader
        title="Centre de notifications"
        description={isPending ? ' ' : `${unread.length} non lue${unread.length > 1 ? 's' : ''} · ${data.length} notifications sur 7 jours`}
        actions={[
          { label: 'Préférences de notification', href: '/compte' },
          { label: 'Tout marquer comme lu', primary: true, kbd: 'N', disabled: unread.length === 0, onPress: () => void readAll() },
        ]}
      />
      <div className={layout.between}>
        <div role="group" aria-label="Catégories" className={layout.chips}>
          {chip('all', 'Toutes', data.length)}
          {(Object.keys(KIND) as NotificationItem['kind'][]).map((id) => chip(id, KIND[id].plural, data.filter((item) => item.kind === id).length))}
        </div>
        <Case label="Non lues uniquement" checked={onlyUnread} onToggle={setOnlyUnread} />
      </div>
      {isPending || error || rows.length === 0 ? (
        <div className={layout.card}>
          <EtatListe
            kind={isPending ? 'loading' : error ? 'error' : 'empty'}
            count={5}
            title={!isPending && !error ? 'Aucune notification dans cette catégorie.' : undefined}
            text={!isPending && !error ? 'Changez de catégorie ou affichez aussi les notifications lues.' : undefined}
            onAction={error ? () => void refetch() : undefined}
          />
        </div>
      ) : (
        DAYS.map(([id, label]) => {
          const items = rows.filter((item) => item.day === id);
          return items.length === 0 ? null : (
            <Carte key={id} title={label} padding="none">
              <ul className={layout.list}>
                {items.map((item) => (
                  <li key={item.id} style={item.unread ? { boxShadow: 'inset 3px 0 0 var(--marine)', background: 'var(--surface-2)' } : undefined}>
                    <Badge label={KIND[item.kind].label} tone={KIND[item.kind].tone} />
                    <span className={`${layout.text} ${layout.grow}`}>
                      <span style={{ fontWeight: item.unread ? 600 : 400 }}>
                        {item.text}
                        {item.unread && <span className={layout.hidden}> (non lue)</span>}
                      </span>
                      <span className={layout.hint}>
                        {item.meta} · {item.time}
                      </span>
                    </span>
                    <span className={layout.inline}>
                      <Bouton
                        variant="secondary"
                        size="sm"
                        label={item.cta}
                        ariaLabel={`${item.cta} : ${item.text}`}
                        href={item.href}
                        onPress={() => void set([item.id], false)}
                      />
                      <Bouton
                        variant="link"
                        size="sm"
                        label={item.unread ? 'Marquer comme lue' : 'Marquer comme non lue'}
                        ariaLabel={`${item.unread ? 'Marquer comme lue' : 'Marquer comme non lue'} : ${item.text}`}
                        onPress={() => void set([item.id], !item.unread)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </Carte>
          );
        })
      )}
    </>
  );
}
