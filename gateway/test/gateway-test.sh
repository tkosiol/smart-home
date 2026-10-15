#!/usr/bin/env bash
# Tests for the gateway package (render.sh, mosquitto.conf.template, compose.yaml). Needs Docker and OpenSSL 3.
# The Raspberry Pi's stack runs for real (compose.yaml with the pinned images), bridged over mTLS to a throwaway
# "VPS" broker (the platform's broker image, throwaway CA from pki.sh). Nothing real is touched; all certificates
# and passwords are invented at runtime. The only thing missing is the Zigbee adapter (see the Zigbee2MQTT part).
# shellcheck disable=SC2016,SC2034 # check() expressions are evaluated later on purpose (they read status and out)
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)
PKI_SH="$ROOT/infra/pki/pki.sh"
PREFIX=smart-gatewaytest
NET=$PREFIX
BROKER_IMAGE=$PREFIX-broker:local
MOSQUITTO_IMAGE=eclipse-mosquitto:2.1.2-alpine
HELPER_IMAGE=alpine:3.24.2
failures=0
passed=0

OSSL=""
for candidate in "${SMART_OPENSSL:-openssl}" /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
  if command -v "$candidate" > /dev/null 2>&1 && "$candidate" version | grep -Eq '^OpenSSL [3-9]'; then
    OSSL=$(command -v "$candidate")
    break
  fi
done
[ -n "$OSSL" ] || { echo "gateway tests need OpenSSL 3 or newer (set SMART_OPENSSL)" >&2; exit 1; }
export SMART_OPENSSL="$OSSL"

WORK=$(mktemp -d)
GW="$WORK/gw" # the stack directory, laid out like /srv/smart-gateway on the Pi
GATEWAY_ID=gw-testpi01
Z2M_USER=z2m
Z2M_PASSWORD=test-z2m-password
Z2M_TOKEN=test-frontend-token
API_PASSWORD=gateway-test-api

