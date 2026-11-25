# Plan de développement du front-end Legarec

Établi le 24/11/2026 à partir du kit v2.5. L'utilisateur a demandé d'enchaîner les lots sans attendre la validation de ce plan. Cocher chaque ligne quand elle est terminée selon `PROMPT-FRONT.md` (étape 2). La mission API est planifiée en fin de fichier.

## Conventions
- Branches `lot/<lettre>` empilées ; un commit par écran, une PR par lot. `main` est poussée une seule fois par l'utilisateur (kit).
- Écran = route + `features/<domaine>` + schéma `packages/contracts` + handler MSW + tests Vitest + parcours Playwright + axe.
- États communs à tous les écrans de liste : chargement (squelette), vide, aucun résultat, erreur avec « Réessayer », rôle sans accès, délégation, sombre, malvoyant. Ils ne sont pas répétés ci-dessous.
- Composants : tous par `packages/ui`. `SuggestionIA` n'a pas de fichier de maquette : il est tiré de Telephonie, Messagerie et Dossier.
- Versions figées : React 19.3.1, Vite 8.3.8, Mantine 9.8.2, TanStack Table 9.3.1, TanStack Query 5.108.4, React Router 8.5.2, FullCalendar 7.1.5, MSW 3.0.7, Zod 4.6.7, Vitest 5.1.1, Playwright 1.65.1, TypeScript 6.0.3 (questions 30 et 32).

## Lot 0 — Décisions
- [x] Annexe « Architecture » consignée (`docs/architecture.md`), décisions et questions manquantes ajoutées

## Lot A0 — Initialisation
- [x] Monorepo pnpm + Turborepo, TypeScript strict, ESLint, Prettier, `pnpm verifier`, GitHub Actions
- [x] `packages/tokens` : tokens.css, thèmes espace et public, polices locales
- [x] `packages/contracts` : schémas Zod, centimes, rôles, codes 3CX
- [x] `packages/platform` : téléphone, notifications, fichiers, liens
- [x] `packages/ui` : Icone, Bouton, Badge, Statut, Avatar, Champ, Interrupteur, Case, Reglage, Onglets, Carte, Tuile, Alerte, Progression, Indicateur, EtatListe, Pagination, Tableau, Toast, Confirm, PageHeader, Toolbar, PiedDePage, Sidebar, Topbar, SuggestionIA
- [x] Page de démonstration de la bibliothèque (`/bibliotheque`, développement seulement, axe fait) ; non comparée à `Bibliotheque-1440` (mise en page différente)

## Lot A — Socle de l'espace
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [x] Coquille | — | Sidebar, Topbar, PageHeader | session, counts | — | bandeau délégation, tiroir < 1024, recherche cmdk, fin de session (28/30 min), connexion perdue | — |
| [x] Connexion | /connexion | PiedDePage | auth | — | login, code TOTP, clé WebAuthn, mot de passe oublié, réinitialisation, lien expiré, activation en 3 étapes, verrouillage 15 min, mauvais portail | 33 |
| [x] Erreur | /erreur-demo, * | PiedDePage | — | — | 403, 404, 500 | — |
| [x] Main | / | Toolbar, Indicateur | Main | — | par rôle : global (Directeur), équipe (Responsable), personnel (Gestionnaire), technique (Développeur) | tableau du Développeur absent de la maquette |

**État au 24/11/2026.** Coquille, Connexion, Erreur et Main écrits, testés (Vitest) ; axe sans violation et aucun défilement horizontal à 390, 768, 1024 et 1440 px (normal, malvoyant ; sombre à 1440). Écart visuel mesuré alors :
- Erreur : 0,2 % / 0,3 % / 0,6 % (1440 / 1024 / 390) ;
- Main : 7,3 % / 7,0 % / 12,5 % (décalages de quelques pixels, espace fine des montants, bouton « Aa » ajouté à la Topbar, bloc des créanciers) ;
- Connexion : 8,4 % / 10,9 % / 25,0 % (bloc « Démonstration », logo et badge PCI retirés, champs vides, saisie du code par cases au lieu du pavé).

## Lot B — Portefeuille
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [x] Mandants | /creanciers | Tableau, EtatListe | Mandants | — | tri | — |
| [x] Mandant | /creanciers/:id | Onglets | Mandant | — | portefeuille, activité, reversements | — |
| [x] Dossiers | /debiteurs | Tableau, Pagination | Dossiers | relance groupée, passage en contentieux | onglets, sélection, sans gestionnaire | — |
| [x] Dossier | /debiteurs/:id | SuggestionIA, Statut | Dossier | paiement, chèque impayé, relance, code d'accès, demande RGPD, réponse au débiteur | lecture seule Directeur, synthèse IA (masquée si désactivée), factures, échanges, documents, preuves | 2, 11, 21 |

