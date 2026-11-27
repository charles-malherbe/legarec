#!/bin/bash
# Fills the values of /etc/legarec that the firm does not receive from anyone: passwords, addresses of the database and of
# Valkey, keys of the vault and of the sessions, tokens of the monitoring, phrase of the backups. Run by the firm, as root,
# before the first deployment (docs/deploiement.md, « Valeurs à fournir »). Never by Claude Code.
# - Only an empty line `KEY=` is filled; a value already written is kept, and the values made from it follow it.
# - A file still absent is made from its example, with the owner and the rights of docs/deploiement.md.
# - Nothing is printed but names: no value on the screen, in a log, or on a command line.
# - Left to the firm: the values that come from outside (still between brackets or empty), listed at the end.
#   N8N_ENCRYPTION_KEY is drawn only with --n8n-neuf: the key of the former n8n must be taken over (« n8n »).
# - --sauvegardes-locales: the backups go to the disk of the server until their bucket exists (« Sauvegardes locales »).
set -euo pipefail
umask 077
stop() { echo "$1" >&2; exit 1; }

dir=/etc/legarec
new_n8n=false
local_backups=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --n8n-neuf) new_n8n=true ;;
    --sauvegardes-locales) local_backups=true ;;
    # Tests only: another folder, owner and group left as they are.
    --dossier) dir="${2:?}"; shift ;;
    *) stop "Option inconnue : $1 (seules --n8n-neuf, --sauvegardes-locales et --dossier existent)." ;;
  esac
  shift
done
examples="$(cd "$(dirname "$0")" && pwd)/valeurs"
if [ "$dir" = /etc/legarec ]; then
  [ "$(id -u)" = 0 ] || stop 'À lancer par root (sudo).'
  [ "$(stat -c %u:%a "$dir" 2>/dev/null)" = 0:700 ] || stop "Dossier $dir absent ou mal protégé (root, 700) : voir docs/deploiement.md."
else
  [ -d "$dir" ] || stop "Dossier $dir absent."
fi

# Group of each file: the same table as infra/deployer.sh and docs/deploiement.md.
declare -A group=([caddy]=10110 [api]=10101 [worker]=10102 [migration]=10104 [postgres]=999 [pgbackrest]=999 [restauration]=999 [valkey]=10115 [gatus]=10111 [grafana]=10114 [n8n]=10117)
for name in "${!group[@]}"; do
  file="$dir/$name.env"
  [ -e "$file" ] && continue
  if [ "$(id -u)" = 0 ]; then
    install -o root -g "${group[$name]}" -m 640 "$examples/$name.env.exemple" "$file"
  else
    install -m 640 "$examples/$name.env.exemple" "$file"
  fi
  echo "Créé depuis son modèle : $file"
done

# The value of a key, empty when absent, empty or still between brackets.
read_value() {
  local value
  value="$(sed -n "s/^$2=//p" "$dir/$1.env" | head -n 1)"
  [[ "$value" == *'['* ]] && value=''
  printf '%s' "$value"
}
# Writes a value on the line `KEY=` of a file, which must be empty: the file keeps its owner and its rights.
filled=()
write_value() {
  local file="$dir/$1.env" key="$2" value="$3" temporary
  grep -qx "$key=" "$file" || return 0
  temporary="$(mktemp "$dir/.tirage.XXXXXX")"
  KEY="$key" VALUE="$value" awk 'BEGIN { done = 0 } !done && $0 == ENVIRON["KEY"] "=" { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; done = 1; next } { print }' "$file" > "$temporary"
  cat "$temporary" > "$file"
  rm -f "$temporary"
  filled+=("$1.env : $key")
}
# One value shared by several places (file:KEY ...): the one already written, the same everywhere, or a new one.
shared() {
  local kind="$1" found='' place value
  shift
  for place in "$@"; do
    value="$(read_value "${place%%:*}" "${place#*:}")"
    [ -z "$value" ] && continue
    [ -z "$found" ] || [ "$found" = "$value" ] || stop "Valeurs différentes pour ${*} : à rendre identiques à la main, puis relancer (ce qui est déjà écrit est gardé)."
    found="$value"
  done
  if [ -z "$found" ]; then
    case "$kind" in
      hex) found="$(openssl rand -hex 32)" ;;
      base64) found="$(openssl rand -base64 32)" ;;
    esac
  fi
  for place in "$@"; do write_value "${place%%:*}" "${place#*:}" "$found"; done
  RESULT="$found"
}
# An address made from a password: written only where the line is empty.
address() { write_value "$1" "$2" "$3"; }

