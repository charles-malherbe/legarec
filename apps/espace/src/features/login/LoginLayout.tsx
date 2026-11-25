import { applyDisplay } from '@legarec/tokens';
import { Icone, PiedDePage, type IconName } from '@legarec/ui';
import { useLocalStorage } from '@mantine/hooks';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import css from './Login.module.css';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'phone', title: 'Appels, SMS et e-mails', text: 'Tout l’historique au même endroit, par dossier' },
  { icon: 'calendar', title: 'Agenda et suivi des relances', text: 'Relances automatiques et actions du jour' },
  { icon: 'file', title: 'Historique des fichiers', text: 'Courriers, pièces et actes de chaque dossier' },
];
const LOGO_URL = import.meta.env.VITE_LOGO_NEGATIVE_URL as string | undefined;

export function LoginLayout({ children }: { children: ReactNode }) {
  // Display choices are remembered on the device before login (no session yet).
  const [dark, setDark] = useLocalStorage({ key: 'lg-login-dark', defaultValue: false });
  const [lowVision, setLowVision] = useLocalStorage({ key: 'lg-login-a11y', defaultValue: false });
  useEffect(() => applyDisplay(dark ? 'dark' : 'light', lowVision), [dark, lowVision]);
  return (
    <div data-brand className={css.root}>
      <section aria-label="Présentation" className={css.intro} data-dark>
        {LOGO_URL ? (
          <img src={LOGO_URL} alt="Legarec, cabinet de recouvrement" className={css.logoImage} />
        ) : (
          <span className={css.logoText}>Legarec, cabinet de recouvrement</span>
        )}
        <div className={css.pitch}>
          <div className={css.headline}>
            <span className={css.kicker}>Portail interne Legarec</span>
            <h1>Appels, relances et dossiers, au même endroit.</h1>
          </div>
          <ul className={css.features}>
            {FEATURES.map((item) => (
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
          <span role="group" aria-label="Affichage" className={css.display}>
            <button
              type="button"
              aria-pressed={lowVision}
              title="Texte agrandi et contraste renforcé"
              aria-label="Aa Texte agrandi"
              onClick={() => setLowVision(!lowVision)}
            >
              Aa
            </button>
            <button type="button" aria-pressed={dark} title="Mode sombre" aria-label="Mode sombre" onClick={() => setDark(!dark)}>
              <Icone icon="moon" size={16} stroke={1.7} />
            </button>
          </span>
          <span>Besoin d&apos;aide ?</span> <Link to="/aide">Centre d&apos;aide</Link>
        </div>
        <div className={css.center}>
          <div className={css.form}>{children}</div>
        </div>
        <PiedDePage variant="integre" note="Blocage 15 min après 5 échecs · Déconnexion après 30 min d'inactivité" helpHref="/aide" />
      </main>
    </div>
  );
}