## Lot C — Recouvrement
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [x] Relances | /relances | FullCalendar | Relances | — (Toast Annuler) | mois, semaine, agenda, plafonds et plages dépassés | 5 |
| [x] Echeanciers | /echeanciers | Tableau | Echeanciers | accord créancier, proposition, refus motivé | simulation, au-delà du seuil, dossiers du Directeur | — |
| [x] Contentieux | /contentieux | Tableau | Contentieux | étape de procédure | tableau, liste | 7 |

## Lot D — Communication
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [x] Telephonie | /appels | Alerte, Toast, SuggestionIA | Telephonie | ajout ou remplacement de coordonnées | en appel, attente, transfert, post-appel 60 s, 3CX injoignable, composition prévisualisée, 8 qualifications, IA | 10 |
| [x] Messagerie | /e-mails | SuggestionIA | Messagerie | envoi | dossiers, filtre « Espace débiteur », brouillon IA, échec d'envoi OVH, quota | 4 |
| [x] Sms | /sms | — | Sms | envoi | conversations, « Non rattachés », STOP, compteur 160/70 | 24 |

## Lot E — Pilotage
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [x] Notifications | /notifications | — | Notifications | — (Toast Annuler) | catégories, non lues | — |
| [x] Rapports | /rapports | @mantine/charts | Rapports | — | périodes, envois programmés | — |
| [x] Equipe | /equipe | Avatar | Equipe | désactivation, invitation | rôle unique refusé, poste 3CX | 27 |
| [x] Facturation | /facturation | — | Facturation | émission, contrat à signer | accès refusé, délégation | 6 |

## Lot F — Documents
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [x] Documents | /documents | — | Documents | — | liste, grille, quittances | — |
| [x] Generer | /documents/rediger | — | Generer | envoi simple et groupé, LRAR | simple, groupé, généré | 7 |

## Lot G — Paramètres, compte, aide
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [x] Reglages | /parametres | Reglage, Tuile, Carte | Reglages | secrets, invitations, désactivation | accueil, sections, accès refusé, barre d'enregistrement ; Relances, SMS, Données personnelles, Assistant IA ; section paiement en ligne retirée | 9, 12, 23 |
| [x] Boîtes e-mail OVH | /parametres/techniques/boites | Tableau | mailboxes | toutes les actions ; suppression avec saisie de l'adresse | recouvrement@ protégée, mot de passe affiché une fois, départ en 3 étapes | 28, 29 ; absent de la maquette |
| [x] Modele | /parametres/modeles/:id | — | Modele | soumission | contrôles refusés, alertes, aperçu | 7 |
| [x] Compte | /compte | — | Compte | déconnexion de sessions, retrait de délégation | 2FA TOTP et clé, densité, thèmes | 33 |
| [x] Aide | /aide | — | Aide | — | aucun résultat | — |
| [x] AideArticle | /aide/:slug | — | AideArticle | — | vote | — |

## Lot H — Portails externes
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [x] Portail et Connexion partenaires | partenaires / et /connexion | PiedDePage | Portail | dépôt unique et groupé | cloisonnement par créancier testé | — |
| [x] Dépôt par fichier | partenaires /depot | Dropzone | import-report | création | lignes valides et en erreur | — |
| [x] Accord sur échéancier | partenaires /echeanciers/:id | — | plan | accord, refus | déjà répondu | absent de la maquette |
| [x] Accès à mon dossier | paiement /acces | Champ | access | — | SIREN invalide, 5 échecs, 10 échecs, code par SMS sur demande | absent |
| [x] Accès limité | paiement /acces-limite | Dropzone | access | envoi | aucune donnée sur la dette | absent |
| [x] Payer réorganisé | paiement /:id | Onglets, Dropzone | Payer | demandes guidées, message | accueil, messages, payer (virement, chèque), échéancier, quittances | 6 |
| [x] Mentions légales, Confidentialité, Cookies | /mentions-legales, /confidentialite, /cookies | PiedDePage | — | — | textes relus et validés par le cabinet ; valeurs entre crochets | — |

## Lot I — E-mails (apps/api)
- [x] Copie du kit et de staff-message, service de rendu, schémas Zod, tests et snapshots
- [x] Rédaction d'un message (fiche débiteur, E-mails), envoi OVH simulé par MSW

