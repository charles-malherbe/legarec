import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callState, resetCalls } from '../../mocks/routes/calls';
import { resetCases } from '../../mocks/routes/cases';
import { mailState, resetMessages } from '../../mocks/routes/messages';
import { call, mockApi, openAs } from '../../testing';
import { acwText, callReducer, idle, qualificationErrors } from './callMachine';

vi.mock('@legarec/platform', async (original) => ({ ...(await original<object>()), startCall: vi.fn(), openExternal: vi.fn() }));
mockApi();
beforeEach(() => {
  resetCalls();
  resetMessages();
  resetCases();
});
const inDialog = async () => within(await screen.findByRole('alertdialog'));
const complete = { promise: 100, invoices: ['F'], paymentReference: 'X', editing: false };

describe('call machine', () => {
  it('counts down, then dials the previewed call without keeping the announcement', () => {
    let state = callReducer({ ...idle(), announced: true }, { type: 'saved', next: 1 });
    for (let i = 0; i < 5; i += 1) state = callReducer(state, { type: 'tick' });
    expect(state).toMatchObject({ inCall: true, announced: false, index: 1 });
    const paused = callReducer(callReducer(idle(), { type: 'saved', next: 1 }), { type: 'previewPause' });
    expect(callReducer(paused, { type: 'tick' }).preview).toBe(5);
  });
  it('tracks hold, after-call time and transfers', () => {
    const inCall = { ...idle(), inCall: true, secs: 10 };
    expect(callReducer(callReducer(inCall, { type: 'hold' }), { type: 'tick' })).toMatchObject({ secs: 10, holdSecs: 1 });
    expect(callReducer(inCall, { type: 'transfer', to: 'A', mode: 'direct' })).toMatchObject({ inCall: false, transfer: { pending: false } });
    const announced = callReducer(inCall, { type: 'transfer', to: 'A', mode: 'announced' });
    expect(callReducer(announced, { type: 'transferCancel' })).toMatchObject({ inCall: true, transfer: null, hold: false });
    expect(acwText(20)).toBe('reste 00:40');
    expect(acwText(75)).toBe('temps dépassé de 00:15');
  });
  it('lists every blocking point', () => {
    expect(qualificationErrors(idle(), complete)).toHaveLength(1);
    expect(qualificationErrors({ ...idle(), outcome: 'PROMISE_TO_PAY' }, { ...complete, promise: 0, invoices: [] })).toHaveLength(2);
    expect(qualificationErrors({ ...idle(), outcome: 'ABSENT', secs: 3 }, complete)[0]).toMatch(/annonce/);
    expect(qualificationErrors({ ...idle(), outcome: 'ABSENT', secs: 3, announced: true }, complete)).toEqual([]);
  });
});

describe('calls', () => {
  it('qualifies with the keyboard, then undoes the saved file', async () => {
    openAs('cl', '/appels');
    await screen.findByRole('heading', { name: "Qualifier l'appel" });
    await userEvent.keyboard('6');
    expect(await screen.findByText('Code 3CX : ABSENT')).toBeVisible();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText(/Fiche enregistrée pour Bâtiplus SAS : absent/)).toBeVisible();
    expect(await screen.findByText('Composition prévisualisée · 3CX')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(await screen.findByText('Code 3CX : ABSENT')).toBeVisible();
  });
  it('never applies an AI suggestion by itself and can undo it', async () => {
    openAs('cl', '/appels');
    expect(await screen.findByText('Assistant IA · transcription en direct')).toBeVisible();
    expect(screen.getByText('À qualifier')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Raccrocher' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Appliquer à la fiche' }));
    expect(await screen.findByText('Code 3CX : PROMESSE')).toBeVisible();
    expect(callState.decisions).toEqual(['ACCEPTED']);
    expect(screen.getByText(/vérifiez le résultat/)).toBeVisible();
  });
  it('hides the assistant when it is disabled and pauses it without announcement', async () => {
    callState.aiEnabled = false;
    openAs('cl', '/appels');
    await screen.findByRole('heading', { name: "Qualifier l'appel" });
    expect(screen.queryByText(/Assistant IA/)).toBeNull();
  });
  it('pauses the transcription until the recording is announced', async () => {
    openAs('cl', '/appels');
    await userEvent.click(await screen.findByLabelText(/Annonce de l’enregistrement/));
    expect(screen.getByText('Assistant IA · en attente du consentement')).toBeVisible();
    expect(screen.queryByText(/gros retard de chantier/)).toBeNull();
  });
  it('confirms a coordinate correction with its origin', async () => {
    openAs('cl', '/appels');
    await userEvent.click(await screen.findByRole('button', { name: 'Corriger 06 12 48 77 03' }));
    const field = screen.getByLabelText('Numéro');
    await userEvent.clear(field);
    await userEvent.type(field, '04 72 18 45 90');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la coordonnée' }));
    expect(screen.getByText('Ce numéro est déjà enregistré pour ce débiteur.')).toBeVisible();
    await userEvent.clear(field);
    await userEvent.type(field, '06 11 22 33 44');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la coordonnée' }));
    const dialog = await inDialog();
    expect(dialog.getByText('Donnée pendant l’appel')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Remplacer' }));
    expect(await screen.findByText('06 11 22 33 44')).toBeVisible();
  });
  it('switches to manual mode when 3CX is down', async () => {
    callState.tcx = 'DOWN';
    callState.active = false;
    openAs('cl', '/appels');
    expect(await screen.findByText('3CX injoignable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Appeler' })).toBeDisabled();
  });
  it('opens the debtor file when a known caller is answered', async () => {
    callState.incoming = true;
    openAs('cl', '/');
    await userEvent.click(await screen.findByRole('button', { name: /Décrocher/ }));
    expect(await screen.findByRole('heading', { name: 'Bâtiplus SAS' })).toBeVisible();
  });
  it('refuses the Director and the Developer', async () => {
    const sheet = { outcome: 'NO_ANSWER', tcxCode: 'NON_REPONSE', interlocutor: '', notes: '', months: null, recall: null, announced: false, sendRecap: false };
    const body = { ...sheet, promise: null, alreadyPaid: null, dispute: null, absent: null };
    expect((await call('ad', '/calls/demo/qualification', body)).status).toBe(403);
    expect((await call('dev', '/calls')).status).toBe(403);
  });
});