compose() {
  docker compose -p "$PREFIX" --project-directory "$GW" --env-file "$GW/secrets/gateway.env" \
    -f "$GW/compose.yaml" -f "$GW/compose.test.yaml" "$@"
}
remove_test_containers() {
  # By label and name, so leftovers of an aborted run go too (the compose files of that run are gone).
  docker ps -aq --filter "label=com.docker.compose.project=$PREFIX" | xargs docker rm -fv > /dev/null 2>&1
  docker rm -fv "$PREFIX-broker" "$PREFIX-control" "$PREFIX-volume" "$PREFIX-collector" > /dev/null 2>&1
  docker volume rm "$PREFIX-secrets" "${PREFIX}_mosquitto-data" > /dev/null 2>&1
  docker network rm "${PREFIX}_gateway" "$NET" > /dev/null 2>&1
}
cleanup() {
  remove_test_containers
  # Zigbee2MQTT writes into its data folder as root.
  docker run --rm -v "$WORK:/w" "$HELPER_IMAGE" rm -rf /w/gw/zigbee2mqtt-data > /dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT
remove_test_containers

check() {
  if eval "$2"; then passed=$((passed + 1)); else echo "FAIL: $1"; failures=$((failures + 1)); fi
}
quiet() { "$@" > /dev/null 2>&1; }
must() {
  "$@" > /dev/null 2>&1 || { echo "could not run: $*" >&2; exit 1; }
}
wait_for() {
  for _ in $(seq 1 60); do
    if "$@" > /dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

# --- the package as the deploy copies it, and the secrets as provision-gateway.sh writes them ---
mkdir -p "$GW/secrets"
cp gateway/compose.yaml gateway/mosquitto.conf.template gateway/mosquitto-entrypoint.sh gateway/render.sh "$GW/"
mkdir -p "$GW/zigbee2mqtt-data"
cp gateway/test/fixtures/configuration.yaml "$GW/zigbee2mqtt-data/configuration.yaml"
cat > "$GW/secrets/gateway.env" << ENV
GATEWAY_ID=$GATEWAY_ID
BROKER_HOST=broker
BROKER_PORT=8883
Z2M_SERIAL_DEVICE=/dev/null
ENV
cat > "$GW/secrets/z2m.env" << ENV
ZIGBEE2MQTT_CONFIG_MQTT_USER=$Z2M_USER
ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD=$Z2M_PASSWORD
ZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN=$Z2M_TOKEN
ENV
# Test overrides only: reach the throwaway broker, never publish the frontend port on the developer's machine,
# and let a Zigbee2MQTT without adapter stop instead of restarting in a loop.
cat > "$GW/compose.test.yaml" << YAML
services:
  mosquitto:
    networks: [gateway, vps]
  zigbee2mqtt:
    ports: !reset []
    restart: 'no'
networks:
  vps:
    name: $NET
    external: true
YAML

# --- render.sh ---
RENDER="$GW/render.sh"
run_render() { SMART_GATEWAY_DIR="$GW" bash "$RENDER"; }
# Rewrites gateway.env with the given values; render.sh must refuse bad ones without touching run/.
render_with() {
  printf 'GATEWAY_ID=%s\nBROKER_HOST=%s\nBROKER_PORT=%s\n' "$1" "$2" "$3" > "$GW/secrets/gateway.env.try"
  mv "$GW/secrets/gateway.env" "$GW/secrets/gateway.env.keep"
  mv "$GW/secrets/gateway.env.try" "$GW/secrets/gateway.env"
  status=0
  out=$(run_render 2>&1) || status=$?
  mv "$GW/secrets/gateway.env.keep" "$GW/secrets/gateway.env"
}
reject() {
  local what="$1"
  shift
  mkdir -p "$GW/run"
  printf 'previous\n' > "$GW/run/mosquitto.conf"
  render_with "$@"
  check "render.sh rejects $what" '[ "$status" -ne 0 ] && [ "$(cat "$GW/run/mosquitto.conf")" = previous ] && [ -z "$(find "$GW/run" -name ".*" -type f)" ]'
  rm -rf "$GW/run"
}
reject "an ID of the wrong length" gw-short gateway.example.org 8883
reject "an ID with upper case letters" gw-ABCDEFGH gateway.example.org 8883
reject "an ID with a carriage return (file saved with Windows line ends)" "$(printf 'gw-abcdefgh\r')" gateway.example.org 8883
reject "an ID without the prefix" abcdefgh gateway.example.org 8883
reject "a host with a space" gw-abcdefgh 'bad host' 8883
reject "a host with a semicolon" gw-abcdefgh 'a.example.org;b' 8883
reject "a host with a brace" gw-abcdefgh 'a{{GATEWAY_ID}}' 8883
reject "an empty host" gw-abcdefgh '' 8883
reject "a host starting with a hyphen" gw-abcdefgh -a.example.org 8883
reject "a host with a double dot" gw-abcdefgh a..example.org 8883
reject "a host with a port inside" gw-abcdefgh a.example.org:8883 8883
reject "port 0" gw-abcdefgh gateway.example.org 0
reject "port 70000" gw-abcdefgh gateway.example.org 70000
reject "a port with letters" gw-abcdefgh gateway.example.org 88a3
reject "an empty port" gw-abcdefgh gateway.example.org ''
rm -f "$GW/secrets/gateway.env.keep"
# A missing or empty frontend token must stop the render: the frontend would be open in the home network.
reject_token() {
  local what="$1"
  mkdir -p "$GW/run"
  printf 'previous\n' > "$GW/run/mosquitto.conf"
  mv "$GW/secrets/z2m.env" "$GW/secrets/z2m.env.keep"
  case "$2" in
    none) ;;
    nokey) printf 'ZIGBEE2MQTT_CONFIG_MQTT_USER=%s\n' "$Z2M_USER" > "$GW/secrets/z2m.env" ;;
    *) printf 'ZIGBEE2MQTT_CONFIG_MQTT_USER=%s\nZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN=%s\n' "$Z2M_USER" "$3" > "$GW/secrets/z2m.env" ;;
  esac
  status=0
  out=$(run_render 2>&1) || status=$?
  rm -f "$GW/secrets/z2m.env"
  mv "$GW/secrets/z2m.env.keep" "$GW/secrets/z2m.env"
  check "render.sh stops on $what" '[ "$status" -ne 0 ] && [ "$(cat "$GW/run/mosquitto.conf")" = previous ] && ! echo "$out" | grep -q "$Z2M_TOKEN"'
  rm -rf "$GW/run"
}
reject_token "a missing z2m.env" none
reject_token "an empty frontend token" file ""
reject_token "a z2m.env without a frontend token" nokey ""
status=0
out=$(SMART_GATEWAY_DIR="$WORK/nowhere" bash "$RENDER" 2>&1) || status=$?
check "render.sh stops when gateway.env is missing" '[ "$status" -ne 0 ] && [ ! -e "$WORK/nowhere/run" ]'

