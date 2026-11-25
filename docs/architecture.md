# Architecture

Décisions du 24/11/2026, reprises de l'annexe « Architecture » de `PROMPT-FRONT.md` (v2.5). Complétées le 25/11/2026 pour la mission API (questions 65 à 111 de `DECISIONS.md`) ; détail technique : `docs/api.md`. `PROMPT-FRONT.md` et `DECISIONS.md` priment en cas d'écart, la décision la plus récente d'abord.

- Files d'attente : Valkey + BullMQ (VALKEY_URL) ; workers dans un conteneur séparé de l'API ; Valkey avec persistance
  AOF et maxmemory-policy noeviction. Option notée : le backend PostgreSQL de BullMQ 6, plus récent, non retenu pour l'instant.
- Relances programmées : planning dans PostgreSQL (date prévue, statut) ; un job scheduler BullMQ met en file
  les relances échues toutes les 5 minutes environ, avec un identifiant de job fixe (reminder-<id>) ;
  avant l'envoi, le worker vérifie que la relance est toujours due et qu'elle respecte les plages et les plafonds.
- Plafonds de contact : comptés par débiteur, tous créanciers confondus, sur tous les canaux ; au-delà, blocage, avec
  dérogation motivée du Responsable, ou du Directeur sur ses dossiers (question 74).
- Envois : une file par canal (e-mail Resend, e-mail OVH des collaborateurs, SMS OVH, courrier MySendingBox),
  limiteur de débit par fournisseur (et par boîte OVH : quota MX Plan),
  nouvelles tentatives espacées, flows pour les envois groupés ; clé d'idempotence Resend ;
  aucune nouvelle tentative automatique d'un LRAR au statut incertain : vérification manuelle.
- PDF : file dédiée à faible concurrence, un seul Chromium réutilisé, conteneur à mémoire plafonnée ;
  polices Inter et Lora locales.
- E-mails entrants : synchronisation IMAP par interrogation toutes les 1 à 2 minutes, une seule à la fois par boîte
  (ImapFlow) ; état de synchronisation (UIDVALIDITY, dernier UID) en base ; pièces jointes dans S3 ;
  réponses des collaborateurs par SMTP OVH de leur propre boîte (MX Plan, un mot de passe par boîte, chiffré) ;
  recouvrement@legarec.fr synchronisée en réception seule.
