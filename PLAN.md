# Plan de développement du front-end Legarec

Établi le 24/11/2026 à partir du kit v2.5. L'utilisateur a demandé d'enchaîner les lots sans attendre la validation de ce plan. Cocher chaque ligne quand elle est terminée selon `PROMPT-FRONT.md` (étape 2).

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
- [x] Questions ouvertes tranchées dans la discussion ; `QUESTIONS.md` vide, décisions dans `DECISIONS.md`
- [x] Réponses juridiques appliquées
- [ ] Écart visuel de 3 % au plus : **atteint seulement par Erreur**. Les autres écrans restent au-dessus
- [ ] GitHub Actions : aucune exécution constatée, cause inconnue
- [ ] Téléchargements de PDF désactivés : ils dépendent de l'API (mission suivante)
- [ ] Reporté à la mission API : dépôt des logos (`media.legarec.fr`), valeurs entre crochets (Paramètres, variables du serveur, fiches créanciers, numéro SMS)
- [ ] Mission API, relevé par la relecture sécurité :
  - SIREN, IBAN et BIC des e-mails lus dans les Paramètres saisis par le Directeur, pas dans l'environnement ; aucun envoi tant qu'une valeur est entre crochets
  - code d'accès retiré de tout message entrant avant stockage, affichage, IA ou journal ; jamais dans une file d'attente ; `Cache-Control: no-store` sur sa route
  - plafonds de contact appliqués par débiteur à tous les envois (fiche, groupé, SMS, e-mails, courriers), contacts réels compris
  - accès débiteur : limite réelle par adresse IP, alerte au gestionnaire lors d'un blocage
  - invitation d'un collaborateur envoyée après la création de sa boîte
  - score de risque : exclure les entrepreneurs individuels, d'après la forme juridique
- Les numéros de la colonne « Points ouverts » renvoient à d'anciennes questions, toutes tranchées.
