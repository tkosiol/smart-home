#!/usr/bin/env bash
# Tests for the deploy wrapper, deploy.sh and provision.sh using stubbed docker, curl and ssh.
# shellcheck disable=SC2016 # check() expressions are evaluated later on purpose
set -u
cd "$(dirname "$0")/.." || exit 1
DEPLOY_DIR=$(pwd)
STUBS="$DEPLOY_DIR/test/stubs"
SHA=0123456789abcdef0123456789abcdef01234567
OLD_SHA=89abcdef0123456789abcdef0123456789abcdef
failures=0
passed=0

setup() {
  WORK=$(mktemp -d)
  export STUB_CALLS="$WORK/calls" STUB_REMOTE_FILE="$WORK/remote-env"
  export SMART_STACKS_DIR="$WORK/apps"
  export PATH="$STUBS:$PATH"
  : > "$STUB_CALLS"
  unset STUB_FAIL_MIGRATE STUB_FAIL_UP STUB_FAIL_READY STUB_COMPARE_STATUS STUB_ENV_EXISTS SSH_ORIGINAL_COMMAND
}
teardown() { rm -rf "$WORK"; }
check() {
  if eval "$2"; then passed=$((passed + 1)); else echo "FAIL: $1"; failures=$((failures + 1)); fi
}
run_wrapper() { (sh "$DEPLOY_DIR/smart-deploy" "$@" > "$WORK/out" 2>&1); echo $?; }
prepare_stack() {
  mkdir -p "$SMART_STACKS_DIR/$1"
  echo "STACK_NAME=$1" > "$SMART_STACKS_DIR/$1/.env"
  if [ -n "${2:-}" ]; then echo "IMAGE_TAG=$2" > "$SMART_STACKS_DIR/$1/deploy.env"; fi
  mkdir -p "$WORK/src" && echo "name: x" > "$WORK/src/compose.yaml"
}
run_deploy() { (sh "$DEPLOY_DIR/deploy.sh" "$1" "$SHA" "$WORK/src" > "$WORK/out" 2>&1); echo $?; }

# --- smart-deploy (wrapper) ---
setup; check "wrapper rejects an unknown environment" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA" run_wrapper prod)" = 2 ]'; teardown
setup; check "wrapper rejects a missing command" '[ "$(run_wrapper staging)" = 2 ]'; teardown
setup; check "wrapper rejects a short sha" '[ "$(SSH_ORIGINAL_COMMAND="deploy abc123" run_wrapper staging)" = 2 ]'; teardown
setup; check "wrapper rejects extra arguments" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA; touch /tmp/pwned" run_wrapper staging)" = 2 ]'; teardown
setup; mkdir "$WORK/glob" && touch "$WORK/glob/$SHA"
# Without set -f, "deploy *" would expand to "deploy <sha>" here and be accepted.
check "wrapper does not expand globs" '[ "$(cd "$WORK/glob" && SSH_ORIGINAL_COMMAND="deploy *" run_wrapper staging)" = 2 ]'; teardown
setup; check "wrapper rejects other commands" '[ "$(SSH_ORIGINAL_COMMAND="ls -la" run_wrapper staging)" = 2 ]'; teardown
setup; export STUB_COMPARE_STATUS=diverged
check "wrapper refuses commits not on main" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA" run_wrapper staging)" = 3 ]'
check "wrapper fetches nothing for commits not on main" '! grep -q "raw" "$STUB_CALLS"'
check "wrapper never calls docker for commits not on main" '! grep -qv "^curl" "$STUB_CALLS"'; teardown
setup; export STUB_COMPARE_STATUS=ahead
check "wrapper refuses commits ahead of main" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA" run_wrapper staging)" = 3 ]'; teardown
setup; export STUB_COMPARE_STATUS=behind
check "wrapper runs the commit's deploy.sh for commits on main" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA" run_wrapper production)" = 0 ]'
check "wrapper passes environment and sha" 'grep -q "fake deploy production $SHA" "$STUB_CALLS"'
check "wrapper downloads files of exactly that commit" 'grep -q "/$SHA/infra/deploy/deploy.sh" "$STUB_CALLS" && grep -q "/$SHA/infra/compose/compose.yaml" "$STUB_CALLS"'; teardown

