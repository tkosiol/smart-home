#!/usr/bin/env bash
# Tests for the Pi backups (backup/backup.sh, backup/restore-test.sh, the backup service in compose.yaml, the systemd
# units). Needs Docker: restic runs for real (the pinned image from compose.yaml) against a local repository folder
# instead of B2; curl is a stub. Nothing real is contacted; every secret and URL is invented.
# shellcheck disable=SC2016,SC2034 # check() expressions are evaluated later on purpose
set -u
cd "$(dirname "$0")/.." || exit 1
GATEWAY_DIR=$(pwd)
failures=0
passed=0

RESTIC_PASSWORD_MARKER=restic-password-that-must-never-appear
B2_KEY_MARKER=b2-app-key-that-must-never-appear
HC_BACKUP_MARKER=backup-ping-uuid-that-must-never-appear
HC_RESTORE_MARKER=restore-ping-uuid-that-must-never-appear
DATA_MARKER=zigbee-network-key-marker
PASSWD_MARKER=broker-password-file-marker

check() {
  if eval "$2"; then
    passed=$((passed + 1))
  else
    echo "FAIL: $1"
    failures=$((failures + 1))
    if [ -n "${VERBOSE:-}" ]; then
      sed 's/^/    out: /' "$OUT" 2> /dev/null | tail -n 25
      sed 's/^/    ping: /' "$PINGS" 2> /dev/null | sed -E 's#https://[^/]+/[^"]*#<url>#'
    fi
  fi
}

# Docker Desktop for Mac: restic cannot read files from bind mounts there (read: input/output error, on 0.18 and 0.19
# alike; cat can), so on a Mac the sources are named volumes that run() fills from the sandbox. On Linux (CI, the Pi)
# the real bind mounts of compose.yaml are used.
USE_VOLUMES=""
[ "$(uname -s)" != Darwin ] || USE_VOLUMES=1
[ -z "${SMART_TEST_VOLUMES:-}" ] || USE_VOLUMES=$SMART_TEST_VOLUMES
PROJECT=smart-gatewaybackuptest
export COMPOSE_PROJECT_NAME=$PROJECT

RESTIC_IMAGE=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(restic\/restic:[^[:space:]]*\).*/\1/p' compose.yaml | head -n 1)
[ -n "$RESTIC_IMAGE" ] || { echo "no restic/restic image in compose.yaml" >&2; exit 1; }

