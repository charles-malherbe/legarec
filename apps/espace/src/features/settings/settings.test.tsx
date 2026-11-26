import { checkTemplate } from '@legarec/contracts/templateCheck';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { axeViolations } from '../../../../../packages/ui/src/testing';
import { resetAccounts } from '../../mocks/routes/account';
import { resetSettings } from '../../mocks/routes/settings';
import { resetSteering } from '../../mocks/routes/steering';
import { resetTemplates } from '../../mocks/routes/templates';
import { call, mockApi, openAs } from '../../testing';

const server = mockApi();
afterEach(() => {
  resetSettings();
  resetTemplates();
  resetSteering();
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
  it('takes the interest rate of a semester, typed by the Director, after a confirmation', async () => {
    openAs('ad', '/parametres/regles');
    await userEvent.type(await screen.findByLabelText('Valeur'), '2,5');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le taux' }));
    expect(await screen.findByText('2,50 %')).toBeVisible();
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Enregistrer le taux' }));
    expect(await screen.findByText('Taux enregistré.')).toBeVisible();
    expect(await screen.findByRole('cell', { name: '2,50 %' })).toBeVisible();
  });
  it('is read-only for an officer and refused by the API', async () => {
    openAs('hb', '/parametres/regles');
    expect(await screen.findByText('Lecture seule')).toBeVisible();
    expect(await screen.findByLabelText('Durée maximale sans validation')).toBeDisabled();
    expect((await call('hb', '/settings/firm/regles?version=0', { duration: '12 mois' }, 'PUT')).status).toBe(403);
    expect((await call('dev', '/settings/firm/regles?version=0', {}, 'PUT')).status).toBe(403);
    expect((await call('ad', '/settings/firm/regles?version=0', { duration: '3 mois' }, 'PUT')).status).toBe(204);
  });
  it('refuses an option out of the list and never takes a text between brackets for bank details', async () => {
    expect((await call('ad', '/settings/firm/regles?version=0', { duration: 'illimitée' }, 'PUT')).status).toBe(422);
    for (const iban of ['[AUTRE]', 'FR7612345']) expect((await call('ad', '/settings/firm/cabinet?version=0', { iban }, 'PUT')).status).toBe(422);
    expect((await call('ad', '/settings/firm/cabinet?version=0', { iban: '[IBAN DU COMPTE DÉDIÉ]' }, 'PUT')).status).toBe(204);
    expect(await (await call('ad', '/settings/technical/audit')).text()).not.toContain('Identifiants du cabinet modifiés');
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
    expect((await call('dev', '/secrets', { name: 'AI_API_KEY', value, rotation: '90' })).status).toBe(204);
    const body = await (await call('dev', '/secrets')).text();
    expect(body).toContain('AI_API_KEY');
    expect(body).not.toContain(value);
    expect(body).not.toMatch(/value|••/);
  });
  it('rotates a secret after confirmation', async () => {
    openAs('dev', '/parametres/techniques/secrets');
    await userEvent.click(await screen.findByRole('button', { name: 'Renouveler : TCX_API_CLIENT_SECRET' }));
    // The new value is created at the service, then pasted.
    await userEvent.click(screen.getByRole('button', { name: 'Renouveler' }));
    expect(await screen.findByText('Saisissez la valeur.')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Nouvelle valeur de TCX_API_CLIENT_SECRET'), 'valeur-fictive');
    await userEvent.click(screen.getByRole('button', { name: 'Renouveler' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Renouveler la clé' }));
    expect(await screen.findByText('TCX_API_CLIENT_SECRET renouvelé.')).toBeVisible();
  });
  it('renews an internal key without any value', async () => {
    openAs('dev', '/parametres/techniques/secrets');
    const renew = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Renouveler : ACCESS_CODE_KEY' }));
      expect((await inDialog()).getByText('Clé interne')).toBeVisible();
      await userEvent.click((await inDialog()).getByRole('button', { name: 'Renouveler la clé' }));
    };
    expect(screen.queryByRole('button', { name: 'Révoquer : ACCESS_CODE_KEY' })).toBeNull();
    await renew();
    expect(await screen.findByText('ACCESS_CODE_KEY renouvelé.')).toBeVisible();
  });
  it('undoes its own change only, never that of someone else', async () => {
    openAs('ad', '/parametres/relances');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Appels' }), '3');
    await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    expect(await screen.findByText(/» enregistré\./)).toBeVisible();
    const undo = await screen.findByRole('button', { name: 'Annuler' });
    expect((await call('ad', '/settings/firm/relances?version=1', { calls: '1' }, 'PUT')).status).toBe(204);
    await userEvent.click(undo);
    expect(await screen.findByText(/rien n’a été annulé/)).toBeVisible();
    expect(await (await call('ad', '/settings/firm/relances')).text()).toContain('"value":"1"');
  });
  it('does not overwrite what someone else has just saved in the section', async () => {
    openAs('ad', '/parametres/relances');
    const field = await screen.findByRole('combobox', { name: 'Appels' });
    const { version } = (await (await call('ad', '/settings/firm/relances')).json()) as { version: number };
    expect((await call('ad', `/settings/firm/relances?version=${version}`, { calls: '1' }, 'PUT')).status).toBe(204);
    await userEvent.selectOptions(field, '3');
    await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    expect(await screen.findByText(/vient d’être modifiée par quelqu’un d’autre/)).toBeVisible();
  });
});

describe('firm identity', () => {
  it('belongs to the Director alone, with valid values, a confirmation and no value in the journal', async () => {
    // Example IBAN of the international standard, not a real account.
    const iban = 'GB82 WEST 1234 5698 7654 32';
    expect((await call('cl', '/settings/firm/cabinet?version=0', { iban }, 'PUT')).status).toBe(403);
    expect((await call('ad', '/settings/firm/cabinet?version=0', { iban: 'GB82 WEST 1234 5698 7654 33' }, 'PUT')).status).toBe(422);
    openAs('ad', '/parametres/cabinet');
    const field = await screen.findByLabelText('IBAN du compte dédié');
    await userEvent.clear(field);
    await userEvent.type(field, 'GB00');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Cet IBAN n’est pas valide.')).toBeVisible();
    await userEvent.clear(field);
    await userEvent.type(field, iban);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await userEvent.click((await inDialog()).getByRole('button', { name: 'Enregistrer ces identifiants' }));
    expect(await screen.findByText('« Cabinet » enregistré.')).toBeVisible();
    const journal = await (await call('ad', '/settings/techniques/audit')).text();
    expect(journal).toContain('Identifiants du cabinet modifiés : iban');
    expect(journal).not.toContain('WEST');
  });
  it('is locked for the delegate', async () => {
    openAs('cl', '/parametres/cabinet');
    expect(await screen.findByLabelText('IBAN du compte dédié')).toBeDisabled();
    expect(screen.getByLabelText('Téléphone du service')).toBeEnabled();
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
  });
  it('never deletes a mailbox from the application', async () => {
    openAs('dev', '/parametres/techniques/boites');
    await userEvent.click(await screen.findByRole('button', { name: 'Gérer : tg@legarec.fr' }));
    expect(screen.getByText(/espace client OVH/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Supprimer la boîte/ })).toBeNull();
    expect(await (await call('dev', '/mailboxes')).text()).toContain('tg@legarec.fr');
  });
  it('asks the Developer for a mailbox when a collaborator is invited', async () => {
    const person = { firstName: 'Ana', lastName: 'Costa' };
    expect((await call('cl', '/members', { ...person, role: 'CLAIMS_OFFICER', email: 'ac@legarec.fr' })).status).toBe(204);
    expect((await call('cl', '/members', { ...person, role: 'CREDITOR', email: 'a@exemple.fr', creditorId: 'md' })).status).toBe(204);
    openAs('dev', '/parametres/techniques/boites');
    await userEvent.click(await screen.findByRole('button', { name: 'Créer la boîte ac@legarec.fr' }));
    const dialog = await inDialog();
    expect(dialog.getByText('5 Go')).toBeVisible();
    expect(dialog.getByText('Camille Laurent')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Créer la boîte' }));
    expect((await screen.findByTestId('issued-password')).textContent).toHaveLength(16);
    expect(screen.queryByText('Demandes de boîte')).toBeNull();
  });
  it('keeps reserved addresses and the request as the only source of a new mailbox', async () => {
    const person = { firstName: 'Ana', lastName: 'Costa', role: 'CLAIMS_OFFICER' };
    for (const email of ['Recouvrement@legarec.fr', 'dpo@legarec.fr', 'x@exemple.fr'])
      expect((await call('cl', '/members', { ...person, email })).status).toBe(422);
    const box = { holderId: null, sizeMb: 5000 };
    expect((await call('dev', '/mailboxes', { ...box, local: 'Recouvrement' })).status).toBe(422);
    expect((await call('dev', '/mailboxes', { ...box, local: 'recouvrement' })).status).toBe(422);
    expect((await call('dev', '/mailboxes', { ...box, local: 'nouvelle', sizeMb: 999999 })).status).toBe(422);
    expect((await call('dev', '/mailboxes', { ...box, local: 'nouvelle', requestId: 'perdue' })).status).toBe(409);
    expect((await call('cl', '/members', { ...person, email: 'AC@legarec.fr' })).status).toBe(204);
    const asked = ((await (await call('dev', '/mailboxes')).json()) as { requests: { id: string }[] }).requests[0];
    // The address sent by the screen is ignored: the one of the request is created.
    expect((await call('dev', '/mailboxes', { ...box, local: 'autre', requestId: asked?.id })).status).toBe(200);
    const boxes = await (await call('dev', '/mailboxes')).text();
    expect(boxes).toContain('ac@legarec.fr');
    expect(boxes).not.toContain('autre@legarec.fr');
  });
  it('closes the mailbox request of a cancelled invitation', async () => {
    const person = { firstName: 'Ana', lastName: 'Costa', role: 'CLAIMS_OFFICER', email: 'ac@legarec.fr' };
    expect((await call('cl', '/members', person)).status).toBe(204);
    const { members } = (await (await call('cl', '/members')).json()) as { members: { id: string; email: string }[] };
    const id = members.find((item) => item.email === 'ac@legarec.fr')?.id;
    expect((await call('cl', `/members/${id}`, undefined, 'DELETE')).status).toBe(204);
    expect(((await (await call('dev', '/mailboxes')).json()) as { requests: unknown[] }).requests).toEqual([]);
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

describe('journal of the assistant', () => {
  it('shows each suggestion with its case, its colleague and its decision to the Director, a page at a time', async () => {
    openAs('ad', '/parametres/ia');
    const table = await screen.findByRole('table', { name: 'Journal de l’IA' });
    expect(within(table).getByText('DOS-2026-0142')).toBeVisible();
    expect(within(table).getAllByText('Synthèse du dossier')).toHaveLength(6);
    expect(within(table).getByText('Signalée')).toBeVisible();
    expect(screen.getByText(/30 derniers jours : 40 % acceptées telles quelles, 40 % modifiées, 20 % ignorées, 1 signalement\./)).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Pages du journal de l’IA' })).toHaveTextContent('1–6 sur 6 suggestions');
    expect(await axeViolations(document.body)).toEqual([]);
  });
  it('gives no case to the Developer', async () => {
    openAs('dev', '/parametres/ia');
    const table = await screen.findByRole('table', { name: 'Journal de l’IA' });
    expect(within(table).queryByText(/DOS-2026/)).toBeNull();
  });
  it('is refused to the other roles, on the screen and by the API', async () => {
    openAs('hb', '/parametres/ia');
    expect(await screen.findByText('Le journal de l’IA est réservé au Directeur et au Développeur.')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Journal de l’IA' })).toBeNull();
    for (const who of ['hb', 'cl']) expect((await call(who, '/ai/journal')).status).toBe(403);
  });
  it('says when it is empty, and offers to try again after an error', async () => {
    const empty = { items: [], page: 1, pageSize: 25, total: 0, last30Days: { suggested: 0, accepted: 0, modified: 0, ignored: 0, reported: 0 } };
    server.use(http.get('/api/ai/journal', () => HttpResponse.json({ code: 'INTERNAL' }, { status: 500 })));
    openAs('ad', '/parametres/ia');
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeVisible();
    server.use(http.get('/api/ai/journal', () => HttpResponse.json(empty)));
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Aucune suggestion pour le moment')).toBeVisible();
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
    ['{{~{debiteur.iban}~}}', /ERROR Champ/],
    ['{{&debiteur.adresse}}', /ERROR Champ non protégé/],
    ['{{#each creance.factures a="{"}}{{~{this}~}}{{/each}}', /ERROR/],
    ['{{#each creance.factures as |x|}}{{x}}{{/each}}', /ERROR/],
    ['{{lookup debiteur "iban"}}', /ERROR Champ inconnu/],
    ['{{@root.config}}', /ERROR Champ inconnu/],
    ['{{#> layout}}x{{/layout}}', /ERROR Instruction interdite/],
    ['{{{{raw}}}}<script></script>{{{{/raw}}}}', /ERROR/],
    ['<svg/onload=alert(1)>', /ERROR Script/],
    ['<img alt="a"onerror=alert(1)>', /ERROR Script/],
    ['<a href="java&#115;cript:alert(1)">x</a>', /ERROR Script/],
    ['<a href="javascript:alert(1)">x</a>', /ERROR Script/],
    ['<meta content="0;url=https://exemple.fr" http-equiv="refresh">', /ERROR Script/],
    ['<image href="https://exemple.fr/a.png">', /ERROR Script/],
    ['<td background="https://exemple.fr/a.png">', /ERROR Script/],
    ['<video poster="https://exemple.fr/a.png">', /ERROR Script/],
    ['<p style="background:image-set(\'a.png\' 1x)">', /ERROR Script/],
    ['<p style="background:u\\72l(https://exemple.fr)">', /ERROR Script/],
    ['<p style="background:url(file:///etc/passwd)">', /ERROR Script/],
    ['<p style="{{debiteur.adresse}}">', /ERROR Script/],
    ['<!-- caché -->', /ERROR Script/],
    ['<a href="https://evil.{{#unless cabinet.nom}}legarec.{{/unless}}fr/pay">x</a>', /ERROR Script/],
    ['<img src="cid:x" title="a{{#unless cabinet.nom}}"{{/unless}} class=" onerror=alert(1) x="><p title="b">', /ERROR Script/],
    ['<style>p { background: u {{~! x ~}} rl(https://exemple.fr) }</style>', /ERROR/],
    ['<style>p { color{{! x }}: #222222 }</style>', /ERROR Script/],
    ['<a href="{{paiement.lien}}.evil.fr">x</a>', /ERROR Script/],
    ['<a href="https://legarec.fr" href="https://legarec.fr">x</a>', /ERROR Script/],
    ['<p style="color:#fff">x</p>', /ERROR Script/],
    ['<p style="color:#eeeeee;background-color:#ffffff">x</p>', /ERROR Script/],
    ['<p style="margin-left:-9999px">x</p>', /ERROR Script/],
    ['<p style="display:var(--x)">x</p>', /ERROR Script/],
    ['<p style="font:0/0 a">x</p>', /ERROR Script/],
    ['<p style="font-size:1px">x</p>', /ERROR Script/],
    ['<p style="font-size:60">x</p>', /ERROR Script/],
    ['<p style="max-height:0">x</p>', /ERROR Script/],
    ['<p style="line-height:0">x</p>', /ERROR Script/],
    ['<style>@media print { p { color: #222222 } }</style>', /ERROR Script/],
  ])('refuses %s', (extra, expected) => {
    expect(checkTemplate(letter, good + extra).accepted).toBe(false);
    expect(labels(good + extra).join('\n')).toMatch(expected);
  });
  it.each([
    '{{!-- {{> mentions_recouvrement}} --}}',
    '{{#unless cabinet.nom}}{{> mentions_recouvrement}}{{/unless}}',
    '<!-- {{> mentions_recouvrement}} -->',
    '<div style="display:none">{{> mentions_recouvrement}}</div>',
    '<title>{{> mentions_recouvrement}}</title>',
    '<table><colgroup>{{> mentions_recouvrement}}</colgroup></table>',
    '<div style="color:#fff">{{> mentions_recouvrement}}</div>',
    '<div style="margin-left:-9999px">{{> mentions_recouvrement}}</div>',
  ])('refuses a hidden mandatory block: %s', (hidden) => {
    expect(checkTemplate(letter, good.replace('{{> mentions_recouvrement}}', hidden)).accepted).toBe(false);
  });
  it('refuses a first letter recalled only under a condition', () => {
    const conditional = good.replace(/\{\{(dossier\.premier_courrier_\w+)\}\}/g, '{{#if $1}}{{$1}}{{/if}}');
    expect(labels(conditional)).toContain('ERROR Rappel du premier courrier absent');
  });
  it('keeps the access code out of e-mails and SMS', () => {
    expect(checkTemplate(letter, `${good}{{debiteur.code_acces}}`).accepted).toBe(true);
    expect(labels(`${good}{{debiteur.code_acces}}`, { ...letter, kind: 'EMAIL' }).join()).toMatch(/ERROR Code d’accès interdit/);
    expect(checkTemplate({ ...letter, kind: 'SMS', isReminder: false, block: 'mention_sms' }, '{{debiteur.code_acces}} {{> mention_sms}}').accepted).toBe(
      false,
    );
  });
  it('accepts ordinary letters, logos and the link to the portal', () => {
    const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>@page { margin: 20mm; } p { margin: 0 0 12px; color: #222222; } .note { font-size: 9pt; background-color: #f4f4f4; } h1 { color: #ffffff; background-color: #002b74; }</style></head><body>{{> en_tete}}<img src="https://media.legarec.fr/marque/logo.png" alt="Legarec"><a href="{{paiement.lien}}">Votre espace</a><table><tr><td style="width:100px">x</td></tr></table>${good}</body></html>`;
    expect(checkTemplate(letter, page)).toMatchObject({ accepted: true });
  });
  it('detects bailiff-like plurals and split words', () => {
    expect(labels(`${good}<p>Commandements de payer, com&shy;mandement</p>`).join()).toMatch(/WARNING Termes/);
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
    expect((await call('dev', '/settings/techniques/securite?version=0', {}, 'PUT')).status).toBe(403);
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
  it('shows the backup codes once, after the first second factor', async () => {
    openAs('hb', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Sécurité et connexion' }));
    await userEvent.click(screen.getByRole('button', { name: 'Utiliser une application' }));
    await userEvent.type(await screen.findByLabelText('Code à 6 chiffres'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activer' }));
    expect(await screen.findByText('Codes de secours')).toBeVisible();
    expect(screen.getAllByText(/^\d{4}-\d{4}$/)).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: "J'ai conservé mes codes" }));
    expect(screen.queryByText('Codes de secours')).toBeNull();
    // A second one brings no new code.
    await userEvent.click(screen.getByRole('button', { name: 'Changer d’application' }));
    await userEvent.type(await screen.findByLabelText('Code à 6 chiffres'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activer' }));
    await waitFor(() => expect(screen.queryByLabelText('Code à 6 chiffres')).toBeNull());
    expect(screen.queryByText('Codes de secours')).toBeNull();
  });
  it.each([
    [422, { code: 'INVALID_CREDENTIALS' }, 'Mot de passe actuel incorrect.'],
    [422, { code: 'INVALID', fields: ['password'] }, 'Le nouveau mot de passe doit être différent de votre adresse e-mail.'],
    [423, { code: 'LOCKED' }, 'Compte bloqué pendant 15 minutes après 5 tentatives échouées.'],
  ])('explains the refusal of a password: %s %j', async (status, body, text) => {
    server.use(http.put('/api/account/password', () => HttpResponse.json(body, { status })));
    openAs('cl', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Sécurité et connexion' }));
    await userEvent.type(screen.getByLabelText('Mot de passe actuel'), 'motdepasse12');
    await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'Un-mot-de-passe-9!');
    await userEvent.click(screen.getByRole('button', { name: 'Mettre à jour le mot de passe' }));
    expect(await screen.findByText(text)).toBeVisible();
  });
  it('says that the network is cut, rather than that the password is wrong', async () => {
    server.use(http.put('/api/account/password', () => HttpResponse.error()));
    openAs('cl', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Sécurité et connexion' }));
    await userEvent.type(screen.getByLabelText('Mot de passe actuel'), 'motdepasse12');
    await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'Un-mot-de-passe-9!');
    await userEvent.click(screen.getByRole('button', { name: 'Mettre à jour le mot de passe' }));
    expect(await screen.findByText('Le service ne répond pas. Vérifiez votre connexion et réessayez.')).toBeVisible();
    expect(screen.getByLabelText('Nouveau mot de passe')).toHaveValue('Un-mot-de-passe-9!');
  });
  it('refuses a wrong code of the application, and lets one give up', async () => {
    openAs('hb', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Sécurité et connexion' }));
    await userEvent.click(screen.getByRole('button', { name: 'Utiliser une application' }));
    await userEvent.type(await screen.findByLabelText('Code à 6 chiffres'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Activer' }));
    expect(await screen.findByText(/Code incorrect/)).toBeVisible();
    expect(screen.queryByText('Codes de secours')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByLabelText('Code à 6 chiffres')).toBeNull();
    expect(screen.getByText('Non activée')).toBeVisible();
  });
  it('has no axe violation on the security of the account, from the code to the backup codes', async () => {
    openAs('hb', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Sécurité et connexion' }));
    const main = screen.getByRole('main');
    expect(await axeViolations(main)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Utiliser une application' }));
    await userEvent.type(await screen.findByLabelText('Code à 6 chiffres'), '123456');
    expect(await axeViolations(main)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Activer' }));
    expect(await screen.findByText('Codes de secours')).toBeVisible();
    expect(await axeViolations(main)).toEqual([]);
  });
  it('says that the service is away, or that the account is locked, while a second factor is set up', async () => {
    openAs('cl', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Sécurité et connexion' }));
    server.use(http.post('/api/account/two-factor/totp', () => HttpResponse.json({ code: 'INTERNAL' }, { status: 500 }), { once: true }));
    const start = screen.getByRole('button', { name: /application/ });
    await userEvent.click(start);
    expect(await screen.findByText(/Le service ne répond pas/)).toBeVisible();
    await userEvent.click(start);
    await userEvent.type(await screen.findByLabelText('Code à 6 chiffres'), '123456');
    server.use(http.post('/api/account/two-factor/totp/verify', () => HttpResponse.json({ code: 'LOCKED' }, { status: 423 })));
    await userEvent.click(screen.getByRole('button', { name: 'Activer' }));
    expect(await screen.findByText(/Compte bloqué pendant 15 minutes/)).toBeVisible();
  });
  it('says what a substitute receives', async () => {
    openAs('cl', '/compte');
    await userEvent.click(await screen.findByRole('tab', { name: 'Profil' }));
    expect(await screen.findByText(/notifications neutres, sans accès à vos dossiers/)).toBeVisible();
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
