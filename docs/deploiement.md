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
| `clamav` | Antivirus des fichiers reçus (clamd), joint par le worker seul | 10116 | 2 Go | non |
| `freshclam` | Mise à jour des signatures de l'antivirus (même image) | 10116 | 384 Mo | oui (signatures) |
| `gatus` | Page d'état publique | 10111 | 96 Mo | non |
| `gatus-interne` | Contrôles internes et alertes | 10111 | 96 Mo | oui (alertes, contrôle du bucket des documents) |
| `journaux`, `loki`, `grafana` | Journaux techniques, 60 jours | 10113, 10001, 10114 | 96, 384 et 320 Mo | non |

Conteneurs permanents : 7,3 Go au plus, dont 2,4 Go pour ClamAV. Réserver 0,5 Go pour n8n, à venir. Aucun conteneur ne tourne en root, ni sous le compte 1000 (premier compte du serveur). Systèmes de fichiers en lecture seule, aucun droit Linux, réseaux séparés et fermés au serveur lui-même : un portail ne joint pas la base, n8n ne joindra que l'API, et un autre compte du serveur ne joint ni l'API, ni Loki, ni la base.

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
- [ ] Comptes libres : `getent passwd 10001 10101 10102 10103 10104 10110 10111 10113 10114 10115 10116` et `getent group 10120` ne répondent rien ; 999 (PostgreSQL) n'est celui d'aucune personne.
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
- [ ] Bucket `legarec-documents`, privé, multi-zones (décision du 26/11/2026), liste du contenu fermée au public, versions activées, règle de cycle de vie : versions remplacées ou supprimées effacées après 70 jours (question 115). Avec les versions, une suppression par l'application (purge, fichier infecté, fichier sans ligne) ne pose qu'un marqueur : l'objet ne disparaît vraiment qu'à l'échéance de cette règle, qui doit donc être en place avant le premier dépôt. **Clé propre à ce bucket** : lire, écrire et supprimer un objet, et lister le bucket (sans ce dernier droit, S3 répond « refusé » au lieu de « absent » pour un fichier qui n'y est pas, et l'application ne lirait plus les fichiers restés sur le disque). À créer dès maintenant, même vide : Gatus le surveille (« Bucket des documents », plus bas).
- [ ] Bucket `legarec-media`, public en lecture, liste du contenu désactivée, logos déposés.
- [ ] Bucket `legarec-enregistrements` (lot T), privé, liste du contenu désactivée, versions activées (question 165), règles de cycle de vie : versions remplacées ou supprimées effacées après 7 jours, suppression après 190 jours ; **clé propre à ce bucket**, qui ne peut ni effacer une version ni changer les règles.

### Resend
- [ ] Clé dédiée aux alertes, droit d'envoi seulement, domaine `mail.legarec.fr`.

## Valeurs à fournir

Un fichier par conteneur dans `/etc/legarec/`, d'après `infra/valeurs/*.exemple`. Valeurs saisies par le cabinet, en SSH, hors de Claude Code ; copie dans le gestionnaire de mots de passe, **jamais avec les sauvegardes**.

