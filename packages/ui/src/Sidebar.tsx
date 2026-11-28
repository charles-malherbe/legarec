import { useFocusTrap } from '@mantine/hooks';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  /** A page not finished yet: greyed with « Bientôt », still a link to it (DECISIONS.md, 28/11/2026). */
  soon?: boolean;
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
  /** Reduced to its icons when the page opens; told when the person changes it, to remember it. */
  collapsed?: boolean;
  onCollapsed?: (collapsed: boolean) => void;
  /** The groups closed when the page opens; told when the person changes them, to remember them. */
  closedGroups?: string[];
  onClosedGroups?: (ids: string[]) => void;
}

const cap = (count: number) => (count > 99 ? '99+' : String(count));
/** Beyond this number of entries, the creditor switcher offers a search field. */
const SEARCH_FROM = 8;
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function Sidebar({
  active,
  groups,
  footer,
  creditors,
  creditorId,
  creditorsHref,
  onCreditor,
  collapsed: collapsedAtFirst = false,
  onCollapsed,
  closedGroups = [],
  onClosedGroups,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(collapsedAtFirst);
  const [drawer, setDrawer] = useState(false);
  const holderOf = (href: string) => groups.find((group) => group.items.some((entry) => entry.href === href))?.id;
  // The group of the current page opens on arrival: the menu always shows where one is (DECISIONS.md, 28/11/2026).
  const [closed, setClosed] = useState(() => closedGroups.filter((id) => id !== holderOf(active)));
  const [arrivedAt, setArrivedAt] = useState(active);
  if (arrivedAt !== active) {
    setArrivedAt(active);
    const holder = holderOf(active);
    if (holder && closed.includes(holder)) setClosed(closed.filter((id) => id !== holder));
  }
  const root = useRef<HTMLDivElement>(null);
  const burger = useRef<HTMLButtonElement>(null);
  // Open, the drawer keeps the focus, as a window does.
  const trap = useFocusTrap(drawer);
  const expanded = !collapsed || drawer;

  useEffect(() => {
    if (!drawer) return;
    // The page behind the drawer is out of reach, for the keyboard as for a screen reader.
    const own = root.current;
    const behind = [...(own?.parentElement?.children ?? [])].filter((element) => element !== own && !element.hasAttribute('inert'));
    for (const element of behind) element.setAttribute('inert', '');
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawer(false);
      burger.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      for (const element of behind) element.removeAttribute('inert');
      document.removeEventListener('keydown', onKey);
    };
  }, [drawer]);

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    onCollapsed?.(!collapsed);
  };
  const toggleGroup = (id: string, open: boolean) => {
    const next = open ? [...closed, id] : closed.filter((other) => other !== id);
    setClosed(next);
    onClosedGroups?.(next);
  };

  const item = (entry: SidebarItem) => {
    const on = entry.href === active;
    const has = !!entry.count;
    const name = `${entry.label}${entry.soon ? ', bientôt disponible' : ''}`;
    return (
      <Link
        key={entry.href}
        to={entry.href}
        className={css.link}
        aria-current={on ? 'page' : undefined}
        data-soon={entry.soon || undefined}
        title={expanded ? undefined : name}
        aria-label={expanded ? undefined : `${name}${has ? `, ${entry.count} ${entry.countLabel ?? ''}` : ''}`}
        onClick={() => setDrawer(false)}
      >
        {on && <span aria-hidden className={css.marker} />}
        <span className={css.linkIcon}>
          <Icone icon={entry.icon} size={18} />
        </span>
        {expanded && <span className={css.linkLabel}>{entry.label}</span>}
        {expanded && entry.soon && (
          <span className={css.soon}>
            Bientôt<span className={css.hidden}> disponible</span>
          </span>
        )}
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

  const current = creditors.find((creditor) => creditor.id === creditorId) ?? creditors[0];
  return (
    <div ref={root} className={css.root}>
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
      <nav ref={trap} aria-label="Navigation principale" className={css.nav} data-open={drawer || undefined} data-collapsed={!expanded || undefined}>
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
        {current && <Switcher creditors={creditors} creditorId={creditorId} creditorsHref={creditorsHref} expanded={expanded} onCreditor={onCreditor} />}
        {/* Only the groups scroll: the head, the creditor and the footer stay in view (DECISIONS.md, 28/11/2026). */}
        <div className={css.groups}>
          {groups.map((group) => {
            const open = !expanded || !closed.includes(group.id);
            return (
              <div key={group.id} className={css.group}>
                {expanded ? (
                  <button type="button" className={css.groupLabel} aria-expanded={open} onClick={() => toggleGroup(group.id, open)}>
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
          <button type="button" className={css.collapse} aria-label={collapsed ? 'Agrandir le menu' : 'Réduire le menu'} onClick={toggleCollapsed}>
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

interface SwitcherProps {
  creditors: SidebarCreditor[];
  creditorId: string;
  creditorsHref: string;
  expanded: boolean;
  onCreditor: (id: string) => void;
}

/**
 * « Créancier actif »: a list in a popup, as a select. The arrows, Home, End and the first letters move in it; Enter
 * chooses; Escape, a click or the focus elsewhere close it, Escape giving the focus back to the button. Beyond
 * SEARCH_FROM entries, a search field leads (DECISIONS.md, 28/11/2026).
 */
function Switcher({ creditors, creditorId, creditorsHref, expanded, onCreditor }: SwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [wasExpanded, setWasExpanded] = useState(expanded);
  if (wasExpanded !== expanded) {
    setWasExpanded(expanded);
    setOpen(false);
  }
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const current = creditors.find((creditor) => creditor.id === creditorId) ?? creditors[0];
  const isAll = current?.id === 'all';
  const searchable = creditors.length > SEARCH_FROM;
  const wanted = fold(query.trim());
  const shown = wanted ? creditors.filter((creditor) => fold(`${creditor.name} ${creditor.siren ?? ''}`).includes(wanted)) : creditors;

  const options = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) button.current?.focus();
  };
  const choose = (id: string) => {
    onCreditor(id);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    // Opened, the focus goes to the search field, or to the creditor shown.
    const all = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (search.current) search.current.focus();
    else (all.find((option) => option.getAttribute('aria-selected') === 'true') ?? all[0])?.focus();
    const away = (event: PointerEvent) => {
      if (box.current?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const move = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => all[Math.max(0, Math.min(all.length - 1, index))]?.focus();
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp' && at <= 0 && search.current) search.current.focus();
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(all.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      const id = all[at]?.dataset.id;
      if (id) choose(id);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // The first letters typed lead to the next creditor whose name starts with them.
      const now = Date.now();
      const text = (now - typed.current.at < 700 ? typed.current.text : '') + fold(event.key);
      typed.current = { text, at: now };
      const from = text.length > 1 ? at : at + 1;
      const next = all.map((_, offset) => (from + offset) % all.length).find((index) => fold(all[index]?.dataset.name ?? '').startsWith(text));
      if (next !== undefined) go(next);
    } else return;
    event.preventDefault();
  };

  if (!current) return null;
  return (
    <div
      ref={box}
      className={css.switcher}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        // Only the list closes, not the drawer around it.
        event.stopPropagation();
        close(true);
      }}
      onBlur={(event) => {
        if (open && event.relatedTarget && !box.current?.contains(event.relatedTarget)) close(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className={css.switch}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={expanded ? undefined : `Créancier ${current.name}, changer de créancier`}
        title={expanded ? undefined : `Créancier : ${current.name}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
          event.preventDefault();
          setOpen(true);
        }}
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
      {open && (
        <div className={css.menu}>
          <span className={css.menuTitle}>Afficher les données de</span>
          {searchable && (
            <input
              ref={search}
              type="search"
              className={css.search}
              placeholder="Rechercher un créancier"
              aria-label="Rechercher un créancier"
              aria-controls={listId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  options()[0]?.focus();
                }
                if (event.key === 'Enter' && shown[0]) {
                  event.preventDefault();
                  choose(shown[0].id);
                }
              }}
            />
          )}
          <ul ref={list} id={listId} role="listbox" aria-label="Créanciers" className={css.options} data-long={searchable || undefined} onKeyDown={move}>
            {shown.map((creditor) => (
              <li
                key={creditor.id}
                role="option"
                aria-selected={creditor.id === creditorId}
                tabIndex={-1}
                data-id={creditor.id}
                data-name={creditor.name}
                className={css.option}
                onClick={() => choose(creditor.id)}
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
          {shown.length === 0 && (
            <p className={css.none} role="status">
              Aucun créancier ne correspond à « {query.trim()} ».
            </p>
          )}
          <Link to={creditorsHref} className={css.manage} onClick={() => close(false)}>
            <Icone icon="plus" size={16} color="var(--text-3)" />
            Ajouter ou gérer les créanciers
          </Link>
        </div>
      )}
    </div>
  );
}
