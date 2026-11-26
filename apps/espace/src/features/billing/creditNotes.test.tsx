import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCreditNotes } from '../../mocks/routes/creditNotes';
import { resetSettings, setFirmText } from '../../mocks/routes/settings';
import { resetSteering } from '../../mocks/routes/steering';
import { call, mockApi, openAs } from '../../testing';

const server = mockApi();
beforeEach(() => {
  resetCreditNotes();
  resetSettings();
  resetSteering();
});
const inDialog = async () => within(await screen.findByRole('alertdialog'));
const fillFirm = () => {
  setFirmText('address', '10 rue de la Paix, 75002 Paris');
  setFirmText('siren', '732829007');
  setFirmText('vat', 'FR44732829007');
  setFirmText('rcs', 'SAS au capital de 10 000 €, RCS Paris 732 829 007');
};
const commission = 'À créditer, Commission · 8 % de 54 590,00 € encaissés en octobre 2026';
/** Facturation › « Avoir » on an invoice of the list. */
const creditFrom = async (number: string) => {
  await userEvent.click(await screen.findByRole('button', { name: `Avoir sur ${number}` }));
  return screen.findByRole('combobox', { name: '2. Facture à corriger' });
};

describe('credit notes', () => {
  it('credits part of a settled invoice, for the Director, with the next remittance; the invoice says « Avoir partiel »', async () => {
    fillFirm();
    openAs('cl', '/facturation');
    expect(await creditFrom('FA-2026-0116')).toHaveDisplayValue(/FA-2026-0116/u);
    expect(screen.getByText(/déduite du reversement du 15\/11\/2026 · aucun avoir à ce jour/u)).toBeVisible();
    const amount = screen.getByLabelText(commission);
    await userEvent.clear(amount);
    await userEvent.type(amount, '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Émettre l’avoir' }));
    // What is typed is checked before anything is sent.
    expect(screen.getByText(/Au plus 4.367,20.€ HT : ce qui reste facturé sur cette ligne\./u)).toBeVisible();
    expect(screen.getByText('Indiquez le motif : il est imprimé sur l’avoir.')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.clear(amount);
    await userEvent.type(amount, '208,80');
    await userEvent.type(screen.getByLabelText(/5\. Motif/u), 'Chèque revenu impayé après reversement (dossier LGR-2026-00188).');
    expect(screen.getByRole('radio', { name: /Prochain reversement/u })).toBeChecked();
    const preview = within(screen.getByRole('article', { name: 'Aperçu de l’avoir' }));
    expect(preview.getByText(/Avoir partiel sur la facture FA-2026-0116 du 02\/11\/2026/u)).toBeVisible();
    expect(preview.getByText('Montant ajouté au reversement du 15/12/2026.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Émettre l’avoir' }));
    const dialog = await inDialog();
    expect(dialog.getByText('Émettre l’avoir sur FA-2026-0116 ?')).toBeVisible();
    expect(dialog.getByText('AV-2026-0002 (numéro provisoire)')).toBeVisible();
    expect(dialog.getByText('Marie Dubreuil, Directeur')).toBeVisible();
    expect(dialog.getByText(/^250,56.€$/u)).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Émettre l’avoir' }));
    expect(await screen.findByText('Avoir AV-2026-0002 émis.')).toBeVisible();
    // The list « Avoirs » opens on it; the invoice itself is unchanged, its status derived.
    const row = await screen.findByRole('row', { name: /AV-2026-0002/u });
    expect(within(row).getByText('Au prochain reversement')).toBeVisible();
    expect(within(row).getByText('statut : Avoir partiel')).toBeVisible();
    expect(within(row).queryByRole('button', { name: /Envoyer/u })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /Factures/u }));
    expect(within(await screen.findByRole('row', { name: /FA-2026-0116/u })).getByText('Avoir partiel')).toBeVisible();
  });

  it('cancels an invoice not settled, deducted from it, and the invoice can take no more', async () => {
    fillFirm();
    openAs('ad', '/facturation');
    await creditFrom('FA-2026-0114');
    expect(screen.getByText('Déduit de la facture')).toBeVisible();
    expect(screen.queryByRole('radio', { name: /Virement/u })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /Avoir total/u }));
    expect(screen.getByLabelText('À créditer, Refacturation de frais de procédure')).toHaveValue('1070,00');
    await userEvent.type(screen.getByLabelText(/5\. Motif/u), 'Frais facturés deux fois');
    await userEvent.click(screen.getByRole('button', { name: 'Émettre l’avoir' }));
    const dialog = await inDialog();
    expect(dialog.queryByText('Pour le compte de')).toBeNull();
    await userEvent.click(dialog.getByRole('button', { name: 'Émettre l’avoir' }));
    expect(await screen.findByText('Avoir AV-2026-0002 émis.')).toBeVisible();
    expect(within(await screen.findByRole('row', { name: /AV-2026-0002/u })).getByText('Déduit de la facture')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Factures/u }));
    const invoice = await screen.findByRole('row', { name: /FA-2026-0114/u });
    expect(within(invoice).getByText('Annulée par avoir')).toBeVisible();
    expect(within(invoice).getByRole('button', { name: 'Avoir sur FA-2026-0114' })).toBeDisabled();
  });

  it('refuses while the identity of the firm is between brackets, and keeps what was typed', async () => {
    openAs('cl', '/facturation');
    await creditFrom('FA-2026-0115');
    await userEvent.clear(screen.getByLabelText(/À créditer, Commission/u));
    await userEvent.type(screen.getByLabelText(/À créditer, Commission/u), '100');
    await userEvent.type(screen.getByLabelText(/5\. Motif/u), 'Erreur de taux');
    await userEvent.click(screen.getByRole('button', { name: 'Émettre l’avoir' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Émettre l’avoir' }));
    expect(await screen.findByText('Identité du cabinet incomplète')).toBeVisible();
    expect(screen.getByText(/\[ADRESSE DU CABINET\], \[SIREN\], \[N° TVA\], \[CAPITAL ET RCS\]/u)).toBeVisible();
    expect(screen.getByLabelText(/5\. Motif/u)).toHaveValue('Erreur de taux');
  });

  it('names the field of the firm left empty', async () => {
    fillFirm();
    setFirmText('phone', '');
    openAs('ad', '/facturation');
    await creditFrom('FA-2026-0114');
    await userEvent.click(screen.getByRole('radio', { name: /Avoir total/u }));
    await userEvent.type(screen.getByLabelText(/5\. Motif/u), 'Erreur de taux');
    await userEvent.click(screen.getByRole('button', { name: 'Émettre l’avoir' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Émettre l’avoir' }));
    expect(await screen.findByText('Téléphone : à saisir dans Paramètres › Cabinet.')).toBeVisible();
  });

  it('asks for the reference of the case instead of the name of a debtor', async () => {
    fillFirm();
    server.use(http.post('/api/credit-notes', () => HttpResponse.json({ code: 'DEBTOR_NAME' }, { status: 422 })));
    openAs('cl', '/facturation');
    await creditFrom('FA-2026-0114');
    expect(screen.getByText('Imprimé sur l’avoir et conservé 10 ans avec lui ; référence du dossier, jamais le nom du débiteur.')).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: /Avoir total/u }));
    await userEvent.type(screen.getByLabelText(/5\. Motif/u), 'Erreur pour la société Martin');
    await userEvent.click(screen.getByRole('button', { name: 'Émettre l’avoir' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Émettre l’avoir' }));
    expect(await screen.findByText('Le motif contient le nom d’un débiteur : indiquez plutôt la référence du dossier.')).toBeVisible();
    expect(screen.queryByText(/Avoir AV-.* émis/u)).toBeNull();
  });

  it('keeps a draft to its author alone (question 172)', async () => {
    const draft = { invoiceId: 'FA-2026-0116', scope: 'TOTAL', lines: [], reason: 'À revoir', followUp: 'DEDUCTED' };
    const made = await call('cl', '/credit-notes/drafts', draft);
    const { id } = (await made.json()) as { id: string };
    const drafts = async (account: string) => ((await (await call(account, '/credit-notes')).json()) as { drafts: { id: string }[] }).drafts;
    expect((await drafts('cl')).map((item) => item.id)).toContain(id);
    expect((await drafts('ad')).map((item) => item.id)).not.toContain(id);
    expect((await call('ad', `/credit-notes/drafts/${id}`, undefined, 'DELETE')).status).toBe(404);
    expect((await call('ad', `/credit-notes/drafts/${id}`, { ...draft, reason: 'Autre' }, 'PUT')).status).toBe(404);
    expect((await call('cl', `/credit-notes/drafts/${id}`, undefined, 'DELETE')).status).toBe(204);
  });

  it('never takes another invoice for a draft whose invoice is cancelled since', async () => {
    fillFirm();
    const draft = { invoiceId: 'FA-2026-0114', scope: 'TOTAL', lines: [], reason: 'À revoir', followUp: 'DEDUCTED' };
    expect((await call('cl', '/credit-notes/drafts', draft)).status).toBe(200);
    const issued = await call('ad', '/credit-notes', { ...draft, reason: 'Frais facturés deux fois', expectedLeft: 128_400, draftId: null });
    expect(issued.status).toBe(200);
    openAs('cl', '/facturation');
    await userEvent.click(await screen.findByRole('tab', { name: /Avoirs/u }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reprendre le brouillon sur FA-2026-0114' }));
    expect(await screen.findByText('Facture déjà annulée ou introuvable')).toBeVisible();
    const select = screen.getByRole('combobox', { name: '2. Facture à corriger' });
    expect(select).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Émettre l’avoir' })).toBeNull();
    // Another invoice, chosen: a new draft, never the old one.
    await userEvent.selectOptions(select, 'FA-2026-0116');
    expect(await screen.findByRole('button', { name: 'Émettre l’avoir' })).toBeVisible();
    expect(screen.getByLabelText(/5\. Motif/u)).toHaveValue('');
  });

  it('says that the invoice changed since it was shown, and reloads it', async () => {
    fillFirm();
    server.use(http.post('/api/credit-notes', () => HttpResponse.json({ code: 'CHANGED' }, { status: 409 })));
    openAs('cl', '/facturation');
    await creditFrom('FA-2026-0117');
    await userEvent.click(screen.getByRole('radio', { name: /Avoir total/u }));
    await userEvent.click(screen.getByRole('radio', { name: /Virement/u }));
    await userEvent.type(screen.getByLabelText(/5\. Motif/u), 'Erreur de taux');
    await userEvent.click(screen.getByRole('button', { name: 'Émettre l’avoir' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Émettre l’avoir' }));
    expect(await screen.findByText('Un autre avoir vient d’être émis')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeVisible();
  });

  it('keeps a draft without a number, resumed or deleted from the tab « Avoirs »', async () => {
    openAs('cl', '/facturation');
    await creditFrom('FA-2026-0116');
    await userEvent.type(screen.getByLabelText(/5\. Motif/u), 'À vérifier');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    expect(await screen.findByText(/Brouillon enregistré/u)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Fermer la création/u }));
    await userEvent.click(screen.getByRole('tab', { name: /Avoirs/u }));
    const row = await screen.findByRole('row', { name: /Brouillon/u });
    await userEvent.click(within(row).getByRole('button', { name: 'Reprendre le brouillon sur FA-2026-0116' }));
    expect(await screen.findByLabelText(/5\. Motif/u)).toHaveValue('À vérifier');
    await userEvent.click(within(await screen.findByRole('row', { name: /Brouillon/u })).getByRole('button', { name: /Supprimer le brouillon/u }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Supprimer le brouillon' }));
    expect(await screen.findByText('Brouillon supprimé.')).toBeVisible();
    expect(screen.queryByRole('row', { name: /Brouillon/u })).toBeNull();
  });

  it('shows the list in error with « Réessayer », and the empty states', async () => {
    server.use(http.get('/api/credit-notes', () => HttpResponse.json({ code: 'INTERNAL' }, { status: 500 })));
    openAs('cl', '/facturation');
    await userEvent.click(await screen.findByRole('tab', { name: /Avoirs/u }));
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeVisible();
    server.resetHandlers();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('row', { name: /AV-2026-0001/u })).toBeVisible();
    // Nothing left to correct.
    server.use(
      http.get('/api/credit-notes', () =>
        HttpResponse.json({
          invoices: [],
          items: [],
          drafts: [],
          nextNumber: 'AV-2026-0001',
          nextRemittance: null,
          firm: { name: 'LEGAREC', address: '', phone: '', siren: '', vat: '', rcs: '' },
        }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Avoir\s*Corrige/u }));
    expect(await screen.findByText('Aucune facture à corriger')).toBeVisible();
    expect(await screen.findByText('Aucun avoir')).toBeVisible();
  });

  it('is closed to the Claims officer, the Developer and the manager without the delegation', async () => {
    for (const account of ['hb', 'dev']) expect((await call(account, '/credit-notes')).status, account).toBe(403);
    expect((await call('hb', '/credit-notes/drafts', { invoiceId: 'FA-2026-0116', scope: 'TOTAL', lines: [], reason: '', followUp: null })).status).toBe(403);
    openAs('hb', '/facturation');
    expect(await screen.findByRole('heading', { name: 'Accès réservé' })).toBeVisible();
  });
});
