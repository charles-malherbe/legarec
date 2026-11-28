import '@testing-library/jest-dom/vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import contract from '../../../../packages/contracts/openapi.json?raw';
import { axeViolations } from '../../../../packages/ui/src/testing';
import { callState, resetCalls } from '../mocks/routes/calls';
import { mockApi, openAs } from '../testing';
import { FEATURES, pending, ready, SOON, soonAt, unknownFeatures, type Feature } from './features';

const server = mockApi();
// cmdk brings the active result into view: jsdom lays nothing out.
Element.prototype.scrollIntoView = vi.fn();
beforeEach(() => resetCalls());
afterEach(() => {
  vi.unstubAllEnvs();
  server.events.removeAllListeners();
});

/** A build where no part still without its API is ready: the production build, as long as `VITE_FEATURES` names none. */
const withoutApi = () => vi.stubEnv('VITE_FEATURES', '');
/** Development, which simulates them all. */
const simulated = () => vi.stubEnv('VITE_FEATURES', undefined);

const SCREENS = ['/appels', '/e-mails', '/sms', '/documents/rediger', '/parametres/techniques/boites'];
/** The entries of the menu of these parts. */
const WAITING = ['/appels', '/e-mails', '/sms', '/documents/rediger'];
const MENU = [
  '/',
  '/rapports',
  '/equipe',
  '/facturation',
  '/creanciers',
  '/debiteurs',
  '/relances',
  '/echeanciers',
  '/contentieux',
  '/appels',
  '/e-mails',
  '/sms',
  '/documents',
  '/documents/rediger',
];

/** The routes the API answers, as its contract describes them. */
const paths = (JSON.parse(contract) as { paths: Record<string, object> }).paths;
const CONTRACT = Object.entries(paths).flatMap(([path, operations]) =>
  Object.keys(operations).map((method) => ({ method: method.toUpperCase(), path: new RegExp(`^${path.replace(/\{[^}]+\}/gu, '[^/]+')}$`, 'u') })),
);
/** What the screens ask of the API, as the API names it (`/api` of the portal is `/staff` there). */
function requests() {
  const seen: string[] = [];
  server.events.on('request:start', ({ request }) => {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) seen.push(`${request.method} ${pathname.replace(/^\/api/u, '/staff')}`);
  });
  return seen;
}
/** Those the API does not answer: each one would leave a screen in error. */
const unanswered = (seen: string[]) =>
  seen.filter((line) => {
    const [method, path = ''] = line.split(' ');
    return !CONTRACT.some((route) => route.method === method && route.path.test(path));
  });

/** The entries of the menu in their order: neither the logo above them nor « Paramètres » at its foot. */
const menu = async () => {
  const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
  await within(nav).findByRole('link', { name: /Débiteurs/ });
  return within(nav)
    .getAllByRole('link')
    .slice(1)
    .map((link) => link.getAttribute('href'))
    .filter((href) => href !== '/parametres');
};

/** What a greyed button or link says, to a screen reader and when it is pressed. */
const says = (feature: Feature) => `Bientôt disponible : ${SOON[feature]}`;
/** The message shown when a greyed button is pressed. */
const toast = (text: string) => screen.findByText(text, { selector: '[role="status"] span' });
const soonLinks = (nav: HTMLElement) => [...nav.querySelectorAll('a[data-soon]')].map((link) => link.getAttribute('href'));

