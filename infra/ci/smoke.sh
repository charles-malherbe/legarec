#!/bin/bash
# GitHub Actions only: what the stack must do, and must never do.
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] || { echo 'GitHub Actions only.' >&2; exit 1; }
cd "$(dirname "$0")/../.."
fail() { echo "FAILED: $1" >&2; exit 1; }
ok() { echo "ok: $1"; }
# Written to a file first: a command that fails, or that says nothing, proves nothing.
absent() { # what, pattern options…, then -- command
  local what="$1" options=()
  shift
  while [ "$1" != -- ]; do options+=("$1"); shift; done
  shift
  "$@" > /tmp/said 2>&1 || fail "$what: the command failed"
  [ -s /tmp/said ] || fail "$what: nothing to look into"
  if grep -q "${options[@]}" /tmp/said; then fail "$what"; fi
}
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
  if grep -qi '^server:' <<< "$headers"; then fail "$portal: server named"; fi
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
expect 404 https://api.legarec.fr//service/cases --path-as-is
expect 404 https://api.legarec.fr/service%2Fcases
expect 404 https://api.legarec.fr/x/../service/cases --path-as-is
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

# Public files: the bucket cannot be reached from here, the copy kept in the image answers (DECISIONS.md, 27/11/2026)
expect 200 https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete.png
expect 200 https://media.legarec.fr/marque/legarec-kit-media.zip
headers="$(get --head https://media.legarec.fr/e-mails/v1/legarec-logo-en-tete-negatif.png | tr -d '\r')"
for header in 'content-type: image/png' 'cache-control: public, max-age=31536000, immutable' "content-security-policy: default-src 'none'" 'strict-transport-security: ' 'x-content-type-options: nosniff'; do
  [ "$(grep -ci "^$header" <<< "$headers")" = 1 ] || fail "media copy: $header, once"
done
# Never the listing of a folder. A file in neither the copy nor the bucket gets the 502 of the proxy, never an empty
# page: the last request of « Technical logs » checks it, and must stay the only 502 until then.
expect 404 https://media.legarec.fr/marque/
ok 'media copy'

# Addresses of the firm only
expect 403 https://n8n.legarec.fr/
expect 403 https://n8n.legarec.fr/ --header 'X-Forwarded-For: 192.0.2.1' --header 'Forwarded: for=192.0.2.1'
sed -i 's/^AUTHORIZED_IPS=.*/AUTHORIZED_IPS=172.16.0.0\/12 192.168.0.0\/16 10.0.0.0\/8 fd00::\/8/' /etc/legarec/caddy.env
docker compose up --detach --wait --force-recreate caddy
expect 200 https://n8n.legarec.fr/healthz
ok 'addresses of the firm'

# Containers
for id in $(docker compose ps --quiet); do
  name="$(docker inspect --format '{{.Name}}' "$id")"
  user="$(docker inspect --format '{{.Config.User}}' "$id")"
  [[ "$user" =~ ^(999|10[01][0-9]{2}):[0-9]+$ ]] || fail "$name runs as '$user'"
  docker inspect --format '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.Memory}} {{.HostConfig.Privileged}}' "$id" | grep -qE '^true \[ALL\] [1-9][0-9]+ false$' || fail "$name is not closed"
  absent "$name sees Docker" docker.sock -- docker inspect --format '{{json .Mounts}}' "$id"
  published="$(docker inspect --format '{{range $port, $to := .HostConfig.PortBindings}}{{$port}} {{end}}' "$id")"
  [[ "$name" == *caddy* || -z "$published" ]] || fail "$name publishes $published"
done
# No value, in what Docker shows of the containers and of their images, nor on a command line.
cut -s -d= -f2- /etc/legarec/*.env | grep -E '^[0-9a-f]{48}$|^[A-Za-z0-9+/]{43}=$' | sort -u > /tmp/values
[ "$(wc -l < /tmp/values)" -ge 12 ] || fail 'no value to look for'
mapfile -t ids < <(docker compose ps --all --quiet)
absent 'a value in docker inspect' -Ff /tmp/values -- docker inspect "${ids[@]}"
mapfile -t images < <(docker image ls --quiet --filter 'reference=legarec/*')
absent 'a value in an image' -Ff /tmp/values -- docker image inspect "${images[@]}"
absent 'a value in a command line' -Ff /tmp/values -- ps -eo args
absent 'the password of the superuser in the server' -Ff /tmp/values -- docker compose exec -T postgres sh -c 'cat /proc/[0-9]*/environ | tr "\0" "\n"'
grep -q '^PGDATA=' /tmp/said || fail 'witness: the environment of the server was not read'
ok containers

