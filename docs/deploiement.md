# Déploiement

Première partie du lot X. Fichiers préparés par Claude Code, vérifiés par GitHub Actions, **lancés par le cabinet seul** (question 82). Aucune valeur secrète n'est dans ce dépôt. En cas d'écart, `DECISIONS.md` l'emporte.

> **Ne pas mettre en service maintenant.** Les portails construits appellent l'API, qui n'a encore aucune route métier. Voir « Reste à faire », en fin de fichier.

## Vue d'ensemble

| Conteneur | Rôle | Compte | Mémoire | Accès à Internet |
|---|---|---|---|---|
| `caddy` | Seul exposé (80, 443) : HTTPS, en-têtes, routage | 10110 | 192 Mo | oui |
| `espace`, `partenaires`, `paiement` | Fichiers des portails | 10103 | 3 × 48 Mo | non |
| `api` | API | 10101 | 768 Mo | non |
| `worker` | Tâches (même image que l’API), PDF par Chromium, arrêt en 90 s au plus | 10102 | 1 Go | oui |
| `migration` | Une exécution par déploiement | 10104 | 256 Mo | non |
| `postgres` | Base, envoi continu du journal aux sauvegardes | 999 | 1,5 Go | oui (bucket) |
| `sauvegarde`, `essai-restauration` | Une exécution par minuterie | 999 | 384 et 512 Mo | oui (bucket) |
| `restauration` | À la main, base arrêtée | 999 | 384 Mo | oui (bucket) |
| `valkey` | Files d'attente | 10115 | 512 Mo | non |
| `gatus` | Page d'état publique | 10111 | 96 Mo | non |
| `gatus-interne` | Contrôles internes et alertes | 10111 | 96 Mo | oui (alertes) |
| `journaux`, `loki`, `grafana` | Journaux techniques, 60 jours | 10113, 10001, 10114 | 96, 384 et 320 Mo | non |

Conteneurs permanents : 4,9 Go au plus. Réserver 2,5 Go pour ClamAV et n8n, à venir. Aucun conteneur ne tourne en root, ni sous le compte 1000 (premier compte du serveur). Systèmes de fichiers en lecture seule, aucun droit Linux, réseaux séparés et fermés au serveur lui-même : un portail ne joint pas la base, n8n ne joindra que l'API, et un autre compte du serveur ne joint ni l'API, ni Loki, ni la base.

| Fichiers | Contenu |
|---|---|
| `docker-compose.yml`, `infra/docker/` | Conteneurs et images |
| `infra/caddy/` | Proxy et serveur des portails |
| `infra/postgres/`, `infra/valkey/` | Base, sauvegardes, files |
| `infra/gatus/`, `infra/loki/`, `infra/grafana/` | Surveillance et journaux |
| `infra/systemd/` | Minuteries des sauvegardes, de leur vérification et de l'essai de restauration |
| `infra/valeurs/` | Modèles des fichiers de `/etc/legarec/` (noms seulement) |
| `infra/deployer.sh` | Déploiement, lancé par le cabinet |
| `infra/ci/`, `.github/workflows/images.yml` | Essai complet dans GitHub Actions, sans secret ni publication |

## À préparer

### Serveur
- [ ] VPS réservé à Legarec (décision du cabinet) : rien d'autre dessus, ni développement, ni Claude Code ; 8 Go de mémoire au moins. Ports 80 et 443 libres.
- [ ] Docker 28 ou plus récent, Compose 2.30 ou plus récent ; 40 Go de disque libres.
- [ ] Aucun projet Compose nommé `legarec-app` (`docker compose ls`) ni réseau 10.213.0.0/24 sur ce serveur.
- [ ] Comptes libres : `getent passwd 10001 10101 10102 10103 10104 10110 10111 10113 10114 10115` et `getent group 10120` ne répondent rien ; 999 (PostgreSQL) n'est celui d'aucune personne.
- [ ] Connexion SSH par clé, réservée au cabinet ; aucun compte de ce serveur utilisé pour le développement.
- [ ] Pare-feu : 80/tcp, 443/tcp, 443/udp ouverts ; rien d'autre pour Legarec. Refuser aux réseaux de Docker l'accès aux autres services du serveur.
- [ ] Dépôt cloné dans `/opt/legarec`, propriété de root, hors de portée de Claude Code : `git clone`, branche `main`. Clé de déploiement GitHub en lecture seule.
- [ ] Disque rempli à moins de 90 % : au-delà, Loki n'enregistre plus les journaux (alerte « Collecte »).
- [ ] Horloge synchronisée (double authentification, certificats).

