import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Embleme } from './Embleme';
import { Icone } from './Icone';
import type { IconName } from './icons';
import css from './Sidebar.module.css';

export interface SidebarItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
  countTone?: 'navy' | 'yellow' | 'rose' | 'muted';
  countLabel?: string;
}
export interface SidebarGroup {
  id: string;
  label: string;
  items: SidebarItem[];
}
export interface SidebarCreditor {
  id: string;
  name: string;
  initials: string;
  siren?: string;
  count: number;
}
export interface SidebarProps {
  active: string;
  groups: SidebarGroup[];
  footer: SidebarItem[];
  creditors: SidebarCreditor[];
  creditorId: string;
  creditorsHref: string;
  onCreditor: (id: string) => void;
}

const cap = (count: number) => (count > 99 ? '99+' : String(count));

export function Sidebar({ active, groups, footer, creditors, creditorId, creditorsHref, onCreditor }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const burger = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const expanded = !collapsed || drawer;
  const current = creditors.find((creditor) => creditor.id === creditorId) ?? creditors[0];
  const isAll = current?.id === 'all';

  useEffect(() => {
    if (!drawer) return;
    nav.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawer(false);
      burger.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  const item = (entry: SidebarItem) => {
    const on = entry.href === active;
    const has = !!entry.count;
    return (
      <Link
        key={entry.href}
        to={entry.href}
        className={css.link}
        aria-current={on ? 'page' : undefined}
        title={expanded ? undefined : entry.label}
        aria-label={expanded ? undefined : `${entry.label}${has ? `, ${entry.count} ${entry.countLabel ?? ''}` : ''}`}
        onClick={() => setDrawer(false)}
      >
        {on && <span aria-hidden className={css.marker} />}
        <span className={css.linkIcon}>
          <Icone icon={entry.icon} size={18} />
        </span>
        {expanded && <span className={css.linkLabel}>{entry.label}</span>}
        {expanded && has && (
          <span className={css.count} data-tone={entry.countTone ?? 'muted'}>
            {cap(entry.count ?? 0)}
            <span className={css.hidden}> {entry.countLabel}</span>
          </span>
        )}
        {!expanded && has && entry.countTone !== 'muted' && <span aria-hidden className={css.dot} data-tone={entry.countTone} />}
      </Link>
    );
  };

  return (
    <div className={css.root}>
      <section aria-label="Menu et créancier actif" className={css.mobile}>
        <button ref={burger} type="button" className={css.burger} aria-label="Ouvrir le menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
          <Icone icon="menu" size={18} />
        </button>
        <Link to="/" className={css.brand}>
          <Embleme />
          <span className={css.brandMobile}>Legarec</span>
        </Link>
        <span className={css.mobileScope}>{current?.name}</span>
      </section>
      {drawer && <div className={css.backdrop} onClick={() => setDrawer(false)} aria-hidden />}
      <nav ref={nav} aria-label="Navigation principale" className={css.nav} data-open={drawer || undefined} data-collapsed={!expanded || undefined}>
        <div className={css.head}>
          <Link to="/" className={css.brand} aria-label={expanded ? undefined : 'Legarec, retour au tableau de bord'}>
            <Embleme />
            {expanded && (
              <span className={css.brandText}>
                <span className={css.brandName}>Legarec</span>
                <span className={css.brandSub}>
                  Recouvrement de créances<span className={css.hidden}>, retour au tableau de bord</span>
                </span>
              </span>
            )}
          </Link>
          <button
            type="button"
            className={css.close}
            aria-label="Fermer le menu"
            onClick={() => {
              setDrawer(false);
              burger.current?.focus();
            }}
          >
            <Icone icon="x" size={18} />
          </button>
        </div>
        {current && (
          <div className={css.switcher}>
            <button
              type="button"
              className={css.switch}
              aria-expanded={switcher}
              aria-haspopup="listbox"
              aria-label={expanded ? undefined : `Créancier ${current.name}, changer de créancier`}
              title={expanded ? undefined : `Créancier : ${current.name}`}
              onClick={() => setSwitcher(!switcher)}
            >
              <span className={css.badge} data-all={isAll || undefined}>
                {isAll ? <Icone icon="layers" size={18} /> : current.initials}
              </span>
              {expanded && (
                <>
                  <span className={css.switchText}>
                    <span className={css.caption}>{isAll ? 'Créancier actif' : `SIREN ${current.siren}`}</span>
                    <span className={css.switchName}>
                      {current.name}
                      <span className={css.hidden}>, changer de créancier</span>
                    </span>
                  </span>
                  <Icone icon="selector" size={16} color="var(--text-3)" />
                </>
              )}
            </button>
            {switcher && (
              <div className={css.menu}>
                <span className={css.menuTitle}>Afficher les données de</span>
                <ul role="listbox" aria-label="Créanciers" className={css.options}>
                  {creditors.map((creditor) => (
                    <li
                      key={creditor.id}
                      role="option"
                      aria-selected={creditor.id === creditorId}
                      tabIndex={0}
                      className={css.option}
                      onClick={() => {
                        onCreditor(creditor.id);
                        setSwitcher(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onCreditor(creditor.id);
                          setSwitcher(false);
                        }
                        if (event.key === 'Escape') setSwitcher(false);
                      }}
                    >
                      <span className={css.optionBadge} data-all={creditor.id === 'all' || undefined}>
                        {creditor.id === 'all' ? '∗' : creditor.initials}
                      </span>
                      <span className={css.optionText}>
                        <span>{creditor.name}</span>
                        {creditor.siren && <span className={css.caption}>SIREN {creditor.siren}</span>}
                      </span>
                      <span className={css.caption}>{creditor.count}</span>
                      <span className={css.tick}>{creditor.id === creditorId && <Icone icon="check" size={16} stroke={2.5} color="var(--marine-text)" />}</span>
                    </li>
                  ))}
                </ul>
                <Link to={creditorsHref} className={css.manage} onClick={() => setSwitcher(false)}>
                  <Icone icon="plus" size={16} color="var(--text-3)" />
                  Ajouter ou gérer les créanciers
                </Link>
              </div>
            )}
          </div>
        )}
        <div className={css.groups}>
          {groups.map((group) => {
            const open = !expanded || !closed[group.id];
            return (
              <div key={group.id} className={css.group}>
                {expanded ? (
                  <button type="button" className={css.groupLabel} aria-expanded={open} onClick={() => setClosed({ ...closed, [group.id]: open })}>
                    {group.label}
                    <Icone icon={open ? 'chevron-down' : 'chevron-right'} size={14} color="var(--text-3)" />
                  </button>
                ) : (
                  <span className={css.rule} />
                )}
                {open && group.items.map(item)}
              </div>
            );
          })}
        </div>
        <div className={css.footer}>
          {footer.map(item)}
          <span className={css.rule} />
          <button
            type="button"
            className={css.collapse}
            aria-label={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
            onClick={() => {
              setCollapsed(!collapsed);
              setSwitcher(false);
            }}
          >
            <svg aria-hidden width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v18" />
              <path d={collapsed ? 'm14 9 3 3-3 3' : 'm16 15-3-3 3-3'} />
            </svg>
            {expanded && <span>Réduire le menu</span>}
          </button>
        </div>
      </nav>
    </div>
  );
}
