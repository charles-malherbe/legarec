# Journal de la session autonome du 26/11/2026

Session Claude Code lancée sur le VPS pendant l'absence de l'utilisateur, avec pour consigne de continuer le projet (PR, tests, correctifs, suite des lots), d'éviter les boucles et de consigner ici toute initiative prise face à un point bloquant.

## État trouvé au démarrage (08:15)
- 17 PR empilées ouvertes (#34 à #50), aucune fusionnée depuis #33 (lot M). GitHub Actions ne démarre plus (limite de dépenses du compte) : toutes les vérifications sont locales (`pnpm verifier`).
- Une autre session Claude (« Statut et avancement », Claude Desktop, démarrée à 07:51) travaille sur le contentieux (`lot/u2`, décision 163) et a fait le commit de la décision 162. **Pour ne pas entrer en collision, cette session-ci ne touche ni au lot U, ni au lot P**, et le lui a signalé par message.
- Services de développement (PostgreSQL 55432, Valkey 56379) démarrés ; les tests créent une base par exécution, deux sessions peuvent donc vérifier en même temps.

## Initiatives
| Heure | Initiative | Raison |
|---|---|---|
| 08:20 | Travail dans une worktree séparée (`.claude/worktrees/autonome-v2`), branche `lot/v2` partie de `30d1883` (sommet de la pile, PR #50) | L'autre session utilise le dépôt principal et sa propre worktree |
| 08:20 | Lot choisi : V suite (anonymisation à la demande, conservation 5 ans après clôture) | Spécifié dans `docs/api.md` (« Conservation »), ne dépend d'aucune réponse du cabinet ni d'aucune clé externe, et ne recoupe pas le travail de l'autre session |
| 08:25 | Accord avec l'autre session : migration du lot V2 horodatée après `20261126170000_litigation` ; à la fusion avec `lot/u2`, `anonymize_case()` devra aussi traiter `litigation_files` (FK vers `cases` sans cascade) et le rôle de rétention recevoir ses droits sur cette table | Message de l'autre session ; sinon violation de clé étrangère une fois les deux branches fusionnées |
| 08:25 | Implémentation confiée à un agent avec garde-fous anti-boucle : 3 tentatives au plus sur une même erreur, rien d'inventé (question ajoutée à `QUESTIONS.md`), `pnpm verifier` et relecture sécurité avant de finir | Consigne « aucune boucle qui tourne en rond » |

## Avancement
- **08:45 — Lot V suite, première version** : 4 commits (anonymisation des dossiers clos depuis plus de 5 ans, effacement d'un débiteur à sa demande, documentation, correctif de relecture). `pnpm verifier` relancé par cette session : 89 fichiers, 3 350 tests, tout passe. Questions 168 et 169 (d’abord numérotées 165 et 166) ajoutées.
- **08:50 — Relecture sécurité indépendante** (agent distinct, lecture seule) : aucun bloquant ; 3 importants (drapeau de session `app.forgetting` posable par toute session ; dossier anonymisé encore alimentable par un paiement ou une coordonnée ; particulier suivi par deux créanciers = deux fiches, l'effacement n'en couvre qu'une) et 5 mineurs (ordre des verrous, valeur attendue, texte libre restant, effacement des fichiers par lots, PDF signé d'un échéancier). Renvoyés à l'agent d'implémentation pour une passe de correction unique.
- **09:15 — Corrections de la relecture** : 3 commits. Rôle `legarec_forgetter` (le drapeau de session disparaît), plus rien ne s'ajoute à un dossier anonymisé (409), homonymes signalés avant l'effacement, empreinte des dossiers comme valeur attendue, texte libre vidé, fichiers effacés par lots, PDF signé d'un échéancier gardé 10 ans. `pnpm verifier` relancé par cette session : 89 fichiers, 3 356 tests, tout passe.
- **09:30 — PR #51 ouverte** (`lot/v2`, empilée sur #50).
- **09:35 — Avoirs (lot S)** confiés à un agent sur `lot/s3`, empilée sur `lot/v2` : 3 commits, `pnpm verifier` 3 408 tests au vert (relancé par cette session) ; relecture indépendante : aucun bloquant, 2 points importants (écran) et 6 mineurs renvoyés en correction.
- **~10:00 — Fusion du bas de la pile, demandée par l'utilisateur** : PR #34 à #49 fusionnées dans `main`, une par une, par commit de fusion comme les précédentes, branches gardées. `main` a exactement l'arbre de `lot/x4`. `gh pr edit --base` échoue (dépréciation des « Projects classic » de GitHub) : rebasage fait par l'API REST. #50 vise désormais `main`, non fusionnée (l'autre session y ajoute encore des décisions).
- **`pnpm verifier` sur `main` fusionné** : 8 échecs, aucun dû au code. 7 dépassements de délai dans les formulaires dossier et créancier, sous la charge de trois vérifications en parallèle : seuls, ils passent (33 sur 33). 1 échec de `schema.test.ts` (rôles) : le rôle `legarec_forgetter`, créé par les tests de `lot/v2` dans le PostgreSQL de développement commun, s'ajoute à la liste attendue. Il disparaît avec la fusion de #51, et ne se produit pas sur une base neuve.
- **Collision de numéros** : l'autre session a pris les questions 165 à 167 pour des décisions du cabinet. Les miennes sont renumérotées : 168 et 169 (lot V), 170 à 173 (avoirs). L'autre session prend 174 et plus. Branche des décisions fusionnée dans `lot/v2` (sans conflit, sans force push) ; `pnpm verifier` : 3 356 tests au vert ; `lot/v2` repoussée.
- **~10:45 — Avoirs, corrections de la relecture** : 3 commits (brouillon jamais repris sur une autre facture, motif qui nomme un débiteur refusé, brouillons purgés à 30 jours et journalisés, identité du cabinet figée à l'émission, champ manquant nommé, arrondi de TVA borné, numéro dit provisoire, 500 factures après filtre). Questions renumérotées 170 à 174 (l'autre session prend 175 et plus) ; `lot/v2` fusionnée dans `lot/s3`, un conflit de `QUESTIONS.md` résolu. `pnpm verifier` relancé par cette session, seul : 91 fichiers, 3 414 tests au vert.
- **~10:50 — PR #52 ouverte** (avoirs, `lot/s3`, empilée sur #51).
- **~11:30 — Lot V, fin : purge à 10 ans des pièces comptables** (`lot/v3`). Agent d'implémentation, puis relecture indépendante qui a trouvé **un point bloquant** : un lot de reversements validé mais jamais marqué payé aurait été purgé avec les paiements encaissés dus au créancier. Corrigé (seuls les lots payés partent, un paiement encaissé hors d'un reversement payé retient tout), contrôlé par le même relecteur, test ajouté qui échoue si la garde est retirée. Question numérotée 175 avec l'autre session (qui part de 176). `pnpm verifier` relancé par cette session : 91 fichiers, 3 433 tests au vert.
- **PR #53 ouverte** (purge à 10 ans, `lot/v3`).
- **Lot O, compléments de l'accès débiteur** (`lot/o4`) : compteur d'échecs par débiteur à travers tous ses dossiers, fenêtre glissante pour la limite par réseau, alerte au-delà de 200 échecs par heure avec suspension de 15 minutes des réseaux en cause. Relecture indépendante : aucun bloquant, 2 importants (une connexion réussie remettait à zéro le compteur du débiteur ; un attaquant pouvait faire suspendre des débiteurs légitimes dès leur premier échec) et 5 mineurs ; corrigés, puis contrôlés par le même relecteur. Questions 176 et 177. `pnpm verifier` relancé par cette session : 91 fichiers, 3 442 tests au vert.
- **PR #54 ouverte** (accès débiteur, `lot/o4`).
- **Lot W, suite** (`lot/w2`) : budget par défaut de l'IA à 40 € (décision 166), journal de l'IA dans Paramètres sur l'API (Directeur et Développeur ; jamais le texte envoyé ni la suggestion), synthèse du dossier refaite en tâche de fond à l'arrivée d'événements. Relecture indépendante : aucun bloquant, 2 importants corrigés. **Initiative** : la synthèse automatique a son propre interrupteur, « Synthèse refaite automatiquement », **désactivé par défaut**. Sinon, le jour où l'IA est allumée, tout dossier actif serait parti chez le fournisseur sans que le Directeur l'ait choisi. C'est un ajout à un écran validé, signalé dans la question 179. Un dossier clos entre la mise en file et l'exécution n'est plus envoyé. Questions 178 et 179. `pnpm verifier` relancé par cette session : 91 fichiers, 3 466 tests au vert.
- **PR #55 ouverte** (IA, `lot/w2`).
- **Points à reprendre du front** (`lot/f1`) : sur les 5 points visés, 4 étaient déjà faits au lot L (le plan est mis à jour) ; le tableau des permissions est corrigé (Directeur : « Ses dossiers » pour valider un échéancier, une remise ou un abandon ; accord du créancier après le Responsable, question 86), avec un test. `pnpm verifier` : 91 fichiers, 3 467 tests au vert.

- **Fin de journée — fusion demandée par l'utilisateur** : PR #50 à #56 fusionnées dans `main`, dans l'ordre, par commit de fusion ; `main` a exactement l'arbre de `lot/f1`. `pnpm verifier` sur `main` après #53 : 91 fichiers, 3 433 tests au vert ; après #56 : 91 fichiers, 3 467 tests au vert.

## À faire par l'utilisateur ou le cabinet
- **`bootstrap.sql` et le rôle `legarec_forgetter`** : aucune production n'existe encore sur ce serveur (ni `/opt/legarec`, ni `/etc/legarec`). Au premier déploiement, `infra/postgres/legarec-roles` exécute `bootstrap.sql` à la création de la base : rien à faire. Pour les déploiements suivants, `infra/deployer.sh` relance `legarec-roles` après la sauvegarde et avant les migrations (ajouté à la demande de l'utilisateur ; non essayé, Docker étant interdit à Claude Code).
- Texte de #56 (« Échéancier au-delà de la durée maximale », décision 86) **validé par l'utilisateur le 26/11**. Restent à aligner si le cabinet le veut : la description du bloc et l'article d'aide « Valider un échéancier ».
- Questions **178** (journal de l'IA : Directeur et Développeur seuls, sans export) et **179** (synthèse automatique : interrupteur ajouté, désactivé par défaut ; dossiers actifs dans les 24 h, 5 minutes de calme, 20 dossiers toutes les 5 minutes) à confirmer.
- Questions **176** (alerte : Directeur et Développeur dans l'application ; suspension des seuls réseaux d'au moins 3 échecs dans l'heure ; une requête sans adresse n'est jamais suspendue) et **177** (10 échecs au total par débiteur ; un débiteur bloqué par une autre référence lit « code incorrect » même avec le bon code jusqu'à la régénération) à confirmer.
- **`TRUSTED_PROXIES`** : c'est le nombre de relais devant l'API (1 par défaut, Caddy seul) ; `infra/valeurs/api.env.exemple` ne le fixe pas. Rien à faire, sauf à ajouter un relais devant Caddy.
- Question **175** (point de départ des 10 ans : fin de l'année civile de la pièce ; paiements jamais reversés gardés sans limite ; lignes du dossier et du débiteur anonymisés gardées) à confirmer, en place par défaut.
- Questions **170 à 174** (avoirs) à confirmer, en place par défaut. La 174 bloque un motif d'avoir qui contient le nom d'un débiteur du créancier (4 lettres ou plus) : un nom qui est aussi un mot courant bloquerait des motifs légitimes.
- Questions **168** (règle de l'effacement à la demande) et **169** (ce qui reste d'un dossier anonymisé) à confirmer, en place par défaut.
- Fusion avec `lot/u2` (contentieux) : **faite le 26/11** (migration `20261127010000_litigation_retention`, `app.forget_case()` supprime la fiche de contentieux). Questions **180 à 184** à confirmer ; la 183 est à trancher (un dossier revenu d'une procédure close ne repasse pas en contentieux).
- Reste ouvert : écran d'effacement (absent de la maquette, API seulement) ; relevés de reversements sans dossier jamais purgés tant que rien ne les relie à leur lot (à revoir avec les relevés PDF du lot S).

# Session du 26/11/2026 au soir : préparer le déploiement

Consigne de l'utilisateur : « Continuer à avancer le projet pour préparer le déploiement ». Session `debian-09`, worktree `.claude/worktrees/deploiement`. L'autre session (« Statut et avancement ») est prévenue ; elle ne travaille ni sur la pile #60–#66 ni sur ces sujets. Questions 194 à 199 réservées à cette session.

## Initiatives
| Initiative | Raison |
|---|---|
| Branche `lot/x5` partie du sommet de la pile (`lot/v4`, #66) et non de `main` | #60 à #66 ne sont pas fusionnées ; partir de `main` aurait créé des conflits dans `QUESTIONS.md`, `PLAN.md` et les migrations |
| Clés de stockage renommées `S3_ACCESS_KEY` et `S3_SECRET_KEY` (migration `20261127060000_storage_secret_names`), variables `S3_REGION` et `S3_DOCUMENTS_BUCKET` | `docs/api.md` prévoyait ce renommage au lot X ; un nom sans fournisseur ne sera plus à changer. Aucune production n'existe : rien à ressaisir |
| Libellé « Scaleway Object Storage » remplacé par « OVHcloud Object Storage » dans Paramètres (secrets et liste des services) | Décision du cabinet du 26/11/2026. **Écart à un libellé de la maquette**, à confirmer ; `maquette/`, `kits/` et `PROMPT-FRONT.md` ne sont pas modifiés et nomment encore Scaleway |
| Région `eu-west-par` et adresse `s3.eu-west-par.io.cloud.ovh.net` écrites dans les modèles de `infra/valeurs/` au lieu de `[RÉGION]` | Valeurs décidées et publiques (documentation OVHcloud) ; une valeur de moins à saisir |
| pgBackRest laissé en adresses « chemin » | OVHcloud accepte les deux formes ; **non essayé contre un vrai bucket** (aucune clé, et jamais depuis ce serveur) : le premier `sauvegarde full` de la mise en service le vérifiera |
| Question 194 ajoutée : que faire des écrans sans API à la mise en service | La comparaison des routes simulées et du contrat de l'API montre 41 routes de l'espace et 1 du portail des créanciers absentes ; 5 seulement ne dépendent d'aucune clé externe |

## Avancement
- **`lot/x5` — stockage chez OVHcloud, état des écrans sans API**. `pnpm verifier` relancé par cette session : 94 fichiers, 3 579 tests au vert (un premier passage avait échoué faute de dépendances installées dans la worktree neuve, pas à cause du code). Relecture sécurité indépendante (agent distinct, lecture seule) : aucun bloquant, 2 importants, 4 mineurs.
  - Corrigé : en CI, la région écrite en clair dans le modèle l'emportait sur la valeur fictive, et Caddy aurait appelé le vrai bucket (`infra/ci/values.sh` fait primer la valeur du job, et le vérifie) ; `.env.exemple` proposait `S3_BUCKET=legarec-documents`, que le garde « bucket de production refusé hors production » ne lit pas (remplacé par `S3_DOCUMENTS_BUCKET=`, vide) ; commentaire de la migration ; en-têtes `X-Amz-*` d'OVHcloud retirés des réponses de `media.legarec.fr`.
  - Laissé : `kits/caddy/Caddyfile.exemple` nomme encore Scaleway (dossier à ne pas modifier). Après ces corrections (fichiers d'infrastructure et de documentation seulement), `pnpm verifier` n'a pas été relancé en entier. `infra/ci/` ne s'exécute que dans GitHub Actions, à l'arrêt : la boucle de `values.sh` a été rejouée à la main sur `caddy.env.exemple`.
- **PR #67 ouverte** (`lot/x5`, empilée sur #66).
- **`lot/s5` — Facturation et Documents du créancier sur l'API** (agent d'implémentation, puis relecture indépendante). `GET /staff/billing` lit les factures réellement émises par les reversements (500 au plus, statut dérivé, chiffres de l'année et du mois) ; `GET /partner/portal/documents` liste les documents que l'équipe a partagés avec le créancier sur ses dossiers. Il reste 39 routes de l'espace sans API, toutes en attente d'une clé externe sauf Rapports et Équipe.
  - **Initiative** : `POST /staff/billing` **refuse toute création** (409, « La création depuis un modèle n'est pas encore disponible »), pour les factures saisies à la main comme pour les devis et les contrats : la base n'a ni table de devis ou de contrats, ni suivi du règlement d'une facture hors reversement, et une facture numérotée ne se corrige pas. Les boutons de l'écran validé restent affichés, puis répondent par ce message. Questions 195 et 196.
  - **Écarts à l'écran validé de Facturation**, à confirmer : 3 chiffres d'en-tête au lieu de 5 (« Devis en attente » et « Contrats » absents), onglets Devis et Contrats vides, statut « Émise », objet de la facture fait de ses lignes, deux messages nouveaux.
  - **Documents du créancier** : ni relevé, ni rapport mensuel, ni mandat signé (aucun fichier n'existe), et le téléchargement reste désactivé (aucune route ne remet un fichier à un créancier). Questions 197 à 199.
  - `pnpm verifier` relancé par cette session après fusion de `lot/x5` : 95 fichiers, 3 604 tests au vert. Relecture sécurité indépendante : aucun bloquant, aucun important, 4 mineurs ; 3 corrigés (test direct de la garde SQL de `app.billing_overview()` et de `app.credit_notes()`, précision sur le titre des documents montré au créancier, décorateur sans effet). Après correction : vérification complète par l'agent (95 fichiers, 3 605 tests) ; cette session a relancé le fichier de tests corrigé, le lint et les types.
- **PR #68 ouverte** (`lot/s5`, empilée sur #67).
- **`lot/u3` — Rapports et Équipe sur l'API** (agent d'implémentation, interrompu une fois par la limite d'usage puis repris ; relecture indépendante). `GET /staff/reports`, `PUT /staff/reports/scheduled/:id` et `GET /staff/team` : aucun nouvel objet en base, des agrégats lus sous les droits du rôle. Il reste 36 routes de l'espace sans API, toutes en attente d'une clé externe (Resend, MySendingBox, OVH, 3CX).
  - **Initiatives** : rien n'est inventé pour ce que la base ignore. Appels, présence, promesses et durées affichent « — » jusqu'à la téléphonie (« Téléphonie non connectée : statuts, appels et promesses s'afficheront avec 3CX. ») ; les rapports programmés sont absents et leur interrupteur répond 404 (rien ne serait envoyé) ; « Honoraires » est retiré de Rapports (la facturation est réservée au Directeur). Définitions des chiffres de Rapports choisies par défaut : question 200. Questions 200 à 204.
  - **Écarts aux écrans validés**, à confirmer : sous-titres des chiffres de Rapports (un nombre de paiements, de factures ou de dossiers, pas une variation) ; trois issues au lieu de cinq ; sur Équipe, quatre chiffres d'en-tête à « — », carte « Appels passés » masquée, date du jour réelle.
  - Relecture sécurité indépendante : aucune fuite entre rôles ; **un point important** : la page Équipe aurait montré en production deux chiffres codés en dur (« 78 % tenues sur 30 jours », « 4 min 05 ») pendant le chargement et après une erreur. Corrigé (ces valeurs ne viennent plus que de la simulation, tests en chargement et en erreur), avec 4 mineurs : test du portefeuille du Directeur, rôle vérifié avant le calcul, paramètre invalide refusé (422), exception de `rules.test.ts` bornée.
  - `pnpm verifier` relancé par cette session sur l'arbre final : 97 fichiers, 3 644 tests au vert.
  - À voir hors de ce lot : le compteur « gestionnaires en ligne » du menu se fie à la dernière activité (`shell.controller.ts`), alors qu'Équipe dit la présence inconnue sans téléphonie (noté dans la question 204).

# Session du 27/11/2026 : reprise des lots arrêtés (ClamAV, bucket des documents, envois)

Consigne de l'utilisateur : « Continuer le développement sans interruption, fusion si pas d'erreur ». Session `debian-00`. GitHub Actions est toujours à l'arrêt : « pas d'erreur » veut dire `pnpm verifier` relancé en local par cette session, après une relecture sécurité indépendante sans point bloquant.

## État trouvé au démarrage (01:15 UTC)
- `main` à jour (#34 à #69 fusionnées). PR #70 (Hyperping) ouverte. Deux worktrees arrêtées en plein travail depuis 00:24, avec du code non commité : `exploitation` (`lot/x6`) et `envois` (`lot/q3`). L'autre session (« Statut et avancement ») confirme par message qu'elle n'y touche plus ; elle signale deux décisions en attente chez l'utilisateur (GitHub Actions gratuit ou retiré ; pings Hyperping à côté de Gatus) : `.github/workflows` n'est pas modifié.

## Initiatives
| Initiative | Raison |
|---|---|
| PR #70 fusionnée après `pnpm verifier` relancé ici (97 fichiers, 3 644 tests) et lecture du script | Consigne de fusion ; aucun code exécuté par l'application, aucun secret |
| `lot/x6` et `lot/q3` repris à partir des fichiers trouvés sur le disque, un agent par worktree, questions 205 à 209 et 210 à 219 réservées | Travail non commité d'une session arrêtée ; rien n'a été jeté |
| **Bucket des documents laissé éteint en production** (question 205) | Le conteneur de l'API n'a aucune sortie vers Internet : écrire `S3_DOCUMENTS_BUCKET` aujourd'hui ferait échouer chaque dépôt et chaque téléchargement. Ouvrir une sortie à l'API a été refusé (elle deviendrait joignable sans Caddy). Les fichiers restent sur le disque |
| `S3_DOCUMENTS_BUCKET` refusé hors production, quel que soit son nom | Avec un autre nom que `legarec-documents` et deux clés dans le coffre, le développement aurait appelé le vrai OVHcloud |
| Antivirus en deux conteneurs : `clamav` (clamd, sans aucune sortie) et `freshclam` (signatures, seul à sortir) | Relecture sécurité : le conteneur qui lit les fichiers reçus avait tout Internet et restait joignable hors de son réseau |
| Une archive qui dépasse les limites d'analyse est traitée comme infectée (`AlertExceedsMax`) | Sinon ClamAV répond « OK » sans l'avoir lue en entier |

## Avancement
- **PR #70 fusionnée** (surveillance externe Hyperping). Rien n'est créé chez Hyperping : le cabinet lance `infra/hyperping/legarec-hyperping` avec sa clé.
- **`lot/x6` — ClamAV et bucket des documents** : 11 commits. Client du bucket (`@aws-sdk/client-s3`), clés lues chiffrées dans le coffre (`app.storage_keys()`), repli sur le disque, contrôle Gatus sans clé, documentation.
  - Relecture sécurité indépendante : aucun bloquant, 5 importants, 7 mineurs. Corrigés : antivirus (ci-dessus) ; bucket configuré sans ses clés = panne visible, plus « fichier absent » (la purge échoue au lieu de compter 0) ; bucket refusé hors production ; fichier infecté effacé à coup sûr ; un nettoyage ne masque plus l'erreur d'origine.
  - Laissés, inscrits comme conditions de la question 205 : `app.storage_keys()` remet le chiffré des clés aux rôles créancier et débiteur de la base ; l'appel au bucket se fait dans la transaction de la requête (contraire à `.claude/rules/api.md`).
  - `pnpm verifier` relancé par cette session sur l'arbre final fusionné avec `main` : 101 fichiers, 3 711 tests au vert.
  - **Jamais essayé** : Docker (interdit à Claude Code) et la CI, donc ni les deux conteneurs de l'antivirus, ni `infra/ci/smoke.sh` ; aucun appel à un vrai bucket, ni le contrôle Gatus (403 attendu).

- **PR #71 fusionnée** (`lot/x6`).
- **`lot/q3` — relance par e-mail depuis un dossier** : 13 commits. Table `sendings`, plafond de contacts par débiteur tous créanciers confondus (sous verrou), `POST /staff/cases/:id/reminders`, envoi par le worker chez Resend, formulaire du dossier.
  - **Aucun message réel n'est parti et aucun ne peut partir d'ici** : client HTTP simulé dans les tests, envoi simulé sans clé hors production. En production, il faut la clé Resend dans le coffre **et** `RESEND_ENV=production` dans `worker.env` ; sans cette ligne, une clé n'écrit qu'aux adresses de test.
  - Non faits : courriers postaux et MySendingBox, « Rédiger un courrier », envois groupés, scénarios automatiques, SMS (lot R). Tous attendent une règle (questions 210 et 216) ; l'API répond « ce mode d'envoi n'est pas encore disponible ».
  - Relecture sécurité indépendante en deux passes : aucun bloquant. Corrigés : relance qui restait en file pour toujours ; relance en attente qui n'expirait jamais (expire à la fin du jour ouvré suivant) ; relance qui partait sur un dossier en litige, en contentieux ou dont l'échéancier est respecté (refusée, question 218) ; statuts à sens unique imposés par la base ; balayage qui pouvait noter « non envoyée » une relance partie (risque de double envoi avec deux workers).
  - **Écarts à l'écran validé « Relancer »**, à confirmer : « Destinataire » devient une liste des adresses e-mail du dossier ; le champ « Message » disparaît pour un e-mail (le texte validé du modèle part tel quel) ; phrases nouvelles pour un refus ; SMS et courrier recommandé refusés depuis le dossier, simulation comprise ; « Relance envoyée » n'entre dans l'historique qu'au départ réel, alors que le message à l'écran s'affiche dès la mise en file (question 219).
  - `pnpm verifier` relancé par cette session sur l'arbre final fusionné avec `main` : 103 fichiers, 3 780 tests au vert.
  - Jamais essayé : le vrai service Resend ; le formulaire dans un navigateur contre l'API ; `/comparer` sur l'écran modifié.
  - Une base de développement qui avait appliqué la première version de la migration `20261127100000_sendings` (worktree `envois` seulement) doit être recréée.

## À faire par l'utilisateur ou le cabinet
- Question **205**, à trancher avant d'allumer le bucket : comment l'API atteint le bucket. Proposé : l'API reste fermée, écrit sur le disque, le worker copie vers le bucket après l'antivirus, lecture par adresses signées (demande un autre lot).
- Question **206** : Gatus ne voit pas une clé du bucket refusée ou expirée (contrôle sans clé seulement), à confirmer.
- À la mise en service : premier démarrage de `clamav` et `freshclam` à surveiller (`docs/deploiement.md`, « Antivirus ») ; `S3_REGION` obligatoire dans `gatus.env` ; le contrôle « Documents » de Gatus alertera tant que le bucket n'existe pas.
- `freshclam` n'a pas de contrôle de santé : des signatures périmées ne lèvent aucune alerte.
- Questions **210 à 219** (envois) à confirmer, en place par défaut. À trancher pour avancer : **210** (quel texte part par courrier postal : bloque tous les courriers), **216** (scénarios automatiques), **217** (les e-mails de compte restent simulés tant que le domaine d'envoi et sa clé n'existent pas : **bloque les invitations en production**), **218** (une promesse de paiement ne suspend pas les relances), **212** (une mise en demeure par simple e-mail est-elle voulue ; « Relance ferme (niveau 3) » envoie le modèle de niveau 2).
- Plafond des relances : limite de 120 par heure et par collaborateur, valeur choisie par défaut (`docs/api.md`).
- Reste ouvert sur les envois : aucun avis au collaborateur après un échec ou une expiration ; aucun moyen de trancher un envoi « incertain » (panne de Resend), qui compte au plafond.

## Suite du 27/11 : fichiers sans ligne (`lot/x7`)

| Initiative | Raison |
|---|---|
| Lot choisi : nettoyage des fichiers stockés qu'aucune ligne de la base ne référence | Noté « reporté au lot X » dans `PLAN.md` ; ne dépend d'aucune décision ni d'aucune clé. Un dépôt interrompu laissait un fichier, parfois avec des données personnelles, que rien ne purgeait |
| Dans le doute, le nettoyage n'efface pas | Ce code supprime des pièces : chaque garde choisit l'option qui efface le moins |

- **`lot/x7`** : 7 commits. Tâche de nuit à 4 h 30 (une seule fois par nuit), commande `dist/sweep-files.js`, fonction `app.referenced_files()` (migration `20261127210000_referenced_files`), disque et bucket.
  - Règles en place par défaut (questions 230 et 231) : un fichier sans ligne n'est effacé qu'après **7 jours** ; **100 fichiers au plus par nuit** ; **rien n'est effacé** au-delà de 20 fichiers sans ligne, ou si plus de la moitié des fichiers anciens sont sans ligne, ou si la base ne connaît aucun des fichiers anciens (mauvaise base ou base vide).
  - **Après une restauration** : `dist/purge.js` suspend le nettoyage ; la nuit ne fait plus que compter jusqu'à `dist/sweep-files.js --resume`. Un effacement forcé (`--erase <nombre>`, le nombre affiché juste avant) est inscrit dans `retention_runs`.
  - Relecture indépendante en deux passes, centrée sur la perte de données : aucun scénario où un fichier référencé est effacé en marche normale. La première version protégeait mal après une restauration ou sur une mauvaise base ; corrigé, contrôlé par le même relecteur (« fusionnable en l'état »).
  - `pnpm verifier` relancé par cette session : 105 fichiers, 3 811 tests au vert ; l'API se construit avec la nouvelle commande.
  - Jamais essayé : les commandes `dist/sweep-files.js` et `dist/purge.js` elles-mêmes (seules les fonctions qu'elles appellent sont testées), Docker, un vrai bucket.
  - Mineurs laissés : une base restaurée **sans** passer par `dist/purge.js` n'est pas suspendue (20 fichiers au plus peuvent partir) ; toute purge à la demande suspend le nettoyage sans limite de durée et seul le journal du worker le dit ; si les seuls fichiers anciens sont sans ligne (tout début de production), la tâche échoue chaque nuit et il faut les retirer à la main ; la commande propose d'effacer avant de rappeler la suspension.

### À faire par l'utilisateur ou le cabinet
- Question **231, à trancher** : qui est prévenu quand le nettoyage refuse d'effacer ou reste suspendu (aujourd'hui, le journal du worker seulement ; une alerte Gatus ou dans l'application reste à décider). Question **230** (délai de 7 jours, variante 24 heures) à confirmer.
- Une base de développement qui avait appliqué la première version de la migration `20261127210000_referenced_files` (worktree `fichiers-orphelins` seulement) doit être recréée.


## Suite du 27/11 : relances groupées depuis la liste (`lot/q4`)

| Initiative | Raison |
|---|---|
| Lot choisi : le bouton « Relancer » de la liste des débiteurs, par e-mail seulement | Suite directe de `lot/q3` ; l'écran validé existe. Il parle du « scénario » de chaque débiteur, qui n'est décrit nulle part (question 216) : règles par défaut inscrites en question 220 |
| La mise en demeure ne part jamais en lot, et rien ne part en lot après elle | Acte qui engage : il se décide dossier par dossier, sur la fiche |
| L'écran demande d'abord à l'API ce que chaque dossier recevrait ; l'API ne laisse partir que le niveau confirmé | Relecture sécurité, bloquant : deux lots envoyés à une minute d'écart faisaient partir le rappel amiable puis la relance ferme au même débiteur |
| 7 jours au moins entre deux niveaux envoyés en lot | Aucun rythme dans `HANDOFF.md` ni `DECISIONS.md` ; la maquette montre J+7 |
| Un envoi « incertain » ne bloque son dossier que 48 heures, puis compte comme parti | Aucun écran ne permet encore de le trancher : sans borne, le dossier restait bloqué pour toujours ; compté comme parti, il ne provoque pas un second envoi du même niveau |
| Limites : 100 dossiers par lot, 300 dossiers en lot et 120 demandes par heure et par compte | Une page de la liste ; freine un compte détourné sans gêner l'usage normal |
| Avis au collaborateur quand une relance échoue ou expire (type `SENDING_FAILED`, un seul avis par envoi, imposé par la base) | Manque noté après `lot/q3` ; textes de l'avis en question 222 |

- **`lot/q4`** : 9 commits. `POST /staff/cases/reminders/preview` et `POST /staff/cases/reminders`, migration `20261127220000_sending_notices`, journal d'audit `REMINDERS_GROUPED`, liste des débiteurs de l'espace.
  - **Aucun message réel n'est parti** : mêmes garde-fous que `lot/q3` (clé Resend et `RESEND_ENV=production`).
  - **Écarts à l'écran validé**, à confirmer (question 220 ; titre et bouton inchangés) : la phrase de la confirmation, les lignes « Relances » et « Laissés de côté » du récapitulatif, les messages quand rien ne peut partir ou quand l'aperçu échoue, le message final qui compte ce qui est réellement parti et donne les motifs ; les dossiers laissés de côté restent sélectionnés.
  - Relecture sécurité indépendante en trois passes : un bloquant (ci-dessus) et cinq importants corrigés, puis deux remarques corrigées (borne de 48 heures ; un dossier dont la date de mise en demeure est renseignée est laissé de côté).
  - `pnpm verifier` relancé par cette session sur l'arbre final, `main` inclus : 105 fichiers, 3 857 tests au vert. Vérification locale : GitHub Actions est arrêté.
  - Non fait : la relance d'échéance d'un échéancier (question 221) ; aucun SMS (lot R).
  - À savoir : aucun code n'écrit encore `cases.formal_notice_on` ; cette garde ne joue que le jour où un lot renseignera la date.
  - Jamais essayé : le vrai service Resend ; l'écran dans un navigateur contre l'API ; `/comparer` sur la liste modifiée.

### À faire par l'utilisateur ou le cabinet
- Questions **220** (règles et écarts ci-dessus), **221** (relance d'échéance : quel texte, quel déclencheur) et **222** (textes de l'avis d'échec) à confirmer.
- Toujours ouvert : un écran pour trancher un envoi « incertain » (hors maquette, à décider).
