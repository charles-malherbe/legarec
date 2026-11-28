import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, describe, vi } from 'vitest';
import { axeViolations } from '../../../../packages/ui/src/testing';
import { handlers } from '../mocks/handlers';
import { publicDataHandlers } from '../mocks/publicData';
import { resetSteering } from '../mocks/routes/steering';
import { setAccount, state } from '../mocks/state';
import { canOpen } from './access';
import { passwordRules } from '@legarec/ui';
import { App } from './App';

const OFFLINE = 'Le service ne répond pas. Vérifiez votre connexion et réessayez.';

/** The browser asks the security key: there is none here. */
const { startAuthentication } = vi.hoisted(() => ({ startAuthentication: vi.fn<() => Promise<unknown>>() }));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication }));

const server = setupServer(...handlers, ...publicDataHandlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());
beforeEach(() => {
  setAccount('none');
  state.failures.clear();
  state.priorities.clear();
  state.pending = null;
  state.wrongCodes = 0;
});
const open = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const signIn = async (email: string, password: string) => {
  await userEvent.type(await screen.findByLabelText('Adresse e-mail'), email);
  await userEvent.type(screen.getByLabelText('Mot de passe'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
};

describe('login', () => {
  it('opens the dashboard of the Collection manager', async () => {
    open();
    await signIn('cl@legarec.fr', 'motdepasse12');
    expect(await screen.findByRole('heading', { name: 'Bonjour Camille' })).toBeVisible();
    expect(await screen.findByText("Équipe aujourd'hui")).toBeVisible();
  });
  it('counts attempts then locks the account', async () => {
    open('/connexion');
    await signIn('cl@legarec.fr', 'x');
    expect(await screen.findByText(/reste 4 tentatives/)).toBeVisible();
    state.failures.set('cl@legarec.fr', 5);
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText(/bloqué pendant 15 minutes/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeDisabled();
  });
  it('only reveals the wrong portal after a correct password', async () => {
    open('/connexion');
    await signIn('c.besson@materiauxdelta.example', 'x');
    expect(await screen.findByText(/incorrect/)).toBeVisible();
    expect(screen.queryByText(/compte créancier/)).toBeNull();
  });
  it('requires two factors for the Developer, who sees no case data', async () => {
    open('/connexion');
    await signIn('support@legarec.fr', 'motdepasse12');
    expect(await screen.findByRole('heading', { name: 'Vérification en deux étapes' })).toBeVisible();
    await userEvent.click(screen.getByLabelText('Chiffre 1 du code'));
    await userEvent.keyboard('123456');
    expect(await screen.findByText('Aucun dossier pour ce rôle')).toBeVisible();
    expect(screen.queryByText('Bâtiplus SAS')).toBeNull();
  });
  it('closes the sign-in after five wrong codes, and says so', async () => {
    open('/connexion');
    await signIn('support@legarec.fr', 'motdepasse12');
    for (let i = 0; i < 4; i += 1) {
      await userEvent.click(await screen.findByLabelText('Chiffre 1 du code'));
      await userEvent.keyboard('{Backspace}000000');
      expect(await screen.findByText(/Code incorrect ou expiré/)).toBeVisible();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Utiliser un code de secours' }));
    await userEvent.type(screen.getByLabelText('Code de secours'), '0000-0000');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter avec ce code' }));
    expect(await screen.findByText('Compte bloqué pendant 15 minutes après 5 tentatives échouées.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeDisabled();
  });
  it('sets up the second factor that the firm requires, and shows the backup codes once', async () => {
    await fetch('/api/members/hb/require-2fa', { method: 'POST' }).then((response) => expect(response.status).toBe(401));
    setAccount('ad');
    expect((await fetch('/api/members/sm/require-2fa', { method: 'POST' })).status).toBe(204);
    expect((await fetch('/api/members/hb/reset-2fa', { method: 'POST' })).status).toBe(204);
    expect((await fetch('/api/members/hb/require-2fa', { method: 'POST' })).status).toBe(204);
    setAccount('none');
    open('/connexion');
    await signIn('hb@legarec.fr', 'motdepasse12');
    expect(await screen.findByRole('heading', { name: 'Double authentification' })).toBeVisible();
    expect(screen.getByText('DEMO DEMO DEMO DEMO')).toBeVisible();
    const verify = screen.getByRole('button', { name: 'Vérifier le code' });
    expect(verify).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Code à 6 chiffres/), '000000');
    await userEvent.click(verify);
    expect(await screen.findByText('Code incorrect ou expiré.')).toBeVisible();
    await userEvent.clear(screen.getByLabelText(/Code à 6 chiffres/));
    await userEvent.type(screen.getByLabelText(/Code à 6 chiffres/), '123456');
    await userEvent.click(verify);
    expect(await screen.findByRole('heading', { name: 'Codes de secours' })).toBeVisible();
    expect(screen.getAllByText(/^\d{4}-\d{4}$/)).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: /J'ai conservé mes codes/ }));
    expect(await screen.findByRole('heading', { name: 'Bonjour Hugo' })).toBeVisible();
    resetSteering();
  });
  it.each([
    [429, { code: 'TOO_MANY' }, /Trop de tentatives depuis votre réseau/],
    [503, { code: 'UNAVAILABLE' }, /Le service ne répond pas/],
    [500, 'panne', /Le service ne répond pas/],
  ])('explains a refusal %s of the service', async (status, body, text) => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json(body, { status })));
    open('/connexion');
    await signIn('cl@legarec.fr', 'motdepasse12');
    expect(await screen.findByText(text)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
    server.resetHandlers();
  });
  it('says that the network is cut, and lets one try again', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.error(), { once: true }));
    open('/connexion');
    await signIn('cl@legarec.fr', 'motdepasse12');
    expect(await screen.findByText(OFFLINE)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('heading', { name: 'Bonjour Camille' })).toBeVisible();
  });
  it('sends a creditor to their own portal, once the password is right', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    open('/connexion');
    await signIn('c.besson@materiauxdelta.example', 'motdepasse12');
    expect(await screen.findByText(/Ce compte est un compte créancier/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Aller sur partenaires.legarec.fr' }));
    expect(opened).toHaveBeenCalledWith('https://partenaires.legarec.fr', '_blank', 'noopener,noreferrer');
  });
  it('mentions neither cards nor PCI', async () => {
    open('/connexion');
    await screen.findByRole('button', { name: 'Se connecter' });
    expect(document.body.textContent).not.toMatch(/PCI|carte bancaire|SEPA|Dirigeant/);
  });
});

