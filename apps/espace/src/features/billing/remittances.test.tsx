import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetRemittances } from '../../mocks/routes/remittances';
import { call, mockApi, openAs } from '../../testing';

mockApi();
beforeEach(resetRemittances);
const inDialog = async () => within(await screen.findByRole('alertdialog'));

describe('remittances', () => {
  it('validates the batch as computed, after a creditor is retained with its reason', async () => {
    openAs('ad', '/facturation/reversements');
    expect(await screen.findByText('Matériaux Delta')).toBeVisible();
    // Kept out of the batch: no account confirmed by phone.
    expect(screen.getByText('TransAlp Leasing : compte manquant')).toBeVisible();
    const médiatel = screen.getByRole('row', { name: /Médiatel/u });
    await userEvent.click(within(médiatel).getByRole('button', { name: 'Retenir' }));
    let dialog = await inDialog();
    expect(dialog.getByRole('button', { name: 'Retenir le créancier' })).toBeDisabled();
    await userEvent.type(dialog.getByLabelText('Motif de la retenue'), 'Litige sur le mandat');
    await userEvent.click(dialog.getByRole('button', { name: 'Retenir le créancier' }));
    await userEvent.click(await screen.findByRole('button', { name: /Valider le lot/u }));
    dialog = await inDialog();
    expect(dialog.getByText('Retenus')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Valider le lot' }));
    expect(await screen.findByText(/Lot validé : 2 virements à faire/u)).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: 'Marquer comme versés' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Marquer comme versés' }));
    expect(await screen.findByText(/marqués comme versés le/u)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/SEPA|Carte bancaire/u);
  });

  it('is closed to the Claims officer and to the manager without the delegation', async () => {
    expect((await call('hb', '/remittances/draft')).status).toBe(403);
    openAs('hb', '/facturation/reversements');
    expect(await screen.findByRole('heading', { name: 'Accès réservé' })).toBeVisible();
  });
});
