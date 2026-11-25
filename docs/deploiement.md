# Déploiement

Première partie du lot X. Fichiers préparés par Claude Code, vérifiés par GitHub Actions, **lancés par le cabinet seul** (question 82). Aucune valeur secrète n'est dans ce dépôt. En cas d'écart, `DECISIONS.md` l'emporte.

> **Ne pas mettre en service maintenant.** Les portails construits appellent l'API, qui n'a encore aucune route métier. Voir « Reste à faire », en fin de fichier.

## Vue d'ensemble

| Conteneur | Rôle | Compte | Mémoire | Accès à Internet |
|---|---|---|---|---|
| `caddy` | Seul exposé (80, 443) : HTTPS, en-têtes, routage | 10110 | 192 Mo | oui |
| `espace`, `partenaires`, `paiement` | Fichiers des portails | 10103 | 3 × 48 Mo | non |
| `api` | API | 10101 | 512 Mo | non |
| `worker` | Tâches (même image que l'API), arrêt en 90 s au plus | 10102 | 768 Mo | oui |
| `migration` | Une exécution par déploiement | 10104 | 256 Mo | non |
| `postgres` | Base, envoi continu du journal aux sauvegardes | 999 | 1,5 Go | oui (bucket) |
| `sauvegarde`, `essai-restauration` | Une exécution par minuterie | 999 | 384 et 512 Mo | oui (bucket) |
| `valkey` | Files d'attente | 999 | 512 Mo | non |
| `gatus` | Page d'état publique | 10111 | 96 Mo | non |
| `gatus-interne` | Contrôles internes et alertes | 10111 | 96 Mo | oui (alertes) |
| `journaux`, `loki`, `grafana` | Journaux techniques, 60 jours | 10113, 10001, 10114 | 96, 384 et 320 Mo | non |

Conteneurs permanents : 4,6 Go au plus. Réserver 2,5 Go pour ClamAV et n8n, à venir. Aucun conteneur ne tourne en root, ni sous le compte 1000 (`debian`, utilisé pour le développement sur ce serveur). Systèmes de fichiers en lecture seule, aucun droit Linux, réseaux séparés : un portail ne joint pas la base, n8n ne joindra que l'API.

| Fichiers | Contenu |
|---|---|
| `docker-compose.yml`, `infra/docker/` | Conteneurs et images |
| `infra/caddy/` | Proxy et serveur des portails |
| `infra/postgres/`, `infra/valkey/` | Base, sauvegardes, files |
| `infra/gatus/`, `infra/loki/`, `infra/grafana/` | Surveillance et journaux |
| `infra/systemd/` | Minuteries des sauvegardes et de l'essai de restauration |
| `infra/valeurs/` | Modèles des fichiers de `/etc/legarec/` (noms seulement) |
| `infra/deployer.sh` | Déploiement, lancé par le cabinet |
| `infra/ci/`, `.github/workflows/images.yml` | Essai complet dans GitHub Actions, sans secret ni publication |

## À préparer

### Serveur
- [ ] Ports 80 et 443 libres, ou reprise du proxy actuel décidée (voir « Questions »).
- [ ] Docker 27 ou plus récent, Compose 2.30 ou plus récent ; 5 Go de mémoire libres, 40 Go de disque libres.
- [ ] Aucun projet Compose nommé `legarec-app` sur ce serveur (`docker compose ls`).
- [ ] Pare-feu : 80/tcp, 443/tcp, 443/udp ouverts ; rien d'autre pour Legarec.
- [ ] Dépôt cloné dans `/opt/legarec`, propriété de root, hors de portée de Claude Code : `git clone`, branche `main`. Clé de déploiement GitHub en lecture seule.
- [ ] Horloge synchronisée (double authentification, certificats).

### DNS (enregistrements A, et AAAA si le serveur a une adresse IPv6)
- [ ] `espace`, `partenaires`, `paiement`, `api`, `status`, `n8n`, `media`, `mail` et `www.espace`, `www.partenaires`, `www.paiement`. Pour `mail`, ne pas toucher aux enregistrements MX, SPF et DKIM de Resend.
- `legarec.fr` et `www.legarec.fr` restent chez leur hébergeur.

### Scaleway
- [ ] Bucket `legarec-sauvegardes`, privé, versions activées, **clé propre à ce bucket**.
- [ ] Règle de cycle de vie : versions remplacées ou supprimées effacées après 70 jours (durée à confirmer, voir « Questions »).
- [ ] Bucket `legarec-media`, public en lecture, liste du contenu désactivée, logos déposés.

### Resend
- [ ] Clé dédiée aux alertes, droit d'envoi seulement, domaine `mail.legarec.fr`.

## Valeurs à fournir

Un fichier par conteneur dans `/etc/legarec/`, d'après `infra/valeurs/*.exemple`. Valeurs saisies par le cabinet, en SSH, hors de Claude Code ; copie dans le gestionnaire de mots de passe, **jamais avec les sauvegardes**.

| Fichier | Groupe | Valeurs |
|---|---|---|
| `caddy.env` | 10110 | `ACME_EMAIL`, `AUTHORIZED_IPS` (adresses du cabinet, séparées par une espace), `SCW_REGION` |
| `api.env` | 10101 | `DATABASE_URL`, `VALKEY_URL`, `VAULT_MASTER_KEY`, `SESSION_SIGNING_KEY`, adresses des portails, `MYSENDINGBOX_ENV` |
| `worker.env` | 10102 | `JOBS_DATABASE_URL`, les mêmes `VALKEY_URL`, `VAULT_MASTER_KEY` et `SESSION_SIGNING_KEY`, `GATUS_PUSH_URL`, `GATUS_PUSH_TOKEN` |
| `migration.env` | 10104 | `MIGRATION_DATABASE_URL` |
| `postgres.env` | 999 | `POSTGRES_PASSWORD`, `LEGAREC_OWNER_PASSWORD`, `LEGAREC_APP_PASSWORD`, `LEGAREC_JOBS_PASSWORD` |
| `pgbackrest.env` | 999 | `PGBACKREST_REPO1_S3_REGION`, `PGBACKREST_REPO1_S3_ENDPOINT`, `PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`, `GATUS_PUSH_TOKEN` |
| `valkey.env` | 999 | `VALKEY_PASSWORD` |
| `gatus.env` | 10111 | `GATUS_ALERT_KEY`, `GATUS_ALERT_TO`, `GATUS_PUSH_TOKEN` |
| `grafana.env` | 10114 | `GF_SECURITY_ADMIN_PASSWORD` |

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
- `GATUS_PUSH_TOKEN` : la même valeur dans `worker.env`, `pgbackrest.env` et `gatus.env`.
- Une valeur vide ou encore entre crochets arrête le déploiement.
- Après modification d'un fichier, recréer son conteneur : `docker compose --env-file /etc/legarec/version.env up -d --force-recreate <conteneur>`.
- Nouveau mot de passe d'un compte PostgreSQL : modifier `postgres.env`, recréer `postgres`, lancer `docker compose --env-file /etc/legarec/version.env exec postgres legarec-roles`, puis modifier l'adresse dans le fichier du programme et le recréer.
- `VAULT_MASTER_KEY` et `PGBACKREST_REPO1_CIPHER_PASS` perdues : coffre ou sauvegardes illisibles, définitivement.

## Ordre de mise en service

1. Serveur, DNS, Scaleway, Resend, fichiers de `/etc/legarec/` (ci-dessus).
2. Dans `/opt/legarec`, à jour sur `main`, déploiement. Le script contrôle les fichiers, construit les images, démarre la base, **sauvegarde**, applique les migrations, puis démarre le reste.

   ```bash
   sudo /opt/legarec/infra/deployer.sh
   ```

3. Première sauvegarde complète, puis essai de restauration.

   ```bash
   sudo docker compose --project-directory /opt/legarec --env-file /etc/legarec/version.env run --rm sauvegarde full
   ```

   ```bash
   sudo docker compose --project-directory /opt/legarec --env-file /etc/legarec/version.env run --rm essai-restauration
   ```

4. Minuteries : copier `infra/systemd/*` dans `/etc/systemd/system/`, puis les activer.

   ```bash
   sudo systemctl enable --now legarec-sauvegarde.timer legarec-sauvegarde-complete.timer legarec-essai-restauration.timer
   ```

5. Premier Directeur, par commande (lot K). Le lien s'affiche une fois dans le terminal.
6. Clé Resend, puis les autres clés, dans Paramètres techniques > Secrets.
7. Invitations des collaborateurs, puis des créanciers.

Déploiements suivants : `sudo git -C /opt/legarec pull --ff-only`, puis l'étape 2. Pendant les migrations, l'ancienne version répond encore : une migration doit rester compatible avec elle.

Retour en arrière : `sudo git -C /opt/legarec checkout <version précédente>`, puis l'étape 2. Si une migration a été appliquée entre-temps, elle refuse de continuer : restaurer la sauvegarde faite juste avant, ou corriger par une nouvelle version. Ne jamais lancer `docker compose down --volumes`.

### Restaurer la base
À faire avec un collègue, API et worker arrêtés. L'essai hebdomadaire exécute les mêmes commandes.
1. `docker compose … stop api worker postgres`.
2. `docker compose … run --rm --no-deps --volume legarec-app_postgres-data:/var/lib/postgresql/data --entrypoint legarec-pgbackrest sauvegarde --delta restore` ; pour un instant précis, ajouter `--type=time "--target=2026-12-01 09:00:00+01"`.
3. `docker compose … up -d --wait postgres`, contrôle, puis `up -d --wait`.
4. La purge quotidienne se rejoue après toute restauration (`docs/api.md`) : vérifier sa ligne dans le journal d'audit.

## Liste de recette

Après le premier déploiement, puis après chaque changement de ces fichiers.

**Accès**
- [ ] Les trois portails s'ouvrent en HTTPS, cadenas valide, aucune erreur dans la console du navigateur.
- [ ] `http://` et `www.` mènent à l'adresse en `https://` sans `www`.
- [ ] `https://api.legarec.fr/health` répond ; `https://api.legarec.fr/service/x` répond 404.
- [ ] Depuis un téléphone hors du Wi-Fi du cabinet : `n8n.legarec.fr` et `status.legarec.fr/journaux` répondent 403 ; `status.legarec.fr` ne montre que les portails et l'API.
- [ ] Depuis le cabinet : `status.legarec.fr` montre aussi sauvegardes, worker et journaux ; `status.legarec.fr/journaux` demande un mot de passe.
- [ ] En IPv4 et en IPv6 : deux appareils de réseaux différents sont vus avec deux adresses différentes (journal d'audit, après le lot K).

**Sauvegardes**
- [ ] `sauvegarde` et `essai-restauration` en vert dans les contrôles internes ; prochains passages : `systemctl list-timers 'legarec-*'`.
- [ ] Dans le bucket : fichiers présents et illisibles (chiffrés), versions activées, règle de cycle de vie en place.
- [ ] Restauration complète répétée une fois à blanc, avant les premiers dossiers.

**Surveillance**
- [ ] `docker compose … stop worker` : alerte reçue en moins de 10 minutes ; `start worker` : message de rétablissement.
- [ ] Journaux visibles dans Grafana ; chercher un nom, un e-mail, une référence et un lien de courrier connus : aucun résultat.

**Serveur**
- [ ] `docker compose … ps` : tous en marche ; seul `caddy` publie des ports.
- [ ] `docker inspect` d'un conteneur : aucune valeur de `/etc/legarec/`.
- [ ] Redémarrage du serveur : tout revient seul.
- [ ] Depuis l'utilisateur `debian`, sans `sudo` : `/etc/legarec` illisible.

## Conservation

| Données | Durée | Où |
|---|---|---|
| Sauvegardes | 70 jours (la complète hebdomadaire la plus ancienne reste jusqu'à 7 jours de plus, pour que chaque jour reste restaurable) | `infra/postgres/pgbackrest.conf` |
| Journaux techniques | 60 jours | `infra/loki/loki.yaml` |
| Copie locale de Docker (`docker compose logs`) | 2 Mo par conteneur, effacée à chaque déploiement | `docker-compose.yml` |

Journaux : ni adresse IP, ni chemin, ni en-tête dans ceux de Caddy ; ni requête, ni valeur dans ceux de PostgreSQL ; ceux de l'API et du worker sont déjà limités (`docs/api.md`).

## Choix faits, à connaître
- **Valeurs lues dans un fichier monté**, jamais dans l'environnement du conteneur : `docker inspect` ne montre rien. `pgbackrest.env` est monté dans trois conteneurs, seule exception : c'est PostgreSQL qui envoie son journal.
- **Deux Gatus** : Gatus ne sait pas cacher un contrôle à certains visiteurs. Caddy montre l'un ou l'autre selon l'adresse IP.
- **Grafana** : `status.legarec.fr/journaux`, depuis les adresses du cabinet (aucun nouveau domaine).
- **Journaux** : Docker les remet à un collecteur par un fichier de communication propre à Legarec ; ni accès à Docker, ni lecture des autres conteneurs du serveur.
- **Images construites sur le serveur**, rien n'est publié. Chaque version porte le numéro du commit.
- **Bucket injoignable** : le journal de PostgreSQL attend sur le disque, 4 Go au plus, puis il est abandonné plutôt que de remplir le disque ; l'alerte arrive avant (26 heures sans sauvegarde).
- **PostgreSQL** n'écrit plus ses lignes ERROR, qui citent souvent des données ; l'API note leur code.

## Questions ouvertes au cabinet
Posées dans la discussion. Elles sont à reporter dans `QUESTIONS.md`, que cette branche ne modifie pas.

| Question | Options | Retenu en attendant |
|---|---|---|
| Serveur : la production actuelle occupe déjà le serveur, et sans doute les ports 80 et 443 | A. VPS réservé à Legarec ; B. même serveur, ses sites actuels repris dans le Caddyfile | Rien : le déploiement échoue si les ports sont pris. Conseil : A |
| Versions S3 : 70 jours de sauvegarde puis 70 jours de version supprimée font 140 jours et plus | A. 63 jours de sauvegarde et 7 jours de versions, soit 77 au plus ; B. 70 et 70 | B, la lettre de la question 115. Conseil : A |
| Alertes | A. e-mail par une clé Resend dédiée ; B. SMS OVH | A |
| Grafana | A. `status.legarec.fr/journaux` ; B. nouveau domaine ; C. tunnel SSH | A |
| Alerte quand le bucket est injoignable : 26 heures | A. garder ; B. contrôle horaire du journal | A |

## Reste à faire (fin du lot X)
- **Bascule de MSW vers l'API**, portail par portail (`VITE_API`, `PLAN.md`) ; avant elle, aucun portail ne fonctionne en production.
- Premier Directeur par commande : dépend du lot K.
- ClamAV : avec le lot N (1,5 à 2 Go de mémoire) ; l'API et le worker auront alors besoin du bucket `legarec-documents`, donc d'un accès à Internet pour l'API.
- Chromium (PDF) : avec le lot N ; image et mémoire du worker à revoir, fils d'exécution et polices compris.
- Chemin des modèles d'e-mails une fois l'API construite (lot Q) : `apps/api/src/emails/renderer.ts` remonte de deux dossiers depuis le fichier source ; à vérifier depuis `dist/`.
- n8n : avec les comptes de service ; conteneur et valeurs (`N8N_ENCRYPTION_KEY`) à ajouter, sur un réseau partagé avec l'API seule. Sa route existe déjà dans Caddy, réservée aux adresses du cabinet : elle répond 502 d'ici là.
- Gatus : contrôle du bucket des documents (lot N).
- Contrôle de plusieurs copies de l'API : non prévu, une seule à la fois.

**Changements à faire dans des fichiers que cette branche ne touche pas** :
- `package.json` : `"deployer": "sudo infra/deployer.sh"` (`pnpm deployer`).
- `docs/architecture.md` : `caddy validate` est lancé par `.github/workflows/images.yml`, pas par `pnpm verifier` ; portails servis par leurs conteneurs, derrière Caddy.
- `docs/api.md` : `TRUSTED_PROXIES` ne doit pas être écrit vide (il vaudrait 0) ; noms ajoutés : `LEGAREC_OWNER_PASSWORD`, `LEGAREC_APP_PASSWORD`, `LEGAREC_JOBS_PASSWORD`, `VALKEY_PASSWORD`, `GATUS_PUSH_URL`, `GATUS_PUSH_TOKEN`, `GATUS_ALERT_TO`, `AUTHORIZED_IPS`, `ACME_EMAIL`, `PGBACKREST_REPO1_S3_REGION`, `PGBACKREST_REPO1_S3_ENDPOINT`.
- `PLAN.md` : première partie du lot X faite.