# Only the networks they need. A witness shows that the tool works.
address() { docker inspect --format "{{(index .NetworkSettings.Networks \"legarec-app_$2\").IPAddress}}" "$(docker compose ps --quiet "$1")"; }
docker compose exec -T caddy nc -z -w 2 "$(address api api)" 3000 || fail 'witness of the networks'
for to in "postgres donnees 5432" "valkey donnees 6379" "loki journaux 3100" "api donnees 3000"; do
  read -r name network port <<< "$to"
  ip="$(address "$name" "$network")"
  # Nor a portal.
  if docker compose exec -T espace nc -z -w 2 "$ip" "$port"; then fail "espace reaches $name"; fi
  # Nor the server itself.
  if nc -z -w 2 "$ip" "$port"; then fail "the server reaches $name"; fi
done
nc -z -w 2 127.0.0.1 443 || fail 'witness of the server'
docker compose exec -T valkey valkey-cli ping > /tmp/said 2>&1 || true
grep -q NOAUTH /tmp/said || fail 'Valkey without a password'
ok networks

# Antivirus: heard by the worker alone, and it tells a clean file from the test file of the antivirus makers
clamd="$(address clamav antivirus)"
instream="$(cat infra/ci/instream.mjs)"
docker compose exec -T worker node -e "$instream" "$clamd" clean > /tmp/said 2>&1 || fail 'the worker does not reach the antivirus'
grep -q ' OK$' /tmp/said || fail 'the antivirus on a clean file'
docker compose exec -T worker node -e "$instream" "$clamd" sick > /tmp/said 2>&1 || fail 'the antivirus on the test file'
grep -q ' FOUND$' /tmp/said || fail 'the antivirus does not find the test file'
[ "$(docker compose exec -T worker node -e 'console.log(process.env.CLAMAV_URL)')" = tcp://clamav:3310 ] || fail 'the worker has no antivirus'
if nc -z -w 2 "$clamd" 3310; then fail 'the server reaches the antivirus'; fi
# The image of the API has no nc: the same probe from the worker is its witness.
probe="import('node:net').then(({ connect }) => connect({ host: process.argv[1], port: 3310 }).setTimeout(2000, () => process.exit(1)).on('connect', () => process.exit(0)).on('error', () => process.exit(1)))"
docker compose exec -T worker node -e "$probe" "$clamd" || fail 'witness of the antivirus'
if docker compose exec -T api node -e "$probe" "$clamd"; then fail 'the API reaches the antivirus'; fi
if docker compose exec -T espace nc -z -w 2 "$clamd" 3310; then fail 'a portal reaches the antivirus'; fi
# clamd reads hostile files: on the network of the worker alone, with no way out; the update of the signatures is apart.
networks() { docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$(docker compose ps --quiet "$1")"; }
[ "$(networks clamav)" = 'legarec-app_antivirus ' ] || fail 'clamd is on another network than that of the worker'
[ "$(networks freshclam)" = 'legarec-app_sortie-antivirus ' ] || fail 'freshclam is on another network than its way out'
# n8n: Caddy, the API and the internal checks, and its own way out.
[ "$(networks n8n)" = 'legarec-app_automatisations legarec-app_sortie-n8n ' ] || fail 'n8n is on other networks than its own'
[ "$(docker compose exec -T clamav sh -c 'echo "$CLAMAV_NO_FRESHCLAMD"')" = true ] || fail 'clamd updates its signatures itself'
[ "$(docker compose exec -T freshclam sh -c 'echo "$CLAMAV_NO_CLAMD"')" = true ] || fail 'a second clamd beside freshclam'
if docker compose exec -T freshclam sh -c 'test -S /tmp/clamd.sock'; then fail 'clamd runs beside freshclam'; fi
ok antivirus

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
if grep -q 'monitoring not told' /tmp/restore; then fail 'monitoring not told'; fi
# A mark written in a table, then backed up without compression: only the encryption can hide it.
mark="ZQXM$(openssl rand -hex 16)"
sql() { docker compose exec -T postgres psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --username postgres --dbname legarec --command "$1"; }
sql "CREATE TABLE ci_mark AS SELECT '$mark-' || n AS mark FROM generate_series(1, 5000) AS n"
sql CHECKPOINT
[ "$(sql 'SHOW archive_mode')" = on ] || fail 'the journal is not archived'
data="$(docker volume inspect --format '{{.Mountpoint}}' legarec-app_postgres-data)"
grep -rqa "$mark" "$data/base" || fail 'witness: the mark is not in the data folder'
docker compose run --rm --entrypoint legarec-pgbackrest sauvegarde --type=full --compress-type=none backup
if grep -rqa "$mark" /var/lib/legarec-ci/depot; then fail 'a backup is not encrypted'; fi
# The index of the backups too.
for file in /var/lib/legarec-ci/depot/backup/legarec/backup.info /var/lib/legarec-ci/depot/archive/legarec/archive.info; do
  [ "$(head -c 8 "$file")" = Salted__ ] || fail "not encrypted: $file"
done
# And a file of the journal.
journal="$(find /var/lib/legarec-ci/depot/archive -type f -name '0*.zst' -print -quit)"
[ -n "$journal" ] || fail 'no journal to look into'
[ "$(head -c 8 "$journal")" = Salted__ ] || fail "not encrypted: $journal"
sql 'DROP TABLE ci_mark'
ok backups

# Technical logs: collected, and nothing personal
mark="ZQXJ$RANDOM$RANDOM"
status "https://paiement.legarec.fr/$mark?email=$mark" > /dev/null
status "https://api.legarec.fr/debtor/$mark?code=$mark" > /dev/null
curl --silent --insecure --output /dev/null --resolve api.legarec.fr:443:127.0.0.1 --request-target "https://api.legarec.fr/debtor/$mark?code=$mark" https://api.legarec.fr/
status "https://media.legarec.fr/$mark?code=$mark" --user-agent "$mark" --cookie "a=$mark" > /dev/null
# Read from a passing container of the worker's image, on the network of the logs alone.
worker_image="$(docker inspect --format '{{.Config.Image}}' "$(docker compose ps --quiet worker)")"
loki() {
  docker run --rm --network legarec-app_journaux --entrypoint node "$worker_image" -e \
    "fetch('http://loki:3100/loki/api/v1/' + process.argv[1]).then((answer) => answer.text()).then((text) => process.stdout.write(text))" "$1"
}
for _ in $(seq 30); do
  loki 'query_range?query=%7Bapplication%3D%22legarec%22%2Ccontainer%3D~%22.*caddy.*%22%7D&limit=1000' > /tmp/caddy.json
  # The last of the requests above, the only 502: the bucket cannot be reached from here and the copy lacks this file.
  grep -qE 'status[\\]+":502' /tmp/caddy.json && break
  sleep 3
done
grep -qE 'status[\\]+":502' /tmp/caddy.json || fail 'last request not collected'
grep -q 'paiement.legarec.fr' /tmp/caddy.json || fail 'logs of Caddy not collected'
grep -q '/debtor' /tmp/caddy.json || fail 'family of the route not logged'
loki 'query_range?query=%7Bapplication%3D%22legarec%22%7D&limit=5000' > /tmp/all.json
for pattern in "$mark" remote_ip User-Agent; do absent "$pattern in the logs" "$pattern" -- cat /tmp/all.json; done
for name in api worker postgres caddy; do loki label/container/values | grep -q -- "-$name-" || fail "$name not collected"; done
absent 'a path in the logs' "$mark" -- docker compose logs --no-color caddy espace paiement api
ok logs

# The first Director, by the command of docs/deploiement.md: once, and its link is in no log
docker compose exec -T worker node --env-file=/run/secrets/worker dist/account.js director ci@example.com Ada Essai > /tmp/link
link="$(grep -oE 'https://espace\.legarec\.fr/[^[:space:]]+' /tmp/link | head -n 1)"
[ -n "$link" ] || fail 'no link for the first Director'
if docker compose exec -T worker node --env-file=/run/secrets/worker dist/account.js director ci2@example.com Ada Essai > /tmp/said 2>&1; then fail 'a second Director'; fi
# The purge at once, after a restoration (docs/deploiement.md).
docker compose exec -T worker node --env-file=/run/secrets/worker dist/purge.js > /tmp/purged 2>&1 || fail 'the purge at once'
grep -q '^Purge faite' /tmp/purged || fail 'what the purge says'
get --output /dev/null "$link"
absent 'the link of the Director in the logs' -F "${link##*/}" -- docker compose logs --no-color worker caddy api
ok 'first Director'

# The worker ends by itself
docker compose stop worker
[ "$(docker inspect --format '{{.State.ExitCode}}' "$(docker compose ps --all --quiet worker)")" = 0 ] || fail 'the worker did not end by itself'
ok 'worker stopped'

# The restoration of docs/deploiement.md, for real
docker compose stop caddy api postgres
docker compose run --rm restauration
docker compose up --detach --wait postgres
docker compose exec -T postgres psql --username postgres --dbname legarec --tuples-only --no-align --command 'SELECT pg_is_in_recovery()' > /tmp/said
for _ in $(seq 30); do
  docker compose exec -T postgres psql --username postgres --dbname legarec --tuples-only --no-align --command 'SELECT pg_is_in_recovery()' > /tmp/said
  grep -qx f /tmp/said && break
  sleep 2
done
grep -qx f /tmp/said || fail 'the restored server is still read-only'
docker compose exec -T postgres legarec-hold-tasks
docker compose up --detach --wait
expect 200 https://api.legarec.fr/health
docker compose run --rm migration | grep -q 'nothing to apply' || fail 'migrations, after a restoration'
docker compose run --rm sauvegarde incr
# Every file of the backups and of the journal reads back.
docker compose run --rm sauvegarde verify || fail 'the verification of the backups'
ok restoration
