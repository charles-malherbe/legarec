import { Bouton, useShortcut } from '@legarec/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useApi, useChange } from '../../app/data';
import css from './Calls.module.css';
import layout from '../../shared/layout.module.css';

const incoming = z
  .object({ caseId: z.string(), name: z.string(), company: z.string(), phone: z.string(), reference: z.string(), creditor: z.string(), last: z.string() })
  .nullable();

/** A call from a known number opens the debtor's file as soon as it is answered. */
export function IncomingCall() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const change = useChange();
  const { data } = useApi(incoming, '/calls/incoming');
  const close = () => client.setQueryData(['/calls/incoming'], null);
  const answer = () => {
    if (!data) return;
    close();
    void change('/calls/incoming', { method: 'PUT', body: { answered: true } });
    void navigate(`/debiteurs/${data.caseId}`);
  };
  const decline = () => {
    close();
    void change('/calls/incoming', { method: 'PUT', body: { answered: false } });
  };
  useShortcut((event) => {
    if (!data) return;
    const key = event.key.toLowerCase();
    if (key === 'd') {
      event.preventDefault();
      answer();
    } else if (key === 'x') {
      event.preventDefault();
      decline();
    }
  });
  if (!data) return null;
  return (
    <div data-dark role="alertdialog" aria-labelledby="appel-entrant" className={`${css.call} ${css.incoming}`}>
      <div className={layout.text}>
        <span className={css.muted}>Appel entrant · 3CX · file Recouvrement (800)</span>
        <strong id="appel-entrant">{data.name}</strong>
        <span className={css.soft}>
          {data.company} · {data.phone}
        </span>
      </div>
      <div className={css.box}>
        <span className={css.soft}>
          Dossier {data.reference} · {data.creditor}
        </span>
        <span className={css.muted}>{data.last}</span>
      </div>
      <div className={layout.inline}>
        <Bouton variant="dark" size="lg" label="Refuser" kbd="X" onPress={decline} />
        <Bouton variant="success" size="lg" label="Décrocher" kbd="D" onPress={answer} />
      </div>
    </div>
  );
}