- Boîtes OVH : gestion par l'API OVHcloud (appels signés, sans le paquet ovh, qui date de 2019), clé d'application dédiée
  limitée à /email/domain/legarec.fr/* ; aucune action OVH
  lancée par un worker sans demande d'un utilisateur.
- SMS : OVHcloud ; expéditeur sous forme de numéro (et non le nom « LEGAREC ») pour recevoir les réponses,
  rattachées au dossier par numéro de téléphone ; numéro mobile virtuel d'un compte dédié (question 70).
- Téléphonie : API Call Control de 3CX (question 71) ; enregistrements repris dans S3 et supprimés à 6 mois
  (supprimés de 3CX après copie ; appel sans annonce jamais repris et supprimé dans 3CX : question 117).
- Contrats : schémas Zod de packages/contracts → OpenAPI produit par NestJS 12 (@nestjs/swagger ; nestjs-zod abandonné, question 66) → types des routes générés
  par openapi-typescript, régénérés et vérifiés par pnpm verifier (en local et dans GitHub Actions).
- Montants : centimes entiers ; taux d'intérêt légal dans une table mise à jour chaque semestre.
- Double authentification : otplib (TOTP) et @simplewebauthn/server.
- Sessions : jeton opaque, haché en base, en cookie __Host- propre à chaque portail ; fermeture après 30 minutes
  d'inactivité ; en-tête Origin contrôlé ; Cache-Control: no-store partout.
- Cloisonnement : filtre dans chaque requête et sécurité par ligne PostgreSQL, activée et forcée sur toutes les tables ;
  clé étrangère composite (dossier, créancier) sur toute table liée à un dossier.
- Actions qui engagent : clé d'idempotence et valeur attendue ; refus (409) si l'état a changé depuis la confirmation.
- Appels externes : jamais dans une transaction ; table outbox, puis BullMQ ; les tâches ne portent que des identifiants.
- Secrets : clés des services dans un coffre chiffré en base (Paramètres techniques > Secrets) ; valeurs de démarrage dans
  un fichier du serveur ; .env temporaire en développement (docs/api.md, « Clés et secrets »).
- Antivirus : ClamAV ; tout fichier reçu reste en quarantaine jusqu'au résultat (question 87).
- IA : auto-hébergée si l'essai mesuré du lot W convient, sinon nouveau choix (questions 72 et 106) ; transcription
  après l'appel seulement ; couche fournisseur (interface unique ; adaptateurs Anthropic et compatible OpenAI pour Scaleway et OVH).
  Les deux niveaux de docs/ia.md (IA_MODELE_RAPIDE, IA_MODELE_AVANCE) n'ont pas de valeur par défaut : variable absente =
  IA éteinte ; budget et journal de docs/ia.md conservés, avec le coût de chaque appel ;
  seules les données nécessaires sont envoyées ; IA désactivée en production tant que le contrat de sous-traitance
  n'est pas signé.
- Fichiers des dossiers (Scaleway S3, bucket legarec-documents) : répertoires en français, sans accents ni espaces :
  dossiers/{id}/pieces/, dossiers/{id}/courriers/, dossiers/{id}/accuses-reception/, dossiers/{id}/quittances/,
  dossiers/{id}/emails/, dossiers/{id}/enregistrements/ (question 104), imports/. Noms de fichiers : identifiants générés, nom d'origine conservé en base.
- Sauvegardes : pgBackRest 2.59.3 minimum (projet maintenu, relancé en mai 2026 après l'annonce d'avril),
  chiffrement activé, dépôt dans un bucket séparé (legarec-sauvegardes) avec ses propres clés et le versioning activé ;
  restauration testée automatiquement et régulièrement dans un conteneur temporaire.
- Surveillance : Gatus surveille aussi les sauvegardes et les tests de restauration.
- Proxy inverse : Caddy, seul service exposé sur Internet (ports 80 et 443), dans le docker compose de production ;
  un Caddyfile versionné dans le dépôt (infra/caddy/Caddyfile), validé par caddy validate dans pnpm verifier.
  - HTTPS automatique (Let's Encrypt), HTTP redirigé vers HTTPS, HSTS ; en-têtes de sécurité par portail
    (CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) ; compression ; journaux d'accès JSON
    sans données personnelles ni paramètres de requête.
  - Routage : espace, partenaires et paiement vers leurs fichiers statiques (repli sur index.html pour les routes
    du front) ; api.legarec.fr vers l'API ; n8n.legarec.fr et status.legarec.fr vers leurs conteneurs,
    n8n restreint (adresses IP autorisées ou authentification devant).
  - status.legarec.fr : proxy inverse vers le conteneur Gatus (reverse_proxy gatus:8080), page publique
    limitée aux services utiles aux utilisateurs (portails, API) ; les contrôles internes (sauvegardes, restauration,
    files, base) restent visibles seulement depuis les adresses IP autorisées ou derrière authentification.
  - Redirections, une par ligne dans le Caddyfile avec un commentaire, sans transmettre de paramètre ni de donnée
    personnelle :
    - http → https sur tous les sous-domaines (automatique) ;
    - www.espace, www.partenaires, www.paiement → même adresse sans www (301) ;
    - mail.legarec.fr (page web) → legarec.fr (301) ; media.legarec.fr/ et api.legarec.fr/ (racine seule)
      → legarec.fr et status.legarec.fr (302).
    - legarec.fr et www.legarec.fr ne passent pas par Caddy : aucune redirection pour eux.
  - La redirection d'un compte connecté vers le bon portail reste faite par l'application, pas par Caddy.
  - Les conteneurs internes (API, PostgreSQL, Valkey, workers) ne publient aucun port sur l'hôte.
  - Caddy de développement séparé, avec certificats locaux ; Claude Code ne touche jamais au Caddy de production.
- Journaux : JSON (pino), centralisés dans Loki et consultés dans Grafana ; données personnelles et bancaires masquées.
- n8n passe par l'API avec un compte de service aux droits limités, jamais directement par PostgreSQL.
- Mises à jour : versions exactes figées ; Renovate (application GitHub) propose les mises à jour regroupées,
  vérifiées par pnpm verifier dans GitHub Actions avant fusion.
- Fichiers publics : bucket legarec-media (media.legarec.fr), chemins versionnés, jamais de remplacement ;
  documents des dossiers dans legarec-documents (privé), sauvegardes dans legarec-sauvegardes : une clé d'accès par bucket.
- Claude Code : environnement de développement séparé, données fictives, aucun accès aux secrets ni à la production ;
  utilisateur système dédié, sans accès aux fichiers de production ni au groupe docker de la production ;
  déploiement uniquement par pnpm deployer, lancé par moi.
