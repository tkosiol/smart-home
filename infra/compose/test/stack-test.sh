#!/usr/bin/env sh
# Builds all images, starts the production stack locally and verifies it end to end.
set -eu
cd "$(dirname "$0")/../../.."

PROJECT=smart-stacktest
TAG=stacktest
NETWORK=smart-stacktest-proxy
GATEWAY_ID=gw-testpi01
# The simulator's gateway: the broker ACL of the user smart-simulator and the certificate issued below belong to it.
SIM_ID=gw-simtest1
# The local user of the pi's Mosquitto (on the real pi: the Zigbee2MQTT user); the test publishes as this user.
PI_LOCAL_USER=z2m
PI_LOCAL_PASSWORD=stack-test-pi-local
ENV_FILE=$(mktemp)
WORK=$(mktemp -d)

cat > "$ENV_FILE" <<ENV
STACK_NAME=$PROJECT
IMAGE_REGISTRY=local
IMAGE_TAG=$TAG
PROXY_NETWORK=$NETWORK
COMPOSE_PROFILES=backup,simulator
BACKUP_UID=4242
BACKUP_GID=4343
DB_PASSWORD=stack-test-db
MQTT_API_PASSWORD=stack-test-mqtt
MQTT_SIMULATOR_PASSWORD=stack-test-simulator
MQTT_SIMULATOR_GATEWAY_ID=$SIM_ID
# Short, so that the end-to-end tests see readings within seconds (the default is 300).
SIMULATOR_INTERVAL_SECONDS=5
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
  docker volume rm smart-stacktest-config smart-stacktest-restic smart-stacktest-certs-public smart-stacktest-certs-private smart-stacktest-pi > /dev/null 2>&1 || true
  rm -rf "$ENV_FILE" "$WORK"
}
trap cleanup EXIT

docker build -q -f apps/backend/Dockerfile -t "local/smart-home-api:$TAG" .
docker build -q -f apps/frontend/Dockerfile -t "local/smart-home-web:$TAG" .
docker build -q -t "local/smart-home-broker:$TAG" infra/broker
docker build -q -t "local/smart-home-backup:$TAG" infra/backup
docker build -q -f apps/gateway-simulator/Dockerfile -t "local/smart-home-simulator:$TAG" .

# Throwaway PKI (needs OpenSSL 3 or newer; on macOS install openssl@3, pki.sh finds it, or set SMART_OPENSSL):
# a CA, the broker's server certificate (host "broker", the name the pi connects to) and the gateway certificates of
# the pi and of the simulator (they are only registered by the end-to-end tests, the containers do not use them).
export SMART_PKI_PASSPHRASE_FILE="$WORK/passphrase"
printf 'stack test passphrase\n' > "$SMART_PKI_PASSPHRASE_FILE"
pki() { SMART_PKI_DIR="$WORK/pki" bash infra/pki/pki.sh "$@" < /dev/null > /dev/null; }
pki init-ca
pki issue-server broker
pki issue-gateway "$GATEWAY_ID"
pki issue-gateway "$SIM_ID"
# For the end-to-end tests (registering both gateways in the app): the IDs and the paths of the PEM certificates,
# which live in the throwaway PKI directory until this script ends. The private keys stay out of reach of the tests.
export E2E_PI_GATEWAY_ID="$GATEWAY_ID"
export E2E_PI_CERTIFICATE_FILE="$WORK/pki/gateways/$GATEWAY_ID.crt"
export E2E_SIMULATOR_GATEWAY_ID="$SIM_ID"
export E2E_SIMULATOR_CERTIFICATE_FILE="$WORK/pki/gateways/$SIM_ID.crt"