| Fichier | Groupe | Valeurs |
|---|---|---|
| `caddy.env` | 10110 | `ACME_EMAIL`, `AUTHORIZED_IPS` (adresses du cabinet, séparées par une espace), `S3_REGION` (`eu-west-par`, déjà écrite) |
| `api.env` | 10101 | `DATABASE_URL`, `VALKEY_URL`, `VAULT_MASTER_KEY`, `SESSION_SIGNING_KEY`, adresses des portails, `MYSENDINGBOX_ENV` ; plus tard `S3_DOCUMENTS_BUCKET` et `S3_REGION` (« Bucket des documents ») |
| `worker.env` | 10102 | `JOBS_DATABASE_URL`, les mêmes `VALKEY_URL`, `VAULT_MASTER_KEY` et `SESSION_SIGNING_KEY`, `GATUS_PUSH_URL`, `GATUS_PUSH_TOKEN`, `RESEND_ENV` (`test` par défaut : les relances ne partent que vers les adresses d'essai `@resend.dev` ; `production` à la mise en service, pour écrire aux débiteurs) ; plus tard les mêmes `S3_DOCUMENTS_BUCKET` et `S3_REGION` que `api.env` |
| `migration.env` | 10104 | `MIGRATION_DATABASE_URL` |
| `postgres.env` | 999 | `POSTGRES_PASSWORD`, `LEGAREC_OWNER_PASSWORD`, `LEGAREC_APP_PASSWORD`, `LEGAREC_JOBS_PASSWORD` |
| `pgbackrest.env` | 999 | `PGBACKREST_REPO1_S3_REGION`, `PGBACKREST_REPO1_S3_ENDPOINT`, `PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`, `GATUS_PUSH_TOKEN` |
| `restauration.env` | 999 | Les mêmes noms que `pgbackrest.env`, avec la clé en lecture seule |
| `valkey.env` | 10115 | `VALKEY_PASSWORD` |
| `gatus.env` | 10111 | `GATUS_ALERT_KEY`, `GATUS_ALERT_TO`, `GATUS_WORKER_TOKEN`, `GATUS_BACKUP_TOKEN`, `GATUS_RESTORE_TOKEN`, `S3_REGION` (`eu-west-par`, déjà écrite) |
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
- `gatus.env` : la ligne `S3_REGION=eu-west-par` est obligatoire depuis le contrôle du bucket des documents ; un fichier créé avant ce contrôle doit la recevoir, sinon `gatus-interne` ne démarre pas (« Missing value: S3_REGION ») et le déploiement s'arrête.
- Raccourci utilisé plus bas, à taper une fois par session :

  ```bash
  legarec() { sudo docker compose --project-directory /opt/legarec --file /opt/legarec/docker-compose.yml --env-file /etc/legarec/version.env "$@"; }
  ```

- Après modification d'un fichier, recréer son conteneur : `legarec up -d --force-recreate <conteneur>`.
- Nouveau mot de passe d'un compte PostgreSQL : modifier `postgres.env`, recréer `postgres`, lancer `legarec exec postgres legarec-roles`, puis modifier l'adresse dans le fichier du programme et le recréer.
- `VAULT_MASTER_KEY` et `PGBACKREST_REPO1_CIPHER_PASS` perdues : coffre ou sauvegardes illisibles, définitivement.

## Ordre de mise en service

1. Serveur, DNS, OVHcloud Object Storage, Resend, fichiers de `/etc/legarec/` (ci-dessus).
2. Dans `/opt/legarec`, à jour sur `main`, déploiement. Le script refuse une copie que root ne possède pas ou une version absente de `main`, contrôle les fichiers, construit les images, démarre la base, **sauvegarde**, met à jour les rôles de la base (`legarec-roles`, sans effet s'ils existent déjà), applique les migrations, puis démarre le reste.

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

6. Rejouer la purge avant d'ouvrir l'accès (des données effacées sont revenues). Elle affiche le nombre de lignes retirées par type ; si elle dit « Purge incomplète », la relancer avant d'aller plus loin. Elle commence par **suspendre l'effacement des fichiers sans ligne** (les fichiers reçus après l'instant restauré n'ont plus de ligne) et finit par dire combien il y en a, sans en effacer aucun. La suspension dure jusqu'à ce qu'une personne la lève : voir « Fichiers sans ligne », après une restauration. Si le bucket des documents est configuré et que ses clés ont été saisies après l'instant restauré, elles ne sont plus dans le coffre : la purge dit « Purge incomplète » dès qu'un document purgé a un fichier à effacer, la ligne des fichiers sans ligne dit « non comptés », et la tâche de la nuit échoue (`NoKeys`) sans rien effacer, jusqu'à ce que les deux clés soient saisies de nouveau dans Paramètres techniques > Secrets. Puis tout démarrer.

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
- [ ] Contrôle « Documents » en vert dans les contrôles internes (le bucket `legarec-documents` répond 403 à un inconnu). En rouge : bucket pas encore créé, autre région, ou réponse d'OVHcloud différente de celle attendue (jamais essayé, « Bucket des documents »).
- [ ] Journaux visibles dans Grafana ; chercher un nom, un e-mail, une référence et un lien de courrier connus : aucun résultat.

**Serveur**
- [ ] `legarec ps` : tous en marche ; seul `caddy` publie des ports.
- [ ] Antivirus : un PDF sain déposé dans Documents devient lisible en moins d'une minute ; le fichier d'essai EICAR (eicar.org) renommé en `.pdf` est refusé ou affiché « Bloqué par l’antivirus », jamais lisible.
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

## Surveillance externe (Hyperping)

Gatus tourne sur le serveur qu'il surveille : si le serveur, son réseau ou Caddy tombe, Gatus tombe avec lui. Hyperping (app.hyperping.io) regarde les mêmes adresses publiques depuis l'extérieur (Paris, Francfort, Londres, Amsterdam), toutes les 5 minutes, avec l'échéance des certificats (alerte 15 jours avant).

- Moniteurs : `infra/hyperping/moniteurs.json` (espace, partenaires, paiement, `api.legarec.fr/health` avec `"status":"ok"`, page d'état). Ni donnée personnelle ni secret.
- Mise en place ou changement, par le cabinet, depuis une copie à jour du dépôt :

  ```bash
  infra/hyperping/legarec-hyperping
  ```

  Le script demande la clé API (Project settings › Developers › Create key, « Read & Write ») sans l'afficher, puis crée ou met à jour chaque moniteur par son identifiant : il peut être relancé sans créer de doublon. La clé n'est écrite nulle part ; à créer avec une expiration, ou à révoquer après usage.
- Essai sans clé ni appel : `node infra/hyperping/provisionner.mjs --essai`.
- Alertes : celles du compte Hyperping (e-mail du compte, à régler dans Hyperping) ; aucune donnée ne part vers Hyperping hors des adresses surveillées.
- Tant que HTTPS ne répond pas (certificats absents), les cinq moniteurs sont en panne : c'est attendu.

## Documents et PDF (lot N)
- **Dossier des documents** : `/var/lib/legarec/documents`, propriétaire 10101, groupe 10120, droits 2770 (à créer avant le premier déploiement ; `deployer.sh` le vérifie). L'API et le worker y écrivent et y lisent par ce groupe commun ; aucun autre conteneur ne le voit. Monté sur `/documents` (`DOCUMENTS_DIR`). À sauvegarder avec la base (copie quotidienne du dossier) tant que le bucket n'est pas en service, puis tant qu'il reste des fichiers dans ce dossier (« Bucket des documents »).
- **Fichiers sans ligne** : chaque nuit à 4 h 30, le worker efface du dossier (et du bucket quand il est en service) les fichiers qu'aucune ligne de la base ne désigne : dépôt dont l'enregistrement a échoué, programme arrêté au mauvais moment. Dans le doute, il n'efface pas. Garde-fous : jamais un fichier de moins de **7 jours** (question 230) ; jamais un nom qui n'est pas une clé à sa place (`xx/<clé>`), compté et laissé ; **100 fichiers au plus par nuit**, un seul essai par nuit ; **rien n'est effacé**, et la tâche échoue (erreur `kind: orphan-files` dans le journal du worker, avec `TOO_MANY`, `TOO_LARGE_A_SHARE` ou `NO_ROW_HELD`), s'il y a plus de 20 fichiers sans ligne, ou plus de fichiers sans ligne qu'avec, ou si la base ne détient aucun des fichiers (question 231). Le journal ne porte que des nombres ; il avertit (`warn`) dès qu'un fichier de plus de 7 jours est sans ligne. Aucune alerte Gatus pour l'instant : c'est le journal du worker qu'il faut lire.
  - Compter, sans rien effacer : `legarec run --rm --no-deps worker node --env-file=/run/secrets/worker dist/sweep-files.js`. La commande dit combien de fichiers sont sans ligne, combien sont trop récents, combien de noms sont inconnus, et si l'effacement de la nuit est suspendu.
  - Effacer après avoir regardé, au-delà de l'alarme de la nuit : la même commande suivie de `--erase <nombre>`, où `<nombre>` est le nombre de fichiers sans ligne que le comptage vient d'afficher ; tout autre nombre est refusé. 100 fichiers au plus à chaque fois, toujours aucun fichier de moins de 7 jours ; la commande dit combien il en reste et quoi taper. Chaque effacement forcé est inscrit (`orphan-files-forced` dans `retention_runs`, et au journal). **Si la base ne détient aucun des fichiers, la commande refuse aussi** : ce n'est pas la base de ce dossier, vérifier `DOCUMENTS_DIR` et la base avant toute chose.
  - **Après une restauration de la base** : la purge de l'étape 6 a suspendu l'effacement de la nuit. Les fichiers reçus entre l'instant restauré et l'arrêt n'ont plus de ligne et ne sont plus visibles dans l'application ; tant que la suspension dure, aucun n'est effacé, quel que soit leur âge. À faire, sans délai imposé : compter ; copier à part ceux qui doivent être redéposés (pièce d'un créancier, justificatif d'un débiteur : les fichiers de `/var/lib/legarec/documents` dont la date est postérieure à l'instant restauré) ; effacer le reste avec `--erase <nombre>` (seuls les fichiers de plus de 7 jours partent) ou laisser la nuit le faire ; puis lever la suspension : la même commande suivie de `--resume`. Une fois levée, la nuit reprend avec ses garde-fous : plus de 20 fichiers sans ligne, elle refuse encore et il faut `--erase`.
  - **Après une restauration du dossier** (copie quotidienne) : garder les dates des fichiers (`rsync -a`, `cp -a`). Les fichiers des documents purgés reviennent et sont effacés de nouveau par la purge (`document-files`), pas par ce balayage.
  - Noms inconnus : un fichier posé à la main dans le dossier n'est jamais effacé par l'application ; le retirer à la main.
- **Chromium** : paquet Debian de l'image (`CHROMIUM_PATH=/usr/bin/chromium`), utilisé par le worker seul, sans son bac à sable (le conteneur en tient lieu, la page n'exécute aucun script et ne charge rien). Worker : 1 Go de mémoire, 400 processus, `/tmp` de 256 Mo.

## Antivirus (ClamAV)
- **Deux conteneurs, une image** (`clamav/clamav` 1.5.5 officielle, désignée par son empreinte, `infra/docker/clamav.Dockerfile`), lancés sans root par le script `/init-unprivileged` de l'image : `clamav` ne lance que clamd (`CLAMAV_NO_FRESHCLAMD=true`), `freshclam` ne lance que la mise à jour des signatures (`CLAMAV_NO_CLAMD=true`). Celui qui lit des fichiers hostiles n'a donc aucune sortie vers Internet, et celui qui a une sortie n'écoute rien et ne lit aucun fichier. Mêmes protections pour les deux (compte 10116, lecture seule, aucun droit Linux). Réglages dans l'image (`infra/clamav/`) : flux de 20 Mo au plus (un fichier fait 15 Mo au plus), un seul jeu de signatures en mémoire (`ConcurrentDatabaseReload no`, `TestDatabases no`) pour tenir dans 2 Go.
- **Réseaux** : `clamav` est sur `antivirus` seul, fermé, partagé avec le worker seul (`CLAMAV_URL=tcp://clamav:3310`, écrit dans `docker-compose.yml` : ce n'est pas un secret) ; ni l'API, ni un portail, ni `freshclam`, ni un autre compte du serveur ne le joignent. `freshclam` est sur `sortie-antivirus` seul, pour télécharger les signatures (`database.clamav.net`) ; ce réseau n'est pas limité à cette adresse : c'est le conteneur qui ne fait rien d'autre.
- **Signatures** : celles du jour de publication de l'image sont dans l'image et sont copiées dans le volume `clamav-data` à sa création, donc clamd démarre sans Internet. `freshclam` les met à jour une fois par jour dans ce volume ; clamd, qu'il ne peut pas prévenir, regarde toutes les 10 minutes (`SelfCheck 600`) et recharge ce qui a changé. Démarrage et rechargement : une à plusieurs minutes, pendant lesquelles les fichiers reçus attendent. **Volume vidé à la main** : clamd ne démarre pas sans signatures, et son script tenterait un téléchargement qu'il ne peut plus faire ; lancer d'abord `legarec up -d freshclam`, attendre la fin du téléchargement dans son journal, puis `legarec up -d clamav`. `freshclam` n'a pas de contrôle de santé (celui de l'image interroge clamd) : des signatures qui ne se mettent plus à jour ne déclenchent aucune alerte, à regarder dans son journal.
- **Archive au-delà des limites d'analyse** (taille, profondeur, nombre de fichiers) : `AlertExceedsMax yes`, clamd répond « FOUND » et non « OK » ; le fichier est alors traité comme infecté (« Bloqué par l’antivirus », fichier effacé), jamais comme sain.
- **Antivirus arrêté ou injoignable** : rien ne se perd et rien ne se lit ; la tâche d'analyse est retentée (`ANTIVIRUS_UNAVAILABLE` ; `STORAGE_UNAVAILABLE` quand c'est le fichier qui ne se lit ou ne s'efface pas), le document reste « analyse antivirus en cours ». Un fichier trouvé infecté est effacé par la même tâche, retentée jusqu'à ce que l'effacement réussisse. Aucune alerte Gatus ne signale clamd arrêté (ci-dessous, « Le reste »).
- **Jamais essayé sur un serveur, ni même lancé** : Claude Code n'a pas le droit d'utiliser Docker, et GitHub Actions est à l'arrêt. La séparation en deux conteneurs repose sur la documentation de l'image (variables `CLAMAV_NO_CLAMD` et `CLAMAV_NO_FRESHCLAMD`, premier téléchargement si `main.cvd` manque). `infra/ci/smoke.sh` est écrit pour vérifier que le worker obtient « OK » pour un fichier sain et « FOUND » pour le fichier d'essai EICAR, que ni l'API, ni un portail, ni le serveur ne joignent clamd, que `clamav` n'est que sur `antivirus` et `freshclam` que sur `sortie-antivirus`. À regarder à la première mise en service : démarrage des deux conteneurs, mémoire réellement prise (`docker stats` ; 384 Mo prévus pour `freshclam`, sans mesure), première mise à jour dans le journal de `freshclam`, puis rechargement dans celui de `clamav` dans les 10 minutes.

## Bucket des documents (`legarec-documents`)
- **État : prêt dans le code, éteint en production.** L'API n'a aucun accès à Internet (réseaux fermés), donc aucun accès au bucket, alors que c'est elle qui reçoit et remet les fichiers. Tant que la **question 205** n'est pas tranchée, ne pas écrire `S3_DOCUMENTS_BUCKET` : les fichiers restent dans `/var/lib/legarec/documents`, comme au lot N. Écrire la variable sans ouvrir de sortie ferait échouer chaque dépôt et chaque lecture de fichier après 12 secondes.
- **Fonctionnement** : avec `S3_DOCUMENTS_BUCKET` et `S3_REGION` (`eu-west-par`) dans `api.env` **et** `worker.env`, et les deux clés `S3_ACCESS_KEY` et `S3_SECRET_KEY` saisies dans Paramètres techniques > Secrets, tout nouveau fichier va dans le bucket (adresse `s3.eu-west-par.io.cloud.ovh.net`), sous la même clé tirée au hasard que sur le disque. Sans les deux variables : disque du serveur, comme avant. Avec les variables mais sans les deux clés (pas encore saisies, en attente de révocation, révoquées) : les nouveaux fichiers vont sur le disque, un fichier se lit s'il est sur le disque et sinon la lecture échoue (`BucketError`, `NoKeys` : hors d'atteinte, pas absent), et **la purge échoue** (« Purge incomplète », relancée la nuit suivante) plutôt que de compter zéro en laissant dans le bucket des fichiers à effacer. Saisir les deux clés avant d'écrire les variables. Les clés sont relues dans le coffre toutes les 5 minutes (30 secondes tant qu'elles manquent) : une clé renouvelée dans l'écran est prise sans redémarrage.
- **Fichiers déjà sur le disque** : ils y restent et sont toujours lus (le bucket d'abord ; s'il répond que l'objet n'existe pas, le disque). Aucune copie automatique vers le bucket : le dossier reste à sauvegarder tant qu'il n'est pas vide. La purge efface aux deux endroits ; dans le bucket, elle demande d'abord la liste (un objet), ce qui distingue un objet absent d'un bucket absent. Le balayage des fichiers sans ligne (« Documents et PDF ») liste le bucket entier, page par page, puis le disque ; sans les clés du coffre, il échoue sans rien effacer, disque compris.
- **Panne** : un bucket injoignable, une clé refusée ou un bucket absent font échouer la requête ou la tâche (erreur `BucketError`, avec le seul nom donné par S3 : `AccessDenied`, `NoSuchBucket`, `TimeoutError`…) ; jamais de repli silencieux sur le disque, qui cacherait la panne et disperserait les fichiers. Une tâche du worker est retentée. Seul le retrait d'un fichier dont la ligne n'a pas pu être écrite (dépôt qui échoue) ne fait jamais échouer la requête : ce qui n'a pas pu être retiré est noté au journal par le seul nom de la panne (« file left in the storage ») et reste dans le stockage sans ligne ; rien ne balaie encore ces fichiers (`PLAN.md`, lot X). Une révocation de clé demandée (en attente du Directeur) renvoie les nouveaux fichiers sur le disque et rend illisibles ceux du bucket jusqu'à la décision : à éviter en journée.
- **Jamais dans un seul des deux fichiers** : l'API et le worker doivent avoir les mêmes deux valeurs, sinon l'un écrit là où l'autre ne lit pas (analyse antivirus, quittances).
- **Surveillance** : contrôle « Documents » de Gatus, sans aucune clé : toutes les 10 minutes, `https://legarec-documents.s3.<région>.io.cloud.ovh.net/` doit répondre 403 (bucket présent, privé, OVHcloud joignable) ; 404 : bucket absent ; 200 : il est devenu public. Il ne dit pas si les clés du coffre fonctionnent : une clé refusée se voit aux dépôts qui échouent (question 206).
- **Jamais essayé contre un vrai bucket**, ni l'application ni le contrôle Gatus : aucune clé, et jamais depuis le serveur de développement. Les tests jouent contre un faux client S3, en mémoire. Première vérification réelle, à la mise en service du bucket, avant tout dossier : déposer un PDF dans Documents, le rouvrir, le voir dans le bucket sous `xx/<clé>` (illisible par une adresse publique), puis vérifier qu'un fichier déposé avant la bascule s'ouvre encore. À surveiller ce jour-là : la réponse d'OVHcloud pour un objet absent (`NoSuchKey` attendu ; un « refusé » bloquerait la lecture des fichiers du disque), la liste d'un objet par la clé de l'application (droit de lister), les sommes de contrôle des envois, et la forme d'adresse (le client utilise `legarec-documents.s3.<région>…`).
- En développement et dans les tests : toujours le disque. `S3_DOCUMENTS_BUCKET` est refusé au démarrage hors production, quel que soit le nom : avec des clés dans le coffre, le vrai service d'OVHcloud serait appelé.

## Reste à faire (fin du lot X)

### Avant la mise en service : écrans encore sans API
Une page construite pour la production n'a aucune simulation : elle appelle l'API. État au 27/11/2026, après `lot/q3` (comparaison des routes simulées et de `packages/contracts/openapi.json`) :

| Portail | Routes appelées | Sur l'API | Manquent |
|---|---|---|---|
| `paiement` | 13 | 13 | — |
| `partenaires` | 19 | 19 | — |
| `espace` | 167 | 132 | 35, ci-dessous |

| Écran de l'espace | Ce qui manque | Attend |
|---|---|---|
| Relances envoyées depuis un échéancier ou la liste ; envoi et composition d'un document ; essai d'un modèle (la relance par e-mail depuis un dossier est sur l'API depuis `lot/q3`) | 7 routes | Composition des courriers et clé de test MySendingBox (lot Q, question 210) |
| Messagerie (e-mails, SMS), boîtes OVH dans Paramètres | 21 routes | Compte SMS et boîtes OVH (lot R) |
| Appels | 7 routes | Licence et identifiants 3CX (lot T) |

Sur l'API depuis `lot/u3`, sans ce que la base ne sait pas encore : Rapports calcule ses chiffres sur les dossiers réels, sans appels, promesses, honoraires ni rapports programmés (questions 200 à 203) ; Équipe montre le portefeuille et l'encaissé de chacun et dit « Téléphonie non connectée » à la place de la présence et des appels (question 204, lot T).

Sur l'API depuis `lot/s5`, mais incomplets faute de décision : Facturation liste les factures de commission, ses onglets « Devis » et « Contrats » sont vides et « + Créer depuis un modèle » répond que la création n'est pas encore disponible (questions 195 et 196) ; les Documents du créancier listent ce que l'équipe lui a partagé, sans relevé, rapport ni téléchargement (questions 197 à 199).

Tant qu'une route manque, son écran affiche son état d'erreur (« Réessayer ») : rien ne se perd, mais l'écran ne sert pas. **À décider par le cabinet (question 194)** : attendre tous les lots, ou mettre en service avec les écrans prêts et masquer les autres.

### Le reste
- **Stockage chez OVHcloud** : fait pour Caddy (`media.legarec.fr`), pgBackRest et les noms des clés (`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_DOCUMENTS_BUCKET`). pgBackRest reste en adresses « chemin » (`repo1-s3-uri-style=path`), qu'OVHcloud accepte ; **jamais essayé contre un vrai bucket** : le premier `legarec run --rm sauvegarde full` de la mise en service le dira, avant toute donnée. La migration `storage_secret_names` renomme deux noms de clés : sans effet au premier déploiement ; elle interdit seulement de revenir à une version antérieure une fois une clé de stockage saisie. Le bucket `legarec-documents` est branché dans le code, éteint en production (« Bucket des documents », question 205).
- ClamAV : fait (« Antivirus », ci-dessus). Reste une alerte quand clamd ne répond plus : Gatus ne joint pas le réseau `antivirus` (réservé au worker), et le contrôle de santé du conteneur ne prévient personne.
- Chemin des modèles d'e-mails et de PDF : vérifié. Le worker les lit dans `templates/`, à côté de `dist/` (`apps/api/src/worker.ts`), et l'image copie ce dossier ; `TEMPLATES_DIR` de `renderer.ts` ne sert qu'aux tests.
- n8n : avec les comptes de service ; conteneur et valeurs (`N8N_ENCRYPTION_KEY`) à ajouter, sur un réseau partagé avec l'API seule. Sa route existe déjà dans Caddy, réservée aux adresses du cabinet : elle répond 502 d'ici là.
- Bucket des documents : ouvrir à l'API un chemin vers le bucket (question 205), puis première vérification réelle. Contrôle Gatus : fait, sans clé (question 206). Copie vers le bucket des fichiers restés sur le disque : non prévue.
- Purge à la demande après une restauration : faite (`dist/purge.js`, étape 6 de « Restaurer la base »).
- Fichiers sans ligne : balayage fait, chaque nuit, suspendu par la purge d'après restauration, et commande `dist/sweep-files.js` (« Documents et PDF », questions 230 et 231). Bucket couvert dans le code, jamais essayé contre un vrai bucket. Reste à décider : une alerte (Gatus ou notification au Développeur) quand la tâche refuse ou trouve un fichier sans ligne.
- **Condition de mise en service** : `legarec-hold-tasks` ne bloque que les tâches en file (`outbox`). Chaque lot qui ajoute un planning dans PostgreSQL (relances, envois groupés, notifications) l'étend à ses tables, avec un test : sinon une relance déjà partie redeviendrait due. L'agenda des relances (`planned_reminders`, lot Q) n'envoie encore rien de lui-même : à étendre avec l'envoi automatique.
- `pgbackrest verify` chaque semaine : fait (minuterie `legarec-verification-sauvegardes`, dimanche 6 h, surveillée par Gatus). Reste l'essai automatique d'une restauration à un instant précis.
- Versions du bucket `legarec-documents` : 70 jours (question 115), règle à poser sur le bucket par le cabinet (« À préparer »).
- Contrôle de plusieurs copies de l'API : non prévu, une seule à la fois.
