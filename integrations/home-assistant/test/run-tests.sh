#!/usr/bin/env bash
# Tests for the Home Assistant integration (smart_bridge). Needs Docker only: Python, Home Assistant and ruff run
# in a container with the integration folder mounted, so nothing is installed on the host.
# Phase 1: ruff format/check and pytest (protocol tests and HA tests). Phase 2: the integration runs in the pinned
# Home Assistant image with a config entry (as the pairing flow writes it) and connects over the websocket listener
# to the platform's broker image (real ACL; the user is created through dynamic security like the backend does).
# Phase 2 pulls the Home Assistant image once (large). It needs no certificates: the broker runs without TLS here.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PYTHON_IMAGE=python:3.14.10-slim-trixie
PIP_CACHE=smart-ha-integration-pip-cache

command -v docker > /dev/null 2>&1 || { echo "ha integration tests need Docker" >&2; exit 1; }

echo "== phase 1: ruff and pytest ($PYTHON_IMAGE)"
# The mount is read-only; caches go to /tmp so the working tree stays clean.
docker run --rm \
  -v "$ROOT:/work:ro" -v "$PIP_CACHE:/root/.cache/pip" \
  -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONPATH=/work \
  -w /work "$PYTHON_IMAGE" sh -euc '
    pip install --quiet --disable-pip-version-check -r requirements-test.txt
    ruff format --check --no-cache .
    ruff check --no-cache .
    pytest -q -p no:cacheprovider
  '

# ---------------------------------------------------------------------------------------------------------------
echo "== phase 2: real Home Assistant image against the platform broker"
HA_IMAGE=ghcr.io/home-assistant/home-assistant:2026.11.0
HELPER_IMAGE=alpine:3.24.2
PREFIX=smart-ha-integration-test
NET=$PREFIX
BROKER_IMAGE=$PREFIX-broker:local
GATEWAY_ID=gw-hatest01
API_PASSWORD=ha-integration-test-api
BROKER_DIR="$ROOT/../../infra/broker"
WAIT_SECONDS=180

