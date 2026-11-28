import { FocusTrap, Modal, Portal } from '@mantine/core';
import { Command } from 'cmdk';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Avatar, type AvatarProps } from './Avatar';
import { Badge } from './Badge';
import { Bouton } from './Bouton';
import { Icone } from './Icone';
import type { IconName } from './icons';
import { isShortcutBlocked } from './shortcuts';
import css from './Topbar.module.css';
import type { Tone } from './types';

export interface SearchHit {
  id: string;
  group: string;
  title: string;
  sub: string;
  href: string;
  initials: string;
}
export interface TopbarNotification {
  id: string;
  text: string;
  meta: string;
  href: string;
  symbol: string;
  tone: Tone;
  unread: boolean;
}
export interface TopbarProps {
  trail: { label: string; href?: string }[];
  account: { name: string; email: string; roleLabel: string; extension: string | null; twoFactorHint?: string };
  presence: { value: 'dispo' | 'pause' | 'absent'; onChange: (value: 'dispo' | 'pause' | 'absent') => void };
  search: { hits: SearchHit[]; query: string; onQuery: (value: string) => void; onOpen: (hit: SearchHit) => void };
  /** `soon`: a page not finished yet, greyed with « Bientôt », still offered (DECISIONS.md, 28/11/2026). */
  createItems: { label: string; href: string; icon: IconName; key: string; soon?: boolean }[];
  notifications: { items: TopbarNotification[]; onRead: (id: string) => void; onReadAll: () => void; href: string; preferencesHref: string };
  accountLinks: { label: string; href: string; icon: IconName; hint?: string }[];
  /** The low-vision mode has one switch, « Aa » beside the search, at every width (DECISIONS.md, 28/11/2026). */
  display: {
    theme: 'light' | 'dark' | 'system';
    onTheme: (theme: 'light' | 'dark' | 'system') => void;
    lowVision: boolean;
    onLowVision: (next: boolean) => void;
  };
  /** Director's name while acting under delegation. */
  delegation?: { directorName: string; kinds: string };
  offline?: boolean;
  onRetry?: () => void;
  helpHref: string;
  keyGroups: { label: string; items: { label: string; keys: string[] }[] }[];
  onGoTo: (letter: string) => boolean;
  onLogout: () => void;
}
const PRESENCE = {
  dispo: ['Disponible', 'Reçoit les appels de la file'],
  pause: ['En pause', 'Appels mis en attente'],
  absent: ['Absent', 'Appels renvoyés au remplaçant'],
} as const;
const AVATAR_PRESENCE: Record<keyof typeof PRESENCE, AvatarProps['presence']> = { dispo: 'dispo', pause: 'pause', absent: 'off' };
const THEMES = { light: 'Clair', dark: 'Sombre', system: 'Système' } as const;
type Panel = 'create' | 'notif' | 'account' | null;

