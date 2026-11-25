import { toTelHref } from '@legarec/platform';
import { applyDisplay } from '@legarec/tokens';
import { BoutonsAffichage, EntetePublique, Icone, PiedDePage, type EntetePubliqueProps } from '@legarec/ui';
import { useLocalStorage } from '@mantine/hooks';
import { useEffect, type ReactNode } from 'react';
import css from './Debtor.module.css';

/** `creditor` is only given once the access code has been verified. */
export function Frame({ children, nav, tools, creditor }: { children: ReactNode; nav?: EntetePubliqueProps['nav']; tools?: ReactNode; creditor?: string }) {
  const [dark, setDark] = useLocalStorage({ key: 'lg-login-dark', defaultValue: false });
  const [lowVision, setLowVision] = useLocalStorage({ key: 'lg-login-a11y', defaultValue: false });
  useEffect(() => applyDisplay(dark ? 'dark' : 'light', lowVision), [dark, lowVision]);
  return (
    <div data-brand className={css.root}>
      <a href="#contenu" className={css.skip}>
        Aller au contenu
      </a>
      <EntetePublique subtitle="Cabinet de recouvrement" homeHref={nav ? '/espace' : '/'} maxWidth="1128px" nav={nav}>
        <span className={css.secure}>
          <Icone icon="lock" size={14} />
          Espace sécurisé
        </span>
        <span className={css.question}>
          Une question ?{' '}
          <a href={toTelHref('01 87 88 02 98')} aria-label="Appeler Legarec au 01 87 88 02 98">
            01 87 88 02 98
          </a>
        </span>
        <BoutonsAffichage dark={dark} lowVision={lowVision} onDark={setDark} onLowVision={setLowVision} />
        {tools}
      </EntetePublique>
      <main id="contenu" className={css.main} tabIndex={-1}>
        {children}
      </main>
      <PiedDePage mandant={creditor} maxWidth="1032px" />
    </div>
  );
}
