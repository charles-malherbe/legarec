# Ajout au kit : message d'un collaborateur avec signature

Cet ajout complète le kit `emails-handlebars` sans modifier aucun de ses fichiers. Il réutilise le même gabarit, mais ses e-mails partent par OVH et non par Resend. Il apporte deux fichiers :

```
emails/templates/staff-message.hbs   message rédigé par un collaborateur dans l'interface web
emails/partials/signature.hbs        signature du collaborateur (même charte que les signatures de messagerie, sans les éléments déjà présents dans l'e-mail)
```

## Usage

`staff-message` est le seul modèle qui affiche une signature. Il sert quand un collaborateur écrit un message depuis l'interface web à un débiteur, à un créancier ou à tout autre correspondant d'un dossier. Les 25 modèles automatiques du kit restent sans signature.

- **Objet** : `message.subject`, saisi par le collaborateur. Ce modèle n'a pas d'entrée dans `subjects.json`.
- **Corps** : le texte saisi, découpé par l'API en blocs à chaque ligne vide (`message.blocks`) : paragraphe, liste à puces (lignes `- `) ou liste numérotée (lignes `1. `), avec gras (`**…**`) et italique (`*…*`). Chaque morceau est rendu en texte échappé, sans HTML libre : la mise en forme vient du modèle, jamais du texte. L'API remplace les espaces entre chiffres par des espaces insécables (`4 320,00 €`). Ajout du 28/11/2026 (éditeur de l'espace) ; avant, `message.paragraphs`, du texte brut.
- **Mentions** :
  - si `debtor_recipient` est vrai, le bloc `mentions` affiche `mentions_recouvrement` (rappel de l'article L111-8 du CPCE) ;
  - sinon, il affiche « Vous pouvez répondre directement à ce message. »
- **Envoi** : par la boîte OVH du collaborateur, pas par Resend.
  - `from: "Prénom NOM <initiales@legarec.fr>"`, sans `replyTo` : les réponses arrivent directement dans sa boîte OVH.
  - Offre OVH **MX Plan** : pas de compte unique autorisé à envoyer au nom des autres, chaque boîte s'authentifie avec son propre mot de passe.
  - SMTP : `smtp.mail.ovh.net`, port 465 (SSL/TLS), avec nodemailer. IMAP : `ssl0.ovh.net`, port 993.
  - Identifiants : un mot de passe par boîte personnelle professionnelle (initiales@legarec.fr ou adresse de fonction). Aucun pour recouvrement@ : cette boîte reçoit seulement (réponses aux relances), personne n'écrit depuis elle, ni dans l'interface ni dans la messagerie ; on y répond depuis sa propre boîte. Ce sont des secrets côté API, chiffrés au repos, jamais exposés au front ni écrits dans le code ou les journaux. Un mot de passe changé dans l'espace client OVH doit être mis à jour côté API ; en cas d'échec d'authentification, l'interface prévient le Développeur.
  - Quota MX Plan : environ 200 e-mails par heure et par boîte. L'API compte les envois par boîte et bloque avec un message clair avant le quota. Les envois en masse passent toujours par Resend.
  - Copie déposée dans le dossier « Éléments envoyés » de la boîte par IMAP (APPEND), sinon le message n'apparaît pas dans la messagerie du collaborateur.
  - Copie conservée dans l'historique du dossier.
  - Si l'envoi OVH échoue : message en erreur visible dans l'interface, nouvelle tentative proposée. Pas de bascule silencieuse vers Resend.

## Données de l'expéditeur

Elles viennent du compte du collaborateur connecté, jamais d'une saisie libre :

- `sender.full_name` : Prénom NOM ;
- `sender.job_title` : fonction ;
- `sender.email` : initiales@legarec.fr ;
- `sender.phone` / `sender.phone_href` : numéro 3CX du collaborateur, au format national pour l'affichage et international pour le lien. Par défaut, c'est le standard du cabinet (`config.phone`, `config.phone_href`) ;
- `sender.extension` : poste 3CX du collaborateur, affiché « 01 87 88 02 98 · poste 12 ». Le lien `tel:+33187880298,12` compose le poste après une courte pause.

Le portable personnel n'apparaît jamais dans l'e-mail et n'est pas stocké dans l'application. Le renvoi vers le mobile quand le poste ne répond pas se règle dans 3CX, sur le poste du collaborateur (règle de renvoi « pas de réponse »). Les numéros sont formatés par l'API avec libphonenumber-js.

## Pas de doublons

Chaque information n'apparaît qu'une fois dans l'e-mail.

| Information | Où elle apparaît | Retirée de |
|---|---|---|
| Logo, nom et sous-titre du cabinet | En-tête du gabarit | Signature (emblème, « LEGAREC », « Cabinet de recouvrement ») |
| SIREN | Pied de page du gabarit | Signature (« SARL · RCS Paris ») |
| Standard du cabinet | Pied de page et signature | Gardé dans les deux : seule la signature indique le poste du collaborateur |
| Référence du dossier, destinataire débiteur | Mentions de recouvrement, en bas | Ligne de tête du message |
| Référence du dossier, autres destinataires | Ligne de tête du message | Mentions (« Vous pouvez répondre directement à ce message. ») |
| E-mail, poste 3CX, adresse postale, site | Signature uniquement | — |

## Clés de configuration ajoutées

Ces clés s'ajoutent à `config` et viennent de la configuration de l'API, jamais écrites en dur :

| Clé | Exemple |
|---|---|
| `firm_address` | `42 rue Monge · 75005 Paris` |
| `website_url` | `https://www.legarec.fr` |
| `website_label` | `www.legarec.fr` |

## Tests

- Rendu de `staff-message` vers un débiteur et vers un créancier, comparé à une capture de référence.
- Vérification que la mention CPCE n'apparaît que si `debtor_recipient` est vrai.
- Échappement du texte saisi : `<script>` est rendu comme du texte.
- Vérification que la fonction est absente si `sender.job_title` est vide.
- Absence de doublons : un test vérifie que le SIREN et la référence du dossier n'apparaissent qu'une fois dans le HTML rendu.
- Ligne T : affiche le standard et le poste, avec le lien `tel:+33…,poste` ; sans poste, le standard seul.
