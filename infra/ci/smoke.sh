#!/bin/bash
# GitHub Actions only: what the stack must do, and must never do.
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] || { echo 'GitHub Actions only.' >&2; exit 1; }
cd "$(dirname "$0")/../.."
fail() { echo "FAILED: $1" >&2; exit 1; }
ok() { echo "ok: $1"; }
resolve=()
for host in espace partenaires paiement api status n8n media mail www.espace; do resolve+=(--resolve "$host.legarec.fr:443:127.0.0.1"); done
get() { curl --silent --insecure --max-time 20 "${resolve[@]}" "$@"; }
status() { get --output /dev/null --write-out '%{http_code}' "$@"; }
expect() { [ "$(status "${@:3}" "$2")" = "$1" ] || fail "$2 is not $1 but $(status "${@:3}" "$2")"; ok "$1 $2"; }

# Portals
for portal in espace partenaires paiement; do
  expect 200 "https://$portal.legarec.fr/"
  expect 200 "https://$portal.legarec.fr/une/route/du/portail"
  expect 404 "https://$portal.legarec.fr/assets/absent.js"
  headers="$(get --head "https://$portal.legarec.fr/" | tr -d '\r')"
  for header in "content-security-policy: default-src 'none'; script-src 'self';" 'strict-transport-security: max-age=31536000' 'x-content-type-options: nosniff' 'x-frame-options: DENY' 'referrer-policy: ' 'permissions-policy: camera=()' 'cache-control: no-cache'; do
    grep -qi "^$header" <<< "$headers" || fail "$portal: $header"
  done
  [ "$(grep -ci '^x-content-type-options' <<< "$headers")" = 1 ] || fail "$portal: header set twice"
  grep -qi '^server:' <<< "$headers" && fail "$portal: server named"
  page="$(get "https://$portal.legarec.fr/")"
  asset="$(grep -oE '/assets/[^"]+\.js' <<< "$page" | head -n 1)"
  get --head "https://$portal.legarec.fr$asset" | grep -qi '^cache-control: public, max-age=31536000, immutable' || fail "$portal: asset not cached"
  ok "$portal"
done

# API
expect 200 https://api.legarec.fr/health
expect 404 https://api.legarec.fr/service/cases
expect 404 https://api.legarec.fr/SERVICE
expect 404 https://api.legarec.fr/%73ervice/cases
expect 404 https://api.legarec.fr/nothing
expect 302 https://api.legarec.fr/
headers="$(get --head https://api.legarec.fr/health | tr -d '\r')"
for header in 'cache-control: no-store' "content-security-policy: default-src 'none'" 'strict-transport-security: ' 'x-content-type-options: nosniff'; do
  [ "$(grep -ci "^$header" <<< "$headers")" = 1 ] || fail "api: $header, once"
done
get --header 'Origin: https://espace.legarec.fr' --head https://api.legarec.fr/staff/nothing | grep -qi 'access-control-allow-origin: https://espace.legarec.fr' || fail 'api: origin of the portal'
ok 'api headers'

