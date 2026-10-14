#!/usr/bin/env bash
# Tests for the deploy wrapper, deploy.sh, provision.sh, admin.sh and broker-certs.sh using stubbed docker, curl and ssh.
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
  export SMART_STACKS_DIR="$WORK/apps" SMART_READY_DELAY=0
  export PATH="$STUBS:$PATH"
  : > "$STUB_CALLS"
  unset STUB_FAIL_INFRA STUB_FAIL_MIGRATE STUB_FAIL_UP STUB_READY_FAILURES STUB_COMPARE_STATUS STUB_ENV_EXISTS STUB_SSH_DOWN STUB_EXISTING_ENV STUB_SSH_EXEC STUB_REMOTE_HOME STUB_ARGV_LOG SSH_ORIGINAL_COMMAND
}
teardown() { rm -rf "$WORK"; }
mode_of() { stat -c %a "$1" 2> /dev/null || stat -f %Lp "$1"; }
check() {
  if eval "$2"; then passed=$((passed + 1)); else echo "FAIL: $1"; failures=$((failures + 1)); fi
}
run_wrapper() { (sh "$DEPLOY_DIR/smart-deploy" "$@" > "$WORK/out" 2>&1); echo $?; }
prepare_stack() {
  mkdir -p "$SMART_STACKS_DIR/$1"
  echo "STACK_NAME=$1" > "$SMART_STACKS_DIR/$1/.env"
  if [ -n "${2:-}" ]; then
    echo "IMAGE_TAG=$2" > "$SMART_STACKS_DIR/$1/deploy.env"
    echo "name: previous" > "$SMART_STACKS_DIR/$1/compose.yaml"
  fi
  mkdir -p "$WORK/src" && echo "name: next" > "$WORK/src/compose.yaml"
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
check "deploy promotes the commit compose file after success" 'grep -qx "name: next" "$SMART_STACKS_DIR/smart-prod/compose.yaml" && [ ! -e "$SMART_STACKS_DIR/smart-prod/compose.next.yaml" ]'
check "deploy runs the new version with the new compose file" 'grep -q "compose -f compose.next.yaml --env-file .env --env-file deploy.env.next up -d --wait --remove-orphans" "$STUB_CALLS"'; teardown
# Docker would create a missing ./certs bind mount as root; the stack directory must own it before anything starts.
setup; prepare_stack smart-prod "$OLD_SHA"
check "deploy creates the certs directory before the first compose call" '[ "$(run_deploy production)" = 0 ] && [ -d "$SMART_STACKS_DIR/smart-prod/certs" ]'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; mkdir "$SMART_STACKS_DIR/smart-prod/certs"; echo keep > "$SMART_STACKS_DIR/smart-prod/certs/ca.crt"
check "deploy leaves an existing certs directory alone" '[ "$(run_deploy production)" = 0 ] && [ "$(cat "$SMART_STACKS_DIR/smart-prod/certs/ca.crt")" = keep ]'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_FAIL_INFRA=1
check "deploy has created the certs directory even when the broker does not start" '[ "$(run_deploy production)" = 1 ] && [ -d "$SMART_STACKS_DIR/smart-prod/certs" ]'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_READY_FAILURES=2
check "deploy retries readiness while the new version warms up" '[ "$(run_deploy production)" = 0 ]'
check "deploy does not roll back a version that becomes ready" '! grep -q "env-file deploy.env up" "$STUB_CALLS"'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_FAIL_INFRA=1
check "deploy fails when database or broker do not start" '[ "$(run_deploy production)" = 1 ]'
check "deploy rolls back when database or broker do not start" 'grep -q "compose -f compose.yaml --env-file .env --env-file deploy.env up -d --wait --remove-orphans" "$STUB_CALLS"'
check "deploy skips migrations when database or broker do not start" '! grep -q "dist/migrate.js" "$STUB_CALLS"'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_FAIL_MIGRATE=1
check "deploy stops when migrations fail" '[ "$(run_deploy production)" = 1 ]'
check "deploy never replaces containers after a failed migration" '! grep -q "remove-orphans" "$STUB_CALLS"'
check "deploy keeps the previous sha after a failed migration" 'grep -qx "IMAGE_TAG=$OLD_SHA" "$SMART_STACKS_DIR/smart-prod/deploy.env"'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_FAIL_UP=1
check "deploy fails when the new version is unhealthy" '[ "$(run_deploy production)" = 1 ]'
check "deploy rolls back with the previous compose file" 'grep -q "compose -f compose.yaml --env-file .env --env-file deploy.env up -d --wait --remove-orphans" "$STUB_CALLS"'
check "deploy keeps the previous sha after rollback" 'grep -qx "IMAGE_TAG=$OLD_SHA" "$SMART_STACKS_DIR/smart-prod/deploy.env"'
check "deploy keeps the previous compose file after rollback" 'grep -qx "name: previous" "$SMART_STACKS_DIR/smart-prod/compose.yaml"'; teardown
setup; prepare_stack smart-staging "$OLD_SHA"; export STUB_READY_FAILURES=all
check "deploy fails when readiness fails" '[ "$(run_deploy staging)" = 1 ]'
check "deploy rolls back when readiness fails" 'grep -q "env-file deploy.env up -d --wait --remove-orphans" "$STUB_CALLS"'; teardown
setup; prepare_stack smart-prod; export STUB_FAIL_UP=1
check "first deploy fails cleanly when the new version is unhealthy" '[ "$(run_deploy production)" = 1 ] && [ ! -e "$SMART_STACKS_DIR/smart-prod/deploy.env" ]'; teardown

# --- provision.sh ---
KEY_ID=0031234567890ab0000000003
APP_KEY=K003abcdefghijklmnopqrstuvwxyz0
RESEND_KEY=re_test_key_only
MAIL_FROM_ANSWER='Smart Home <noreply@example.org>'
# Answers in prompt order: Resend API key and sender (both stacks), the allowlist (staging only), then the B2 block (production only).
mail_answers() { printf '%s\n%s\n' "$RESEND_KEY" "$MAIL_FROM_ANSWER"; }
staging_answers() { mail_answers; printf '%s\n' 'till@example.org, Friend@Example.org'; }
b2_answers() { printf 'b2-endpoint\nb2-bucket\n%s\n%s\nrestic-pw\nhttps://hc/backup\nhttps://hc/restore\n' "$KEY_ID" "$APP_KEY"; }
answers() { mail_answers; b2_answers; }
swapped_answers() { mail_answers; printf 'b2-endpoint\nb2-bucket\n%s\n%s\nrestic-pw\nhttps://hc/backup\nhttps://hc/restore\n' "$APP_KEY" "$KEY_ID"; }
provision_staging() { staging_answers | bash "$DEPLOY_DIR/provision.sh" staging "$@" > /dev/null 2>&1; }
setup; export SMART_VPS=deploy@vps
check "provision refuses to overwrite an existing .env" '[ "$(STUB_ENV_EXISTS=1 bash "$DEPLOY_DIR/provision.sh" staging < /dev/null > /dev/null 2>&1; echo $?)" = 1 ]'
check "provision writes staging without backup settings" 'provision_staging && grep -qx "STACK_NAME=smart-staging" "$STUB_REMOTE_FILE" && ! grep -q "B2_" "$STUB_REMOTE_FILE"'
check "provision generates long random passwords" 'grep -Eq "^DB_PASSWORD=[0-9a-f]{64}$" "$STUB_REMOTE_FILE" && grep -Eq "^MQTT_API_PASSWORD=[0-9a-f]{64}$" "$STUB_REMOTE_FILE"'
check "provision writes the file with umask 077" 'grep -q "umask 077" "$STUB_CALLS"'
check "provision writes production with backup settings" 'answers | bash "$DEPLOY_DIR/provision.sh" production > /dev/null 2>&1 && grep -qx "COMPOSE_PROFILES=backup" "$STUB_REMOTE_FILE" && grep -qx "B2_APP_KEY=$APP_KEY" "$STUB_REMOTE_FILE" && grep -qx "HC_RESTORE_URL=https://hc/restore" "$STUB_REMOTE_FILE"'
check "provision never prints secrets" '! answers | bash "$DEPLOY_DIR/provision.sh" production 2>&1 | grep -qE "$APP_KEY|restic-pw|$RESEND_KEY"'
check "provision lets the backup container run as the stack owner" 'answers | bash "$DEPLOY_DIR/provision.sh" production > /dev/null 2>&1 && grep -qx "BACKUP_UID=4242" "$STUB_REMOTE_FILE" && grep -qx "BACKUP_GID=4343" "$STUB_REMOTE_FILE"'; teardown
setup; export SMART_VPS=deploy@vps
check "provision rejects an application key entered as keyID" '[ "$(swapped_answers | bash "$DEPLOY_DIR/provision.sh" production > /dev/null 2>&1; echo $?)" != 0 ] && [ ! -e "$STUB_REMOTE_FILE" ]'
check "provision never echoes a rejected keyID" '! swapped_answers | bash "$DEPLOY_DIR/provision.sh" production 2>&1 | grep -q "$APP_KEY"'; teardown
setup; export SMART_VPS=deploy@vps STUB_SSH_DOWN=1
check "provision aborts when the VPS is unreachable" '[ "$(staging_answers | bash "$DEPLOY_DIR/provision.sh" staging > /dev/null 2>&1; echo $?)" != 0 ] && [ ! -e "$STUB_REMOTE_FILE" ]'; teardown
setup; STUB_EXISTING_ENV=$(printf "STACK_NAME=smart-staging\nDB_PASSWORD=keep-db\nMQTT_API_PASSWORD=keep-mqtt")
export SMART_VPS=deploy@vps STUB_ENV_EXISTS=1 STUB_EXISTING_ENV
check "provision --force keeps the existing database and broker passwords" 'provision_staging --force && grep -qx "DB_PASSWORD=keep-db" "$STUB_REMOTE_FILE" && grep -qx "MQTT_API_PASSWORD=keep-mqtt" "$STUB_REMOTE_FILE"'; teardown

setup; export SMART_VPS=deploy@vps
check "provision writes no editor switch for staging" 'provision_staging && grep -qx "STACK_NAME=smart-staging" "$STUB_REMOTE_FILE" && ! grep -q "SMART_INSTANCE_APPEARANCE_EDITOR" "$STUB_REMOTE_FILE"'; teardown
setup; export SMART_VPS=deploy@vps
check "provision writes no editor switch for production" 'answers | bash "$DEPLOY_DIR/provision.sh" production > /dev/null 2>&1 && grep -qx "COMPOSE_PROFILES=backup" "$STUB_REMOTE_FILE" && ! grep -q "SMART_INSTANCE_APPEARANCE_EDITOR" "$STUB_REMOTE_FILE"'; teardown
setup; STUB_EXISTING_ENV=$(printf 'STACK_NAME=smart-staging\nDB_PASSWORD=keep-db\nSMART_INSTANCE_APPEARANCE={"name":"kept"}')
export SMART_VPS=deploy@vps STUB_ENV_EXISTS=1 STUB_EXISTING_ENV
check "provision --force keeps existing runtime settings verbatim" 'provision_staging --force && grep -qxF "SMART_INSTANCE_APPEARANCE={\"name\":\"kept\"}" "$STUB_REMOTE_FILE"'; teardown
setup; STUB_EXISTING_ENV=$(printf 'STACK_NAME=smart-staging\nDB_PASSWORD=keep-db\nSMART_INSTANCE_APPEARANCE_EDITOR=true')
export SMART_VPS=deploy@vps STUB_ENV_EXISTS=1 STUB_EXISTING_ENV
check "provision --force tolerates the retired editor switch of an existing file" 'provision_staging --force && grep -qx "DB_PASSWORD=keep-db" "$STUB_REMOTE_FILE"'; teardown

# MQTT settings and the certs directory. The stub ssh runs the remote commands for real in a fake home.
exec_provision_setup() {
  setup
  export SMART_VPS=deploy@vps STUB_SSH_EXEC=1 STUB_REMOTE_HOME="$WORK/home"
  mkdir -p "$STUB_REMOTE_HOME"
}
exec_provision_setup
STAGING_STACK="$STUB_REMOTE_HOME/docker/apps/smart-staging"
check "provision writes MQTT_TLS=off and no public port for staging" 'provision_staging && grep -qx "MQTT_TLS=off" "$STAGING_STACK/.env" && [ "$(grep -c "^MQTT_TLS=" "$STAGING_STACK/.env")" = 1 ] && ! grep -q "MQTT_PUBLIC_PORT" "$STAGING_STACK/.env"'
check "provision creates the certs directory readable for the containers" '[ -d "$STAGING_STACK/certs" ] && [ "$(mode_of "$STAGING_STACK/certs")" = 755 ] && [ "$(mode_of "$STAGING_STACK/.env")" = 600 ]'
check "provision keeps the stack directory private" '[ "$(mode_of "$STAGING_STACK")" = 700 ]'
teardown
exec_provision_setup
# shellcheck disable=SC2034 # used by the check() expression below
PROD_STACK="$STUB_REMOTE_HOME/docker/apps/smart-prod"
check "provision publishes the MQTT port of production" 'answers | bash "$DEPLOY_DIR/provision.sh" production > /dev/null 2>&1 && grep -qx "MQTT_TLS=off" "$PROD_STACK/.env" && grep -qx "MQTT_PUBLIC_PORT=8883" "$PROD_STACK/.env" && [ "$(mode_of "$PROD_STACK/certs")" = 755 ]'
teardown
exec_provision_setup
STAGING_STACK="$STUB_REMOTE_HOME/docker/apps/smart-staging"
mkdir -p "$STAGING_STACK/certs" && printf 'ca\n' > "$STAGING_STACK/certs/ca.crt" && chmod 755 "$STAGING_STACK/certs"
printf 'STACK_NAME=smart-staging\nDB_PASSWORD=keep-db\nMQTT_API_PASSWORD=keep-mqtt\nMQTT_TLS=on\n' > "$STAGING_STACK/.env"
check "provision --force keeps MQTT_TLS=on set by broker-certs and the certificates" 'provision_staging --force && grep -qx "MQTT_TLS=on" "$STAGING_STACK/.env" && [ "$(grep -c "^MQTT_TLS=" "$STAGING_STACK/.env")" = 1 ] && [ "$(cat "$STAGING_STACK/certs/ca.crt")" = ca ]'
teardown
setup; STUB_EXISTING_ENV=$(printf 'STACK_NAME=smart-staging\nDB_PASSWORD=keep-db\nMQTT_TLS=on')
export SMART_VPS=deploy@vps STUB_ENV_EXISTS=1 STUB_EXISTING_ENV
check "provision --force writes the stored MQTT_TLS value once" 'provision_staging --force && [ "$(grep -c "^MQTT_TLS=" "$STUB_REMOTE_FILE")" = 1 ] && grep -qx "MQTT_TLS=on" "$STUB_REMOTE_FILE"'; teardown

# Mail, origin and proxy settings.
setup; export SMART_VPS=deploy@vps
check "provision writes the https origin and two proxy hops for staging" 'provision_staging && grep -qx "APP_ORIGIN=https://staging.smart.tillkosiol.de" "$STUB_REMOTE_FILE" && grep -qx "TRUSTED_PROXY_HOPS=2" "$STUB_REMOTE_FILE"'
check "provision builds SMTP_URL from the Resend key" 'grep -qx "SMTP_URL=smtps://resend:$RESEND_KEY@smtp.resend.com:465" "$STUB_REMOTE_FILE"'
check "provision writes the sender as given" 'grep -qxF "MAIL_FROM=$MAIL_FROM_ANSWER" "$STUB_REMOTE_FILE"'
check "provision writes the staging allowlist without blanks" 'grep -qx "MAIL_ALLOWLIST=till@example.org,Friend@Example.org" "$STUB_REMOTE_FILE"'
check "provision never prints the Resend key" '! staging_answers | bash "$DEPLOY_DIR/provision.sh" staging 2>&1 | grep -q "$RESEND_KEY"'; teardown
setup; export SMART_VPS=deploy@vps
check "provision writes origin and proxy hops for production, without an allowlist" 'answers | bash "$DEPLOY_DIR/provision.sh" production > /dev/null 2>&1 && grep -qx "APP_ORIGIN=https://smart.tillkosiol.de" "$STUB_REMOTE_FILE" && grep -qx "TRUSTED_PROXY_HOPS=2" "$STUB_REMOTE_FILE" && grep -q "^SMTP_URL=smtps://resend:" "$STUB_REMOTE_FILE" && grep -q "^MAIL_FROM=" "$STUB_REMOTE_FILE" && ! grep -q "MAIL_ALLOWLIST" "$STUB_REMOTE_FILE"'; teardown
setup; export SMART_VPS=deploy@vps
check "provision rejects a malformed Resend key and writes nothing" '[ "$(printf "not a key\n%s\nx@example.org\n" "$MAIL_FROM_ANSWER" | bash "$DEPLOY_DIR/provision.sh" staging > /dev/null 2>&1; echo $?)" != 0 ] && [ ! -e "$STUB_REMOTE_FILE" ]'
check "provision never echoes a rejected Resend key" '! printf "secret@host/x\n%s\nx@example.org\n" "$MAIL_FROM_ANSWER" | bash "$DEPLOY_DIR/provision.sh" staging 2>&1 | grep -q "secret@host"'
check "provision requires the Resend key on a first run" '[ "$(printf "\n%s\nx@example.org\n" "$MAIL_FROM_ANSWER" | bash "$DEPLOY_DIR/provision.sh" staging > /dev/null 2>&1; echo $?)" != 0 ] && [ ! -e "$STUB_REMOTE_FILE" ]'
check "provision requires a staging allowlist on a first run" '[ "$(printf "%s\n%s\n\n" "$RESEND_KEY" "$MAIL_FROM_ANSWER" | bash "$DEPLOY_DIR/provision.sh" staging > /dev/null 2>&1; echo $?)" != 0 ] && [ ! -e "$STUB_REMOTE_FILE" ]'
check "provision requires a sender on a first run" '[ "$(printf "%s\n\nx@example.org\n" "$RESEND_KEY" | bash "$DEPLOY_DIR/provision.sh" staging > /dev/null 2>&1; echo $?)" != 0 ] && [ ! -e "$STUB_REMOTE_FILE" ]'
check "provision rejects characters that break an env file" '[ "$(printf "%s\nSmart \$HOME <a@example.org>\nx@example.org\n" "$RESEND_KEY" | bash "$DEPLOY_DIR/provision.sh" staging > /dev/null 2>&1; echo $?)" != 0 ] && [ ! -e "$STUB_REMOTE_FILE" ]'; teardown
setup; STUB_EXISTING_ENV=$(printf 'STACK_NAME=smart-staging\nDB_PASSWORD=keep-db\nSMTP_URL=smtps://resend:re_old_key@smtp.resend.com:465\nMAIL_FROM=Old <old@example.org>\nMAIL_ALLOWLIST=old@example.org\nTRUSTED_PROXY_HOPS=3')
export SMART_VPS=deploy@vps STUB_ENV_EXISTS=1 STUB_EXISTING_ENV
check "provision --force keeps existing mail settings when the answers are empty" 'printf "\n\n\n" | bash "$DEPLOY_DIR/provision.sh" staging --force > /dev/null 2>&1 && grep -qx "SMTP_URL=smtps://resend:re_old_key@smtp.resend.com:465" "$STUB_REMOTE_FILE" && grep -qxF "MAIL_FROM=Old <old@example.org>" "$STUB_REMOTE_FILE" && grep -qx "MAIL_ALLOWLIST=old@example.org" "$STUB_REMOTE_FILE"'
check "provision --force keeps an existing proxy hop count" 'grep -qx "TRUSTED_PROXY_HOPS=3" "$STUB_REMOTE_FILE"'
check "provision --force replaces mail settings that are answered" 'provision_staging --force && grep -qx "SMTP_URL=smtps://resend:$RESEND_KEY@smtp.resend.com:465" "$STUB_REMOTE_FILE" && grep -qx "MAIL_ALLOWLIST=till@example.org,Friend@Example.org" "$STUB_REMOTE_FILE"'
check "provision --force never prints the stored key" '! printf "\n\n\n" | bash "$DEPLOY_DIR/provision.sh" staging --force 2>&1 | grep -q "re_old_key"'; teardown

# --- admin.sh ---
run_admin() { (bash "$DEPLOY_DIR/admin.sh" "$@" < /dev/null > "$WORK/out" 2>&1); echo $?; }
setup; export SMART_VPS=deploy@vps
check "admin refuses an unknown command" '[ "$(run_admin staging recovery-link --email a@example.org)" = 2 ]'
check "admin refuses a shell command as the command" '[ "$(run_admin staging "create-admin; id")" = 2 ]'
check "admin refuses an unknown environment" '[ "$(run_admin prod create-admin --email a@example.org --name A)" = 2 ]'
check "admin refuses a shell command after revoke-sessions" '[ "$(run_admin staging "revoke-sessions; id")" = 2 ]'
check "admin refuses a missing command" '[ "$(run_admin staging)" = 2 ]'
check "admin contacts the VPS only for allowed commands" '[ ! -s "$STUB_CALLS" ]'; teardown
setup; unset SMART_VPS
check "admin requires SMART_VPS" '[ "$(run_admin staging create-admin --email a@example.org --name A)" != 0 ] && [ ! -s "$STUB_CALLS" ]'; teardown
setup; export SMART_VPS=deploy@vps
check "admin runs create-admin in the production stack with a terminal" '[ "$(run_admin production create-admin --email a@example.org --name Anna)" = 0 ] && grep -q "^ssh -t deploy@vps cd docker/apps/smart-prod && docker compose -f compose.yaml --env-file .env --env-file deploy.env exec -T api node dist/cli.js create-admin " "$STUB_CALLS"'
check "admin uses the staging stack for staging" 'run_admin staging create-admin --email a@example.org --name Anna > /dev/null && grep -q "cd docker/apps/smart-staging &&" "$STUB_CALLS"'; teardown
setup; export SMART_VPS=deploy@vps STUB_SSH_EXEC=1 STUB_REMOTE_HOME="$WORK/home" STUB_ARGV_LOG="$WORK/argv"
mkdir -p "$STUB_REMOTE_HOME/docker/apps/smart-staging"
# shellcheck disable=SC2034 # used by the check() expressions below
NASTY_NAME="O'Neil \"\$(touch $WORK/pwned)\" \`touch $WORK/pwned\`; touch $WORK/pwned #"
check "admin hands every argument to the remote command as one word" 'run_admin staging create-admin --email "a b@example.org" --name "$NASTY_NAME" > /dev/null && [ "$(tail -n 1 "$STUB_ARGV_LOG")" = "docker <compose> <-f> <compose.yaml> <--env-file> <.env> <--env-file> <deploy.env> <exec> <-T> <api> <node> <dist/cli.js> <create-admin> <--email> <a b@example.org> <--name> <$NASTY_NAME>" ]'
check "admin lets no argument run on the VPS" '[ ! -e "$WORK/pwned" ]'
check "admin runs revoke-sessions and hands its arguments over as one word each" 'run_admin staging revoke-sessions --email "a b@example.org" > /dev/null && [ "$(tail -n 1 "$STUB_ARGV_LOG")" = "docker <compose> <-f> <compose.yaml> <--env-file> <.env> <--env-file> <deploy.env> <exec> <-T> <api> <node> <dist/cli.js> <revoke-sessions> <--email> <a b@example.org>" ]'
check "admin keeps empty arguments" 'run_admin staging create-admin --name "" > /dev/null && tail -n 1 "$STUB_ARGV_LOG" | grep -q "<--name> <>$"'; teardown

# --- broker-certs.sh ---
# The stub ssh runs the remote command for real (STUB_SSH_EXEC=1) in a fake home, the stub docker records the call.
KEY_MARKER=key-content-that-must-never-be-printed
fake_pki() {
  mkdir -p "$WORK/pki"
  printf 'ca-content\n' > "$WORK/pki/ca.crt"
  printf 'server-content\n' > "$WORK/pki/server.crt"
  printf '%s\n' "$KEY_MARKER" > "$WORK/pki/server.key"
  printf 'crl-content\n' > "$WORK/pki/crl.pem"
  iso_at $(($(date +%s) + 200 * 86400)) > "$WORK/pki/crl-next-update"
}
iso_at() { { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2> /dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }; }
remote_stack() {
  mkdir -p "$STUB_REMOTE_HOME/docker/apps/$1"
  printf 'STACK_NAME=%s\nDB_PASSWORD=keep-db\nMQTT_TLS=off\nSMTP_URL=smtps://resend:re_keep@smtp.resend.com:465' "$1" > "$STUB_REMOTE_HOME/docker/apps/$1/.env"
  chmod 600 "$STUB_REMOTE_HOME/docker/apps/$1/.env"
}
run_certs() { (bash "$DEPLOY_DIR/broker-certs.sh" "$@" < /dev/null > "$WORK/out" 2>&1); echo $?; }
certs_setup() {
  setup; fake_pki
  export SMART_VPS=deploy@vps SMART_PKI_DIR="$WORK/pki" STUB_SSH_EXEC=1 STUB_REMOTE_HOME="$WORK/home"
  remote_stack smart-staging
}
certs_setup
check "broker-certs refuses an unknown environment" '[ "$(run_certs prod)" = 2 ] && [ "$(run_certs)" = 2 ] && [ ! -s "$STUB_CALLS" ]'
check "broker-certs refuses an environment with a shell command" '[ "$(run_certs "staging; id")" = 2 ] && [ ! -s "$STUB_CALLS" ]'
unset SMART_VPS
check "broker-certs requires SMART_VPS" '[ "$(run_certs staging)" != 0 ] && [ ! -s "$STUB_CALLS" ]'
export SMART_VPS=deploy@vps
rm "$WORK/pki/crl-next-update"
check "broker-certs refuses to run with a missing file and contacts nothing" '[ "$(run_certs staging)" = 1 ] && grep -q "crl-next-update" "$WORK/out" && [ ! -s "$STUB_CALLS" ]'
fake_pki
check "broker-certs refuses a stack without a provisioned .env" '[ "$(run_certs production)" = 1 ] && [ ! -e "$STUB_REMOTE_HOME/docker/apps/smart-prod/certs" ] && ! grep -q "^compose" "$STUB_CALLS"'
check "broker-certs succeeds for staging" '[ "$(run_certs staging)" = 0 ]'
# shellcheck disable=SC2034 # used by the check() expressions below
STACK_DIR="$STUB_REMOTE_HOME/docker/apps/smart-staging"
check "broker-certs copies all five files unchanged" 'for f in ca.crt server.crt server.key crl.pem crl-next-update; do cmp -s "$WORK/pki/$f" "$STACK_DIR/certs/$f" || exit 1; done'
check "broker-certs keeps the key private and the public files readable" '[ "$(mode_of "$STACK_DIR/certs/server.key")" = 600 ] && [ "$(mode_of "$STACK_DIR/certs/ca.crt")" = 644 ] && [ "$(mode_of "$STACK_DIR/certs/crl.pem")" = 644 ] && [ "$(mode_of "$STACK_DIR/certs/crl-next-update")" = 644 ] && [ "$(mode_of "$STACK_DIR/certs")" = 755 ]'
check "broker-certs leaves no temporary files" '[ -z "$(find "$STACK_DIR" -name "*.new")" ]'
check "broker-certs sets MQTT_TLS=on exactly once" '[ "$(grep -c "^MQTT_TLS=" "$STACK_DIR/.env")" = 1 ] && grep -qx "MQTT_TLS=on" "$STACK_DIR/.env"'
check "broker-certs changes no other line of the .env" '[ "$(grep -v "^MQTT_TLS=" "$STACK_DIR/.env")" = "$(printf "STACK_NAME=smart-staging\nDB_PASSWORD=keep-db\nSMTP_URL=smtps://resend:re_keep@smtp.resend.com:465")" ]'
check "broker-certs keeps the .env at mode 600" '[ "$(mode_of "$STACK_DIR/.env")" = 600 ]'
check "broker-certs recreates the broker of the stack" 'grep -qx "compose -f compose.yaml --env-file .env --env-file deploy.env up -d --no-deps --force-recreate broker" "$STUB_CALLS"'
check "broker-certs sends all files in one ssh session on stdin with umask 077" '[ "$(grep -c "^ssh deploy@vps umask 077 && cd docker/apps/smart-staging && mkdir -p certs" "$STUB_CALLS")" = 1 ] && grep -q "tar -xf - -C certs/.new" "$STUB_CALLS"'
check "broker-certs leaves no .new directory and no ._ files" '[ ! -e "$STACK_DIR/certs/.new" ] && [ -z "$(find "$STACK_DIR/certs" -name "._*")" ] && [ "$(ls "$STACK_DIR/certs" | wc -l | tr -d " ")" = 5 ]'
check "broker-certs never puts key content on a command line or in the output" '! grep -q "$KEY_MARKER" "$STUB_CALLS" && ! grep -q "$KEY_MARKER" "$WORK/out"'
check "broker-certs works a second time and keeps one MQTT_TLS line" '[ "$(run_certs staging)" = 0 ] && [ "$(grep -c "^MQTT_TLS=" "$STACK_DIR/.env")" = 1 ] && grep -qx "MQTT_TLS=on" "$STACK_DIR/.env"'
teardown
certs_setup
printf 'STACK_NAME=smart-staging' > "$STUB_REMOTE_HOME/docker/apps/smart-staging/.env"
check "broker-certs appends MQTT_TLS to an .env without trailing newline and without the line" '[ "$(run_certs staging)" = 0 ] && [ "$(cat "$STUB_REMOTE_HOME/docker/apps/smart-staging/.env")" = "$(printf "STACK_NAME=smart-staging\nMQTT_TLS=on")" ]'
teardown
certs_setup; remote_stack smart-prod
check "broker-certs uses the production stack for production" '[ "$(run_certs production)" = 0 ] && [ -f "$STUB_REMOTE_HOME/docker/apps/smart-prod/certs/server.key" ] && [ ! -e "$STUB_REMOTE_HOME/docker/apps/smart-staging/certs" ]'
teardown
certs_setup
printf 'STACK_NAME=smart-staging\nMQTT_TLS=off\n' > "$STUB_REMOTE_HOME/docker/apps/smart-staging/.env"; chmod 000 "$STUB_REMOTE_HOME/docker/apps/smart-staging/.env"
check "broker-certs fails on an unreadable .env and changes nothing" '[ "$(run_certs staging)" = 1 ] && chmod 600 "$STUB_REMOTE_HOME/docker/apps/smart-staging/.env" && [ "$(cat "$STUB_REMOTE_HOME/docker/apps/smart-staging/.env")" = "$(printf "STACK_NAME=smart-staging\nMQTT_TLS=off")" ] && [ ! -e "$STUB_REMOTE_HOME/docker/apps/smart-staging/certs" ] && ! grep -q "^compose" "$STUB_CALLS"'
teardown
certs_setup; export STUB_SSH_DOWN=1
check "broker-certs aborts when the VPS is unreachable" '[ "$(run_certs staging)" != 0 ] && ! grep -q "^compose" "$STUB_CALLS"'
teardown
certs_setup; iso_at $(($(date +%s) - 86400)) > "$WORK/pki/crl-next-update"
check "broker-certs refuses an expired CRL and contacts nothing" '[ "$(run_certs staging)" = 1 ] && grep -q "CRL" "$WORK/out" && [ ! -s "$STUB_CALLS" ]'
iso_at $(($(date +%s) + 3 * 86400)) > "$WORK/pki/crl-next-update"
check "broker-certs refuses a CRL that expires within 7 days" '[ "$(run_certs staging)" = 1 ] && [ ! -s "$STUB_CALLS" ]'
printf 'garbage\n' > "$WORK/pki/crl-next-update"
check "broker-certs refuses a malformed crl-next-update" '[ "$(run_certs staging)" = 1 ] && [ ! -s "$STUB_CALLS" ]'
fake_pki; chmod 000 "$WORK/pki/server.key"
check "broker-certs refuses an unreadable key before contacting the VPS" '[ "$(run_certs staging)" = 1 ] && grep -q "server.key" "$WORK/out" && [ ! -s "$STUB_CALLS" ]'
chmod 600 "$WORK/pki/server.key"; teardown
certs_setup; mkdir -p "$STUB_REMOTE_HOME/docker/apps/smart-staging/certs"
printf 'old-ca\n' > "$STUB_REMOTE_HOME/docker/apps/smart-staging/certs/ca.crt"; printf 'old-key\n' > "$STUB_REMOTE_HOME/docker/apps/smart-staging/certs/server.key"
# A tar that works for creating the archive but fails when the VPS side unpacks it halfway.
mkdir "$WORK/badtar"
printf '#!/bin/sh\ncase "$1" in -x*) head -c 10 > /dev/null; exit 1 ;; esac\nexec %s "$@"\n' "$(command -v tar)" > "$WORK/badtar/tar"
chmod +x "$WORK/badtar/tar"
SAVED_PATH=$PATH
export PATH="$WORK/badtar:$PATH"
check "broker-certs leaves the previous certs untouched when the transfer fails" '[ "$(run_certs staging)" != 0 ] && [ "$(cat "$STUB_REMOTE_HOME/docker/apps/smart-staging/certs/ca.crt")" = old-ca ] && [ "$(cat "$STUB_REMOTE_HOME/docker/apps/smart-staging/certs/server.key")" = old-key ] && grep -qx "MQTT_TLS=off" "$STUB_REMOTE_HOME/docker/apps/smart-staging/.env" && ! grep -q "^compose" "$STUB_CALLS"'
PATH=$SAVED_PATH
teardown

echo "deploy tests: $passed passed, $failures failed"
[ "$failures" -eq 0 ]
