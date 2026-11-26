import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCases } from '../../mocks/routes/cases';
import { resetDeposits } from '../../mocks/routes/deposits';
import { call, mockApi, openAs } from '../../testing';

mockApi();
beforeEach(() => {
  resetCases();
  resetDeposits();
});
const dialog = async () => within(await screen.findByRole('alertdialog'));

describe('claims deposited by creditors (question 155)', () => {
  it('wait in their own tab for the manager, who refuses one with a reason', async () => {
    openAs('cl', '/debiteurs?onglet=depots');
    const table = await screen.findByRole('region', { name: 'Créances déposées à valider' });
    expect(await within(table).findByText('Menuiserie Arnal')).toBeVisible();
    expect(within(table).getByText('SIRET 512 334 871 00088')).toBeVisible();
    await userEvent.click(within(table).getByRole('button', { name: 'Refuser la créance de Menuiserie Arnal' }));
    const box = await dialog();
    expect(box.getByText('Matériaux Delta')).toBeVisible();
    await userEvent.type(box.getByLabelText(/Motif du refus/), 'Facture déjà réglée selon le créancier');
    await userEvent.click(box.getByRole('button', { name: 'Refuser la créance' }));
    expect(await screen.findByText('Créance refusée.')).toBeVisible();
    expect(screen.queryByText('Menuiserie Arnal')).toBeNull();
  });

  it('become a case once the manager opens it, after a confirmation', async () => {
    openAs('cl', '/debiteurs?onglet=depots');
    await userEvent.click(await screen.findByRole('button', { name: 'Ouvrir le dossier de Studio Pixelia' }));
    await userEvent.click((await dialog()).getByRole('button', { name: 'Ouvrir le dossier' }));
    expect(await screen.findByText('Dossier ouvert.')).toBeVisible();
  });

  it('are told on the dashboard of the manager, never to an officer', async () => {
    const first = openAs('cl', '/');
    expect(await screen.findByText('2 créances déposées à valider')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Voir les dépôts' })).toHaveAttribute('href', '/debiteurs?onglet=depots');
    first.unmount();
    openAs('hb', '/debiteurs');
    expect(await screen.findByRole('heading', { name: 'Débiteurs' })).toBeVisible();
    expect(screen.queryByText('Dépôts à valider')).toBeNull();
    for (const account of ['hb', 'dev']) expect((await call(account, '/deposits')).status).toBe(403);
  });
});