### DNS (enregistrements A, et AAAA si le serveur a une adresse IPv6)
- [ ] `espace`, `partenaires`, `paiement`, `api`, `status`, `n8n`, `media`, `mail` et `www.espace`, `www.partenaires`, `www.paiement`. Pour `mail`, ne pas toucher aux enregistrements MX, SPF et DKIM de Resend.
- `legarec.fr` et `www.legarec.fr` restent chez leur hébergeur.

### OVHcloud Object Storage (région Paris `eu-west-par`)
Décision du 26/11/2026, au lieu de Scaleway. Adresse du service : `s3.eu-west-par.io.cloud.ovh.net` (déjà écrite dans les modèles de `infra/valeurs/`, avec la région). Sauvegardes chez le même fournisseur que le serveur, sans seconde copie : risque accepté par le cabinet (question 167).
- [ ] Bucket `legarec-sauvegardes`, privé, versions activées, **clé propre à ce bucket**. Politique du bucket : cette clé ne peut ni effacer une version, ni couper les versions, ni changer le cycle de vie ; seconde clé, en lecture seule, pour l'essai de restauration.
- [ ] Règle de cycle de vie : versions remplacées ou supprimées effacées après 7 jours.
- [ ] Bucket `legarec-media`, public en lecture, liste du contenu désactivée, logos déposés.
- [ ] Bucket `legarec-enregistrements` (lot T), privé, liste du contenu désactivée, versions activées (question 165), règles de cycle de vie : versions remplacées ou supprimées effacées après 7 jours, suppression après 190 jours ; **clé propre à ce bucket**, qui ne peut ni effacer une version ni changer les règles.

### Resend
- [ ] Clé dédiée aux alertes, droit d'envoi seulement, domaine `mail.legarec.fr`.

## Valeurs à fournir

Un fichier par conteneur dans `/etc/legarec/`, d'après `infra/valeurs/*.exemple`. Valeurs saisies par le cabinet, en SSH, hors de Claude Code ; copie dans le gestionnaire de mots de passe, **jamais avec les sauvegardes**.

| Fichier | Groupe | Valeurs |
|---|---|---|
| `caddy.env` | 10110 | `ACME_EMAIL`, `AUTHORIZED_IPS` (adresses du cabinet, séparées par une espace), `S3_REGION` (`eu-west-par`, déjà écrite) |
| `api.env` | 10101 | `DATABASE_URL`, `VALKEY_URL`, `VAULT_MASTER_KEY`, `SESSION_SIGNING_KEY`, adresses des portails, `MYSENDINGBOX_ENV` |
| `worker.env` | 10102 | `JOBS_DATABASE_URL`, les mêmes `VALKEY_URL`, `VAULT_MASTER_KEY` et `SESSION_SIGNING_KEY`, `GATUS_PUSH_URL`, `GATUS_PUSH_TOKEN` |
| `migration.env` | 10104 | `MIGRATION_DATABASE_URL` |
| `postgres.env` | 999 | `POSTGRES_PASSWORD`, `LEGAREC_OWNER_PASSWORD`, `LEGAREC_APP_PASSWORD`, `LEGAREC_JOBS_PASSWORD` |
| `pgbackrest.env` | 999 | `PGBACKREST_REPO1_S3_REGION`, `PGBACKREST_REPO1_S3_ENDPOINT`, `PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`, `GATUS_PUSH_TOKEN` |
| `restauration.env` | 999 | Les mêmes noms que `pgbackrest.env`, avec la clé en lecture seule |
| `valkey.env` | 10115 | `VALKEY_PASSWORD` |
| `gatus.env` | 10111 | `GATUS_ALERT_KEY`, `GATUS_ALERT_TO`, `GATUS_WORKER_TOKEN`, `GATUS_BACKUP_TOKEN`, `GATUS_RESTORE_TOKEN` |
| `grafana.env` | 10114 | `GF_SECURITY_ADMIN_PASSWORD`, `GF_SECURITY_SECRET_KEY` |

