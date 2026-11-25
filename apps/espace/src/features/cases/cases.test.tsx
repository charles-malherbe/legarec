import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCases } from '../../mocks/routes/cases';
import { call, openAs, mockApi } from '../../testing';

const server = mockApi();
beforeEach(resetCases);
const confirmWith = async (label: string) => userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: label }));
const searchBody = '/cases/search?creditor=all&status=all&age=all&officer=all&page=1&size=25';

describe('case access', () => {
  it('filters lists by role on the API', async () => {
    const names = async (account: string) =>
      ((await (await call(account, searchBody, { query: '' })).json()) as { items: { name: string }[] }).items.map((item) => item.name);
    expect(await names('hb')).toEqual(['Groupe Hélio', 'Atelier Mistral', 'Imprimerie Castel']);
    expect(await names('cl')).not.toContain('Hôtel Lagarde');
    expect(await names('cl')).toContain('Paul Meunier');
    expect(await names('ad')).toHaveLength(10);
    expect((await call('dev', searchBody, { query: '' })).status).toBe(403);
  });
  it('refuses every change outside the role', async () => {
    expect((await call('ad', '/cases/demo')).status).toBe(200);
    for (const path of ['/cases/demo/reminders', '/cases/demo/payments', '/cases/demo/access-code/reveal', '/cases/demo/portal-messages'])
      expect((await call('ad', path, {})).status).toBe(403);
    expect((await call('ad', '/cases/reminders', { ids: ['demo'] })).status).toBe(403);
    expect((await call('ad', '/cases/reminders', { ids: ['lagarde'] })).status).toBe(204);
    expect((await call('hb', '/cases/demo')).status).toBe(403);
    expect((await call('hb', '/cases/assign', { ids: ['helio'], officerId: 'hb' })).status).toBe(403);
    expect((await call('dev', '/cases/demo')).status).toBe(403);
  });
  it('shows the Director a read-only file and records the consultation', async () => {
    openAs('ad', '/debiteurs/demo');
    expect(await screen.findByText('Lecture seule')).toBeVisible();
    for (const name of ['Enregistrer un paiement', 'Envoyer une relance', 'Appeler', /code d’accès/, /RGPD/])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(await screen.findByText('Dossier consulté')).toBeVisible();
  });
});