run_render > /dev/null
check "render.sh writes run/mosquitto.conf" '[ -s "$GW/run/mosquitto.conf" ]'
check "the rendered file is mode 600" '[ "$(find "$GW/run/mosquitto.conf" -perm 600 | wc -l | tr -d " ")" = 1 ]'
check "no placeholder is left" '! grep -q "{{" "$GW/run/mosquitto.conf"'
check "the id and host land where they belong" 'grep -qx "connection $GATEWAY_ID-bridge" "$GW/run/mosquitto.conf" && grep -qx "address broker:8883" "$GW/run/mosquitto.conf" && grep -qx "notification_topic gw/$GATEWAY_ID/bridge/connection" "$GW/run/mosquitto.conf"'
check "only placeholder lines differ from the template" '[ "$(diff gateway/mosquitto.conf.template "$GW/run/mosquitto.conf" | grep -c "^>")" = "$(grep -c "{{" gateway/mosquitto.conf.template)" ]'
check "the buffer limits of ADR-0020 are in the file" 'grep -qx "max_queued_messages 75000" "$GW/run/mosquitto.conf" && grep -qx "max_queued_bytes 75497472" "$GW/run/mosquitto.conf" && grep -qx "queue_qos0_messages true" "$GW/run/mosquitto.conf" && ! grep -q per_listener_settings "$GW/run/mosquitto.conf"'
rendered_has_all() {
  local ok=0 line
  for line in "$@"; do
    grep -qxF "$line" "$GW/run/mosquitto.conf" || { echo "missing: $line"; ok=1; }
  done
  return "$ok"
}
check "the bridge settings and topics of ADR-0020 are in the file" 'rendered_has_all "cleansession false" "keepalive_interval 20" "restart_timeout 1 5" "try_private true" "notifications true" "bridge_tls_version tlsv1.2" "topic # out 1 zigbee2mqtt/ gw/$GATEWAY_ID/z2m/" "topic +/set in 0 zigbee2mqtt/ gw/$GATEWAY_ID/z2m/" "topic bridge/request/# in 0 zigbee2mqtt/ gw/$GATEWAY_ID/z2m/"'
check "a second run replaces the file and leaves nothing behind" 'run_render > /dev/null && [ "$(ls -A "$GW/run")" = mosquitto.conf ]'
SMART_GATEWAY_DIR="$GW" bash "$RENDER" > /dev/null
# The compose files of the package, valid with the secrets in place.
check "compose.yaml is valid and pins the images" 'compose config | grep -q "image: eclipse-mosquitto:2.1.2-alpine" && compose config | grep -q "image: koenkk/zigbee2mqtt:2.14.2"'
check "compose.yaml publishes nothing but the Zigbee2MQTT frontend" '[ "$(docker compose -p "$PREFIX" --project-directory "$GW" --env-file "$GW/secrets/gateway.env" -f "$GW/compose.yaml" config --format json | grep -o "\"published\"" | wc -l | tr -d " ")" = 1 ]'

# --- throwaway PKI and the "VPS" broker ---
export SMART_PKI_PASSPHRASE_FILE="$WORK/passphrase"
printf 'gateway test passphrase\n' > "$SMART_PKI_PASSPHRASE_FILE"
pki() { SMART_PKI_DIR="$WORK/pki" bash "$PKI_SH" "$@" < /dev/null > /dev/null; }
if ! { pki init-ca && pki issue-server broker && pki issue-gateway "$GATEWAY_ID"; }; then
  echo "could not set up the throwaway PKI" >&2
  exit 1