## Après les lots
- [x] Relectures maquette et sécurité, corrections (PR 12 et 13) ; les dernières corrections et les PR 14 et 15 n'ont pas été relues par un agent
- [x] Questions ouvertes tranchées dans la discussion ; `QUESTIONS.md` vide à la fin du front-end, décisions dans `DECISIONS.md`
- [x] Réponses juridiques appliquées
- [ ] Écart visuel de 3 % au plus : **atteint seulement par Erreur**. Les autres écrans restent au-dessus
- [x] GitHub Actions : `verifier` réussi sur les PR 16 à 18 (constaté le 25/11/2026)
- [ ] Téléchargements de PDF désactivés : ils dépendent de l'API (mission API, lots N, P, S et U)
- [ ] Reporté à la mission API : dépôt des logos (`media.legarec.fr`), valeurs entre crochets (Paramètres, variables du serveur, fiches créanciers, numéro SMS) : lots L et N
- [ ] Mission API, relevé par la relecture sécurité (repris dans « Points à reprendre du front », en fin de fichier) :
  - SIREN, IBAN et BIC des e-mails lus dans les Paramètres saisis par le Directeur, pas dans l'environnement ; aucun envoi tant qu'une valeur est entre crochets
  - code d'accès retiré de tout message entrant avant stockage, affichage, IA ou journal ; jamais dans une file d'attente ; `Cache-Control: no-store` sur sa route
  - plafonds de contact appliqués par débiteur à tous les envois (fiche, groupé, SMS, e-mails, courriers), contacts réels compris
  - accès débiteur : limite réelle par adresse IP, alerte au gestionnaire lors d'un blocage
  - invitation d'un collaborateur envoyée après la création de sa boîte
  - score de risque : exclure les entrepreneurs individuels, d'après la forme juridique
- Les numéros de la colonne « Points ouverts » renvoient à d'anciennes questions, toutes tranchées.

# Plan de la mission API

Validé par le cabinet le 25/11/2026. Architecture, schéma, sécurité, clés et tests : `docs/api.md`. Décisions : `DECISIONS.md` (questions 65 à 111). Points à trancher ou à confirmer : `QUESTIONS.md`.

## Conventions de la mission API
- Une branche `lot/<lettre>` et une PR par lot, un commit par module ; le cabinet fusionne. Le code commence quand le lot J0 est fusionné.
- Accord du cabinet attendu après J (socle), M (argent) et P (portails), et avant Q (premiers envois réels possibles).
- Chaque écran hors maquette est montré au cabinet avant développement.
- Avant chaque PR : `pnpm verifier`, puis `relecteur-securite` et `testeur` sans point bloquant.
- Développement uniquement, jamais la production (secrets, conteneurs, journaux, base, Caddy), jamais Docker ni `pnpm deployer` ; `sudo` pour `apt-get install` seulement, annoncé avant chaque fois. `kits/`, `maquette/`, `.claude/settings.json` et `PROMPT-FRONT.md` ne se modifient pas.

## Lots de la mission API
Les 161 routes simulées se répartissent ainsi :

| Lot | Contenu | Routes reprises |
|---|---|---|
| [x] J0 | Documentation : décisions 65 à 111, points à confirmer, `PLAN.md`, `docs/`, `.claude/rules/api.md` | — |
| [x] J | Socle : services de développement, NestJS, Prisma, rôles et RLS, audit, erreurs, journaux masqués, OpenAPI, outbox, banc de tests, GitHub Actions (services PostgreSQL et Valkey, Node 26), corps de requêtes Zod manquants, en-tête `Idempotency-Key` dans `packages/platform/src/http.ts` | 0 |
| [ ] K | Comptes : connexion, 2FA, sessions, invitations, délégations, support, premier Directeur par commande | 40 (`auth`, `account`, `members`, `delegations`, `support-tickets`) |
| [ ] L | Portefeuille : paramètres et coffre, créanciers et mandats, débiteurs, dossiers, coordonnées, code d'accès, recherche, notifications. **Écrans** créancier et débiteur | 21 |
| [ ] M | Argent : intérêts, paiements, promesses, litiges, échéanciers | 7 |
| [ ] N | Documents : S3 (disque local en développement), antivirus, modèles, PDF, téléchargements, valeurs entre crochets, logos | 16 |
| [ ] O | Espace débiteur : accès, messages, demandes, acceptation de l'échéancier | 14 |
| [ ] P | Portail partenaires : dépôts, imports, accords, messages, relevés | 13 |
| [ ] Q | Envois : plafonds, plages, scénarios, relances, Resend, courriers MySendingBox (test) | 7 |
| [ ] R | Boîtes OVH, IMAP et SMTP, e-mails, SMS | 21 |
| [ ] S | Facturation, avoirs, reversements. **Écrans** avoir et validation | 2 |
| [ ] T | Téléphonie 3CX Call Control, enregistrements | 6 |
| [ ] U | Contentieux, rapports, équipe, tableaux de bord, score de risque | 8 |
| [ ] V | RGPD : registre, exports, anonymisation, purges | 3 |
| [ ] W | IA : couche compatible OpenAI, essai mesuré, quatre fonctions | 3 |
| [ ] X | Exploitation : Dockerfiles, compose, `infra/caddy/Caddyfile`, pgBackRest, Gatus, Loki ; bascule finale | — |

