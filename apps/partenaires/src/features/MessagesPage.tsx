import { portalThreads } from '@legarec/contracts';
import { Bouton, Champ, EtatListe, FilMessages, useConfirm, useToast } from '@legarec/ui';
import { useState } from 'react';
import css from '../app/Portal.module.css';
import { useApi, useChange, usePartner } from '../app/data';

export function MessagesPage() {
  const user = usePartner();
  const { data, error, refetch } = useApi(portalThreads, '/portal/messages');
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const current = data?.items.find((item) => item.id === selected) ?? data?.items[0];
  const open = (id: string) => {
    setSelected(id);
    setDraft('');
    if (data?.items.find((item) => item.id === id)?.unread) void change(`/portal/messages/${id}/read`);
  };
  const send = () => {
    if (!current || !draft.trim()) return;
    confirm({
      title: `Envoyer ce message à ${user.officer} ?`,
      body: draft.trim(),
      details: [
        { k: 'Sujet', v: current.subject },
        { k: 'Référence', v: current.reference },
      ],
      confirmLabel: 'Envoyer',
      onConfirm: async () => {
        await change(`/portal/messages/${current.id}`, { body: { text: draft.trim() } });
        setDraft('');
        toast({ message: 'Message envoyé.' });
      },
    });
  };
  return (
    <>
      <div className={css.heading}>
        <div>
          <h1>Messages</h1>
          <p>Échangez avec votre gestionnaire, {user.officer}. Réponse sous un jour ouvré.</p>
        </div>
      </div>
      {!data || !current ? (
        <div className={css.panel}>
          {data ? (
            <EtatListe kind="empty" title="Aucun message" text="Vos échanges avec votre gestionnaire apparaîtront ici." />
          ) : (
            <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
          )}
        </div>
      ) : (
        <div className={css.two}>
          <div className={css.panel} data-flush>
            <ul className={css.conversations} aria-label="Conversations">
              {data.items.map((item) => {
                const last = item.messages.at(-1);
                return (
                  <li key={item.id}>
                    <button type="button" aria-pressed={item.id === current.id} onClick={() => open(item.id)}>
                      <span className={css.inline}>
                        <strong>{item.subject}</strong>
                        <small>{item.time}</small>
                      </span>
                      <small>
                        {item.reference}
                        {item.unread && ' · non lu'}
                      </small>
                      <small className={css.preview}>
                        {last?.mine ? 'Vous : ' : ''}
                        {last?.text}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className={css.panel}>
            <FilMessages messages={current.messages} label={`Conversation : ${current.subject}`} />
            <form
              className={css.thread}
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <Champ label="Votre message" type="textarea" rows={2} value={draft} placeholder={`Écrire à ${user.officer}…`} onChange={setDraft} />
              <div className={css.end}>
                <Bouton type="submit" label="Envoyer" disabled={!draft.trim()} />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