describe('second factor of the sign-in', () => {
  const toCode = async () => {
    open('/connexion');
    await signIn('support@legarec.fr', 'motdepasse12');
    expect(await screen.findByRole('heading', { name: 'Vérification en deux étapes' })).toBeVisible();
  };
  /** Erases what is there, if anything, then types the code. */
  const typeCode = async (code = '123456') => {
    for (const digit of [6, 5, 4, 3, 2, 1]) {
      await userEvent.click(screen.getByLabelText(`Chiffre ${digit} du code`));
      await userEvent.keyboard('{Backspace}');
    }
    await userEvent.click(screen.getByLabelText('Chiffre 1 du code'));
    await userEvent.keyboard(code);
  };
  const isIn = async () => expect(await screen.findByText('Aucun dossier pour ce rôle')).toBeVisible();
  it.each([
    ['too many attempts of the network', () => HttpResponse.json({ code: 'TOO_MANY' }, { status: 429 }), /Trop de tentatives depuis votre réseau/],
    ['a service away', () => HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 }), /Le service ne répond pas/],
    ['a page of the proxy', () => new HttpResponse('<html>', { status: 502 }), /Le service ne répond pas/],
    ['a network that is cut', () => HttpResponse.error(), /Le service ne répond pas/],
    ['a wrong code', () => HttpResponse.json({ code: 'INVALID_CODE', attemptsLeft: 3 }, { status: 401 }), /Code incorrect ou expiré/],
  ])('explains %s, then lets one try again', async (_what, refusal, text) => {
    await toCode();
    server.use(http.post('/api/auth/two-factor', refusal, { once: true }));
    await typeCode();
    expect(await screen.findByText(text)).toHaveTextContent(/\S/);
    expect(screen.queryByText('Aucun dossier pour ce rôle')).toBeNull();
    await typeCode();
    await isIn();
  });
  it('accepts a backup code, when the telephone is lost', async () => {
    await toCode();
    await userEvent.click(screen.getByRole('button', { name: 'Utiliser un code de secours' }));
    const submit = screen.getByRole('button', { name: 'Se connecter avec ce code' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Code de secours'), ' 4821-7730 ');
    await userEvent.keyboard('{Enter}');
    await isIn();
  });
  it('accepts a security key', async () => {
    startAuthentication.mockResolvedValueOnce({ id: 'x' });
    await toCode();
    await userEvent.click(screen.getByRole('button', { name: 'Utiliser une clé de sécurité' }));
    await isIn();
  });
  it('explains a security key that was not recognised, or not asked for', async () => {
    await toCode();
    const key = screen.getByRole('button', { name: 'Utiliser une clé de sécurité' });
    startAuthentication.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
    await userEvent.click(key);
    expect(await screen.findByText(/La clé de sécurité n’a pas été reconnue/)).toBeVisible();
    server.use(http.post('/api/auth/two-factor/webauthn', () => HttpResponse.json({ code: 'TOO_MANY' }, { status: 429 }), { once: true }));
    await userEvent.click(key);
    expect(await screen.findByText(/Trop de tentatives depuis votre réseau/)).toBeVisible();
    expect(startAuthentication).toHaveBeenCalledTimes(1);
  });
  it('goes back to the password, and starts again', async () => {
    await toCode();
    await typeCode('000000');
    expect(await screen.findByText(/Code incorrect ou expiré/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Utiliser un code de secours' }));
    await userEvent.click(screen.getByRole('button', { name: '← Retour' }));
    expect(await screen.findByLabelText('Adresse e-mail')).toHaveValue('support@legarec.fr');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('heading', { name: 'Vérification en deux étapes' })).toBeVisible();
    expect(screen.queryByText(/Code incorrect ou expiré/)).toBeNull();
    expect(screen.queryByLabelText('Code de secours')).toBeNull();
  });
  it('stops with the sign-in while it is being set up: five wrong codes, or a service away', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json({ status: 'SETUP_REQUIRED' })));
    server.use(http.post('/api/auth/setup/totp', () => HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 }), { once: true }));
    open('/connexion');
    await signIn('hb@legarec.fr', 'motdepasse12');
    expect(await screen.findByText(OFFLINE)).toBeVisible();
    server.use(http.post('/api/auth/setup/totp', () => HttpResponse.json({ uri: 'otpauth://totp/x', key: 'ABCD EFGH' })));
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('ABCD EFGH')).toBeVisible();
    expect(screen.queryByText(OFFLINE)).toBeNull();
    server.use(http.post('/api/auth/setup/totp/verify', () => HttpResponse.json({ code: 'LOCKED' }, { status: 423 })));
    await userEvent.type(screen.getByLabelText(/Code à 6 chiffres/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByText('Compte bloqué pendant 15 minutes après 5 tentatives échouées.')).toBeVisible();
    expect(screen.queryByText('ABCD EFGH')).toBeNull();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeDisabled();
  });
});

