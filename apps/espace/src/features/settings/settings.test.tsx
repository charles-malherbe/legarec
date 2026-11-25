import { checkTemplate } from '@legarec/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetAccounts } from '../../mocks/routes/account';
import { resetSettings } from '../../mocks/routes/settings';
import { resetTemplates } from '../../mocks/routes/templates';
import { call, mockApi, openAs } from '../../testing';

mockApi();
afterEach(() => {
  resetSettings();
  resetTemplates();
  resetAccounts();
});
const inDialog = async () => within(await screen.findByRole('alertdialog'));

describe('settings', () => {
  it('searches the hub and never shows online payment', async () => {
    openAs('cl', '/parametres');
    expect(await screen.findByRole('link', { name: /Cabinet/ })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Paiement en ligne|SEPA|PCI/);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Rechercher un paramètre' }), 'plafonds');
    expect(screen.getByRole('link', { name: /^Relances ?Plafonds/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /Reversements/ })).toBeNull();
  });
  it('saves the plan threshold under the administrative delegation, with undo', async () => {
    openAs('cl', '/parametres/regles');
    expect(await screen.findByText(/Pour le compte du Directeur/)).toBeVisible();
    await userEvent.selectOptions(await screen.findByLabelText('Durée maximale sans validation'), '12 mois');
    expect(screen.getByText(/Modifications non enregistrées dans/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.getByLabelText('Durée maximale sans validation')).toHaveValue('6 mois'));
  });
  it('is read-only for an officer and refused by the API', async () => {
    openAs('hb', '/parametres/regles');
    expect(await screen.findByText('Lecture seule')).toBeVisible();
    expect(await screen.findByLabelText('Durée maximale sans validation')).toBeDisabled();
    expect((await call('hb', '/settings/firm/regles', { duration: '12 mois' }, 'PUT')).status).toBe(403);
    expect((await call('dev', '/settings/firm/regles', {}, 'PUT')).status).toBe(403);
    expect((await call('ad', '/settings/firm/regles', { duration: '3 mois' }, 'PUT')).status).toBe(204);
  });
  it('keeps technical settings for the Developer and the Director', async () => {
    openAs('cl', '/parametres/techniques');
    expect(await screen.findByText('Réservé au rôle Développeur')).toBeVisible();
    expect((await call('cl', '/settings/techniques')).status).toBe(403);
    expect((await call('cl', '/secrets')).status).toBe(403);
    expect((await call('cl', '/mailboxes')).status).toBe(403);
    expect((await call('ad', '/secrets')).status).toBe(200);
  });
  it('never returns a secret value', async () => {
    const value = 'valeur-fictive-de-test';
    expect((await call('dev', '/secrets', { name: 'EX_TEST', service: 'Test', value, rotation: '90' })).status).toBe(204);
    const body = await (await call('dev', '/secrets')).text();
    expect(body).toContain('EX_TEST');
    expect(body).not.toContain(value);
    expect(body).not.toMatch(/value|••/);
  });
  it('rotates a secret after confirmation', async () => {
    openAs('dev', '/parametres/techniques/secrets');
    await userEvent.click(await screen.findByRole('button', { name: 'Renouveler : TCX_API_CLIENT_SECRET' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Renouveler la clé' }));
    expect(await screen.findByText('TCX_API_CLIENT_SECRET renouvelé.')).toBeVisible();
  });
});

describe('mailboxes', () => {
  it('shows a new password only once', async () => {
    openAs('dev', '/parametres/techniques/boites');
    await userEvent.click(await screen.findByRole('button', { name: 'Gérer : hb@legarec.fr' }));
    await userEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Changer le mot de passe' }));
    const password = (await screen.findByTestId('issued-password')).textContent;
    expect(password).toHaveLength(16);
    await userEvent.click(screen.getByRole('button', { name: 'Masquer définitivement' }));
    expect(screen.queryByText(password)).toBeNull();
    expect(await (await call('dev', '/mailboxes')).text()).not.toContain(password);
    expect(await screen.findByText(/Nora Petit, pour le compte de Marie Dubreuil/)).toBeVisible();
  });
  it('protects the shared mailbox', async () => {
    openAs('dev', '/parametres/techniques/boites');
    await userEvent.click(await screen.findByRole('button', { name: 'Gérer : recouvrement@legarec.fr' }));
    expect(await screen.findByText(/Boîte protégée/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Supprimer la boîte' })).toBeNull();
    expect((await call('dev', '/mailboxes/b1/password', {})).status).toBe(403);
    expect((await call('dev', '/mailboxes/b1/delete', { address: 'recouvrement@legarec.fr' })).status).toBe(403);
  });
  it('asks for the full address before deleting', async () => {
    openAs('dev', '/parametres/techniques/boites');
    await userEvent.click(await screen.findByRole('button', { name: 'Gérer : tg@legarec.fr' }));
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la boîte' }));
    const dialog = await inDialog();
    expect(dialog.getByRole('button', { name: 'Supprimer définitivement' })).toBeDisabled();
    await userEvent.type(dialog.getByLabelText('Saisissez l’adresse complète pour confirmer'), 'tg@legarec.fr');
    await userEvent.click(dialog.getByRole('button', { name: 'Supprimer définitivement' }));
    expect(await screen.findByText('Boîte supprimée.')).toBeVisible();
  });
  it('runs the departure steps in order, each one confirmed', async () => {
    openAs('ad', '/parametres/techniques/boites');
    await userEvent.click(await screen.findByRole('button', { name: 'Gérer : tg@legarec.fr' }));
    expect(screen.getByRole('button', { name: /Lancer l’étape : Rediriger/ })).toBeDisabled();
    for (const [step, confirmLabel] of [
      [/Changer le mot de passe/, 'Changer le mot de passe'],
      [/réponse automatique de départ/, 'Enregistrer la réponse'],
      [/Rediriger vers/, 'Créer la redirection'],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`Lancer l’étape : .*${step.source}`) }));
      await userEvent.click((await inDialog()).getByRole('button', { name: confirmLabel }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    }
    expect(screen.getAllByText('Fait')).toHaveLength(3);
  });
});

describe('GDPR registry', () => {
  it('belongs to the Director and the administrative delegate', async () => {
    openAs('cl', '/parametres/rgpd');
    expect(await screen.findByText('Registre des demandes')).toBeVisible();
    expect(await screen.findByText(/2 demandes en cours/)).toBeVisible();
    for (const account of ['hb', 'dev']) expect((await call(account, '/gdpr/requests')).status).toBe(403);
  });
  it('records a request only on a readable case', async () => {
    expect((await call('hb', '/gdpr/requests', { caseId: 'meunier', kind: 'ACCESS', origin: 'Courrier' })).status).toBe(404);
    expect((await call('cl', '/gdpr/requests', { caseId: 'demo', kind: 'ERASURE', origin: 'Courrier' })).status).toBe(204);
    const { items } = (await (await call('ad', '/gdpr/requests')).json()) as { items: unknown[] };
    expect(items).toHaveLength(3);
  });
});

describe('templates', () => {
  const letter = { kind: 'LETTER', category: 'COLLECTION', isReminder: true, block: 'mentions_recouvrement' } as const;
  const good = '<p>{{debiteur.raison_sociale}} {{dossier.premier_courrier_reference}} {{dossier.premier_courrier_date}}</p>{{> mentions_recouvrement}}';
  const labels = (source: string, template: Parameters<typeof checkTemplate>[0] = letter) =>
    checkTemplate(template, source).checks.map((item) => `${item.level} ${item.label}`);
  it('accepts a compliant file', () => expect(checkTemplate(letter, good).accepted).toBe(true));
  it.each([
    ['{{debiteur.raison_social}}', /ERROR Champ inconnu, ligne 1/],
    ['{{{debiteur.adresse}}}', /ERROR Champ non protégé/],
    ['{{> inconnu}}', /ERROR Bloc inconnu/],
    ['<script>alert(1)</script>', /ERROR Script, formulaire ou ressource externe/],
    ['<p onclick="x()">', /ERROR Script/],
    ['<img src="https://exemple.fr/pixel.png">', /ERROR Script/],
    ['<style>@import "x.css"</style>', /ERROR Script/],
  ])('refuses %s', (extra, expected) => {
    expect(checkTemplate(letter, good + extra).accepted).toBe(false);
    expect(labels(good + extra).join('\n')).toMatch(expected);
  });
  it('suggests the closest field', () => {
    expect(checkTemplate(letter, `${good}{{debiteur.raison_social}}`).checks[0]?.detail).toContain('vouliez-vous dire {{debiteur.raison_sociale}} ?');
  });
  it('requires the mandatory block and the first letter', () => {
    expect(labels('<p>Bonjour</p>')).toEqual(expect.arrayContaining(['ERROR Bloc imposé absent', 'ERROR Rappel du premier courrier absent']));
  });
  it('warns about bailiff-like terms and 70-character SMS', () => {
    expect(labels(`${good}<p>Sommation avant saisie</p>`).join()).toMatch(/WARNING Termes proches/);
    const sms = { kind: 'SMS', category: 'COLLECTION', isReminder: false, block: 'mention_sms' } as const;
    expect(labels('Prêt à payer {{> mention_sms}}', sms).join()).toMatch(/WARNING SMS limité à 70 caractères/);
  });
  it('imports, acknowledges the warnings, submits, then publishes by delegation', async () => {
    openAs('cl', '/parametres/modeles/demeure');
    await screen.findByRole('heading', { name: 'Mise en demeure', level: 1 });
    await userEvent.upload(screen.getByLabelText('Fichier du modèle'), new File([`${good}<p>Sommation</p>`], 'mise-en-demeure-v5.html', { type: 'text/html' }));
    const submit = await screen.findByRole('button', { name: 'Soumettre pour validation' });
    expect(submit).toBeDisabled();
    expect(screen.getByTitle('Aperçu du fichier importé')).toHaveAttribute('sandbox', '');
    await userEvent.click(screen.getByRole('checkbox', { name: /J’ai vérifié ces alertes/ }));
    await userEvent.click(submit);
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Soumettre' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Valider et publier' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Valider et publier' }));
    expect(await screen.findByText('Version 5 publiée')).toBeVisible();
  });
  it('lets officers read only', async () => {
    openAs('hb', '/parametres/modeles/demeure');
    await screen.findByRole('heading', { name: 'Mise en demeure', level: 1 });
    expect(screen.queryByRole('button', { name: 'Choisir un fichier' })).toBeNull();
    expect((await call('hb', '/templates/demeure/import', { source: good, fileName: 'a.html' })).status).toBe(403);
    expect((await call('dev', '/templates/demeure/review', { approved: true })).status).toBe(403);
  });
});

describe('account and help', () => {
  it('lets only the Director withdraw a delegation', async () => {
    openAs('ad', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Profil' }));
    await userEvent.click(await screen.findByRole('switch', { name: 'Technique' }));
    expect(await screen.findByText('Délégation retirée.')).toBeVisible();
    expect((await call('dev', '/settings/techniques/securite', {}, 'PUT')).status).toBe(403);
    expect((await call('dev', '/delegations/technical', { active: true }, 'PUT')).status).toBe(403);
    expect((await call('cl', '/delegations/administrative', { active: true }, 'PUT')).status).toBe(403);
  });
  it('signs out the other sessions after confirmation', async () => {
    openAs('cl', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Sécurité et connexion' }));
    await userEvent.click(screen.getByRole('button', { name: 'Déconnecter les autres sessions' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Déconnecter les autres sessions' }));
    await waitFor(() => expect(screen.queryByText('Navigateur mobile · iPhone')).toBeNull());
  });
  it('cannot switch off the second factor of the Developer', async () => {
    expect((await call('dev', '/account/two-factor', undefined, 'DELETE')).status).toBe(403);
    expect((await call('cl', '/account/two-factor', undefined, 'DELETE')).status).toBe(204);
  });
  it('finds an article', async () => {
    openAs('cl', '/aide');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Rechercher dans l’aide' }), 'double authentification');
    expect(screen.getByRole('link', { name: /Activer la double authentification/ })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/SEPA|carte bancaire/i);
  });
});
