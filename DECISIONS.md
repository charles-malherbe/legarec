# Décisions

Décisions prises après la maquette v1.21 (23/11/2026). Elles priment sur la maquette et sur `maquette/HANDOFF.md`. La maquette est figée : toute évolution se fait dans le code et s'inscrit ici (date, décision, raison). Une décision remplacée reste dans le tableau, marquée « remplacée ».

| Date | Décision | Raison |
|---|---|---|
| 23/11/2026 | Mantine 9.8 comme bibliothèque d'interface (pas shadcn/ui, Tailwind abandonné) | Choix du cabinet après comparatif des 5 bibliothèques |
| 23/11/2026 | TanStack Table 9 en direct, affiché avec le `Table` de Mantine | Pas de surcouche, maîtrise du rendu |
| 23/11/2026 | @mantine/charts pour les graphiques (pas Tremor) | Tremor dépend de Tailwind |
| 23/11/2026 | FullCalendar pour l'agenda (sous réserve de la question 5) ; cmdk pour la recherche rapide | Choix du cabinet |
| 23/11/2026 | Prisma, Playwright (PDF), Scaleway S3, MySendingBox (test et production), Docker sur VPS, GitHub ~~sans GitHub Actions~~ (remplacée le 24/11/2026 : GitHub Actions) | Choix du cabinet |
| 23/11/2026 | Modèles de documents en fichiers HTML Handlebars, sans éditeur dans l'application | Choix du cabinet |
| 23/11/2026 | ~~Paiement : carte et SEPA via prestataire + virement avec RIB~~ (remplacée le 24/11/2026) | — |
| 23/11/2026 | Assistant IA (lot 1) : résumé et qualification des appels, tri et brouillons des e-mails, synthèse des dossiers, réglages et journal. L'IA suggère, un collaborateur valide toujours | Gain de temps sur les tâches répétitives sans décision automatisée (voir `docs/ia.md`) |
| 24/11/2026 | Paiement par chèque et par virement bancaire uniquement : plus de carte, de prélèvement SEPA, de prestataire de paiement, de badge « Paiements PCI-DSS » ni de clés de prestataire | Choix du cabinet |
| 24/11/2026 | paiement.legarec.fr est d'abord un espace d'échange entre débiteurs et collaborateurs (messages, pièces), puis de consultation (solde, échéancier, RIB, consignes chèque) | Besoin principal des débiteurs |
| 24/11/2026 | Accès des débiteurs par identifiant et code d'accès de 4 lettres (identifiant et envoi du code : voir les réponses juridiques en fin de tableau) | Sécurité sans compte débiteur |
| 24/11/2026 | SMS à double sens (OVHcloud, expéditeur sous forme de numéro) | Recevoir les réponses des débiteurs |
| 24/11/2026 | Nouveaux domaines n8n.legarec.fr (automatisations) et status.legarec.fr (Gatus) | Automatisations et page d'état |
| 24/11/2026 | Valkey à la place de Redis (VALKEY_URL) | Licence libre, compatible BullMQ |
| 24/11/2026 | IA par API, fournisseur non imposé, derrière une couche fournisseur (Anthropic, compatible OpenAI pour Scaleway et OVH) | Pouvoir changer d'hébergement |
| 24/11/2026 | Rôles : Développeur, Directeur (remplace « Dirigeant »), Responsable du recouvrement, Gestionnaire de créances, Créancier. Directeur, Responsable et Développeur sont uniques | Organisation du cabinet |
| 24/11/2026 | Accès aux dossiers : Directeur = lecture de tous, actions sur les siens, chiffres globaux ; Responsable = ses dossiers, ceux de tous les gestionnaires et les dossiers sans gestionnaire ; Gestionnaire = les siens ; Développeur = aucun dossier. Contrôle par l'API | Organisation du cabinet |
| 24/11/2026 | Délégations du Directeur, actives dès la mise en service, retirables en un clic : technique au Développeur, administratif au Responsable ; bandeau « Pour le compte du Directeur » et double nom dans l'historique | Le Directeur n'a rien à configurer |
| 24/11/2026 | Double authentification obligatoire pour le Développeur seulement, proposée aux autres rôles (Directeur compris) | Remplace « Développeur et Dirigeant » de la maquette |
| 24/11/2026 | Bouton du mode malvoyant dans la Topbar de l'espace | Accessibilité |
| 24/11/2026 | Langue : code, identifiants, routes et modules de l'API, commits en anglais ; tout ce que voient les utilisateurs et la documentation du kit en français (voir le glossaire de `CLAUDE.md`) | Lisibilité du code et cohérence |
| 24/11/2026 | Recouvrement amiable (R124-4 et L111-8 CPCE) et RGPD : règles du prompt v2.5, à faire valider par le juriste | Conformité |
| 24/11/2026 | Une branche et une pull request par lot (un commit par écran) | Remplace « une par écran ou par composant » |
| 24/11/2026 | E-mails automatiques : kit `kits/emails-handlebars` comme seule référence (25 modèles), envoi par Resend depuis « LEGAREC <ne-pas-repondre@mail.legarec.fr> » ; réponses acceptées seulement pour reminder-1 à reminder-3 (replyTo recouvrement@legarec.fr) | Kit fourni par le cabinet |
| 24/11/2026 | recouvrement@legarec.fr en réception seule : personne n'écrit depuis cette boîte ; chaque collaborateur écrit et répond depuis sa boîte professionnelle | Traçabilité des échanges |
| 24/11/2026 | Messages rédigés dans l'espace (`staff-message`) : envoyés par la boîte OVH (MX Plan) du collaborateur, avec sa signature (rôle, numéro 3CX et poste s'il existe, jamais de portable) | Les réponses reviennent dans sa boîte |
| 24/11/2026 | Gestion des boîtes OVH MX Plan (Roundcube) depuis l'espace, par l'API OVHcloud limitée à /email/domain/legarec.fr/* | Éviter l'espace client OVH au quotidien |
| 24/11/2026 | media.legarec.fr : bucket public legarec-media, chemins versionnés (e-mails/v1/, marque/, documents-publics/), jamais de remplacement ; documents des dossiers dans legarec-documents (privé) | Liens des e-mails stables |
| 24/11/2026 | Caddy comme proxy inverse (HTTPS automatique, redirections www et racines) ; legarec.fr ne passe pas par Caddy | Simplicité, certificats automatiques |
| 24/11/2026 | GitHub Actions pour l'intégration continue (pnpm verifier sur chaque PR), sans secret de production ni déploiement | Contrôle automatique des PR |
| 24/11/2026 | Décisions d'architecture (files d'attente, envois, PDF, IMAP, SMS, contrats, S3, sauvegardes, surveillance, Caddy, journaux, n8n, mises à jour, environnement de Claude Code) : `docs/architecture.md` | Annexe du prompt v2.5 |
| 24/11/2026 | SMS : « Non rattachés » pour les numéros inconnus, « STOP » arrête les SMS automatiques, compteur signalant le passage de 160 à 70 caractères | Prompt v2.5 |
| 24/11/2026 | Montants en centimes entiers dans `packages/contracts` et MSW ; principal, intérêts et frais séparés ; un paiement partiel s'impute d'abord sur les intérêts (calcul de l'API) | Prompt v2.5 |
| 24/11/2026 | Paiements reçus enregistrés à la main (chèque : encaissé ou impayé ; virement : rapprochement) ; quittance quand le paiement devient définitif ; un chèque impayé annule le paiement (Confirm) | Prompt v2.5 |
| 24/11/2026 | Dépôt de créances : import CSV ou Excel analysé par l'API seulement, rapport ligne par ligne, rien n'est créé avant Confirm | Prompt v2.5 |
| 24/11/2026 | Contrôles ajoutés à l'import d'un modèle : référence et date du premier courrier (refus), termes imitant un acte de commissaire de justice (alerte), SMS à 70 caractères (alerte) ; champs debiteur.code_acces, dossier.premier_courrier_reference, dossier.premier_courrier_date | Prompt v2.5 |
| 24/11/2026 | Contacts : plafonds par débiteur et par canal, plages horaires réglables dans Paramètres du cabinet > Relances | Pas de harcèlement |
| 24/11/2026 | Directeur : consultations des dossiers qui ne lui sont pas attribués notées dans l'historique | Prompt v2.5 |
| 24/11/2026 | Premier commit du kit sur `main` poussé par l'utilisateur (dépôt vide) ; ensuite, uniquement des PR | Choix de l'utilisateur, 24/11/2026 |
| 24/11/2026 | Enchaînement de tous les lots demandé sans validation préalable de `PLAN.md` | Choix de l'utilisateur, 24/11/2026 |
| 24/11/2026 | Contentieux : « Frais de procédure avancés · refacturables au débiteur » devient « à la charge du créancier sauf décision du juge » | Aucun frais ajouté hors cas prévus par la loi (écart signalé, à valider par le juriste) |
| 24/11/2026 | Échéanciers : modes « Virement » et « Chèque » à la place de prélèvement SEPA et carte | Paiement par chèque et virement uniquement |
| 24/11/2026 | `scripts/comparer-ecran.mjs` lance Chromium sans hinting | Même rendu de texte que les captures de référence |
| 24/11/2026 | Rédiger un courrier : « coût refacturable au débiteur » (LRAR) retiré ; indemnité de 40 € absente pour un particulier ; relance bloquée sans premier courrier ; mentions obligatoires en blocs à valider | Règles du recouvrement amiable (écarts signalés) |
| 24/11/2026 | Contrats : « sous-traitant » remplacé par [STATUT RGPD À VALIDER] | Question 23 ouverte |
| 24/11/2026 | Import de modèles contrôlé par listes blanches : arbre Handlebars pour les champs, grammaire HTML stricte, bloc imposé et rappel du premier courrier hors de toute condition | La relecture sécurité a contourné le contrôle par motifs |
| 24/11/2026 | Code d'accès interdit dans les modèles d'e-mail et de SMS | Il ne figure que dans les courriers et les SMS demandés par le débiteur |
| 24/11/2026 | Gestionnaire : créanciers, notifications et tableau de bord limités à ses dossiers ; reversements masqués | Cloisonnement des lectures |
| 24/11/2026 | Révocation d'un secret : demandée par le Développeur, validée par le Directeur | Rôle Développeur unique |
| 24/11/2026 | Fiche d'appel : envois décochés par défaut, confirmés, sans « Annuler » après un envoi | Un message parti ne s'annule pas |
| 24/11/2026 | Dossier : « Pénalités et indemnités » devient « Principal · intérêts · frais » | Règle des montants séparés |
| 24/11/2026 | E-mails : « Répondre » de la barre du message retiré, la réponse étant toujours affichée sous le message | Éviter deux actions identiques |
| 24/11/2026 | Comptes : « Créanciers suivis » de la maquette non repris ; l'accès d'un gestionnaire vient des dossiers qui lui sont attribués | Deux règles d'accès se contrediraient |
| 24/11/2026 | Un message écrit depuis un dossier ne part qu'à un contact de ce dossier ; le relevé de compte ne se joint que là | Éviter l'envoi de données à un tiers |
| 24/11/2026 | Secret révoqué : jamais réactivé ; demande de révocation tranchée par le Directeur seul | Relecture sécurité |
| 24/11/2026 | Support des comptes : sous délégation technique ; le compte du Directeur hors de portée du Responsable | Relecture sécurité |
| 24/11/2026 | Modèles importés : propriétés CSS en liste blanche, contraste minimal, aucun champ ni bloc dans une balise | Relecture sécurité |
| 24/11/2026 | Envoi groupé : l'API refuse si son comptage diffère de celui confirmé | Relecture maquette |
| 24/11/2026 | Code par SMS : réponse identique qu'un dossier existe ou non, numéro jamais affiché (écart assumé avec le prompt) (question 53) | Ne pas révéler l'existence d'un dossier |
| 24/11/2026 | Plafonds par débiteur : 2 appels, 2 e-mails et 1 SMS par semaine, 2 courriers par mois ; réglables (question 45) | Valeurs du cabinet, à faire valider par le juriste |
| 24/11/2026 | Boîte OVH : aucune suppression depuis l'application, seulement dans l'espace client OVH (écart assumé avec le prompt) (question 28) | Action irréversible |
| 24/11/2026 | Adresse du cabinet : [ADRESSE DU CABINET] en configuration (question 49) | Décision du cabinet |
| 24/11/2026 | SMS : mention « STOP : répondez STOP », sans numéro court (question 24) | L'expéditeur est un numéro qui reçoit les réponses |
| 24/11/2026 | Bouton SSO retiré de la connexion (question 38) | Aucun SSO prévu |
| 24/11/2026 | Fiche débiteur : code d'accès affiché en clair à qui peut agir sur le dossier, sans trace d'affichage (écart assumé avec le prompt) (question 21) | Plus rapide au téléphone |
| 24/11/2026 | IBAN complet d'un débiteur : Directeur seulement (question 46) | Cloisonnement |
| 24/11/2026 | Invitation d'un collaborateur : demande de boîte automatique, confirmée par le Développeur ou le Directeur (question 42) | Enchaînement voulu |
| 24/11/2026 | Score de risque : gardé avec sa raison, aucune décision automatique ; analyse juridique à mener (question 11) | Décision du cabinet |
| 24/11/2026 | Référence de dossier : LGR-AAAA-NNNNN, seul format accepté (question 56) | Décision du cabinet |
| 24/11/2026 | Initiales en double : deuxième lettre du nom ajoutée (cla@legarec.fr) (question 4) | Décision du cabinet |
| 24/11/2026 | Nouvelle boîte OVH : 5 Go par défaut (question 29) | Décision du cabinet |
| 24/11/2026 | Prestataire de paiement par carte et prélèvement SEPA ? → Plus de paiement en ligne : chèque et virement uniquement (`DECISIONS.md`, 24/11/2026) (question 1) | Décision antérieure |
| 24/11/2026 | Rapprochement des virements reçus → Saisie manuelle depuis la fiche débiteur pour l'instant ; import de relevés à concevoir plus tard, hors périmètre de la maquette (question 2) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Chèques acceptés comme moyen de paiement ? → Oui (`DECISIONS.md`, 24/11/2026) (question 3) | Décision antérieure |
| 24/11/2026 | Agenda des relances : FullCalendar ou `@mantine/schedule` ? → FullCalendar (extensions gratuites) (question 5) | Option par défaut retenue par le cabinet |
| 24/11/2026 | `legarec.fr` : rôle et hébergement → Site public du cabinet, hors de cette application et hors de Caddy ; pied de page des portails avec un lien vers legarec.fr (question 20) | Décision antérieure |
| 24/11/2026 | Identifiant des débiteurs particuliers → Référence du dossier à la place du SIRET (question 22) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Agrandissement du mode malvoyant : celui de la maquette suffit-il ? → Oui, complété par le zoom du navigateur jusqu'à 200 % (question 25) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Numéros 13 à 19 : absents du kit v2.5 alors que le prompt annonce « questions 1 à 29 » → Numéros laissés libres (sauf celui-ci) (question 13) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Versions : TypeScript 7 est la dernière, mais typescript-eslint exige < 6.1 → TypeScript 6.0.3 figé (question 30) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Validation des formulaires : Mantine 9 fournit `schemaResolver` (Standard Schema), compatible Zod 4, sans paquet séparé → `schemaResolver` de `@mantine/form`, `{ sync: true }` (question 31) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Dépendances non citées : outils (eslint, prettier, typescript-eslint, testing-library, jsdom, @axe-core/playwright, postcss-preset-mantine), temporal-polyfill (exigé par FullCalendar 7), libphonenumber-js (API) → Retenues, versions exactes figées, rien d'autre (question 32) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Double authentification : @simplewebauthn/browser et QR code → Retenus au lot G seulement, avec `qrcode` (question 33) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Relectures par sous-agents demandées par `/verifier` → Une relecture par lot, avant l'ouverture de la PR (question 34) | Option par défaut retenue par le cabinet |
| 24/11/2026 | « Activer mon compte » sans lien d'invitation → L'activation passe par le lien reçu par e-mail ; texte adapté (question 39) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Tableau de bord du Développeur, absent de la maquette → Accueil technique sans aucune donnée de dossier (question 40) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Connexion SSH à GitHub refusée sur la machine de développement → Dépôt distant passé en HTTPS par le cabinet (question 41) | Décision antérieure |
| 24/11/2026 | Notifications par SMS (Compte) : aucun portable n'est stocké → Colonne SMS retirée ; restent l'application et l'e-mail (question 43) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Photo de profil, langue anglaise et page d'accueil au choix (Compte) → Non repris : initiales, français, tableau de bord (question 44) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Révocation d'un secret : « accord d'un second développeur », rôle unique → Accord du Directeur (question 47) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Numéro STOP : la maquette écrit « 36173 » et [NUMÉRO STOP] → [NUMÉRO STOP] partout (question 48) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Triple accolade dans un modèle importé (texte non protégé) → Refusée, en plus des contrôles demandés (question 50) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Articles d'aide : un seul est rédigé dans la maquette → Les 17 autres affichent « Article en cours de rédaction » (question 51) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Accord du créancier sur un échéancier long : emplacement (absent de la maquette) → Bandeau en tête du tableau de bord du portail partenaires, Accepter ou Refuser avec motif (question 52) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Accès limité : « Référence du dossier » facultative dans le message → Champ facultatif, message reçu avec la mention « non vérifié » (question 55) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Téléchargements PDF (RIB, quittances, relevés) : générés par l'API → Boutons présents mais désactivés tant que l'API n'existe pas (question 58) | Option par défaut retenue par le cabinet |
| 24/11/2026 | Import de créances : corriger une ligne à l'écran → Les lignes en erreur se redéposent dans un nouveau fichier (question 59) | Option par défaut retenue par le cabinet |
| 24/11/2026 | IBAN, BIC, SIREN et n° de TVA : saisis par le Directeur seul dans Paramètres du cabinet, après confirmation ; enregistrés par l'API, jamais dans le dépôt (question 6) | Décision du cabinet |
| 24/11/2026 | Comptes réels : créés à la mise en service (premier compte Directeur par l'API, puis invitations) (question 8) | Décision du cabinet |
| 24/11/2026 | Postes 3CX : saisis dans l'application à la mise en service (question 27) | Décision du cabinet |
| 24/11/2026 | IA : fournisseur hébergé dans l'Union européenne, choisi à la mission API ; désactivée en production tant que le DPA n'est pas signé (question 9) | Décision du cabinet |
| 24/11/2026 | Transcription des appels : service hébergé dans l'Union européenne, choisi à la mission API (question 10) | Décision du cabinet |
| 24/11/2026 | IA : budget de 25 € par mois, alerte à 80 % (question 12) | Décision du cabinet |
| 24/11/2026 | Accès à Docker de l'utilisateur de développement : à retirer par le cabinet ; Claude Code n'utilise aucune commande docker (question 36) | Conforme à l'architecture |
| 24/11/2026 | Logo de connexion : media.legarec.fr/marque/legarec-logo-negatif.svg, à déposer par le cabinet ; le nom en texte tant que le fichier manque (question 37) | Nom du kit média |
| 24/11/2026 | Modèles importés : l'IA signale un texte peut-être masqué, le Directeur décide ; rendu PDF sans JavaScript ni réseau avec vérification du texte, à la mission API (question 60) | « Validation par IA » lue avec la règle : l'IA suggère, un collaborateur valide |
| 24/11/2026 | Code d'accès : envoyé par courrier et dans les trois relances par e-mail ; par téléphone ou SMS sur demande uniquement. Jamais dans une URL, un nom de fichier ni un journal. Remplace « jamais par e-mail » | Réponse du cabinet, conforme au kit |
| 24/11/2026 | Identifiant des débiteurs : SIREN (9 chiffres) pour une entreprise, référence du dossier pour un particulier. Remplace « SIRET seulement » (question 54) | Réponse du cabinet, conforme au kit |
| 24/11/2026 | Relances par e-mail, annonce des 40 € et des intérêts, citation de L111-8 : textes du kit validés sans changement ; la citation est reprise dans les courriers (questions 7 et 26) | Réponse du cabinet |
| 24/11/2026 | Statut RGPD : sous-traitant du créancier pour les dossiers, responsable pour la comptabilité, la sécurité, le personnel et la téléphonie (question 23) | Réponse du cabinet |
| 24/11/2026 | Conservation : dossiers soldés et irrécouvrables 5 ans après clôture, factures 10 ans, enregistrements 6 mois, journal 1 an | Réponse du cabinet |
| 24/11/2026 | Information RGPD des débiteurs : page Confidentialité en ligne seulement, rien dans les courriers ni les relances | Réponse du cabinet |
| 24/11/2026 | Pages légales rédigées par Claude Code, à relire par le cabinet ; valeurs inconnues entre crochets (questions 7 et 57) | Réponse du cabinet |
| 24/11/2026 | Factures : mentions standard, taux de pénalités [TAUX DES PÉNALITÉS], [CAPITAL ET RCS] | Réponse du cabinet |
| 24/11/2026 | Score de risque : entreprises seulement, règles simples, raison et mention « indicatif, aucune décision automatique » (complète la question 11) | Réponse du cabinet |
| 24/11/2026 | Assistant IA : désactivé en production jusqu'au contrat de sous-traitance et à l'hébergement dans l'UE ; information dans la page Confidentialité | Réponse du cabinet |
| 24/11/2026 | Suivi d'activité : mention L1222-4 complétée, chiffres individuels réservés au Directeur et au Responsable, pas de classement | Réponse du cabinet |
| 24/11/2026 | Plages, plafonds, message vocal, imputation des paiements, frais de LRAR : validés | Réponse du cabinet |
| 24/11/2026 | Kit d'e-mails : IBAN, BIC, SIREN et titulaire masqués par Claude Code à la demande du cabinet (`config.example.json`, `README.md`) ; les anciennes valeurs restent dans l'historique Git (remplace la question 35) | Demande du cabinet |
| 24/11/2026 | Dépôt des logos sur media.legarec.fr et saisie des valeurs entre crochets : reportés à la mission API | Demande du cabinet |
| 24/11/2026 | Article L111-8 : citation du kit conservée partout, après comparaison avec le code (édition du 06/11/2026), dont elle diffère aux alinéas 2 et 3 | Choix du cabinet, confirmé en connaissance de l'écart |
