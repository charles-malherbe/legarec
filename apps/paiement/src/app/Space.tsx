import { debtorCase, type DebtorCase } from '@legarec/contracts';
import { api } from '@legarec/platform';
import { Bouton, EtatListe, SessionExpiry, useIdle } from '@legarec/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router';
import { z } from 'zod';
import css from './Debtor.module.css';
import { SESSION_KEY, useApi, useDebtor } from './data';
import { Frame } from './Frame';

export const useCase = () => useOutletContext<DebtorCase>();

export function Space() {
  const debtor = useDebtor();
  const client = useQueryClient();
  const [caseId, setCaseId] = useState(debtor.cases[0]?.id ?? '');
  const { data, error, refetch } = useApi(debtorCase, `/debtor/cases/${caseId}`);
  const leave = useCallback(async () => {
    await api(z.undefined(), '/debtor/logout', { method: 'POST' }).catch(() => undefined);
    client.clear();
    client.setQueryData(SESSION_KEY, null);
  }, [client]);
  const idle = useIdle(useCallback(() => void leave(), [leave]));
  return (
    <Frame
      creditor={data?.creditor}
      nav={{
        label: 'Sections de votre espace',
        items: [
          { href: '/espace', label: 'Accueil' },
          { href: '/espace/messages', label: 'Messages', badge: data?.unread },
          { href: '/espace/demandes', label: 'Mes demandes' },
          { href: '/espace/payer', label: 'Payer' },
          { href: '/espace/echeancier', label: 'Mon échéancier' },
        ],
      }}
      tools={<Bouton variant="secondary" size="sm" label="Quitter" onPress={() => void leave()} />}
    >
      {!data ? (
        <div className={css.panel}>
          <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
        </div>
      ) : (
        <>
          <div className={css.heading}>
            <h1>Bonjour {debtor.greeting}</h1>
            <p>
              Dossier {data.reference} · {data.debtor} · créance de <strong>{data.creditor}</strong>
            </p>
          </div>
          {debtor.cases.length > 1 && (
            <div role="group" aria-label="Vos dossiers" className={css.chips}>
              {debtor.cases.map((item) => (
                <button key={item.id} type="button" aria-pressed={item.id === caseId} onClick={() => setCaseId(item.id)}>
                  {item.reference} · {item.creditor}
                </button>
              ))}
            </div>
          )}
          <Outlet context={data} key={data.id} />
        </>
      )}
      {idle.warning && <SessionExpiry secondsLeft={idle.secondsLeft} onStay={idle.stay} onLogout={() => void leave()} />}
    </Frame>
  );
}
