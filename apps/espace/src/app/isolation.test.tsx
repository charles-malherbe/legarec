import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetAccounts } from '../mocks/routes/account';
import { resetCases } from '../mocks/routes/cases';
import { resetMessages } from '../mocks/routes/messages';
import { resetSettings } from '../mocks/routes/settings';
import { call, mockApi, openAs } from '../testing';

mockApi();
afterEach(() => {
  resetCases();
  resetMessages();
  resetSettings();
  resetAccounts();
});
const text = async (account: string, path: string) => (await call(account, path)).text();

describe('reads follow the role', () => {
  it('shows an officer only the debtors of their own cases', async () => {
    const { items } = (await (await call('hb', '/cases/search?status=all&officer=all&creditor=all&age=all', { query: '' })).json()) as {
      items: { name: string }[];
    };
    const own = items.map((item) => item.name);
    const { items: all } = (await (await call('cl', '/cases/search?status=all&officer=all&creditor=all&age=all', { query: '' })).json()) as {
      items: { name: string }[];
    };
    const others = all.map((item) => item.name).filter((name) => !own.includes(name));
    expect(others.length).toBeGreaterThan(0);
    for (const path of ['/dashboard', '/shell', '/notifications', '/creditors', '/creditors/md', '/creditors/mt']) {
      const body = await text('hb', path);
      for (const name of others) expect(body, `${path} shows ${name}`).not.toContain(name);
    }
  });
  it('shows the Developer no debtor, creditor nor remittance', async () => {
    expect(await text('dev', '/notifications')).toBe('[]');
    expect(await text('dev', '/shell')).not.toMatch(/Bâtiplus|Matériaux Delta|38 420/);
    expect(await text('dev', '/settings/techniques/audit')).not.toMatch(/Bâtiplus|LGR-|DOS-/);
  });
});

describe('the Director only acts on their own cases', () => {
  it.each([
    ['/gdpr/requests', { caseId: 'demo', kind: 'ACCESS', origin: 'Courrier' }, 'POST'],
    ['/payment-plans', { caseId: 'demo', months: 4, method: 'TRANSFER' }, 'POST'],
    ['/cases/demo/reminders', { channel: 'E-mail', template: 'Relance n°1', recipient: 'compta@batiplus.example', message: 'Bonjour' }, 'POST'],
    ['/emails/messages', { to: 'compta@batiplus.example', subject: 'a', paragraphs: ['b'], caseId: null }, 'POST'],
  ])('refuses %s on the case of someone else', async (path, body, method) => {
    expect((await call('ad', path, body, method)).status).toBe(403);
  });
  it('refuses every change on a message of someone else', async () => {
    const { threads } = (await (await call('ad', '/emails')).json()) as { threads: { id: string; canAct: boolean }[] };
    const other = threads.find((item) => !item.canAct);
    expect(other).toBeDefined();
    expect((await call('ad', `/emails/${other?.id}/archive`, { archived: true }, 'PUT')).status).toBe(403);
    expect((await call('ad', `/emails/${other?.id}/category`, { category: 'OTHER' }, 'PUT')).status).toBe(403);
    expect((await call('ad', `/emails/${other?.id}/read`, {})).status).toBe(403);
  });
  it('shows no action in the screen', async () => {
    openAs('ad', '/e-mails');
    expect((await screen.findAllByText(/Lecture seule : ce dossier est suivi/))[0]).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Archiver' })).toBeNull();
  });
});

describe('delegations and audit', () => {
  it('lets the manager assign cases only under the delegation, with both names', async () => {
    expect((await call('cl', '/cases/assign', { ids: ['demo'], officerId: 'hb' })).status).toBe(204);
    expect(await text('cl', '/cases/demo')).toContain('"onBehalfOf":"Marie Dubreuil"');
    await call('ad', '/delegations/administrative', { active: false }, 'PUT');
    expect((await call('cl', '/cases/assign', { ids: ['demo'], officerId: 'cl' })).status).toBe(403);
    expect((await call('hb', '/cases/assign', { ids: ['demo'], officerId: 'hb' })).status).toBe(403);
  });
  it('records sensitive actions without any secret', async () => {
    await call('dev', '/secrets', { name: 'AI_API_KEY', value: 'valeur-fictive', rotation: '90' });
    const body = await text('ad', '/settings/techniques/audit');
    expect(body).toContain('Secret ajouté : AI_API_KEY');
    expect(body).toContain('Marie Dubreuil');
    expect(body).not.toContain('valeur-fictive');
  });
  it('needs the Director to revoke a secret', async () => {
    await call('dev', '/secrets/k-resend/revoke', {});
    expect(await text('dev', '/secrets')).toContain('REVOKE_PENDING');
    await call('ad', '/secrets/k-resend/revoke', {});
    expect(await text('dev', '/secrets')).toContain('"REVOKED"');
  });
  it('never lets the shared mailbox answer', async () => {
    expect((await call('dev', '/mailboxes/b1/auto-reply', { text: 'x', until: null }, 'PUT')).status).toBe(403);
  });
});

it('asks before any sending at the end of a call', async () => {
  openAs('cl', '/appels');
  await userEvent.click(await screen.findByRole('button', { name: /Absent/ }));
  await userEvent.click(screen.getByRole('checkbox', { name: /Envoyer un SMS/ }));
  await userEvent.click(screen.getByRole('button', { name: /Enregistrer et appel suivant/ }));
  const dialog = within(await screen.findByRole('alertdialog'));
  expect(dialog.getByText(/SMS avec le lien/)).toBeVisible();
});
