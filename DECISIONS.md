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
| 24/11/2026 | Accès des débiteurs par identifiant (SIRET, recherche sur le SIREN ; référence du dossier pour un particulier) et code d'accès de 4 lettres ; code envoyé par SMS sur demande, jamais par e-mail | Sécurité sans compte débiteur |
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
| 24/11/2026 | Code d'accès des débiteurs jamais envoyé par e-mail : `case.access_code` n'est transmis à aucun modèle ; envoi par SMS sur demande, ou régénération par un collaborateur | Sécurité de l'espace débiteur |
| 24/11/2026 | SMS : « Non rattachés » pour les numéros inconnus, « STOP » arrête les SMS automatiques, compteur signalant le passage de 160 à 70 caractères | Prompt v2.5 |
| 24/11/2026 | Montants en centimes entiers dans `packages/contracts` et MSW ; principal, intérêts et frais séparés ; un paiement partiel s'impute d'abord sur les intérêts (calcul de l'API) | Prompt v2.5 |
| 24/11/2026 | Paiements reçus enregistrés à la main (chèque : encaissé ou impayé ; virement : rapprochement) ; quittance quand le paiement devient définitif ; un chèque impayé annule le paiement (Confirm) | Prompt v2.5 |
| 24/11/2026 | Dépôt de créances : import CSV ou Excel analysé par l'API seulement, rapport ligne par ligne, rien n'est créé avant Confirm | Prompt v2.5 |
| 24/11/2026 | Contrôles ajoutés à l'import d'un modèle : référence et date du premier courrier (refus), termes imitant un acte de commissaire de justice (alerte), SMS à 70 caractères (alerte) ; champs debiteur.code_acces, dossier.premier_courrier_reference, dossier.premier_courrier_date | Prompt v2.5 |
| 24/11/2026 | Contacts : plafonds par débiteur et par canal, plages horaires réglables dans Paramètres du cabinet > Relances | Pas de harcèlement |
| 24/11/2026 | Directeur : consultations des dossiers qui ne lui sont pas attribués notées dans l'historique | Prompt v2.5 |
| 24/11/2026 | Premier commit du kit sur `main` poussé par l'utilisateur (dépôt vide) ; ensuite, uniquement des PR | Choix de l'utilisateur, 24/11/2026 |
| 24/11/2026 | Enchaînement de tous les lots demandé sans validation préalable de `PLAN.md` | Choix de l'utilisateur, 24/11/2026 |
