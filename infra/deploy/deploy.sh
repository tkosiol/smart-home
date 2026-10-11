#!/bin/sh
# Deploys the images of one commit to one environment; rolls back automatically if the new version is unhealthy.
# Usage: deploy.sh <staging|production> <commit-sha> <dir containing that commit's compose.yaml>
set -eu

environment="$1"
sha="$2"
source_dir="$3"
stacks_dir="${SMART_STACKS_DIR:-$HOME/docker/apps}"

case "$environment" in
  staging) stack_dir="$stacks_dir/smart-staging" ;;
  production) stack_dir="$stacks_dir/smart-prod" ;;
  *) echo "deploy: invalid environment '$environment'" >&2; exit 2 ;;
esac

log() { echo "deploy[$environment]: $*"; }
fail() { echo "deploy[$environment]: $*" >&2; exit 1; }

[ -f "$stack_dir/.env" ] || fail "missing $stack_dir/.env – provision the environment first"

cp "$source_dir/compose.yaml" "$stack_dir/compose.yaml"
printf 'IMAGE_TAG=%s\n' "$sha" > "$stack_dir/deploy.env.next"
cd "$stack_dir"

next() { docker compose --env-file .env --env-file deploy.env.next "$@"; }
current() { docker compose --env-file .env --env-file deploy.env "$@"; }

rollback() {
  if [ -f deploy.env ]; then
    log "rolling back to $(cat deploy.env)"
    current up -d --wait --remove-orphans || log "rollback did not become healthy either"
  fi
}

log "pulling images for $sha"
next pull --quiet

log "starting database and broker"
next up -d --wait db broker

log "running migrations"
next run --rm --no-deps api node dist/migrate.js || fail "migrations failed – the running version was not touched"

log "starting the new version"
if ! next up -d --wait --remove-orphans; then
  rollback
  fail "the new version did not become healthy – rolled back"
fi

if ! next exec -T web wget -qO- http://127.0.0.1:8080/api/health/ready | grep -q '"status":"ok"'; then
  rollback
  fail "readiness check failed – rolled back"
fi

mv deploy.env.next deploy.env
log "deployed $sha"
