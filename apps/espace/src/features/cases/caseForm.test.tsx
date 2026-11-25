import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCases } from '../../mocks/routes/cases';
import { resetCreditors } from '../../mocks/routes/creditors';
import { call, mockApi, openAs } from '../../testing';

const server = mockApi();
beforeEach(() => {
  resetCases();
  resetCreditors();
});
const type = async (label: string, value: string) => {
  const field = await screen.findByLabelText(new RegExp(`^${label}`));
  await userEvent.clear(field);
  await userEvent.type(field, value);
};
const choose = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(new RegExp(`^${label}`)), value);
const dialog = async () => within(await screen.findByRole('alertdialog'));
const press = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));
const invoice = async (suffix = '', number = 'F-900', amount = '1 250,50', dueOn = '2026-09-01') => {
  await type(`N° de facture${suffix}`, number);
  await type(`Émise le${suffix}`, '2026-08-01');
  await type(`Échéance${suffix}`, dueOn);
  await type(`Montant TTC${suffix}`, amount);
  await type(`Reste dû${suffix}`, amount);
};
const debtor = async () => {
  await type('SIRET ou SIREN', '732 829 007');
  await type('Raison sociale(?! confirmée)', 'Boulangeries Rivaud SAS');
  await userEvent.click(screen.getByLabelText(/^Raison sociale confirmée/));
  await type('Adresse', '6 rue du Four');
  await type('Code postal', '69100');
  await type('Ville', 'Villeurbanne');
};

describe('who opens the screen', () => {
  it.each(['hb', 'dev'])('%s does not', async (account) => {
    openAs(account, '/debiteurs/nouveau');
    expect((await screen.findAllByText(/réservé/i))[0]).toBeVisible();
    expect(screen.queryByLabelText(/^Créancier/)).toBeNull();
  });
  it.each(['/debiteurs', '/', '/creanciers/md'])('an officer is not invited to it from %s', async (path) => {
    openAs('hb', path);
    await screen.findByRole('main');
    await waitFor(() => expect(screen.queryAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0));
    expect(screen.queryByRole('link', { name: /Nouveau débiteur|Nouveau dossier|Ajouter un débiteur/ })).toBeNull();
  });
  it('the manager does, from the list', async () => {
    openAs('cl', '/debiteurs');
    await userEvent.click(await screen.findByRole('link', { name: /Nouveau débiteur/ }));
    expect(await screen.findByRole('heading', { name: 'Nouveau débiteur' })).toBeVisible();
  });
  it('the file of a creditor fills it in', async () => {
    openAs('cl', '/creanciers/md');
    await userEvent.click(await screen.findByRole('link', { name: '+ Ajouter un débiteur' }));
    expect(await screen.findByLabelText(/^Créancier/)).toHaveValue('md');
    expect(await screen.findByText('Honoraires amiable')).toBeVisible();
  });
});

