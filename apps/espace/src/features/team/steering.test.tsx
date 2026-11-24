import { billingTotals, vatNumber } from '@legarec/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetSteering } from '../../mocks/routes/steering';
import { call, mockApi, openAs } from '../../testing';

mockApi();
beforeEach(resetSteering);
const inDialog = async () => within(await screen.findByRole('alertdialog'));

it('computes billing totals in cents and VAT numbers', () => {
  expect(
    billingTotals([
      { quantity: 1, unitPrice: 497440 },
      { quantity: 3, unitPrice: 1500 },
    ]),
  ).toEqual({ net: 501940, vat: 100388, gross: 602328 });
  expect(vatNumber('401 228 975')).toMatch(/^FR\d{2} 401 228 975$/);
});

describe('members', () => {
  it('refuses a second holder of a unique role', async () => {
    openAs('ad', '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: '+ Inviter' }));
    await userEvent.type(screen.getByLabelText(/Prénom/), 'Zoé');
    await userEvent.type(screen.getByLabelText(/^Nom/), 'Marchand');
    await userEvent.type(screen.getByLabelText(/Adresse professionnelle/), 'zm@legarec.fr');
    await userEvent.selectOptions(screen.getByLabelText('Rôle'), 'DEVELOPER');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer l’invitation' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Envoyer l’invitation' }));
    expect(await screen.findByText(/unique et déjà attribué à Nora Petit/)).toBeInTheDocument();
  });
  it('disables an account with a reason and reassigns its cases', async () => {
    openAs('cl', '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'Désactiver Thomas Giraud' }));
    const dialog = await inDialog();
    expect(dialog.getByText('97 → Camille Laurent')).toBeVisible();
    await userEvent.type(dialog.getByLabelText('Motif'), 'Départ');
    await userEvent.click(dialog.getByRole('button', { name: 'Désactiver' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Désactiver Thomas Giraud' })).toBeNull());
  });
  it('gives the Developer only accounts and extensions', async () => {
    openAs('dev', '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier le poste de Thomas Giraud' }));
    await userEvent.type(screen.getByLabelText('Poste de Thomas'), '104');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Poste 3CX enregistré.')).toBeVisible();
    expect(screen.queryByText('Appels passés')).toBeNull();
    expect((await call('dev', '/team')).status).toBe(403);
    expect((await call('hb', '/members')).status).toBe(403);
    expect((await call('cl', '/members/hb/extension', { extension: '1' }, 'PUT')).status).toBe(403);
  });
  it('refuses the team screen to a Claims officer', async () => {
    openAs('hb', '/equipe');
    expect(await screen.findByRole('heading', { name: 'Accès réservé' })).toBeVisible();
  });
});

describe('billing', () => {
  it('shows the delegation banner to the Collection manager and confirms the issue', async () => {
    openAs('cl', '/facturation');
    expect(await screen.findByText('Pour le compte du Directeur')).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: 'Émettre la facture' }));
    const dialog = await inDialog();
    expect(dialog.getByText(/avoir/)).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Émettre la facture' }));
    expect(await screen.findByText('Facture FA-2026-0118 émise.')).toBeVisible();
  });
  it('shows no banner to the Director and refuses the others', async () => {
    openAs('ad', '/facturation');
    await screen.findByRole('button', { name: 'Émettre la facture' });
    expect(screen.queryByText('Pour le compte du Directeur')).toBeNull();
    expect((await call('hb', '/billing')).status).toBe(403);
    expect((await call('dev', '/billing')).status).toBe(403);
  });
});

it('marks notifications as read and undoes it', async () => {
  openAs('cl', '/notifications');
  await userEvent.click(
    await screen.findByRole('button', { name: /Tout marquer comme lu \(/ }).catch(() => screen.getAllByRole('button', { name: /Tout marquer comme lu/ })[0]!),
  );
  expect(await screen.findByText(/^0 non lue/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(await screen.findByText(/^4 non lues/)).toBeVisible();
});

it('limits reports to the officer’s own results', async () => {
  const data = (await (await call('hb', '/reports?creditor=all')).json()) as { scope: string; team: { id: string }[] };
  expect(data.scope).toBe('PERSONAL');
  expect(data.team.map((item) => item.id)).toEqual(['hb']);
  expect((await call('dev', '/reports?creditor=all')).status).toBe(403);
});
