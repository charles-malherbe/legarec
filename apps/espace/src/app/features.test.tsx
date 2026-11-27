import '@testing-library/jest-dom/vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import contract from '../../../../packages/contracts/openapi.json?raw';
import { axeViolations } from '../../../../packages/ui/src/testing';
import { callState, resetCalls } from '../mocks/routes/calls';
import { mockApi, openAs } from '../testing';
import { FEATURES, opens, shown, unknownFeatures } from './features';

const server = mockApi();
// cmdk brings the active result into view: jsdom lays nothing out.
Element.prototype.scrollIntoView = vi.fn();
beforeEach(() => resetCalls());
afterEach(() => {
  vi.unstubAllEnvs();
  server.events.removeAllListeners();
});

/** A build that leaves out every part still without its API: the production build, as long as `VITE_FEATURES` names none. */
const withoutApi = () => vi.stubEnv('VITE_FEATURES', '');
/** Development, which simulates them all. */
const simulated = () => vi.stubEnv('VITE_FEATURES', undefined);

const SCREENS = ['/appels', '/e-mails', '/sms', '/documents/rediger', '/parametres/techniques/boites'];
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

describe('setting', () => {
  it('shows every part in development, none in a production build', () => {
    simulated();
    expect(FEATURES.filter((feature) => shown(feature))).toEqual([...FEATURES]);
    expect(SCREENS.every(opens)).toBe(true);
    vi.stubEnv('DEV', false);
    expect(FEATURES.filter((feature) => shown(feature))).toEqual([]);
    expect(SCREENS.filter(opens)).toEqual([]);
  });
  it('shows the parts it names, and only them, in production as in development', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FEATURES', ' calls, letters ');
    expect(FEATURES.filter((feature) => shown(feature))).toEqual(['calls', 'letters']);
    expect(SCREENS.filter(opens)).toEqual(['/appels', '/documents/rediger']);
    vi.stubEnv('DEV', true);
    withoutApi();
    expect(FEATURES.filter((feature) => shown(feature))).toEqual([]);
  });
  it('closes the screens of a part left out with what follows their address, and nothing else', () => {
    withoutApi();
    expect(['/appels/demo', '/e-mails?to=x', '/sms#fil', '/documents/rediger?dossier=demo', '/parametres/techniques/boites/b1'].filter(opens)).toEqual([]);
    expect(['/', '/documents', '/appelsx', '/parametres/techniques', '/parametres/techniques/secrets', '/aide'].every(opens)).toBe(true);
  });
  it('names the parts the build does not know, so that it stops', () => {
    expect(unknownFeatures('calls, phone,,emails, SMS')).toEqual(['phone', 'SMS']);
    expect(unknownFeatures()).toEqual([]);
  });
});