fi
mkdir -p "$WORK/certs/public" "$WORK/certs/private"
for f in ca.crt server.crt crl.pem; do cp "$WORK/pki/$f" "$WORK/certs/public/$f"; done
cp "$WORK/pki/server.key" "$WORK/certs/private/server.key"
# What provision-gateway.sh puts into secrets/: the CA, the gateway certificate and key, the password file of
# the local users (made by mosquitto_passwd in a container, like on the Pi). Same modes as on the Pi: 700/600.
cp "$WORK/pki/ca.crt" "$GW/secrets/ca.crt"
cp "$WORK/pki/gateways/$GATEWAY_ID.crt" "$GW/secrets/gateway.crt"
cp "$WORK/pki/gateways/$GATEWAY_ID.key" "$GW/secrets/gateway.key"
docker run --rm -u "$(id -u):$(id -g)" -v "$GW/secrets:/s" "$MOSQUITTO_IMAGE" mosquitto_passwd -c -b /s/passwd "$Z2M_USER" "$Z2M_PASSWORD" > /dev/null 2>&1
chmod 700 "$GW/secrets"
chmod 600 "$GW"/secrets/*

docker build -q -t "$BROKER_IMAGE" infra/broker > /dev/null || { echo "docker build failed" >&2; exit 1; }
must docker network create "$NET"
must docker run -d --name "$PREFIX-broker" --network "$NET" --network-alias broker --read-only \
  --tmpfs /mosquitto/run --tmpfs /tmp -v /mosquitto/data \
  -v "$WORK/certs/public:/mosquitto/certs:ro" -v "$WORK/certs/private:/mosquitto/certs-private:ro" \
  -e MQTT_USER=smart-api -e MQTT_PASSWORD="$API_PASSWORD" -e MQTT_TLS=on "$BROKER_IMAGE"
vps_up() { docker exec "$PREFIX-broker" sh -c 'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "\$SYS/broker/uptime" -C 1 -W 2'; }
check "the throwaway VPS broker starts" 'wait_for vps_up'

# Reads one message on the VPS broker as smart-api; prints "<retain flag> <payload>" or nothing.
vps_read() {
  docker exec "$PREFIX-broker" sh -c 'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "$0" -F "%r %p" -C 1 -W 3' "$1" 2> /dev/null || true
}
expect_vps() {
  local got="" attempt=0
  while [ "$attempt" -lt 25 ]; do
    got=$(vps_read "$1")
    [ "$got" = "$2" ] && return 0
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "FAIL: $1 is '$got' (retain flag and payload), expected '$2'" >&2
  return 1
}
vps_pub() {
  docker exec "$PREFIX-broker" sh -c 'mosquitto_pub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "$0" -m "$1"' "$1" "$2"
}
# Local broker of the gateway, as the Zigbee2MQTT user.
health_bridge_is_up() { [ "$(compose exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u health -P health -t 'gw/+/bridge/connection' -C 1 -W 3 2> /dev/null)" = 1 ]; }
local_pub() { compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -u "$Z2M_USER" -P "$Z2M_PASSWORD" "$@"; }
local_sub() { compose exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u "$Z2M_USER" -P "$Z2M_PASSWORD" "$@"; }

# --- secrets that belong to root: Mosquitto must still be able to read them ---
# On the Pi secrets/ is root 700 with files 600. Mosquitto reads the password file and the bridge key after it
# dropped privileges, so the stack copies them into a tmpfs owned by the broker user (mosquitto-entrypoint.sh).
must docker volume create "$PREFIX-secrets"
docker run --rm -v "$PREFIX-secrets:/d" -v "$GW/secrets:/s:ro" "$HELPER_IMAGE" \
  sh -c 'cp /s/passwd /s/ca.crt /s/gateway.crt /s/gateway.key /d/ && chown -R 0:0 /d && chmod 700 /d && chmod 600 /d/*' > /dev/null 2>&1
# Control: the plain image with the root-owned files mounted where the configuration expects them. If this
# works, the copy in the entry point is unnecessary and the check below must say so.
must docker run -d --name "$PREFIX-control" --network "$NET" -v "$PREFIX-secrets:/mosquitto/secrets:ro" \
  -v "$GW/run/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" "$MOSQUITTO_IMAGE"
sleep 6
control_log=$(docker logs "$PREFIX-control" 2>&1)
control_bridge=$(vps_read "gw/$GATEWAY_ID/bridge/connection")
docker rm -fv "$PREFIX-control" > /dev/null 2>&1
echo "note: control run (plain image, root-owned 600 secrets): bridge state '$control_bridge'; log: $(echo "$control_log" | grep -iE 'error|unable|denied' | head -3 | tr '\n' '|')"
check "control: without the copy, root-owned 600 secrets are not readable by Mosquitto" \
  '[ "$control_bridge" != "1 1" ] || echo "$control_log" | grep -qiE "unable to open|permission denied|error"'
# Same files through the entry point: the bridge comes up and the local password works.
must docker run -d --name "$PREFIX-volume" --network "$NET" --entrypoint sh \
  -v "$PREFIX-secrets:/mosquitto/secrets-src:ro" --tmpfs /mosquitto/secrets:uid=1883,gid=1883,mode=0700 \
  -v "$GW/mosquitto-entrypoint.sh:/smart/mosquitto-entrypoint.sh:ro" \
  -v "$GW/run/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" "$MOSQUITTO_IMAGE" \
  /smart/mosquitto-entrypoint.sh mosquitto -c /mosquitto/config/mosquitto.conf
check "root-owned 600 secrets work through the entry point (bridge connected)" 'expect_vps "gw/$GATEWAY_ID/bridge/connection" "1 1"'
check "root-owned 600 secrets work through the entry point (local password)" \
  'docker exec "$PREFIX-volume" mosquitto_pub -h 127.0.0.1 -u "$Z2M_USER" -P "$Z2M_PASSWORD" -t zigbee2mqtt/ping -m 1'
docker rm -fv "$PREFIX-volume" > /dev/null 2>&1
# An incomplete secrets directory stops the container with a message instead of starting a half broker.
must docker run -d --name "$PREFIX-control" --network "$NET" --entrypoint sh \
  --tmpfs /mosquitto/secrets-src --tmpfs /mosquitto/secrets \
  -v "$GW/mosquitto-entrypoint.sh:/smart/mosquitto-entrypoint.sh:ro" "$MOSQUITTO_IMAGE" \
  /smart/mosquitto-entrypoint.sh mosquitto -c /mosquitto/config/mosquitto.conf
wait_for sh -c '[ "$(docker inspect -f "{{.State.Running}}" '"$PREFIX"'-control)" = false ]'
check "missing secrets stop the container with a message" \
  '[ "$(docker inspect -f "{{.State.Running}}" "$PREFIX-control")" = false ] && docker logs "$PREFIX-control" 2>&1 | grep -q "passwd is missing or empty"'
docker rm -fv "$PREFIX-control" > /dev/null 2>&1
# A password file that already has the user "health" is refused: that name is the entry point's restricted user.
mkdir "$WORK/health-secrets"
cp "$GW"/secrets/* "$WORK/health-secrets/"
docker run --rm -u "$(id -u):$(id -g)" -v "$WORK/health-secrets:/s" "$MOSQUITTO_IMAGE" mosquitto_passwd -b /s/passwd health something > /dev/null 2>&1
must docker run -d --name "$PREFIX-control" --network "$NET" --entrypoint sh \
  -v "$WORK/health-secrets:/mosquitto/secrets-src:ro" --tmpfs /mosquitto/secrets \
  -v "$GW/mosquitto-entrypoint.sh:/smart/mosquitto-entrypoint.sh:ro" "$MOSQUITTO_IMAGE" \
  /smart/mosquitto-entrypoint.sh mosquitto -c /mosquitto/config/mosquitto.conf
wait_for sh -c '[ "$(docker inspect -f "{{.State.Running}}" '"$PREFIX"'-control)" = false ]'
check "a password file with the user health is refused with a message" \
  '[ "$(docker inspect -f "{{.State.Running}}" "$PREFIX-control")" = false ] && docker logs "$PREFIX-control" 2>&1 | grep -q "must not contain the user health"'
docker rm -fv "$PREFIX-control" > /dev/null 2>&1

# --- the real stack: Mosquitto of the gateway, bridged to the VPS broker ---
compose up -d --wait --no-deps mosquitto > "$WORK/up.log" 2>&1
check "the gateway's Mosquitto starts and its health check (local user) passes" \
  '[ "$(docker inspect -f "{{.State.Health.Status}}" "$(compose ps -q mosquitto)")" = healthy ]'
check "Mosquitto publishes no port" '[ -z "$(docker port "$(compose ps -q mosquitto)")" ]'
check "Mosquitto runs under the memory limit of 256 MB" '[ "$(docker inspect -f "{{.HostConfig.Memory}}" "$(compose ps -q mosquitto)")" = 268435456 ]'
check "the log rotates (10 MB x 3)" '[ "$(docker inspect -f "{{.HostConfig.LogConfig.Config}}" "$(compose ps -q mosquitto)")" = "map[max-file:3 max-size:10m]" ]'
check "the local listener refuses anonymous clients" '! quiet compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -t zigbee2mqtt/x -m 1'
check "the local listener refuses a wrong password" '! quiet compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -u "$Z2M_USER" -P wrong -t zigbee2mqtt/x -m 1'
check "the Zigbee2MQTT credentials work" 'quiet local_pub -t zigbee2mqtt/ping -m 1'
check "no work directory with copies of the secrets stays in the container after the start" \
  '[ -z "$(docker exec "$(compose ps -q mosquitto)" sh -c "ls -A /tmp")" ] && [ -z "$(docker exec "$(compose ps -q mosquitto)" find / -xdev -name "tmp.*" -not -path "/proc/*")" ]'
# The health check logs in as "health" with a public password; the local broker's ACL lets that user read the
# uptime topic and nothing else, and no secret is part of the container configuration or the health check.
check "no secret is part of the Mosquitto container's configuration (health check, environment)" \
  '! docker inspect "$(compose ps -q mosquitto)" | grep -qE "$Z2M_PASSWORD|$Z2M_TOKEN" && docker inspect -f "{{json .Config.Healthcheck.Test}}" "$(compose ps -q mosquitto)" | grep -q -- "-u health -P health"'
check "the health user reads the uptime" 'quiet compose exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u health -P health -t "\$SYS/broker/uptime" -C 1 -W 3'
local_pub -r -t zigbee2mqtt/aclprobe -m acl-secret > /dev/null 2>&1
check "the Zigbee2MQTT user reads and writes freely (ACL positive control)" '[ "$(local_sub -t zigbee2mqtt/aclprobe -C 1 -W 3 2> /dev/null)" = acl-secret ]'
check "the health user cannot read other topics" '[ -z "$(compose exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u health -P health -t "zigbee2mqtt/#" -C 1 -W 3 2> /dev/null)" ]'
compose exec -T mosquitto mosquitto_pub -h 127.0.0.1 -u health -P health -r -t zigbee2mqtt/hprobe -m intruder > /dev/null 2>&1
check "the health user cannot publish" '[ -z "$(local_sub -t zigbee2mqtt/hprobe -C 1 -W 2 2> /dev/null)" ]'
local_pub -r -n -t zigbee2mqtt/aclprobe > /dev/null 2>&1
# deploy.sh waits for Zigbee2MQTT with the health user: it may read the bridge state of Z2M (and nothing else of it).
local_pub -r -t zigbee2mqtt/bridge/state -m '{"state":"online"}' > /dev/null 2>&1
check "the health user reads zigbee2mqtt/bridge/state" '[ "$(compose exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u health -P health -t zigbee2mqtt/bridge/state -C 1 -W 3 2> /dev/null)" = "{\"state\":\"online\"}" ]'
local_pub -r -t zigbee2mqtt/bridge/info -m '{"secret":"info"}' > /dev/null 2>&1
check "the health user cannot read the rest of zigbee2mqtt/bridge" '[ -z "$(compose exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u health -P health -t zigbee2mqtt/bridge/info -C 1 -W 3 2> /dev/null)" ]'
local_pub -r -n -t zigbee2mqtt/bridge/info > /dev/null 2>&1
local_pub -r -n -t zigbee2mqtt/bridge/state > /dev/null 2>&1
check "the bridge connects with the gateway certificate (retained 1)" 'expect_vps "gw/$GATEWAY_ID/bridge/connection" "1 1"'
# The local bridge state (1 = connected) that deploy.sh shows, readable by the health user.
check "the health user reads the local bridge state (1)" 'wait_for health_bridge_is_up'
check "no secret appears in the Mosquitto log" '! compose logs mosquitto 2>&1 | grep -qE "$Z2M_PASSWORD|$Z2M_TOKEN"'

check "zigbee2mqtt/x arrives at the VPS broker as gw/<id>/z2m/x" \
  'local_pub -q 1 -r -t zigbee2mqtt/x -m probe-up > /dev/null 2>&1 && expect_vps "gw/$GATEWAY_ID/z2m/x" "1 probe-up"'
local_pub -r -n -t zigbee2mqtt/x > /dev/null 2>&1 || true
vps_pub "gw/$GATEWAY_ID/z2m/x" "" > /dev/null 2>&1 || true

# The subscriber is only trusted after a probe command has come through the bridge (a probe sent before the
# bridge's subscription is active is simply lost, so it is repeated); then the one command is sent.
local_sub -t 'zigbee2mqtt/+/set' -v -W 14 > "$WORK/command.out" 2> /dev/null &
command_pid=$!
for _ in $(seq 1 40); do
  vps_pub "gw/$GATEWAY_ID/z2m/probe/set" probe-ready > /dev/null 2>&1
  grep -q "probe-ready" "$WORK/command.out" 2> /dev/null && break
  sleep 0.25
done
check "the local subscriber is ready (a probe command came through the bridge)" 'grep -q "probe-ready" "$WORK/command.out"'
vps_pub "gw/$GATEWAY_ID/z2m/x/set" switch-once
wait "$command_pid" 2> /dev/null
check "a command gw/<id>/z2m/x/set arrives locally exactly once" '[ "$(grep -c "^zigbee2mqtt/x/set switch-once$" "$WORK/command.out")" = 1 ] && [ -z "$(grep -v "probe-ready\|switch-once" "$WORK/command.out")" ]'

# Messages published during an outage of the VPS broker are buffered and delivered in order after its restart.
# The collector is a persistent session on the VPS side that keeps what arrives while it is not connected.
docker exec "$PREFIX-broker" sh -c 'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -c -i collector -q 1 -t "$0" -C 1 -W 1' "gw/$GATEWAY_ID/z2m/buf" > /dev/null 2>&1
docker stop "$PREFIX-broker" > /dev/null
sleep 3
for i in $(seq 1 20); do local_pub -q 1 -t zigbee2mqtt/buf -m "$i" > /dev/null 2>&1; done
docker start "$PREFIX-broker" > /dev/null
wait_for vps_up
docker exec "$PREFIX-broker" sh -c 'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -c -i collector -q 1 -t "$0" -C 21 -W 20' "gw/$GATEWAY_ID/z2m/buf" > "$WORK/buffered.out" 2> /dev/null
check "20 messages published during the outage arrive in order, once, after the restart" '[ "$(cat "$WORK/buffered.out")" = "$(seq 1 20)" ]'
check "the bridge is connected again after the restart" 'expect_vps "gw/$GATEWAY_ID/bridge/connection" "1 1"'

# Zigbee2MQTT publishes with QoS 0. The same outage with QoS 0 messages, this time as a lost network link: the
# gateway's Mosquitto is cut off from the VPS network until its bridge has noticed (keepalive 20 s, local
# notification "0"), 20 QoS 0 messages are published, the link comes back. A subscriber on the VPS broker is
# online the whole time (the VPS queues no QoS 0 messages for offline clients), so what it prints is what the
# bridge delivered after reconnecting.
must docker run -d --name "$PREFIX-collector" --network "$NET" "$MOSQUITTO_IMAGE" \
  mosquitto_sub -h broker -p 1883 -u smart-api -P "$API_PASSWORD" -q 1 -t "gw/$GATEWAY_ID/z2m/buf0" -F '%p'
for _ in $(seq 1 40); do
  local_pub -q 0 -t zigbee2mqtt/buf0 -m probe > /dev/null 2>&1
  docker logs "$PREFIX-collector" 2>&1 | grep -qx probe && break
  sleep 0.5
done
check "QoS 0 outage: the VPS subscriber is ready (a probe came through)" 'docker logs "$PREFIX-collector" 2>&1 | grep -qx probe'
mosquitto_container=$(compose ps -q mosquitto)
docker network disconnect "$NET" "$mosquitto_container"
local_bridge_state() { local_sub -t "gw/$GATEWAY_ID/bridge/connection" -F '%p' -C 1 -W 2 2> /dev/null; }
for _ in $(seq 1 60); do
  [ "$(local_bridge_state)" = 0 ] && break
  sleep 1
done
check "QoS 0 outage: the bridge noticed the lost link (local notification 0)" '[ "$(local_bridge_state)" = 0 ]'
for i in $(seq 1 20); do local_pub -q 0 -t zigbee2mqtt/buf0 -m "q0-$i" > /dev/null 2>&1; done
docker network connect "$NET" "$mosquitto_container"
for _ in $(seq 1 60); do
  [ "$(docker logs "$PREFIX-collector" 2>&1 | grep -c '^q0-')" -ge 20 ] && break
  sleep 1
done
sleep 3
check "QoS 0 outage: 20 messages arrive in order, once, after the link is back" \
  '[ "$(docker logs "$PREFIX-collector" 2>&1 | grep "^q0-")" = "$(for i in $(seq 1 20); do echo "q0-$i"; done)" ]'
docker rm -fv "$PREFIX-collector" > /dev/null 2>&1
check "the bridge is connected again after the link is back" 'expect_vps "gw/$GATEWAY_ID/bridge/connection" "1 1"'

# --- Zigbee2MQTT: settings by environment variables, the configuration.yaml with the devices stays ---
# Without an adapter Zigbee2MQTT cannot start fully: it reads and applies its settings, then fails to open the
# serial port (/dev/null stands in for it) and exits. That is as far as it goes without hardware.
Z2M_CONFIG="$GW/zigbee2mqtt-data/configuration.yaml"
FIXTURE=gateway/test/fixtures/configuration.yaml
sum() { shasum -a 256 "$1" | cut -d' ' -f1; }
devices_block() { awk '/^devices:/{p=1;next} /^[a-z_]+:/{p=0} p' "$1"; }
wait_z2m_exit() {
  for _ in $(seq 1 120); do
    [ "$(docker inspect -f '{{.State.Running}}' "$(compose ps -aq zigbee2mqtt)")" = false ] && return 0
    sleep 1
  done
  return 1
}
fixture_sum=$(sum "$FIXTURE")
check "the fixture is in place before Zigbee2MQTT runs" '[ "$(sum "$Z2M_CONFIG")" = "$fixture_sum" ]'
compose up -d --no-deps zigbee2mqtt > "$WORK/z2m-up.log" 2>&1
check "Zigbee2MQTT starts and stops at the missing adapter" 'wait_z2m_exit'
z2m_log=$(compose logs --no-color zigbee2mqtt 2>&1)
check "it got as far as the adapter (settings valid, herdsman started)" 'echo "$z2m_log" | grep -q "Starting zigbee-herdsman" && echo "$z2m_log" | grep -q "Opening SerialPort with {\"path\":\"/dev/zigbee\""'
check "it did not fail on its settings" '! echo "$z2m_log" | grep -qiE "invalid|should be|must have|configuration.*error"'
# Z2M 2.14 writes the ZIGBEE2MQTT_CONFIG_* values into configuration.yaml at every start (onboarding.ts). So the file
# is not byte-identical to the fixture; what must hold: the devices and names stay, and only the intended keys change.
check "the environment variables landed in the settings (server, user, password, token, last_seen, availability, serial)" \
  'grep -qx "  server: mqtt://mosquitto:1883" "$Z2M_CONFIG" && grep -qx "  user: $Z2M_USER" "$Z2M_CONFIG" && grep -qx "  password: $Z2M_PASSWORD" "$Z2M_CONFIG" && grep -qx "  auth_token: $Z2M_TOKEN" "$Z2M_CONFIG" && grep -qx "  last_seen: ISO_8601" "$Z2M_CONFIG" && grep -qx "availability:" "$Z2M_CONFIG" && grep -qx "  port: /dev/zigbee" "$Z2M_CONFIG"'
check "the devices block is unchanged (names and IDs)" '[ "$(devices_block "$Z2M_CONFIG")" = "$(devices_block "$FIXTURE")" ] && [ -n "$(devices_block "$FIXTURE")" ]'
check "only the intended keys changed (no network key, channel, PAN or group change)" \
  '[ -z "$(diff "$FIXTURE" "$Z2M_CONFIG" | grep "^[<>]" | grep -vE "^[<>] +(server|user|password|port|auth_token|last_seen|enabled): |^> availability:$")" ]'
check "the frontend is switched on in port 8080" 'grep -A2 "^frontend:" "$Z2M_CONFIG" | grep -qx "  enabled: true" && grep -A3 "^frontend:" "$Z2M_CONFIG" | grep -qx "  port: 8080"'
first_sum=$(sum "$Z2M_CONFIG")
compose up -d --no-deps zigbee2mqtt > "$WORK/z2m-up.log" 2>&1
wait_z2m_exit
check "a second start leaves configuration.yaml byte-identical (checksum)" '[ "$(sum "$Z2M_CONFIG")" = "$first_sum" ]'
check "no secret is printed in the Zigbee2MQTT log" '! compose logs --no-color zigbee2mqtt 2>&1 | grep -qE "$Z2M_PASSWORD|$Z2M_TOKEN"'
check "Zigbee2MQTT has the memory limit of 384 MB and the pinned image" '[ "$(docker inspect -f "{{.HostConfig.Memory}}" "$(compose ps -aq zigbee2mqtt)")" = 402653184 ]'

echo "gateway tests: $passed passed, $failures failed"
[ "$failures" -eq 0 ]