WORK=$(mktemp -d)
remove_test_containers() {
  docker rm -fv "$PREFIX-ha" "$PREFIX-broker" > /dev/null 2>&1 || true
  docker network rm "$NET" > /dev/null 2>&1 || true
}
cleanup() {
  remove_test_containers
  # Home Assistant writes into its config folder as root.
  docker run --rm -v "$WORK:/w" "$HELPER_IMAGE" rm -rf /w/config > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
remove_test_containers

fail() {
  echo "FAIL: $1" >&2
  # Only log lines, never message payloads.
  echo "--- last Home Assistant log lines" >&2
  docker logs --tail 40 "$PREFIX-ha" 2>&1 | tail -n 40 >&2 || true
  exit 1
}

# --- the platform broker (no TLS: only 1883 and the websocket listener 8080) ---
docker build -q -t "$BROKER_IMAGE" "$BROKER_DIR" > /dev/null || { echo "docker build failed" >&2; exit 1; }
docker network create "$NET" > /dev/null
docker run -d --name "$PREFIX-broker" --network "$NET" --network-alias broker --read-only \
  --tmpfs /mosquitto/run --tmpfs /tmp -v /mosquitto/data \
  -e MQTT_USER=smart-api -e MQTT_PASSWORD="$API_PASSWORD" "$BROKER_IMAGE" > /dev/null
broker_up() { docker exec "$PREFIX-broker" sh -c 'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "\$SYS/broker/uptime" -C 1 -W 2' > /dev/null 2>&1; }
for _ in $(seq 1 60); do broker_up && break; sleep 0.5; done
broker_up || fail "the throwaway broker does not start"

# The gateway user like the backend creates it (dynamic security through the control topic). The password is random
# and only ever lives in the config entry and the broker.
PASSWORD=$(docker run --rm "$HELPER_IMAGE" sh -c 'head -c 24 /dev/urandom | od -An -tx1 | tr -d " \n"')
dynsec() { # one command document as smart-api; prints the broker's answer
  docker exec "$PREFIX-broker" sh -c 'mosquitto_rr -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "\$CONTROL/dynamic-security/v1" -e "\$CONTROL/dynamic-security/v1/response" -W 5 -m "$0"' "$1" 2> /dev/null
}
create_user() {
  dynsec '{"commands":[{"command":"createRole","rolename":"smart-gateway-ha","acls":[{"acltype":"publishClientSend","topic":"gw/%u/ha/#","allow":true},{"acltype":"publishClientSend","topic":"gw/%u/bridge/connection","allow":true}]},{"command":"createClient","username":"'"$GATEWAY_ID"'","password":"'"$PASSWORD"'","clientid":"'"$GATEWAY_ID"'-ha","textdescription":"generation:1","roles":[{"rolename":"smart-gateway-ha"}]}]}'
}
out=$(create_user)
{ printf '%s' "$out" | grep -q createClient && ! printf '%s' "$out" | grep -q '"error"'; } || fail "could not create the gateway user"

# The config entry the pairing flow would write (format taken from Home Assistant's ConfigEntry.as_dict).
mkdir -p "$WORK/config/.storage"
cp test/ha-config/configuration.yaml "$WORK/config/configuration.yaml"
sed -e "s/@GATEWAY_ID@/$GATEWAY_ID/g" -e "s/@PASSWORD@/$PASSWORD/g" \
  test/ha-config/.storage/core.config_entries.template > "$WORK/config/.storage/core.config_entries"

# Subscriber as smart-api on everything of the gateway; retained messages arrive first, later ones follow.
docker exec -d "$PREFIX-broker" sh -c "mosquitto_sub -h localhost -u smart-api -P \"\$MQTT_PASSWORD\" -t 'gw/$GATEWAY_ID/#' -F '%t %p' > /tmp/messages.txt"
# JSON checks run in the Python image (stdin is the payload), so the host needs no Python.
pyjson() { docker run --rm -i "$PYTHON_IMAGE" python -I -c "$1"; }
# Last payload seen on a topic (empty if none).
last() {
  docker exec "$PREFIX-broker" sh -c 'grep -F -- "$0 " /tmp/messages.txt | tail -n 1' "$1" 2> /dev/null | cut -d' ' -f2- || true
}
wait_for_payload() { # topic, expected payload, what, [seconds]
  local deadline=$((SECONDS + ${4:-$WAIT_SECONDS}))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(last "$1")" = "$2" ] && return 0
    sleep 2
  done
  fail "$3 (waited ${4:-$WAIT_SECONDS}s)"
}

started=$SECONDS
docker run -d --name "$PREFIX-ha" --network "$NET" \
  -v "$WORK/config:/config" \
  -v "$ROOT/custom_components/smart_bridge:/config/custom_components/smart_bridge:ro" \
  "$HA_IMAGE" > /dev/null

wait_for_payload "gw/$GATEWAY_ID/bridge/connection" 1 "bridge/connection did not become 1"
wait_for_payload "gw/$GATEWAY_ID/ha/status" online "ha/status did not become online"
echo "   online after $((SECONDS - started)) s"

# The snapshot: devices with a light entity, and one device document. Payloads are only parsed, never printed.
deadline=$((SECONDS + WAIT_SECONDS))
device_id=""
while [ "$SECONDS" -lt "$deadline" ]; do
  DEVICES_JSON=$(last "gw/$GATEWAY_ID/ha/devices")
  device_id=$(printf '%s' "$DEVICES_JSON" | pyjson '
import json, sys
try:
    doc = json.load(sys.stdin)
except ValueError:
    sys.exit(0)
if doc.get("v") != 1:
    sys.exit(0)
for device in doc.get("devices", []):
    if any(e.get("domain") == "light" or str(e.get("entity_id", "")).startswith("light.") for e in device.get("entities", [])):
        print(device["id"])
        break
' 2> /dev/null || true)
  [ -n "$device_id" ] && break
  sleep 2
done
[ -n "$device_id" ] || fail "ha/devices has no device with a light entity (waited ${WAIT_SECONDS}s)"
echo "   ha/devices lists a device with a light entity"
doc_ok=$(printf '%s' "$(last "gw/$GATEWAY_ID/ha/device/$device_id")" | pyjson '
import json, sys
try:
    print("yes" if json.load(sys.stdin).get("v") == 1 else "no")
except ValueError:
    print("no")
')
[ "$doc_ok" = yes ] || fail "ha/device/<id> is missing or has no v = 1"
echo "   ha/device/<id> has v = 1"

# The broker loses the user (like after a restart of the broker, whose dynamic security state lives in a tmpfs):
# deleteClient disconnects at once. The integration must not hammer the broker, must not log errors, and must come
# back by itself when the user exists again (the platform's reconcile re-creates it).
# Refused attempts of the client (the broker's own health check and our control calls connect on 1883, not counted).
connections() { docker logs "$PREFIX-broker" 2>&1 | grep -c "Client $GATEWAY_ID-ha .*disconnected: not authorised" || true; }
out=$(dynsec '{"commands":[{"command":"deleteClient","username":"'"$GATEWAY_ID"'"}]}')
{ printf '%s' "$out" | grep -q deleteClient && ! printf '%s' "$out" | grep -q '"error"'; } || fail "could not delete the gateway user"
before=$(connections)
sleep 30
attempts=$(($(connections) - before))
[ "$attempts" -le 6 ] || fail "$attempts connection attempts within 30 s after the user was deleted (expected backoff, at most 6)"
refused=$(docker logs "$PREFIX-ha" 2>&1 | grep -c 'smart_bridge.*Broker refused the connection' || true)
[ "$refused" -eq 1 ] || fail "expected one warning about the refused connection, found $refused"
echo "   user deleted: $attempts connection attempts in 30 s, one warning"
create_user > /dev/null
# The retained 1 is stale (the broker kicked the client without its will), so wait for the second "Connected" line.
deadline=$((SECONDS + 90))
until [ "$(docker logs "$PREFIX-ha" 2>&1 | grep -c 'smart_bridge.connection\] Connected to the platform broker' || true)" -ge 2 ]; do
  [ "$SECONDS" -lt "$deadline" ] || fail "the integration did not reconnect within 90 s after the user was re-created"
  sleep 2
done
wait_for_payload "gw/$GATEWAY_ID/bridge/connection" 1 "bridge/connection is not 1 after the user was re-created" 30
echo "   reconnected by itself after the user was re-created"

# Clean stop: the will is not needed, the integration publishes offline and the broker reports the closed link.
docker stop --time 30 "$PREFIX-ha" > /dev/null
wait_for_payload "gw/$GATEWAY_ID/ha/status" offline "ha/status did not become offline after the stop"
wait_for_payload "gw/$GATEWAY_ID/bridge/connection" 0 "bridge/connection did not become 0 after the stop"
echo "   offline after stop"

# The log: no error of the integration, no payload, no password.
LOG=$(docker logs "$PREFIX-ha" 2>&1)
if printf '%s\n' "$LOG" | grep -E 'ERROR' | grep -q 'smart_bridge'; then
  printf '%s\n' "$LOG" | grep -E 'ERROR' | grep 'smart_bridge' | head -n 10 >&2
  fail "the log has an ERROR line of smart_bridge"
fi
if printf '%s\n' "$LOG" | grep -qF '"entities"'; then
  fail "the log contains a payload"
fi
if printf '%s\n' "$LOG" | grep -qF "$PASSWORD"; then
  fail "the log contains the password"
fi
echo "ha integration tests passed ($((SECONDS - started)) s in the Home Assistant image)"
