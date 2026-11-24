import { toTelHref } from '@legarec/platform';
import { Link } from 'react-router';
import css from './PiedDePage.module.css';

/** `mandant` must only be given once the debtor's access code has been verified. */
export interface PiedDePageProps {
  variant?: 'barre' | 'integre';
  mandant?: string;
  note?: string;
  helpHref?: string;
  maxWidth?: string;
}

export function PiedDePage({ variant = 'barre', mandant, note, helpHref, maxWidth = '1080px' }: PiedDePageProps) {
  return (
    <footer className={css.root} data-variant={variant}>
      <div className={css.inner} style={variant === 'barre' ? { maxWidth } : undefined}>
        {note && <span>{note}</span>}
        <div className={css.row}>
          <span>
            © {new Date().getFullYear()} Legarec · Cabinet de recouvrement amiable, Paris{mandant ? `, agissant pour le compte de ${mandant}` : ''} ·{' '}
            <a href={toTelHref('01 87 88 02 98')} aria-label="Appeler Legarec au 01 87 88 02 98" className={css.phone}>
              01 87 88 02 98
            </a>
          </span>
          <nav aria-label="Informations légales" className={css.links}>
            <Link to="/mentions-legales">Mentions légales</Link>
            <Link to="/confidentialite">{mandant ? 'Vos données et vos droits (RGPD)' : 'Confidentialité (RGPD)'}</Link>
            <Link to="/cookies">Cookies</Link>
            {helpHref && <Link to={helpHref}>Aide</Link>}
          </nav>
        </div>
      </div>
    </footer>
  );
}
