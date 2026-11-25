import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../packages/ui/src/testing';
import { handlers, resetPortal, setPartner, state } from '../mocks/handlers';
import { App } from './App';

const OFFLINE = 'Le service ne répond pas. Vérifiez votre connexion et réessayez.';
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());
beforeEach(() => {
  resetPortal();
  setPartner('none');
});

const open = (path = '/connexion') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const signIn = async (password = 'motdepasse12', email = 'c.besson@materiauxdelta.example') => {
  await userEvent.type(await screen.findByLabelText('Adresse e-mail'), email);
  await userEvent.type(screen.getByLabelText('Mot de passe'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
};
const isIn = async () => expect(await screen.findByRole('heading', { name: 'Bonjour Claire' })).toBeVisible();
/** Erases what is there, if anything, then types the code. */
const typeCode = async (code: string) => {
  for (const digit of [6, 5, 4, 3, 2, 1]) {
    await userEvent.click(screen.getByLabelText(`Chiffre ${digit} du code`));
    await userEvent.keyboard('{Backspace}');
  }
  await userEvent.click(screen.getByLabelText('Chiffre 1 du code'));
  await userEvent.keyboard(code);
};
/** The API opens the session: it answers `null`, the portal then reads it. */
const accepted = () => {
  setPartner('cb');
  return HttpResponse.json({ status: 'OK', session: null });
};

describe('sign-in of a creditor', () => {
  it('counts the attempts, then closes', async () => {
    open();
    await signIn('x');
    expect(await screen.findByText(/reste 4 tentatives/)).toBeVisible();
    state.failures.set('c.besson@materiauxdelta.example', 5);
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText(/bloqué pendant 15 minutes/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeDisabled();
  });
  it('tells a collaborator where to go, once the password is right', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    open();
    await signIn('x', 'cl@legarec.fr');
    expect(await screen.findByText(/incorrect/)).toBeVisible();
    expect(screen.queryByText(/compte Legarec/)).toBeNull();
    await userEvent.clear(screen.getByLabelText('Mot de passe'));
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12{Enter}');
    expect(await screen.findByText(/Ce compte est un compte Legarec/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Aller sur espace.legarec.fr' }));
    expect(opened).toHaveBeenCalledWith('https://espace.legarec.fr', '_blank', 'noopener,noreferrer');
  });
  it.each([
    ['too many attempts of the network', () => HttpResponse.json({ code: 'TOO_MANY' }, { status: 429 }), /Trop de tentatives depuis votre réseau/],
    ['a service away', () => HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 }), OFFLINE],
    ['a network that is cut', () => HttpResponse.error(), OFFLINE],
  ])('explains %s, then lets one try again', async (_what, refusal, text) => {
    server.use(http.post('/api/auth/login', refusal, { once: true }));
    open();
    await signIn();
    expect(await screen.findByText(text)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await isIn();
  });
  it('asks for the second factor, and opens nothing before it', async () => {
    server.use(
      http.post('/api/auth/login', () => HttpResponse.json({ status: 'TWO_FACTOR', methods: ['TOTP'] })),
      http.post('/api/auth/two-factor', async ({ request }) =>
        ((await request.json()) as { code: string }).code === '123456'
          ? accepted()
          : HttpResponse.json({ code: 'INVALID_CODE', attemptsLeft: 4 }, { status: 401 }),
      ),
    );
    open();
    await signIn();
    expect(await screen.findByRole('heading', { name: 'Vérification en deux étapes' })).toBeVisible();
    // No key is registered for a creditor: none is proposed.
    expect(screen.queryByRole('button', { name: 'Utiliser une clé de sécurité' })).toBeNull();
    await typeCode('000000');
    expect(await screen.findByText(/Code incorrect ou expiré/)).toBeVisible();
    expect(await axeViolations(document.body)).toEqual([]);
    await typeCode('123456');
    await isIn();
  });
  it('closes after five wrong codes', async () => {
    server.use(
      http.post('/api/auth/login', () => HttpResponse.json({ status: 'TWO_FACTOR', methods: ['TOTP'] })),
      http.post('/api/auth/two-factor', () => HttpResponse.json({ code: 'LOCKED' }, { status: 423 })),
    );
    open();
    await signIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Utiliser un code de secours' }));
    await userEvent.type(screen.getByLabelText('Code de secours'), '0000-0000{Enter}');
    expect(await screen.findByText('Compte bloqué pendant 15 minutes après 5 tentatives échouées.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeDisabled();
  });
  it('sets up the second factor that the firm requires: the portal opens once the codes are kept', async () => {
    const codes = ['4821-7730', '1093-5562', '7740-2218', '3365-9014', '6628-1047', '9950-3381', '2074-8816', '5517-4493'];
    server.use(
      http.post('/api/auth/login', () => HttpResponse.json({ status: 'SETUP_REQUIRED' })),
      http.post('/api/auth/setup/totp', () => HttpResponse.json({ uri: 'otpauth://totp/x', key: 'ABCD EFGH' })),
      http.post('/api/auth/setup/totp/verify', () => {
        setPartner('cb');
        return HttpResponse.json({ backupCodes: codes, session: null });
      }),
    );
    open();
    await signIn();
    expect(await screen.findByText('ABCD EFGH')).toBeVisible();
    await userEvent.type(screen.getByLabelText(/Code à 6 chiffres/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByRole('heading', { name: 'Codes de secours' })).toBeVisible();
    for (const code of codes) expect(screen.getByText(code)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Bonjour Claire' })).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: /J'ai conservé mes codes/ }));
    await isIn();
  });
});

describe('links received by a creditor', () => {
  const choose = async (labels: string[]) => {
    for (const label of labels) await userEvent.type(await screen.findByLabelText(label), 'Un-mot-de-passe-9');
  };
  it('asks for a link, and says when it cannot', async () => {
    open('/mot-de-passe-oublie');
    await userEvent.type(await screen.findByLabelText(/Adresse e-mail/), 'c.besson@materiauxdelta.example');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(/un lien vient d'être envoyé/)).toBeVisible();
    server.use(http.post('/api/auth/forgot-password', () => HttpResponse.json({ code: 'TOO_MANY' }, { status: 429 })));
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(/Trop de tentatives depuis votre réseau/)).toBeVisible();
    expect(screen.queryByText(/un lien vient d'être envoyé/)).toBeNull();
  });
  it('changes a password', async () => {
    open('/reinitialisation/demo');
    await choose(['Nouveau mot de passe', 'Confirmer le mot de passe']);
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText(/Mot de passe modifié/)).toBeVisible();
  });
  it('opens the account, whose second factor may wait', async () => {
    open('/activation/demo');
    expect(await screen.findByText(/Invitation de Camille Laurent · rôle Créancier/)).toBeVisible();
    await choose(['Mot de passe', 'Confirmer']);
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByRole('link', { name: /Plus tard/ })).toHaveAttribute('href', '/connexion');
    await userEvent.type(screen.getByLabelText(/Code à 6 chiffres/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByText('Code incorrect ou expiré.')).toBeVisible();
    await userEvent.clear(screen.getByLabelText(/Code à 6 chiffres/));
    await userEvent.type(screen.getByLabelText(/Code à 6 chiffres/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByRole('heading', { name: 'Codes de secours' })).toBeVisible();
    expect(screen.getAllByText(/^\d{4}-\d{4}$/)).toHaveLength(8);
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(screen.getByRole('link', { name: /accéder à Legarec/ }));
    expect(await screen.findByRole('heading', { name: 'Connexion à votre espace créancier' })).toBeVisible();
  });
  it.each(['/reinitialisation/perdu', '/activation/perdu'])('tells that %s has expired', async (path) => {
    open(path);
    expect(await screen.findByText(/a expiré/)).toBeVisible();
    expect(screen.queryByLabelText(/ot de passe/)).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
