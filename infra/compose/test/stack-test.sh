#!/usr/bin/env sh
# Builds all images, starts the production stack locally and verifies it end to end.
set -eu
cd "$(dirname "$0")/../../.."

PROJECT=smart-stacktest
TAG=stacktest
NETWORK=smart-stacktest-proxy
GATEWAY_ID=gw-testpi01
ENV_FILE=$(mktemp)
WORK=$(mktemp -d)

cat > "$ENV_FILE" <<ENV
STACK_NAME=$PROJECT
IMAGE_REGISTRY=local
IMAGE_TAG=$TAG
PROXY_NETWORK=$NETWORK
COMPOSE_PROFILES=backup
BACKUP_UID=4242
BACKUP_GID=4343
DB_PASSWORD=stack-test-db
MQTT_API_PASSWORD=stack-test-mqtt
MQTT_TLS=on
APP_ORIGIN=http://127.0.0.1:18080
ENV

compose() {
  docker compose --env-file "$ENV_FILE" -f infra/compose/compose.yaml -f infra/compose/test/compose.test.yaml "$@"
}

cleanup() {
  compose down -v > /dev/null 2>&1 || true
  docker network rm "$NETWORK" > /dev/null 2>&1 || true
  docker rm -f smart-stacktest-decoy > /dev/null 2>&1 || true
  docker volume rm smart-stacktest-config smart-stacktest-restic smart-stacktest-certs smart-stacktest-pi > /dev/null 2>&1 || true
  rm -rf "$ENV_FILE" "$WORK"
}
trap cleanup EXIT

docker build -q -f apps/backend/Dockerfile -t "local/smart-home-api:$TAG" .
docker build -q -f apps/frontend/Dockerfile -t "local/smart-home-web:$TAG" .
docker build -q -t "local/smart-home-broker:$TAG" infra/broker
docker build -q -t "local/smart-home-backup:$TAG" infra/backup

# Throwaway PKI (needs OpenSSL 3 or newer; on macOS install openssl@3, pki.sh finds it, or set SMART_OPENSSL):
# a CA, the broker's server certificate (host "broker", the name the pi connects to) and the pi's gateway certificate.
export SMART_PKI_PASSPHRASE_FILE="$WORK/passphrase"
printf 'stack test passphrase\n' > "$SMART_PKI_PASSPHRASE_FILE"
pki() { SMART_PKI_DIR="$WORK/pki" bash infra/pki/pki.sh "$@" < /dev/null > /dev/null; }
pki init-ca
pki issue-server broker
pki issue-gateway "$GATEWAY_ID"

# Only what the stack needs goes into the volumes, never the CA key. certs-test replaces ./certs of the stack
# directory (see compose.test.yaml); pi-test holds the pi's configuration and gateway certificate.
mkdir "$WORK/stage-certs" "$WORK/stage-pi"
for f in ca.crt server.crt server.key crl.pem crl-next-update; do cp "$WORK/pki/$f" "$WORK/stage-certs/$f"; done
sed "s/@GATEWAY_ID@/$GATEWAY_ID/g" infra/compose/test/pi.mosquitto.conf > "$WORK/stage-pi/mosquitto.conf"
cp "$WORK/pki/ca.crt" "$WORK/pki/gateways/$GATEWAY_ID.crt" "$WORK/pki/gateways/$GATEWAY_ID.key" "$WORK/stage-pi/"
docker volume rm smart-stacktest-certs smart-stacktest-pi > /dev/null 2>&1 || true
docker volume create smart-stacktest-certs > /dev/null
docker volume create smart-stacktest-pi > /dev/null
# Same modes as broker-certs.sh sets on the VPS: directory 755, public files 644, server.key 600.
docker run --rm -v smart-stacktest-certs:/dst -v "$WORK/stage-certs:/src:ro" alpine:3.24.2 \
  sh -c 'cp /src/* /dst/ && chmod 755 /dst && chmod 644 /dst/* && chmod 600 /dst/server.key'
# The pi's Mosquitto drops to user 1883 and reads the key as that user.
docker run --rm -v smart-stacktest-pi:/dst -v "$WORK/stage-pi:/src:ro" alpine:3.24.2 \
  sh -c 'cp /src/* /dst/ && chown -R 1883:1883 /dst && chmod 755 /dst && chmod 600 /dst/*.key'

