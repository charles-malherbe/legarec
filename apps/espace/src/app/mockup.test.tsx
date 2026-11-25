import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { resetCases } from '../mocks/routes/cases';
import { resetCollection } from '../mocks/routes/collection';
import { resetMessages } from '../mocks/routes/messages';
import { resetSteering } from '../mocks/routes/steering';
import { call, mockApi, openAs } from '../testing';

mockApi();
afterEach(() => {
  resetCases();
  resetCollection();
  resetMessages();
  resetSteering();
});
const inDialog = async () => within(await screen.findByRole('alertdialog'));

it('keeps a draft for its author only, then resumes it', async () => {
  openAs('cl', '/e-mails');
  await userEvent.click(await screen.findByRole('button', { name: /\+ Rédiger/ }));
  await userEvent.selectOptions((await screen.findAllByLabelText('Modèle'))[0]!, 'Confirmation de promesse');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
  expect(await screen.findByText('Brouillon enregistré.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /^Brouillons/ }));
  await userEvent.click(await screen.findByRole('button', { name: /^Reprendre/ }));
  expect(screen.getByDisplayValue('Confirmation de votre engagement')).toBeVisible();
  expect(((await (await call('hb', '/emails')).json()) as { drafts: unknown[] }).drafts).toEqual([]);
});
it('lists the automatic reminders of readable cases only', async () => {
  const all = ((await (await call('cl', '/emails')).json()) as { automatic: { debtor: string }[] }).automatic;
  const own = ((await (await call('hb', '/emails')).json()) as { automatic: { debtor: string }[] }).automatic;
  expect(all.length).toBeGreaterThan(own.length);
  expect(all.map((item) => item.debtor)).not.toContain('Hôtel Lagarde');
});
it('opens the message form from a contact, without the address in the URL', async () => {
  openAs('cl', '/creanciers/md');
  await userEvent.click(await screen.findByRole('link', { name: 'c.besson@materiauxdelta.example' }));
  expect(await screen.findByLabelText(/^Destinataire/)).toHaveValue('c.besson@materiauxdelta.example');
  expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
});
it('plans a reminder on an own case, with undo', async () => {
  openAs('cl', '/relances');
  await userEvent.click(await screen.findByRole('button', { name: /Planifier une relance/ }));
  const form = screen.getByRole('button', { name: 'Planifier' });
  await userEvent.click(form);
  expect(await screen.findByText('Choisissez un débiteur.')).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Débiteur'), 'demo');
  await userEvent.type(screen.getByLabelText('Objet'), 'Point sur la promesse');
  await userEvent.click(form);
  expect(await screen.findByText('Relance planifiée.')).toBeVisible();
  const body = { caseId: 'demo', type: 'CALL', date: '2026-11-24', time: '', title: 'x' };
  expect((await call('ad', '/reminders', body)).status).toBe(403);
  expect((await call('hb', '/reminders', body)).status).toBe(403);
  expect(((await (await call('cl', '/reminders', { ...body, date: '2026-11-29' })).json()) as { limit: string }).limit).toMatch(/Dimanche/);
});
it('narrows a batch of letters by creditor', async () => {
  openAs('cl', '/documents/rediger');
  await userEvent.click(await screen.findByRole('tab', { name: 'Envoi groupé' }));
  expect(screen.getByText('38 débiteurs')).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Créancier'), 'md');
  await waitFor(() => expect(screen.getByText('13 débiteurs')).toBeVisible());
});
it('imports files after a confirmation', async () => {
  openAs('cl', '/documents');
  await userEvent.upload(await screen.findByLabelText('Déposez vos fichiers ici'), new File(['x'], 'F-2026-0712.pdf', { type: 'application/pdf' }));
  await userEvent.click(screen.getByRole('button', { name: 'Importer (1)' }));
  await userEvent.click((await inDialog()).getByRole('button', { name: 'Importer' }));
  expect(await screen.findByText('Fichiers importés : 1 rattaché, 0 à classer.')).toBeVisible();
});
it('manages an account and refuses a second holder of a unique role', async () => {
  openAs('cl', '/parametres/users');
  await userEvent.click(await screen.findByRole('button', { name: 'Gérer : Hugo Benali' }));
  await userEvent.selectOptions(screen.getByLabelText('Rôle'), 'DEVELOPER');
  await userEvent.click(screen.getByRole('button', { name: 'Changer le rôle' }));
  await userEvent.click((await inDialog()).getByRole('button', { name: 'Changer le rôle' }));
  expect(await screen.findByText(/unique et déjà attribué à Nora Petit/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Envoyer un lien de réinitialisation' }));
  await userEvent.click((await inDialog()).getByRole('button', { name: 'Envoyer le lien' }));
  expect(await screen.findByText('Lien de réinitialisation envoyé.')).toBeVisible();
});
it('keeps creditor accounts away from the Developer and roles away from officers', async () => {
  expect(await (await call('dev', '/members')).text()).not.toMatch(/Besson|Matériaux Delta/);
  expect((await call('dev', '/members/cb/reset-link', {})).status).toBe(403);
  expect((await call('dev', '/members/hb/role', { role: 'CLAIMS_OFFICER' }, 'PUT')).status).toBe(403);
  expect((await call('hb', '/members/sm/role', { role: 'CLAIMS_OFFICER' }, 'PUT')).status).toBe(403);
  expect((await call('cl', '/members/cl/role', { role: 'DIRECTOR' }, 'PUT')).status).toBe(403);
  expect((await call('cl', '/members/cb/role', { role: 'CLAIMS_OFFICER' }, 'PUT')).status).toBe(403);
  expect((await call('cl', '/members/lp/enable', {})).status).toBe(204);
});
