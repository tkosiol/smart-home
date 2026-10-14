#!/usr/bin/env sh
# Builds all images, starts the production stack locally and verifies it end to end.
set -eu
cd "$(dirname "$0")/../../.."

PROJECT=smart-stacktest
TAG=stacktest
NETWORK=smart-stacktest-proxy
ENV_FILE=$(mktemp)

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
APP_ORIGIN=http://127.0.0.1:18080
ENV

compose() {
  docker compose --env-file "$ENV_FILE" -f infra/compose/compose.yaml -f infra/compose/test/compose.test.yaml "$@"
}

cleanup() {
  compose down -v > /dev/null 2>&1 || true
  docker network rm "$NETWORK" > /dev/null 2>&1 || true
  docker rm -f smart-stacktest-decoy > /dev/null 2>&1 || true
  docker volume rm smart-stacktest-config smart-stacktest-restic > /dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
trap cleanup EXIT

docker build -q -f apps/backend/Dockerfile -t "local/smart-home-api:$TAG" .
docker build -q -f apps/frontend/Dockerfile -t "local/smart-home-web:$TAG" .
docker build -q -t "local/smart-home-broker:$TAG" infra/broker
docker build -q -t "local/smart-home-backup:$TAG" infra/backup

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

compose exec -T backup backup.sh
compose exec -T backup restore-test.sh
compose exec -T backup restic snapshots --tag config --json | grep -q '"paths":\["/stack-config"\]' || {
  echo "FAIL: no config snapshot" >&2
  exit 1
}

E2E_BASE_URL=http://127.0.0.1:18080 E2E_MAILPIT_URL=http://127.0.0.1:18025 pnpm --filter @smart/e2e e2e

echo "OK: stack test passed"