**Bascule** : chaque lot ajoute ses préfixes à une liste `VITE_API` (développement) : MSW laisse passer ces routes vers l'API. La valeur par défaut bascule portail par portail : paiement après O, partenaires après P, espace après U. Chaque lot rejoue les mêmes requêtes contre MSW et contre l'API et valide les deux par le même schéma Zod. En mode mixte, un lien vers un écran non branché peut ne pas trouver le dossier (développement seulement). MSW reste pour les tests de composants.

**À fournir par le cabinet, jamais par Claude Code** : clés de test Resend et MySendingBox dans le `.env` (Q), Scaleway en option (N), voir `docs/api.md`, « Clés et secrets » ; compte SMS avec numéro virtuel (R) ; licence et identifiants 3CX (T) ; second domaine Resend (Q) ; valeurs entre crochets (N) ; déploiement (X). Sans elles, les adaptateurs tournent en mode simulé.

## Lot J — Socle (état au 25/11/2026)
- [x] Services de développement sans root ni service système (`infra/dev/services.mjs`), lancement de l'API et du worker (`pnpm --filter @legarec/api dev`)
- [x] NestJS 12, Prisma 7, trois connexions PostgreSQL, 10 rôles sans connexion, RLS forcée ; 11 tables du socle (comptes, délégations, créanciers, débiteurs, dossiers, historique, numérotation, journal, boîte d'envoi, webhooks, idempotence). Les autres tables arrivent avec leur lot
- [x] Règle d'accès obligatoire par route, matrice d'accès, origine exacte par portail, idempotence, erreurs uniformes, journaux sans donnée personnelle, journal et historique en ajout seul
- [x] Chiffrement AES-256-GCM avec version de clé, clés dérivées par usage ; boîte d'envoi, worker aux droits de l'auteur, purge quotidienne
- [x] OpenAPI et types des routes générés et vérifiés ; corps de toutes les requêtes des portails en Zod (`packages/contracts/src/requests.ts`), contrôlés aussi par les simulations ; clé d'idempotence envoyée par les portails
- [x] GitHub Actions : PostgreSQL 17, Valkey 8.1, Node 26
- Aucune route des portails n'est encore branchée : les écrans restent sur les simulations.

## Points à reprendre du front

| Point | Lot |
|---|---|
| Téléchargements désactivés : RIB, échéancier, quittances, factures (paiement) ; relevés PDF et CSV, documents (partenaires) ; documents, aperçu de modèle, rapports (espace) : URL présignée de 5 minutes, nom de fichier neutre | N, P, S, U |
| Logos : `media.legarec.fr/marque/` et `e-mails/v1/`, déposés par le cabinet ; le kit cite 8 logos officiels, l'écran Kit média en liste 4 | N |
| Valeurs entre crochets, toutes lues dans Paramètres : SIREN, TVA, IBAN, BIC, titulaire, banque, ordre et adresse des chèques, adresse du cabinet, capital et RCS, forme juridique, directeur de la publication, hébergeur, taux des pénalités, numéro SMS, adresse du créancier (sa fiche), fournisseur IA, transferts. Tant qu'un crochet subsiste dans un rendu : envoi refusé (`FIRM_INCOMPLETE`) | L, N |
| E-mails : `readEmailConfig` lit les Paramètres et non plus l'environnement | L |
| Code d'accès retiré de tout message entrant ; copie masquée des courriers pour le créancier et les lecteurs sans droit d'agir : **sans cela, un créancier verrait le code qui ouvre les dossiers de tous les créanciers du débiteur** | N, O, R |
| Plafonds sur tous les envois (fiche, groupé, SMS, e-mails, courriers, appels) et fenêtre de dérogation motivée | Q |
| Blocage d'un accès : notification au gestionnaire, historique | O |
| Invitation envoyée après la création de la boîte | K, R |
| « Accepter cet échéancier » ; textes « signature électronique » (Échéanciers, Facturation, Rédiger, modèles, aide) | O, S |
| Premier courrier : seul un courrier postal compte (fiche, Rédiger, aide, scénarios) | Q |
| Forme juridique affichée et corrigeable ; score absent si inconnue, entrepreneur individuel ou particulier | L, U |
| **Valeurs de démonstration figées dans 18 fichiers** : « novembre », « décembre », « 2026 », « ▲ 3 pts », « 8 % HT », 134 070 € d'honoraires, listes de gestionnaires et d'avocats, dates de décembre 2026 dans `letterSchedule` et le simulateur | L à U |
| Fiche débiteur : la relance envoie un destinataire libre et des libellés ; devient un contact du dossier et des codes | Q |
| Appel entrant lu une seule fois : interrogation toutes les 5 secondes | T |
| Échec d'envoi et quota par boîte : compteur dans Valkey, plus en mémoire | R |
| Support : « Réinitialiser la double authentification » et « Débloquer », absents de l'écran | K |
| Écran Secrets : liste de noms attendus, « Renouveler » qui demande la nouvelle valeur, « Révoquer » masqué pour les clés internes, `SESSION_SIGNING_KEY` retirée, « Environnement » réel (108 à 110) | L |
| Appels : « Transcription en direct » devient une transcription proposée après l'appel (question 72) | W |
| Tableau des permissions : « Valider un échéancier, une remise ou un abandon de créance », « Ses dossiers » pour le Directeur (question 86) ; « Validations » : accord du créancier après celui du Responsable | M |
| Absence : le remplaçant reçoit des notifications neutres (Mon compte, « Absence et remplacement ») | K |
| Données personnelles : durées modifiables et anonymisation désactivable à l'écran, alors qu'elles sont fixées ; page Confidentialité à compléter (durées, suivi des e-mails avant de l'activer) | Q, V |
| Synchronisation d'un contact avec l'annuaire 3CX (`HANDOFF.md`) : annuaire commun à toute l'équipe, écart à signaler avant développement | T |

## Risques et limites

- Claude Code ne peut ni lancer Docker ni lire le `.env` : images validées par GitHub Actions seulement, services réels vérifiés par le cabinet avec une liste de recette fournie à chaque lot. OVH et 3CX n'ont pas de mode test trouvé : leur première vraie connexion se fait en production, par le cabinet.
- Perte de `VAULT_MASTER_KEY` : mots de passe de boîtes, codes d'accès, double authentification et clés des services sont à refaire, les IBAN des créanciers à ressaisir, les transcriptions perdues.
- Mémoire du VPS (11,7 Go, 7,5 libres) : ClamAV environ 1,2 Go, modèle local 3 à 4 Go, plus la production. L'essai du lot W le mesure avant tout choix.
- À faire valider par le juriste : kit sans rappel du premier courrier (85), suivi des e-mails (84), intérêts des particuliers (98), coordonnées (79). Suivi dans `QUESTIONS.md`.
- Numéro virtuel OVH : si les liens y sont refusés, la question 70 se rouvre.
- Code d'accès court (331 776 combinaisons) : d'où limites, blocage, réponses identiques et exclusion des mots courants. Coordonnées fournies par les créanciers : question 112, à trancher avant le lot O.
- Pouvoirs du Développeur sur le compte du Directeur : question 113, à trancher avant le lot K.
- Les PR sont volumineuses (K, L, R) : un commit par module pour faciliter la relecture.

## Vérification

1. `node infra/dev/services.mjs start` : paquets Debian téléchargés, vérifiés par apt et extraits dans un dossier privé, sans `sudo` ni service, car les ports 5432 et 6379 de la machine sont déjà pris ; les tests refusent ces deux ports.
2. `pnpm verifier` : types, lint, tests unitaires, base réelle, matrice d'accès, contrats, dérive de schéma.
3. `pnpm e2e` contre l'API pour les portails basculés, axe, quatre largeurs ; `/comparer` sur les écrans modifiés.
4. Recette de cloisonnement : deux créanciers, deux gestionnaires, deux débiteurs ; aucune donnée croisée à l'écran, dans l'API ni en SQL.
5. `relecteur-securite` sans point bloquant avant chaque PR.
