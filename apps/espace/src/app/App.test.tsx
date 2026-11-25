import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, expect, it, describe } from 'vitest';
import { handlers } from '../mocks/handlers';
import { setAccount, state } from '../mocks/state';
import { canOpen } from './access';
import { passwordRules } from '../features/login/PasswordPages';
import { App } from './App';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  setAccount('none');
  state.failures.clear();
  state.priorities.clear();
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
  it('mentions neither cards nor PCI', async () => {
    open('/connexion');
    await screen.findByRole('button', { name: 'Se connecter' });
    expect(document.body.textContent).not.toMatch(/PCI|carte bancaire|SEPA|Dirigeant/);
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
