import { letterTotals, letterSchedule, type LetterRecipient } from '@legarec/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { call, mockApi, openAs } from '../../testing';

mockApi();
const inDialog = async () => within(await screen.findByRole('alertdialog'));

it('never adds the 40 € indemnity for an individual', () => {
  const recipient = { isIndividual: false, interest: 100, invoices: [{ amount: 1000 }, { amount: 2000 }] } as LetterRecipient;
  expect(letterTotals(recipient, true)).toEqual({ principal: 3000, interest: 100, indemnity: 8000, total: 11100 });
  expect(letterTotals({ ...recipient, isIndividual: true }, true).indemnity).toBe(0);
  expect(letterSchedule(100033, 4).reduce((sum, item) => sum + item.amount, 0)).toBe(100033);
});
it('confirms a registered letter and recalls the first letter', async () => {
  openAs('cl', '/documents/rediger');
  expect(await screen.findByText('LR-2026-0142')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Générer et envoyer' }));
  const dialog = await inDialog();
  expect(dialog.getByText(/ne peut plus être annulée/)).toBeVisible();
  expect(dialog.queryByText(/refacturable/)).toBeNull();
  await userEvent.click(dialog.getByRole('button', { name: 'Envoyer' }));
  expect(await screen.findByText('Document généré et envoyé à Bâtiplus SAS.')).toBeVisible();
});
it('blocks a reminder without a first letter and hides the indemnity for an individual', async () => {
  openAs('cl', '/documents/rediger');
  await userEvent.click(await screen.findByRole('button', { name: /Paul Meunier/ }));
  expect(screen.getByText(/Aucun premier courrier/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Générer et envoyer' })).toBeDisabled();
  expect(screen.queryByRole('switch', { name: /indemnité/ })).toBeNull();
  await userEvent.click(screen.getByRole('radio', { name: /Relance amiable/ }));
  expect(screen.getByRole('button', { name: 'Générer et envoyer' })).toBeEnabled();
});
it('keeps the access code and bank details as placeholders', async () => {
  openAs('cl', '/documents/rediger');
  await screen.findByText('LR-2026-0142');
  expect(document.body.textContent).toContain('[IBAN DU COMPTE DÉDIÉ]');
  expect(document.body.textContent).not.toMatch(/KXPM|FR76/);
});
it('lists receipts and scopes documents by role', async () => {
  openAs('cl', '/documents');
  await userEvent.click(await screen.findByRole('button', { name: /^Quittances/ }));
  expect((await screen.findAllByText(/Quittance 12 500 €/))[0]).toBeVisible();
  const { items } = (await (await call('hb', '/documents')).json()) as { items: { id: string }[] };
  expect(items.map((item) => item.id)).toEqual(['d5']);
  expect((await call('hb', '/documents/d2/send', {})).status).toBe(403);
  expect((await call('ad', '/documents/compose', { caseIds: ['demo'] })).status).toBe(403);
  expect((await call('dev', '/documents')).status).toBe(403);
});
