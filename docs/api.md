# API (apps/api) : architecture, schéma, sécurité

Plan validé par le cabinet le 25/11/2026 (questions 65 à 111 de `DECISIONS.md`). À lire avant de toucher à `apps/api`, `packages/contracts` ou `infra/`. Lots, avancement et points à reprendre du front : `PLAN.md`. En cas d'écart, la décision la plus récente de `DECISIONS.md` l'emporte.

But : remplacer les 161 routes simulées (MSW) des trois portails par `apps/api`, derrière les contrats existants. À la fin, chaque route a sa garde de rôle, sa politique de sécurité par ligne et son test de cloisonnement ; MSW ne sert plus qu'aux tests de composants.

## Architecture

### Dépôt
```
apps/api/prisma/{schema,migrations,seed}        schéma multi-fichiers, SQL complété à la main, comptes de démonstration
apps/api/src/main.ts, worker.ts, migrate.ts, account.ts   API HTTP, workers BullMQ, migrations et commande des comptes (même code, quatre programmes)
apps/api/src/platform/                          access, audit, config, crypto, database, errors, http, limits, logging, queue (puis storage, clock)
apps/api/src/modules/<domain>/                  controller, service, tests ; `auth` seul ouvre une transaction au nom d'un compte
apps/api/test/                                  matrice d'accès, navigateur, clé de sécurité et worker de test, parité avec les simulations
infra/dev/{services,api}.mjs                    PostgreSQL et Valkey de développement (sans root ni service, 127.0.0.1:55432 et 56379), lancement de l'API
packages/contracts/{src,test,openapi.json}      Zod : seule source ; corps de requêtes ; requêtes rejouées contre les simulations et contre l'API
```
Réutilisé tel quel : `canReadCase`, `canActOnCase`, `hasDelegation`, `allocatePayment`, `splitPlan`, `planApprovals`, `letterAmount`, `billingTotals`, `measureSms`, `checkTemplate`, `checkCoordinate`, `firmIdentity`, `newMember`, `newMailbox` (`packages/contracts/src`), `EmailRenderer`, `EmailsService`, `StaffMessagesService`, `formatPhone` (`apps/api/src/emails`). Les règles écrites dans les simulations (`overCap`, `outsideHours`, `onTarget`, `acting`) deviennent du code d'API avec les mêmes tests.

### Dépendances par lot (versions vérifiées sur npm le 25/11/2026, figées à l'installation)
| Lot | Paquets |
|---|---|
| J | `@nestjs/{common,core,platform-express,testing}` 12.6.0, `@nestjs/swagger` 12.1.2, `reflect-metadata` 0.2.2, `rxjs` 7.8.2, `prisma` + `@prisma/client` + `@prisma/adapter-pg` 7.10.1 (la 8 n'est qu'en rc), `pg` 8.23.1, `bullmq` 6.7.9, `ioredis` 6.1.0, `pino` 10.4.0 ; dev : `openapi-typescript` 7.13.0, `fast-check` 4.11.0, types |
| K | `argon2` 0.45.2, `otplib` 13.6.0, `@simplewebauthn/server` 14.1.0 |
| N | `@aws-sdk/client-s3` et `s3-request-presigner` 3.1177.0, `file-type` 22.3.0, `qrcode` 1.5.4 et `playwright` 1.65.1 (déjà présents) |
| P | `csv-parse` 7.0.3, `read-excel-file` 9.3.20, `write-excel-file` 4.1.1, `fflate` 0.8.3 |
| R | `nodemailer` 10.6.1, `imapflow` 2.12.2, `mailparser` 3.15.0 |

Aucun script d'installation de dépendance ne s'exécute (`allowBuilds` dans `pnpm-workspace.yaml`). De Prisma, seul le client sert : son moteur natif, téléchargé à la première utilisation hors du fichier de versions, n'est jamais appelé. `node dist/migrate.js` applique les migrations (une transaction et une empreinte par migration, verrou contre deux déploiements simultanés) ; un test compare le schéma Prisma à la base, sans moteur. `openapi-typescript` n'annonce pas encore TypeScript 6, mais fonctionne avec.

Sans dépendance : Resend, MySendingBox, OVH (appels signés : le paquet `ovh` date de 2019), 3CX, IA compatible OpenAI, ClamAV, limites par IP (Valkey). Construction par Vite, déjà présent.

### Routes, sessions, en-têtes
- `https://api.legarec.fr` : `/staff`, `/partner`, `/debtor`, `/public` (valeurs des pages légales), `/hooks`, `/service` (n8n, fermé depuis Internet par Caddy), `/health`. Un rôle PostgreSQL par préfixe. Les chemins des simulations ne changent pas : `VITE_API_URL` vaut `…/staff`, `…/partner`, et la racine pour paiement. En développement, proxy Vite `/api`.
- Cookies `__Host-` distincts par portail, HttpOnly, Secure, SameSite=Strict ; jeton opaque de 256 bits, haché en base ; fermeture à 30 minutes d'inactivité (voir « Comptes »). En-tête `Origin` strictement égal à l'origine du portail attendu pour le préfixe, refusé s'il manque en écriture, contrôlé avant la route puis de nouveau avec la règle d'accès ; préfixe en minuscules exactes, sinon 404 ; JSON seulement, hors dépôt de fichier (`upload`) ; `Cache-Control: no-store` partout. Adresse IP posée par Caddy, un seul relais de confiance.
- Jetons (réinitialisation, invitation, lien) : jamais dans un journal. Pino note le modèle de route, Caddy masque ces chemins ; ils font partie du test de fuites.
- Webhooks : Resend, signature vérifiée sur le corps brut. MySendingBox, aucune signature trouvée dans la partie lue de sa documentation : lettre connue du même environnement, sinon 204 sans appel ; l'API relit la lettre chez lui, une fois par minute et par lettre au plus ; un statut ne recule jamais ; interrogation périodique en complément.
- Action qui engage : `Idempotency-Key` et, si le récapitulatif porte un montant, un nombre ou un destinataire, valeur attendue ; l'API répond 409 si l'état a changé depuis la confirmation. Seules les routes `@Commits()` gardent une clé : 48 heures, avec l'empreinte HMAC de l'adresse et du corps (corps différent : 422) et la réponse chiffrée, lisibles sous l'ancienne clé de signature pendant son renouvellement ; une valeur affichée une seule fois (mot de passe de boîte, clé, TOTP, codes de secours, code d'accès) n'y est jamais enregistrée : rejeu = 409. Côté portail, la clé reste en mémoire jusqu'à la réponse de l'API (un échec 5xx la garde), une heure au plus, sous une empreinte du changement ; la déconnexion les efface toutes.
- Erreurs : mêmes codes que les simulations (`INVALID`, `FORBIDDEN`, `LOCKED`, `SELECTION_CHANGED`…). Une erreur de saisie nomme les champs, jamais ce qui a été tapé.
- Corps des requêtes : une seule définition, `packages/contracts/src/requests.ts`, lue par l'API et par les simulations, qui refusent ce que l'API refuserait. Chaque texte et chaque liste y a un plafond, testé (`packages/contracts/src/limits.ts`) ; un corps ou un paramètre sans schéma, ou une route qui lit la requête à la main, empêche l'API de démarrer.