# Backups on the disk of the server: no bucket, hence no key. A file that already has a key is left as it is.
if [ "$local_backups" = true ]; then
  for name in pgbackrest restauration; do
    file="$dir/$name.env"
    grep -qx 'PGBACKREST_REPO1_TYPE=posix' "$file" && continue
    [ -z "$(read_value "$name" PGBACKREST_REPO1_S3_KEY)" ] || stop "$file a déjà une clé S3 : rien n'est changé, les sauvegardes restent sur le bucket."
    temporary="$(mktemp "$dir/.tirage.XXXXXX")"
    { grep -v '^PGBACKREST_REPO1_S3_' "$file" || true; printf 'PGBACKREST_REPO1_TYPE=posix\nPGBACKREST_REPO1_PATH=/depot\n'; } > "$temporary"
    cat "$temporary" > "$file"
    rm -f "$temporary"
    filled+=("$name.env : sauvegardes locales (PGBACKREST_REPO1_TYPE, PGBACKREST_REPO1_PATH)")
  done
fi

# Database and queues.
shared hex postgres:POSTGRES_PASSWORD
shared hex postgres:LEGAREC_OWNER_PASSWORD; owner="$RESULT"
shared hex postgres:LEGAREC_APP_PASSWORD; app="$RESULT"
shared hex postgres:LEGAREC_JOBS_PASSWORD; jobs="$RESULT"
shared hex valkey:VALKEY_PASSWORD; valkey="$RESULT"
address migration MIGRATION_DATABASE_URL "postgresql://legarec_owner:$owner@postgres:5432/legarec"
address api DATABASE_URL "postgresql://legarec_app:$app@postgres:5432/legarec"
address worker JOBS_DATABASE_URL "postgresql://legarec_jobs:$jobs@postgres:5432/legarec"
address api VALKEY_URL "redis://:$valkey@valkey:6379/0"
address worker VALKEY_URL "redis://:$valkey@valkey:6379/0"
# Keys of the vault and of the sessions: the same for the API and the worker.
shared base64 api:VAULT_MASTER_KEY worker:VAULT_MASTER_KEY
shared base64 api:SESSION_SIGNING_KEY worker:SESSION_SIGNING_KEY
# Monitoring: one token per program, also written in the file of that program.
shared hex gatus:GATUS_WORKER_TOKEN worker:GATUS_PUSH_TOKEN
shared hex gatus:GATUS_BACKUP_TOKEN pgbackrest:GATUS_PUSH_TOKEN
shared hex gatus:GATUS_RESTORE_TOKEN restauration:GATUS_PUSH_TOKEN
# Backups: the same phrase for the backups and their restoration, or nothing can be restored.
shared hex pgbackrest:PGBACKREST_REPO1_CIPHER_PASS restauration:PGBACKREST_REPO1_CIPHER_PASS
shared hex grafana:GF_SECURITY_ADMIN_PASSWORD
shared hex grafana:GF_SECURITY_SECRET_KEY
[ "$new_n8n" = false ] || shared hex n8n:N8N_ENCRYPTION_KEY
unset RESULT owner app jobs valkey

if [ "${#filled[@]}" -gt 0 ]; then
  echo 'Valeurs tirées ou recopiées (aucune n’est affichée) :'
  printf '  %s\n' "${filled[@]}"
else
  echo 'Aucune ligne vide à remplir : rien n’a changé.'
fi
missing=()
for name in "${!group[@]}"; do
  while IFS= read -r key; do
    [ -n "$(read_value "$name" "$key")" ] || missing+=("$name.env : $key")
  done < <(sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' "$dir/$name.env")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo 'À remplir à la main (valeurs venues de l’extérieur, docs/deploiement.md) :'
  printf '  %s\n' "${missing[@]}" | sort
  exit 3
fi
echo 'Toutes les valeurs sont écrites. Copie dans le gestionnaire de mots de passe, puis déploiement.'