describe('setting', () => {
  it('has every part ready in development, none in a production build', () => {
    simulated();
    expect(FEATURES.filter((feature) => ready(feature))).toEqual([...FEATURES]);
    expect(SCREENS.filter((screen) => pending(screen))).toEqual([]);
    vi.stubEnv('DEV', false);
    expect(FEATURES.filter((feature) => ready(feature))).toEqual([]);
    expect(SCREENS.filter((screen) => pending(screen))).toEqual(SCREENS);
  });
  it('makes ready the parts it names, and only them, in production as in development', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FEATURES', ' calls, letters ');
    expect(FEATURES.filter((feature) => ready(feature))).toEqual(['calls', 'letters']);
    expect(SCREENS.filter((screen) => pending(screen))).toEqual(['/e-mails', '/sms', '/parametres/techniques/boites']);
    vi.stubEnv('DEV', true);
    withoutApi();
    expect(FEATURES.filter((feature) => ready(feature))).toEqual([]);
  });
  it('finds the part of a screen with what follows its address, and nothing else', () => {
    withoutApi();
    expect(['/appels/demo', '/e-mails?to=x', '/sms#fil', '/documents/rediger?dossier=demo', '/parametres/techniques/boites/b1'].map(pending)).toEqual([
      'calls',
      'emails',
      'sms',
      'letters',
      'mailboxes',
    ]);
    expect(['/', '/documents', '/appelsx', '/parametres/techniques', '/parametres/techniques/secrets', '/aide'].map(pending)).toEqual(Array(6).fill(undefined));
    expect(soonAt('/appels')).toBe(SOON.calls);
    simulated();
    expect(soonAt('/appels')).toBeUndefined();
  });
  it('names the parts the build does not know, so that it stops', () => {
    expect(unknownFeatures('calls, phone,,emails, SMS')).toEqual(['phone', 'SMS']);
    expect(unknownFeatures()).toEqual([]);
  });
});

