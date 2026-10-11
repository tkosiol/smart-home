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
DB_PASSWORD=stack-test-db
MQTT_API_PASSWORD=stack-test-mqtt
ENV

compose() {
  docker compose --env-file "$ENV_FILE" -f infra/compose/compose.yaml -f infra/compose/test/compose.test.yaml "$@"
}

cleanup() {
  compose down -v > /dev/null 2>&1 || true
  docker network rm "$NETWORK" > /dev/null 2>&1 || true
  docker volume rm smart-stacktest-config > /dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
trap cleanup EXIT

docker build -q -f apps/backend/Dockerfile -t "local/smart-home-api:$TAG" .
docker build -q -f apps/frontend/Dockerfile -t "local/smart-home-web:$TAG" .
docker build -q -t "local/smart-home-broker:$TAG" infra/broker
docker build -q -t "local/smart-home-backup:$TAG" infra/backup

docker network inspect "$NETWORK" > /dev/null 2>&1 || docker network create "$NETWORK" > /dev/null
docker volume create smart-stacktest-config > /dev/null
docker run --rm -v smart-stacktest-config:/dst -v "$PWD/infra/compose:/src:ro" alpine:3.24.2 cp -r /src/. /dst/

compose up -d --wait db broker
compose run --rm --no-deps api node dist/migrate.js
compose up -d --wait

compose exec -T backup backup.sh
compose exec -T backup restore-test.sh

E2E_BASE_URL=http://127.0.0.1:18080 pnpm --filter @smart/e2e e2e

echo "OK: stack test passed"
