import { applyDisplay } from '@legarec/tokens';
import { useLocalStorage } from '@mantine/hooks';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BoutonsAffichage } from './BoutonsAffichage';
import { Icone } from './Icone';
import type { IconName } from './icons';
import { Marque } from './Marque';
import css from './PageConnexion.module.css';
import { PiedDePage } from './PiedDePage';

export type Portail = 'espace' | 'partenaires';
/** Portal shown by the login screens; set once at the root of each app. */
export const PortailContext = createContext<Portail>('espace');
type Feature = { icon: IconName; title: string; text: string };
/** Help reachable without an account: the help of the creditors' portal, the sign-in help of the staff's portal. */
type Help = { href: string; label: string };
export const PORTAILS: Record<Portail, { domain: string; kicker: string; headline: string; title: string; text: string; help: Help; features: Feature[] }> = {
  espace: {
    domain: 'espace.legarec.fr',
    kicker: 'Portail interne Legarec',
    headline: 'Appels, relances et dossiers, au même endroit.',
    title: 'Connexion à l’espace Legarec',
    text: 'Réservé aux collaborateurs du cabinet.',
    help: { href: '/aide-connexion', label: 'Aide à la connexion' },
    features: [
      { icon: 'phone', title: 'Appels, SMS et e-mails', text: 'Tout l’historique au même endroit, par dossier' },
      { icon: 'calendar', title: 'Agenda et suivi des relances', text: 'Relances automatiques et actions du jour' },
      { icon: 'file', title: 'Historique des fichiers', text: 'Courriers, pièces et actes de chaque dossier' },
    ],
  },
  partenaires: {
    domain: 'partenaires.legarec.fr',
    kicker: 'Portail créanciers',
    headline: 'Suivez vos créances confiées à Legarec.',
    title: 'Connexion à votre espace créancier',
    text: 'Suivez vos dossiers et transmettez vos pièces.',
    help: { href: '/aide', label: 'Centre d’aide' },
    features: [
      { icon: 'chart', title: 'Avancement de vos dossiers', text: 'Relances, promesses, échéanciers et contentieux' },
      { icon: 'upload', title: 'Transmission des pièces', text: 'Factures, contrats et justificatifs, en toute sécurité' },
      { icon: 'euro', title: 'Reversements et relevés', text: 'Sommes recouvrées et relevés mensuels' },
    ],
  },
};
/** `help`: false on the help page itself. */
export function PageConnexion({ children, help = true }: { children: ReactNode; help?: boolean }) {
  const portal = PORTAILS[useContext(PortailContext)];
  // Display choices are remembered on the device before login (no session yet).
  const [dark, setDark] = useLocalStorage({ key: 'lg-login-dark', defaultValue: false });
  const [lowVision, setLowVision] = useLocalStorage({ key: 'lg-login-a11y', defaultValue: false });
  useEffect(() => applyDisplay(dark ? 'dark' : 'light', lowVision), [dark, lowVision]);
  return (
    <div data-brand className={css.root}>
      <section aria-label="Présentation" className={css.intro} data-dark>
        <Marque size="lg" />
        <div className={css.pitch}>
          <div className={css.headline}>
            <span className={css.kicker}>{portal.kicker}</span>
            {/* The title of the page is the one of the form (h1); this line presents the portal. */}
            <p className={css.tagline}>{portal.headline}</p>
          </div>
          <ul className={css.features}>
            {portal.features.map((item) => (
              <li key={item.title}>
                <span className={css.featureIcon}>
                  <Icone icon={item.icon} size={18} color="var(--or)" />
                </span>
                <span className={css.featureText}>
                  <strong>{item.title}</strong>
                  <span>{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={css.pills}>
          <span>
            <Icone icon="lock" size={12} />
            Données hébergées en France
          </span>
          <span>Conforme RGPD</span>
        </div>
      </section>
      <main className={css.side}>
        <div className={css.tools}>
          <BoutonsAffichage dark={dark} lowVision={lowVision} onDark={setDark} onLowVision={setLowVision} />
          {help && (
            <>
              <span>Besoin d&apos;aide ?</span> <Link to={portal.help.href}>{portal.help.label}</Link>
            </>
          )}
        </div>
        <div className={css.center}>
          <div className={css.form}>{children}</div>
        </div>
        <PiedDePage variant="integre" note="Blocage 15 min après 5 échecs · Déconnexion après 30 min d'inactivité" helpHref={portal.help.href} />
      </main>
    </div>
  );
}