Dossiers et droits :

```bash
sudo install -d -m 700 /etc/legarec
```

```bash
sudo install -d -o 10113 -g 10113 -m 700 /var/lib/legarec/journaux
```

Pour chaque fichier (exemple : `api`, groupe 10101) :

```bash
sudo install -o root -g 10101 -m 640 /opt/legarec/infra/valeurs/api.env.exemple /etc/legarec/api.env
```

- Mots de passe et jetons : `openssl rand -hex 32`, sauf `VAULT_MASTER_KEY` et `SESSION_SIGNING_KEY` : `openssl rand -base64 32`.
- Trois mots de passe PostgreSQL différents, repris dans les adresses : `postgresql://legarec_app:…@postgres:5432/legarec` (API), `legarec_jobs` (worker), `legarec_owner` (migrations). Valkey : `redis://:…@valkey:6379/0`.
- Jetons de surveillance : trois différents dans `gatus.env`, chacun repris sous le nom `GATUS_PUSH_TOKEN` dans `worker.env`, `pgbackrest.env` ou `restauration.env`.
- Une valeur vide ou encore entre crochets arrête le déploiement.
- Raccourci utilisé plus bas, à taper une fois par session :

  ```bash
  legarec() { sudo docker compose --project-directory /opt/legarec --file /opt/legarec/docker-compose.yml --env-file /etc/legarec/version.env "$@"; }
  ```

- Après modification d'un fichier, recréer son conteneur : `legarec up -d --force-recreate <conteneur>`.
- Nouveau mot de passe d'un compte PostgreSQL : modifier `postgres.env`, recréer `postgres`, lancer `legarec exec postgres legarec-roles`, puis modifier l'adresse dans le fichier du programme et le recréer.
- `VAULT_MASTER_KEY` et `PGBACKREST_REPO1_CIPHER_PASS` perdues : coffre ou sauvegardes illisibles, définitivement.

## Ordre de mise en service

1. Serveur, DNS, OVHcloud Object Storage, Resend, fichiers de `/etc/legarec/` (ci-dessus).
2. Dans `/opt/legarec`, à jour sur `main`, déploiement. Le script refuse une copie que root ne possède pas ou une version absente de `main`, contrôle les fichiers, construit les images, démarre la base, **sauvegarde**, applique les migrations, puis démarre le reste.

   ```bash
   sudo /opt/legarec/infra/deployer.sh
   ```

3. Première sauvegarde complète, puis essai de restauration.

   ```bash
   legarec run --rm sauvegarde full
   ```

   ```bash
   legarec run --rm essai-restauration
   ```

4. Minuteries : copier `infra/systemd/*` dans `/etc/systemd/system/`, puis les activer.

   ```bash
   sudo systemctl enable --now legarec-sauvegarde.timer legarec-sauvegarde-complete.timer legarec-verification-sauvegardes.timer legarec-essai-restauration.timer
   ```

5. Premier Directeur, une seule fois. Le lien s'affiche une fois dans le terminal ; toujours `exec`, jamais `run`. Ajouter à la fin l'adresse, le prénom et le nom.

   ```bash
   legarec exec worker node --env-file=/run/secrets/worker dist/account.js director
   ```

6. Clé Resend, puis les autres clés, dans Paramètres techniques > Secrets.
7. Invitations des collaborateurs, puis des créanciers.

Déploiements suivants : `sudo git -C /opt/legarec checkout main`, `sudo git -C /opt/legarec pull --ff-only`, puis l'étape 2. Pendant les migrations, l'ancienne version répond encore : une migration doit rester compatible avec elle.