describe('without the API of these parts', () => {
  it('keeps the menu in its validated order, without their entries, counters nor empty group', async () => {
    withoutApi();
    const { container } = openAs('cl', '/');
    expect(await menu()).toEqual(MENU.filter((href) => !SCREENS.includes(href)));
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).queryByRole('button', { name: 'Communication' })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Documents' })).toBeVisible();
    expect(nav).not.toHaveTextContent(/appels en file|e-mails non lus|SMS non lus/);
    expect(await screen.findByRole('heading', { name: 'Bonjour Camille' })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });
  it.each([
    ['cl', '/appels'],
    ['cl', '/e-mails'],
    ['cl', '/sms'],
    ['cl', '/documents/rediger?dossier=demo'],
    ['dev', '/parametres/techniques/boites'],
  ])('leads %s from %s to « Page introuvable », never to a screen in error', async (account, path) => {
    withoutApi();
    const seen = requests();
    const { container } = openAs(account, path);
    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeVisible();
    expect(unanswered(seen)).toEqual([]);
    expect(await axeViolations(container)).toEqual([]);
  });
  it('ignores their shortcuts and leaves them out of the list', async () => {
    withoutApi();
    openAs('cl', '/');
    const heading = await screen.findByRole('heading', { name: 'Bonjour Camille' });
    for (const key of ['a', 'm', 's']) {
      await userEvent.keyboard(`g${key}`);
      expect(heading).toBeVisible();
    }
    await userEvent.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    const goTo = within(dialog).getByRole('heading', { name: 'Aller à' }).closest('section');
    expect(goTo).toHaveTextContent('Débiteurs');
    expect(goTo).not.toHaveTextContent(/Appels|E-mails|SMS/);
    expect(within(dialog).queryByRole('heading', { name: 'Téléphone' })).toBeNull();
  });
  it('offers none of their pages in the search, nor the letter in « Créer »', async () => {
    withoutApi();
    openAs('cl', '/');
    await screen.findByRole('heading', { name: 'Bonjour Camille' });
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
    const create = screen.getByRole('navigation', { name: 'Créer' });
    expect(within(create).getByRole('link', { name: /Débiteur/ })).toBeVisible();
    expect(within(create).queryByRole('link', { name: /Courrier/ })).toBeNull();
    await userEvent.keyboard('{Escape}/');
    const input = await screen.findByPlaceholderText('Débiteur, SIRET, SIREN, facture…');
    for (const [query, page] of [
      ['appels', /^Appels/],
      ['e-mail', /^E-mails/],
      ['sms', /^SMS/],
      ['courrier', /^Rédiger un courrier/],
    ] as const) {
      await userEvent.clear(input);
      await userEvent.type(input, query);
      expect(screen.queryByRole('option', { name: page })).toBeNull();
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
  it('keeps the dashboard and the reminders without the calls page', async () => {
    withoutApi();
    const seen = requests();
    const dashboard = openAs('hb', '/');
    await screen.findByRole('button', { name: 'Exporter' });
    expect(screen.queryByText('Démarrer ma session d’appels')).toBeNull();
    dashboard.unmount();
    openAs('hb', '/relances');
    expect(await screen.findByRole('button', { name: 'Reporter : Groupe Hélio' }, { timeout: 5000 })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Appeler Groupe Hélio' })).toBeNull();
    expect(screen.queryByText('Démarrer ma session d’appels')).toBeNull();
    expect(unanswered(seen)).toEqual([]);
  });
  it('keeps the case file without writing, calling nor drafting a letter from it', async () => {
    withoutApi();
    const seen = requests();
    const { container } = openAs('cl', '/debiteurs/demo');
    expect(await screen.findByRole('heading', { name: 'Bâtiplus SAS' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^E-mail : / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Écrire à / })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /Échanges/ }));
    expect(screen.queryByRole('button', { name: 'Écrire un e-mail' })).toBeNull();
    for (const channel of ['Appeler', 'E-mail', 'SMS']) expect(screen.queryByRole('link', { name: channel })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /Documents/ }));
    expect(await screen.findByRole('heading', { name: 'Documents du dossier' })).toBeVisible();
    expect(screen.queryByText('+ Nouveau courrier')).toBeNull();
    expect(unanswered(seen)).toEqual([]);
    expect(await axeViolations(container)).toEqual([]);
  });
  it('keeps the documents, the payment plans, a template and a creditor without their sending', async () => {
    withoutApi();
    const seen = requests();
    const documents = openAs('cl', '/documents');
    expect(await screen.findByRole('button', { name: 'Télécharger' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Envoyer' })).toBeNull();
    expect(screen.queryByText('+ Nouveau courrier')).toBeNull();
    documents.unmount();
    const plans = openAs('cl', '/echeanciers');
    expect(await screen.findByRole('button', { name: 'Modifier le plan' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Envoyer un rappel' })).toBeNull();
    plans.unmount();
    const template = openAs('cl', '/parametres/modeles/rappel');
    expect(await screen.findByText('Liste des champs de fusion')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'M’envoyer un test' })).toBeNull();
    template.unmount();
    openAs('cl', '/creanciers/md');
    expect(await screen.findByText('c.besson@materiauxdelta.example')).not.toHaveAttribute('href');
    expect(unanswered(seen)).toEqual([]);
  });
  it('keeps the technical settings without the mailboxes', async () => {
    withoutApi();
    const seen = requests();
    openAs('dev', '/parametres/techniques');
    expect(await screen.findByRole('link', { name: /Secrets/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Boîtes e-mail/ })).toBeNull();
    expect(unanswered(seen)).toEqual([]);
  });
  it.each([...MENU.filter((href) => !SCREENS.includes(href)), '/notifications', '/parametres', '/compte', '/aide'])(
    'opens %s asking the API only routes it answers',
    async (path) => {
      withoutApi();
      const seen = requests();
      openAs('cl', path);
      await screen.findByRole('heading', { level: 1 });
      expect(seen).not.toEqual([]);
      expect(unanswered(seen)).toEqual([]);
    },
  );
  it('keeps the SMS shown alone without calling nor drafting', async () => {
    vi.stubEnv('VITE_FEATURES', 'sms');
    openAs('cl', '/sms');
    expect(await screen.findByRole('link', { name: 'Ouvrir le dossier' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Appeler' })).toBeNull();
    expect(screen.queryByText('Envoi groupé')).toBeNull();
  });
});

describe('with the API of these parts, or in development', () => {
  it('shows the whole menu and every page', async () => {
    simulated();
    openAs('cl', '/');
    expect(await menu()).toEqual(MENU);
    expect(within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('button', { name: 'Communication' })).toBeVisible();
    expect(await screen.findByText('Démarrer ma session d’appels')).toBeVisible();
    for (const [key, page] of [
      ['a', 'Appels'],
      ['m', 'E-mails'],
      ['s', 'SMS'],
    ]) {
      await userEvent.keyboard(`g${key}`);
      expect(await screen.findByRole('heading', { level: 1, name: page })).toBeVisible();
    }
    await userEvent.keyboard('?');
    expect(within(await screen.findByRole('dialog', { name: 'Raccourcis clavier' })).getByRole('heading', { name: 'Téléphone' })).toBeVisible();
    await userEvent.keyboard('{Escape}/');
    await userEvent.type(await screen.findByPlaceholderText('Débiteur, SIRET, SIREN, facture…'), 'courrier');
    expect(await screen.findByRole('option', { name: /^Rédiger un courrier/ })).toBeVisible();
  });
  it('shows a part again as soon as the setting names it', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FEATURES', 'calls,letters');
    callState.incoming = true;
    openAs('cl', '/');
    expect(await screen.findByRole('button', { name: /Décrocher/ })).toBeVisible();
    expect(await menu()).toEqual(MENU.filter((href) => !['/e-mails', '/sms', '/parametres/techniques/boites'].includes(href)));
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }));
    expect(within(screen.getByRole('navigation', { name: 'Créer' })).getByRole('link', { name: /Courrier/ })).toBeVisible();
  });
  it('asks routes the API does not answer yet, which the simulations stand in for', async () => {
    simulated();
    const seen = requests();
    openAs('cl', '/appels');
    expect(await screen.findByRole('heading', { level: 1, name: 'Appels' })).toBeVisible();
    expect(unanswered(seen)).toContain('GET /staff/calls');
  });
  it('offers the sending buttons and the links', async () => {
    simulated();
    const documents = openAs('cl', '/documents');
    expect(await screen.findByRole('button', { name: 'Envoyer' })).toBeVisible();
    expect(screen.getByText('+ Nouveau courrier')).toBeVisible();
    documents.unmount();
    const plans = openAs('cl', '/echeanciers');
    expect(await screen.findByRole('button', { name: 'Envoyer un rappel' })).toBeVisible();
    plans.unmount();
    const template = openAs('cl', '/parametres/modeles/rappel');
    expect(await screen.findByRole('button', { name: 'M’envoyer un test' })).toBeVisible();
    template.unmount();
    const reminders = openAs('hb', '/relances');
    expect(await screen.findByRole('link', { name: 'Appeler Groupe Hélio' }, { timeout: 5000 })).toBeVisible();
    reminders.unmount();
    const creditor = openAs('cl', '/creanciers/md');
    expect(await screen.findByText('c.besson@materiauxdelta.example')).toHaveAttribute('href', '/e-mails');
    creditor.unmount();
    const sms = openAs('cl', '/sms');
    expect(await screen.findByRole('link', { name: 'Appeler' })).toBeVisible();
    expect(screen.getByText('Envoi groupé')).toBeVisible();
    sms.unmount();
    const settings = openAs('dev', '/parametres/techniques');
    expect(await screen.findByRole('link', { name: /Boîtes e-mail/ })).toBeVisible();
    settings.unmount();
    openAs('cl', '/debiteurs/demo');
    expect(await screen.findByRole('button', { name: /^E-mail : / })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Échanges/ }));
    expect(screen.getByRole('button', { name: 'Écrire un e-mail' })).toBeVisible();
    for (const channel of ['Appeler', 'E-mail', 'SMS']) expect(screen.getByRole('link', { name: channel })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Documents/ }));
    expect(await screen.findByText('+ Nouveau courrier')).toBeVisible();
  });
});