# Only what the stack needs goes into the volumes, never the CA key. The layout is the one of the stack directory
# (certs/public for api and broker, certs/private with the server key for the broker only); the volumes
# certs-public-test and certs-private-test replace those bind mounts (see compose.test.yaml). pi-test holds the
# pi's secrets as provision-gateway.sh leaves them on the Pi (CA, gateway certificate and key, password file of the
# local user) and the configuration that gateway/render.sh renders from gateway/mosquitto.conf.template.
mkdir "$WORK/stage-public" "$WORK/stage-private" "$WORK/stage-pi"
for f in ca.crt server.crt crl.pem crl-next-update; do cp "$WORK/pki/$f" "$WORK/stage-public/$f"; done
cp "$WORK/pki/server.key" "$WORK/stage-private/server.key"
# The pi's Mosquitto configuration is the real template of the gateway package, rendered by the real render.sh.
mkdir -p "$WORK/pi-dir/secrets"
printf 'GATEWAY_ID=%s\nBROKER_HOST=broker\nBROKER_PORT=8883\n' "$GATEWAY_ID" > "$WORK/pi-dir/secrets/gateway.env"
SMART_GATEWAY_DIR="$WORK/pi-dir" bash gateway/render.sh > /dev/null
cp "$WORK/pi-dir/run/mosquitto.conf" "$WORK/stage-pi/mosquitto.conf"
cp "$WORK/pki/ca.crt" "$WORK/stage-pi/ca.crt"
cp "$WORK/pki/gateways/$GATEWAY_ID.crt" "$WORK/stage-pi/gateway.crt"
cp "$WORK/pki/gateways/$GATEWAY_ID.key" "$WORK/stage-pi/gateway.key"
# The local user of the pi (Zigbee2MQTT's, here used by the test), made by mosquitto_passwd like on the Pi.
docker run --rm -u "$(id -u):$(id -g)" -v "$WORK/stage-pi:/s" eclipse-mosquitto:2.1.2-alpine \
  mosquitto_passwd -c -b /s/passwd "$PI_LOCAL_USER" "$PI_LOCAL_PASSWORD" > /dev/null 2>&1
for volume in smart-stacktest-certs-public smart-stacktest-certs-private smart-stacktest-pi; do
  docker volume rm "$volume" > /dev/null 2>&1 || true
  docker volume create "$volume" > /dev/null
done
# Same modes as broker-certs.sh sets on the VPS: public 755/644, private 700/600.
docker run --rm -v smart-stacktest-certs-public:/dst -v "$WORK/stage-public:/src:ro" alpine:3.24.2 \
  sh -c 'cp /src/* /dst/ && chmod 755 /dst && chmod 644 /dst/*'
docker run --rm -v smart-stacktest-certs-private:/dst -v "$WORK/stage-private:/src:ro" alpine:3.24.2 \
  sh -c 'cp /src/* /dst/ && chmod 700 /dst && chmod 600 /dst/*'
# Like secrets/ on the Pi: owned by root, 700 and 600. The pi's Mosquitto drops to user 1883 and could not read the
# password file or the key like this; gateway/mosquitto-entrypoint.sh copies them for it (see compose.test.yaml).
docker run --rm -v smart-stacktest-pi:/dst -v "$WORK/stage-pi:/src:ro" alpine:3.24.2 \
  sh -c 'cp /src/* /dst/ && chown -R 0:0 /dst && chmod 700 /dst && chmod 600 /dst/*'

docker network inspect "$NETWORK" > /dev/null 2>&1 || docker network create "$NETWORK" > /dev/null
docker volume rm smart-stacktest-config smart-stacktest-restic > /dev/null 2>&1 || true
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
# ... and never the broker's private key: nothing named server.key exists anywhere in its certificate mount.
compose exec -T api node -e '
const fs = require("node:fs");
const names = fs.readdirSync("/smart/certs", { recursive: true });
if (names.length === 0 || names.some((name) => String(name).includes("server.key"))) process.exit(1);
' || {
  echo "FAIL: the api sees server.key (or an empty certificate mount)" >&2
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
compose exec -T pi mosquitto_pub -h 127.0.0.1 -u "$PI_LOCAL_USER" -P "$PI_LOCAL_PASSWORD" -r -t zigbee2mqtt/bridge/state -m online
expect_message "gw/$GATEWAY_ID/z2m/bridge/state" "1 online"
# A command of the backend reaches the pi as zigbee2mqtt/<device>/set (probed until the bridge subscription is active).
compose exec -T pi mosquitto_sub -h 127.0.0.1 -u "$PI_LOCAL_USER" -P "$PI_LOCAL_PASSWORD" -t 'zigbee2mqtt/+/set' -C 1 -W 20 > "$WORK/command.out" &
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