### Comptes (lot K)
- **Connexion** : mot de passe (Argon2id, 64 Mo, 3 passes, 3 vérifications à la fois, 60 en attente au plus, puis 503), puis second facteur. Une adresse inconnue, un mot de passe faux, un compte invité, désactivé ou dont le portail est fermé reçoivent la même réponse, après le même travail. Chaque essai est compté avant d'être vérifié : 5 échecs ferment 15 minutes l'adresse, ou le second facteur du compte, même avec le bon secret. Limites par réseau (adresse IPv4, bloc /64 en IPv6), comptées dans Valkey, refus si Valkey est absent : 30 connexions, 30 codes et 60 débuts de second facteur en 10 minutes ; 10 oublis par heure ; 3 liens par heure et par adresse ; ceux du support sont comptés à part (3 par compte), pour qu'un inconnu ne l'empêche pas d'aider. Un « mot de passe oublié » ajoute une tâche que l'adresse soit connue ou non.
- **Une chose à la fois par compte** : une transaction qui écrit sur un compte prend d'abord sa ligne (`users`), puis le reste. Le mot de passe, le rôle et le statut sont relus à cet instant : une connexion lancée pendant une réinitialisation, un changement ou une désactivation n'ouvre rien (`races.test.ts`). Une route de Mon compte relit aussi sa session à cet instant (`Accounts.own`) : fermée entre-temps, elle ne fait rien. Compte désactivé entre-temps : rien n'est écrit. Deux changements qui s'attendent : 409 `CONFLICT`, à refaire. `legarec_auth` n'écrit rien tant que le compte n'a pas prouvé qui il est.
- **Sessions** : un cookie par portail (`__Host-staff`, `__Host-partner`), 30 minutes sans requête de la personne, 12 heures au plus ; « Rester connecté » garde le cookie 30 jours, sans changer ces durées. Mot de passe accepté mais second facteur attendu : 10 minutes, rien d'ouvert, puis un autre jeton. Statut, rôle, portail, délégations relus à chaque requête. `X-Background: 1` : ce que l'écran demande seul ne prolonge pas. `__Host-device` (30 jours) reconnaît un navigateur déjà vu, pour prévenir le titulaire d'un nouveau ; il n'ouvre rien.
- **Second facteur** : application (secret chiffré, un code ne sert jamais deux fois, une étape de 30 secondes de tolérance), clés de sécurité (défi à usage unique, 5 minutes, lié à la session), 8 codes de secours montrés une fois. Toujours exigé du Développeur (déclencheur) ; exigé et absent : la connexion s'arrête sur sa mise en place. Un second facteur exigé en cours de route vaut pour la connexion suivante ; l'activer ferme les autres sessions. Un secret est réécrit sous la clé courante à la connexion de son titulaire : l'ancienne clé maîtresse se retire une fois tout le monde passé.
- **Preuve redemandée** (questions 122 et 134) : liste `SENSITIVE_ACTIONS` des contrats, la même pour l'API, la fenêtre et les simulations. `@RequiresProof()`, ou `requireProof()` quand l'action dépend de ce qui est demandé (identifiants du cabinet, second facteur ajouté à un autre) : 403 `PROOF_REQUIRED` si la dernière preuve de la session date de plus de 10 minutes, avant toute lecture. `POST /staff/auth/proof` : second facteur s'il y en a un, sinon mot de passe ; mêmes compteurs que la connexion ; le cinquième échec ferme la session. Le portail redemande, puis renvoie l'action une fois (`packages/platform/src/http.ts`).
- **Liens** (invitation 72 heures, réinitialisation 1 heure) : 256 bits, usage unique, tirés par le worker au moment de l'envoi, l'empreinte seule est gardée ; le dernier envoyé seul fonctionne, sur le portail du compte seulement ; aucun lien pour un compte désactivé entre-temps. Mot de passe choisi : 15 minutes pour le second facteur. Réinitialiser ferme les sessions et lève le blocage, sans toucher au second facteur ; pour un compte de l'équipe, le Directeur en est prévenu. Un créancier est invité tout de suite, un collaborateur quand sa boîte existe (lot R) ; d'ici là, la commande `lien`.
- **Comptes des autres** : fonctions SQL qui revérifient qui agit, ferment ce qui doit l'être et, pour le support, préviennent le Directeur dans la même transaction (`notifications` : des faits, la phrase est écrite à la lecture). Développeur : toute l'équipe, Directeur compris, jamais un compte créancier ; Responsable : tous sauf le Directeur ; second facteur du Développeur : Directeur seul ; celui d'un créancier : aussi le Responsable. Sans objet (compte non bloqué, second facteur absent ou déjà exigé) : 409, rien n'est dit. 30 actions de support par heure et par personne, Directeur à part ; la liste montre les notifications non lues d'abord, pour qu'aucune ne soit noyée. Réinitialiser le second facteur ferme aussi ce qui était en cours d'installation. Compte désactivé ou rôle changé : dossiers sans gestionnaire (nombre confirmé, sinon 409), sessions et liens fermés.
- **Délégations** : ouvertes avec le premier Directeur ; celles d'un ancien Directeur prennent fin, le nouveau redonne les siennes. Un délégué qui change le titulaire du rôle Développeur met fin à la délégation technique ; le Directeur est prévenu, même si elle était déjà fermée, et la redonne s'il le veut (question 130).
- **Sur le serveur** : `node dist/account.js director <adresse> <prénom> <nom>` (une seule fois) et `node dist/account.js lien <adresse>` ; le lien s'affiche une fois (en production, `docker compose exec`, jamais `run`, qui peut en garder la trace dans un journal). En développement : `pnpm --filter @legarec/api account …`, `pnpm --filter @legarec/api seed` (comptes de démonstration), e-mails simulés écrits dans `~/.local/share/legarec-dev/mails` (`DEV_MAIL_DIR`, refusé en production). Avant le lot Q, aucun e-mail ne part.
- **Portails** : `VITE_API=auth,account,members,delegations,support-tickets,notifications` (espace) et `VITE_API=auth` (partenaires) laissent passer ces routes vers l'API de la machine, par le proxy Vite (`API_PORT`, 3000) ; les autres restent simulées, pour la même personne. Tout ce qui est affiché, saisi ou sur le point d'être confirmé appartient à une personne : il disparaît avec sa session (`key` sur le compte). Une connexion ou une déconnexion est dite aux autres onglets, qui se vident. Une déconnexion que l'API n'a pas reçue est refaite avant d'afficher qui que ce soit (`packages/platform/src/session.ts`).

