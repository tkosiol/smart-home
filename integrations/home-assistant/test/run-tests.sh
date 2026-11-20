#!/usr/bin/env bash
# Tests for the Home Assistant integration (smart_bridge). Needs Docker only: Python, Home Assistant and ruff run
# in a container with the integration folder mounted, so nothing is installed on the host.
# Phase 1: ruff format/check and pytest (protocol tests and HA tests). Phase 2: the integration runs in the pinned
# Home Assistant image, connected over mTLS to the platform's broker image (throwaway CA from pki.sh, real ACL).
# Phase 2 also needs OpenSSL 3 and pulls the Home Assistant image once (large).
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
GATEWAY_ID=gw-hatest01 # must match test/ha-config/configuration.yaml
API_PASSWORD=ha-integration-test-api
PKI_SH="$ROOT/../../infra/pki/pki.sh"
BROKER_DIR="$ROOT/../../infra/broker"
WAIT_SECONDS=180

OSSL=""
for candidate in "${SMART_OPENSSL:-openssl}" /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
  if command -v "$candidate" > /dev/null 2>&1 && "$candidate" version | grep -Eq '^OpenSSL [3-9]'; then
    OSSL=$(command -v "$candidate")
    break
  fi
done
[ -n "$OSSL" ] || { echo "ha integration tests need OpenSSL 3 or newer (set SMART_OPENSSL)" >&2; exit 1; }
export SMART_OPENSSL="$OSSL"

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

# --- throwaway PKI and the platform broker ---
export SMART_PKI_PASSPHRASE_FILE="$WORK/passphrase"
printf 'ha integration test passphrase\n' > "$SMART_PKI_PASSPHRASE_FILE"
pki() { SMART_PKI_DIR="$WORK/pki" bash "$PKI_SH" "$@" < /dev/null > /dev/null; }
# The server certificate carries the host name the integration connects to (broker_host in the test config).
{ pki init-ca && pki issue-server broker && pki issue-gateway "$GATEWAY_ID"; } || { echo "could not set up the throwaway PKI" >&2; exit 1; }
mkdir -p "$WORK/certs/public" "$WORK/certs/private" "$WORK/secrets" "$WORK/config"
for f in ca.crt server.crt crl.pem; do cp "$WORK/pki/$f" "$WORK/certs/public/$f"; done
cp "$WORK/pki/server.key" "$WORK/certs/private/server.key"
cp "$WORK/pki/ca.crt" "$WORK/secrets/ca.crt"
cp "$WORK/pki/gateways/$GATEWAY_ID.crt" "$WORK/secrets/gateway.crt"
cp "$WORK/pki/gateways/$GATEWAY_ID.key" "$WORK/secrets/gateway.key"
chmod 755 "$WORK/secrets" "$WORK/certs" "$WORK/certs/public" "$WORK/certs/private"
chmod 644 "$WORK"/secrets/* "$WORK"/certs/public/* "$WORK"/certs/private/*
cp test/ha-config/configuration.yaml "$WORK/config/configuration.yaml"

docker build -q -t "$BROKER_IMAGE" "$BROKER_DIR" > /dev/null || { echo "docker build failed" >&2; exit 1; }
docker network create "$NET" > /dev/null
docker run -d --name "$PREFIX-broker" --network "$NET" --network-alias broker --read-only \
  --tmpfs /mosquitto/run --tmpfs /tmp -v /mosquitto/data \
  -v "$WORK/certs/public:/mosquitto/certs:ro" -v "$WORK/certs/private:/mosquitto/certs-private:ro" \
  -e MQTT_USER=smart-api -e MQTT_PASSWORD="$API_PASSWORD" -e MQTT_TLS=on "$BROKER_IMAGE" > /dev/null
broker_up() { docker exec "$PREFIX-broker" sh -c 'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "\$SYS/broker/uptime" -C 1 -W 2' > /dev/null 2>&1; }
for _ in $(seq 1 60); do broker_up && break; sleep 0.5; done
broker_up || fail "the throwaway broker does not start"

# Subscriber as smart-api on everything of the gateway; retained messages arrive first, later ones follow.
docker exec -d "$PREFIX-broker" sh -c "mosquitto_sub -h localhost -u smart-api -P \"\$MQTT_PASSWORD\" -t 'gw/$GATEWAY_ID/#' -F '%t %p' > /tmp/messages.txt"
# JSON checks run in the Python image (stdin is the payload), so the host needs no Python.
pyjson() { docker run --rm -i "$PYTHON_IMAGE" python -I -c "$1"; }
# Last payload seen on a topic (empty if none).
last() {
  docker exec "$PREFIX-broker" sh -c 'grep -F -- "$0 " /tmp/messages.txt | tail -n 1' "$1" 2> /dev/null | cut -d' ' -f2- || true
}
wait_for_payload() { # topic, expected payload, what
  local deadline=$((SECONDS + WAIT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(last "$1")" = "$2" ] && return 0
    sleep 2
  done
  fail "$3 (waited ${WAIT_SECONDS}s)"
}

started=$SECONDS
docker run -d --name "$PREFIX-ha" --network "$NET" \
  -v "$WORK/config:/config" \
  -v "$ROOT/custom_components/smart_bridge:/config/custom_components/smart_bridge:ro" \
  -v "$WORK/secrets:/smart-secrets:ro" \
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

# Clean stop: the will is not needed, the integration publishes offline and the broker reports the closed link.
docker stop --time 30 "$PREFIX-ha" > /dev/null
wait_for_payload "gw/$GATEWAY_ID/ha/status" offline "ha/status did not become offline after the stop"
wait_for_payload "gw/$GATEWAY_ID/bridge/connection" 0 "bridge/connection did not become 0 after the stop"
echo "   offline after stop"

# The log: no error of the integration, no payload.
LOG=$(docker logs "$PREFIX-ha" 2>&1)
if printf '%s\n' "$LOG" | grep -E 'ERROR' | grep -q 'smart_bridge'; then
  printf '%s\n' "$LOG" | grep -E 'ERROR' | grep 'smart_bridge' | head -n 10 >&2
  fail "the log has an ERROR line of smart_bridge"
fi
if printf '%s\n' "$LOG" | grep -qF '"entities"'; then
  fail "the log contains a payload"
fi
echo "ha integration tests passed ($((SECONDS - started)) s in the Home Assistant image)"