Retour en arrière : `sudo git -C /opt/legarec checkout <version précédente>`, puis l'étape 2. Si une migration a été appliquée entre-temps, elle refuse de continuer : restaurer la sauvegarde faite juste avant, ou corriger par une nouvelle version. Ne jamais lancer `docker compose down --volumes`.

### Restaurer la base
À faire à deux, `legarec` étant le raccourci ci-dessus. GitHub Actions rejoue les étapes 3 à 6 à chaque changement, pour le dernier état ; la restauration à un instant précis n'est pas encore essayée automatiquement.
1. Arrêter les minuteries, l'accès et les programmes. Attendre la fin d'une sauvegarde déjà lancée : `sudo docker ps --filter name=sauvegarde` ne liste rien.

   ```bash
   sudo systemctl stop 'legarec-*.timer'
   ```

   ```bash
   legarec stop caddy api worker postgres
   ```

2. Garder l'état actuel. C'est une copie en clair de toute la base : dossier lisible par root seul, à effacer (`sudo rm -r /root/legarec-avant`) dès la restauration vérifiée.

   ```bash
   sudo install -d -m 700 /root/legarec-avant
   ```

   ```bash
   sudo cp -a "$(sudo docker volume inspect --format '{{.Mountpoint}}' legarec-app_postgres-data)" /root/legarec-avant/
   ```

3. Restaurer le dernier état. Pour un instant précis, ajouter l'heure à la fin : `legarec run --rm restauration "2026-12-01 09:00:00+01"`.

   ```bash
   legarec run --rm restauration
   ```

4. Démarrer la base seule.

   ```bash
   legarec up -d --wait postgres
   ```

5. Bloquer les tâches en file, celles prévues plus tard comprises : un courrier, un SMS ou un e-mail peut être parti après l'instant restauré. Elles deviennent « incertaines » ; une personne vérifie chez le fournisseur, dans les 60 jours.

   ```bash
   legarec exec postgres legarec-hold-tasks
   ```

6. Rejouer la purge avant d'ouvrir l'accès (des données effacées sont revenues). Elle affiche le nombre de lignes retirées par type ; si elle dit « Purge incomplète », la relancer avant d'aller plus loin. Puis tout démarrer.

   ```bash
   legarec run --rm --no-deps worker node --env-file=/run/secrets/worker dist/purge.js
   ```

   ```bash
   legarec up -d --wait
   ```

   ```bash
   sudo systemctl start legarec-sauvegarde.timer legarec-sauvegarde-complete.timer legarec-verification-sauvegardes.timer legarec-essai-restauration.timer
   ```

Répétition à blanc : seulement par `legarec run --rm essai-restauration`, jamais sur une autre machine avec `pgbackrest.env`, qui écrirait dans les sauvegardes de production.

## Liste de recette

Après le premier déploiement, puis après chaque changement de ces fichiers.

