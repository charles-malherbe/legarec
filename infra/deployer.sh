#!/bin/bash
# Deployment, run by the firm on the server, as root, from /opt/legarec (docs/deploiement.md). Never by Claude Code.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(id -u)" = 0 ] || { echo 'À lancer par root (sudo).' >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Le dépôt contient des modifications : rien ne sera déployé." >&2; exit 1; }
missing=0
for name in caddy api worker migration postgres pgbackrest valkey gatus grafana; do
  file="/etc/legarec/$name.env"
  if [ ! -f "$file" ]; then echo "Fichier absent : $file" >&2; missing=1
  elif grep -qE '^[A-Z0-9_]+=(\[|$)|\[RÉGION\]' "$file"; then echo "Valeur vide ou entre crochets : $file" >&2; missing=1
  elif [ "$(stat -c %A "$file" | cut -c8-10)" != --- ]; then echo "Lisible par tous : $file" >&2; missing=1
  fi
done
[ "$(stat -c %u:%a /var/lib/legarec/journaux 2>/dev/null)" = 10113:700 ] || { echo 'Dossier /var/lib/legarec/journaux absent ou mal protégé.' >&2; missing=1; }
[ "$missing" = 0 ] || exit 1

version="$(git rev-parse --short=12 HEAD)"
export LEGAREC_VERSION="$version"
compose() { docker compose "$@"; }
echo "Version $version : construction des images"
compose build
echo 'Base de données, files et surveillance'
compose up --detach --wait postgres valkey gatus-interne
echo 'Sauvegarde avant migration'
compose run --rm sauvegarde incr
echo 'Migrations'
compose run --rm migration
echo 'Démarrage'
compose up --detach --wait
# The timers of the backups use the version that runs.
printf 'LEGAREC_VERSION=%s\n' "$version" > /etc/legarec/version.env
compose ps
