import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAccounts } from '../../mocks/routes/account';
import { resetCreditors } from '../../mocks/routes/creditors';
import { call, mockApi, openAs } from '../../testing';

/** Example IBAN of the international standard, not a real account. */
const IBAN = 'GB82 WEST 1234 5698 7654 32';
const server = mockApi();
beforeEach(() => {
  resetCreditors();
  resetAccounts();
});
const type = async (label: string, value: string) => {
  const field = await screen.findByLabelText(new RegExp(`^${label}`));
  await userEvent.clear(field);
  await userEvent.type(field, value);
};
const dialog = async () => within(await screen.findByRole('alertdialog'));
const press = (name: string | RegExp) => userEvent.click(screen.getByRole('button', { name }));
const fill = async () => {
  await type('SIREN', '732 829 007');
  await type('Raison sociale', 'Boulangeries Rivaud SAS');
  await type('Nom affiché', 'Boulangeries Rivaud');
  await type('Adresse', '6 rue du Four');
  await type('Code postal', '69100');
  await type('Ville', 'Villeurbanne');
  await type('Nom(?! affiché)', 'Élodie Rivaud');
  await type('E-mail', 'e.rivaud@exemple.test');
  await type('Date d’effet', '2026-01-01');
  await type('Honoraires amiable', '8');
  await type('Honoraires judiciaire', '12');
};

