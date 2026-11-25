import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { App } from './app/App';
import { handlers, openSession, resetDebtors, unverified } from './mocks/handlers';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDebtors());
const open = (path = '/', debtor: string | null = null) => {
  openSession(debtor);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
};
const call = (path: string, body?: unknown) =>
  fetch(`/api/debtor${path}`, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const inDialog = async () => within(await screen.findByRole('alertdialog'));
const access = (value: string, code: string, kind = 'SIREN') => call('/access', { identifier: { kind, value }, code, remember: false });

it('opens the file with a SIREN and a lowercase code, never in the URL', async () => {
  open();
  await userEvent.type(await screen.findByLabelText('SIREN'), '732829320');
  await userEvent.type(screen.getByLabelText('Code d’accès'), 'kxpm');
  expect(screen.getByLabelText('Code d’accès')).toHaveValue('KXPM');
  expect(screen.getByLabelText('Code d’accès')).toHaveAttribute('type', 'text');
  await userEvent.click(screen.getByRole('button', { name: 'Accéder à mon dossier' }));
  expect(await screen.findByRole('heading', { name: 'Bonjour Monsieur Durand' })).toBeVisible();
  expect(window.location.href).not.toMatch(/KXPM|732/);
});
it('checks the SIREN key and the code', async () => {
  open();
  await userEvent.type(await screen.findByLabelText('SIREN'), '732829321');
  await userEvent.type(screen.getByLabelText('Code d’accès'), 'KOIM');
  await userEvent.click(screen.getByRole('button', { name: 'Accéder à mon dossier' }));
  expect(screen.getByText('Ce SIREN n’est pas valide (9 chiffres).')).toBeVisible();
  expect(screen.getByText('Le code comporte 4 lettres, sans I ni O.')).toBeVisible();
});
it('pre-fills the identifier from an opaque link, never the code', async () => {
  open('/demo');
  expect(await screen.findByLabelText('SIREN')).toHaveValue('732 829 320');
  expect(screen.getByLabelText('Code d’accès')).toHaveValue('');
});
it('locks after 5 failures, blocks after 10', async () => {
  const codes: string[] = [];
  for (let index = 0; index < 11; index += 1) codes.push(((await (await access('732829320', 'ZZZZ')).json()) as { code: string }).code);
  expect(codes.slice(0, 4)).toEqual(['INVALID', 'INVALID', 'INVALID', 'INVALID']);
  expect(codes[4]).toBe('LOCKED');
  expect(codes.at(-1)).toBe('BLOCKED');
  expect(((await (await access('732829320', 'KXPM')).json()) as { code: string }).code).toBe('BLOCKED');
});
it('shows the same answer for an unknown debtor and a wrong code', async () => {
  const unknown = await (await access('552081317', 'KXPM')).json();
  const wrong = await (await access('732829320', 'ZZZZ')).json();
  expect(unknown).toEqual(wrong);
});
it('stops a sweep over many debtors from one address', async () => {
  const codes: number[] = [];
  for (let index = 0; index < 22; index += 1) codes.push((await access(`LGR-2026-${String(10000 + index)}`, 'ZZZZ', 'REFERENCE')).status);
  expect(codes[0]).toBe(401);
  expect(codes.at(-1)).toBe(429);
});
it('sends the code by SMS after confirmation, with a limit', async () => {
  open();
  await userEvent.type(await screen.findByLabelText('SIREN'), '732829320');
  await userEvent.click(screen.getByRole('button', { name: 'Recevoir mon code par SMS' }));
  await userEvent.click((await inDialog()).getByRole('button', { name: 'Envoyer le SMS' }));
  expect(await screen.findByText(/Si un numéro est enregistré/)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/06 ••/);
  const unknown = await (await call('/code-by-sms', { kind: 'SIREN', value: '552081317' })).json();
  expect(unknown).toEqual({ requested: true });
  for (let index = 0; index < 2; index += 1) await call('/code-by-sms', { kind: 'SIREN', value: '732829320' });
  expect((await call('/code-by-sms', { kind: 'SIREN', value: '732829320' })).status).toBe(429);
});
it('reveals nothing about the debt in the limited access', async () => {
  open('/acces-limite');
  expect(await screen.findByText('[IBAN DU COMPTE DÉDIÉ]')).toBeVisible();
  expect(document.body.textContent).not.toMatch(/Énergies Rhône|agissant pour le compte|5 320|Durand|LGR-2026/);
  await userEvent.type(screen.getByLabelText('Votre nom'), 'Test');
  await userEvent.type(screen.getByLabelText('Votre message'), 'Bonjour');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
  await userEvent.click((await inDialog()).getByRole('button', { name: 'Envoyer le message' }));
  expect(await screen.findByText(/Message reçu par Legarec/)).toBeVisible();
  expect(unverified).toEqual([expect.objectContaining({ verified: false, text: 'Bonjour' })]);
});
it('isolates each debtor', async () => {
  openSession('meunier');
  expect((await call('/cases/c1')).status).toBe(404);
  expect((await call('/cases/c1/messages')).status).toBe(404);
  expect((await call('/cases/c1/requests', { kind: 'CALLBACK', phone: '0612345678', slot: 'MORNING' })).status).toBe(404);
  openSession(null);
  expect((await call('/cases/c1')).status).toBe(401);
});
it('never adds the 40 € indemnity for an individual and offers no online payment', async () => {
  open('/espace', 'meunier');
  await screen.findByText('Solde restant à régler');
  expect(screen.queryByText(/Indemnité forfaitaire/)).toBeNull();
  expect(document.body.textContent).not.toMatch(/carte bancaire|SEPA|PCI/i);
});
it('shows the transfer and cheque instructions, without any payment form', async () => {
  open('/espace/payer', 'durand');
  expect(await screen.findByText('[IBAN DU COMPTE DÉDIÉ]')).toBeVisible();
  await userEvent.click(screen.getByRole('tab', { name: 'Chèque' }));
  expect(screen.getByText('[ORDRE DES CHÈQUES]')).toBeVisible();
  expect(document.querySelectorAll('main input, main form')).toHaveLength(0);
});
it('sends a message with an acknowledgment, as plain text', async () => {
  open('/espace/messages', 'durand');
  await userEvent.type(await screen.findByLabelText('Votre message'), '<b>Bonjour</b>');
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
  await userEvent.click((await inDialog()).getByRole('button', { name: 'Envoyer le message' }));
  expect(await screen.findByText('Reçu par Legarec à l’instant')).toBeVisible();
  expect(screen.getByText('<b>Bonjour</b>')).toBeVisible();
});
it('sends a guided request as a structured message', async () => {
  open('/espace/demandes', 'durand');
  await userEvent.click(await screen.findByRole('radio', { name: /6 mois/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer ma demande d’échéancier' }));
  expect((await inDialog()).getByText(/6 mensualités de/)).toBeVisible();
  await userEvent.click((await inDialog()).getByRole('button', { name: 'Envoyer ma demande' }));
  expect(await screen.findByText(/en attente de validation/)).toBeVisible();
  await waitFor(async () => expect(await (await call('/cases/c1/messages')).text()).toContain('Demande d’échéancier'));
});
it('switches between the files of a debtor and shows the plan', async () => {
  open('/espace/echeancier', 'durand');
  expect(await screen.findByText('Aucun échéancier')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /LGR-2026-00204/ }));
  expect(await screen.findByText('2/3')).toBeVisible();
  expect(screen.getByText('À payer')).toBeVisible();
});