### Portefeuille (lot L)
- **Coffre** : clés des services chiffrées par `VAULT_MASTER_KEY` (`vault_secrets`), jamais relues ni renvoyées, effacées à la révocation (demandée par le Développeur, décidée par le Directeur). Clés internes `ACCESS_CODE_KEY` et `LOOKUP_KEY` (et `MAILBOX_SECRETS_KEY` au lot R) : tirées par l'API à leur premier usage, lues dans la transaction qui en a besoin par `app.internal_key()`, renouvelées sans valeur depuis l'écran. Aucune ancienne valeur n'est jetée : ce qu'elle a chiffré s'ouvre toujours, et une empreinte ne se refait pas. `ACCESS_CODE_KEY` : le worker rechiffre aussi tout sous la nouvelle (`reseal-access-codes`, puis chaque nuit, où les codes illisibles sont comptés). `VAULT_MASTER_KEY` : `VAULT_MASTER_KEY_PREVIOUS` reste en place jusqu'à la tâche de rechiffrement (lot X).
- **Paramètres** : catalogue `packages/contracts/src/settingsCatalogue.ts`, valeurs changées dans `settings`, ancienne valeur chiffrée dans `setting_versions` (Directeur) ; identifiants du cabinet (SIREN, TVA, IBAN, BIC, titulaire…) : Directeur seul, avec preuve. `?version=` obligatoire : 409 si la section a changé, « Annuler » compris. Les e-mails lisent ces valeurs à chaque envoi (`emailConfigOf`).
- **Créanciers** : fiche et mandat par le Directeur ou le Responsable (D2) ; un mandat ne change pas, un avenant met fin au précédent (jamais deux en vigueur, `EXCLUDE`). Compte de reversement : Directeur ou son délégué administratif, avec preuve ; IBAN chiffré, montré entier sur demande et noté ; fermé, il ne rouvre pas ; confirmé une fois, par qui a appelé (déclencheur).
- **Dossiers** : ouverts par le Directeur ou le Responsable (D1), pour eux ou pour personne ; les confier à quelqu'un est `POST /cases/assign`. Un dossier ouvert par créancier et débiteur. Un SIREN connu est le même débiteur si le nom (sans accents, forme juridique ni ponctuation, « & » valant « et ») et le type sont les mêmes ; sinon 409 `DEBTOR_MISMATCH`. Numéro `LGR-AAAA-NNNNN` sans trou. Un dossier qui n'est pas montré n'existe pas : 404, jamais 403. Coordonnées propres au dossier, non vérifiées à la saisie (politique restrictive).
- **Code d'accès** : 4 lettres sans I ni O, mots et suites exclus, un par débiteur, créé à la première ouverture, lié au débiteur par son chiffrement ; lu et renouvelé par qui agit sur un dossier **ouvert**, sans trace d'affichage (question 21) ; un code renouvelé ne revient jamais (empreintes des anciens) ; un code qu'aucune clé n'ouvre s'affiche « Illisible » et se régénère, sans rien bloquer d'autre ; le renouvellement nomme la version affichée (409 sinon) et se lit dans l'historique de tous les dossiers ouverts du débiteur, sans nom hors du dossier d'origine.
- **Recherche, barre du haut, notifications** : `POST /search` (corps, jamais d'URL ; 8 résultats par sorte), `GET /shell` ; l'attribution d'un dossier est dite à qui le reçoit, et pendant son absence à son remplaçant, sans dossier ni lien (question 91).
- **Essai** : `pnpm --filter @legarec/api seed` crée aussi les mandats et neuf dossiers de démonstration ; `VITE_API=auth,account,members,delegations,support-tickets,notifications,settings,secrets,creditors,cases,shell,search`. Les actions des lots suivants (relance, paiement, échéancier, courrier) répondent alors 404 sur ces dossiers.

### Argent (lot M)
- **Intérêts** (`apps/api/src/modules/payments/money.ts`, fonctions pures) : par facture, sur ce qui reste de son principal chaque jour, du lendemain de l'échéance au jour du paiement compris ; intérêts simples sur 365 jours, en centimes × points de base × jours (entiers), arrondis une fois par facture. Professionnels : taux du mandat, sinon taux BCE du semestre + 10 points ; particuliers : taux légal du semestre, à partir de `cases.formal_notice_on` (rempli par l'envoi de la mise en demeure, lot Q), jamais les 40 €. Taux saisis par semestre (`interest_rates`, `app.save_interest_rate()`, Directeur ou délégation administrative) dans Paramètres > Règles et validations ; un semestre sans taux ne compte rien.
- **Paiements** : `POST /staff/cases/:id/payments` (qui agit sur le dossier), imputés au jour de réception : intérêts du dossier, principal de la plus ancienne facture à la plus récente, indemnités, trop-perçu. `payment_allocations` en ajout seul ; leur somme égale le paiement (déclencheur différé) ; `case_invoices.principal_paid_cents` suit les imputations (déclencheur), personne ne l'écrit. Un paiement à la fois par dossier (verrou consultatif). Chèque reçu ou remis → encaissé ou impayé ; virement à rapprocher → rapproché ; quittance `Q-AAAA-NNNNN` au paiement définitif (PDF au lot N). Impayé : écritures opposées, le dû revient exactement, le dossier soldé est rouvert. Dossier soldé quand plus rien n'est dû. IBAN d'un libellé de virement masqué, sauf pour le Directeur.
- **Échéanciers** : `GET /staff/payment-plans`, `GET …/simulation/:id`, `POST` (solde confirmé `expected`, sinon 409), `PUT …/requests/:id` (Responsable seul, `version`, `app.decide_plan()`, notification à qui l'a proposé). Au-delà du seuil (Paramètres) : Responsable puis créancier, sauf dossier du Directeur (créancier) ; puis le débiteur accepte (lot O). Échéances le 15 de chaque mois à partir du mois suivant (`planDates`), payées dans l'ordre par les paiements reçus depuis la demande ; une échéance manquée : en retard, deux : en défaut. La relance d'un échéancier (`POST …/:id/reminder`) attend le lot Q.
- **Essai** : ajouter `payment-plans,interest-rates` à `VITE_API` (les paiements passent déjà avec `cases`).

### Documents (lot N, première partie)
- **Stockage** (`src/platform/storage`) : fichiers sur le disque du serveur, sous une clé tirée au hasard (jamais le nom d'origine), dans `DOCUMENTS_DIR` (obligatoire en production : un volume ; en développement `~/.local/share/legarec-dev/documents`, en test un dossier temporaire). Le bucket Scaleway viendra au lot X, derrière la même classe.
- **Dépôt** : `POST /staff/documents/import`, corps = le fichier seul, 15 Mo au plus, type réel lu dans les premiers octets et égal au type annoncé (PDF, DOCX sans macro, PNG, JPEG ; 415 sinon) ; PDF refusé s'il porte du code (`/JavaScript`, `/JS`, `/Launch`, fichier joint, noms masqués `#xx`). Le nom du fichier ne quitte jamais le navigateur : le document s'appelle « Document importé le JJ/MM/AAAA ». Rattaché au dossier dont un numéro de facture figure dans le texte du fichier, parmi ceux sur lesquels on agit ; sinon « à classer », visible de son auteur et du Responsable.
- **Antivirus** : tâche `scan-document` (file `documents`), clamd par `INSTREAM` (`CLAMAV_URL`, conteneur du lot X) ; en développement et en test, un antivirus simulé qui reconnaît le fichier EICAR ; en production sans `CLAMAV_URL`, les fichiers attendent sans être lus. Infecté : le fichier est effacé, la ligne reste. Rien ne se lit ni ne se partage avant « propre ».
- **Lecture** : `GET /staff/documents`, `GET /staff/documents/:id/file` (nom neutre `document.pdf`), `POST /staff/documents/:id/share` (dossier sur lequel on agit, propre, sans code d'accès : contrainte en base). Le créancier et le débiteur ne lisent que ce qui leur est partagé ou montré.

### Modèles (lot N, deuxième partie)
- **Catalogue** : `packages/contracts/src/templateCatalogue.ts` porte les textes validés de la maquette ; c'est la version 1 de chaque modèle, servie tant qu'aucune autre n'est publiée. La simulation lit le même catalogue.
- **Versions** (`template_versions`) : un fichier importé est contrôlé par l'API (`checkTemplate` : champs inconnus, bloc imposé, script, ressource externe ; 413 au-delà de 500 Ko), puis soumis (avertissements lus), puis publié ou refusé par le Directeur ou le Responsable délégué ; la version précédente est archivée et reçoit un numéro. Une version en attente et une en service au plus par modèle. Chaque étape passe par une fonction `app.*_template`, qui revérifie le rôle ; l'équipe n'écrit rien directement. Restaurer une version reprend son texte comme un nouvel import, validé comme les autres. « Annuler » un import se rattrape dans l'heure.
- **Essai d'un modèle** (`POST /templates/:id/test`) : avec les envois (lot Q) ; d'ici là, simulé.

### PDF (lot N, troisième partie)
- `src/platform/pdf` : Chromium (Playwright) sans JavaScript, hors ligne, toute ressource refusée ; une valeur du cabinet encore entre crochets (`[SIREN]`…) dans le texte : rien n'est écrit (`FIRM_INCOMPLETE`), la tâche attend que le Directeur la saisisse. Le conteneur du worker doit porter Chromium (lot X).
- Quittance : émise par `app.issue_receipt()`, qui met en file `receipt-pdf` ; le worker écrit le PDF (`templates/pdf/receipt.hbs`, hors maquette, question 153), le range en document du dossier (source `GENERATED`, propre) et le rattache une fois à la quittance.

### Espace débiteur (lot O, première partie)
- **Connexion** (`modules/auth/debtor-sign-in.ts`) : SIREN pour une entreprise ou un entrepreneur, référence du dossier pour un particulier seulement ; un dossier annoncé (premier courrier) et ouvert. Une seule fonction, `app.debtor_sign_in`, fait tout : elle prend le compteur de l'identifiant sous verrou, compare l'empreinte à clé du code tapé à celle du code en vigueur (`debtor_access_codes.code_hmac`, écrite par l'équipe ; le code n'est jamais ouvert à la connexion), ouvre la session (12 heures fixées en SQL) ; même travail pour un identifiant inconnu. 5 échecs, 15 minutes ; 10, blocage jusqu'à la régénération du code, dit au gestionnaire (au Responsable sans gestionnaire) et dans l'historique de chaque dossier ; moins de 5 échecs s'oublient après un jour, jamais davantage. Le compteur est rattaché au débiteur que l'identifiant désigne, annoncé ou non : un nouveau code lève tout blocage. Connexions et blocages au journal d'audit, sans identifiant ni code. Sessions purgées 48 heures après leur fin. 20 essais par heure et par réseau (Valkey). Cookie `__Host-debtor` ; session de 12 heures, fermée après 30 minutes sans requête ; « Se souvenir de moi » garde le cookie 30 jours.
- **Régénérer le code** ferme les sessions du débiteur et lève le blocage de tous ses identifiants (`app.forget_debtor_access`).
- **Lecture** : `GET /debtor/session`, `GET /debtor/cases/:id`, avec les droits du débiteur : ses dossiers annoncés, le solde calculé comme pour l'équipe (le débiteur lit le mode d'intérêt du mandat, jamais ses honoraires), le compte et les chèques du cabinet. Le nom du gestionnaire n'est pas montré (« Le service recouvrement de Legarec »).
- **Reste (deuxième partie)** : messages et pièces, demandes guidées, accès limité, lien des courriers, code par SMS (avec R), acceptation de l'échéancier, alerte au-delà de 200 échecs par heure.

### Portail des créanciers (lot P, première partie)
- `GET /partner/portal/dashboard`, `GET /partner/portal/cases`, `GET /partner/portal/cases/:id` : ses dossiers seulement (politiques `partner_read`), l'historique marqué pour lui seulement ; montants confiés et recouvrés, délai moyen, six derniers mois.
- `POST /partner/portal/plans/:id/decision` : accord ou refus motivé d'un échéancier long, après le Responsable (`app.creditor_decide_plan`) ; l'échéancier passe au débiteur ou est refusé ; dit à qui l'a proposé, écrit dans l'historique que le créancier lit.

### Règles de code
Une requête = une transaction `Database.run(actor, fn)`, ouverte par la plateforme ; seul `modules/auth` en ouvre au nom d'un compte (ESLint) ; ESLint interdit Prisma ailleurs. Aucun appel externe dans une transaction : `outbox`, puis BullMQ. Une tâche de Valkey ne porte que son numéro : son nom, son auteur et ses identifiants sont relus dans `outbox`. SQL brut limité à : séquences, verrous consultatifs, recherche trigramme, agrégats ; `SET ROLE` et `set_config` dans `src/platform` seulement ; imports dynamiques de Prisma, `pg`, BullMQ ou ioredis interdits ailleurs (ESLint).

Journaux : une ligne par requête (route modèle, statut, durée, acteur par son type), champs d'une liste fermée, message constant (ESLint) ; ni adresse, ni corps, ni message d'erreur de la base ou d'un prestataire.

## Schéma PostgreSQL / Prisma (99 tables)

Chaque lot ajoute ses tables par une migration ; le lot J pose les 13 du socle. `test/schema.test.ts` applique les mêmes règles à toutes : RLS forcée, clé composite, aucun droit par défaut, fonctions à `search_path` fixe, accord entre Prisma et la base.

### Conventions
Clés UUID v7 ; `created_at` partout ; dates `timestamptz` ou `date` ; montants en centimes `integer` (`*_cents`, contrôle de plafond), taux en points de base. **Cloisonnement** : toute table liée à un dossier porte `case_id` et `creditor_id`, avec clé étrangère composite vers `cases(id, creditor_id)`, sans cascade (`NO ACTION`), et `CHECK (case_id IS NULL OR creditor_id IS NOT NULL)` : un `creditor_id` faux est impossible. Une référence entre deux tables d'un dossier porte aussi `case_id`, pour ne jamais relier deux dossiers. `reference`, `creditor_id`, `debtor_id` et `officer_id` d'un dossier ne se modifient jamais directement. `[c+cr]` ci-dessous désigne ce couple. Énumérations = celles des contrats, complétées (`NEW`, `LOST`, `CREDIT_NOTE`, `QUEUED`, `UNCERTAIN`).

### Rôles PostgreSQL et sécurité par ligne
Connexions : `legarec_owner` (migrations), `legarec_app` (API HTTP), `legarec_jobs` (worker), toutes `NOINHERIT` et sans `BYPASSRLS`. Chaque transaction passe par `SET LOCAL ROLE` vers un rôle sans connexion : `legarec_auth`, `legarec_staff`, `legarec_partner`, `legarec_debtor`, `legarec_hook`, `legarec_public`, `legarec_service` pour l'API ; `legarec_worker` et `legarec_retention` pour le worker, plus `legarec_staff`, `legarec_partner` et `legarec_debtor` pour les tâches nées d'un utilisateur. Oubli = « permission denied », testé. Durées limitées par connexion (requête, attente d'un verrou, transaction inactive). La base appartient à `legarec_owner` (`bootstrap.sql`, à exécuter dans cette base) : sinon la migration s'arrête, car elle ne pourrait pas retirer les droits de PUBLIC. Variables `app.user_id`, `app.creditor_id`, `app.debtor_id`, `app.acting_for` : le rôle et les délégations sont relus dans les tables, jamais crus sur parole. RLS activée **et forcée** sur toutes les tables ; droits par colonne pour tous les rôles ; aucun droit par défaut.

Fonctions `app.*` : `SECURITY DEFINER`, `search_path` fixe, propriétaire `legarec_definer` (sans connexion, droits limités aux colonnes utiles) : `staff_role`, `can_read_case`, `can_act_on_case`, `assign_cases` (dossiers lisibles par l'acteur, destinataire actif), `note_consultation`, `contacts_left` (un nombre, sans montrer les contacts des autres), `log`, `add_case_event`, `enqueue`, `next_number`, `purge_audit`, `anonymize_case`. Comptes : `account_of`, `account_of_link`, `resume_session`, `take_attempt`, `clear_attempts`, `tell_reset` (connexion) ; `invite_member`, `cancel_invitation`, `disable_member`, `enable_member`, `set_member_role`, `set_extension`, `support`, `set_delegation`, `open_ticket`, `account_states`, `locked` (équipe) ; `create_director` (serveur) ; `purge_sign_ins`, `anonymize_accounts`. `app.refuse()` : `LG404` → 404, `LG409` → 409 `CHANGED`. La connexion nomme son compte (`app.subject`) et ne voit que lui ; une fois la preuve donnée (`app.proved`), elle signe en son nom.

Type d'acteur : lu dans le rôle PostgreSQL de la transaction, jamais dans une variable ; un compte désactivé ou un portail fermé devient « personne ». Une délégation retirée, ou donnée par un Directeur remplacé, arrête l'action.

Tâche née d'un utilisateur : `outbox.actor_kind`, `actor_id` et `acting_for`, remplis par PostgreSQL ; sans auteur reconnu, elle est refusée. Le worker l'exécute avec le rôle de cet auteur, droits relus à l'exécution, et seulement si la tâche déclare qu'elle peut venir de lui (`from`). `legarec_worker` sert aux tâches planifiées et à ce que l'application fait une fois le droit d'agir de l'auteur vérifié (`authorize(contrôle)`, par exemple `mayActOn(dossier)` : voir un dossier ne suffit pas), contrôle fait une fois, avant tout envoi, pour que ce qui est parti puisse toujours être enregistré. Un webhook, la page de connexion ou l'application n'ont pas d'auteur : `asAuthor` est refusé.

**Une seule exécution** : avant d'agir, le worker réserve la tâche en base (`started_at`), pas seulement dans Valkey. Une tâche non répétable (`repeatable: false`, obligatoire pour les files `letter`, `sms` et `staff-email`) n'a qu'un essai : interrompue, elle devient `UNCERTAIN` et une personne décide. Un module le précise par `TryLater` (rien n'est parti, réessai aussi longtemps qu'il le faut) ou `GiveUp` (inutile de réessayer). Une panne de la base ne fait jamais abandonner une tâche ; une tâche inconnue du worker revient en base ; une tâche que Valkey a perdue, ou dont rien n'est parti, est republiée au bout d'une heure. Valkey ne garde rien d'une tâche terminée. Le worker attend Valkey avant de lire ses files, et s'arrête (code 1, relancé par son conteneur) si une file n'est plus lue. `legarec_hook` insère dans `webhook_events`, ajoute une tâche et note au journal, rien d'autre.

| Classe | Lecture | Écriture |
|---|---|---|
| CASE | collaborateur : `app.can_read_case(officer_id)` (Directeur tout ; Responsable : siens, gestionnaires, sans gestionnaire ; gestionnaire : siens ; Développeur : rien) ; tables filles : celles des dossiers visibles ; créancier et débiteur : liste blanche ci-dessous | collaborateur : `app.can_act_on_case` ; créancier et débiteur : insertions limitées. Attribution par `app.assign_cases()` (Directeur ou délégation administrative) |
| CRED | collaborateurs sauf Développeur (gestionnaire : créanciers de ses dossiers) ; créancier : le sien. Fiche, contacts et mandats seulement | Directeur, Responsable |
| THREAD | messages et lignes d'import : CASE si `case_id` ; sinon créancier concerné, Directeur, Responsable et gestionnaire du compte (`manager_id`) ; imports : jamais le gestionnaire | auteur ; dépôt, message et décision par le créancier |
| ADMIN | Directeur, ou Responsable avec délégation administrative | idem |
| TECH | Directeur, Développeur | Directeur, ou Développeur avec délégation technique |
| ACCOUNT | collaborateurs : nom, rôle, poste, adresse de leurs collègues ; comptes créanciers avec leur créancier ; personne ne lit un `*_hash` | `role`, `status`, `creditor_id`, `email`, `password_hash`, `two_factor_required` : fonctions dédiées, jamais sa propre ligne, jamais celle du Directeur par un délégué. Sessions, appareils, seconds facteurs, codes de secours : `legarec_auth` seul |
| SELF | titulaire de la ligne | titulaire : préférences et notifications seulement |
| DELEGATION | collaborateurs | Directeur seul : un délégué ne peut ni se redonner ni ouvrir une délégation |
| FIRM | collaborateurs | Directeur, ou Responsable avec la délégation administrative ; clés techniques : TECH ; SIREN, TVA, IBAN, BIC, titulaire, banque, ordre et adresse des chèques : Directeur seul (question 116) |
| SYS | worker, authentification, webhooks : chacun ses colonnes | idem |
| AUDIT | Directeur, Développeur | `app.log()` seulement : acteur et « pour le compte de » lus dans la session, jamais passés en paramètre |

**Liste blanche des rôles externes** (toute autre table : « permission denied », testé) :
- `partner` : `cases` (sans risque, prochaine action ni gestionnaire), `case_invoices`, `payments` (date, montant, moyen), `payment_plans`, `installments`, `plan_approvals` (étape CREDITOR), `case_events` marqués visibles, documents partagés, sans code et sains, ses messages, ses imports, ses reversements validés.
- `debtor` : `cases` dont `first_letter_on` est rempli, `case_invoices`, `payments`, `receipts`, `payment_plans`, `installments`, `exchanges` de son espace, documents visibles et sains. Pas l'historique.

**Lignes sans dossier** : jamais « `case_id` nul = lisible ». Factures : ADMIN ; mandats : CRED ; messages et numéros non rattachés : Responsable seul.

### Tables

**Comptes et accès** (`auth`, `account`, `members`, `delegations`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `users` | role, status, first_name, last_name, email, creditor_id?, extension?, password_hash?, password_changed_at?, two_factor_required, theme, density, low_vision, daily_summary, quiet_hours, substitute_id?, absent_from?, absent_until?, auto_reply, daily_call_goal?, last_seen_at?, invited_by?, invited_at?, disabled_at?, disabled_by?, disabled_reason?, anonymized_at? | UQ email ; **UQ partiel** `role` (Directeur, Responsable, Développeur, non désactivé) ; CHECK creditor_id ⇔ rôle créancier | ACCOUNT |
| `user_sessions` | user_id, portal, token_hash, device_label, mobile, ip, second_factor_needed, second_factor_at?, proved_at, last_seen_at, persistent, expires_at, revoked_at? | UQ token_hash ; fermées à la désactivation, au changement de rôle ou de mot de passe | ACCOUNT |
| `user_devices` | user_id, token_hash, label, last_seen_at, expires_at | UQ token_hash | ACCOUNT |
| `second_factors` | user_id, kind, secret_cipher?, last_step?, credential_id?, public_key?, sign_count?, transports?, confirmed_at?, last_used_at? | UQ credential_id ; une application confirmée et une en cours | ACCOUNT |
| `backup_codes` | user_id, code_hash, used_at? | — | ACCOUNT |
| `auth_tokens` | purpose (invitation, réinitialisation, clé de sécurité), user_id, session_id?, token_hash, expires_at, opened_at?, used_at? | UQ token_hash ; usage unique | SYS |
| `lockouts` | key_hash (HMAC : adresse ou compte, connus ou non ; débiteur au lot O), scope, failures, locked_until?, last_failure_at (`blocked_at?` au lot O) | PK key_hash | SYS |
| `delegations` | kind, granted_by, granted_at, withdrawn_by?, withdrawn_at? | **UQ partiel** kind ouvert | DELEGATION |
| `notification_preferences` | user_id, kind, in_app, email | PK double | SELF |
| `service_accounts` | name, scopes[], key_hash, created_by, last_used_at?, revoked_at? | UQ key_hash | TECH |
| `support_tickets` | number, user_id, subject, message, status | UQ number | auteur ; TECH |

**Cabinet** (`settings`, `vault`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `settings` | key, value (jsonb validé par Zod), updated_by, on_behalf_of_id?, version | PK key | FIRM |
| `setting_versions` | key, previous_cipher, changed_by, on_behalf_of_id?, changed_at | index (key, changed_at) ; ajout seul | Directeur |
| `vault_secrets` | name, kind (SERVICE, INTERNAL), service, environment, value_cipher, key_id, status, rotation, rotated_on, expires_on?, requested_by?, decided_by?, last_used_at? | UQ partiel (name, environment) hors `REVOKED` : un secret révoqué se remplace, jamais ne se réactive ; aucune lecture de `value_cipher` par `staff` | TECH |
| `integration_states` | provider, status, last_success_at?, last_error_code? | PK provider | TECH |
| `interest_rates` | kind, valid_from, valid_until?, rate_bp, entered_by | EXCLUDE chevauchement | FIRM |
| `number_sequences` | kind, year, last_value | PK (kind, year) | SYS |
| `scenarios`, `scenario_steps` | code, name, audience, active ; position, offset_days, channel, template_id?, label, enabled, needs_creditor_consent | UQ (scenario_id, position) | FIRM |

**Créanciers** (`creditors`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `creditors` | name, legal_name, siren, vat_number, sector, initials, adresse, status, manager_id?, portal_enabled | UQ siren | CRED |
| `creditor_contacts` | creditor_id, name, title, email, phone, is_main | UQ partiel principal | CRED |
| `creditor_bank_accounts` | creditor_id, holder, iban_cipher, iban_last4, bic, valid_from, valid_until? | — | ADMIN |
| `mandates` | creditor_id, contract_document_id?, starts_on, ends_on?, status, amicable_rate_bp, litigation_rate_bp, opening_fee_cents, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, contract_rate_bp?, fixed_indemnity, reporting_day, scenario_id? | EXCLUDE chevauchement actif | CRED |
| `creditor_threads`, `creditor_messages` | creditor_id, case_id?, subject, reference_label, last_message_at ; author_side, author_id, text, read_at? | index (creditor_id, last_message_at) | THREAD |

**Débiteurs** (`debtors`, `debtor-access`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `debtors` | kind (COMPANY, SOLE_TRADER, INDIVIDUAL), legal_form_code?, legal_form_source?, legal_form_checked_at?, name, siren?, anonymized_at? | UQ partiel siren ; particulier sans SIREN | par ses dossiers |
| `debtor_access_codes` | debtor_id, code_cipher (numéro de clé en tête), version, generated_by?, generated_at | UQ debtor_id ; aucun droit `partner` | CASE (agir) |
| `debtor_retired_codes` | debtor_id, code_hmac, retired_at | index debtor_id | SYS |
| `debtor_sessions`, `debtor_devices` | debtor_id, token_hash, label, ip, last_seen_at, expires_at, revoked_at? | UQ token_hash | débiteur |
| `debtor_links` | debtor_id, [c+cr], token_hash, channel, expires_at, revoked_at?, uses | UQ token_hash (60 bits) | SYS |
| `phone_opt_outs` | phone_e164, stopped_at, exchange_id?, lifted_at?, lifted_by? | PK phone | CASE |
| `case_contacts` | [c+cr], kind, label, value, value_normalized, status, is_primary, note, source, replaced_by_id?, created_by, invalidated_at? | UQ partiel principal par type ; UQ partiel valeur valide ; index value_normalized | CASE |
| `case_contact_events` | [c+cr], contact_id, actor_id?, actor_label, what | ajout seul | CASE |
| `contact_attempts` | debtor_id, [c+cr], channel, origin, counted, exempt_reason?, overridden_by?, override_reason?, reminder_id?, exchange_id?, occurred_at | index partiel (debtor_id, channel, occurred_at) si compté | CASE |

**Dossiers** (`cases`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `cases` | reference, creditor_id, debtor_id, mandate_id, officer_id?, status, external_reference, adresse et interlocuteur du débiteur, scenario_id?, scenario_position, reminders_suspended_until?, suspension_reason?, first_letter_reference?, first_letter_on?, next_action, next_action_on?, risk_label?, risk_reason?, opened_on, closed_on?, close_reason?, purge_after?, anonymized_at?, version | UQ reference, CHECK `^LGR-\d{4}-\d{5}$` ; UQ (id, creditor_id) ; **UQ partiel** un dossier ouvert par créancier et débiteur ; index (officer_id, status), (creditor_id, status), next_action_on | CASE |
| `case_invoices` | [c+cr], number, external_ref, issued_on, due_on, claimed_cents, principal_cents, principal_paid_cents, interest_paid_cents, indemnity_cents, indemnity_paid_cents, state, document_id?, import_line_id? | UQ (case_id, number) ; CHECK payé ≤ dû | CASE |
| `interest_snapshots` | [c+cr], as_of, amount_cents, detail, reason | index (case_id, as_of) | CASE |
| `promises`, `promise_invoices` | [c+cr], amount_cents, due_on, method, state, call_id?, checked_at? | index (state, due_on) | CASE |
| `disputes`, `dispute_invoices` | [c+cr], reason, source, reminders_suspended, creditor_asked_at?, resolved_at?, resolution? | — | CASE |
| `waivers` | [c+cr], principal_cents, interest_cents, indemnity_cents, reason, status, requested_by, decided_by?, decided_at? | — | CASE |
| `case_events` (historique) | [c+cr], kind, title, detail, tone, actor_id?, actor_label, on_behalf_of_id?, visible_to_creditor, occurred_at | **ajout seul** ; index (case_id, occurred_at) | CASE |
| `conversations` | kind (EMAIL, SMS, DEBTOR_PORTAL), case_id?, creditor_id?, debtor_id?, mailbox_id?, phone_e164?, subject, category, recategorized, unread, archived_at?, last_message_at | sans dossier : Responsable seul | CASE |
| `exchanges` | conversation_id?, case_id?, creditor_id?, debtor_id?, channel, direction, title, text (code retiré), delivery, verified, author_id?, acknowledgment_document_id?, occurred_at | index (case_id, occurred_at desc) | CASE |
| `exchange_attachments` | exchange_id, document_id, [c+cr] | — | CASE |

**Paiements** (`payments`, `payment-plans`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `payments` | [c+cr], debtor_id, method (CHEQUE, TRANSFER), amount_cents, status, received_on, deposited_on?, settled_at?, bounced_at?, bounce_reason?, cheque_number?, bank?, label?, recorded_by, on_behalf_of_id?, version | CHECK champs selon le moyen ; UQ partiel chèque (dossier, numéro, banque) | CASE |
| `payment_allocations` | [c+cr], payment_id, invoice_id?, component (INTEREST, PRINCIPAL, FEES, OVERPAYMENT), amount_cents, reversed_at? | somme = paiement (contrainte différée) | CASE |
| `receipts` | [c+cr], number, payment_id, document_id, issued_at | UQ number, UQ payment_id | CASE |
| `payment_plans` | [c+cr], debtor_id, total_cents, months, method, first_due_on, status, origin, requested_by?, reason, threshold_months, owned_by_director, accepted_at?, accepted_ip?, document_id?, document_sha256? | UQ partiel un plan en cours par dossier | CASE |
| `plan_approvals` | [c+cr], plan_id, step (COLLECTION_MANAGER, CREDITOR, DEBTOR), decision, decided_by?, reason?, on_behalf_of_id?, decided_at? | UQ (plan_id, step) | CASE |
| `installments`, `installment_payments` | [c+cr], plan_id, number, due_on, amount_cents, paid_cents, state ; payment_id, amount_cents | UQ (plan_id, number) ; index (state, due_on) | CASE |

**Relances, courriers, documents** (`reminders`, `documents`, `templates`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `reminders` | [c+cr], debtor_id, type, origin, scenario_step_id?, planned_on, planned_time?, title, status, limit_reason?, exchange_id?, batch_id?, created_by?, done_by?, done_at? | index (status, planned_on) ; tâche `reminder-<id>` | CASE |
| `send_batches` | kind, template_id, filters, expected_count, actual_count, created_by, on_behalf_of_id?, confirmed_at, status | chaque dossier vérifié par `can_act_on_case`, à l'exécution aussi | auteur ; Responsable |
| `letters` | exchange_id, [c+cr], number, template_version_id, registered, document_id, provider_id?, provider_env, status, postage_cents?, sent_at?, acknowledged_at?, snapshot (sans code) | UQ number `LR-AAAA-NNNN` ; jamais relancé si `UNCERTAIN` | CASE |
| `documents` | case_id?, creditor_id?, category, kind, title, original_name, storage_key, size_bytes, sha256, content_type, status, source, author_id?, shared_with_creditor_at?, visible_to_debtor, contains_access_code, redacted_document_id?, scan_status, retention_class, purged_at? | UQ storage_key ; partagé seulement sans code | CASE |
| `uploads` | owner_kind, owner_id?, claim_token_hash?, document_id, expires_at, claimed_at? | index expires_at ; dépôt anonyme repris par son jeton | SELF |
| `templates`, `template_versions` | name, kind, category, registered, is_reminder, block ; number, source, sha256, status, checks, imported_by, submitted_by?, reviewed_by?, on_behalf_of_id?, review_reason?, published_at? | UQ partiel une version publiée, une en attente | FIRM |

**Messagerie, SMS, téléphonie** (`mailboxes`, `emails`, `sms`, `calls`)
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `mailboxes` | address, kind, holder_id?, size_mb, used_mb, connection, password_cipher?, key_id?, protected, imap_uidvalidity?, imap_last_uid?, last_synced_at?, last_error? | UQ address ; CHECK recouvrement@ sans `password_cipher` (le sien est dans le coffre, question 93) | TECH |
| `mailbox_redirections`, `mailbox_auto_replies`, `mailbox_requests` | ovh_id, target ; text, until? ; user_id, local, requested_by, status, decided_by? | — | TECH |
| `exchange_emails` | exchange_id, mailbox_id?, message_id, in_reply_to?, imap_uid?, from_address, to_address, template_code?, provider, provider_id?, idempotency_key?, error_code? | UQ (mailbox_id, message_id) | CASE |
| `exchange_sms` | exchange_id, phone_e164, segments, automatic_label?, provider_id?, error_code? | index phone | CASE |
| `exchange_portal` | exchange_id, request_kind?, request_data?, sender_name?, sender_email?, claimed_reference?, read_by_staff_at?, read_by_debtor_at? | — | CASE |
| `email_drafts` | author_id, to, subject, text, case_id? | — | SELF |
| `message_templates` | use, name, subject, text | — | FIRM |
| `calls` | exchange_id, [c+cr], officer_id, direction, phone_e164, tcx_call_id?, started_at, answered_at?, ended_at?, queue?, recording_announced, outcome?, tcx_code?, interlocutor?, notes?, qualified_at? | UQ tcx_call_id | CASE |
| `call_targets` | [c+cr], officer_id, kind, reason, slot_at?, priority, status, reminder_id? | index (officer_id, status) | CASE |
| `call_recordings`, `call_transcripts` | call_id, [c+cr], document_id, expires_on ; segments_cipher, expires_on | index expires_on (6 mois) | CASE |
| `presence_events` | user_id, state, since, until? | index (user_id, since) | Directeur, Responsable |

**Contentieux, facturation, dépôts, pilotage**
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `litigation_files`, `litigation_acts`, `procedure_costs` | [c+cr], stage, procedure, court, partner_id?, consent_status, consent_document_id?, next_deadline? ; title, occurred_on?, state, document_id? ; label, amount_cents, billed_document_id? | UQ case_id | CASE |
| `litigation_partners` | name, kind, email, phone, active | — | CRED |
| `prospects`, `billing_documents`, `billing_lines` | type (INVOICE, QUOTE, CONTRACT, CREDIT_NOTE), number?, client_creditor_id?, prospect_id?, status, issued_on?, due_on?, net_cents, vat_rate_bp, vat_cents, gross_cents, operation_category, vat_on_debits, terms, document_id?, corrected_id?, issued_by?, on_behalf_of_id?, snapshot ; label, quantity, unit_price_cents | UQ number ; **immuable une fois émis** (déclencheur) | ADMIN |
| `remittance_batches`, `remittances`, `remittance_lines` | period, status, validated_by?, on_behalf_of_id?, paid_on? ; creditor_id, collected_cents, fee_cents, vat_cents, net_cents, invoice_id?, statement_document_id? ; [c+cr], payment_id, kind (COLLECTION, REVERSAL, CARRY_OVER, COST) | UQ payment_id par type ; UQ (batch, creditor) | ADMIN ; créancier : les siens |
| `claim_imports`, `claim_import_lines` | creditor_id, uploaded_by, document_id, status, lines, valid, total_cents, confirmed_at?, expires_at ; line, data, error_message?, case_id? | rien de créé avant confirmation | THREAD |
| `notifications`, `task_marks` | user_id, kind, des faits seulement (action, actor_id, target_id, ticket_id… ; case_id et creditor_id, case_count), read_at? ; user_id, key, done_at | index (user_id, created_at) | SELF |
| `scheduled_reports` | code, active | — | FIRM |

**Plateforme, RGPD, IA**
| Table | Colonnes utiles | Contraintes, index | RLS |
|---|---|---|---|
| `audit_log` | occurred_at, actor_kind, actor_id?, actor_label, on_behalf_of_id?, action, entity_type?, entity_id?, params (identifiants, dates, rôles, noms de clés de la liste `secret_name`, nombres de 3 chiffres au plus ; phrase française du catalogue `AUDIT_ACTIONS`, aucun texte libre), ip, request_id | **ajout seul** : ni UPDATE, ni DELETE, ni TRUNCATE ; `actor_label` d'un débiteur ou d'un créancier : son rôle, jamais un nom ; purge à 1 an par `app.purge_audit()`, durée écrite dans la fonction, décompte gardé | AUDIT |
| `outbox`, `task_keys`, `webhook_events`, `idempotency_keys` | queue, name, payload (identifiants, dates, codes d'une liste fermée), actor_kind, actor_id?, acting_for?, run_at?, claimed_at?, published_at?, started_at?, done_at?, failed_at?, failure? (un code) ; owner (l'équipe, ou son seul auteur externe), name, key, task_id (une tâche au plus par clé) ; provider, provider_event_id, status ; actor, key, route, request_hash, status, result (chiffré, jamais une valeur affichée une fois) | UQ dedupe_key, (provider, event), (actor, key) | SYS |
| `gdpr_requests` | debtor_id, [c+cr], kind, origin, received_on, due_on, status, handled_by?, transmitted_to_creditor_at? | index (status, due_on) | ADMIN |
| `retention_runs` | kind, removed (un nombre), ran_at | ajout par `legarec_retention` seul | AUDIT |
| `ai_suggestions` | function, [c+cr], input_digest, output, model, prompt_version, tokens, cost, status, decided_by?, decided_at? | — | CASE |
| `ai_usage` | month, cost, alerted_at?, paused_at? | — | TECH |

### Points posés en SQL dans les migrations
```sql
CREATE UNIQUE INDEX users_single_role ON users (role)
  WHERE role IN ('DIRECTOR','COLLECTION_MANAGER','DEVELOPER') AND status <> 'DISABLED';
-- LGR-AAAA-NNNNN : compteur annuel, verrouillé dans la transaction qui crée le dossier
INSERT INTO number_sequences (kind, year, last_value) VALUES ('CASE', $1, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_value = number_sequences.last_value + 1 RETURNING last_value;
CREATE POLICY cases_read    ON cases FOR SELECT TO legarec_staff   USING (app.can_read_case(officer_id));
CREATE POLICY cases_act     ON cases FOR UPDATE TO legarec_staff   USING (app.can_act_on_case(officer_id));
CREATE POLICY cases_partner ON cases FOR SELECT TO legarec_partner USING (creditor_id = app.creditor_id());
CREATE POLICY cases_debtor  ON cases FOR SELECT TO legarec_debtor  USING (debtor_id  = app.debtor_id());
```
Extensions : `citext`, `pg_trgm`, `unaccent`, `btree_gist`. Index partiels, EXCLUDE, RLS et déclencheurs sont en SQL (les index partiels de Prisma 7 sont en préversion) ; un test refuse toute dérive entre schéma et base. Factures, avoirs et quittances : numérotation continue dans la même transaction, par `app.next_number()` (année de Paris, refusée au Développeur et aux rôles externes).

**Imputation** : intérêts de tout le dossier, puis principal de la facture la plus ancienne à la plus récente, puis indemnités ; reste en trop-perçu. Chèque impayé : écritures d'annulation, jamais d'effacement.

## Chiffrement et hachage

| Donnée | Méthode |
|---|---|
| Code d'accès | AES-256-GCM, lié au débiteur, `ACCESS_CODE_KEY` (clé interne) ; jamais dans une file, un journal, une URL, un texte stocké |
| Mots de passe OVH | AES-256-GCM, lié à la boîte, `MAILBOX_SECRETS_KEY` (clé interne) |
| Clés des services, clés internes, TOTP, IBAN des créanciers, transcriptions | AES-256-GCM, `VAULT_MASTER_KEY` (fichier du serveur) |
| Mots de passe des comptes, codes de secours | Argon2id |
| Jetons de session et d'invitation (256 bits) | HMAC-SHA-256, clé dérivée de `SESSION_SIGNING_KEY` (fichier du serveur) : une copie de la base seule ne permet pas de les retrouver |
| Liens des courriers et SMS (60 bits), identifiants inconnus, anciens codes | HMAC-SHA-256, clé interne `LOOKUP_KEY` : renouveler `SESSION_SIGNING_KEY` ferme les sessions sans effacer un blocage ni casser un lien déjà envoyé |

Une clé dérivée par usage (HKDF). La version de clé est dans l'en-tête de chaque `*_cipher` ; données liées : table, identifiant, colonne. Une ancienne clé se garde aussi longtemps que les sauvegardes qu'elle ouvre.

**Code d'accès, en clair nulle part** : l'original envoyé qui porte le code est gardé chiffré, lisible par le Directeur seul ; partout ailleurs, la copie sans code (question 118, chiffrement à préciser au lot N) ; `snapshot` sans code ; code retiré des messages entrants et des transcriptions ; avertissement avant de partager une pièce reçue.

**À qui part le code (question 112)** : le code ouvre les dossiers de tous les créanciers du débiteur, alors que l'adresse, l'e-mail et le mobile viennent du dépôt de chacun. Il ne part que vers une coordonnée confirmée pour ce débiteur par un collaborateur, jamais vers une coordonnée venue du seul dépôt d'un créancier ; courrier à une entreprise : adresse d'un établissement connu de l'API Recherche d'entreprises ; sinon, envoi sans code. Test : B dépose contre le débiteur de A avec ses propres coordonnées, aucun canal ne lui livre le code.

**Accès débiteur** : régénérer un code ferme les sessions et les appareils mémorisés ; un blocage en cours n'est jamais purgé ; Valkey absent = accès refusé ; au-delà de 200 échecs par heure au total, alerte puis accès suspendu 15 minutes pour les adresses IP en cause ; SMS du code : 5 par jour et par numéro, 20 par jour et par adresse IP (question 114). Un dépôt sur un SIREN déjà connu reste invisible du débiteur tant que la raison sociale n'est pas confirmée ; le nom enregistré n'est jamais écrasé.

## Conservation (tâche quotidienne, rôle `legarec_retention`)

| Durée | Données |
|---|---|
| 5 ans après clôture | dossiers, historique, échanges, pièces : anonymisés, fichiers S3 supprimés |
| 10 ans | factures du cabinet, quittances, paiements, reversements, registre RGPD |
| 2 ans | notifications, questions au support ; compte désactivé, puis anonymisé ; clés de tâches |
| 1 an | journal d'audit, verrouillages, invitation jamais ouverte (question 131), journal de l'IA, présence 3CX (12 mois) |
| 6 mois | enregistrements, transcriptions, SMS non rattachés, messages non vérifiés |
| 70 jours | sauvegardes (56 jours restaurables, versions comprises) et versions S3 des documents |
| 60 jours | journaux techniques, tâches abandonnées, webhooks |
| 14 jours | tâches faites |
| 48 heures après la fin | sessions et liens des comptes, clés d'idempotence |
| 30 jours | imports non confirmés, fichiers non rattachés |

Exceptions : les quittances restent 10 ans même si le dossier est anonymisé à 5 ans ; un débiteur partagé est anonymisé avec son dernier dossier. « Ajout seul » s'entend hors `legarec_retention`, par `purge_audit()` et `anonymize_case()` : durée écrite dans la fonction, sans paramètre, décompte gardé. La purge se rejoue après toute restauration. En place aux lots J et K : journal d'audit, clés d'idempotence, tâches et leurs clés, webhooks (durées de la question 120), connexions, comptes, notifications et questions au support. Un compte anonymisé garde sa ligne, sans nom ni adresse : l'historique s'y réfère. Chaque étape de la purge est indépendante et laisse son décompte.

## Clés et secrets : noms, emplacement, saisie

**Les valeurs sont saisies par le cabinet seul, hors de Claude Code**, qui n'écrit que des noms : il ne lit, n'affiche et ne copie aucune valeur.

| Quoi | Développement | Production | Qui saisit |
|---|---|---|---|
| Clés des services (Resend, OVH…) | `.env` à la racine de la copie de travail utilisée par Claude Code, clés de test seulement | Paramètres techniques > Secrets, chiffrées en base | Dev : le cabinet, en SSH. Prod : Directeur ou Développeur (délégation technique), dans l'écran |
| Valeurs de démarrage | Tirées au hasard au premier lancement de `infra/dev/services.mjs`, dans `~/.local/share/legarec-dev/` (hors du dépôt, droits 700) : rien à saisir | `/etc/legarec/api.env` (API) et `/etc/legarec/worker.env` (worker), chacun lu par son seul programme, montés comme fichiers (pas de variable visible par `docker inspect`) | Prod : le cabinet, en SSH |
| Clés internes | Générées par l'API | Générées par l'API, rangées dans le coffre | Personne |
| Migrations | Rien à saisir | `/etc/legarec/migration.env`, lu seulement pendant une migration | Prod : le cabinet, en SSH |
| Autres conteneurs | Aucun | Un fichier par conteneur dans `/etc/legarec/` (lot X) | Prod : le cabinet, en SSH |
| SIREN, IBAN, adresse… | Paramètres du cabinet (remplacent `FIRM_*` et `BANK_*`) | Paramètres du cabinet | Directeur |
| Pages (`VITE_API_URL`, `VITE_LOGO_NEGATIVE_URL`, `VITE_API`) | Publiques : jamais un secret | idem | — |
| GitHub Actions | Aucun secret | Aucun secret | — |

**Pourquoi un fichier du serveur (nécessité technique)** : le coffre est dans la base ; il ne peut contenir ni sa propre clé, ni l'accès à la base, et l'API a besoin de ces valeurs avant de pouvoir le lire.

- **Valeurs de démarrage** : `VAULT_MASTER_KEY`, `VALKEY_URL`, `SESSION_SIGNING_KEY` ; un seul compte PostgreSQL par programme : `DATABASE_URL` (API), `JOBS_DATABASE_URL` (worker), `MIGRATION_DATABASE_URL` (migrations). Une adresse incomplète est refusée au démarrage, en production aussi. Réglages non secrets du même fichier : `AI_ENABLED` (absent = IA éteinte), `MYSENDINGBOX_ENV`, `IA_MODELE_RAPIDE`, `IA_MODELE_AVANCE`, `AI_BASE_URL`, `SCW_REGION`, `SCW_DOCUMENTS_BUCKET`, `STAFF_PORTAL_URL`, `PARTNER_PORTAL_URL`, `DEBTOR_PORTAL_URL`. Pendant un renouvellement, l'ancienne clé reste sous le même nom suivi de `_PREVIOUS`.
- **Clés internes** : `MAILBOX_SECRETS_KEY`, `ACCESS_CODE_KEY`, `LOOKUP_KEY` : tirées au hasard par l'API, chiffrées par `VAULT_MASTER_KEY`, renouvelables depuis l'écran (les données sont rechiffrées), jamais révocables. Écart assumé avec `PROMPT-FRONT.md`, qui prévoit une `MAILBOX_SECRETS_KEY` saisie (question 73). Les empreintes des essais de connexion et le chiffrement des applications viennent de clés dérivées de `VAULT_MASTER_KEY`.
- **Autres conteneurs (lot X)** : PostgreSQL `POSTGRES_PASSWORD` ; mots de passe des trois comptes `LEGAREC_OWNER_PASSWORD`, `LEGAREC_APP_PASSWORD`, `LEGAREC_JOBS_PASSWORD` ; Valkey `VALKEY_PASSWORD` ; pgBackRest `PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`, `PGBACKREST_REPO1_S3_REGION`, `PGBACKREST_REPO1_S3_ENDPOINT` (clé en lecture seule pour l'essai de restauration) ; Caddy `ACME_EMAIL`, `AUTHORIZED_IPS`, `SCW_REGION` ; n8n `N8N_ENCRYPTION_KEY` et sa clé de compte de service (créée dans l'application, affichée une fois) ; Grafana `GF_SECURITY_ADMIN_PASSWORD`, `GF_SECURITY_SECRET_KEY` ; Gatus `GATUS_ALERT_KEY`, `GATUS_ALERT_TO`, `GATUS_WORKER_TOKEN`, `GATUS_BACKUP_TOKEN`, `GATUS_RESTORE_TOKEN` (chacun est le `GATUS_PUSH_TOKEN` de son programme, avec `GATUS_PUSH_URL` pour le worker). Fichiers, groupes et droits : `docs/deploiement.md`. `TRUSTED_PROXIES` ne s'écrit jamais vide : il vaudrait 0.

| Service (lot) | Noms des clés | Où la créer, avec quels droits | En développement |
|---|---|---|---|
| Resend (Q) | `RESEND_API_KEY`, `RESEND_ACCOUNT_API_KEY` (second domaine, 84), `RESEND_WEBHOOK_SECRET` | Resend > API Keys : accès « envoi » limité à un domaine ; Webhooks | Clé limitée à un domaine de test ; destinataires `@resend.dev` (comptés dans le quota) |
| MySendingBox (Q) | `MYSENDINGBOX_API_KEY` (`live_`), `MYSENDINGBOX_TEST_API_KEY` (`test_`) | Compte MySendingBox | Clé `test_` seulement : aucun courrier ne part |
| Scaleway (N) | `SCW_ACCESS_KEY`, `SCW_SECRET_KEY` | Clé limitée au bucket `legarec-documents` | Facultatif (bucket de test, `legarec-documents` refusé) ; sinon disque local |
| OVH, boîtes (R) | `OVH_API_APP_KEY`, `OVH_API_APP_SECRET`, `OVH_API_CONSUMER_KEY` | eu.api.ovh.com/createToken, règles `/email/domain/legarec.fr/*` seulement | **Aucune** : pas de mode test trouvé, elle agirait sur les vraies boîtes |
| OVH, SMS (R) | `OVH_SMS_APP_KEY`, `OVH_SMS_APP_SECRET`, `OVH_SMS_CONSUMER_KEY`, `OVH_SMS_SERVICE_NAME` | idem, règles `/sms/<compte>/*` seulement | **Aucune** ; facultatif : compte SMS séparé et un numéro du cabinet |
| recouvrement@ (R) | `COLLECTION_MAILBOX_PASSWORD` | Mot de passe de la boîte, posé chez OVH | **Aucune** : serveur IMAP simulé |
| 3CX (T) | `TCX_API_CLIENT_ID`, `TCX_API_CLIENT_SECRET` | Console 3CX > Integrations > API | **Aucune** : standard simulé |
| IA (W) | `AI_API_KEY`, seulement si un hébergeur est retenu (106) | — | Aucune : modèle local |

Deux clés suffisent donc en développement : Resend (test) et MySendingBox (`test_`). Sans elles, tout marche en simulé.

**Emplacement du `.env` de développement** : la racine de la copie de travail utilisée par Claude Code. Les refus `Read(./.env)` et `Edit(./.env)` de `.claude/settings.json` portent sur le dossier courant : placé à la racine du dépôt principal, il serait dans un dossier parent de la copie de travail, donc sans protection pour la session qui y tourne. Ignoré par Git, il disparaît avec la copie de travail ; si une autre copie prend la suite, le cabinet le déplace. Modèle à copier : `apps/api/env.example` (noms seulement, tenu à jour à chaque lot), car `.env.exemple` est interdit à Claude Code en lecture comme en écriture. Le refus ne couvre ni une recherche récursive (Claude Code n'utilise que `git grep`, qui ne voit que les fichiers suivis) ni une autre session : tant que ce fichier existe (droits 600), une seule session travaille dans cette copie. Vitest et Vite ne le chargent pas (`envDir: false`).

**Garde-fous en développement** : `.env` chargé par le seul lancement de l'API, jamais par les tests, `pnpm verifier`, `pnpm e2e` ni GitHub Actions ; clé `live_` refusée au démarrage ; destinataire refusé avant l'appel s'il n'est ni `@resend.dev` ni dans `DEV_RECIPIENTS` (adresses et numéros du cabinet) ; le journal dit seulement « Resend : configuré » ou « simulé ».

**En production** : valeur reçue une fois, chiffrée, jamais renvoyée par aucune route ; absente des journaux, de l'audit, de Valkey, des clés d'idempotence et des messages d'erreur ; `Confirm`, puis une ligne d'audit avec le nom seul. L'API refuse de démarrer sans valeur de démarrage ; une clé de service absente met sa file en pause, rien n'est perdu. Ordre de mise en service : fichier du serveur, migrations, premier Directeur par commande (lien affiché une fois dans le terminal, aucun e-mail n'étant encore possible), clé Resend, autres clés, invitations. Le cabinet garde une copie de ces fichiers dans son gestionnaire de mots de passe, **jamais avec les sauvegardes de la base** : perdue, tout ce qui est chiffré est illisible ; rangée avec elles, le chiffrement ne protège plus rien.

## Tests

- **Matrice d'accès** (le cœur) : un tableau déclaratif route × acteur (anonyme, Développeur, Directeur, Responsable avec et sans délégation, gestionnaires A et B, créanciers A et B, débiteurs A et B, compte de service) × ressource (sienne, d'un autre, sans gestionnaire, du Directeur) → statut attendu. Un méta-test lit les routes de NestJS : **une route absente du tableau fait échouer `pnpm verifier`**.
- **Fuites** : chaque créancier, gestionnaire et dossier du Directeur porte une marque unique ; aucune réponse, aucun PDF, e-mail, export ni comptage ne doit contenir celle d'un autre. Champ `creditor_id` falsifié dans un corps ou une URL : sans effet.
- **RLS en SQL**, sans l'API : toute table a une politique forcée ; sans acteur, zéro ligne ; `partner` et `debtor` n'ont aucun droit sur codes, coordonnées, appels, IA ; `staff` ne lit jamais une valeur du coffre ; sans `SET ROLE`, tout échoue ; le rôle annoncé par l'API ne compte pas, seule la table compte.
- **Rôles** : Directeur en lecture seule hors de ses dossiers et consultation notée ; Développeur : aucun dossier ; second titulaire d'un rôle unique refusé, y compris en concurrence ; délégation retirée = refus immédiat ; double nom dans l'historique.
- **Accès débiteur** : SIREN ou référence ; référence refusée pour une entreprise ; réponses, statuts, en-têtes et durées identiques pour inconnu et mauvais code ; 5 échecs = 15 minutes, 10 = blocage, régénération = déblocage, anciennes sessions et appareils mémorisés fermés ; SMS au plafond, seuil global ; 20 échecs par heure et par IP (bloc /64 en IPv6) ; 3 SMS par heure ; notification au gestionnaire ; lien inconnu = 404 uniforme.
- **Confirmations** : double clic = un seul effet ; même clé et corps différent = 422 ; état changé = 409 ; envoi groupé refusé si le nombre diffère ; LRAR, SMS et e-mail au statut incertain jamais relancés.
- **Plafonds** : 20 envois simultanés au même débiteur par deux créanciers = le plafond, pas un de plus ; dérogation : motif obligatoire, bon rôle ; dimanches, fériés, changement d'heure.
- **Audit** : chaque action sensible = une ligne (qui, pour le compte de qui, IP) ; UPDATE, DELETE et TRUNCATE impossibles ; ni secret, ni code, ni nom, ni référence.
- **Argent** (avec `fast-check`) : somme des imputations = paiement ; intérêts d'abord ; jamais de 40 € pour un particulier, ni d'intérêts pour lui avant mise en demeure ; chèque impayé rétablit exactement le dû ; numérotation sans trou en concurrence.
- **Fuites techniques** : contenu de Valkey, journaux, URL et noms de fichiers scannés pendant toute la suite (code, jeton, e-mail, téléphone, IBAN, mot de passe) ; IBAN masqué dans le libellé d'un virement, sauf pour le Directeur ; code retiré des messages entrants, même espacé ou cité.
- **Secrets** : aucune route ne renvoie une valeur du coffre, ni dans une erreur de validation ; valeur absente des journaux, de l'audit, de Valkey et des clés d'idempotence ; nom inconnu refusé ; clé interne jamais révocable ; renouvellement rechiffre tout ; `.env` jamais chargé par les tests ; clé `live_` et destinataire hors liste refusés en développement.
- **Documents** : type réel, EICAR bloqué, PDF sans JavaScript ni réseau, texte vérifié, copie du créancier sans code.
- Puis : webhooks signés et rejoués, contrats OpenAPI régénérés sans différence, migrations depuis zéro, Playwright et axe contre l'API, cas IA en mode simulé. `relecteur-securite` et `testeur` sur chaque lot.

## Sources vérifiées le 25/11/2026
[NestJS 12](https://docs.nestjs.com/migration-guide) · [tickets nestjs-zod](https://github.com/BenLorantfy/nestjs-zod/issues) · [Prisma 7](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7) · [index partiels](https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes) · [BullMQ](https://docs.bullmq.io/changelog) · [calendrier Node](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) · [PostgreSQL](https://www.postgresql.org/support/versioning/) · [expéditeurs SMS OVH](https://docs.ovhcloud.com/fr/guides/web-cloud/messaging/sms/sms-senders) · [API SMS OVH](https://docs.ovhcloud.com/fr/guides/web-cloud/messaging/sms/api-sms-cookbook) · [API e-mail OVH](https://eu.api.ovh.com/1.0/email/domain.json) · [3CX Call Control](https://www.3cx.com/docs/call-control-api/) (page de mai 2025, citée par un résultat de recherche) · [suivi Resend](https://resend.com/docs/dashboard/domains/tracking) · [facture électronique](https://entreprendre.service-public.gouv.fr/actualites/A15683) · [API Recherche d'entreprises](https://www.data.gouv.fr/dataservices/api-recherche-dentreprises) · [clés Resend](https://resend.com/docs/dashboard/api-keys/introduction) · [adresses de test Resend](https://resend.com/docs/dashboard/emails/send-test-emails) · [signature des webhooks Resend](https://resend.com/docs/webhooks/verify-webhooks-requests) · [MySendingBox](https://docs.mysendingbox.fr/) (lue en partie) · [clés API OVHcloud](https://docs.ovhcloud.com/en/guides/manage-and-operate/api/first-steps) · [API 3CX](https://www.3cx.com/community/threads/setup-of-call-control-api.131572/post-632334) (message d'un forum) · [fichiers secrets de Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets/) · [refus de lecture de Claude Code](https://code.claude.com/docs/en/permissions)