describe('without the API of these parts', () => {
  it('keeps the whole menu in its validated order, their entries greyed with « Bientôt », without counters', async () => {
    withoutApi();
    const { container } = openAs('cl', '/');
    expect(await menu()).toEqual(MENU);
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(soonLinks(nav)).toEqual(WAITING);
    expect(within(nav).getByRole('link', { name: /^Appels.*Bientôt.*disponible/ })).toHaveAttribute('href', '/appels');
    expect(within(nav).getByRole('button', { name: 'Communication' })).toBeVisible();
    expect(nav).not.toHaveTextContent(/appels en file|e-mails non lus|SMS non lus/);
    expect(await screen.findByRole('heading', { name: 'Bonjour Camille' })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });
  it.each([
    ['cl', '/appels', 'Appels'],
    ['cl', '/e-mails', 'E-mails'],
    ['cl', '/sms', 'SMS'],
    ['cl', '/documents/rediger?dossier=demo', 'Rédiger un courrier'],
    ['dev', '/parametres/techniques/boites', /Boîtes e-mail/],
  ])('opens for %s %s on « Bientôt disponible », never on a screen in error', async (account, path, title) => {
    withoutApi();
    const seen = requests();
    const { container } = openAs(account, path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeVisible();
    expect(await screen.findByText('Bientôt disponible')).toBeVisible();
    expect(unanswered(seen)).toEqual([]);
    expect(await axeViolations(container)).toEqual([]);
  });
  it('leads their shortcuts to their page, and lists them as to come', async () => {
    withoutApi();
    openAs('cl', '/');
    await screen.findByRole('heading', { name: 'Bonjour Camille' });
    for (const [key, page] of [
      ['a', 'Appels'],
      ['m', 'E-mails'],
      ['s', 'SMS'],
    ]) {
      await userEvent.keyboard(`g${key}`);
      expect(await screen.findByRole('heading', { level: 1, name: page })).toBeVisible();
      expect(screen.getByText('Bientôt disponible')).toBeVisible();
    }
    await userEvent.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    const goTo = within(dialog).getByRole('heading', { name: 'Aller à' }).closest('section');
    expect(goTo).toHaveTextContent('Débiteurs');
    expect(goTo).toHaveTextContent(/Appels \(bientôt\).*E-mails \(bientôt\).*SMS \(bientôt\)/);
    expect(within(dialog).queryByRole('heading', { name: 'Téléphone' })).toBeNull();
  });
  it('offers their pages in the search, and the letter in « Créer », marked as to come', async () => {
    withoutApi();
    openAs('cl', '/');
    await screen.findByRole('heading', { name: 'Bonjour Camille' });
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
    const create = screen.getByRole('navigation', { name: 'Créer' });
    expect(within(create).getByRole('link', { name: /^Débiteur/ })).not.toHaveAttribute('data-soon');
    const letter = within(create).getByRole('link', { name: /^Courrier.*Bientôt.*disponible/ });
    expect(letter).toHaveAttribute('href', '/documents/rediger');
    await userEvent.click(letter);
    expect(await screen.findByRole('heading', { level: 1, name: 'Rédiger un courrier' })).toBeVisible();
    await userEvent.keyboard('/');
    const input = await screen.findByPlaceholderText('Débiteur, SIRET, SIREN, facture…');
    for (const [query, page] of [
      ['appels', /^Appels/],
      ['e-mail', /^E-mails/],
      ['sms', /^SMS/],
      ['courrier', /^Rédiger un courrier/],
    ] as const) {
      await userEvent.clear(input);
      await userEvent.type(input, query);
      expect(await screen.findByRole('option', { name: page })).toHaveTextContent('Page · bientôt disponible');
    }
  });
  it('never asks for an incoming call', async () => {
    callState.incoming = true;
    withoutApi();
    const seen = requests();
    openAs('cl', '/');
    expect(await screen.findByText("Équipe aujourd'hui")).toBeVisible();
    expect(screen.queryByRole('button', { name: /Décrocher/ })).toBeNull();
    expect(seen.filter((line) => line.includes('/calls'))).toEqual([]);
  });
  it('keeps the calls of the dashboard and of the reminders greyed, leading to their page', async () => {
    withoutApi();
    const seen = requests();
    // The manager's dashboard, whose priorities include a call.
    const dashboard = openAs('cl', '/');
    const start = await screen.findByRole('link', { name: 'Démarrer ma session d’appels' });
    expect(start).toHaveAttribute('href', '/appels');
    expect(start).toHaveAccessibleDescription(says('calls'));
    // A priority leading to a page to come is greyed the same way; one leading to a case file stays as it is.
    expect(await screen.findByRole('link', { name: 'Appeler : Appeler Bâtiplus SAS' })).toHaveAccessibleDescription(says('calls'));
    expect(screen.getByRole('link', { name: 'Vérifier : Contrôler la promesse de Nordis Logistique' })).not.toHaveAttribute('data-soon');
    // An export to come: reached with the keyboard, it says so instead of acting.
    const exporter = screen.getByRole('button', { name: 'Exporter' });
    expect(exporter).toBeEnabled();
    await userEvent.click(exporter);
    expect(await toast('Bientôt disponible.')).toBeVisible();
    dashboard.unmount();
    openAs('hb', '/relances');
    const call = await screen.findByRole('link', { name: 'Appeler Groupe Hélio' }, { timeout: 5000 });
    expect(call).toHaveAccessibleDescription(says('calls'));
    expect(screen.getByRole('link', { name: 'Démarrer ma session d’appels' })).toHaveAccessibleDescription(says('calls'));
    expect(unanswered(seen)).toEqual([]);
  });
  it('keeps writing, calling and drafting a letter in the case file, greyed', async () => {
    withoutApi();
    const seen = requests();
    const { container } = openAs('cl', '/debiteurs/demo');
    expect(await screen.findByRole('heading', { name: 'Bâtiplus SAS' })).toBeVisible();
    // An address is data: it stays plain text, readable.
    expect(screen.queryByRole('button', { name: /^Écrire à / })).toBeNull();
    const mail = screen.getByRole('button', { name: /^E-mail : / });
    expect(mail).toHaveAccessibleDescription(says('emails'));
    await userEvent.click(mail);
    expect(await toast(says('emails'))).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /Objet/ })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /Échanges/ }));
    expect(screen.getByRole('button', { name: 'Écrire un e-mail' })).toHaveAccessibleDescription(says('emails'));
    for (const [channel, feature] of [
      ['Appeler', 'calls'],
      ['E-mail', 'emails'],
      ['SMS', 'sms'],
    ] as const)
      expect(screen.getByRole('link', { name: channel })).toHaveAccessibleDescription(says(feature));
    await userEvent.click(screen.getByRole('tab', { name: /Documents/ }));
    expect(await screen.findByRole('link', { name: '+ Nouveau courrier' })).toHaveAccessibleDescription(says('letters'));
    expect(unanswered(seen)).toEqual([]);
    expect(await axeViolations(container)).toEqual([]);
  });
  it('keeps the sending of the documents and of a template greyed, the reminder of an installment ready, and the creditor address as text', async () => {
    withoutApi();
    const seen = requests();
    const documents = openAs('cl', '/documents');
    expect(await screen.findByRole('button', { name: 'Télécharger' })).toBeVisible();
    const send = screen.getByRole('button', { name: 'Envoyer' });
    expect(send).toHaveAccessibleDescription(says('document-sending'));
    await userEvent.click(send);
    expect(await toast(says('document-sending'))).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('+ Nouveau courrier').closest('a')).toHaveAccessibleDescription(says('letters'));
    documents.unmount();
    const plans = openAs('cl', '/echeanciers');
    expect(await screen.findByRole('button', { name: 'Modifier le plan' })).toBeVisible();
    // On the API since question 221: no « Bientôt » on it.
    expect(screen.getByRole('button', { name: 'Envoyer un rappel' })).not.toHaveAccessibleDescription(/Bientôt/u);
    plans.unmount();
    const template = openAs('cl', '/parametres/modeles/rappel');
    expect(await screen.findByText('Liste des champs de fusion')).toBeVisible();
    expect(screen.getByRole('button', { name: 'M’envoyer un test' })).toHaveAccessibleDescription(says('template-tests'));
    template.unmount();
    openAs('cl', '/creanciers/md');
    expect(await screen.findByText('c.besson@materiauxdelta.example')).not.toHaveAttribute('href');
    expect(unanswered(seen)).toEqual([]);
  });
  it('keeps the mailboxes greyed in the technical settings', async () => {
    withoutApi();
    const seen = requests();
    openAs('dev', '/parametres/techniques');
    expect(await screen.findByRole('link', { name: /Secrets/ })).not.toHaveAttribute('data-soon');
    const mailboxes = screen.getByRole('link', { name: /Boîtes e-mail/ });
    expect(mailboxes).toHaveAttribute('data-soon');
    expect(mailboxes).toHaveTextContent('Bientôt');
    await userEvent.click(mailboxes);
    expect(await screen.findByText('Bientôt disponible')).toBeVisible();
    expect(unanswered(seen)).toEqual([]);
  });
  it.each([...MENU, '/notifications', '/parametres', '/compte', '/aide'])('opens %s asking the API only routes it answers', async (path) => {
    withoutApi();
    const seen = requests();
    openAs('cl', path);
    await screen.findByRole('heading', { level: 1 });
    expect(seen).not.toEqual([]);
    expect(unanswered(seen)).toEqual([]);
  });
  it('keeps calling and drafting greyed beside the SMS ready alone', async () => {
    vi.stubEnv('VITE_FEATURES', 'sms');
    openAs('cl', '/sms');
    expect(await screen.findByRole('link', { name: 'Ouvrir le dossier' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Appeler' })).toHaveAccessibleDescription(says('calls'));
    expect(screen.getByRole('link', { name: 'Envoi groupé' })).toHaveAccessibleDescription(says('letters'));
  });
});

describe('with the API of these parts, or in development', () => {
  it('shows the whole menu without « Bientôt », and every page', async () => {
    simulated();
    openAs('cl', '/');
    expect(await menu()).toEqual(MENU);
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(soonLinks(nav)).toEqual([]);
    expect(within(nav).getByRole('button', { name: 'Communication' })).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Démarrer ma session d’appels' })).not.toHaveAttribute('data-soon');
    for (const [key, page] of [
      ['a', 'Appels'],
      ['m', 'E-mails'],
      ['s', 'SMS'],
    ]) {
      await userEvent.keyboard(`g${key}`);
      expect(await screen.findByRole('heading', { level: 1, name: page })).toBeVisible();
      expect(screen.queryByText('Bientôt disponible')).toBeNull();
    }
    await userEvent.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    expect(within(dialog).getByRole('heading', { name: 'Téléphone' })).toBeVisible();
    expect(dialog).not.toHaveTextContent('bientôt');
    await userEvent.keyboard('{Escape}/');
    await userEvent.type(await screen.findByPlaceholderText('Débiteur, SIRET, SIREN, facture…'), 'courrier');
    expect(await screen.findByRole('option', { name: /^Rédiger un courrier/ })).not.toHaveTextContent('bientôt');
  });
  it('makes a part ready as soon as the setting names it', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FEATURES', 'calls,letters');
    callState.incoming = true;
    openAs('cl', '/');
    expect(await screen.findByRole('button', { name: /Décrocher/ })).toBeVisible();
    expect(await menu()).toEqual(MENU);
    expect(soonLinks(screen.getByRole('navigation', { name: 'Navigation principale' }))).toEqual(['/e-mails', '/sms']);
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
    expect(within(screen.getByRole('navigation', { name: 'Créer' })).getByRole('link', { name: /^Courrier/ })).not.toHaveAttribute('data-soon');
  });
  it('asks routes the API does not answer yet, which the simulations stand in for', async () => {
    simulated();
    const seen = requests();
    openAs('cl', '/appels');
    expect(await screen.findByRole('heading', { level: 1, name: 'Appels' })).toBeVisible();
    expect(unanswered(seen)).toContain('GET /staff/calls');
  });
  it('offers the sending buttons and the links, without « Bientôt »', async () => {
    simulated();
    const documents = openAs('cl', '/documents');
    expect(await screen.findByRole('button', { name: 'Envoyer' })).not.toHaveAttribute('data-soon');
    expect(screen.getByText('+ Nouveau courrier').closest('a')).not.toHaveAttribute('data-soon');
    documents.unmount();
    const plans = openAs('cl', '/echeanciers');
    expect(await screen.findByRole('button', { name: 'Envoyer un rappel' })).not.toHaveAttribute('data-soon');
    plans.unmount();
    const template = openAs('cl', '/parametres/modeles/rappel');
    expect(await screen.findByRole('button', { name: 'M’envoyer un test' })).not.toHaveAttribute('data-soon');
    template.unmount();
    const reminders = openAs('hb', '/relances');
    expect(await screen.findByRole('link', { name: 'Appeler Groupe Hélio' }, { timeout: 5000 })).not.toHaveAttribute('data-soon');
    reminders.unmount();
    const creditor = openAs('cl', '/creanciers/md');
    expect(await screen.findByText('c.besson@materiauxdelta.example')).toHaveAttribute('href', '/e-mails');
    creditor.unmount();
    const sms = openAs('cl', '/sms');
    expect(await screen.findByRole('link', { name: 'Appeler' })).not.toHaveAttribute('data-soon');
    expect(screen.getByRole('link', { name: 'Envoi groupé' })).not.toHaveAttribute('data-soon');
    sms.unmount();
    const settings = openAs('dev', '/parametres/techniques');
    expect(await screen.findByRole('link', { name: /Boîtes e-mail/ })).not.toHaveAttribute('data-soon');
    settings.unmount();
    openAs('cl', '/debiteurs/demo');
    expect(await screen.findAllByRole('button', { name: /^Écrire à / })).not.toEqual([]);
    expect(screen.getByRole('button', { name: /^E-mail : / })).not.toHaveAttribute('data-soon');
    await userEvent.click(screen.getByRole('tab', { name: /Échanges/ }));
    expect(screen.getByRole('button', { name: 'Écrire un e-mail' })).not.toHaveAttribute('data-soon');
    for (const channel of ['Appeler', 'E-mail', 'SMS']) expect(screen.getByRole('link', { name: channel })).not.toHaveAttribute('data-soon');
    await userEvent.click(screen.getByRole('tab', { name: /Documents/ }));
    expect(await screen.findByRole('link', { name: '+ Nouveau courrier' })).not.toHaveAttribute('data-soon');
  });
});
