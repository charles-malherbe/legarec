import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { Embleme } from './Embleme';
import css from './EntetePublique.module.css';

export interface EntetePubliqueProps {
  subtitle: string;
  homeHref?: string;
  after?: ReactNode;
  children?: ReactNode;
  maxWidth?: string;
  nav?: { label: string; items: { href: string; label: string; badge?: number }[] };
}

/** Header of the creditors' and debtors' portals. */
export function EntetePublique({ subtitle, homeHref = '/', after, children, maxWidth = '1320px', nav }: EntetePubliqueProps) {
  return (
    <header className={css.root}>
      <div className={css.inner} style={{ maxWidth }}>
        <div className={css.row}>
          <div className={css.group}>
            <NavLink to={homeHref} className={css.brand}>
              <Embleme />
              <span className={css.name}>
                <span className={css.title}>Legarec</span>
                <span className={css.subtitle}>{subtitle}</span>
              </span>
            </NavLink>
            {after}
          </div>
          <div className={css.tools}>{children}</div>
        </div>
        {nav && (
          <nav aria-label={nav.label} className={css.nav}>
            {nav.items.map((item) => (
              <NavLink key={item.href} to={item.href} end className={css.tab}>
                {item.label}
                {!!item.badge && (
                  <span className={css.badge}>
                    {item.badge}
                    <span className={css.hidden}> non lu{item.badge > 1 ? 's' : ''}</span>
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
