import { api } from '@legarec/platform';
import { applyDisplay } from '@legarec/tokens';
import { Avatar, Bouton, BoutonsAffichage, EntetePublique, PiedDePage, SessionExpiry, useIdle } from '@legarec/ui';
import { useLocalStorage } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { z } from 'zod';
import css from './Portal.module.css';
import { SESSION_KEY, usePartner } from './data';

export function Shell() {
  const user = usePartner();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [dark, setDark] = useLocalStorage({ key: 'lg-login-dark', defaultValue: false });
  const [lowVision, setLowVision] = useLocalStorage({ key: 'lg-login-a11y', defaultValue: false });
  useEffect(() => applyDisplay(dark ? 'dark' : 'light', lowVision), [dark, lowVision]);
  const logout = useCallback(async () => {
    await api(z.undefined(), '/auth/logout', { method: 'POST' }).catch(() => undefined);
    client.clear();
    client.setQueryData(SESSION_KEY, null);
    // Nothing is drawn again by itself once the cache is empty.
    await navigate('/connexion');
  }, [client, navigate]);
  const idle = useIdle(
    useCallback(() => void logout(), [logout]),
    useCallback(() => void client.refetchQueries({ queryKey: SESSION_KEY }), [client]),
  );
  return (
    <div data-brand className={css.root}>
      <a href="#contenu" className={css.skip}>
        Aller au contenu
      </a>
      <EntetePublique
        subtitle="Espace créancier"
        after={
          <span className={css.creditor}>
            <span aria-hidden className={css.initials}>
              {user.creditor.initials}
            </span>
            <span className={css.lines}>
              <strong>{user.creditor.name}</strong>
              <small>SIREN {user.creditor.siren}</small>
            </span>
          </span>
        }
        nav={{
          label: "Sections de l'espace créancier",
          items: [
            { href: '/', label: 'Tableau de bord' },
            { href: '/dossiers', label: 'Mes dossiers' },
            { href: '/depot', label: 'Déposer des créances' },
            { href: '/reversements', label: 'Reversements' },
            { href: '/messages', label: 'Messages', badge: user.unread },
            { href: '/releves', label: 'Relevés et rapports' },
          ],
        }}
      >
        <Bouton label="+ Déposer des créances" href="/depot" />
        <BoutonsAffichage dark={dark} lowVision={lowVision} onDark={setDark} onLowVision={setLowVision} />
        <span className={css.creditor}>
          <Avatar title={`${user.firstName} ${user.lastName}`} tone="or" size={40} />
          <span className={css.lines}>
            <strong>
              {user.firstName} {user.lastName}
            </strong>
            <button type="button" className={css.logout} onClick={() => void logout()}>
              Se déconnecter
            </button>
          </span>
        </span>
      </EntetePublique>
      <main id="contenu" className={css.main} tabIndex={-1}>
        <Outlet />
      </main>
      <PiedDePage helpHref="/aide" maxWidth="1320px" />
      {idle.warning && <SessionExpiry secondsLeft={idle.secondsLeft} onStay={idle.stay} onLogout={() => void logout()} />}
    </div>
  );
}