**Accès**
- [ ] Les trois portails s'ouvrent en HTTPS, cadenas valide, aucune erreur dans la console du navigateur.
- [ ] `http://` et `www.` mènent à l'adresse en `https://` sans `www`.
- [ ] `https://api.legarec.fr/health` répond ; `https://api.legarec.fr/service/x` répond 404.
- [ ] Depuis un téléphone hors du Wi-Fi du cabinet : `n8n.legarec.fr` et `status.legarec.fr/journaux` répondent 403 ; `status.legarec.fr` ne montre que les portails et l'API.
- [ ] Depuis le cabinet : `status.legarec.fr` montre aussi sauvegardes, worker et journaux ; `status.legarec.fr/journaux` demande un mot de passe.
- [ ] En IPv4 et en IPv6 : deux appareils de réseaux différents sont vus avec deux adresses différentes (journal d'audit).

**Sauvegardes**
- [ ] `sauvegarde` et `essai-restauration` en vert dans les contrôles internes ; prochains passages : `systemctl list-timers 'legarec-*'`.
- [ ] Dans le bucket : fichiers présents et illisibles (chiffrés), versions activées, règle de cycle de vie en place.
- [ ] Restauration complète faite une fois, avant les premiers dossiers.

**Surveillance**
- [ ] `legarec stop worker` : alerte reçue en moins de 10 minutes ; `legarec start worker` : message de rétablissement.
- [ ] Journaux visibles dans Grafana ; chercher un nom, un e-mail, une référence et un lien de courrier connus : aucun résultat.

**Serveur**
- [ ] `legarec ps` : tous en marche ; seul `caddy` publie des ports.
- [ ] `docker inspect` d'un conteneur : aucune valeur de `/etc/legarec/`.
- [ ] Redémarrage du serveur : tout revient seul.
- [ ] Depuis un compte sans `sudo` : `/etc/legarec` illisible.

## Conservation

| Données | Durée | Où |
|---|---|---|
| Sauvegardes | 56 jours restaurables (la complète hebdomadaire la plus ancienne reste jusqu'à 7 jours de plus) | `infra/postgres/pgbackrest.conf` |
| Versions du bucket effacées ou remplacées | 7 jours de plus, soit 70 jours au plus pour une donnée effacée | Règle du bucket |
| Journaux techniques | 60 jours | `infra/loki/loki.yaml` |
| Copie locale de Docker (`docker compose logs`) | 2 Mo par conteneur, effacée à chaque déploiement | `docker-compose.yml` |

Journaux : ni adresse IP, ni chemin, ni en-tête dans ceux de Caddy ; ni requête, ni valeur dans ceux de PostgreSQL ; ceux de l'API et du worker sont déjà limités (`docs/api.md`).

## Choix faits, à connaître
- **Valeurs lues dans un fichier monté**, jamais dans l'environnement du conteneur : `docker inspect` ne montre rien. `pgbackrest.env` est monté dans deux conteneurs, seule exception : c'est PostgreSQL qui envoie son journal.
- **Contrôles internes** : un compte du serveur peut lire leurs noms et leur état (réseau de sortie des alertes) ; écrire demande un jeton.
- **Deux Gatus** : Gatus ne sait pas cacher un contrôle à certains visiteurs. Caddy montre l'un ou l'autre selon l'adresse IP.
- **Grafana** : `status.legarec.fr/journaux`, depuis les adresses du cabinet (aucun nouveau domaine).
- **Journaux** : Docker les remet à un collecteur par un fichier de communication propre à Legarec ; ni accès à Docker, ni lecture des autres conteneurs du serveur.
- **Images construites sur le serveur**, rien n'est publié. Chaque version porte le numéro du commit.
- **Bucket injoignable** : le journal de PostgreSQL attend sur le disque, 8 Go au plus (près de 2 jours à plein débit), puis il est abandonné plutôt que de remplir le disque ; l'alerte arrive avant (26 heures sans sauvegarde).
- **PostgreSQL** n'écrit plus ses lignes ERROR, qui citent souvent des données ; l'API note leur code.

## Documents et PDF (lot N)
- **Dossier des documents** : `/var/lib/legarec/documents`, propriétaire 10101, groupe 10120, droits 2770 (à créer avant le premier déploiement ; `deployer.sh` le vérifie). L'API et le worker y écrivent et y lisent par ce groupe commun ; aucun autre conteneur ne le voit. Monté sur `/documents` (`DOCUMENTS_DIR`). À sauvegarder avec la base (copie quotidienne du dossier) tant que le bucket n'existe pas.
- **Chromium** : paquet Debian de l'image (`CHROMIUM_PATH=/usr/bin/chromium`), utilisé par le worker seul, sans son bac à sable (le conteneur en tient lieu, la page n'exécute aucun script et ne charge rien). Worker : 1 Go de mémoire, 400 processus, `/tmp` de 256 Mo.

## Reste à faire (fin du lot X)

### Avant la mise en service : écrans encore sans API
Une page construite pour la production n'a aucune simulation : elle appelle l'API. État au 26/11/2026, après `lot/s5` (comparaison des routes simulées et de `packages/contracts/openapi.json`) :

| Portail | Routes appelées | Sur l'API | Manquent |
|---|---|---|---|
| `paiement` | 13 | 13 | — |
| `partenaires` | 19 | 19 | — |
| `espace` | 167 | 128 | 39, ci-dessous |

| Écran de l'espace | Ce qui manque | Attend |
|---|---|---|
| Rapports, Équipe | `GET /reports`, `PUT /reports/scheduled/:id`, `GET /team` | Rien pour les rapports ; présence et appels de l'équipe avec le lot T |
| Relances envoyées depuis un dossier, un échéancier ou la liste ; envoi et composition d'un document ; essai d'un modèle | 8 routes | Clés de test Resend et MySendingBox (lot Q) |
| Messagerie (e-mails, SMS), boîtes OVH dans Paramètres | 21 routes | Compte SMS et boîtes OVH (lot R) |
| Appels | 7 routes | Licence et identifiants 3CX (lot T) |

Sur l'API depuis `lot/s5`, mais incomplets faute de décision : Facturation liste les factures de commission, ses onglets « Devis » et « Contrats » sont vides et « + Créer depuis un modèle » répond que la création n'est pas encore disponible (questions 195 et 196) ; les Documents du créancier listent ce que l'équipe lui a partagé, sans relevé, rapport ni téléchargement (questions 197 à 199).

Tant qu'une route manque, son écran affiche son état d'erreur (« Réessayer ») : rien ne se perd, mais l'écran ne sert pas. **À décider par le cabinet (question 194)** : attendre tous les lots, ou mettre en service avec les écrans prêts et masquer les autres.

### Le reste
- **Stockage chez OVHcloud** : fait pour Caddy (`media.legarec.fr`), pgBackRest et les noms des clés (`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_DOCUMENTS_BUCKET`). pgBackRest reste en adresses « chemin » (`repo1-s3-uri-style=path`), qu'OVHcloud accepte ; **jamais essayé contre un vrai bucket** : le premier `legarec run --rm sauvegarde full` de la mise en service le dira, avant toute donnée. Le bucket `legarec-documents` n'est pas encore branché (ci-dessous).
- ClamAV : conteneur à ajouter (1,5 à 2 Go de mémoire, image désignée par son empreinte), joint par le worker seul (`CLAMAV_URL=tcp://clamav:3310`) ; d'ici là, les fichiers reçus attendent sans être lus (rien ne se perd). Le bucket `legarec-documents` remplacera ensuite le dossier des documents.
- Chemin des modèles d'e-mails et de PDF : vérifié. Le worker les lit dans `templates/`, à côté de `dist/` (`apps/api/src/worker.ts`), et l'image copie ce dossier ; `TEMPLATES_DIR` de `renderer.ts` ne sert qu'aux tests.
- n8n : avec les comptes de service ; conteneur et valeurs (`N8N_ENCRYPTION_KEY`) à ajouter, sur un réseau partagé avec l'API seule. Sa route existe déjà dans Caddy, réservée aux adresses du cabinet : elle répond 502 d'ici là.
- Gatus : contrôle du bucket des documents (lot N).
- Purge à la demande après une restauration : faite (`dist/purge.js`, étape 6 de « Restaurer la base »).
- **Condition de mise en service** : `legarec-hold-tasks` ne bloque que les tâches en file (`outbox`). Chaque lot qui ajoute un planning dans PostgreSQL (relances, envois groupés, notifications) l'étend à ses tables, avec un test : sinon une relance déjà partie redeviendrait due. L'agenda des relances (`planned_reminders`, lot Q) n'envoie encore rien de lui-même : à étendre avec l'envoi automatique.
- `pgbackrest verify` chaque semaine : fait (minuterie `legarec-verification-sauvegardes`, dimanche 6 h, surveillée par Gatus). Reste l'essai automatique d'une restauration à un instant précis.
- Versions du bucket `legarec-documents` : 70 jours (question 115), à revoir au lot N.
- Contrôle de plusieurs copies de l'API : non prévu, une seule à la fois.