docker network inspect "$NETWORK" > /dev/null 2>&1 || docker network create "$NETWORK" > /dev/null
docker volume create smart-stacktest-config > /dev/null
# Same shape as on the VPS: the stack directory belongs to the deploy user (here 4242:4343), mode 700,
# and .env is mode 600 – the backup container must run as that owner to read it.
docker run --rm -v smart-stacktest-config:/dst -v "$PWD/infra/compose:/src:ro" -v "$ENV_FILE:/env:ro" alpine:3.24.2 \
  sh -c 'cp -r /src/. /dst/ && cp /env /dst/.env && chown -R 4242:4343 /dst && chmod 700 /dst && chmod 600 /dst/.env'
docker volume create smart-stacktest-restic > /dev/null
docker run --rm -v smart-stacktest-restic:/repo alpine:3.24.2 chown 4242:4343 /repo

# A foreign container on the shared proxy network that answers to the generic name "api":
# requests to /api/ must still reach our own api container.
docker run -d --name smart-stacktest-decoy --network "$NETWORK" --network-alias api alpine:3.24.2 \
  sh -c 'mkdir -p /www/api/health && echo decoy > /www/api/health/ready && echo decoy > /www/api/health/live && httpd -f -p 3000 -h /www' > /dev/null

compose up -d --wait db broker
compose run --rm --no-deps api node dist/migrate.js
compose up -d --wait

# The people of the end-to-end tests (tests/e2e/helpers/accounts.ts), created like the first admin on
# the VPS; running the command again changes nothing.
for person in shell smoke auth theme setup owner guest; do
  compose exec -T api node dist/cli.js create-admin --email "e2e-$person@example.org" --name "E2E $person"
done

# The api sees the certificate files through its read-only mount, as the unprivileged node user.
compose exec -T api node -e '
const fs = require("node:fs");
const ca = fs.readFileSync(process.env.GATEWAY_CA_FILE, "utf8");
const next = fs.readFileSync(process.env.GATEWAY_CRL_NEXT_UPDATE_FILE, "utf8");
if (!ca.includes("BEGIN CERTIFICATE") || !/^\d{4}-\d{2}-\d{2}T/.test(next)) process.exit(1);
' || {
  echo "FAIL: the api cannot read the gateway CA or the CRL expiry file" >&2
  exit 1
}

# The bridged test gateway: the pi's Mosquitto connects to broker:8883 with its gateway certificate. Everything is
# read as smart-api inside the broker container; -F "%r %p" prints the retain flag and the payload.
broker_read() {
  # shellcheck disable=SC2016 # the password variable must expand inside the broker container
  compose exec -T broker sh -c \
    'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "$0" -F "%r %p" -C 1 -W 3' "$1" 2> /dev/null || true
}
expect_message() {
  attempt=0
  got=""
  while [ "$attempt" -lt 20 ]; do
    got=$(broker_read "$1")
    [ "$got" = "$2" ] && return 0
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "FAIL: $1 is '$got' (retain flag and payload), expected '$2'" >&2
  return 1
}
expect_message "gw/$GATEWAY_ID/bridge/connection" "1 1"
# Z2M publishes zigbee2mqtt/bridge/state on the pi; the bridge hands it to the broker as gw/<id>/z2m/bridge/state.
compose exec -T pi mosquitto_pub -h 127.0.0.1 -r -t zigbee2mqtt/bridge/state -m online
expect_message "gw/$GATEWAY_ID/z2m/bridge/state" "1 online"
# A command of the backend reaches the pi as zigbee2mqtt/<device>/set (probed until the bridge subscription is active).
compose exec -T pi mosquitto_sub -h 127.0.0.1 -t 'zigbee2mqtt/+/set' -C 1 -W 20 > "$WORK/command.out" &
command_pid=$!
attempt=0
while [ ! -s "$WORK/command.out" ] && [ "$attempt" -lt 20 ]; do
  # shellcheck disable=SC2016 # see broker_read
  compose exec -T broker sh -c 'mosquitto_pub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "$0" -m switch' "gw/$GATEWAY_ID/z2m/lamp/set"
  attempt=$((attempt + 1))
  sleep 1
done
wait "$command_pid" || true
grep -qx switch "$WORK/command.out" || {
  echo "FAIL: the command for gw/$GATEWAY_ID/z2m/lamp/set did not reach the pi" >&2
  exit 1
}
# Stopping the pi cleanly makes the bridge publish the retained "0".
compose stop pi
expect_message "gw/$GATEWAY_ID/bridge/connection" "1 0"

compose exec -T backup backup.sh
compose exec -T backup restore-test.sh
compose exec -T backup restic snapshots --tag config --json | grep -q '"paths":\["/stack-config"\]' || {
  echo "FAIL: no config snapshot" >&2
  exit 1
}

E2E_BASE_URL=http://127.0.0.1:18080 E2E_MAILPIT_URL=http://127.0.0.1:18025 pnpm --filter @smart/e2e e2e

echo "OK: stack test passed"