# --- deploy.sh ---
setup; check "deploy refuses an unprovisioned stack" '[ "$(run_deploy staging)" = 1 ]'
check "deploy makes no docker calls without .env" '[ ! -s "$STUB_CALLS" ]'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"
check "deploy succeeds on the happy path" '[ "$(run_deploy production)" = 0 ]'
check "deploy runs pull, migrate, up and readiness in order" '[ "$(grep -oE "pull|up -d --wait db broker|dist/migrate.js|up -d --wait --remove-orphans|exec -T web" "$STUB_CALLS" | tr "\n" " ")" = "pull up -d --wait db broker dist/migrate.js up -d --wait --remove-orphans exec -T web " ]'
check "deploy records the new sha" 'grep -qx "IMAGE_TAG=$SHA" "$SMART_STACKS_DIR/smart-prod/deploy.env"'
check "deploy copies the commit compose file" '[ -f "$SMART_STACKS_DIR/smart-prod/compose.yaml" ]'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_FAIL_MIGRATE=1
check "deploy stops when migrations fail" '[ "$(run_deploy production)" = 1 ]'
check "deploy never replaces containers after a failed migration" '! grep -q "remove-orphans" "$STUB_CALLS"'
check "deploy keeps the previous sha after a failed migration" 'grep -qx "IMAGE_TAG=$OLD_SHA" "$SMART_STACKS_DIR/smart-prod/deploy.env"'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_FAIL_UP=1
check "deploy fails when the new version is unhealthy" '[ "$(run_deploy production)" = 1 ]'
check "deploy rolls back to the previous version" 'grep -q "env-file deploy.env up -d --wait --remove-orphans" "$STUB_CALLS"'
check "deploy keeps the previous sha after rollback" 'grep -qx "IMAGE_TAG=$OLD_SHA" "$SMART_STACKS_DIR/smart-prod/deploy.env"'; teardown
setup; prepare_stack smart-staging "$OLD_SHA"; export STUB_FAIL_READY=1
check "deploy fails when readiness fails" '[ "$(run_deploy staging)" = 1 ]'
check "deploy rolls back when readiness fails" 'grep -q "env-file deploy.env up -d --wait --remove-orphans" "$STUB_CALLS"'; teardown

# --- provision.sh ---
answers() { printf 'b2-endpoint\nb2-bucket\nb2-key-id\nb2-app-key\nrestic-pw\nhttps://hc/backup\nhttps://hc/restore\n'; }
setup; export SMART_VPS=deploy@vps
check "provision refuses to overwrite an existing .env" '[ "$(STUB_ENV_EXISTS=1 bash "$DEPLOY_DIR/provision.sh" staging < /dev/null > /dev/null 2>&1; echo $?)" = 1 ]'
check "provision writes staging without backup settings" 'bash "$DEPLOY_DIR/provision.sh" staging < /dev/null > /dev/null 2>&1 && grep -qx "STACK_NAME=smart-staging" "$STUB_REMOTE_FILE" && ! grep -q "B2_" "$STUB_REMOTE_FILE"'
check "provision generates long random passwords" 'grep -Eq "^DB_PASSWORD=[0-9a-f]{64}$" "$STUB_REMOTE_FILE" && grep -Eq "^MQTT_API_PASSWORD=[0-9a-f]{64}$" "$STUB_REMOTE_FILE"'
check "provision writes the file with umask 077" 'grep -q "umask 077" "$STUB_CALLS"'
check "provision writes production with backup settings" 'answers | bash "$DEPLOY_DIR/provision.sh" production > /dev/null 2>&1 && grep -qx "COMPOSE_PROFILES=backup" "$STUB_REMOTE_FILE" && grep -qx "B2_APP_KEY=b2-app-key" "$STUB_REMOTE_FILE" && grep -qx "HC_RESTORE_URL=https://hc/restore" "$STUB_REMOTE_FILE"'
check "provision never prints secrets" '! answers | bash "$DEPLOY_DIR/provision.sh" production 2>&1 | grep -qE "b2-app-key|restic-pw"'; teardown

echo "deploy tests: $passed passed, $failures failed"
[ "$failures" -eq 0 ]
