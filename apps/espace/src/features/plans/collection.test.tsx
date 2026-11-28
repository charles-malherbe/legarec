import { planApprovals, splitPlan } from '@legarec/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCollection } from '../../mocks/routes/collection';
import { call, mockApi, openAs } from '../../testing';

mockApi();
beforeEach(resetCollection);
const inDialog = async () => within(await screen.findByRole('alertdialog'));

it('splits plans without losing a cent and applies the approval chain', () => {
  for (const months of [2, 3, 7, 24]) expect(splitPlan(2960033, months).reduce((a, b) => a + b, 0)).toBe(2960033);
  expect(planApprovals(6, 6, false)).toEqual([]);
  expect(planApprovals(7, 6, false)).toEqual(['COLLECTION_MANAGER', 'CREDITOR']);
  expect(planApprovals(7, 6, true)).toEqual(['CREDITOR']);
});

describe('payment plans', () => {
  it('requires a reason to refuse and offers neither card nor direct debit', async () => {
    openAs('cl', '/echeanciers');
    await userEvent.click(await screen.findByRole('button', { name: 'Refuser l’échéancier de Garage Valmont' }));
    const dialog = await inDialog();
    expect(dialog.getByRole('button', { name: 'Refuser la demande' })).toBeDisabled();
    await userEvent.type(dialog.getByLabelText('Motif du refus'), 'Accord refusé');
    await userEvent.click(dialog.getByRole('button', { name: 'Refuser la demande' }));
    expect(await screen.findByText('Refusé · le gestionnaire est prévenu')).toBeVisible();
    expect(document.body.textContent).not.toMatch(/SEPA|Carte bancaire/);
  });
  it('asks for the creditor agreement above the threshold', async () => {
    openAs('cl', '/echeanciers');
    await userEvent.click(await screen.findByRole('button', { name: /Nouvel échéancier/ }));
    const plus = screen.getByRole('button', { name: 'Une mensualité de plus' });
    for (let i = 0; i < 3; i += 1) await userEvent.click(plus);
    expect(screen.getByText(/exige son accord/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Demander l’accord du créancier' }));
    expect((await inDialog()).getByText(/Responsable du recouvrement, puis/)).toBeVisible();
  });
  it('reserves validation to the Collection manager', async () => {
    expect((await call('ad', '/payment-plans/requests/q1', { decision: 'APPROVED', version: 1 }, 'PUT')).status).toBe(403);
    expect((await call('hb', '/payment-plans/requests/q1', { decision: 'APPROVED', version: 1 }, 'PUT')).status).toBe(403);
    openAs('ad', '/echeanciers');
    expect(await screen.findAllByText('En attente du Responsable')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Valider/ })).toBeNull();
  });
});

describe('litigation', () => {
  it('confirms the next step with its summary', async () => {
    openAs('cl', '/contentieux');
    await userEvent.click(await screen.findByRole('button', { name: 'Passer à : Injonction de payer' }));
    const dialog = await inDialog();
    expect(dialog.getByText('Charpentes Bellet · SIRET 607 529 179 00006')).toBeVisible();
    expect(dialog.getByText('Injonction de payer')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Confirmer l’étape' }));
    expect(await screen.findByText('Étape enregistrée : Injonction de payer.')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Passer à : Titre exécutoire' })).toBeVisible();
    expect(screen.getByText('Contentieux : Injonction de payer')).toBeVisible();
  });
  it('asks for the agreement of the creditor before any step, with a box to tick', async () => {
    openAs('cl', '/contentieux');
    await userEvent.click(await screen.findByRole('button', { name: /Garage Valmont/ }));
    expect(screen.queryByRole('button', { name: /^Passer à/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Noter l’accord du créancier' }));
    const dialog = await inDialog();
    expect(dialog.getByRole('button', { name: 'Noter l’accord' })).toBeDisabled();
    await userEvent.click(dialog.getByLabelText('Accord écrit du créancier reçu'));
    await userEvent.click(dialog.getByRole('button', { name: 'Noter l’accord' }));
    expect(await screen.findByText('Accord du créancier noté.')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Passer à : Injonction de payer' })).toBeVisible();
  });
  it('closes a procedure with its outcome and saves the court and the partner', async () => {
    openAs('cl', '/contentieux');
    const court = await screen.findByLabelText(/Juridiction/);
    await userEvent.clear(court);
    await userEvent.type(court, 'Tribunal de commerce de Paris');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Juridiction et intervenant enregistrés.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clore la procédure' }));
    const dialog = await inDialog();
    expect(dialog.getByText('Irrécouvrable')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Clore la procédure' }));
    expect(await screen.findByText('Procédure close : irrécouvrable.')).toBeVisible();
  });
  it('is read-only for the Director, scoped for a Claims officer, and keeps the rules of the steps', async () => {
    expect((await call('ad', '/litigation/bellet/stage', { stage: 'PAYMENT_ORDER', version: 1 })).status).toBe(403);
    const { cases } = (await (await call('hb', '/litigation')).json()) as { cases: { id: string }[] };
    expect(cases.map((item) => item.id)).toEqual(['fabre', 'pixelia']);
    expect((await call('dev', '/litigation')).status).toBe(403);
    expect((await call('hb', '/litigation/bellet/consent', { version: 1 })).status).toBe(404);
    expect((await call('cl', '/litigation/valmont/stage', { stage: 'PAYMENT_ORDER', version: 1 })).status).toBe(409);
    expect((await call('cl', '/litigation/bellet/stage', { stage: 'ENFORCEMENT', version: 1 })).status).toBe(409);
    expect((await call('cl', '/litigation/bellet/stage', { stage: 'PAYMENT_ORDER', version: 7 })).status).toBe(409);
    expect((await call('cl', '/litigation/morin', { court: '', partnerName: '', version: 1 }, 'PUT')).status).toBe(409);
  });
});

describe('reminders', () => {
  it('warns about contact limits and undoes a postponement', async () => {
    openAs('cl', '/relances');
    expect(await screen.findByText('1 relance hors des limites de contact', {}, { timeout: 5000 })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reporter : Fromagerie Durand' }));
    expect(await screen.findByText(/reportée au 22\/11\/2026/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(await screen.findByRole('button', { name: 'Reporter : Fromagerie Durand' })).toBeVisible();
  });
  it('confirms a send and filters by type', async () => {
    openAs('cl', '/relances');
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer : Atelier Mistral' }, { timeout: 5000 }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByText('Relance envoyée.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^E-mail/ }));
    expect(screen.queryByText('Répondre à la contestation')).toBeNull();
  });
  it('shows the day typed in the date field, and the week by the hour', async () => {
    openAs('cl', '/relances');
    const day = await screen.findByLabelText('Jour affiché à droite', {}, { timeout: 5000 });
    await userEvent.clear(day);
    await userEvent.type(day, '25/11/2026');
    expect(await screen.findByRole('heading', { name: 'Mercredi 25 novembre' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Semaine' }));
    expect(await screen.findByText('08 h')).toBeInTheDocument();
    expect(screen.getByText('Horaires')).toBeInTheDocument();
  });
  it('hides other officers’ reminders', async () => {
    const { items } = (await (await call('hb', '/reminders')).json()) as { items: { officerId: string }[] };
    expect(new Set(items.map((item) => item.officerId))).toEqual(new Set(['hb']));
    expect((await call('hb', '/reminders/r0', { done: true }, 'PUT')).status).toBe(403);
  });
});
