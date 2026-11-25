import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../testing';
import { App } from './App';

/** Gestures that a person makes twice, or makes wrong. */
const server = mockApi();
const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const signIn = async (email: string) => {
  await userEvent.type(await screen.findByLabelText('Adresse e-mail'), email);
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
};
const typed = async (label: string, text: string) => userEvent.type(await screen.findByLabelText(label), text);

describe('a refused code', () => {
  it('leaves the field empty, so that the next one is sent whole, typed or pasted', async () => {
    const sent: string[] = [];
    server.use(
      http.post('/api/auth/two-factor', async ({ request }) => {
        sent.push(((await request.clone().json()) as { code: string }).code);
        return undefined;
      }),
    );
    open('/connexion');
    await signIn('support@legarec.fr');
    await userEvent.click(await screen.findByLabelText('Chiffre 1 du code'));
    await userEvent.keyboard('000000');
    expect(await screen.findByText(/Code incorrect ou expiré/)).toBeVisible();
    for (let digit = 1; digit <= 6; digit += 1) expect(screen.getByLabelText(`Chiffre ${digit} du code`)).toHaveValue('');
    expect(screen.getByLabelText('Chiffre 1 du code')).toHaveFocus();
    await userEvent.keyboard('111111');
    await screen.findByText(/Code incorrect ou expiré/);
    await userEvent.click(screen.getByLabelText('Chiffre 1 du code'));
    await userEvent.paste('123456');
    expect(await screen.findByText('Aucun dossier pour ce rôle')).toBeVisible();
    expect(sent).toEqual(['000000', '111111', '123456']);
  });
});

describe('a sign-in that took too long', () => {
  it('starts again from the password, and says why', async () => {
    open('/connexion');
    await signIn('support@legarec.fr');
    await screen.findByRole('heading', { name: 'Vérification en deux étapes' });
    server.use(http.post('/api/auth/two-factor', () => HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })));
    await userEvent.click(screen.getByLabelText('Chiffre 1 du code'));
    await userEvent.keyboard('123456');
    expect(await screen.findByText('Votre connexion a expiré : saisissez de nouveau votre mot de passe.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
  });
});

describe('a click made twice', () => {
  /** The first one is answered, whatever comes after finds the link used. */
  const onceOnly = (path: string, answer: () => Response) => {
    let calls = 0;
    server.use(
      http.post(path, async () => {
        calls += 1;
        const mine = calls;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return mine === 1 ? answer() : HttpResponse.json({ code: 'EXPIRED' }, { status: 410 });
      }),
    );
    return () => calls;
  };

  it('does not lose the backup codes, shown once', async () => {
    open('/activation/jeton');
    await typed('Mot de passe', 'Un-mot-de-passe-9');
    await typed('Confirmer', 'Un-mot-de-passe-9');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    const calls = onceOnly('/api/auth/invitation/:token/totp', () => HttpResponse.json({ backupCodes: ['4821-7730'] }));
    await userEvent.type(await screen.findByLabelText(/Code à 6 chiffres/), '123456');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Vérifier le code' }));
    expect(await screen.findByText('4821-7730')).toBeVisible();
    expect(calls()).toBe(1);
    expect(screen.queryByText(/a expiré/)).toBeNull();
  });

  it('chooses a password once', async () => {
    open('/reinitialisation/jeton');
    await typed('Nouveau mot de passe', 'Un-mot-de-passe-9');
    await typed('Confirmer le mot de passe', 'Un-mot-de-passe-9');
    const calls = onceOnly('/api/auth/reset/:token', () => new HttpResponse(null, { status: 204 }));
    await userEvent.dblClick(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }));
    expect(await screen.findByText(/Mot de passe modifié/)).toBeVisible();
    expect(calls()).toBe(1);
    expect(screen.queryByText(/a expiré/)).toBeNull();
  });
});

it('asks for an address that is one', async () => {
  open('/mot-de-passe-oublie');
  await userEvent.type(await screen.findByLabelText(/Adresse e-mail/), 'jean@legarec');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
  expect(await screen.findByText('Saisissez une adresse e-mail valide.')).toBeVisible();
});