# Redirections, without any parameter
[ "$(get --output /dev/null --write-out '%{redirect_url}' 'https://www.espace.legarec.fr/connexion?a=b')" = https://espace.legarec.fr/connexion ] || fail www
[ "$(get --output /dev/null --write-out '%{redirect_url}' 'https://mail.legarec.fr/x?a=b')" = https://legarec.fr/ ] || [ "$(get --output /dev/null --write-out '%{redirect_url}' 'https://mail.legarec.fr/x?a=b')" = https://legarec.fr ] || fail mail
expect 302 https://media.legarec.fr/
expect 405 https://media.legarec.fr/marque/x.svg --request POST
[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --header 'Host: espace.legarec.fr' http://127.0.0.1/)" = 308 ] || fail 'http to https'
ok redirections

# Addresses of the firm only
expect 403 https://n8n.legarec.fr/
expect 403 https://status.legarec.fr/journaux/
expect 404 'https://status.legarec.fr/api/v1/endpoints/taches_worker/external?success=true' --request POST
names="$(get https://status.legarec.fr/api/v1/endpoints/statuses)"
grep -q 'Espace de paiement' <<< "$names" || fail 'public status page'
grep -qE 'sauvegarde|worker|Loki' <<< "$names" && fail 'internal checks on the public page'
sed -i 's/^AUTHORIZED_IPS=.*/AUTHORIZED_IPS=172.16.0.0\/12 192.168.0.0\/16 10.0.0.0\/8 fd00::\/8/' /etc/legarec/caddy.env
docker compose up --detach --wait --force-recreate caddy
expect 200 https://status.legarec.fr/journaux/login
get https://status.legarec.fr/api/v1/endpoints/statuses | grep -q 'Loki' || fail 'internal checks for the firm'
expect 404 'https://status.legarec.fr/api/v1/endpoints/taches_worker/external?success=true' --request POST
ok 'addresses of the firm'

# Containers
for id in $(docker compose ps --quiet); do
  name="$(docker inspect --format '{{.Name}}' "$id")"
  user="$(docker inspect --format '{{.Config.User}}' "$id")"
  [[ "$user" =~ ^(999|10[01][0-9]{2}):[0-9]+$ ]] || fail "$name runs as '$user'"
  docker inspect --format '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.Memory}} {{.HostConfig.Privileged}}' "$id" | grep -qE '^true \[ALL\] [1-9][0-9]+ false$' || fail "$name is not closed"
  docker inspect --format '{{json .Mounts}}' "$id" | grep -q docker.sock && fail "$name sees Docker"
  published="$(docker inspect --format '{{range $port, $to := .HostConfig.PortBindings}}{{$port}} {{end}}' "$id")"
  [[ "$name" == *caddy* || -z "$published" ]] || fail "$name publishes $published"
done
# No value, in what Docker shows of the containers nor in the images.
cut -s -d= -f2- /etc/legarec/*.env | grep -E '^[0-9a-f]{48}$|^[A-Za-z0-9+/]{43}=$' | sort -u > /tmp/values
[ "$(wc -l < /tmp/values)" -ge 10 ] || fail 'no value to look for'
docker inspect $(docker compose ps --all --quiet) | grep -qFf /tmp/values && fail 'a value in docker inspect'
ps -eo args | grep -Ff /tmp/values | grep -qv grep && fail 'a value in a command line'
ok containers

# Only the networks they need
docker compose exec -T espace sh -c 'nc -z -w 2 postgres 5432' 2>/dev/null && fail 'a portal reaches PostgreSQL'
docker compose exec -T gatus sh -c 'nc -z -w 2 valkey 6379' 2>/dev/null && fail 'the status page reaches Valkey'
docker compose exec -T valkey valkey-cli ping | grep -q NOAUTH || fail 'Valkey without a password'
ok networks

# PostgreSQL: rights, then a second run of everything that can be run again
docker compose exec -T postgres psql --username postgres --dbname legarec --tuples-only --no-align --command \
  "SELECT pg_get_userbyid(datdba), has_database_privilege('legarec_app', 'legarec', 'CONNECT') FROM pg_database WHERE datname = 'legarec'" | grep -qx 'legarec_owner|t' || fail 'owner of the database'
[ "$(docker compose exec -T postgres psql --username postgres --dbname legarec --tuples-only --no-align --command "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'legarec%' AND (rolsuper OR rolbypassrls)")" = 0 ] || fail 'a role above the rules'
docker compose exec -T postgres legarec-roles
docker compose run --rm migration | grep -q 'nothing to apply' || fail 'migrations, a second time'
ok postgresql

# Backups and their restoration
docker compose run --rm sauvegarde full
docker compose run --rm essai-restauration | tee /tmp/restore
grep -q 'restore test passed' /tmp/restore || fail 'restore test'
grep -q 'monitoring not told' /tmp/restore && fail 'monitoring not told'
grep -rqa 'legarec_app' /var/lib/legarec-ci/depot && fail 'a backup is not encrypted'
heard="$(get https://status.legarec.fr/api/v1/endpoints/statuses)"
for key in taches_worker sauvegardes_sauvegarde sauvegardes_essai-de-restauration; do
  for _ in $(seq 40); do
    heard="$(get https://status.legarec.fr/api/v1/endpoints/statuses)"
    jq -e --arg key "$key" '.[] | select(.key == $key) | .results | map(.success) | any' <<< "$heard" > /dev/null && break
    sleep 3
  done
  jq -e --arg key "$key" '.[] | select(.key == $key) | .results | map(.success) | any' <<< "$heard" > /dev/null || fail "$key not heard"
done
ok backups

# Technical logs: collected, and nothing personal
mark="ZQXJ$RANDOM$RANDOM"
status "https://paiement.legarec.fr/$mark?email=$mark" > /dev/null
status "https://api.legarec.fr/debtor/$mark?code=$mark" > /dev/null
status "https://media.legarec.fr/$mark?code=$mark" --user-agent "$mark" --cookie "a=$mark" > /dev/null
loki() { docker compose exec -T grafana wget -qO- "http://loki:3100/loki/api/v1/$1"; }
for _ in $(seq 30); do
  loki 'query_range?query=%7Bapplication%3D%22legarec%22%2Ccontainer%3D~%22.*caddy.*%22%7D&limit=1000' > /tmp/caddy.json
  grep -q 'media.legarec.fr' /tmp/caddy.json && break
  sleep 3
done
grep -q 'paiement.legarec.fr' /tmp/caddy.json || fail 'logs of Caddy not collected'
grep -q '/debtor' /tmp/caddy.json || fail 'family of the route not logged'
loki 'query_range?query=%7Bapplication%3D%22legarec%22%7D&limit=5000' > /tmp/all.json
for pattern in "$mark" 'remote_ip' 'User-Agent'; do grep -q "$pattern" /tmp/all.json && fail "$pattern in the logs"; done
for name in api worker postgres caddy; do loki label/container/values | grep -q -- "-$name-" || fail "$name not collected"; done
docker compose logs --no-color 2>/dev/null | grep -q "$mark" && fail 'a path in the logs'
ok logs

# The worker ends by itself
docker compose stop worker
[ "$(docker inspect --format '{{.State.ExitCode}}' "$(docker compose ps --all --quiet worker)")" = 0 ] || fail 'the worker did not end by itself'
ok 'worker stopped'

# The restoration of docs/deploiement.md, for real
docker compose stop api postgres
docker compose run --rm --no-deps --volume legarec-app_postgres-data:/var/lib/postgresql/data --entrypoint legarec-pgbackrest sauvegarde --delta restore
docker compose up --detach --wait
expect 200 https://api.legarec.fr/health
docker compose run --rm migration | grep -q 'nothing to apply' || fail 'migrations, after a restoration'
ok restoration
