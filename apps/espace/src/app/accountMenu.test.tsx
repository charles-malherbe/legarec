import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, openAs } from '../testing';

mockApi();

describe('the menu of the avatar', () => {
  it('takes the focus, goes from an entry to the next with the arrows, and gives the focus back on Échap', async () => {
    openAs('cl', '/');
    const avatar = await screen.findByRole('button', { name: /^Compte de Camille Laurent/ });
    await userEvent.click(avatar);
    const menu = await screen.findByRole('region', { name: 'Compte' });
    const entries = [...menu.querySelectorAll<HTMLElement>('button, a')];
    await waitFor(() => expect(entries[0]).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(entries[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(entries.at(-1)).toHaveFocus();
    expect(entries.at(-1)).toHaveTextContent('Se déconnecter');
    await userEvent.keyboard('{Home}');
    expect(entries[0]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Compte' })).toBeNull();
    expect(avatar).toHaveFocus();
  });

  it('shows the status of 3CX only with a telephone extension', async () => {
    openAs('cl', '/');
    await userEvent.click(await screen.findByRole('button', { name: /^Compte de Camille Laurent/ }));
    expect(await screen.findByRole('radiogroup', { name: 'Statut téléphonique' })).toBeVisible();
    expect(screen.getByText('Statut 3CX · poste 101')).toBeVisible();
  });

  it('leaves out the status of 3CX for an account without extension', async () => {
    openAs('ad', '/');
    await userEvent.click(await screen.findByRole('button', { name: /^Compte de Marie Dubreuil/ }));
    expect(await screen.findByRole('region', { name: 'Compte' })).toBeVisible();
    expect(screen.queryByRole('radiogroup', { name: 'Statut téléphonique' })).toBeNull();
    expect(screen.getByTitle('mdu@legarec.fr')).toBeVisible();
  });
});
