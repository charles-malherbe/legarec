import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { App } from './app/App';
import { handlers, resetPortal, setPartner } from './mocks/handlers';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetPortal());
const openAs = (account: string, path = '/') => {
  setPartner(account);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
};
const call = (account: string, path: string, body?: unknown) => {
  setPartner(account);
  return fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
};
const inDialog = async () => within(await screen.findByRole('alertdialog'));

it('isolates each creditor in the API', async () => {
  for (const path of ['/portal/dashboard', '/portal/cases', '/portal/messages', '/portal/payouts', '/portal/documents']) {
    const other = await (await call('pr', path)).text();
    expect(other).not.toMatch(/Bâtiplus|Charpentes|Matériaux Delta|38 420/);
    expect(await (await call('cb', path)).text()).not.toMatch(/Fromagerie Durand|Énergies Rhône/);
    expect((await call('none', path)).status).toBe(401);
  }
  expect((await call('pr', '/portal/cases/f1')).status).toBe(404);
  expect((await call('pr', '/portal/plans/p1/decision', { accepted: true, reason: '' })).status).toBe(404);
  expect((await call('pr', '/portal/messages/c1', { text: 'x' })).status).toBe(404);
  await call('cb', '/portal/imports', {});
  expect((await call('pr', '/portal/imports/i1/confirm', {})).status).toBe(404);
});
it('asks for the agreement on a long plan', async () => {
  openAs('cb');
  await userEvent.click(await screen.findByRole('button', { name: 'Accepter : Bâtiplus SAS' }));
  const dialog = await inDialog();
  expect(dialog.getByText(/8 mensualités/)).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: 'Accepter l’échéancier' }));
  expect(await screen.findByText('Échéancier accepté.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Accepter : Bâtiplus SAS' })).toBeNull();
});
it('requires a reason to refuse a plan', async () => {
  openAs('cb');
  await userEvent.click(await screen.findByRole('button', { name: 'Refuser : Bâtiplus SAS' }));
  const dialog = await inDialog();
  expect(dialog.getByRole('button', { name: 'Refuser l’échéancier' })).toBeDisabled();
  expect((await call('cb', '/portal/plans/p1/decision', { accepted: false, reason: '' })).status).toBe(422);
});
it('creates nothing before the confirmation of an import', async () => {
  openAs('cb', '/depot');
  await userEvent.click(await screen.findByRole('tab', { name: 'En lot (CSV ou Excel)' }));
  await userEvent.upload(screen.getByLabelText('Déposez votre fichier CSV ou Excel'), new File(['x'], 'impayes.csv', { type: 'text/csv' }));
  expect(await screen.findByText(/Montant illisible/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Importer les 22 créances' }));
  const dialog = await inDialog();
  expect(dialog.getByText('Lignes en erreur')).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: 'Confier les 22 créances' }));
  expect(await screen.findByText(/22 créances importées/)).toBeVisible();
});
it('checks a claim, then confirms it', async () => {
  openAs('cb', '/depot');
  await userEvent.click(await screen.findByRole('button', { name: 'Déposer la créance' }));
  expect(screen.getByText('Saisissez le numéro de facture.')).toBeVisible();
  await userEvent.type(screen.getByLabelText(/Nom ou raison sociale/), 'Menuiserie Test');
  await userEvent.type(screen.getByLabelText(/SIRET/), '123');
  await userEvent.type(screen.getByLabelText(/^Adresse/), '1 rue du Test');
  await userEvent.type(screen.getByLabelText(/N° de facture/), 'F-1');
  await userEvent.type(screen.getByLabelText(/Date d'émission/), '2026-09-01');
  await userEvent.type(screen.getByLabelText(/Échéance/), '2026-10-01');
  await userEvent.type(screen.getByLabelText(/Montant TTC/), '1 250,50');
  await userEvent.click(screen.getByRole('button', { name: 'Déposer la créance' }));
  expect(await screen.findByText('Ce SIRET n’est pas valide (14 chiffres).')).toBeVisible();
  await userEvent.clear(screen.getByLabelText(/SIRET/));
  await userEvent.click(screen.getByRole('button', { name: 'Déposer la créance' }));
  await userEvent.click((await inDialog()).getByRole('button', { name: 'Confier la créance' }));
  expect(await screen.findByText(/Créance déposée/)).toBeVisible();
});
it('signs in on the creditors’ portal only', async () => {
  openAs('none');
  expect(await screen.findByRole('heading', { name: 'Connexion à votre espace créancier' })).toBeVisible();
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'cl@legarec.fr');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByText(/connectez-vous sur espace.legarec.fr/)).toBeVisible();
  await userEvent.clear(screen.getByLabelText('Adresse e-mail'));
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'c.besson@materiauxdelta.example');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  expect(await screen.findByRole('heading', { name: 'Bonjour Claire' })).toBeVisible();
});
it('never offers online payment', async () => {
  openAs('cb', '/reversements');
  await screen.findByText('15 nov. 2026');
  expect(document.body.textContent).not.toMatch(/SEPA|carte bancaire|PCI/i);
});

it('deposits several invoices of one debtor', async () => {
  openAs('cb', '/depot');
  await userEvent.click(await screen.findByRole('button', { name: 'Ajouter une autre facture' }));
  expect(screen.getByLabelText(/N° de facture, facture 2/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /Retirer cette facture/ }));
  expect(screen.queryByLabelText(/facture 2/)).toBeNull();
  const invoice = { number: 'F-1', issuedOn: '2026-09-01', dueOn: '2026-10-01', amount: 100 };
  const claim = { debtor: 'A', siret: '', email: '', phone: '', address: 'B' };
  expect((await call('cb', '/portal/claims', { ...claim, invoices: [invoice, invoice] })).status).toBe(422);
  expect((await call('cb', '/portal/claims', { ...claim, invoices: [invoice, { ...invoice, number: 'F-2' }] })).status).toBe(204);
});
