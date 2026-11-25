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
- [ ] Page de démonstration de la bibliothèque et comparaison à `Bibliotheque-1440` (tests unitaires et axe faits)

## Lot A — Socle de l'espace
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [ ] Coquille | — | Sidebar, Topbar, PageHeader | session, counts | — | bandeau délégation, tiroir < 1024, recherche cmdk, fin de session (28/30 min), connexion perdue | — |
| [ ] Connexion | /connexion | PiedDePage | auth | — | login, code TOTP, clé WebAuthn, mot de passe oublié, réinitialisation, lien expiré, activation en 3 étapes, verrouillage 15 min, mauvais portail | 33 |
| [ ] Erreur | /erreur-demo, * | PiedDePage | — | — | 403, 404, 500 | — |
| [ ] Main | / | Toolbar, Indicateur | Main | — | par rôle : global (Directeur), équipe (Responsable), personnel (Gestionnaire), technique (Développeur) | tableau du Développeur absent de la maquette |

**État au 24/11/2026.** Coquille, Connexion, Erreur et Main écrits, testés (Vitest) ; axe sans violation et aucun défilement horizontal à 390, 768, 1024 et 1440 px (normal, malvoyant ; sombre à 1440). Non cochés car il reste : parcours Playwright versionnés, relectures par les agents, et l'écart visuel :
- Erreur : 1,5 % / 2,1 % / 5,4 % (1440 / 1024 / 390) ;
- Main : 7,3 % / 7,0 % / 12,5 % (décalages de quelques pixels, espace fine des montants, bouton « Aa » ajouté à la Topbar, bloc des créanciers) ;
- Connexion : 8,4 % / 10,9 % / 25,0 % (bloc « Démonstration », logo et badge PCI retirés, champs vides, saisie du code par cases au lieu du pavé).

## Lot B — Portefeuille
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [ ] Mandants | /creanciers | Tableau, EtatListe | Mandants | — | tri | — |
| [ ] Mandant | /creanciers/:id | Onglets | Mandant | — | portefeuille, activité, reversements | — |
| [ ] Dossiers | /debiteurs | Tableau, Pagination | Dossiers | relance groupée, passage en contentieux | onglets, sélection, sans gestionnaire | — |
| [ ] Dossier | /debiteurs/:id | SuggestionIA, Statut | Dossier | paiement, chèque impayé, relance, code d'accès, demande RGPD, réponse au débiteur | lecture seule Directeur, synthèse IA (masquée si désactivée), factures, échanges, documents, preuves | 2, 11, 21 |

## Lot C — Recouvrement
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [ ] Relances | /relances | FullCalendar | Relances | — (Toast Annuler) | mois, semaine, agenda, plafonds et plages dépassés | 5 |
| [ ] Echeanciers | /echeanciers | Tableau | Echeanciers | accord créancier, proposition, refus motivé | simulation, au-delà du seuil, dossiers du Directeur | — |
| [ ] Contentieux | /contentieux | Tableau | Contentieux | étape de procédure | tableau, liste | 7 |

## Lot D — Communication
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [ ] Telephonie | /appels | Alerte, Toast, SuggestionIA | Telephonie | ajout ou remplacement de coordonnées | en appel, attente, transfert, post-appel 60 s, 3CX injoignable, composition prévisualisée, 8 qualifications, IA | 10 |
| [ ] Messagerie | /e-mails | SuggestionIA | Messagerie | envoi | dossiers, filtre « Espace débiteur », brouillon IA, échec d'envoi OVH, quota | 4 |
| [ ] Sms | /sms | — | Sms | envoi | conversations, « Non rattachés », STOP, compteur 160/70 | 24 |

## Lot E — Pilotage
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [ ] Notifications | /notifications | — | Notifications | — (Toast Annuler) | catégories, non lues | — |
| [ ] Rapports | /rapports | @mantine/charts | Rapports | — | périodes, envois programmés | — |
| [ ] Equipe | /equipe | Avatar | Equipe | désactivation, invitation | rôle unique refusé, poste 3CX | 27 |
| [ ] Facturation | /facturation | — | Facturation | émission, contrat à signer | accès refusé, délégation | 6 |

## Lot F — Documents
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [ ] Documents | /documents | — | Documents | — | liste, grille, quittances | — |
| [ ] Generer | /documents/rediger | — | Generer | envoi simple et groupé, LRAR | simple, groupé, généré | 7 |

## Lot G — Paramètres, compte, aide
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [ ] Reglages | /parametres | Reglage, Tuile, Carte | Reglages | secrets, invitations, désactivation | accueil, sections, accès refusé, barre d'enregistrement ; Relances, SMS, Données personnelles, Assistant IA ; section paiement en ligne retirée | 9, 12, 23 |
| [ ] Boîtes e-mail OVH | /parametres/techniques/boites | Tableau | mailboxes | toutes les actions ; suppression avec saisie de l'adresse | recouvrement@ protégée, mot de passe affiché une fois, départ en 3 étapes | 28, 29 ; absent de la maquette |
| [ ] Modele | /parametres/modeles/:id | — | Modele | soumission | contrôles refusés, alertes, aperçu | 7 |
| [ ] Compte | /compte | — | Compte | déconnexion de sessions, retrait de délégation | 2FA TOTP et clé, densité, thèmes | 33 |
| [ ] Aide | /aide | — | Aide | — | aucun résultat | — |
| [ ] AideArticle | /aide/:slug | — | AideArticle | — | vote | — |

## Lot H — Portails externes
| Écran | Route | Composants propres | MSW | Confirm | États propres | Points ouverts |
|---|---|---|---|---|---|---|
| [ ] Portail et Connexion partenaires | partenaires / et /connexion | PiedDePage | Portail | dépôt unique et groupé | cloisonnement par créancier testé | — |
| [ ] Dépôt par fichier | partenaires /depot | Dropzone | import-report | création | lignes valides et en erreur | — |
| [ ] Accord sur échéancier | partenaires /echeanciers/:id | — | plan | accord, refus | déjà répondu | absent de la maquette |
| [ ] Accès à mon dossier | paiement /acces | Champ | access | — | SIRET invalide, 5 échecs, 10 échecs, code par SMS | 22 ; absent |
| [ ] Accès limité | paiement /acces-limite | Dropzone | access | envoi | aucune donnée sur la dette | absent |
| [ ] Payer réorganisé | paiement /:id | Onglets, Dropzone | Payer | demandes guidées, message | accueil, messages, payer (virement, chèque), échéancier, quittances | 6 |
| [ ] Confidentialité | /confidentialite | PiedDePage | — | — | texte à fournir | 7 |

## Lot I — E-mails (apps/api)
- [ ] Copie du kit et de staff-message, service de rendu, schémas Zod, tests et snapshots
- [ ] Rédaction d'un message (fiche débiteur, E-mails), envoi OVH simulé par MSW
