import { Icone } from './Icone';
import css from './FilMessages.module.css';

export interface FilMessage {
  id: string;
  mine: boolean;
  who: string;
  when: string;
  text: string;
  attachments?: { id: string; name: string }[];
  /** Acknowledgment shown under a message sent by the reader. */
  receipt?: string;
}

/** Thread of a portal. Texts are rendered as plain text. */
export function FilMessages({ messages, label }: { messages: FilMessage[]; label: string }) {
  return (
    <ol aria-label={label} className={css.root}>
      {messages.map((item) => (
        <li key={item.id} data-mine={item.mine || undefined}>
          <span className={css.meta}>
            {item.who} · {item.when}
          </span>
          <div className={css.bubble}>{item.text}</div>
          {item.attachments?.map((file) => (
            <span key={file.id} className={css.file}>
              <Icone icon="file" size={14} />
              {file.name}
            </span>
          ))}
          {item.receipt && <span className={css.meta}>{item.receipt}</span>}
        </li>
      ))}
    </ol>
  );
}
