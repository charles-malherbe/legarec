import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAccounts } from '../mocks/routes/account';
import { resetSettings } from '../mocks/routes/settings';
import { setAccount, state } from '../mocks/state';
import { call, mockApi, openAs } from '../testing';

const server = mockApi();
beforeEach(() => {
  resetSettings();
  resetAccounts();
});
/** As if the last proof was given long ago. */
const later = () => (state.provedAt = Date.now() - 11 * 60_000);
const box = async () => within(await screen.findByRole('alertdialog', { name: 'Confirmez que c’est bien vous' }));
const renew = async () => {
  openAs('dev', '/parametres/techniques/secrets');
  await userEvent.click(await screen.findByRole('button', { name: 'Renouveler : TCX_API_CLIENT_SECRET' }));
  await userEvent.type(screen.getByLabelText('Nouvelle valeur de TCX_API_CLIENT_SECRET'), 'valeur-fictive');
  await userEvent.click(screen.getByRole('button', { name: 'Renouveler' }));
  later();
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Renouveler la clé' }));
};
const withdraw = async () => {
  openAs('ad', '/compte');
  await userEvent.click(await screen.findByRole('tab', { name: 'Profil' }));
  const toggles = await screen.findAllByRole('switch', { name: 'Technique' });
  later();
  await userEvent.click(toggles[0]!);
  const confirm = screen.queryByRole('alertdialog');
  if (confirm) await userEvent.click(within(confirm).getAllByRole('button').at(-1)!);
};

describe('a sensitive action', () => {
  it('asks for the code of the application, then goes on by itself', async () => {
    await renew();
    const asked = await box();
    expect(asked.getByText('Renouveler un secret')).toBeVisible();
    await userEvent.type(asked.getByLabelText('Code à 6 chiffres'), '123456');
    await userEvent.click(asked.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('TCX_API_CLIENT_SECRET renouvelé.')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks for the password without a second factor', async () => {
    await withdraw();
    const asked = await box();
    await userEvent.type(asked.getByLabelText('Mot de passe'), 'motdepasse12');
    await userEvent.click(asked.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Délégation retirée.')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await call('ad', '/delegations/technical', { active: true }, 'PUT');
  });

  it('given up leaves the delegation as it is, and says so', async () => {
    await withdraw();
    await userEvent.click((await box()).getByRole('button', { name: 'Annuler' }));
    expect(await screen.findByText('La délégation n’a pas été modifiée.')).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Technique' })).toBeChecked();
  });

  it('asks for nothing within ten minutes', async () => {
    openAs('dev', '/parametres/techniques/secrets');
    await userEvent.click(await screen.findByRole('button', { name: 'Renouveler : TCX_API_CLIENT_SECRET' }));
    await userEvent.type(screen.getByLabelText('Nouvelle valeur de TCX_API_CLIENT_SECRET'), 'valeur-fictive');
    await userEvent.click(screen.getByRole('button', { name: 'Renouveler' }));
    state.provedAt = Date.now() - 9 * 60_000;
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Renouveler la clé' }));
    expect(await screen.findByText('TCX_API_CLIENT_SECRET renouvelé.')).toBeVisible();
  });

  it('accepts a backup code', async () => {
    await renew();
    const asked = await box();
    await userEvent.type(asked.getByLabelText('Code à 6 chiffres'), '4821-7730');
    await userEvent.click(asked.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('TCX_API_CLIENT_SECRET renouvelé.')).toBeVisible();
  });

  it('given up with Escape is not done, and what was typed stays', async () => {
    let asked = 0;
    server.use(
      http.post('/api/secrets/:id/rotate', () => {
        asked += 1;
        return undefined;
      }),
    );
    await renew();
    await box();
    asked = 0;
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText(/Rien n’a été enregistré/)).toBeVisible();
    expect(asked).toBe(0);
    expect(screen.queryByRole('alertdialog', { name: 'Confirmez que c’est bien vous' })).toBeNull();
    expect(screen.getByLabelText('Nouvelle valeur de TCX_API_CLIENT_SECRET')).toHaveValue('valeur-fictive');
  });

  it('counts the wrong codes, then closes the session at the fifth', async () => {
    await renew();
    for (const left of [4, 3, 2, 1]) {
      const asked = await box();
      await userEvent.type(asked.getByLabelText('Code à 6 chiffres'), '000000');
      await userEvent.click(asked.getByRole('button', { name: 'Confirmer' }));
      expect(await screen.findByText(`Code incorrect. Il vous reste ${left} tentative${left > 1 ? 's' : ''}.`)).toBeVisible();
      // Empty, ready for the next one.
      expect(asked.getByLabelText('Code à 6 chiffres')).toHaveValue('');
    }
    const last = await box();
    await userEvent.type(last.getByLabelText('Code à 6 chiffres'), '000000');
    await userEvent.click(last.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByRole('heading', { name: 'Session fermée' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Aller à la connexion' }));
    expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is sent again once, and says so when it is refused again', async () => {
    let sent = 0;
    server.use(
      http.post('/api/secrets/:id/rotate', () => {
        sent += 1;
        return HttpResponse.json({ code: 'PROOF_REQUIRED' }, { status: 403 });
      }),
    );
    await renew();
    const asked = await box();
    await userEvent.type(asked.getByLabelText('Code à 6 chiffres'), '123456');
    await userEvent.click(asked.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText(/Rien n’a été enregistré/)).toBeVisible();
    expect(sent).toBe(2);
  });

  it('asked by the session of someone else is not proved by the next person', async () => {
    await renew();
    await box();
    setAccount('none');
    const other = new BroadcastChannel('legarec-session');
    try {
      other.postMessage(null);
      expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeVisible();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    } finally {
      other.close();
    }
  });
});

describe('the simulations', () => {
  it('refuse the role first, then ask for the proof, for each action', async () => {
    setAccount('hb');
    later();
    expect(
      (await fetch('/api/delegations/technical', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"active":false}' })).status,
    ).toBe(403);
    setAccount('ad');
    later();
    const answer = await fetch('/api/delegations/technical', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"active":false}' });
    expect(await answer.json()).toEqual({ code: 'PROOF_REQUIRED' });
    // An ordinary setting asks for nothing.
    const setting = await fetch('/api/settings/firm/relances?version=0', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"calls":"3"}',
    });
    expect(setting.status).toBe(204);
    expect((await call('ad', '/settings/firm/cabinet?version=0', { holder: 'LEGAREC' }, 'PUT')).status).toBe(204);
  });
});
