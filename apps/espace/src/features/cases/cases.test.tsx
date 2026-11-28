import { formatCents } from '@legarec/contracts';
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
    for (const [path, body] of [
      ['/cases/demo/reminders', { channel: 'EMAIL', template: 'FRIENDLY', recipient: 'compta@batiplus.example', message: 'Bonjour' }],
      ['/cases/demo/payments', { method: 'TRANSFER', amount: 10000, receivedOn: '2026-11-24', label: 'Virement', reconciled: true }],
      ['/cases/demo/access-code/regenerate', { version: 1 }],
      ['/cases/demo/portal-messages', { text: 'Bonjour' }],
    ] as const)
      expect((await call('ad', path, body)).status).toBe(403);
    const friendly = (...ids: string[]) => ({ items: ids.map((id) => ({ id, template: 'FRIENDLY' })) });
    expect((await call('ad', '/cases/reminders', friendly('demo'))).status).toBe(403);
    expect((await call('ad', '/cases/reminders/preview', { ids: ['demo'] })).status).toBe(403);
    expect((await call('ad', '/cases/reminders', friendly('lagarde'))).status).toBe(200);
    // A case of someone else answers as one that does not exist, and stops the whole.
    expect((await call('hb', '/cases/reminders', friendly('helio', 'demo'))).status).toBe(404);
    expect((await call('hb', '/cases/reminders/preview', { ids: ['helio', 'demo'] })).status).toBe(404);
    // Refused, unlike a case that does not exist (question 141).
    expect((await call('hb', '/cases/demo')).status).toBe(403);
    expect((await call('hb', '/cases/inconnu')).status).toBe(404);
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
    await userEvent.click(within(dialog).getByLabelText(/Accord écrit du créancier reçu/));
    let sent: unknown;
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/cases/litigation'))
        void request
          .clone()
          .json()
          .then((body) => (sent = body));
    });
    await confirmWith('Passer en contentieux');
    expect(await screen.findByText(/transmis au contentieux/)).toBeVisible();
    expect(sent).toMatchObject({ reason: 'Promesses non tenues', consentReceived: true });
  });
  it('confirms grouped reminders level by level, sends what was confirmed, and keeps the cases left out selected', async () => {
    openAs('cl', '/debiteurs');
    await userEvent.click(await screen.findByLabelText('Sélectionner Bâtiplus SAS'));
    await userEvent.click(screen.getByLabelText('Sélectionner Paul Meunier'));
    let sent: unknown;
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/cases/reminders'))
        void request
          .clone()
          .json()
          .then((body) => (sent = body));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer une relance' }));
    // Only the debtors who will receive one are counted and named; the level is said, and who is left out.
    const dialog = await screen.findByRole('alertdialog', { name: 'Envoyer une relance à 1 débiteur ?' });
    expect(within(dialog).getByText('Bâtiplus SAS')).toBeVisible();
    expect(within(dialog).getByText('1 rappel amiable')).toBeVisible();
    expect(within(dialog).getByText('1 non envoyé : les relances par e-mail ne s’adressent pas à un particulier (1)')).toBeVisible();
    await confirmWith('Envoyer les relances');
    expect(
      await screen.findByText(
        '1 relance(s) programmée(s) pour envoi immédiat. 1 non envoyé : les relances par e-mail ne s’adressent pas à un particulier (1).',
      ),
    ).toBeVisible();
    expect(sent).toEqual({ items: [{ id: 'demo', template: 'FRIENDLY' }] });
    await waitFor(() => expect(screen.getByLabelText('Sélectionner Bâtiplus SAS')).not.toBeChecked());
    expect(screen.getByLabelText('Sélectionner Paul Meunier')).toBeChecked();
    // Nothing can leave: said at once, without a confirmation.
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer une relance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Aucune relance ne peut partir. 1 non envoyé : les relances par e-mail ne s’adressent pas à un particulier (1).',
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('leaves out a case whose reminder is no longer the one confirmed, and one reminded less than a week ago', async () => {
    const send = async (template: string) => (await call('cl', '/cases/reminders', { items: [{ id: 'demo', template }] })).json() as Promise<unknown>;
    expect(await send('FIRM')).toEqual({ queued: 0, skipped: [{ id: 'demo', reason: 'LEVEL_CHANGED' }] });
    expect(await send('FRIENDLY')).toEqual({ queued: 1, skipped: [] });
    expect(await send('FIRM')).toEqual({ queued: 0, skipped: [{ id: 'demo', reason: 'TOO_SOON' }] });
    expect(await (await call('cl', '/cases/reminders/preview', { ids: ['demo'] })).json()).toEqual({
      items: [{ id: 'demo', template: null, reason: 'TOO_SOON' }],
    });
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
  it('sends a reminder after a confirmation with its summary, as codes, and says why one is refused', async () => {
    openAs('cl', '/debiteurs/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer une relance' }));
    const sent: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/cases/demo/reminders'))
        void request
          .clone()
          .json()
          .then((body) => sent.push(body));
    });
    // A text is not open yet: the API refuses it, and the form says why; nothing has left.
    expect(await screen.findByLabelText('Canal')).toHaveValue('EMAIL');
    expect(screen.queryByLabelText('Message')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Canal'), 'SMS');
    expect(screen.getByLabelText('Message')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la relance' }));
    await confirmWith('Envoyer la relance');
    expect(await screen.findByText('La relance n’est pas partie : ce mode d’envoi n’est pas encore disponible.')).toBeVisible();
    // By e-mail, to an address of the case.
    await userEvent.selectOptions(screen.getByLabelText('Canal'), 'EMAIL');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la relance' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Envoyer cette relance ?' });
    expect(within(dialog).getByText('Relance ferme (niveau 3)')).toBeVisible();
    expect(within(dialog).getByText('E-mail')).toBeVisible();
    // What the e-mail of this level announces: the principal and the indemnities, without the interest of a formal notice.
    const shown = (await (await call('cl', '/cases/demo')).json()) as { principal: number; fees: number; interest: number };
    expect(shown.interest).toBeGreaterThan(0);
    expect(within(dialog).getByText('Montant').parentElement?.textContent).toBe(`Montant${formatCents(shown.principal + shown.fees)}`);
    await confirmWith('Envoyer la relance');
    expect(await screen.findByText('Relance envoyée.')).toBeVisible();
    expect(sent.map((body) => (body as { channel: string; template: string }).channel)).toEqual(['SMS', 'EMAIL']);
    expect(sent[1]).toMatchObject({ channel: 'EMAIL', template: 'FIRM', recipient: expect.stringContaining('@') as string });
    // A typed text goes with the channels that take one; an e-mail carries none.
    expect(sent[0]).toHaveProperty('message');
    expect(sent[1]).not.toHaveProperty('message');
  });
  it('lets the manager override the cap of contacts with a reason (question 214)', async () => {
    const body = { channel: 'EMAIL', template: 'FRIENDLY', recipient: 'compta@exemple.test' };
    // The cap of the debtor reached (two e-mails a week by default).
    for (let index = 0; index < 2; index += 1) expect((await call('cl', '/cases/demo/reminders', body)).status).toBe(204);
    openAs('cl', '/debiteurs/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer une relance' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer la relance' }));
    await confirmWith('Envoyer la relance');
    expect(await screen.findByText('La relance n’est pas partie : le plafond de contacts de ce débiteur est atteint.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Déroger au plafond' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Déroger au plafond de contacts ?' }));
    await userEvent.type(dialog.getByLabelText('Motif de la dérogation'), 'Court');
    expect(dialog.getByRole('button', { name: 'Envoyer en dérogation' })).toBeDisabled();
    await userEvent.type(dialog.getByLabelText('Motif de la dérogation'), ' : demande du débiteur');
    await userEvent.click(dialog.getByRole('button', { name: 'Envoyer en dérogation' }));
    expect(await screen.findByText('Relance envoyée, en dérogation au plafond de contacts.')).toBeVisible();
  });
  it('shows the access code in clear to those who act on the case, and to nobody else', async () => {
    openAs('cl', '/debiteurs/demo');
    expect(await screen.findByText('KXPM')).toBeVisible();
    expect(await (await call('cl', '/cases/demo')).text()).not.toContain('KXPM');
    await userEvent.click(screen.getByRole('button', { name: 'Régénérer le code d’accès' }));
    await confirmWith('Régénérer le code');
    expect(await screen.findByText('BRTV')).toBeVisible();
    for (const [account, status] of [
      ['ad', 403],
      ['hb', 404],
      ['dev', 403],
    ] as const)
      expect((await call(account, '/cases/demo/access-code')).status).toBe(status);
  });
  it('lets the manager correct the debtor in all its cases, after a confirmation (question 138)', async () => {
    openAs('cl', '/debiteurs/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Corriger le débiteur' }));
    const name = screen.getByLabelText(/Nom du débiteur/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Bâti Plus Rénovation');
    await userEvent.click(screen.getAllByRole('button', { name: 'Corriger le débiteur' }).at(-1)!);
    await confirmWith('Corriger le débiteur');
    expect(await screen.findByText('Débiteur corrigé.')).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Bâti Plus Rénovation' })).toBeVisible();
    // Neither an officer.
    expect((await call('hb', '/cases/demo/debtor', { kind: 'COMPANY', name: 'X', seen: 'Bâti Plus Rénovation' }, 'PUT')).status).toBe(403);
  });
  it('refuses a case of someone else, and does not find an unknown one (question 141)', async () => {
    const first = openAs('hb', '/debiteurs/demo');
    expect(await screen.findByText(/Ce dossier est suivi par un autre collaborateur/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Accès réservé' })).toBeVisible();
    first.unmount();
    openAs('hb', '/debiteurs/inconnu');
    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeVisible();
  });
  it('shows the access code read only once the case is closed (question 140)', async () => {
    openAs('hb', '/debiteurs/castel');
    expect(await screen.findByText('Dossier clos : le code ne peut plus être régénéré d’ici.')).toBeVisible();
    expect(screen.getByText('KXPM')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Régénérer le code d’accès' })).toBeNull();
  });
  it('says that a code can no longer be read, and draws another one', async () => {
    server.use(http.get('/api/cases/demo/access-code', () => HttpResponse.json({ code: null, version: 1, closed: false }), { once: true }));
    openAs('cl', '/debiteurs/demo');
    expect(await screen.findByText('Illisible : régénérez-le')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Régénérer le code d’accès' }));
    await confirmWith('Régénérer le code');
    expect(await screen.findByText('BRTV')).toBeVisible();
  });
  it('does not replace the code that a colleague has just given', async () => {
    openAs('cl', '/debiteurs/demo');
    expect(await screen.findByText('KXPM')).toBeVisible();
    await call('cl', '/cases/demo/access-code/regenerate', { version: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Régénérer le code d’accès' }));
    await confirmWith('Régénérer le code');
    expect(await screen.findByText(/Le code vient de changer/)).toBeVisible();
    expect(await screen.findByText('BRTV')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
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