describe('who opens the screen', () => {
  it.each([
    ['hb', 'officer'],
    ['dev', 'Developer'],
  ])('%s (%s) does not, and is not invited to', async (account) => {
    openAs(account, '/creanciers/nouveau');
    expect((await screen.findAllByText(/réservé/i))[0]).toBeVisible();
    expect(screen.queryByLabelText(/^SIREN/)).toBeNull();
  });

  it('an officer sees neither « Nouveau créancier » nor « Modifier »', async () => {
    openAs('hb', '/creanciers/demo');
    expect(await screen.findByText('Honoraires amiable')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Modifier' })).toBeNull();
  });

  it('the manager does, from the list and from the file', async () => {
    openAs('cl', '/creanciers');
    await userEvent.click(await screen.findByRole('link', { name: /Nouveau créancier/ }));
    expect(await screen.findByRole('heading', { name: 'Nouveau créancier' })).toBeVisible();
  });
});

describe('a creditor', () => {
  it('is created after a confirmation, with its account', async () => {
    openAs('cl', '/creanciers/nouveau');
    await fill();
    // Follows the SIREN.
    expect(screen.getByLabelText(/^N° de TVA/)).toHaveValue('FR75732829007');
    await type('Titulaire', 'Boulangeries Rivaud SAS');
    await type('IBAN(?! confirmé)', IBAN);
    await type('BIC', 'PSSTFRPPXXX');
    await press('Créer le créancier');
    const box = await dialog();
    expect(box.getByText('Boulangeries Rivaud · SIREN 732 829 007')).toBeVisible();
    expect(box.getByText('8 % HT, 12 % HT en judiciaire')).toBeVisible();
    // Masked, and on behalf of the Director.
    expect(box.getByText('•••• 5432, à confirmer par un autre collaborateur')).toBeVisible();
    expect(box.getByText('Marie Dubreuil, Directeur')).toBeVisible();
    await userEvent.click(box.getByRole('button', { name: 'Créer le créancier' }));
    expect(await screen.findByText('Boulangeries Rivaud créé.')).toBeVisible();
    const file = (await (await call('ad', '/creditors/c1/file')).json()) as { bankAccount: { masked: string }; mandates: { amicableRateBp: number }[] };
    expect(file.bankAccount.masked).toBe('GB82 •••• •••• 5432');
    expect(file.mandates[0]!.amicableRateBp).toBe(800);
  });

  it('shows what is wrong beside each field, and confirms nothing', async () => {
    openAs('cl', '/creanciers/nouveau');
    await screen.findByLabelText(/^SIREN/);
    await type('SIREN', '123 456 789');
    await type('Honoraires amiable', '150');
    await type('Titulaire', 'X');
    await type('IBAN(?! confirmé)', 'GB00');
    await press('Créer le créancier');
    for (const message of [
      'Ce SIREN n’est pas valide (9 chiffres).',
      'Indiquez la raison sociale.',
      'Entre 0 et 100 %.',
      'Cet IBAN n’est pas valide.',
      'Indiquez la date d’effet.',
    ])
      expect(screen.getAllByText(message)[0]).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('whose SIREN is taken says so, and keeps what was typed', async () => {
    await call('ad', '/creditors', {
      siren: '732829007',
      identity: { legalName: 'X', name: 'X', sector: '', vatNumber: '', address: 'x', postalCode: '69000', city: 'Lyon', managerId: null, portalEnabled: true },
      contacts: [{ name: 'X', title: '', email: 'x@exemple.test', phone: '', isMain: true }],
      mandate: {
        startsOn: '2026-01-01',
        endsOn: null,
        amicableRateBp: 800,
        litigationRateBp: 1200,
        openingFeeCents: 0,
        planMonthsWithoutConsent: 6,
        discountMaxBp: 500,
        litigationNeedsConsent: true,
        deferSmallRemittances: false,
        interestMode: 'NONE',
        contractRateBp: null,
        fixedIndemnity: true,
        reportingDay: 5,
        scenario: 'BUSINESS',
      },
    });
    openAs('cl', '/creanciers/nouveau');
    await fill();
    await press('Créer le créancier');
    await userEvent.click((await dialog()).getByRole('button', { name: 'Créer le créancier' }));
    expect((await screen.findAllByText('Un créancier porte déjà ce SIREN.'))[0]).toBeVisible();
    expect(screen.getByLabelText(/^Raison sociale/)).toHaveValue('Boulangeries Rivaud SAS');
  });

  it('whose account is refused is created all the same, and its screen asks for the account again', async () => {
    server.use(http.post('/api/creditors/:id/bank-accounts', () => HttpResponse.json({ code: 'UNAVAILABLE' }, { status: 503 })));
    openAs('ad', '/creanciers/nouveau');
    await fill();
    await type('Titulaire', 'X');
    await type('IBAN(?! confirmé)', IBAN);
    await type('BIC', 'PSSTFRPPXXX');
    await press('Créer le créancier');
    await userEvent.click((await dialog()).getByRole('button', { name: 'Créer le créancier' }));
    expect(await screen.findByText(/Le compte n’a pas été enregistré/)).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Saisir le compte' })).toBeVisible();
  });

  it('changes at once, and back with « Annuler »', async () => {
    openAs('cl', '/creanciers/md/modifier');
    await type('Ville', 'Villeurbanne');
    await press('Enregistrer');
    expect(await screen.findByText('Fiche de Matériaux Delta enregistrée.')).toBeVisible();
    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.getByLabelText(/^Ville/)).toHaveValue('Lyon'));
  });

  it('changed by someone else keeps what is typed, and is recorded only once read again', async () => {
    openAs('cl', '/creanciers/md/modifier');
    await type('Ville', 'Villeurbanne');
    const { version, identity, contacts } = (await (await call('ad', '/creditors/md/file')).json()) as {
      version: number;
      identity: object;
      contacts: object[];
    };
    await call('ad', '/creditors/md', { version, identity: { ...identity, sector: 'Négoce' }, contacts }, 'PUT');
    await call('cl', '/creditors/md/file');
    await press('Enregistrer');
    expect(await screen.findByText('Cette fiche a changé')).toBeVisible();
    expect(screen.getByLabelText(/^Ville/)).toHaveValue('Villeurbanne');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    await press('Recharger');
    await press('Enregistrer');
    expect(await screen.findByText('Fiche de Matériaux Delta enregistrée.')).toBeVisible();
  });
});

describe('a mandate', () => {
  it('is changed by a dated amendment, after a confirmation that names what stays', async () => {
    openAs('cl', '/creanciers/md/modifier');
    await userEvent.click(await screen.findByRole('button', { name: 'Préparer un avenant' }));
    await type('Date d’effet', '2027-01-01');
    await type('Honoraires amiable', '7,5');
    await press('Enregistrer l’avenant');
    const box = await dialog();
    expect(box.getByText('8 % → 7,5 % HT')).toBeVisible();
    expect(box.getByText('Dossiers inchangés')).toBeVisible();
    await userEvent.click(box.getByRole('button', { name: 'Enregistrer l’avenant' }));
    expect(await screen.findByText('Avenant enregistré.')).toBeVisible();
    expect(await screen.findByText('Du 12/03/2024 au 31/12/2026')).toBeVisible();
    expect(screen.getByText('À venir')).toBeVisible();
  });

  it('is not amended before it starts', async () => {
    openAs('cl', '/creanciers/md/modifier');
    await userEvent.click(await screen.findByRole('button', { name: 'Préparer un avenant' }));
    await type('Date d’effet', '2024-01-01');
    await press('Enregistrer l’avenant');
    expect(await screen.findByText('La date d’effet doit suivre celle du mandat modifié.')).toBeVisible();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('the account', () => {
  it('shows its IBAN on demand alone, and hides it again', async () => {
    openAs('cl', '/creanciers/md/modifier');
    expect(await screen.findByText('FR76 •••• •••• 4521')).toBeVisible();
    expect(document.body.textContent).not.toContain('3000 1007');
    await press('Afficher l’IBAN');
    expect(await screen.findByText('FR76 3000 1007 9412 3456 7894 521')).toBeVisible();
    await press('Masquer l’IBAN');
    expect(document.body.textContent).not.toContain('3000 1007');
    expect(await (await call('ad', '/settings/techniques/audit')).text()).toContain('IBAN d’un créancier affiché');
  });

  it('is replaced after a confirmation that shows it whole, then confirmed by telephone by someone else', async () => {
    const first = openAs('cl', '/creanciers/md/modifier');
    await userEvent.click(await screen.findByRole('button', { name: 'Remplacer le compte' }));
    await type('Titulaire', 'Matériaux Delta SAS');
    await type('IBAN(?! confirmé)', IBAN);
    await type('BIC', 'PSSTFRPPXXX');
    await userEvent.click(within(screen.getByRole('form', { name: 'Compte de reversement' })).getByRole('button', { name: 'Remplacer le compte' }));
    const box = await dialog();
    expect(box.getByText(IBAN)).toBeVisible();
    expect(box.getByText('FR76 •••• •••• 4521')).toBeVisible();
    expect(box.getByText('Marie Dubreuil, Directeur')).toBeVisible();
    await userEvent.click(box.getByRole('button', { name: 'Remplacer le compte' }));
    // Whoever typed it does not confirm it (question 142).
    expect(await screen.findByText('IBAN à confirmer par un autre collaborateur')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirmer le compte' })).toBeNull();
    expect((await call('cl', '/creditors/md/bank-accounts/x/confirm', { confirmedWith: 'Claire Besson' })).status).toBe(409);
    first.unmount();
    openAs('ad', '/creanciers/md/modifier');
    expect(await screen.findByText('Saisi par')).toBeVisible();
    await press('Confirmer le compte');
    expect(await screen.findByText('Indiquez avec qui.')).toBeVisible();
    await type('Confirmé par téléphone avec', 'Claire Besson');
    await press('Confirmer le compte');
    await userEvent.click((await dialog()).getByRole('button', { name: 'Confirmer le compte' }));
    expect(await screen.findByText('Compte confirmé.')).toBeVisible();
    await waitFor(() => expect(screen.queryByText('IBAN à confirmer par téléphone')).toBeNull());
  });

  it('is out of reach of the manager once the delegation is withdrawn', async () => {
    await call('ad', '/delegations/administrative', { active: false }, 'PUT');
    try {
      openAs('cl', '/creanciers/md/modifier');
      expect(await screen.findByText('Réservé au Directeur')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Afficher l’IBAN' })).toBeNull();
      expect(document.body.textContent).not.toContain('4521');
    } finally {
      await call('ad', '/delegations/administrative', { active: true }, 'PUT');
    }
  });
});