describe('links received by e-mail', () => {
  const choose = async (password = 'Un-mot-de-passe-9', labels = ['Nouveau mot de passe', 'Confirmer le mot de passe']) => {
    for (const label of labels) await userEvent.type(await screen.findByLabelText(label), password);
  };
  it('asks for a link, and says when it cannot', async () => {
    open('/mot-de-passe-oublie');
    await userEvent.type(await screen.findByLabelText(/Adresse e-mail/), 'cl@legarec.fr');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(/un lien vient d'être envoyé/)).toBeVisible();
    server.use(http.post('/api/auth/forgot-password', () => HttpResponse.json({ code: 'TOO_MANY' }, { status: 429 })));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(/Trop de tentatives depuis votre réseau/)).toBeVisible();
    expect(screen.queryByText(/un lien vient d'être envoyé/)).toBeNull();
    server.use(http.post('/api/auth/forgot-password', () => HttpResponse.error()));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(OFFLINE)).toBeVisible();
    expect(screen.queryByText(/Trop de tentatives/)).toBeNull();
    server.resetHandlers();
  });
  it('accepts a password that follows every rule, and no other', async () => {
    open('/reinitialisation/jeton');
    const save = await screen.findByRole('button', { name: 'Enregistrer le mot de passe' });
    const [first, second] = [screen.getByLabelText('Nouveau mot de passe'), screen.getByLabelText('Confirmer le mot de passe')];
    const both = async (one: string, other = one) => {
      await userEvent.clear(first);
      await userEvent.clear(second);
      await userEvent.type(first, one);
      await userEvent.type(second, other);
    };
    const kept = () =>
      within(screen.getByRole('list', { name: 'Règles du mot de passe' }))
        .getAllByRole('listitem')
        .map((item) => item.hasAttribute('data-ok'));
    expect(save).toBeDisabled();
    await both('onze-lettre');
    expect([kept(), save.hasAttribute('disabled')]).toEqual([[false, true, true], true]);
    await both('CL@legarec.fr');
    expect([kept(), save.hasAttribute('disabled')]).toEqual([[true, false, true], true]);
    await both('Un-mot-de-passe-9', 'Un-mot-de-passe-8');
    expect([kept(), save.hasAttribute('disabled')]).toEqual([[true, true, false], true]);
    await both('douze-lettre');
    expect([kept(), save.hasAttribute('disabled')]).toEqual([[true, true, true], false]);
  });
  it.each([
    ['/reinitialisation/jeton', 'reset'],
    ['/activation/jeton', 'invitation'],
  ])('%s says that the service does not answer, and asks for nothing', async (path, kind) => {
    server.use(http.get(`/api/auth/${kind}/:token`, () => new HttpResponse(null, { status: 503 })));
    open(path);
    expect(await screen.findByText(OFFLINE)).toBeVisible();
    expect(screen.queryByText(/a expiré/)).toBeNull();
    expect(screen.queryByLabelText(/ot de passe/)).toBeNull();
  });
  it('keeps what was typed when the service does not answer', async () => {
    server.use(http.post('/api/auth/reset/:token', () => new HttpResponse(null, { status: 502 }), { once: true }));
    open('/reinitialisation/jeton');
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText(OFFLINE)).toBeVisible();
    expect(screen.getByLabelText('Nouveau mot de passe')).toHaveValue('Un-mot-de-passe-9');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText(/Mot de passe modifié/)).toBeVisible();
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });
  it('leaves the second factor for later, unless it is required', async () => {
    const { unmount } = open('/activation/jeton');
    await choose('Un-mot-de-passe-9', ['Mot de passe', 'Confirmer']);
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByRole('link', { name: /Plus tard/ })).toHaveAttribute('href', '/connexion');
    unmount();
    server.use(
      http.get('/api/auth/invitation/:token', () =>
        HttpResponse.json({ email: 'dev@legarec.fr', firstName: 'Nora', invitedBy: 'Marie Dubreuil', role: 'DEVELOPER', twoFactorRequired: true }),
      ),
    );
    open('/activation/jeton');
    expect(await screen.findByText(/Invitation de Marie Dubreuil · rôle Développeur/)).toBeVisible();
    await choose('Un-mot-de-passe-9', ['Mot de passe', 'Confirmer']);
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByLabelText(/Code à 6 chiffres/)).toBeVisible();
    expect(screen.queryByText(/Plus tard/)).toBeNull();
  });
  it('tells that the quarter of an hour of the second factor has passed', async () => {
    open('/activation/jeton');
    await choose('Un-mot-de-passe-9', ['Mot de passe', 'Confirmer']);
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    server.use(http.post('/api/auth/invitation/:token/totp', () => HttpResponse.json({ code: 'EXPIRED' }, { status: 410 })));
    await userEvent.type(await screen.findByLabelText(/Code à 6 chiffres/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByText(/Cette invitation a expiré/)).toBeVisible();
    expect(screen.queryByLabelText(/Code à 6 chiffres/)).toBeNull();
  });
  it('changes a password, unless the link was used meanwhile', async () => {
    server.use(http.post('/api/auth/reset/:token', () => HttpResponse.json({ code: 'EXPIRED' }, { status: 410 }), { once: true }));
    const { unmount } = open('/reinitialisation/jeton');
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText(/Ce lien a expiré/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enregistrer le mot de passe' })).toBeNull();
    unmount();
    open('/reinitialisation/jeton');
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText(/Mot de passe modifié/)).toBeVisible();
  });
  it('activates an account, with its second factor and its backup codes', async () => {
    open('/activation/jeton');
    await choose('Un-mot-de-passe-9', ['Mot de passe', 'Confirmer']);
    server.use(http.post('/api/auth/invitation/:token/password', () => HttpResponse.json({ code: 'INTERNAL' }, { status: 500 }), { once: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByText(/Le service ne répond pas/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    const code = await screen.findByLabelText(/Code à 6 chiffres/);
    await userEvent.type(code, '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByText('Code incorrect ou expiré.')).toBeVisible();
    server.use(http.post('/api/auth/invitation/:token/totp', () => HttpResponse.json({ code: 'LOCKED' }, { status: 423 }), { once: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByText(/Compte bloqué pendant 15 minutes/)).toBeVisible();
    await userEvent.clear(code);
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByRole('heading', { name: 'Codes de secours' })).toBeVisible();
    expect(screen.getAllByText(/^\d{4}-\d{4}$/)).toHaveLength(8);
  });
  it.each(['/reinitialisation/expire', '/activation/expire'])('tells that %s has expired', async (path) => {
    open(path);
    expect(await screen.findByText(/a expiré/)).toBeVisible();
    expect(screen.queryByLabelText(/Mot de passe/)).toBeNull();
  });
});

describe('accessibility of the sign-in', () => {
  // The title of each step is the title of the page.
  const clean = async (heading: string | RegExp) => {
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeVisible();
    expect(await axeViolations(document.body)).toEqual([]);
  };
  it('has no axe violation, from the refused password to the code', async () => {
    open('/connexion');
    await signIn('support@legarec.fr', 'x');
    expect(await screen.findByText(/reste 4 tentatives/)).toBeVisible();
    await clean('Connexion à l’espace Legarec');
    await userEvent.type(screen.getByLabelText('Mot de passe'), '{Control>}a{/Control}motdepasse12');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await clean('Vérification en deux étapes');
    await userEvent.click(screen.getByLabelText('Chiffre 1 du code'));
    await userEvent.keyboard('000000');
    expect(await screen.findByText(/Code incorrect ou expiré/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Utiliser un code de secours' }));
    await clean('Vérification en deux étapes');
  });
  it('has none while the second factor is being set up', async () => {
    server.use(
      http.post('/api/auth/login', () => HttpResponse.json({ status: 'SETUP_REQUIRED' })),
      http.post('/api/auth/setup/totp', () => HttpResponse.json({ uri: 'otpauth://totp/x', key: 'ABCD EFGH' })),
      http.post('/api/auth/setup/totp/verify', () => HttpResponse.json({ code: 'INVALID_CODE', attemptsLeft: 4 }, { status: 401 }), { once: true }),
      http.post('/api/auth/setup/totp/verify', () => HttpResponse.json({ backupCodes: ['4821-7730', '1093-5562'], session: null })),
    );
    open('/connexion');
    await signIn('hb@legarec.fr', 'motdepasse12');
    await clean('Double authentification');
    await userEvent.type(screen.getByLabelText(/Code à 6 chiffres/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByText('Code incorrect ou expiré.')).toBeVisible();
    // The error is read with its field.
    expect(screen.getByLabelText(/Code à 6 chiffres/)).toHaveAccessibleDescription('Code incorrect ou expiré.');
    await clean('Double authentification');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    await clean('Codes de secours');
  });
  it('has none on the pages of the links, whatever they say', async () => {
    let page = open('/mot-de-passe-oublie');
    await clean('Mot de passe oublié');
    page.unmount();
    page = open('/reinitialisation/expire');
    expect(await screen.findByText(/Ce lien a expiré/)).toBeVisible();
    await clean('Nouveau mot de passe');
    page.unmount();
    page = open('/reinitialisation/jeton');
    for (const label of ['Nouveau mot de passe', 'Confirmer le mot de passe']) await userEvent.type(await screen.findByLabelText(label), 'Un-mot-de-passe-9');
    await clean('Nouveau mot de passe');
    page.unmount();
    open('/activation/jeton');
    for (const label of ['Mot de passe', 'Confirmer']) await userEvent.type(await screen.findByLabelText(label), 'Un-mot-de-passe-9');
    await clean('Bienvenue, Nadia');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await clean('Double authentification');
    await userEvent.type(screen.getByLabelText(/Code à 6 chiffres/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    await clean('Codes de secours');
  });
  it('is done from end to end with the keyboard', async () => {
    open('/connexion');
    await userEvent.type(await screen.findByLabelText('Adresse e-mail'), 'support@legarec.fr');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12{Enter}');
    expect(await screen.findByRole('heading', { name: 'Vérification en deux étapes' })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Chiffre 1 du code')).toHaveFocus());
    await userEvent.keyboard('123456');
    expect(await screen.findByText('Aucun dossier pour ce rôle')).toBeVisible();
  });
});

describe('dashboard', () => {
  it('limits the Claims officer to their own portfolio', async () => {
    setAccount('hb');
    open();
    expect(await screen.findByText(/vos dossiers/)).toBeVisible();
    expect(screen.queryByText("Équipe aujourd'hui")).toBeNull();
    expect(screen.queryByText('Garage Valmont')).toBeNull();
  });
  it('undoes a priority from the toast', async () => {
    setAccount('cl');
    open();
    await userEvent.click(await screen.findByLabelText('Marquer « Appeler Bâtiplus SAS » comme fait'));
    expect(await screen.findByText('2 / 6 faites')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.getByText('1 / 6 faites')).toBeVisible());
  });
  it('toggles the low-vision mode from the Topbar', async () => {
    setAccount('cl');
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Mode malvoyant' }));
    await waitFor(() => expect(document.documentElement.dataset.a11y).toBe('malvoyant'));
  });
});

describe('search', () => {
  beforeEach(() => {
    state.recentCases.clear();
    // The palette scrolls to the option chosen, which jsdom cannot.
    Element.prototype.scrollIntoView = vi.fn();
  });
  const openFromSearch = async (query: string, name: RegExp) => {
    await userEvent.keyboard('/');
    await userEvent.type(await screen.findByPlaceholderText('Débiteur, SIRET, SIREN, facture…'), query);
    await userEvent.click(await screen.findByRole('option', { name }));
  };
  const recent = async () => {
    await userEvent.keyboard('/');
    const group = await screen.findByRole('group', { name: 'Dossiers récents' });
    return within(group)
      .getAllByRole('option')
      .map((option) => option.textContent);
  };
  it('offers the cases opened last before anything is typed, the latest first', async () => {
    setAccount('cl');
    open();
    await screen.findByRole('heading', { name: 'Bonjour Camille' });
    await userEvent.keyboard('/');
    expect(await screen.findByRole('group', { name: 'Accès rapide' })).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Dossiers récents' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await openFromSearch('batiplus', /^Bâtiplus SAS/);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bâtiplus SAS' })).toBeVisible();
    await openFromSearch('nordis', /^Nordis Logistique/);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nordis Logistique' })).toBeVisible();
    const [first, second, ...others] = await recent();
    expect(first).toContain('Nordis Logistique');
    expect(second).toContain('Bâtiplus SAS');
    expect(others).toEqual([]);
    // Once something is typed, the search alone.
    await userEvent.type(screen.getByPlaceholderText('Débiteur, SIRET, SIREN, facture…'), 'nord');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Dossiers récents' })).toBeNull());
    expect(await screen.findByRole('group', { name: 'Débiteurs' })).toBeVisible();
  });
});

it('restricts technical settings and billing by role', () => {
  const user = (role: 'DEVELOPER' | 'DIRECTOR' | 'COLLECTION_MANAGER' | 'CLAIMS_OFFICER', activeDelegations: ('TECHNICAL' | 'ADMINISTRATIVE')[] = []) =>
    ({ role, activeDelegations, userId: 'x' }) as Parameters<typeof canOpen>[1];
  expect(canOpen('/parametres/techniques', user('COLLECTION_MANAGER', ['ADMINISTRATIVE']))).toBe(false);
  expect(canOpen('/parametres/techniques', user('DIRECTOR'))).toBe(true);
  expect(canOpen('/facturation', user('COLLECTION_MANAGER'))).toBe(false);
  expect(canOpen('/facturation', user('COLLECTION_MANAGER', ['ADMINISTRATIVE']))).toBe(true);
  expect(canOpen('/debiteurs/demo', user('DEVELOPER', ['TECHNICAL']))).toBe(false);
});
it('checks password rules', () => {
  expect(passwordRules('cl@legarec.fr', 'court', 'court').map(([, ok]) => ok)).toEqual([false, true, true]);
});