describe('e-mails', () => {
  it('answers from the professional mailbox after confirmation, never from the shared one', async () => {
    openAs('cl', '/e-mails');
    await userEvent.click(await screen.findByRole('button', { name: 'Brouillon IA' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Votre réponse').value).toContain('Merci pour votre message');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    const dialog = await inDialog();
    expect(dialog.getByText(/cl@legarec\.fr/)).toBeVisible();
    expect(dialog.queryByText(/recouvrement@/)).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByText(/Votre réponse · à l’instant/)).toBeVisible();
  });
  it('shows an OVH failure with a retry, without falling back to another service', async () => {
    mailState.failNext = true;
    openAs('cl', '/e-mails');
    await userEvent.type(await screen.findByLabelText('Votre réponse'), 'Bonjour');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByText('Échec de l’envoi par OVH')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nouvelle tentative' })).toBeVisible();
  });
  it('blocks sending when the hourly quota is reached', async () => {
    mailState.sentThisHour = 200;
    openAs('cl', '/e-mails');
    await userEvent.type(await screen.findByLabelText('Votre réponse'), 'Bonjour');
    expect(screen.getByText(/Quota OVH atteint/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
  });
  it('filters debtor portal messages and flags unverified ones', async () => {
    openAs('cl', '/e-mails');
    await userEvent.click(await screen.findByRole('tab', { name: /Espace débiteur/ }));
    expect(await screen.findByText(/« non vérifié »/)).toBeVisible();
  });
  it('composes with a signature without any mobile number', async () => {
    openAs('cl', '/e-mails');
    await userEvent.click(await screen.findByRole('button', { name: /Rédiger/ }));
    const signature = within(screen.getByRole('group', { name: 'Aperçu de la signature' }));
    expect(signature.getByText(/01 87 88 02 98 · poste 101/)).toBeVisible();
    expect(signature.queryByText(/06 |07 /)).toBeNull();
  });
  it('scopes messages and answers by role', async () => {
    const { threads } = (await (await call('hb', '/emails')).json()) as { threads: { id: string }[] };
    expect(threads.map((item) => item.id)).toEqual(['m2', 'm4']);
    expect((await call('hb', '/emails/m1/replies', { text: 'x' })).status).toBe(403);
    expect((await call('ad', '/emails/m1/replies', { text: 'x' })).status).toBe(403);
    expect((await call('dev', '/emails')).status).toBe(403);
  });
});

describe('SMS', () => {
  it('starts a new SMS with its button or N, with undo, and shows the STOP rate', async () => {
    openAs('cl', '/sms');
    const field = await screen.findByLabelText('Votre SMS');
    expect(screen.getByText(/^0,6.%$/)).toBeVisible();
    expect(screen.getByText('8 numéros ce mois')).toBeVisible();
    await userEvent.type(field, 'Bonjour');
    await userEvent.click(screen.getByRole('button', { name: /Nouveau SMS/ }));
    expect(field).toHaveFocus();
    expect(field).toHaveValue('');
    await userEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    expect(field).toHaveValue('Bonjour');
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard('n');
    expect(field).toHaveFocus();
    expect(field).toHaveValue('');
  });
  it('offers no action on a read-only conversation', async () => {
    openAs('ad', '/sms');
    expect(await screen.findByText(/^Lecture seule/)).toBeVisible();
    for (const name of [/Nouveau SMS/, /Appeler/, /Enregistrer une promesse/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
  });
  it('warns when a character drops the limit to 70 and confirms the billing', async () => {
    openAs('cl', '/sms');
    await userEvent.type(await screen.findByLabelText('Votre SMS'), 'Reçu, peut-être demain');
    expect(screen.getByText(/ç ê font passer/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect((await inDialog()).getByText(/SMS · \d+ caractères/)).toBeVisible();
  });
  it('links an unknown number to a case', async () => {
    openAs('cl', '/sms');
    await userEvent.click(await screen.findByRole('tab', { name: /Non rattachés/ }));
    await userEvent.type(await screen.findByLabelText('Rattacher à un dossier'), 'batiplus');
    await userEvent.click(await screen.findByRole('button', { name: 'Rattacher à Bâtiplus SAS' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Rattacher' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Non rattachés/ })).toHaveTextContent('0'));
  });
  it('shows STOP and keeps quick answers in the 160-character alphabet', async () => {
    openAs('cl', '/sms');
    await userEvent.click(await screen.findByRole('button', { name: /Nordis Logistique/ }));
    expect(screen.getByText(/a répondu STOP/)).toBeVisible();
    for (const chip of ['RIB / espace de paiement', 'Confirmer une promesse', 'Proposer un échéancier', 'Demander un rappel']) {
      await userEvent.click(screen.getByRole('button', { name: chip }));
      expect(screen.queryByText(/font passer le SMS/)).toBeNull();
    }
  });
  it('keeps unlinked numbers for the Collection manager', async () => {
    const { threads } = (await (await call('hb', '/sms')).json()) as { threads: { linked: boolean }[] };
    expect(threads.every((item) => item.linked)).toBe(true);
  });
});