# A fresh sandbox laid out like /srv/smart-gateway: the package, provisioned secrets, Z2M data, a local repository.
setup() {
  WORK=$(mktemp -d)
  GW="$WORK/gw"
  mkdir -p "$GW/secrets" "$GW/zigbee2mqtt-data/log" "$GW/repo" "$WORK/bin" "$WORK/restore"
  cp "$GATEWAY_DIR/compose.yaml" "$GW/"
  cp -R "$GATEWAY_DIR/backup" "$GW/backup"
  ln -s "$GATEWAY_DIR/test/stubs/curl" "$WORK/bin/curl"
  printf 'GATEWAY_ID=gw-testpi01\nBROKER_HOST=mqtt.example.org\nBROKER_PORT=8883\nZ2M_SERIAL_DEVICE=/dev/null\n' > "$GW/secrets/gateway.env"
  printf 'ZIGBEE2MQTT_CONFIG_MQTT_USER=z2m\nZIGBEE2MQTT_CONFIG_MQTT_PASSWORD=x\nZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN=y\n' > "$GW/secrets/z2m.env"
  write_backup_env
  echo "$PASSWD_MARKER" > "$GW/secrets/passwd"
  cp "$GATEWAY_DIR/test/fixtures/configuration.yaml" "$GW/zigbee2mqtt-data/configuration.yaml"
  echo "$DATA_MARKER" >> "$GW/zigbee2mqtt-data/configuration.yaml"
  printf '{"id":1,"type":"EndDevice"}\n{"id":2,"type":"Router"}\n' > "$GW/zigbee2mqtt-data/database.db"
  echo "noisy log line" > "$GW/zigbee2mqtt-data/log/z2m.log"
  chmod 700 "$GW/secrets"
  chmod 600 "$GW"/secrets/*
  # Against a repository folder instead of B2 (the container runs as root like on the Pi; teardown removes its files).
  {
    echo "services:"
    echo "  backup:"
    echo "    environment:"
    echo "      RESTIC_REPOSITORY: /repo"
    echo "      RESTIC_CACHE_DIR: /tmp/restic-cache"
    if [ -n "$USE_VOLUMES" ]; then
      echo "    volumes: !override"
      echo "      - ./backup:/smart/backup:ro"
      echo "      - ./repo:/repo"
      echo "      - $PROJECT-z2m:/data/zigbee2mqtt-data:ro"
      echo "      - $PROJECT-secrets:/data/secrets:ro"
      echo "volumes:"
      echo "  $PROJECT-z2m: {external: true}"
      echo "  $PROJECT-secrets: {external: true}"
    else
      echo "    volumes:"
      echo "      - ./repo:/repo"
    fi
  } > "$GW/compose.override.yaml"
  OUT="$WORK/out"
  CALLS="$WORK/calls"
  PINGS="$WORK/pings"
  : > "$CALLS"
  : > "$PINGS"
  unset STUB_CURL_FAIL
  export PATH="$WORK/bin:$PATH"
  export STUB_CALLS="$CALLS" STUB_PING_LOG="$PINGS" SMART_GATEWAY_DIR="$GW"
}
write_backup_env() {
  {
    echo "B2_ENDPOINT=s3.example.invalid"
    echo "B2_BUCKET=smart-pi-restic-test"
    echo "B2_KEY_ID=keyid0123456789"
    echo "B2_APP_KEY=$B2_KEY_MARKER"
    echo "RESTIC_PASSWORD=$RESTIC_PASSWORD_MARKER"
    echo "HC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER"
    [ -z "${1:-}" ] || echo "HC_RESTORE_URL=https://hc-ping.example.invalid/$HC_RESTORE_MARKER"
  } > "$GW/secrets/backup.env"
  chmod 600 "$GW/secrets/backup.env"
}
teardown() {
  if [ -n "${SHOW:-}" ] && [ -s "$OUT" ]; then echo "--- output:"; cat "$OUT"; fi
  # The container wrote the repository and the restored files as root.
  docker run --rm --entrypoint rm -v "$WORK:/work" "$RESTIC_IMAGE" -rf /work/gw/repo /work/restore > /dev/null 2>&1
  rm -rf "$WORK"
  docker volume rm "$PROJECT-z2m" "$PROJECT-secrets" "${PROJECT}_backup-cache" > /dev/null 2>&1
}
# Copies the sandbox data into the named volumes (Mac only), as often as the test changed them.
sync_volumes() {
  docker run --rm --entrypoint sh -v "$PROJECT-z2m:/z2m" -v "$PROJECT-secrets:/secrets" -v "$GW:/gw:ro" "$RESTIC_IMAGE" -c \
    'rm -rf /z2m/* /z2m/.[!.]* /secrets/* /secrets/.[!.]* 2> /dev/null; cp -a /gw/zigbee2mqtt-data/. /z2m/ && cp -a /gw/secrets/. /secrets/' > /dev/null
}
run() { [ -z "$USE_VOLUMES" ] || sync_volumes; (bash "$GW/backup/$1" > "$OUT" 2>&1 < /dev/null); echo $?; }
# The pings that went out, as the path suffix after the marker ("" = success), one per line, markers named.
ping_log() {
  sed -n 's#^url = "https://hc-ping.example.invalid/\([a-z-]*\)\(.*\)"$#\1\2#p' "$PINGS" \
    | sed -e "s#^$HC_BACKUP_MARKER#backup#" -e "s#^$HC_RESTORE_MARKER#restore#"
}
pings_are() { [ "$(ping_log | tr '\n' ' ')" = "$1 " ]; }
restic_cli() {
  docker run --rm -e RESTIC_PASSWORD -e RESTIC_REPOSITORY=/repo -e RESTIC_CACHE_DIR=/tmp/c \
    -v "$GW/repo:/repo" -v "$WORK/restore:/restore" "$@"
}
restic() { RESTIC_PASSWORD=$RESTIC_PASSWORD_MARKER restic_cli --entrypoint restic "$RESTIC_IMAGE" "$@"; }
no_secret_in_logs() {
  ! grep -q -e "$RESTIC_PASSWORD_MARKER" -e "$B2_KEY_MARKER" -e "$HC_BACKUP_MARKER" -e "$HC_RESTORE_MARKER" -e "hc-ping.example" "$OUT" "$CALLS"
}

# --- the compose service and the units (no Docker run needed) ---
setup
check "the backup service uses a pinned restic image (a version tag, no latest)" '[[ "$RESTIC_IMAGE" =~ ^restic/restic:[0-9]+[.][0-9]+[.][0-9]+$ ]]'
check "the backup service only exists in the profile backup (a plain up never starts it)" \
  '! (cd "$GW" && docker compose --env-file secrets/gateway.env config --services) | grep -qx backup && (cd "$GW" && docker compose --env-file secrets/gateway.env --profile backup config --services) | grep -qx backup'
svc() { docker compose -f "$GW/compose.yaml" --project-directory "$GW" --env-file "$GW/secrets/gateway.env" --profile backup config backup 2>&1; }
check "the backup service reads secrets/backup.env as env file (no secret in argv or in the file)" 'grep -A2 "env_file:" "$GATEWAY_DIR/compose.yaml" | grep -q "./secrets/backup.env"'
check "the backup service mounts the Z2M data and the secrets read-only and takes the gateway ID as host" \
  'c=$(svc) && echo "$c" | grep -A3 "target: /data/zigbee2mqtt-data" | grep -q "read_only: true" && echo "$c" | grep -A3 "target: /data/secrets" | grep -q "read_only: true" && echo "$c" | grep -q "BACKUP_HOST_TAG: gw-testpi01"'
unit() { cat "$GATEWAY_DIR/systemd/$1"; }
check "the backup timer fires every night at 03:30 and catches up after a missed run" 'unit smart-gateway-backup.timer | grep -q "^OnCalendar=\*-\*-\* 03:30:00$" && unit smart-gateway-backup.timer | grep -q "^Persistent=true$" && unit smart-gateway-backup.timer | grep -q "^WantedBy=timers.target$"'
check "the backup service is a oneshot that runs backup.sh after the network and Docker are up" 'unit smart-gateway-backup.service | grep -q "^Type=oneshot$" && unit smart-gateway-backup.service | grep -q "^ExecStart=.*/srv/smart-gateway/backup/backup.sh$" && unit smart-gateway-backup.service | grep -q "^After=.*network-online.target.*docker.service"'
check "the restore test runs weekly (Sunday) through its own service" 'unit smart-gateway-restore-test.timer | grep -q "^OnCalendar=Sun " && unit smart-gateway-restore-test.service | grep -q "^ExecStart=.*/srv/smart-gateway/backup/restore-test.sh$"'
teardown

# --- backup.sh: back up, restore ---
setup
check "backup.sh succeeds against a local repository" '[ "$(run backup.sh)" = 0 ] && grep -q "backup completed" "$OUT"'
check "backup.sh pings start and then success on the backup URL, nothing else" 'pings_are "backup/start backup"'
check "the snapshot holds the Z2M data and the secrets, but not the Z2M log" \
  'l=$(restic ls latest 2>&1) && echo "$l" | grep -q "/data/zigbee2mqtt-data/configuration.yaml" && echo "$l" | grep -q "/data/zigbee2mqtt-data/database.db" && echo "$l" | grep -q "/data/secrets/passwd" && echo "$l" | grep -q "/data/secrets/backup.env" && ! echo "$l" | grep -q "z2m.log"'
check "the repository is encrypted: the plain data and the passwords appear nowhere in its files" '! grep -rq -e "$DATA_MARKER" -e "$PASSWD_MARKER" -e "$B2_KEY_MARKER" "$GW/repo"'
check "restoring the snapshot gives back the data byte for byte" \
  'restic restore latest --target /restore > /dev/null 2>&1 && cmp -s "$WORK/restore/data/zigbee2mqtt-data/configuration.yaml" "$GW/zigbee2mqtt-data/configuration.yaml" && cmp -s "$WORK/restore/data/zigbee2mqtt-data/database.db" "$GW/zigbee2mqtt-data/database.db" && cmp -s "$WORK/restore/data/secrets/passwd" "$GW/secrets/passwd"'
check "backup.sh logs no secret, no ping URL and passes none in the curl arguments" 'no_secret_in_logs'
check "backup.sh does not leave the container behind" '[ -z "$(docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=backup")" ]'
echo "changed" > "$GW/zigbee2mqtt-data/database.db"
check "a second backup works on the existing repository and applies the retention 7 daily, 4 weekly, 6 monthly" \
  '[ "$(run backup.sh)" = 0 ] && grep -q "keep 7 daily, 4 weekly, 6 monthly snapshots" "$OUT" && grep -q "no errors were found" "$OUT"'
check "the snapshots carry the gateway ID as host" 'restic snapshots 2>&1 | grep -q gw-testpi01'
teardown

setup
check "backup.sh fails and pings fail when the repository password does not match" \
  '[ "$(run backup.sh)" = 0 ] && sed -i.bak "s/^RESTIC_PASSWORD=.*/RESTIC_PASSWORD=another-password/" "$GW/secrets/backup.env" && : > "$PINGS" && [ "$(run backup.sh)" != 0 ] && pings_are "backup/start backup/fail" && ! grep -q "backup completed" "$OUT" && no_secret_in_logs'
teardown

setup; export STUB_CURL_FAIL=1
check "a failing healthchecks ping does not fail the backup" '[ "$(run backup.sh)" = 0 ] && grep -q "backup completed" "$OUT" && no_secret_in_logs'
teardown

# --- backup.env missing or malformed: a clear error, nothing logged ---
setup; rm "$GW/secrets/backup.env"
check "backup.sh without backup.env fails clearly, names the provisioning script and starts no container" \
  '[ "$(run backup.sh)" = 1 ] && grep -q "backup.env" "$OUT" && grep -q "provision-gateway" "$OUT" && [ ! -s "$PINGS" ] && [ -z "$(ls -A "$GW/repo")" ]'
check "restore-test.sh without backup.env fails the same way" '[ "$(run restore-test.sh)" = 1 ] && grep -q "backup.env" "$OUT" && [ ! -s "$PINGS" ]'
teardown
setup; rm "$GW/secrets/gateway.env"
check "backup.sh without gateway.env fails clearly" '[ "$(run backup.sh)" = 1 ] && grep -q "gateway.env" "$OUT" && [ ! -s "$PINGS" ]'
teardown

malformed() { # description, backup.env content (printf format), expected words in the message
  setup
  printf '%b' "$2" > "$GW/secrets/backup.env"
  expect=$3
  check "backup.sh rejects backup.env $1" '[ "$(run backup.sh)" = 1 ] && grep -qi -e "$expect" "$OUT" && no_secret_in_logs && [ -z "$(ls -A "$GW/repo")" ]'
  teardown
}
valid_head="B2_ENDPOINT=s3.example.invalid\nB2_BUCKET=smart-pi-restic-test\nB2_KEY_ID=keyid0123456789\nB2_APP_KEY=$B2_KEY_MARKER\nRESTIC_PASSWORD=$RESTIC_PASSWORD_MARKER\n"
malformed "that is empty" "" "B2_ENDPOINT"
malformed "without HC_BACKUP_URL" "$valid_head" "HC_BACKUP_URL"
malformed "without RESTIC_PASSWORD" "B2_ENDPOINT=s3.example.invalid\nB2_BUCKET=smart-pi-restic-test\nB2_KEY_ID=k\nB2_APP_KEY=$B2_KEY_MARKER\nHC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER\n" "RESTIC_PASSWORD"
malformed "with a line that is no KEY=value" "${valid_head}this line has $B2_KEY_MARKER but no equals sign\nHC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER\n" "line 6"
malformed "with an unknown key" "${valid_head}HC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER\nRESTIC_REPOSITORY=/elsewhere\n" "line 7"
malformed "with an empty value" "B2_ENDPOINT=\nB2_BUCKET=b\nB2_KEY_ID=k\nB2_APP_KEY=$B2_KEY_MARKER\nRESTIC_PASSWORD=$RESTIC_PASSWORD_MARKER\nHC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER\n" "B2_ENDPOINT"
malformed "with a key twice" "${valid_head}B2_BUCKET=another-bucket\nHC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER\n" "line 6"
malformed "with a quote or dollar in a value" "B2_ENDPOINT=s3.example.invalid\nB2_BUCKET=smart-pi-restic-test\nB2_KEY_ID=keyid0123456789\nB2_APP_KEY=a\$b$B2_KEY_MARKER\nRESTIC_PASSWORD=$RESTIC_PASSWORD_MARKER\nHC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER\n" "B2_APP_KEY"
malformed "with an endpoint that is a URL" "B2_ENDPOINT=https://s3.example.invalid\nB2_BUCKET=smart-pi-restic-test\nB2_KEY_ID=k\nB2_APP_KEY=$B2_KEY_MARKER\nRESTIC_PASSWORD=$RESTIC_PASSWORD_MARKER\nHC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER\n" "B2_ENDPOINT"
malformed "with a ping URL that is not https" "${valid_head}HC_BACKUP_URL=http://hc-ping.example.invalid/$HC_BACKUP_MARKER\n" "HC_BACKUP_URL"
setup
printf '%b' "${valid_head}HC_BACKUP_URL=https://hc-ping.example.invalid/$HC_BACKUP_MARKER\nthis is not valid\n" > "$GW/secrets/backup.env"
check "backup.sh pings fail when backup.env is malformed but the ping URL is usable" '[ "$(run backup.sh)" = 1 ] && pings_are "backup/fail" && no_secret_in_logs'
teardown
setup
{ echo "# comment"; echo; sed 's/^B2_BUCKET=.*/B2_BUCKET=smart-pi-restic-test/' "$GW/secrets/backup.env"; } > "$WORK/be" && cp "$WORK/be" "$GW/secrets/backup.env"
check "backup.sh accepts comments and blank lines in backup.env" '[ "$(run backup.sh)" = 0 ]'
teardown

# --- restore-test.sh ---
setup
run backup.sh > /dev/null
: > "$PINGS"
check "restore-test.sh passes on a good backup and says what it checked" '[ "$(run restore-test.sh)" = 0 ] && grep -q "restore test passed" "$OUT" && grep -q "configuration.yaml" "$OUT" && grep -q "database.db" "$OUT"'
check "restore-test.sh without a restore URL sends no ping on success" '[ ! -s "$PINGS" ]'
check "restore-test.sh logs no secret and restores no secrets to disk" 'no_secret_in_logs && ! grep -q "secrets" "$OUT"'
write_backup_env with_restore_url
check "restore-test.sh pings start and success on the restore URL when there is one" '[ "$(run restore-test.sh)" = 0 ] && pings_are "restore/start restore" && no_secret_in_logs'
teardown

setup
run backup.sh > /dev/null
: > "$GW/zigbee2mqtt-data/database.db"
run backup.sh > /dev/null
: > "$PINGS"
check "restore-test.sh fails when database.db is empty in the latest snapshot, and pings fail on the backup URL" \
  '[ "$(run restore-test.sh)" = 1 ] && grep -qi "database.db" "$OUT" && pings_are "backup/fail" && ! grep -q "restore test passed" "$OUT" && no_secret_in_logs'
write_backup_env with_restore_url
: > "$PINGS"
check "restore-test.sh pings fail on the restore URL when there is one" '[ "$(run restore-test.sh)" = 1 ] && pings_are "restore/start restore/fail"'
teardown

setup
run backup.sh > /dev/null
rm -f "$GW/zigbee2mqtt-data/configuration.yaml"
run backup.sh > /dev/null
check "restore-test.sh fails when configuration.yaml is missing in the latest snapshot" '[ "$(run restore-test.sh)" = 1 ] && grep -qi "configuration.yaml" "$OUT"'
teardown

setup
check "restore-test.sh fails when the repository has no snapshot" '[ "$(run restore-test.sh)" = 1 ] && grep -qi "snapshot\|repository" "$OUT" && no_secret_in_logs'
teardown

echo "backup tests: $passed passed, $failures failed"
[ "$failures" = 0 ]
