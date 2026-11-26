import { billingTotals, vatNumber, type Member } from '@legarec/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { axeViolations } from '../../../../../packages/ui/src/testing';
import { resetSteering } from '../../mocks/routes/steering';
import { call, mockApi, openAs } from '../../testing';

const server = mockApi();
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
    await userEvent.click(await screen.findByRole('button', { name: '+ Créer un compte' }));
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
  it('refuses to disable an account whose cases have changed since', async () => {
    openAs('cl', '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'Désactiver Thomas Giraud' }));
    const dialog = await inDialog();
    server.use(http.post('/api/members/:id/disable', () => HttpResponse.json({ code: 'CHANGED' }, { status: 409 })));
    await userEvent.type(dialog.getByLabelText('Motif'), 'Départ');
    await userEvent.click(dialog.getByRole('button', { name: 'Désactiver' }));
    expect(await dialog.findByRole('alert')).toBeVisible();
    expect(screen.queryByText('Compte désactivé, dossiers remis au Responsable.')).toBeNull();
  });
  it('tells that the invitation of a collaborator waits for their mailbox', async () => {
    openAs('ad', '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: '+ Créer un compte' }));
    await userEvent.type(screen.getByLabelText(/Prénom/), 'Zoé');
    await userEvent.type(screen.getByLabelText(/^Nom/), 'Marchand');
    await userEvent.type(screen.getByLabelText(/Adresse professionnelle/), 'zm@legarec.fr');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer l’invitation' }));
    const dialog = await inDialog();
    expect(dialog.getByText(/dès que sa boîte est créée/)).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Envoyer l’invitation' }));
    expect(await screen.findByText('Compte créé : l’invitation part dès que la boîte existe.')).toBeVisible();
  });
  it('resets a second factor and unlocks an account, and tells the Director', async () => {
    const { members } = (await (await call('ad', '/members')).json()) as { members: Member[] };
    server.use(
      http.get('/api/members', () =>
        HttpResponse.json({
          members: members.map((item) => ({ ...item, locked: item.id === 'hb' })),
          canInvite: false,
          canDisable: false,
          canEditExtension: true,
          canSupport: true,
          creditors: [],
        }),
      ),
      http.post('/api/members/hb/unlock', () => new HttpResponse(null, { status: 204 })),
    );
    openAs('dev', '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'Gérer : Hugo Benali' }));
    const card = within(screen.getByRole('region', { name: 'Compte de Hugo Benali' }));
    expect(card.getByText('Bloqué')).toBeVisible();
    await userEvent.click(card.getByRole('button', { name: 'Débloquer' }));
    const unlocking = await inDialog();
    expect(unlocking.getByText(/Le Directeur en est prévenu/)).toBeVisible();
    await userEvent.click(unlocking.getByRole('button', { name: 'Débloquer' }));
    expect(await screen.findByText('Compte débloqué.')).toBeVisible();
    await userEvent.click(card.getByRole('button', { name: 'Réinitialiser la double authentification' }));
    const resetting = await inDialog();
    expect(resetting.getByText(/vérifié l’identité de la personne/)).toBeVisible();
    await userEvent.click(resetting.getByRole('button', { name: 'Réinitialiser' }));
    expect(await screen.findByText('Double authentification réinitialisée.')).toBeVisible();
  });
  it('keeps the window open, and says so, when the support is refused', async () => {
    openAs('dev', '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'Gérer : Hugo Benali' }));
    const card = within(screen.getByRole('region', { name: 'Compte de Hugo Benali' }));
    for (const refusal of [() => HttpResponse.json({ code: 'FORBIDDEN' }, { status: 403 }), () => HttpResponse.error()]) {
      server.use(http.post('/api/members/:id/reset-link', refusal, { once: true }));
      await userEvent.click(card.getByRole('button', { name: 'Envoyer un lien de réinitialisation' }));
      const dialog = await inDialog();
      await userEvent.click(dialog.getByRole('button', { name: 'Envoyer le lien' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('L’action n’a pas abouti');
      expect(screen.queryByText('Lien de réinitialisation envoyé.')).toBeNull();
      await userEvent.click(dialog.getByRole('button', { name: 'Annuler' }));
    }
  });
  it('has no axe violation in the account of someone, nor in what it asks to confirm', async () => {
    const { members } = (await (await call('ad', '/members')).json()) as { members: Member[] };
    server.use(
      http.get('/api/members', () =>
        HttpResponse.json({
          members: members.map((item) => ({ ...item, locked: true, activity: [{ what: 'Connexion réussie', when: 'À l’instant' }] })),
          canInvite: true,
          canDisable: true,
          canEditExtension: true,
          canSupport: true,
          creditors: [],
        }),
      ),
    );
    openAs('ad', '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: 'Gérer : Hugo Benali' }));
    const card = screen.getByRole('region', { name: 'Compte de Hugo Benali' });
    expect(card).toHaveFocus();
    expect(await axeViolations(card)).toEqual([]);
    await userEvent.click(within(card).getByRole('button', { name: 'Débloquer' }));
    expect(await axeViolations(await screen.findByRole('alertdialog'))).toEqual([]);
    // Nobody is told of what the Director does themselves.
    expect((await inDialog()).queryByText(/Le Directeur en est prévenu/)).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it.each([
    // [who, whose account, buttons shown]
    ['ad', 'Nora Petit', ['Envoyer un lien de réinitialisation', 'Réinitialiser la double authentification']],
    ['dev', 'Hugo Benali', ['Envoyer un lien de réinitialisation', 'Réinitialiser la double authentification', 'Exiger la 2FA']],
    ['dev', 'Nora Petit', []],
    ['cl', 'Hugo Benali', ['Envoyer un lien de réinitialisation', 'Exiger la 2FA']],
    ['cl', 'Nora Petit', ['Envoyer un lien de réinitialisation']],
    ['cl', 'Marie Dubreuil', []],
    ['cl', 'Camille Laurent', []],
  ])('shows to %s, for the account of %s, only what may be done', async (who, name, shown) => {
    openAs(who, '/equipe');
    await userEvent.click(await screen.findByRole('button', { name: `Gérer : ${name}` }));
    const card = within(screen.getByRole('region', { name: `Compte de ${name}` }));
    const support = ['Envoyer un lien de réinitialisation', 'Exiger la 2FA', 'Réinitialiser la double authentification', 'Débloquer'];
    expect(support.filter((label) => card.queryByRole('button', { name: label })).sort()).toEqual([...shown].sort());
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
    expect((await call('cl', '/members/hb/extension', { extension: '101' }, 'PUT')).status).toBe(403);
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
  it('says so when the API creates nothing from a template, and stands without any creditor', async () => {
    const firm = { name: 'LEGAREC', address: '[ADRESSE DU CABINET]', phone: '01 87 88 02 98', siren: '[SIREN]', vat: '[N° TVA]', signer: '' };
    server.use(
      http.get('/api/billing', () => HttpResponse.json({ firm, clients: [], documents: [], nextNumbers: { INVOICE: 'FA-2026-0001' }, stats: [] })),
      http.post('/api/billing', () => HttpResponse.json({ code: 'NOT_AVAILABLE', type: 'INVOICE' }, { status: 409 })),
    );
    openAs('ad', '/facturation');
    await userEvent.click(await screen.findByRole('button', { name: 'Émettre la facture' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Émettre la facture' }));
    expect(await screen.findByText(/n’est pas encore disponible : aucun document n’a été créé/)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // A type without a series shows no provisional number.
    await userEvent.click(screen.getByRole('button', { name: /^Devis/ }));
    expect(screen.queryByText(/\(provisoire\)/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    expect(await screen.findAllByText(/n’est pas encore disponible/)).not.toHaveLength(0);
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
