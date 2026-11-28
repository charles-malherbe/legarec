#!/bin/bash
# GitHub Actions only: fills the examples of infra/valeurs with random values, drawn for this job and thrown away with it.
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] || { echo 'GitHub Actions only.' >&2; exit 1; }
[ ! -e /etc/legarec ] || { echo '/etc/legarec already exists: nothing is overwritten.' >&2; exit 1; }
cd "$(dirname "$0")/../.."
hex() { openssl rand -hex 24; }
declare -A value=(
  [ACME_EMAIL]=ci@example.com [AUTHORIZED_IPS]=192.0.2.1 [S3_REGION]=ci
  [VAULT_MASTER_KEY]="$(openssl rand -base64 32)" [SESSION_SIGNING_KEY]="$(openssl rand -base64 32)"
  [POSTGRES_PASSWORD]="$(hex)" [LEGAREC_OWNER_PASSWORD]="$(hex)" [LEGAREC_APP_PASSWORD]="$(hex)" [LEGAREC_JOBS_PASSWORD]="$(hex)"
  [VALKEY_PASSWORD]="$(hex)"
  [PGBACKREST_REPO1_CIPHER_PASS]="$(hex)" [N8N_ENCRYPTION_KEY]="$(hex)"
  [PGBACKREST_REPO1_S3_KEY]=ci [PGBACKREST_REPO1_S3_KEY_SECRET]=ci
)
value[DATABASE_URL]="postgresql://legarec_app:${value[LEGAREC_APP_PASSWORD]}@postgres:5432/legarec"
value[JOBS_DATABASE_URL]="postgresql://legarec_jobs:${value[LEGAREC_JOBS_PASSWORD]}@postgres:5432/legarec"
value[MIGRATION_DATABASE_URL]="postgresql://legarec_owner:${value[LEGAREC_OWNER_PASSWORD]}@postgres:5432/legarec"
value[VALKEY_URL]="redis://:${value[VALKEY_PASSWORD]}@valkey:6379/0"
install -d -m 700 /etc/legarec
install -d -o 10113 -g 10113 -m 700 /var/lib/legarec/journaux
# Documents: the API and the worker, by their common group; what one writes, the other reads.
install -d -o 10101 -g 10120 -m 2770 /var/lib/legarec/documents
install -d -o 999 -g 999 -m 700 /var/lib/legarec-ci/depot
chmod 755 /var/lib/legarec-ci
# Groups: the same table as docs/deploiement.md.
declare -A group=([caddy]=10110 [api]=10101 [worker]=10102 [migration]=10104 [postgres]=999 [pgbackrest]=999 [restauration]=999 [valkey]=10115 [n8n]=10117)
for name in "${!group[@]}"; do
  file="/etc/legarec/$name.env"
  install -o root -g "${group[$name]}" -m 640 /dev/null "$file"
  while IFS= read -r line; do
    key="${line%%=*}"
    if [[ "$line" =~ ^[A-Z0-9_]+=($|\[) ]]; then
      [ -n "${value[$key]:-}" ] || [[ "$key" == PGBACKREST_REPO1_S3_* ]] || { echo "No value for $key" >&2; exit 1; }
      if [ -n "${value[$key]:-}" ]; then printf '%s=%s\n' "$key" "${value[$key]}"; fi
    # A value of this job wins over the one written in the example: the job never calls the real provider.
    elif [[ "$line" == *=* && "$line" != '#'* && "$line" != PGBACKREST_REPO1_S3_* ]]; then
      if [ -n "${value[$key]:-}" ]; then printf '%s=%s\n' "$key" "${value[$key]}"; else printf '%s\n' "$line"; fi
    fi
  done < "infra/valeurs/$name.env.exemple" > "$file"
done
# A folder of the job instead of the bucket: same program, same encryption, same restoration.
for name in pgbackrest restauration; do
  sed -i '/^PGBACKREST_REPO1_S3_/d' "/etc/legarec/$name.env"
  printf 'PGBACKREST_REPO1_TYPE=posix\nPGBACKREST_REPO1_PATH=/depot\n' >> "/etc/legarec/$name.env"
done
# Certificates of the job: nothing is asked to Let's Encrypt.
sed '0,/^{$/s//{\n\tlocal_certs\n\tskip_install_trust/' infra/caddy/Caddyfile > /var/lib/legarec-ci/Caddyfile
grep -q local_certs /var/lib/legarec-ci/Caddyfile
# The bucket of the firm is never called from here.
grep -qx 'S3_REGION=ci' /etc/legarec/caddy.env
