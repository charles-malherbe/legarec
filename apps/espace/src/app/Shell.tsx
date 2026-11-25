import { caseDetail, creditorDetail, hasDelegation, ROLE_LABELS, searchHit, shellData, type Notification } from '@legarec/contracts';
import { signOut } from '@legarec/platform';
import { applyDisplay } from '@legarec/tokens';
import { useIdle, SessionExpiry, Sidebar, Topbar, type SidebarGroup, type Tone } from '@legarec/ui';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { canOpen, delegationFor } from './access';
import { api } from './api';
import { useCreditorScope } from './creditorScope';
import { useApi } from './data';

import { SESSION_KEY, useCurrentUser, useUpdatePreferences } from './session';
import { AccessDenied } from '../features/error/ErrorPage';
import { IncomingCall } from '../features/calls/IncomingCall';
import css from './Shell.module.css';

const NOTIFICATION: Record<Notification['kind'], { symbol: string; tone: Tone }> = {
  PAYMENT: { symbol: '€', tone: 'success' },
  MESSAGE: { symbol: '@', tone: 'info' },
  DEADLINE: { symbol: '!', tone: 'danger' },
  CREDITOR: { symbol: 'M', tone: 'marine' },
  SYSTEM: { symbol: 'i', tone: 'neutral' },
};
const GO_TO: Record<string, string> = {
  d: '/',
  b: '/debiteurs',
  c: '/creanciers',
  e: '/echeanciers',
  r: '/relances',
  a: '/appels',
  m: '/e-mails',
  s: '/sms',
  j: '/contentieux',
  t: '/equipe',
  o: '/documents',
  p: '/parametres',
  h: '/aide',
};
const KEY_GROUPS = [
  {
    label: 'Partout',
    items: [
      { label: 'Rechercher', keys: ['/'] },
      { label: 'Rechercher (alternative)', keys: ['Ctrl', 'K'] },
      { label: 'Notifications', keys: ['Maj', 'N'] },
      { label: 'Afficher cette aide', keys: ['?'] },
      { label: 'Fermer un menu ou une fenêtre', keys: ['Échap'] },
    ],
  },
  {
    label: 'Aller à',
    items: [
      ['Tableau de bord', 'D'],
      ['Débiteurs', 'B'],
      ['Échéanciers', 'E'],
      ['Relances', 'R'],
      ['Appels', 'A'],
      ['E-mails', 'M'],
      ['SMS', 'S'],
      ['Contentieux', 'J'],
      ['Équipe', 'T'],
      ['Paramètres', 'P'],
    ].map(([label, key]) => ({ label: label ?? '', keys: ['G', key ?? ''] })),
  },
  {
    label: 'Dans une page',
    items: [
      { label: 'Action principale (bouton bleu)', keys: ['N'] },
      { label: 'Rechercher dans la liste', keys: ['F'] },
      { label: 'Choisir l’onglet 1 à 9', keys: ['1…9'] },
      { label: 'Valider une fenêtre de confirmation', keys: ['Entrée'] },
    ],
  },
  {
    label: 'Téléphone',
    items: [
      { label: 'Décrocher un appel entrant', keys: ['D'] },
      { label: 'Refuser un appel entrant', keys: ['X'] },
      { label: 'Couper / réactiver le micro', keys: ['M'] },
      { label: 'Raccrocher', keys: ['H'] },
      { label: 'Qualifier : choisir un résultat', keys: ['1…8'] },
      { label: 'Enregistrer la qualification', keys: ['Ctrl', 'Entrée'] },
    ],
  },
];
const CREATE = [
  { label: 'Débiteur', href: '/debiteurs', icon: 'users', key: 'D' },
  { label: 'Créancier', href: '/creanciers', icon: 'building', key: 'M' },
  { label: 'Relance planifiée', href: '/relances', icon: 'agenda', key: 'R' },
  { label: 'Courrier', href: '/documents/rediger', icon: 'newdoc', key: 'C' },
  { label: 'Échéancier', href: '/echeanciers', icon: 'plan', key: 'E' },
  { label: 'Import de factures', href: '/creanciers/demo', icon: 'upload', key: 'I' },
] as const;
const PAGES: [string, string][] = [
  ['/', 'Tableau de bord'],
  ['/debiteurs', 'Débiteurs'],
  ['/relances', 'Relances'],
  ['/echeanciers', 'Échéanciers'],
  ['/contentieux', 'Contentieux'],
  ['/facturation', 'Facturation'],
  ['/equipe', 'Équipe'],
  ['/rapports', 'Rapports'],
  ['/appels', 'Appels'],
  ['/e-mails', 'E-mails'],
  ['/sms', 'SMS'],
  ['/documents', 'Tous les documents'],
  ['/documents/rediger', 'Rédiger un courrier'],
  ['/aide', 'Centre d’aide'],
  ['/parametres', 'Paramètres du cabinet'],
  ['/compte', 'Mon compte'],
];
const GROUP_LABEL = { DEBTOR: 'Débiteurs', CREDITOR: 'Créanciers', INVOICE: 'Factures' } as const;
const TRAILS: [string, { label: string; href?: string }[]][] = [
  ['/rapports', [{ label: 'Pilotage' }, { label: 'Rapports' }]],
  ['/notifications', [{ label: 'Pilotage' }, { label: 'Notifications' }]],
  ['/equipe', [{ label: 'Pilotage' }, { label: 'Équipe' }]],
  ['/facturation', [{ label: 'Pilotage' }, { label: 'Facturation' }]],
  ['/creanciers/', [{ label: 'Portefeuille' }, { label: 'Créanciers', href: '/creanciers' }, { label: 'Fiche créancier' }]],
  ['/creanciers', [{ label: 'Portefeuille' }, { label: 'Créanciers' }]],
  ['/debiteurs/', [{ label: 'Portefeuille' }, { label: 'Débiteurs', href: '/debiteurs' }, { label: 'Fiche débiteur' }]],
  ['/debiteurs', [{ label: 'Portefeuille' }, { label: 'Débiteurs' }]],
  ['/relances', [{ label: 'Recouvrement' }, { label: 'Relances' }]],
  ['/echeanciers', [{ label: 'Recouvrement' }, { label: 'Échéanciers' }]],
  ['/contentieux', [{ label: 'Recouvrement' }, { label: 'Contentieux' }]],
  ['/appels', [{ label: 'Communication' }, { label: 'Appels' }]],
  ['/e-mails', [{ label: 'Communication' }, { label: 'E-mails' }]],
  ['/sms', [{ label: 'Communication' }, { label: 'SMS' }]],
  ['/documents/rediger', [{ label: 'Documents' }, { label: 'Rédiger un courrier' }]],
  ['/documents', [{ label: 'Documents' }, { label: 'Tous les documents' }]],
  ['/parametres/techniques/', [{ label: 'Paramètres techniques', href: '/parametres/techniques' }, { label: 'Détail' }]],
  ['/parametres/techniques', [{ label: 'Paramètres techniques' }]],
  ['/parametres/modeles/', [{ label: 'Paramètres', href: '/parametres' }, { label: 'Modèles de documents', href: '/parametres/modeles' }, { label: 'Modèle' }]],
  ['/parametres/', [{ label: 'Paramètres', href: '/parametres' }, { label: 'Détail' }]],
  ['/parametres', [{ label: 'Paramètres' }]],
  ['/compte', [{ label: 'Compte' }, { label: 'Mon compte' }]],
  ['/aide/', [{ label: 'Aide', href: '/aide' }, { label: 'Article' }]],
  ['/aide', [{ label: 'Aide' }, { label: 'Centre d’aide' }]],
  ['/', [{ label: 'Pilotage' }, { label: 'Tableau de bord' }]],
];