describe('case list', () => {
  it('confirms a litigation transfer with its reason and summary', async () => {
    openAs('cl', '/debiteurs');
    await userEvent.click(await screen.findByLabelText('Sélectionner Bâtiplus SAS'));
    await userEvent.click(screen.getByRole('button', { name: 'Passer en contentieux' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Passer 1 dossier en contentieux ?' });
    expect(within(dialog).getByText('Bâtiplus SAS')).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText('Motif du passage en contentieux'), 'Promesses non tenues');
    await confirmWith('Passer en contentieux');
    expect(await screen.findByText(/transmis au contentieux/)).toBeVisible();
  });
  it('covers no result and error states, without putting the search in the URL', async () => {
    const urls: string[] = [];
    server.events.on('request:start', ({ request }) => void urls.push(request.url));
    openAs('cl', '/debiteurs');
    await userEvent.type(await screen.findByRole('searchbox'), 'zzz');
    expect(await screen.findByText('Aucun résultat pour « zzz »')).toBeVisible();
    expect(urls.some((url) => url.includes('zzz'))).toBe(false);
    server.use(http.post('/api/cases/search', () => HttpResponse.json({}, { status: 500 })));
    await userEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    await userEvent.click(screen.getByRole('tab', { name: /Litige/ }));
    expect(await screen.findByText('Impossible de charger les débiteurs', {}, { timeout: 4000 })).toBeVisible();
  });
  it('lets the Collection manager see cases without an officer', async () => {
    openAs('cl', '/debiteurs');
    await userEvent.click(await screen.findByRole('tab', { name: /Sans gestionnaire/ }));
    expect(await screen.findByText('Paul Meunier')).toBeVisible();
    expect(screen.getByText('À attribuer')).toBeVisible();
  });
});

describe('case file', () => {
  it('records a cheque after confirmation, then cancels it when it bounces', async () => {
    openAs('cl', '/debiteurs/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Enregistrer un paiement' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Enregistrer le paiement' })[0]!);
    expect(screen.getByText('Indiquez un montant.')).toBeVisible();
    await userEvent.type(screen.getByLabelText(/Montant/), '1 500,50');
    await userEvent.type(screen.getByLabelText(/Numéro du chèque/), '1234567');
    await userEvent.type(screen.getByLabelText(/Banque/), 'Banque test');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le paiement' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/1\s500,50\s€/);
    await confirmWith('Enregistrer le paiement');
    await userEvent.click(await screen.findByRole('tab', { name: /Factures/ }));
    const row = (await screen.findByText('1234567 · Banque test')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Impayé' }));
    const bounce = await screen.findByRole('alertdialog', { name: 'Déclarer ce chèque impayé ?' });
    await userEvent.type(within(bounce).getByLabelText('Motif du rejet'), 'Provision insuffisante');
    await confirmWith('Déclarer impayé');
    await waitFor(() => expect(within(screen.getByText('1234567 · Banque test').closest('tr')!).getByText('Impayé')).toBeVisible());
  });
  it('keeps the access code masked until it is revealed', async () => {
    openAs('cl', '/debiteurs/demo');
    expect(await screen.findByText('••••')).toBeVisible();
    expect(document.body.textContent).not.toContain('KXPM');
    await userEvent.click(screen.getByRole('button', { name: 'Afficher le code d’accès' }));
    expect(await screen.findByText('KXPM')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Régénérer le code d’accès' }));
    await confirmWith('Régénérer le code');
    expect(await screen.findByText('••••')).toBeVisible();
  });
  it('replies to the debtor portal and shows proofs of delivery', async () => {
    openAs('cl', '/debiteurs/demo');
    await userEvent.click(await screen.findByRole('tab', { name: /Échanges/ }));
    expect(screen.getByText('non vérifié')).toBeVisible();
    expect(screen.getByText('Accusé de réception reçu')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Répondre dans l’espace débiteur'), 'Bien reçu, merci.');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la réponse' }));
    await confirmWith('Envoyer la réponse');
    expect(await screen.findByText('Bien reçu, merci.')).toBeVisible();
  });
  it('records a GDPR request', async () => {
    openAs('cl', '/debiteurs/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Enregistrer une demande RGPD' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/reçue/), 'Par courrier');
    await confirmWith('Enregistrer la demande');
    expect(await screen.findByText(/registre des données personnelles/)).toBeVisible();
  });
});

it('opens the creditor file and folds invoices', async () => {
  openAs('cl', '/creanciers');
  await userEvent.click(await screen.findByRole('link', { name: 'Matériaux Delta' }));
  expect(await screen.findByText('F-2026-0712')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Afficher les factures de Bâtiplus SAS' }));
  expect(screen.queryByText('F-2026-0712')).toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: 'Reversements' }));
  expect(screen.getByText('12 encaissements')).toBeVisible();
});

it('writes to the debtor from the case file, only with the right to act on it', async () => {
  openAs('cl', '/debiteurs/demo');
  await userEvent.click(await screen.findByRole('tab', { name: /Échanges/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Écrire un e-mail' }));
  await userEvent.type(await screen.findByLabelText(/^Objet/), 'Votre dossier');
  await userEvent.type(screen.getByLabelText(/^Message/), 'Bonjour');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
  const dialog = within(await screen.findByRole('alertdialog'));
  expect(dialog.getByText(/Camille LAURENT <cl@legarec.fr>/)).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: 'Envoyer' }));
  expect(await screen.findByText('Message envoyé.')).toBeVisible();
  const body = { to: 'x@exemple.fr', subject: 'a', paragraphs: ['b'], caseId: 'demo' };
  expect((await call('ad', '/emails/messages', body)).status).toBe(403);
  expect((await call('dev', '/emails/messages', body)).status).toBe(403);
});
