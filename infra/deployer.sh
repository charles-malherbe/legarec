#!/bin/bash
# Deployment, run by the firm on the server, as root, from /opt/legarec (docs/deploiement.md). Never by Claude Code.
set -euo pipefail
stop() { echo "$1" >&2; exit 1; }
root=/opt/legarec
[ "$(id -u)" = 0 ] || stop 'À lancer par root (sudo).'
# Root only runs what root wrote: never the working copy of someone else.
[ "$(dirname "$(dirname "$(readlink -f "$0")")")" = "$root" ] || stop "À lancer depuis $root."
[ -z "$(find "$root" ! -user root -print -quit)" ] || stop "$root doit appartenir entièrement à root."
open="$(find "$root" ! -type l -perm /022 -print -quit)"
[ -z "$open" ] || stop "$root ne doit être modifiable que par root : $open"
cd "$root"
[ -z "$(git status --porcelain)" ] || stop 'Le dépôt contient des modifications : rien ne sera déployé.'
git merge-base --is-ancestor HEAD refs/remotes/origin/main || stop 'Cette version ne vient pas de main : rien ne sera déployé.'

# Group of each file of values: the same table as docs/deploiement.md.
declare -A group=([caddy]=10110 [api]=10101 [worker]=10102 [migration]=10104 [postgres]=999 [pgbackrest]=999 [restauration]=999 [valkey]=10115 [gatus]=10111 [grafana]=10114 [n8n]=10117)
# The job of GitHub Actions is told apart by its folder too, which the server does not have.
ci=false
if [ "${GITHUB_ACTIONS:-}" = true ] && [ -d /var/lib/legarec-ci ]; then ci=true; fi
wrong=0
tell() { echo "$1" >&2; wrong=1; }
[ "$(stat -c %u:%a /etc/legarec 2>/dev/null)" = 0:700 ] || tell 'Dossier /etc/legarec absent ou mal protégé (root, 700).'
[ "$(stat -c %u:%a /var/lib/legarec/journaux 2>/dev/null)" = 10113:700 ] || tell 'Dossier /var/lib/legarec/journaux absent ou mal protégé (10113, 700).'
[ "$(stat -c %u:%g:%a /var/lib/legarec/documents 2>/dev/null)" = 10101:10120:2770 ] || tell 'Dossier /var/lib/legarec/documents absent ou mal protégé (10101, groupe 10120, 2770).'
for name in "${!group[@]}"; do
  file="/etc/legarec/$name.env"
  [ -f "$file" ] || { tell "Fichier absent : $file"; continue; }
  [ "$(stat -c %u:%g:%a "$file")" = "0:${group[$name]}:640" ] || tell "Droits de $file : root, groupe ${group[$name]}, 640 attendus."
  while IFS= read -r key; do
    [ "$ci" = true ] && [[ "$key" == PGBACKREST_REPO1_S3_* ]] && continue
    # Backups on the disk of the server, while they wait for their bucket: no key to give.
    grep -qx 'PGBACKREST_REPO1_TYPE=posix' "$file" && [[ "$key" == PGBACKREST_REPO1_S3_* ]] && continue
    grep -qE "^$key=[^[]" "$file" && ! grep -qE "^$key=.*\[" "$file" || tell "Valeur absente ou entre crochets : $key dans $file"
  done < <(sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' "infra/valeurs/$name.env.exemple")
done
[ "$wrong" = 0 ] || exit 1
if [ "$ci" = false ] && grep -qx 'PGBACKREST_REPO1_TYPE=posix' /etc/legarec/pgbackrest.env; then
  echo 'Attention : sauvegardes sur le disque du serveur (volume sauvegardes-locales), perdues avec lui. À passer sur le bucket dès que possible (docs/deploiement.md, « Sauvegardes locales »).' >&2
fi

LEGAREC_VERSION="$(git rev-parse --short=12 HEAD)"
export LEGAREC_VERSION
files=(--file docker-compose.yml)
# GitHub Actions tries this very script, without any way out to the Internet.
[ "$ci" = false ] || files+=(--file infra/ci/compose.ci.yml)
# No file of values by default: neither `.env` nor COMPOSE_FILE is read.
unset COMPOSE_FILE COMPOSE_PROFILES
compose() { docker compose "${files[@]}" --env-file /dev/null "$@"; }
echo "Version $LEGAREC_VERSION : construction des images"
compose build
echo 'Base de données, files et surveillance'
compose up --detach --wait postgres valkey gatus-interne
echo 'Sauvegarde avant migration'
flock --timeout 3600 /run/legarec-sauvegarde.lock docker compose "${files[@]}" --env-file /dev/null run --rm sauvegarde incr
echo 'Rôles de la base'
# bootstrap.sql only runs by itself when the data folder is created: a role added since then comes from here.
compose exec --no-TTY postgres legarec-roles
echo 'Migrations'
compose run --rm migration
echo 'Démarrage'
compose up --detach --wait
# The timers of the backups use the version that runs.
printf 'LEGAREC_VERSION=%s\n' "$LEGAREC_VERSION" > /etc/legarec/version.env
compose ps