function useOnline() {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener('online', notify);
      window.addEventListener('offline', notify);
      return () => {
        window.removeEventListener('online', notify);
        window.removeEventListener('offline', notify);
      };
    },
    () => navigator.onLine,
  );
}

export function Shell() {
  const user = useCurrentUser();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const scope = useCreditorScope();
  const updatePreferences = useUpdatePreferences();
  const online = useOnline();
  const [presence, setPresence] = useState<'dispo' | 'pause' | 'absent'>('dispo');
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query.trim(), 200);
  const { data: shell } = useQuery({ queryKey: ['shell'], queryFn: () => api(shellData, '/shell') });
  const { data: hits = [] } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api(z.array(searchHit), '/search', { method: 'POST', body: { query: debounced } }),
    enabled: debounced.length > 0,
  });

  useEffect(() => applyDisplay(user.preferences.theme, user.preferences.lowVision), [user.preferences]);

  const logout = useCallback(async () => {
    // Whatever the API answers, nothing must stay on screen nor in the cache.
    await signOut();
    client.clear();
    client.setQueryData(SESSION_KEY, null);
    await navigate('/connexion');
  }, [client, navigate]);
  const idle = useIdle(
    useCallback(() => void logout(), [logout]),
    // A closed session comes back as nobody: the sign-in page opens.
    useCallback(() => void client.refetchQueries({ queryKey: SESSION_KEY }), [client]),
  );
  const goTo = useCallback(
    (letter: string) => {
      const target = GO_TO[letter];
      if (target) void navigate(target);
      return !!target;
    },
    [navigate],
  );
  const read = async (ids: string[]) => {
    await api(z.undefined(), '/notifications/read', { method: 'POST', body: { ids } });
    await client.invalidateQueries({ queryKey: ['shell'] });
  };

  const counts = shell?.counts;
  const groups: SidebarGroup[] = [
    {
      id: 'pil',
      label: 'Pilotage',
      items: [
        { href: '/', label: 'Tableau de bord', icon: 'home' },
        { href: '/rapports', label: 'Rapports', icon: 'chart' },
        { href: '/equipe', label: 'Équipe', icon: 'team', count: counts?.teamOnline, countTone: 'muted', countLabel: 'gestionnaires en ligne' },
        { href: '/facturation', label: 'Facturation', icon: 'invoice' },
      ],
    },
    {
      id: 'por',
      label: 'Portefeuille',
      items: [
        { href: '/creanciers', label: 'Créanciers', icon: 'building' },
        { href: '/debiteurs', label: 'Débiteurs', icon: 'users' },
      ],
    },
    {
      id: 'rec',
      label: 'Recouvrement',
      items: [
        { href: '/relances', label: 'Relances', icon: 'agenda', count: counts?.remindersToday, countTone: 'navy', countLabel: 'relances aujourd’hui' },
        { href: '/echeanciers', label: 'Échéanciers', icon: 'plan' },
        { href: '/contentieux', label: 'Contentieux', icon: 'scale', count: counts?.litigationUrgent, countTone: 'rose', countLabel: 'délais urgents' },
      ],
    },
    {
      id: 'com',
      label: 'Communication',
      items: [
        { href: '/appels', label: 'Appels', icon: 'phone', count: counts?.callQueue, countTone: 'muted', countLabel: 'appels en file' },
        { href: '/e-mails', label: 'E-mails', icon: 'mail', count: counts?.unreadEmails, countTone: 'yellow', countLabel: 'e-mails non lus' },
        { href: '/sms', label: 'SMS', icon: 'sms', count: counts?.unreadSms, countTone: 'yellow', countLabel: 'SMS non lus' },
      ],
    },
    {
      id: 'doc',
      label: 'Documents',
      items: [
        { href: '/documents', label: 'Tous les documents', icon: 'file' },
        { href: '/documents/rediger', label: 'Rédiger un courrier', icon: 'newdoc' },
      ],
    },
  ];
  const items = groups.flatMap((group) => group.items.map((item) => item.href));
  const active =
    [...items, '/parametres'].filter((href) => href === pathname || (href !== '/' && pathname.startsWith(`${href}/`))).sort((a, b) => b.length - a.length)[0] ??
    '';
  const trail = TRAILS.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))?.[1] ?? [
    { label: 'Legarec' },
  ];
  // Breadcrumb of a file, read from the same answer as the page.
  const caseId = /^\/debiteurs\/([^/]+)$/.exec(pathname)?.[1];
  const { data: openCase } = useApi(caseDetail, `/cases/${caseId}`, { enabled: !!caseId && user.role !== 'DEVELOPER' });
  const creditorId = /^\/creanciers\/([^/]+)$/.exec(pathname)?.[1];
  const { data: openCreditor } = useApi(creditorDetail, `/creditors/${creditorId}`, { enabled: !!creditorId && user.role !== 'DEVELOPER' });
  const steps =
    creditorId && openCreditor
      ? [{ label: 'Portefeuille' }, { label: 'Créanciers', href: '/creanciers' }, { label: openCreditor.name }]
      : caseId && openCase
        ? [{ label: 'Créanciers', href: '/creanciers' }, { label: openCase.creditor, href: `/creanciers/${openCase.creditorId}` }, { label: openCase.name }]
        : trail;
  const acting = delegationFor(pathname, user);
  const pageHits = PAGES.filter(([href, label]) => canOpen(href, user) && label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 4);

  return (
    <div className={css.root} data-density={user.preferences.density}>
      <a href="#contenu" className={css.skip}>
        Aller au contenu
      </a>
      <Sidebar
        active={active}
        groups={groups}
        footer={[{ href: '/parametres', label: 'Paramètres', icon: 'settings' }]}
        creditors={shell?.creditors ?? []}
        creditorId={scope.id}
        creditorsHref="/creanciers"
        onCreditor={scope.setId}
      />
      <div className={css.main}>
        <Topbar
          trail={steps}
          account={{ name: `${user.firstName} ${user.lastName}`, email: user.email, roleLabel: ROLE_LABELS[user.role], extension: user.extension }}
          presence={{ value: presence, onChange: setPresence }}
          search={{
            query,
            onQuery: setQuery,
            onOpen: (hit) => void navigate(hit.href),
            hits: [
              ...(debounced ? hits.map((hit) => ({ ...hit, group: GROUP_LABEL[hit.kind] })) : []),
              ...pageHits.map(([href, label]) => ({
                id: `page:${href}`,
                group: query ? 'Pages' : 'Accès rapide',
                title: label,
                sub: 'Page',
                href,
                initials: '→',
              })),
            ],
          }}
          createItems={[...CREATE]}
          notifications={{
            href: '/notifications',
            preferencesHref: '/compte',
            items: (shell?.notifications ?? []).map((item) => ({ ...item, ...NOTIFICATION[item.kind] })),
            onRead: (id) => void read([id]),
            onReadAll: () => void read((shell?.notifications ?? []).map((item) => item.id)),
          }}
          accountLinks={[
            { label: 'Mon profil', href: '/compte', icon: 'user' },
            { label: 'Sécurité et connexion', href: '/compte', icon: 'shield', hint: '2FA' },
            { label: 'Préférences de notification', href: '/compte', icon: 'bell' },
            { label: 'Paramètres du cabinet', href: '/parametres', icon: 'settings' },
          ]}
          display={{
            theme: user.preferences.theme,
            onTheme: (theme) => void updatePreferences({ theme }),
            lowVision: user.preferences.lowVision,
            onLowVision: (lowVision) => void updatePreferences({ lowVision }),
          }}
          delegation={
            acting && (hasDelegation(user, 'TECHNICAL') || hasDelegation(user, 'ADMINISTRATIVE'))
              ? { directorName: user.directorName, kinds: acting }
              : undefined
          }
          offline={!online}
          onRetry={() => void client.refetchQueries()}
          helpHref="/aide"
          keyGroups={KEY_GROUPS}
          onGoTo={goTo}
          onLogout={() => void logout()}
        />
        <main id="contenu" className={css.page} tabIndex={-1}>
          {/* The technical settings show their own refusal, with the wording of the mockup. */}
          {canOpen(pathname, user) || pathname.startsWith('/parametres/techniques') ? <Outlet /> : <AccessDenied />}
        </main>
      </div>
      <IncomingCall />
      {idle.warning && <SessionExpiry secondsLeft={idle.secondsLeft} onStay={idle.stay} onLogout={() => void logout()} />}
    </div>
  );
}
