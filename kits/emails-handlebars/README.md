# Modèles d'e-mails Handlebars

Ce dossier contient le gabarit commun, deux partiels et les modèles d'e-mails de la plateforme, au format Handlebars.

```
emails/
  layout.hbs                       gabarit commun (en-tête, mention « Merci de ne pas répondre », pied de page)
  partials/en_tete.hbs             en-tête : logo, ou nom du cabinet en texte (remplaçable)
  partials/mentions_recouvrement.hbs  mentions propres aux relances (réponses acceptées)
  templates/*.hbs                  25 modèles
  subjects.json                    objet de chaque e-mail (syntaxe Handlebars)
  config.example.json              exemple de configuration du cabinet
  samples.json                     données de test pour chaque modèle
```

## Principe

Chaque modèle appelle le gabarit commun avec un bloc de partiel et y définit ses parties par des partiels en ligne :

```hbs
{{#> layout}}
{{#*inline "accent"}}#C2410C{{/inline}}            couleur du bandeau (facultatif)
{{#*inline "preheader"}}Texte d'aperçu{{/inline}}  ligne visible dans la boîte de réception (facultatif)
{{#*inline "mentions"}}{{> mentions_recouvrement}}{{/inline}}   relances uniquement
{{#*inline "content"}} ... lignes <tr> du corps ... {{/inline}}
{{/layout}}
```