# The simulator (profile simulator): it runs as an unprivileged user and, as smart-simulator, announces its gateway
# like the pi: the connection flag, the bridge state, and the device list with the real Z2M definitions.
[ "$(compose exec -T simulator id -u | tr -d '\r')" != 0 ] || {
  echo "FAIL: the simulator runs as root" >&2
  exit 1
}
expect_message "gw/$SIM_ID/bridge/connection" "1 1"
expect_message "gw/$SIM_ID/z2m/bridge/state" '1 {"state":"online"}'
attempt=0
devices=""
while [ "$attempt" -lt 20 ]; do
  devices=$(broker_read "gw/$SIM_ID/z2m/bridge/devices")
  case "$devices" in "1 ["*) break ;; esac
  attempt=$((attempt + 1))
  sleep 1
done
for expected in '"friendly_name":"Pflanze 1"' '"model":"AY-303Z"' '"friendly_name":"Lampe"' '"model":"LED1624G9"'; do
  case "$devices" in
    *"$expected"*) ;;
    *)
      echo "FAIL: the retained device list of gw/$SIM_ID/z2m/bridge/devices lacks $expected" >&2
      exit 1
      ;;
  esac
done
# A command for the lamp (the simulator reads gw/<id>/z2m/+/set) is answered with the new state (probed until
# the simulator's subscription is active).
# shellcheck disable=SC2016 # see broker_read
compose exec -T broker sh -c 'mosquitto_sub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "$0" -C 1 -W 20' \
  "gw/$SIM_ID/z2m/Lampe" > "$WORK/lamp.out" 2> /dev/null &
lamp_pid=$!
attempt=0
while [ ! -s "$WORK/lamp.out" ] && [ "$attempt" -lt 20 ]; do
  # shellcheck disable=SC2016 # see broker_read
  compose exec -T broker sh -c 'mosquitto_pub -h localhost -u smart-api -P "$MQTT_PASSWORD" -t "$0" -m "$1"' \
    "gw/$SIM_ID/z2m/Lampe/set" '{"state":"ON","brightness":77}'
  attempt=$((attempt + 1))
  sleep 1
done
wait "$lamp_pid" || true
if ! grep -q '"state":"ON"' "$WORK/lamp.out" || ! grep -q '"brightness":77' "$WORK/lamp.out"; then
  echo "FAIL: the simulator's lamp did not report the state set by gw/$SIM_ID/z2m/Lampe/set" >&2
  exit 1
fi

compose exec -T backup backup.sh
compose exec -T backup restore-test.sh
compose exec -T backup restic snapshots --tag config --json | grep -q '"paths":\["/stack-config"\]' || {
  echo "FAIL: no config snapshot" >&2
  exit 1
}

# The end-to-end tests register the pi's and the simulator's gateway in the app (two specs, one gateway each),
# expect them to be online and read the simulator's devices, so they run before the two are stopped.
E2E_BASE_URL=http://127.0.0.1:18080 E2E_MAILPIT_URL=http://127.0.0.1:18025 pnpm --filter @smart/e2e e2e

# Stopping the pi cleanly makes the bridge publish the retained "0"; the simulator does the same for its own
# gateway and also says that Zigbee2MQTT is gone.
compose stop pi
expect_message "gw/$GATEWAY_ID/bridge/connection" "1 0"
compose stop simulator
expect_message "gw/$SIM_ID/bridge/connection" "1 0"
expect_message "gw/$SIM_ID/z2m/bridge/state" '1 {"state":"offline"}'

echo "OK: stack test passed"
