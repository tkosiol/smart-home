#!/bin/sh
# Deploys the images of one commit to one environment; rolls back automatically if the new version is unhealthy.
# Usage: deploy.sh <staging|production> <commit-sha> <dir containing that commit's compose.yaml>
#
# The running release is described by compose.yaml + deploy.env. The candidate is staged as
# compose.next.yaml + deploy.env.next and only promoted after it is healthy and ready.
set -eu

environment="$1"
sha="$2"
source_dir="$3"
stacks_dir="${SMART_STACKS_DIR:-$HOME/docker/apps}"
ready_attempts="${SMART_READY_ATTEMPTS:-12}"
ready_delay="${SMART_READY_DELAY:-5}"

case "$environment" in
  staging) stack_dir="$stacks_dir/smart-staging" ;;
  production) stack_dir="$stacks_dir/smart-prod" ;;
  *) echo "deploy: invalid environment '$environment'" >&2; exit 2 ;;
esac

log() { echo "deploy[$environment]: $*"; }
fail() { echo "deploy[$environment]: $*" >&2; exit 1; }

[ -f "$stack_dir/.env" ] || fail "missing $stack_dir/.env – provision the environment first"

cp "$source_dir/compose.yaml" "$stack_dir/compose.next.yaml"
printf 'IMAGE_TAG=%s\n' "$sha" > "$stack_dir/deploy.env.next"
cd "$stack_dir"
# The compose file bind-mounts ./certs; Docker would create a missing directory as root.
mkdir -p certs

next() { docker compose -f compose.next.yaml --env-file .env --env-file deploy.env.next "$@"; }
current() { docker compose -f compose.yaml --env-file .env --env-file deploy.env "$@"; }

rollback() {
  if [ -f deploy.env ] && [ -f compose.yaml ]; then
    log "rolling back to $(cat deploy.env)"
    current up -d --wait --remove-orphans || log "rollback did not become healthy either"
  else
    log "no previous release to roll back to"
  fi
}

ready() {
  attempt=1
  while [ "$attempt" -le "$ready_attempts" ]; do
    if next exec -T web wget -qO- http://127.0.0.1:8080/api/health/ready | grep -q '"status":"ok"'; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep "$ready_delay"
  done
  return 1
}

log "pulling images for $sha"
next pull --quiet

log "starting database and broker"
if ! next up -d --wait db broker; then
  rollback
  fail "database or broker did not become healthy – rolled back"
fi

log "running migrations"
next run --rm --no-deps api node dist/migrate.js || fail "migrations failed – api and web still run the previous release"

log "starting the new version"
if ! next up -d --wait --remove-orphans; then
  rollback
  fail "the new version did not become healthy – rolled back"
fi

if ! ready; then
  rollback
  fail "readiness check failed – rolled back"
fi

mv compose.next.yaml compose.yaml
mv deploy.env.next deploy.env
log "deployed $sha"