Le gabarit affiche `{{> en_tete}}`, puis `{{> content}}`, puis le bloc `mentions`. Par défaut, ce bloc contient la mention « Ce message vous est envoyé automatiquement : merci de ne pas y répondre ». Les trois relances le remplacent par `{{> mentions_recouvrement}}` (rappel de l'article L111-8 du CPCE et invitation à répondre). Le pied de page affiche ensuite le nom, le SIREN et le téléphone du cabinet.

Aucune valeur n'est écrite en dur : nom, SIREN, téléphone, adresses e-mail, adresse de l'espace débiteur, IBAN, BIC, ordre et adresse des chèques viennent tous de l'objet `config`. L'en-tête vient du partiel `en_tete` : il affiche le logo si `config.logo_url` est renseigné, avec le nom du cabinet comme texte de remplacement quand les images sont bloquées ; sinon, il affiche le nom du cabinet en texte. Pour un logo net sur écran haute densité, l'image doit faire au moins deux fois la largeur d'affichage (520 px pour 260 px), sur fond blanc plutôt que transparent : en mode sombre, certaines messageries assombrissent le fond du mail et le nom en bleu marine devient illisible sur un logo transparent.

Mode sombre : si `config.logo_dark_url` est renseigné, la version négative du logo remplace la version couleur dans Outlook (webmail et nouvelle application) lorsqu'il affiche le mail en mode sombre. Le seul bloc `<style>` des modèles, dans `layout.hbs`, sert uniquement à cet échange : une messagerie qui l'ignore affiche le logo couleur. Gmail ne permet pas de détecter le mode sombre : le logo couleur doit donc rester lisible sur fond sombre, d'où le fond blanc recommandé.

Le HTML suit les règles d'affichage des clients de messagerie : mise en page en tableaux, styles en ligne (seule exception : le bloc `<style>` du mode sombre), `bgcolor` doublé pour Outlook, pas d'abréviations CSS pour les marges.

## Intégration (Node.js, handlebars 4.x)

```js
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

Handlebars.registerPartial('layout', read('layout.hbs'));
for (const f of fs.readdirSync(path.join(dir, 'partials'))) {
  Handlebars.registerPartial(path.basename(f, '.hbs'), read(path.join('partials', f)));
}
const subjects = JSON.parse(read('subjects.json'));
const config = JSON.parse(read('config.example.json')); // à remplacer par la configuration de l'application

function renderEmail(name, data) {
  const ctx = { ...data, config };
  const subject = Handlebars.compile(subjects[name], { noEscape: true })(ctx);
  const html = Handlebars.compile(read(path.join('templates', name + '.hbs')))({ ...ctx, subject });
  return { subject, html };
}
```

Les objets se compilent avec `noEscape: true` : ce sont du texte brut, pas du HTML. Le corps, lui, est échappé normalement.

### Réponses

Seules les relances (`reminder-1`, `reminder-2`, `reminder-3`) acceptent les réponses : envoyez-les avec `reply_to` égal à `config.collection_email`. Les autres e-mails partent d'une adresse qui ne reçoit pas de réponses, conformément à la mention du gabarit.

```js
await resend.emails.send({
  from: 'Cabinet <notifications@exemple.fr>',
  to: [destinataire],
  subject, html,
  ...(name.startsWith('reminder-') ? { replyTo: config.collection_email } : {}),
});
```

## Conventions de données

- Montants et dates arrivent déjà formatés en texte (`"11 445,48 €"`, `"25/11/2026"`) : les modèles n'utilisent aucun assistant de formatage.
- Les champs « facultatifs » peuvent être absents ou vides : la ligne ou la phrase correspondante disparaît.
- Les booléens (`case.fully_paid`, `plan.approved`, `import.has_errors`…) pilotent les variantes d'un même e-mail.
- Les listes (`invoices`, `plan.installments`, `import.errors`, `lines`, `digest.items`, `alert.metrics`) sont parcourues avec `{{#each}}`. Pour les relances, le pluriel (« factures… impayées ») se déduit de la présence d'une seconde facture.
- Attention à `{{#if}}` : en Handlebars, `0` est considéré comme vide. Les compteurs (`import.created`…) sont affichés sans condition.

## Configuration

| Clé | Rôle | Exemple |
|---|---|---|
| `config.firm_name` | Nom du cabinet | LEGAREC |
| `config.firm_tagline` | Sous-titre affiché sous le nom dans l'en-tête texte (facultatif) | Cabinet de recouvrement |
| `config.logo_url` | Adresse de l'image du logo ; si vide, l'en-tête affiche le nom en texte (facultatif) | https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete.png |
| `config.logo_width` | Largeur d'affichage du logo en pixels (260 par défaut) (facultatif) | 260 |
| `config.logo_dark_url` | Adresse du logo négatif, affiché à la place du logo par Outlook en mode sombre (facultatif) | https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete-negatif.png |
| `config.firm_siren` | SIREN du cabinet | [SIREN] |
| `config.phone` | Téléphone affiché | 01 87 88 02 98 |
| `config.phone_href` | Téléphone au format international, pour les liens tel: | +33187880298 |
| `config.collection_email` | Adresse e-mail du service recouvrement (adresse de réponse des relances) | recouvrement@legarec.fr |
| `config.support_email` | Adresse e-mail de support (créanciers et collaborateurs) | administratif@legarec.fr |
| `config.portal_url` | Adresse complète de l'espace débiteur | https://paiement.legarec.fr |
| `config.portal_label` | Adresse de l'espace débiteur telle qu'affichée | paiement.legarec.fr |
| `config.account_holder` | Titulaire du compte bancaire de règlement | [TITULAIRE] |
| `config.bank_name` | Nom de la banque (facultatif) | Banque Populaire Méditerranée |
| `config.iban` | IBAN du compte de règlement | [IBAN DU COMPTE DÉDIÉ] |
| `config.bic` | BIC du compte de règlement | [BIC] |
| `config.cheque_payee` | Ordre des chèques | LEGAREC |
| `config.cheque_address` | Adresse d'envoi des chèques | LEGAREC, 42 rue Monge, 75005 Paris |
| `config.plan_approval_threshold` | Durée au-delà de laquelle un échéancier exige l'accord du créancier | 6 mois |

## Catalogue

La liste fournie compte 25 fichiers (et non 24) : tous sont présents.

| Fichier | E-mail | Destinataire | Réponses |
|---|---|---|---|
| `reminder-1.hbs` | Relance niveau 1 (normale) | débiteur | oui |
| `reminder-2.hbs` | Relance niveau 2 (importance haute) | débiteur | oui |
| `reminder-3.hbs` | Relance niveau 3 (urgente, dernier avis) | débiteur | oui |
| `debtor-new-message.hbs` | Nouveau message du cabinet | débiteur | non |
| `debtor-request-received.hbs` | Accusé de réception d'une demande | débiteur | non |
| `payment-plan-decision.hbs` | Décision sur un échéancier (acceptation ou refus) | débiteur | non |
| `installment-reminder.hbs` | Rappel d'échéance | débiteur | non |
| `installment-missed.hbs` | Échéance manquée | débiteur | non |
| `receipt.hbs` | Quittance | débiteur | non |
| `cheque-bounced.hbs` | Chèque impayé | débiteur | non |
| `case-closed.hbs` | Dossier soldé | débiteur | non |
| `email-verification.hbs` | Vérification d'adresse e-mail | tout utilisateur | non |
| `creditor-invitation.hbs` | Invitation créancier | créancier | non |
| `creditor-password-reset.hbs` | Réinitialisation du mot de passe créancier | créancier | non |
| `import-report.hbs` | Rapport d'import | créancier | non |
| `payment-plan-approval-request.hbs` | Accord sur un échéancier au-delà du seuil | créancier | non |
| `creditor-new-activity.hbs` | Nouveau message ou nouvelle pièce | créancier | non |
| `remittance-invoice.hbs` | Reversement et facture | créancier | non |
| `staff-invitation.hbs` | Invitation collaborateur | collaborateur | non |
| `staff-password-reset.hbs` | Réinitialisation du mot de passe collaborateur | collaborateur | non |
| `staff-2fa-enabled.hbs` | Double authentification activée | collaborateur | non |
| `staff-new-device.hbs` | Connexion depuis un nouvel appareil | collaborateur | non |
| `delegation-changed.hbs` | Délégation modifiée | collaborateur | non |
| `notifications-digest.hbs` | Récapitulatif des notifications | créancier ou collaborateur | non |
| `ops-alert.hbs` | Alerte d'exploitation | équipe technique | non |

## Variables par modèle

L'en-tête de chaque fichier `.hbs` reprend cette liste avec la description de chaque champ. Tous les modèles reçoivent aussi `config` et `subject`.

- **reminder-1** : `case.access_code` (facultatif), `case.deadline` (facultatif), `case.reference`, `case.total_due`, `creditor.establishment` (facultatif), `creditor.name`, `debtor.company_name`, `debtor.contact_name` (facultatif), `debtor.siren`, `invoices`, `invoices[].due_date`, `invoices[].interest` (facultatif), `invoices[].issue_date`, `invoices[].late_fees` (facultatif), `invoices[].number`, `invoices[].principal`, `invoices[].total`
- **reminder-2** : `case.access_code` (facultatif), `case.deadline` (facultatif), `case.reference`, `case.total_due`, `creditor.establishment` (facultatif), `creditor.name`, `debtor.company_name`, `debtor.contact_name` (facultatif), `debtor.siren`, `invoices`, `invoices[].due_date`, `invoices[].interest` (facultatif), `invoices[].issue_date`, `invoices[].late_fees` (facultatif), `invoices[].number`, `invoices[].principal`, `invoices[].total`
- **reminder-3** : `case.access_code` (facultatif), `case.deadline` (facultatif), `case.reference`, `case.total_due`, `creditor.establishment` (facultatif), `creditor.name`, `debtor.company_name`, `debtor.contact_name` (facultatif), `debtor.siren`, `invoices`, `invoices[].due_date`, `invoices[].interest` (facultatif), `invoices[].issue_date`, `invoices[].late_fees` (facultatif), `invoices[].number`, `invoices[].principal`, `invoices[].total`
- **debtor-new-message** : `action_url`, `case.reference`, `creditor.name`, `message.sent_at` (facultatif), `message.subject` (facultatif)
- **debtor-request-received** : `action_url`, `case.reference`, `request.reference` (facultatif), `request.response_delay` (facultatif), `request.submitted_at` (facultatif), `request.type_label`
- **payment-plan-decision** : `action_url`, `case.balance`, `case.deadline` (facultatif), `case.reference`, `plan.approved`, `plan.installments`, `plan.installments[].amount`, `plan.installments[].due_date`, `plan.installments[].number`, `plan.refusal_reason` (facultatif), `plan.total` (facultatif)
- **installment-reminder** : `action_url`, `case.reference`, `installment.amount`, `installment.balance_after` (facultatif), `installment.due_date`, `installment.number`, `plan.installment_count`
- **installment-missed** : `action_url`, `case.balance`, `case.reference`, `installment.amount`, `installment.due_date`, `installment.grace_deadline` (facultatif), `installment.number`, `plan.installment_count`
- **receipt** : `case.balance`, `case.fully_paid`, `case.reference`, `creditor.name`, `payment.amount`, `payment.date`, `payment.method_label`, `payment.reference` (facultatif), `payment.subject_to_collection`, `receipt_url` (facultatif)
- **cheque-bounced** : `action_url`, `case.balance`, `case.deadline` (facultatif), `case.reference`, `cheque.amount`, `cheque.number`, `cheque.received_date` (facultatif), `cheque.rejection_reason` (facultatif)
- **case-closed** : `case.closed_date` (facultatif), `case.reference`, `case.total_paid` (facultatif), `certificate_url` (facultatif), `creditor.name`
- **email-verification** : `expires_in` (facultatif), `recipient.email`, `recipient.first_name` (facultatif), `verification_code` (facultatif), `verification_url`
- **creditor-invitation** : `creditor.name`, `expires_in` (facultatif), `invitation_url`, `inviter.name`, `recipient.first_name` (facultatif)
- **creditor-password-reset** : `expires_in` (facultatif), `recipient.first_name` (facultatif), `requested_at` (facultatif), `reset_url`
- **import-report** : `creditor.name`, `import.created`, `import.date` (facultatif), `import.errors` (facultatif), `import.errors[].line`, `import.errors[].message`, `import.errors_more` (facultatif), `import.file_name`, `import.has_errors`, `import.rejected`, `import.total_rows`, `import.updated`, `recipient.first_name` (facultatif), `report_url`
- **payment-plan-approval-request** : `approval_url`, `case.balance`, `case.reference`, `debtor.company_name`, `plan.debtor_comment` (facultatif), `plan.duration_label`, `plan.firm_opinion` (facultatif), `plan.first_due_date`, `plan.installment_amount`, `plan.installment_count`, `plan.last_due_date`, `recipient.first_name` (facultatif), `response_deadline` (facultatif)
- **creditor-new-activity** : `action_url`, `activity.author` (facultatif), `activity.date` (facultatif), `activity.document_name` (facultatif), `activity.is_document`, `activity.subject` (facultatif), `case.reference`, `debtor.company_name`, `recipient.first_name` (facultatif)
- **remittance-invoice** : `creditor.name`, `invoice.amount_excl_tax`, `invoice.amount_incl_tax`, `invoice.number`, `invoice.settled_by_offset`, `invoice.vat`, `invoice_url`, `lines` (facultatif), `lines[].case_reference`, `lines[].collected`, `lines[].debtor_name`, `lines[].net`, `lines_more` (facultatif), `recipient.first_name` (facultatif), `remittance.bank_account` (facultatif), `remittance.collected`, `remittance.date`, `remittance.fees`, `remittance.net_amount`, `remittance.period` (facultatif), `remittance.reference`, `statement_url` (facultatif)
- **staff-invitation** : `expires_in` (facultatif), `invitation_url`, `inviter.name`, `recipient.first_name` (facultatif), `requires_2fa`, `role_label` (facultatif)
- **staff-password-reset** : `expires_in` (facultatif), `recipient.first_name` (facultatif), `requested_at` (facultatif), `reset_url`
- **staff-2fa-enabled** : `event.date`, `event.ip` (facultatif), `event.method_label` (facultatif), `recipient.first_name` (facultatif)
- **staff-new-device** : `device.browser` (facultatif), `device.ip` (facultatif), `device.location` (facultatif), `device.login_at`, `device.name` (facultatif), `recipient.first_name` (facultatif), `secure_url` (facultatif)
- **delegation-changed** : `action_url`, `delegation.changed_at` (facultatif), `delegation.changed_by` (facultatif), `delegation.end_date` (facultatif), `delegation.from_name`, `delegation.scope_label`, `delegation.start_date` (facultatif), `delegation.status_label`, `delegation.to_name`, `recipient.first_name` (facultatif)
- **notifications-digest** : `action_url`, `digest.count_label` (facultatif), `digest.items`, `digest.items[].case_reference` (facultatif), `digest.items[].date` (facultatif), `digest.items[].description` (facultatif), `digest.items[].title`, `digest.items[].url` (facultatif), `digest.more_count` (facultatif), `digest.period_label` (facultatif), `recipient.first_name` (facultatif), `settings_url` (facultatif)
- **ops-alert** : `alert.dashboard_url` (facultatif), `alert.description`, `alert.details` (facultatif), `alert.environment` (facultatif), `alert.is_critical`, `alert.metrics` (facultatif), `alert.metrics[].label`, `alert.metrics[].value`, `alert.resolved_at` (facultatif), `alert.runbook_url` (facultatif), `alert.service`, `alert.severity_label`, `alert.started_at`, `alert.title`

## Vérifications effectuées

- Les 25 modèles ont été rendus avec `samples.json` et `config.example.json`, plus 8 variantes qui couvrent les branches conditionnelles (échéancier refusé, dossier soldé, import sans anomalie, relance sans code ni établissement, etc.).
- Aucun nom, SIREN, téléphone, adresse, IBAN ni BIC n'est écrit dans les modèles, les partiels ni les objets.
- Aucun débordement horizontal sur un écran de 375 px.
- Le rendu de contrôle a été fait avec un moteur de test qui reproduit le sous-ensemble de Handlebars utilisé, faute de pouvoir installer handlebars.js dans l'environnement de travail. Faites un premier rendu avec votre propre installation de Handlebars avant la mise en production.
