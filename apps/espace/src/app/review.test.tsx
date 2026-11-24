import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { resetAccounts } from '../mocks/routes/account';
import { resetCases } from '../mocks/routes/cases';
import { resetCollection } from '../mocks/routes/collection';
import { resetMessages } from '../mocks/routes/messages';
import { resetSettings } from '../mocks/routes/settings';
import { resetSteering } from '../mocks/routes/steering';
import { call, mockApi, openAs } from '../testing';

const server = mockApi();
afterEach(() => {
  resetCases();
  resetCollection();
  resetMessages();
  resetSettings();
  resetSteering();
  resetAccounts();
});
const inDialog = async () => within(await screen.findByRole('alertdialog'));
const status = async (account: string, path: string, body?: unknown, method?: string) => (await call(account, path, body, method)).status;

describe('accounts', () => {
  it('never reactivates a second holder of a unique role, nor an invitation', async () => {
    expect(await status('cl', '/members/dev/disable', { reason: 'x' })).toBe(204);
    expect(await status('cl', '/members/hb/role', { role: 'DEVELOPER' }, 'PUT')).toBe(204);
    expect(await status('cl', '/members/dev/enable', {})).toBe(409);
    expect(await status('cl', '/members/nk/enable', {})).toBe(403);
  });
  it.each([
    [{ role: 'SUPERADMIN', email: 'a@legarec.fr' }, 422],
    [{ role: 'CREDITOR', email: 'a@exemple.fr' }, 422],
    [{ role: 'CREDITOR', email: 'a@exemple.fr', creditorId: 'zz' }, 422],
    [{ role: 'CLAIMS_OFFICER', email: 'a@exemple.fr' }, 422],
    [{ role: 'CLAIMS_OFFICER', email: 'hb@legarec.fr' }, 409],
    [{ role: 'CREDITOR', email: 'a@exemple.fr', creditorId: 'md' }, 204],
  ])('checks an invitation %j', async (body, expected) => {
    expect(await status('cl', '/members', { firstName: 'A', lastName: 'B', ...body })).toBe(expected);
  });
  it('keeps the Director out of reach and the support under the technical delegation', async () => {
    expect(await status('cl', '/members/ad/reset-link', {})).toBe(403);
    expect(await status('cl', '/members/ad/require-2fa', {})).toBe(403);
    expect(await status('dev', '/members/ad/require-2fa', {})).toBe(403);
    expect(await status('dev', '/members/hb/reset-link', {})).toBe(204);
    await call('ad', '/delegations/technical', { active: false }, 'PUT');
    expect(await status('dev', '/members/hb/reset-link', {})).toBe(403);
    expect(await status('dev', '/members/hb/extension', { extension: '1' }, 'PUT')).toBe(403);
  });
  it('assigns cases to active accounts that may hold them', async () => {
    for (const officerId of ['dev', 'lp', 'cb', 'zz', '']) expect(await status('cl', '/cases/assign', { ids: ['demo'], officerId })).toBe(422);
    expect(await status('cl', '/cases/assign', { ids: ['demo'], officerId: 'hb' })).toBe(204);
  });
  it('describes the end of a creditor account without any mailbox', async () => {
    openAs('cl', '/parametres/users');
    await userEvent.click(await screen.findByRole('tab', { name: /Créanciers/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Désactiver Claire Besson' }));
    const dialog = await inDialog();
    expect(dialog.queryByText(/boîte OVH/)).toBeNull();
    expect(dialog.getByText(/portail partenaires/)).toBeVisible();
  });
});

describe('messages', () => {
  const base = { subject: 'a', paragraphs: ['b'], statement: false };
  it.each([
    ['ad', { to: 'compta@batiplus.example', caseId: '' }, 422],
    ['ad', { to: 'compta@batiplus.example', caseId: 'lagarde' }, 422],
    ['ad', { to: 'a@b.fr,compta@batiplus.example', caseId: null }, 422],
    ['ad', { to: '<compta@batiplus.example>', caseId: null }, 422],
    ['ad', { to: 'J.Ferrand@batiplus.example', caseId: null }, 403],
    ['hb', { to: 'contact@nordis.example', caseId: 'helio' }, 422],
    ['cl', { to: 'tiers@exemple.fr', caseId: 'demo', statement: true }, 422],
    ['cl', { to: 'tiers@exemple.fr', caseId: null, statement: true }, 422],
    ['cl', { to: 'j.ferrand@batiplus.example', caseId: 'demo', statement: true }, 204],
  ])('checks %s writing %j', async (account, body, expected) => {
    expect(await status(account, '/emails/messages', { ...base, ...body })).toBe(expected);
  });
  it('writes to the chosen contact of the case', async () => {
    openAs('cl', '/debiteurs/demo');
    await userEvent.click(await screen.findByRole('button', { name: 'Écrire à j.ferrand@batiplus.example' }));
    const field = await screen.findByLabelText(/^Destinataire/);
    expect(field).toHaveValue('j.ferrand@batiplus.example');
    expect(field).toHaveAttribute('readonly');
    await waitFor(() => expect(field).toHaveFocus());
  });
  it('resumes a case draft with its case, and never suggests a second sending', async () => {
    await call('cl', '/emails/drafts', { to: 'compta@batiplus.example', subject: 'Point', text: 'Bonjour', caseId: 'demo' });
    server.use(http.delete('/api/emails/drafts/:id', () => new HttpResponse(null, { status: 500 })));
    openAs('cl', '/e-mails');
    await userEvent.click(await screen.findByRole('button', { name: /^Brouillons/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reprendre : Point' }));
    expect(screen.getAllByRole('checkbox', { name: 'Joindre le relevé de compte' })[0]).toBeVisible();
    await userEvent.click(screen.getAllByRole('button', { name: 'Envoyer' })[0]!);
    const dialog = await inDialog();
    expect(dialog.getByText(/Bâtiplus SAS/)).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByText(/ne le renvoyez pas/)).toBeVisible();
    expect(screen.queryByText(/Rien n’est parti/)).toBeNull();
  });
});

describe('reminders', () => {
  const body = { caseId: 'demo', type: 'SMS', date: '2026-11-24', time: '', title: 'x' };
  it('refuses a past date, an odd hour and warns outside the hours', async () => {
    expect(await status('cl', '/reminders', { ...body, date: '2020-01-01' })).toBe(422);
    expect(await status('cl', '/reminders', { ...body, time: '25:99' })).toBe(422);
    expect(await (await call('cl', '/reminders', { ...body, time: '22:30' })).text()).toMatch(/hors des plages/);
  });
  it('only deletes what was planned by hand, with identifiers never reused', async () => {
    const first = ((await (await call('cl', '/reminders', body)).json()) as { id: string }).id;
    expect(await status('cl', `/reminders/${first}`, undefined, 'DELETE')).toBe(204);
    const second = ((await (await call('cl', '/reminders', body)).json()) as { id: string }).id;
    expect(second).not.toBe(first);
    const { items } = (await (await call('cl', '/reminders')).json()) as { items: { id: string; canAct: boolean; done: boolean }[] };
    const seeded = items.find((item) => item.canAct && !item.done && item.id !== second);
    expect(await status('cl', `/reminders/${seeded?.id}`, undefined, 'DELETE')).toBe(403);
  });
});

describe('documents and letters', () => {
  it('refuses disguised files and leaves the Director’s imports to be filed', async () => {
    const send = async (account: string, type: string) => {
      await call(account, '/account');
      return fetch('/api/documents/import', { method: 'POST', headers: { 'content-type': type }, body: 'x' });
    };
    for (const type of ['text/html;x=pdf', 'application/vnd.ms-word.document.macroEnabled.12', 'application/pdf-x'])
      expect((await send('cl', type)).status).toBe(415);
    expect(await (await send('cl', 'application/pdf')).text()).toContain('ATTACHED');
    expect(await (await send('ad', 'application/pdf')).text()).toContain('TO_FILE');
  });
  it('checks the number of a batch and the rights on a draft', async () => {
    const batch = { caseIds: null, filters: { creditor: 'md', age: '31-60' }, template: 'FRIENDLY', channel: 'x' };
    expect(await status('cl', '/documents/compose', { ...batch, expected: 38 })).toBe(409);
    expect(await status('cl', '/documents/compose', { ...batch, expected: 13 })).toBe(204);
    expect(await status('cl', '/documents/compose', { ...batch, filters: null, expected: 38 })).toBe(409);
    expect(await status('ad', '/documents/compose/draft', { caseId: 'demo' })).toBe(403);
  });
  it('recalls the filters before any batch', async () => {
    openAs('cl', '/documents/rediger');
    await userEvent.click(await screen.findByRole('tab', { name: 'Envoi groupé' }));
    await userEvent.selectOptions(screen.getByLabelText('Créancier'), 'md');
    await screen.findByText('13 débiteurs');
    await userEvent.click(screen.getByRole('button', { name: 'Générer le PDF' }));
    const dialog = await inDialog();
    expect(dialog.getByText('Matériaux Delta')).toBeVisible();
    expect(dialog.getByText('31 – 60 jours')).toBeVisible();
  });
  it('blocks the batch when the count fails', async () => {
    openAs('cl', '/documents/rediger');
    await userEvent.click(await screen.findByRole('tab', { name: 'Envoi groupé' }));
    server.use(http.get('/api/documents/compose', () => new HttpResponse(null, { status: 500 })));
    await userEvent.selectOptions(screen.getByLabelText('Créancier'), 'md');
    expect(screen.getByRole('button', { name: /Générer et envoyer/ })).toBeDisabled();
    expect(await screen.findByText(/n’a pas pu être recomptée/, undefined, { timeout: 4000 })).toBeVisible();
    expect(screen.getByRole('button', { name: /Générer et envoyer/ })).toBeDisabled();
  });
});

it('never brings a revoked secret back', async () => {
  await call('ad', '/secrets/k-sms/revoke', {});
  expect(await status('dev', '/secrets/k-sms/rotate', {})).toBe(403);
  expect(await status('dev', '/secrets/k-sms/revoke', {})).toBe(403);
  await call('dev', '/secrets/k-3cx/revoke', {});
  expect(await status('dev', '/secrets/k-3cx/rotate', {})).toBe(403);
  expect(await status('ad', '/secrets/k-3cx/keep', {})).toBe(204);
});
it('searches only the creditors of the officer', async () => {
  const names = async (account: string) =>
    ((await (await call(account, '/search', { query: 'm' })).json()) as { kind: string; title: string }[])
      .filter((item) => item.kind === 'CREDITOR')
      .map((item) => item.title);
  const allowed = ((await (await call('hb', '/creditors')).json()) as { name: string }[]).map((item) => item.name);
  for (const name of await names('hb')) expect(allowed).toContain(name);
  expect((await names('cl')).length).toBeGreaterThan(0);
});
it('clears the selection when a filter hides it', async () => {
  openAs('cl', '/debiteurs');
  await userEvent.click((await screen.findAllByRole('checkbox'))[1]!);
  expect(screen.getByRole('region', { name: 'Actions groupées' })).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Ancienneté'), '90+');
  expect(screen.queryByRole('region', { name: 'Actions groupées' })).toBeNull();
});