export function Topbar(props: TopbarProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [searching, setSearching] = useState(false);
  const [keys, setKeys] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountPanel = useRef<HTMLElement>(null);
  const goAt = useRef(0);
  const { account, presence, display, notifications, search } = props;
  const unread = notifications.items.filter((item) => item.unread).length;
  const toggle = (next: Panel) => () => setPanel(panel === next ? null : next);
  const close = () => setPanel(null);
  const initials = account.name
    .split(' ')
    .map((part) => part[0])
    .join('');

  // Opened, the menu of the account takes the focus on its first entry; closed by Échap, it gives it back to the avatar.
  useEffect(() => {
    if (panel !== 'account') return;
    accountPanel.current?.querySelector<HTMLElement>('button, a')?.focus();
  }, [panel]);
  /** Up and down go from an entry to the next, Home and End to the first and the last; Échap closes. */
  const moveInAccount = (event: ReactKeyboardEvent<HTMLElement>) => {
    const entries = [...(accountPanel.current?.querySelectorAll<HTMLElement>('button, a') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % entries.length
        : event.key === 'ArrowUp'
          ? (at - 1 + entries.length) % entries.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? entries.length - 1
              : null;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      accountButton.current?.focus();
      return;
    }
    if (next === null || entries.length === 0) return;
    event.preventDefault();
    entries[next]!.focus();
  };

  useEffect(() => {
    if (!panel) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [panel]);

  const { onGoTo } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        setSearching(true);
        return;
      }
      if (event.key === 'Escape') {
        setPanel(null);
        return;
      }
      if (isShortcutBlocked(event)) return;
      if (event.key === '?') {
        event.preventDefault();
        setPanel(null);
        setKeys(true);
      } else if (event.key === '/') {
        event.preventDefault();
        setSearching(true);
      } else if (Date.now() - goAt.current < 1200 && onGoTo(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        goAt.current = 0;
      } else if (key === 'g') {
        event.preventDefault();
        goAt.current = Date.now();
      } else if (key === 'n' && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPanel((current) => (current === 'notif' ? null : 'notif'));
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onGoTo]);

  const groups = [...new Set(search.hits.map((hit) => hit.group))];
  return (
    <div ref={root} className={css.wrap}>
      <header className={css.root}>
        <nav aria-label="Fil d'Ariane" className={css.crumbs}>
          <ol>
            {props.trail.map((step, index) => {
              const last = index === props.trail.length - 1;
              return (
                <li key={step.label} data-last={last || undefined}>
                  {index > 0 && <Icone icon="chevron-right" size={14} color="var(--text-3)" />}
                  {!last && step.href ? <Link to={step.href}>{step.label}</Link> : <span aria-current={last ? 'page' : undefined}>{step.label}</span>}
                </li>
              );
            })}
          </ol>
        </nav>
        <button
          type="button"
          className={css.iconButton}
          aria-pressed={display.lowVision}
          aria-label="Mode malvoyant"
          title="Mode malvoyant : texte agrandi, contraste renforcé"
          onClick={() => display.onLowVision(!display.lowVision)}
        >
          <span aria-hidden className={css.aa}>
            Aa
          </span>
        </button>
        <div role="search" className={css.searchBox}>
          <button
            type="button"
            className={css.search}
            aria-haspopup="dialog"
            aria-label="Débiteur, SIRET, SIREN, facture… Rechercher dans Legarec"
            onClick={() => setSearching(true)}
          >
            <Icone icon="search" size={16} />
            <span className={css.searchText}>Débiteur, SIRET, SIREN, facture…</span>
            <kbd aria-hidden className={css.searchKbd} />
          </button>
        </div>
        <div className={css.tools}>
          <div className={css.anchor}>
            <button type="button" className={css.create} aria-expanded={panel === 'create'} aria-label="Créer" onClick={toggle('create')}>
              <Icone icon="plus" size={16} />
              <span className={css.createText}>Créer</span>
            </button>
            {panel === 'create' && (
              <nav aria-label="Créer" className={css.panel} data-width="create">
                <span className={css.panelTitle}>Créer</span>
                {props.createItems.map((item) => (
                  <Link key={item.label} to={item.href} className={css.entry} data-soon={item.soon || undefined} onClick={close}>
                    <Icone icon={item.icon} size={16} color="var(--text-3)" />
                    <span className={css.grow}>{item.label}</span>
                    {item.soon && (
                      <span className={css.soon}>
                        Bientôt<span className={css.hidden}> disponible</span>
                      </span>
                    )}
                    <span className={css.hint}>{item.key}</span>
                  </Link>
                ))}
              </nav>
            )}
          </div>
          <span aria-hidden className={css.divider} />
          <Link to={props.helpHref} className={`${css.iconButton} ${css.help}`} aria-label="Centre d'aide" title="Centre d'aide">
            <Icone icon="help" size={18} />
          </Link>
          <div className={css.anchor}>
            <button
              type="button"
              className={css.iconButton}
              aria-expanded={panel === 'notif'}
              aria-label={`Notifications, ${unread} non lues`}
              onClick={toggle('notif')}
            >
              <Icone icon="bell" size={18} />
              {unread > 0 && (
                <span aria-hidden className={css.unread}>
                  {unread}
                </span>
              )}
            </button>
            {panel === 'notif' && (
              <section aria-label="Notifications" className={css.panel} data-width="notif">
                <div className={css.notifHead}>
                  <span className={css.strong}>Notifications</span>
                  <Bouton variant="link" size="sm" label="Tout marquer comme lu" onPress={notifications.onReadAll} />
                </div>
                <div role="group" aria-label="Filtrer" className={css.notifTabs}>
                  <button type="button" aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>
                    Toutes
                  </button>
                  <button type="button" aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>
                    Non lues ({unread})
                  </button>
                </div>
                <ul className={css.notifs}>
                  {notifications.items
                    .filter((item) => !onlyUnread || item.unread)
                    .map((item) => (
                      <li key={item.id}>
                        <Link
                          to={item.href}
                          className={css.notif}
                          data-unread={item.unread || undefined}
                          onClick={() => {
                            notifications.onRead(item.id);
                            close();
                          }}
                        >
                          <Avatar initials={item.symbol} title="" size={32} tone={item.tone} />
                          <span className={css.grow}>
                            <span className={css.notifText}>{item.text}</span>
                            <span className={css.hint}>{item.meta}</span>
                          </span>
                          {item.unread && (
                            <span className={css.notifDot}>
                              <span className={css.hidden}>Non lue</span>
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                </ul>
                <div className={css.notifFoot}>
                  <Link to={notifications.href} onClick={close}>
                    Toutes les notifications
                  </Link>
                  <Link to={notifications.preferencesHref} onClick={close}>
                    Préférences
                  </Link>
                </div>
              </section>
            )}
          </div>
          <div className={css.anchor}>
            <button
              ref={accountButton}
              type="button"
              className={css.account}
              aria-haspopup="true"
              aria-expanded={panel === 'account'}
              aria-label={`Compte de ${account.name}, statut ${PRESENCE[presence.value][0]}`}
              onClick={toggle('account')}
            >
              <span aria-hidden className={css.initials} data-presence={AVATAR_PRESENCE[presence.value]} data-initials={initials} />
            </button>
            {panel === 'account' && (
              <section ref={accountPanel} aria-label="Compte" className={css.panel} data-width="account" onKeyDown={moveInAccount}>
                <div className={css.identity}>
                  <span aria-hidden className={css.initials} data-size="lg" data-presence={AVATAR_PRESENCE[presence.value]} data-initials={initials} />
                  <span className={css.grow}>
                    <span className={css.strong}>{account.name}</span>
                    <span className={css.hint} data-ellipsis title={account.email}>
                      {account.email}
                    </span>
                    <Badge label={account.roleLabel} tone="marine" layout={{ alignSelf: 'flex-start', marginTop: 'var(--sp-1h)' }} />
                  </span>
                </div>
                {/* The status of 3CX is that of a telephone extension: without one, it says nothing. */}
                {account.extension && (
                  <div role="radiogroup" aria-label="Statut téléphonique" className={css.section}>
                    <span className={css.panelTitle}>Statut 3CX · poste {account.extension}</span>
                    {(Object.keys(PRESENCE) as (keyof typeof PRESENCE)[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={presence.value === value}
                        className={css.entry}
                        onClick={() => {
                          presence.onChange(value);
                          close();
                        }}
                      >
                        <span aria-hidden className={css.presence} data-value={value} />
                        <span className={css.grow}>
                          <span>{PRESENCE[value][0]}</span>
                          <span className={css.hint}>{PRESENCE[value][1]}</span>
                        </span>
                        {presence.value === value && <Icone icon="check" size={16} stroke={2.5} color="var(--marine-text)" />}
                      </button>
                    ))}
                  </div>
                )}
                <nav aria-label="Mon compte" className={css.section}>
                  {props.accountLinks.map((link) => (
                    <Link key={link.label} to={link.href} className={css.entry} onClick={close}>
                      <Icone icon={link.icon} size={16} color="var(--text-3)" />
                      <span className={css.grow}>{link.label}</span>
                      {link.hint && <span className={css.hint}>{link.hint}</span>}
                    </Link>
                  ))}
                </nav>
                <div className={css.section}>
                  <span className={css.panelTitle}>Affichage</span>
                  <div role="radiogroup" aria-label="Thème" className={css.themes}>
                    {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map((theme) => (
                      <button key={theme} type="button" role="radio" aria-checked={display.theme === theme} onClick={() => display.onTheme(theme)}>
                        {THEMES[theme]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={css.section}>
                  <button
                    type="button"
                    className={css.entry}
                    onClick={() => {
                      close();
                      setKeys(true);
                    }}
                  >
                    <Icone icon="list" size={16} color="var(--text-3)" />
                    <span className={css.grow}>Raccourcis clavier</span>
                    <kbd className={css.kbd}>?</kbd>
                  </button>
                </div>
                <div className={css.section}>
                  <button type="button" className={css.entry} data-danger onClick={props.onLogout}>
                    <Icone icon="logout" size={16} />
                    Se déconnecter
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </header>
      {props.delegation && (
        <div role="status" className={css.delegation}>
          <Icone icon="users" size={16} />
          <strong>Pour le compte du Directeur</strong>
          <span>
            {props.delegation.directorName} · délégation {props.delegation.kinds}. Vos deux noms sont notés dans l’historique.
          </span>
        </div>
      )}
      {props.offline && (
        <div role="status" className={css.offline}>
          <strong>Connexion perdue.</strong>
          <span>
            Vos saisies sont gardées sur cet ordinateur et seront envoyées dès le retour du réseau. Les appels 3CX restent possibles depuis le téléphone.
          </span>
          <Bouton label="Réessayer" icon="refresh" variant="secondary" size="xs" onPress={props.onRetry} layout={{ marginLeft: 'auto' }} />
        </div>
      )}

      {searching && (
        <Modal
          opened
          onClose={() => setSearching(false)}
          withCloseButton={false}
          title={undefined}
          padding={0}
          size={560}
          yOffset="12vh"
          zIndex={420}
          classNames={{ content: css.searchModal }}
          transitionProps={{ duration: 0 }}
        >
          <Command shouldFilter={false} label="Rechercher dans Legarec" className={css.command}>
            <div className={css.commandHead}>
              <Icone icon="search" size={16} />
              <Command.Input
                value={search.query}
                onValueChange={search.onQuery}
                placeholder="Débiteur, SIRET, SIREN, facture…"
                className={css.commandInput}
                data-autofocus
              />
            </div>
            <Command.List className={css.commandList} label="Résultats">
              <Command.Empty className={css.commandEmpty}>Aucun résultat pour « {search.query} ».</Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group} heading={group} className={css.commandGroup}>
                  {search.hits
                    .filter((hit) => hit.group === group)
                    .map((hit) => (
                      <Command.Item
                        key={hit.id}
                        value={hit.id}
                        className={css.commandItem}
                        onSelect={() => {
                          setSearching(false);
                          search.onQuery('');
                          search.onOpen(hit);
                        }}
                      >
                        <span aria-hidden className={css.hitBadge}>
                          {hit.initials}
                        </span>
                        <span className={css.grow}>
                          <span>{hit.title}</span>
                          <span className={css.hint}>{hit.sub}</span>
                        </span>
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className={css.commandFoot}>
              <span>
                <kbd className={css.kbd}>Entrée</kbd> ouvrir
              </span>
              <span>
                <kbd className={css.kbd}>Échap</kbd> fermer
              </span>
            </div>
          </Command>
        </Modal>
      )}
      {keys && <KeysDialog groups={props.keyGroups} onClose={() => setKeys(false)} />}
    </div>
  );
}

function KeysDialog({ groups, onClose }: { groups: TopbarProps['keyGroups']; onClose: () => void }) {
  return (
    <Dialog label="Raccourcis clavier" onClose={onClose} wide>
      <div className={css.keysHead}>
        <div>
          <h2 className={css.dialogTitle}>Raccourcis clavier</h2>
          <span className={css.hint}>Inactifs pendant la saisie dans un champ</span>
        </div>
        <Bouton label="Fermer" icon="x" iconOnly variant="ghost" size="sm" onPress={onClose} />
      </div>
      <div className={css.keys}>
        {groups.map((group) => (
          <section key={group.label}>
            <h3>{group.label}</h3>
            {group.items.map((item) => (
              <div key={item.label} className={css.keyRow}>
                <span>{item.label}</span>
                <span className={css.keyCaps}>
                  {item.keys.map((key) => (
                    <kbd key={key} className={css.kbd}>
                      {key}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}

function Dialog({
  label,
  role = 'dialog',
  wide,
  onClose,
  children,
}: {
  label: string;
  role?: 'dialog' | 'alertdialog';
  wide?: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => void setTimeout(() => opener?.focus?.(), 0), [opener]);
  return (
    <Portal>
      <div
        role="presentation"
        data-modal-open="true"
        className={css.overlay}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        <FocusTrap active>
          <div
            role={role}
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className={css.dialog}
            data-wide={wide || undefined}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && onClose) {
                event.stopPropagation();
                onClose();
              }
            }}
          >
            {children}
          </div>
        </FocusTrap>
      </div>
    </Portal>
  );
}

/** Warning shown after 28 minutes without activity; logout at 30 minutes. */
export function SessionExpiry({ secondsLeft, onStay, onLogout }: { secondsLeft: number; onStay: () => void; onLogout: () => void }) {
  const left = `${Math.floor(secondsLeft / 60)} min ${String(secondsLeft % 60).padStart(2, '0')} s`;
  return (
    <Dialog label="Votre session va expirer" role="alertdialog">
      <div className={css.expiry}>
        <h2 className={css.dialogTitle}>Votre session va expirer</h2>
        <p>
          Sans activité, vous serez déconnecté dans <strong>{left}</strong>. Les fiches en cours de saisie sont conservées en brouillon.
        </p>
        <div className={css.expiryActions}>
          <Bouton variant="secondary" size="lg" label="Se déconnecter" onPress={onLogout} />
          <Bouton size="lg" label="Rester connecté" autoFocus onPress={onStay} />
        </div>
      </div>
    </Dialog>
  );
}