describe('a case', () => {
  it('is opened after a summary, then given on behalf of the Director', async () => {
    openAs('cl', '/debiteurs/nouveau?creancier=mt');
    expect(await screen.findByText('Convention signée à déposer')).toBeVisible();
    await debtor();
    await press('+ Ajouter une adresse');
    await type('E-mail 1', 'compta@rivaud.example');
    await invoice();
    await press('+ Ajouter une facture');
    await invoice(', facture 2', 'F-901', '100', '2099-01-01');
    expect(screen.getByText(/F-901 est due le/)).toBeVisible();
    expect(screen.getByText('Indemnités (1 × 40 €)')).toBeVisible();
    await choose('Gestionnaire', 'hb');
    await press('Ouvrir le dossier');
    const box = await dialog();
    for (const text of ['Médiatel', 'Boulangeries Rivaud SAS · 732 829 007', '2', 'Marie Dubreuil, Directeur']) expect(box.getByText(text)).toBeVisible();
    expect(box.getByText(/^1.350,50.€$/u)).toBeVisible();
    await userEvent.click(box.getByRole('button', { name: 'Ouvrir le dossier' }));
    expect(await screen.findByText(/^Dossier LGR-2026-\d+ ouvert\.$/u)).toBeVisible();
    const made = await call('hb', '/cases/search?creditor=all&status=all&age=all&officer=all&page=1&size=25', { query: '' });
    expect(await made.text()).toContain('Boulangeries Rivaud SAS');
  });

  it('says so when it is open and could not be given', async () => {
    server.use(http.post('/api/cases/assign', () => HttpResponse.json({}, { status: 500 })));
    openAs('cl', '/debiteurs/nouveau?creancier=md');
    await screen.findByText('Honoraires amiable');
    await debtor();
    await invoice();
    await choose('Gestionnaire', 'hb');
    await press('Ouvrir le dossier');
    await userEvent.click((await dialog()).getByRole('button', { name: 'Ouvrir le dossier' }));
    expect(await screen.findByText(/ouvert, mais pas attribué/)).toBeVisible();
  });

  it('shows what is wrong beside each field, and confirms nothing', async () => {
    openAs('cl', '/debiteurs/nouveau');
    await choose('Créancier', 'md');
    await screen.findByText('Honoraires amiable');
    await type('SIRET ou SIREN', '123 456 789');
    await type('N° de facture', 'F-1');
    await type('Émise le', '2026-08-02');
    await type('Échéance', '2026-08-01');
    await type('Montant TTC', '10');
    await type('Reste dû', '20');
    await press('Ouvrir le dossier');
    for (const text of ['Ce SIRET ou ce SIREN n’est pas valide.', 'Confirmez le nom du débiteur.', 'Indiquez l’adresse.', 'L’échéance doit suivre l’émission.'])
      expect(await screen.findByText(text)).toBeVisible();
    expect(screen.getByText('Au plus le montant de la facture.')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('of an individual asks no number and claims no 40 €', async () => {
    openAs('cl', '/debiteurs/nouveau?creancier=md');
    await screen.findByText('Honoraires amiable');
    await userEvent.click(screen.getByRole('radio', { name: /^Particulier/ }));
    expect(screen.queryByLabelText(/^SIRET ou SIREN/)).toBeNull();
    expect(screen.queryByLabelText(/^Forme juridique/)).toBeNull();
    expect(screen.getByText(/Pas d’indemnité de 40 €/)).toBeVisible();
    await invoice();
    expect(screen.getByText('Indemnités (0 × 40 €)')).toBeVisible();
  });

  it('does not open without a mandate in force', async () => {
    server.use(http.post('/api/cases/check', () => HttpResponse.json({ mandate: null, known: null, startsOn: '2026-12-01', open: null, others: [] })));
    openAs('cl', '/debiteurs/nouveau?creancier=md');
    expect(await screen.findByText('Aucun mandat actif')).toBeVisible();
    expect(screen.getByText(/prend effet le/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ouvrir le dossier' })).toBeDisabled();
  });

  it('keeps what was typed when it fails, and when the situation changed', async () => {
    let answer = () => HttpResponse.json({}, { status: 500 });
    server.use(http.post('/api/cases', () => answer()));
    openAs('cl', '/debiteurs/nouveau?creancier=md');
    await screen.findByText('Honoraires amiable');
    await debtor();
    await invoice();
    await press('Ouvrir le dossier');
    await userEvent.click((await dialog()).getByRole('button', { name: 'Ouvrir le dossier' }));
    expect(await screen.findByText('L’enregistrement n’a pas abouti')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Ville/)).toHaveValue('Villeurbanne');
    answer = () => HttpResponse.json({ code: 'NO_MANDATE' }, { status: 409 });
    if (screen.queryByRole('alertdialog')) await userEvent.click((await dialog()).getByRole('button', { name: 'Annuler' }));
    await press('Ouvrir le dossier');
    await userEvent.click((await dialog()).getByRole('button', { name: 'Ouvrir le dossier' }));
    expect(await screen.findByText(/aucun dossier ne s’ouvre\. Rien n’a été enregistré\./)).toBeVisible();
    expect(screen.getByLabelText(/^Ville/)).toHaveValue('Villeurbanne');
  });

  it('never puts the number of the debtor in an address', async () => {
    const urls: string[] = [];
    server.events.on('request:start', ({ request }) => void urls.push(request.url));
    openAs('cl', '/debiteurs/nouveau?creancier=md');
    await type('SIRET ou SIREN', '732 829 007');
    await waitFor(() => expect(urls.filter((url) => url.endsWith('/cases/check')).length).toBeGreaterThan(1));
    expect(urls.join(' ')).not.toMatch(/732|829/u);
  });
});

describe('a debtor who already has a case', () => {
  it('has the invoices added to it', async () => {
    openAs('cl', '/debiteurs/nouveau?creancier=md');
    await type('SIRET ou SIREN', '512 334 871 00088');
    expect(await screen.findByText(/Bâtiplus SAS a déjà un dossier chez/)).toBeVisible();
    expect(screen.queryByText('5. Suivi')).toBeNull();
    await invoice();
    await press('Ajouter les factures');
    const box = await dialog();
    expect(box.getByText('LGR-2026-00142 · Bâtiplus SAS')).toBeVisible();
    await userEvent.click(box.getByRole('button', { name: 'Ajouter les factures' }));
    expect(await screen.findByText('Factures ajoutées au dossier LGR-2026-00142.')).toBeVisible();
  });
  it('whom the Director only reads is not changed', async () => {
    openAs('ad', '/debiteurs/nouveau?creancier=md');
    await type('SIRET ou SIREN', '512 334 871 00088');
    expect(await screen.findByText('Lecture seule')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ajouter les factures' })).toBeDisabled();
  });
  it('is not opened under another name', async () => {
    openAs('cl', '/debiteurs/nouveau?creancier=mt');
    await debtor();
    await type('SIRET ou SIREN', '512 334 871 00088');
    expect(await screen.findByText(/Ce SIREN est déjà enregistré : Bâtiplus SAS \(entreprise\)/)).toBeVisible();
    await invoice();
    await press('Ouvrir le dossier');
    await userEvent.click((await dialog()).getByRole('button', { name: 'Ouvrir le dossier' }));
    expect(await screen.findByText(/sous un autre nom ou un autre type de débiteur : vérifiez-les\. Rien n’a été enregistré/)).toBeVisible();
    expect(screen.getByLabelText(/^Ville/)).toHaveValue('Villeurbanne');
  });
  it('at another creditor is named, without the case', async () => {
    openAs('cl', '/debiteurs/nouveau?creancier=mt');
    await type('SIRET ou SIREN', '512 334 871 00088');
    expect(await screen.findByText('Ce débiteur doit aussi à un autre créancier')).toBeVisible();
    expect(screen.getByText(/Matériaux Delta · 3 factures/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ouvrir le dossier' })).toBeEnabled();
  });
});
