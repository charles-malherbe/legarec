import { letterAmount, letterTotals, letterSchedule, type LetterRecipient } from '@legarec/contracts';
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
it('confirms the very amount of the letter', async () => {
  const recipient = { isIndividual: false, interest: 100, invoices: [{ amount: 1000 }] } as LetterRecipient;
  expect(letterAmount('FORMAL_NOTICE', recipient, true)).toBe(5100);
  expect(letterAmount('FIRM', recipient, true)).toBe(5000);
  for (const template of ['FRIENDLY', 'PAYMENT_PLAN', 'CLEARANCE'] as const) expect(letterAmount(template, recipient, true)).toBe(1000);
  openAs('cl', '/documents/rediger');
  await userEvent.click(await screen.findByRole('radio', { name: /Relance amiable/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Générer et envoyer' }));
  expect((await inDialog()).getByText(/^48.200.€$/)).toBeVisible();
});
it('keeps the 40 € option of a batch whatever the example shown', async () => {
  openAs('cl', '/documents/rediger');
  await userEvent.click(await screen.findByRole('tab', { name: 'Envoi groupé' }));
  for (let index = 0; index < 4; index += 1) await userEvent.click(screen.getByRole('button', { name: 'Destinataire suivant' }));
  expect(screen.getByText('Exemple 5 sur 5')).toBeVisible();
  expect(screen.getByRole('switch', { name: /indemnité/ })).toBeChecked();
  expect(screen.queryByRole('button', { name: 'Enregistrer le brouillon' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /Générer et envoyer/ }));
  expect((await inDialog()).getByText('Oui, professionnels seulement')).toBeVisible();
});
it('never sends a clearance certificate for an unpaid case', async () => {
  openAs('cl', '/documents/rediger');
  await userEvent.click(await screen.findByRole('radio', { name: /Attestation de solde/ }));
  expect(screen.getByText(/n’est pas soldé/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Générer et envoyer' })).toBeDisabled();
  expect((await call('cl', '/documents/compose', { caseIds: ['demo'], template: 'CLEARANCE' })).status).toBe(422);
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
  const options = { table: true, pay: true, indemnity: false };
  const letter = { template: 'FRIENDLY', caseIds: ['demo'], filters: null, expected: 1, channel: 'LETTER', delay: 8, months: 4, options };
  expect((await call('ad', '/documents/compose', letter)).status).toBe(403);
  expect((await call('dev', '/documents')).status).toBe(403);
});
