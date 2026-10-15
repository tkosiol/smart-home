#!/usr/bin/env bash
# Tests for gateway/deploy.sh with stubbed ssh, rsync, sudo, docker, timeout and chown. The stub ssh runs the remote
# commands for real in a sandbox that stands in for the Pi (a fake home with /srv/smart-gateway and the old stack),
# the stub docker keeps the state of the old and the new stack. Nothing real is contacted; secrets are invented.
# shellcheck disable=SC2016 # check() expressions are evaluated later on purpose
set -u
cd "$(dirname "$0")/.." || exit 1
GATEWAY_DIR=$(pwd)
DEPLOY="$GATEWAY_DIR/deploy.sh"
failures=0
passed=0

Z2M_PASSWORD_MARKER=z2m-password-that-must-never-appear
Z2M_TOKEN_MARKER=frontend-token-that-must-never-appear
DATA_MARKER=zigbee-network-key-marker

mode_of() { stat -c %a "$1" 2> /dev/null || stat -f %Lp "$1"; }
check() {
  if eval "$2"; then
    passed=$((passed + 1))
  else
    echo "FAIL: $1"
    failures=$((failures + 1))
    if [ -n "${VERBOSE:-}" ]; then
      sed 's/^/    out: /' "$OUT" 2> /dev/null
      tail -n 15 "$CALLS" 2> /dev/null | cut -c1-200 | sed 's/^/    call: /'
    fi
  fi
}

# A fresh sandbox: the Pi (home with /srv/smart-gateway, provisioned secrets, an old stack with data) and the stubs.
setup() {
  WORK=$(mktemp -d)
  HOME_DIR="$WORK/home"
  PI_DIR="$HOME_DIR/srv/smart-gateway"
  OLD="$HOME_DIR/opt/old-stack"
  mkdir -p "$PI_DIR/secrets" "$OLD/zigbee2mqtt-data" "$WORK/bin" "$WORK/state" "$WORK/systemd"
  for tool in docker rsync timeout chown systemctl systemd-run tar cp ssh cut; do ln -s "$GATEWAY_DIR/test/stubs/$tool" "$WORK/bin/$tool"; done
  ln -s "$GATEWAY_DIR/../infra/deploy/test/stubs/sudo" "$WORK/bin/sudo"
  printf 'GATEWAY_ID=gw-testpi01\nBROKER_HOST=mqtt.example.org\nBROKER_PORT=8883\nZ2M_SERIAL_DEVICE=/dev/null\n' > "$PI_DIR/secrets/gateway.env"
  printf 'ZIGBEE2MQTT_CONFIG_MQTT_USER=z2m\nZIGBEE2MQTT_CONFIG_MQTT_PASSWORD=%s\nZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN=%s\n' "$Z2M_PASSWORD_MARKER" "$Z2M_TOKEN_MARKER" > "$PI_DIR/secrets/z2m.env"
  for f in passwd ca.crt gateway.crt gateway.key backup.env; do echo "invented $f" > "$PI_DIR/secrets/$f"; done
  chmod 700 "$PI_DIR/secrets"
  chmod 600 "$PI_DIR"/secrets/*
  echo "sentinel" > "$PI_DIR/secrets/sentinel"
  printf 'homeassistant: false\nnetwork_key: %s\n' "$DATA_MARKER" > "$OLD/zigbee2mqtt-data/configuration.yaml"
  echo "devices" > "$OLD/zigbee2mqtt-data/database.db"
  chmod 644 "$OLD/zigbee2mqtt-data/configuration.yaml"
  echo "name: old" > "$OLD/docker-compose.yml"
  : > "$WORK/state/old_running"
  : > "$WORK/calls"
  CALLS="$WORK/calls"
  # shellcheck disable=SC2034 # used by the check() expressions
  OLD_STOP="docker compose -f $OLD/docker-compose.yml stop"
  OUT="$WORK/out"
  unset SMART_PI SMART_PI_OLD_STACK SMART_CGROUP_CONTROLLERS SMART_PROC_CGROUPS
  unset STUB_SSH_DOWN STUB_SUDO_PASSWORD STUB_FAIL_PULL STUB_FAIL_NEW_UP STUB_FAIL_OLD_UP STUB_FAIL_OLD_STOP \
    STUB_FAIL_RSYNC STUB_Z2M_OFFLINE STUB_BRIDGE STUB_FAIL_SYSTEMCTL STUB_FAIL_NEW_STOP STUB_FAIL_DOCKER_STOP \
    STUB_Z2M_OLD_START STUB_Z2M_RESTARTS STUB_MOSQ_UNHEALTHY STUB_OLD_ONLY_MOSQ STUB_UP_DELAY STUB_SSH_DROP_AFTER_START \
    STUB_FAIL_SYSTEMD_RUN STUB_NO_START STUB_FAIL_TAR STUB_FAIL_TAR_VERIFY STUB_FAIL_CP STUB_FAIL_CHOWN \
    SMART_DEPLOY_MIGRATE_TIMEOUT SMART_DEPLOY_DETACH SMART_DEPLOY_STAMP SMART_DEPLOY_START_GRACE \
    STUB_PS_FAIL STUB_OLD_PS_FAIL STUB_CUT_FINISH STUB_SSH_BREAK_START STUB_SSH_BREAK_AFTER_START
  export PATH="$WORK/bin:$PATH"
  export STUB_CALLS="$CALLS" STUB_STATE="$WORK/state" STUB_SSH_EXEC=1 STUB_REMOTE_HOME="$HOME_DIR"
  export STUB_REAL_SSH="$GATEWAY_DIR/../infra/deploy/test/stubs/ssh"
  export SMART_PI=pi@pi SMART_GATEWAY_DIR="$PI_DIR" SMART_SYSTEMD_DIR="$WORK/systemd"
  # A Pi with the memory cgroup, a short wait (the real one is 120 s).
  echo "cpuset cpu io memory pids" > "$WORK/controllers"
  export SMART_CGROUP_CONTROLLERS="$WORK/controllers" SMART_PROC_CGROUPS="$WORK/no-proc-cgroups"
  export SMART_DEPLOY_WAIT_SECONDS=2 SMART_DEPLOY_POLL_SECONDS=1
}
# The detached migrate.sh of the Pi may still run when the Mac gave up: wait until it is over before the sandbox goes.
settle() {
  for _ in $(seq 1 60); do
    case "$(cut -d' ' -f1 "$PI_DIR/migration/status" 2> /dev/null)" in
      running) sleep 0.5 ;;
      *) return 0 ;;
    esac
  done
}
teardown() {
  settle
  if [ -n "${SHOW:-}" ] && [ -s "$OUT" ]; then echo "--- output:"; cat "$OUT"; fi
  rm -rf "$WORK"
}
deploy() { (bash "$DEPLOY" "$@" > "$OUT" 2>&1 < /dev/null); echo $?; }
# Line number of the first call line matching a pattern (0 = none).
line_of() { grep -n -m 1 -e "$1" "$CALLS" | cut -d: -f1 | grep . || echo 0; }
# Line numbers: $1 < $2 < ... and every one present.
in_order() {
  local previous=0 current pattern
  for pattern in "$@"; do
    current=$(line_of "$pattern")
    [ "$current" -gt "$previous" ] || return 1
    previous=$current
  done
}
excludes_all() {
  local e
  for e in secrets zigbee2mqtt-data run migration; do
    case "$1" in *"--exclude=/$e/"*) ;; *) return 1 ;; esac
  done
}
# The call that matches $1 is directly preceded by a timeout call.
bounded() {
  local n
  n=$(line_of "^docker.*$1")
  [ "$n" -gt 1 ] && sed -n "$((n - 1))p" "$CALLS" | grep -q "^timeout -k"
}
# No docker call that changes anything (the preflight only asks for the compose version).
no_stack_calls() { ! grep -Eq "^docker .*(pull|up -d|stop|down)" "$CALLS"; }
old_running() { [ -e "$WORK/state/old_running" ]; }
new_running() { [ -e "$WORK/state/new_running" ]; }
no_changes_on_pi() { [ ! -e "$PI_DIR/compose.yaml" ] && [ ! -e "$PI_DIR/run" ]; }

# --- arguments and settings: nothing is contacted ---
setup
unset SMART_PI
check "deploy requires SMART_PI and contacts nothing" '[ "$(deploy)" = 2 ] && grep -q SMART_PI "$OUT" && [ ! -s "$CALLS" ]'
export SMART_PI="-oProxyCommand=evil"
check "deploy rejects an option-like SMART_PI" '[ "$(deploy)" = 2 ] && [ ! -s "$CALLS" ]'
export SMART_PI=pi@pi
check "deploy rejects unknown arguments" '[ "$(deploy --migrat)" = 2 ] && [ "$(deploy --migrate extra)" = 2 ] && [ ! -s "$CALLS" ]'
check "deploy --migrate requires SMART_PI_OLD_STACK and contacts nothing" '[ "$(deploy --migrate)" = 2 ] && grep -q SMART_PI_OLD_STACK "$OUT" && [ ! -s "$CALLS" ]'
check "deploy rejects a SMART_PI_OLD_STACK that is not a plain absolute path" '[ "$(SMART_PI_OLD_STACK="old stack; id" deploy --migrate)" = 2 ] && [ "$(SMART_PI_OLD_STACK="relative/path" deploy --migrate)" = 2 ] && [ "$(SMART_PI_OLD_STACK="/opt/../etc" deploy --migrate)" = 2 ] && [ ! -s "$CALLS" ]'
check "deploy rejects a SMART_GATEWAY_DIR that is not a plain absolute path" '[ "$(SMART_GATEWAY_DIR="/srv/x y" deploy)" = 2 ] && [ ! -s "$CALLS" ]'
teardown

# --- preflight: abort before any change ---
setup; export STUB_SSH_DOWN=1
check "deploy aborts when the Pi is not reachable, before any change" '[ "$(deploy)" = 1 ] && grep -qi "not reach" "$OUT" && ! grep -q "^rsync" "$CALLS" && no_stack_calls && no_changes_on_pi'
check "deploy limits the connection attempt to 10 seconds" 'grep "^ssh " "$CALLS" | grep -q "ConnectTimeout=10"'; teardown
setup; export STUB_SUDO_PASSWORD=1
check "deploy aborts without passwordless sudo and says so" '[ "$(deploy)" = 1 ] && grep -qi "passwordless sudo" "$OUT" && ! grep -q "^rsync" "$CALLS" && no_changes_on_pi'; teardown
for missing in gateway.env z2m.env passwd ca.crt gateway.crt gateway.key backup.env; do
  setup; rm "$PI_DIR/secrets/$missing"
  check "deploy aborts when secrets/$missing is missing, names it and changes nothing" '[ "$(deploy)" = 1 ] && grep -q "$missing" "$OUT" && grep -q provision-gateway "$OUT" && ! grep -q "^rsync" "$CALLS" && no_stack_calls && no_changes_on_pi'
  teardown
done
setup; : > "$PI_DIR/secrets/passwd"
check "deploy treats an empty secret file as missing" '[ "$(deploy)" = 1 ] && grep -q passwd "$OUT" && no_changes_on_pi'; teardown
setup; rmdir "$PI_DIR/secrets" 2> /dev/null; rm -rf "$PI_DIR"
check "deploy aborts when the gateway directory does not exist on the Pi" '[ "$(deploy)" = 1 ] && grep -q provision-gateway "$OUT" && ! grep -q "^rsync" "$CALLS"'; teardown

# --- plain deploy ---
setup
check "deploy succeeds on the happy path" '[ "$(deploy --fresh)" = 0 ]'
check "deploy copies the package (compose file, render script, entry point, template) to the Pi" '[ -s "$PI_DIR/compose.yaml" ] && [ -s "$PI_DIR/render.sh" ] && [ -s "$PI_DIR/mosquitto-entrypoint.sh" ] && [ -s "$PI_DIR/mosquitto.conf.template" ]'
check "deploy keeps the render script executable and the files unwritable for others" '[ -x "$PI_DIR/render.sh" ] && grep "^rsync" "$CALLS" | grep -q -- "--chmod=go-w"'
check "deploy excludes secrets, Z2M data, run and migration from the rsync" 'excludes_all "$(grep "^rsync" "$CALLS")"'
check "deploy leaves the secrets untouched" '[ "$(cat "$PI_DIR/secrets/sentinel")" = sentinel ] && [ "$(mode_of "$PI_DIR/secrets/passwd")" = 600 ]'
check "deploy renders the Mosquitto configuration (mode 600)" 'grep -q "^connection gw-testpi01-bridge" "$PI_DIR/run/mosquitto.conf" && [ "$(mode_of "$PI_DIR/run/mosquitto.conf")" = 600 ]'
check "deploy pulls, recreates Mosquitto after the render, starts the stack and checks Z2M, in that order" 'in_order "^rsync" "gateway.env pull" "up -d --force-recreate mosquitto" "gateway.env up -d$" "bridge/state"'
check "deploy bounds pull, start and checks with a timeout" 'bounded "gateway.env pull" && bounded "up -d --force-recreate mosquitto" && bounded "gateway.env up -d$" && bounded "bridge/state"'
check "deploy limits every ssh connection attempt to 10 seconds" '[ "$(grep -c "^ssh " "$CALLS")" -gt 3 ] && [ "$(grep "^ssh " "$CALLS" | grep -vc "ConnectTimeout=10")" = 0 ] && grep "^rsync" "$CALLS" | grep -q "ConnectTimeout=10"'
check "deploy runs the compose commands as root with the secrets as project environment" 'grep -q "^docker compose --env-file secrets/gateway.env up -d" "$CALLS" && ! grep "^docker" "$CALLS" | grep -v -e "--env-file secrets/gateway.env" -e "compose version" -e "^docker inspect" | grep -q .'
check "deploy does not touch the old stack" '! grep -q "docker compose -f" "$CALLS" && old_running'
check "deploy sets the Z2M data folder to 700 and configuration.yaml to 600, owned by root" '[ "$(mode_of "$PI_DIR/zigbee2mqtt-data")" = 700 ] && chown_line=$(grep "^chown" "$CALLS") && echo "$chown_line" | grep -q "root:root"'
check "deploy prints the container status and the bridge state" 'grep -q "zigbee2mqtt  Up" "$OUT" && grep -qi "bridge.*connected" "$OUT"'
check "deploy never prints or sends a secret" '! grep -q -e "$Z2M_PASSWORD_MARKER" -e "$Z2M_TOKEN_MARKER" "$OUT" "$CALLS" && ! grep -q "invented" "$OUT" "$CALLS"'
check "deploy leaves nothing behind in the home of the operator or the folder of the Pi except the package" '[ ! -e "$PI_DIR/migration" ]'
teardown

setup; mkdir -p "$PI_DIR/zigbee2mqtt-data" "$PI_DIR/run"; echo "z2m: keep" > "$PI_DIR/zigbee2mqtt-data/configuration.yaml"; chmod 644 "$PI_DIR/zigbee2mqtt-data/configuration.yaml"; chmod 755 "$PI_DIR/zigbee2mqtt-data"
echo "run sentinel" > "$PI_DIR/run/keep"
check "a second deploy enforces 700 and 600 on existing Z2M data and does not touch it (no --fresh needed)" '[ "$(deploy)" = 0 ] && [ "$(mode_of "$PI_DIR/zigbee2mqtt-data")" = 700 ] && [ "$(mode_of "$PI_DIR/zigbee2mqtt-data/configuration.yaml")" = 600 ] && [ "$(cat "$PI_DIR/zigbee2mqtt-data/configuration.yaml")" = "z2m: keep" ]'
check "the rsync does not replace run/ or the Z2M data" '[ "$(cat "$PI_DIR/run/keep")" = "run sentinel" ]'
teardown

setup; echo "cpuset cpu io pids" > "$WORK/controllers"
check "deploy warns when the kernel has no memory cgroup but carries on" '[ "$(deploy --fresh)" = 0 ] && grep -qi "memory cgroup" "$OUT" && grep -q "cgroup_enable=memory" "$OUT"'; teardown
setup; rm "$WORK/controllers"; printf '#subsys_name hierarchy num_cgroups enabled\ncpu 3 1 1\nmemory 0 1 0\npids 5 1 1\n' > "$WORK/proc-cgroups"; export SMART_PROC_CGROUPS="$WORK/proc-cgroups"
check "deploy warns about a disabled memory cgroup in /proc/cgroups (cgroup v1 layout)" '[ "$(deploy --fresh)" = 0 ] && grep -qi "memory cgroup" "$OUT"'; teardown
setup
check "deploy does not warn when the memory cgroup is on" '[ "$(deploy --fresh)" = 0 ] && ! grep -qi "memory cgroup" "$OUT"'; teardown

setup; export STUB_FAIL_RSYNC=1
check "deploy stops when the rsync fails, before render, pull and start" '[ "$(deploy --fresh)" != 0 ] && no_stack_calls && [ ! -e "$PI_DIR/run" ]'; teardown
setup; export STUB_FAIL_PULL=1
check "deploy stops when the pull fails, without starting anything" '[ "$(deploy --fresh)" = 1 ] && ! grep -q "up -d" "$CALLS"'; teardown
setup; export STUB_FAIL_NEW_UP=1
check "deploy fails when the stack does not start" '[ "$(deploy --fresh)" = 1 ] && grep -qi "failed" "$OUT"'; teardown
setup; export STUB_Z2M_OFFLINE=1
check "deploy fails when Z2M does not report online, and does not touch any old stack" '[ "$(deploy --fresh)" = 1 ] && grep -qi "online" "$OUT" && ! grep -q "docker compose -f" "$CALLS"'; teardown
setup; export STUB_BRIDGE=0
check "deploy shows a bridge that is down (0) as a warning, not as a failure" '[ "$(deploy --fresh)" = 0 ] && grep -qi "bridge.*not connected" "$OUT"'; teardown

# --- backup timers ---
setup
bash "$DEPLOY" --fresh > "$OUT" 2>&1 < /dev/null
units="smart-gateway-backup.service smart-gateway-backup.timer smart-gateway-restore-test.service smart-gateway-restore-test.timer"
units_installed() {
  local u
  for u in $units; do { [ -s "$WORK/systemd/$u" ] && [ "$(mode_of "$WORK/systemd/$u")" = 644 ]; } || return 1; done
}
check "deploy installs the backup service, the restore-test service and both timers into the systemd folder (644)" \
  'units_installed'
check "deploy points the units at the gateway folder of the Pi" \
  'grep -q "ExecStart=.*$PI_DIR/backup/backup.sh" "$WORK/systemd/smart-gateway-backup.service" && grep -q "ExecStart=.*$PI_DIR/backup/restore-test.sh" "$WORK/systemd/smart-gateway-restore-test.service" && grep -q "^WorkingDirectory=$PI_DIR$" "$WORK/systemd/smart-gateway-backup.service" && ! grep -q "=/srv/smart-gateway" "$WORK"/systemd/*'
check "deploy copies the backup scripts and the systemd units to the Pi" '[ -s "$PI_DIR/backup/backup.sh" ] && [ -s "$PI_DIR/backup/restore-test.sh" ] && [ -s "$PI_DIR/backup/lib.sh" ] && [ -s "$PI_DIR/backup/restic-job.sh" ] && [ -s "$PI_DIR/systemd/smart-gateway-backup.timer" ]'
check "deploy reloads systemd and enables both timers with --now, after the stack is up" \
  'in_order "gateway.env up -d$" "bridge/state" "systemctl daemon-reload" "systemctl enable --now smart-gateway-backup.timer smart-gateway-restore-test.timer"'
check "deploy pulls the images of the backup profile too (the restic image) without starting the backup service" \
  'grep -q "^pull-profiles COMPOSE_PROFILES=backup" "$CALLS" && ! grep -E "^docker .*up -d" "$CALLS" | grep -q "profile"'
check "deploy never prints or sends the backup secrets" '! grep -q "invented backup.env" "$OUT" "$CALLS"'
teardown
setup; export STUB_FAIL_SYSTEMCTL=1
check "deploy fails with a clear message when the timers cannot be enabled (the stack stays up)" '[ "$(deploy --fresh)" = 1 ] && grep -qi "timer" "$OUT" && new_running'; teardown
setup; export STUB_Z2M_OFFLINE=1
check "deploy installs no timer when Z2M does not come up" '[ "$(deploy --fresh)" = 1 ] && [ ! -e "$WORK/systemd/smart-gateway-backup.timer" ] && ! grep -q "^systemctl" "$CALLS"'; teardown
setup; export SMART_PI_OLD_STACK="$OLD"
check "migrate installs the timers as well" '[ "$(deploy --migrate)" = 0 ] && [ -s "$WORK/systemd/smart-gateway-backup.timer" ]'; teardown
setup; export STUB_FAIL_RSYNC=1
check "deploy installs no timer when the copy to the Pi failed" '[ "$(deploy --fresh)" != 0 ] && ! grep -q "^systemctl" "$CALLS"'; teardown

# --- migration ---
setup; export SMART_PI_OLD_STACK="$OLD"
check "migrate succeeds on the happy path" '[ "$(deploy --migrate)" = 0 ]'
check "migrate backs up the Z2M data as a root-only tarball named after the UTC time" 'ls "$PI_DIR/migration" | grep -Eq "^[0-9]{8}T[0-9]{6}Z[.]tar[.]gz$" && f=$(ls "$PI_DIR"/migration/*.tar.gz) && [ "$(mode_of "$f")" = 600 ] && [ "$(mode_of "$PI_DIR/migration")" = 700 ] && tar -tzf "$f" | grep -q "zigbee2mqtt-data/configuration.yaml" && tar -xzOf "$f" zigbee2mqtt-data/configuration.yaml | grep -q "$DATA_MARKER"'
check "migrate backs up, stops the old stack, copies the data, starts the new stack and checks Z2M, in that order" 'in_order "tar -czf" "$OLD_STOP" "cp -a" "up -d --force-recreate mosquitto" "gateway.env up -d$" "bridge/state"'
check "migrate pulls the new images before it touches the old stack" 'in_order "gateway.env pull" "$OLD_STOP"'
check "migrate copies and does not move: the old data are still there, unchanged" '[ "$(cat "$OLD/zigbee2mqtt-data/configuration.yaml")" = "$(printf "homeassistant: false\nnetwork_key: %s" "$DATA_MARKER")" ] && [ -s "$OLD/zigbee2mqtt-data/database.db" ] && ! grep -E "(^| )mv " "$CALLS" | grep -q zigbee2mqtt-data'
check "migrate puts the copy into the new data folder (700, configuration.yaml 600, owned by root)" 'grep -q "$DATA_MARKER" "$PI_DIR/zigbee2mqtt-data/configuration.yaml" && [ -s "$PI_DIR/zigbee2mqtt-data/database.db" ] && [ "$(mode_of "$PI_DIR/zigbee2mqtt-data")" = 700 ] && [ "$(mode_of "$PI_DIR/zigbee2mqtt-data/configuration.yaml")" = 600 ] && grep "^chown" "$CALLS" | grep -q "root:root"'
check "migrate leaves the new stack running and the old one stopped, not removed" 'new_running && ! old_running && ! grep -q "docker compose -f $OLD/docker-compose.yml down" "$CALLS"'
check "migrate tells where the backup is, how to go back and to remove the old stack after the check" 'grep -q "migration/" "$OUT" && grep -qi "way back" "$OUT" && grep -q "docker-compose.yml" "$OUT"'
check "migrate never prints or sends a secret" '! grep -q -e "$Z2M_PASSWORD_MARKER" -e "$Z2M_TOKEN_MARKER" -e "$DATA_MARKER" "$OUT" "$CALLS"'
check "migrate bounds the copy, the backup and the stack commands with timeouts" 'n=$(grep -c "^timeout -k" "$CALLS"); [ "$n" -ge 6 ]'
teardown

setup; export SMART_PI_OLD_STACK="$OLD" STUB_FAIL_NEW_UP=1
check "migrate fails when the new stack does not start" '[ "$(deploy --migrate)" = 1 ]'
check "migrate then stops the new stack and starts the old one again" 'in_order "$OLD_STOP" "gateway.env up -d" "gateway.env stop" "docker compose -f $OLD/docker-compose.yml up -d" && ! new_running && old_running'
check "migrate keeps the old data intact on the way back and sets the failed copy aside" '[ -s "$OLD/zigbee2mqtt-data/database.db" ] && [ ! -e "$PI_DIR/zigbee2mqtt-data" ] && ls "$PI_DIR/migration" | grep -q "^failed-data-"'
check "migrate keeps the backup tarball after the way back" 'ls "$PI_DIR/migration" | grep -q "tar.gz$"'
check "migrate says it went back and how to retry" 'grep -qi "old stack is running again" "$OUT" && grep -q "exit\|failed" "$OUT"'
check "the way back never prints a secret" '! grep -q -e "$Z2M_PASSWORD_MARKER" -e "$Z2M_TOKEN_MARKER" -e "$DATA_MARKER" "$OUT" "$CALLS"'
teardown

setup; export SMART_PI_OLD_STACK="$OLD" STUB_Z2M_OFFLINE=1
check "migrate fails when Z2M does not report online within the time limit" '[ "$(deploy --migrate)" = 1 ] && grep -qi "online" "$OUT"'
check "migrate then goes back: new stack stopped, old stack started again" 'in_order "$OLD_STOP" "gateway.env up -d" "bridge/state" "gateway.env stop" "docker compose -f $OLD/docker-compose.yml up -d" && ! new_running && old_running && [ -s "$OLD/zigbee2mqtt-data/database.db" ]'; teardown

setup; export SMART_PI_OLD_STACK="$OLD" STUB_FAIL_NEW_UP=1 STUB_FAIL_OLD_UP=1
check "migrate shouts when the old stack does not start again either, with the manual command" '[ "$(deploy --migrate)" = 1 ] && grep -q "OLD STACK DID NOT START" "$OUT" && grep -q "$OLD/docker-compose.yml" "$OUT"'; teardown

setup; export SMART_PI_OLD_STACK="$OLD" STUB_FAIL_OLD_STOP=1
check "migrate goes back when the old stack cannot be stopped, and never copies" '[ "$(deploy --migrate)" = 1 ] && ! grep -q "cp -a" "$CALLS" && old_running'; teardown

setup; export SMART_PI_OLD_STACK="$OLD" STUB_FAIL_PULL=1
check "migrate stops at a failed pull without having touched the old stack" '[ "$(deploy --migrate)" = 1 ] && ! grep -q "$OLD_STOP" "$CALLS" && old_running && ! grep -q "tar -czf" "$CALLS"'; teardown

setup; export SMART_PI_OLD_STACK="$OLD"; rm "$OLD/docker-compose.yml"
check "migrate aborts before any change when the old compose file is missing" '[ "$(deploy --migrate)" = 1 ] && grep -q "docker-compose.yml" "$OUT" && ! grep -q "^rsync" "$CALLS" && no_changes_on_pi'; teardown
setup; export SMART_PI_OLD_STACK="$OLD"; rm -rf "$OLD/zigbee2mqtt-data"
check "migrate aborts before any change when the old data folder is missing" '[ "$(deploy --migrate)" = 1 ] && grep -q "zigbee2mqtt-data" "$OUT" && ! grep -q "^rsync" "$CALLS"'; teardown
setup; export SMART_PI_OLD_STACK="$OLD"; rm "$WORK/state/old_running"
check "migrate aborts before any change when the old stack is not running" '[ "$(deploy --migrate)" = 1 ] && grep -qi "not running" "$OUT" && ! grep -q "^rsync" "$CALLS" && no_changes_on_pi'; teardown
setup; export SMART_PI_OLD_STACK="$OLD"; mkdir -p "$PI_DIR/zigbee2mqtt-data"; echo existing > "$PI_DIR/zigbee2mqtt-data/database.db"
check "migrate refuses to merge into an existing new data folder and leaves it alone" '[ "$(deploy --migrate)" = 1 ] && grep -qi "already" "$OUT" && ! grep -q "$OLD_STOP" "$CALLS" && [ "$(cat "$PI_DIR/zigbee2mqtt-data/database.db")" = existing ] && old_running'; teardown
setup; export SMART_PI_OLD_STACK="$OLD"; export STUB_SSH_DOWN=1
check "migrate aborts when the Pi is not reachable, before any change" '[ "$(deploy --migrate)" = 1 ] && ! grep -q "^rsync" "$CALLS" && no_changes_on_pi'; teardown

# --- first start without Zigbee2MQTT data, stale or unstable Z2M ---
setup
check "a plain deploy refuses the first start without Z2M data, says --migrate and --fresh, and changes nothing" '[ "$(deploy)" = 1 ] && grep -q -e "--migrate" "$OUT" && grep -q -e "--fresh" "$OUT" && ! grep -q "^rsync" "$CALLS" && no_stack_calls && no_changes_on_pi'
mkdir -p "$PI_DIR/zigbee2mqtt-data"
check "a plain deploy refuses an empty Z2M data folder too" '[ "$(deploy)" = 1 ] && ! grep -q "^rsync" "$CALLS" && no_changes_on_pi'
check "deploy --fresh starts a new Pi without data" '[ "$(deploy --fresh)" = 0 ] && new_running'
check "deploy takes only one of --migrate and --fresh" '[ "$(deploy --fresh --migrate)" = 2 ]'
teardown
setup; export STUB_Z2M_OLD_START=1
check "deploy does not trust a retained online of a Z2M container that was not started by this deploy" '[ "$(deploy --fresh)" = 1 ] && grep -qi "online" "$OUT"'; teardown
setup; export STUB_Z2M_OLD_START=1; : > "$WORK/state/new_running"
check "deploy accepts a Z2M container that compose left alone when it has not restarted" '[ "$(deploy --fresh)" = 0 ]'; teardown
setup; export STUB_Z2M_RESTARTS=1
check "deploy fails on a Z2M that keeps restarting even though bridge/state says online" '[ "$(deploy --fresh)" = 1 ]'; teardown
setup; export STUB_MOSQ_UNHEALTHY=1
check "deploy fails when Mosquitto is not healthy" '[ "$(deploy --fresh)" = 1 ] && grep -qi "healthy" "$OUT"'; teardown
setup
deploy --fresh > /dev/null
check "deploy bounds render.sh, chown and the start with timeouts" 'grep -q "^timeout -k 10 120 bash ./render.sh" "$CALLS" && grep -q "^timeout -k 5 300 chown -R root:root" "$CALLS" && grep -q "^timeout -k 10 [0-9]* bash ./start.sh" "$CALLS"'; teardown

# --- the migration runs on the Pi, detached ---
setup; export SMART_PI_OLD_STACK="$OLD"
check "migrate succeeds" '[ "$(deploy --migrate)" = 0 ]'
check "migrate starts migrate.sh as the transient systemd unit smart-gateway-migrate with time to roll back" 'grep "^systemd-run" "$CALLS" | grep -q -e "--unit=smart-gateway-migrate" && grep "^systemd-run" "$CALLS" | grep -q -e "--property=TimeoutStopSec=" && grep "^systemd-run" "$CALLS" | grep -q "migrate.sh"'
check "the Pi writes the state done, the stamp and a log under migration/" 'read -r st sp pid step < "$PI_DIR/migration/status" && [ "$st" = done ] && ls "$PI_DIR"/migration/migrate-*.log > /dev/null && grep -q "backup verified" "$PI_DIR"/migration/migrate-*.log && [ "$sp" = "$(ls "$PI_DIR/migration" | sed -n "s/^migrate-\(.*\)[.]log$/\1/p")" ]'
check "the Mac prints the log tail of the Pi" 'grep -q "migration log on the Pi" "$OUT" && grep -q "backup verified" "$OUT"'
check "the Mac side never runs the destructive steps itself (the Pi script does)" '! grep "^ssh " "$CALLS" | grep -q "docker compose -f .*stop"'
check "migrate bounds tar -tzf, cp and chown with timeouts" 'grep -q "^timeout -k 10 300 tar -tzf" "$CALLS" && grep -q "^timeout -k 10 300 cp -a" "$CALLS" && grep -q "^timeout -k 5 300 chown -R" "$CALLS"'
teardown
setup; export SMART_PI_OLD_STACK="$OLD" SMART_DEPLOY_DETACH=nohup
check "migrate falls back to setsid/nohup without systemd-run" '[ "$(deploy --migrate)" = 0 ] && ! grep -q "^systemd-run" "$CALLS" && new_running && ! old_running'; teardown
setup; export SMART_PI_OLD_STACK="$OLD" STUB_FAIL_SYSTEMD_RUN=1
check "migrate stops before the old stack is touched when migrate.sh cannot be started" '[ "$(deploy --migrate)" = 1 ] && old_running && ! grep -q "$OLD_STOP" "$CALLS"'; teardown

# A dropped ssh connection after the start: the Pi finishes, the Mac retries.
setup; export SMART_PI_OLD_STACK="$OLD" STUB_SSH_DROP_AFTER_START=4
check "migrate tolerates ssh drops while polling and still reports the result" '[ "$(deploy --migrate)" = 0 ] && grep -q "does not answer" "$OUT" && new_running'; teardown
setup; export SMART_PI_OLD_STACK="$OLD" STUB_SSH_DROP_AFTER_START=1000 SMART_DEPLOY_MIGRATE_TIMEOUT=2 STUB_UP_DELAY=2
check "migrate: when the connection is gone for good the Mac gives up, says the Pi continues, and the Pi still completes" '[ "$(deploy --migrate)" = 1 ] && grep -qi "NOT stopped" "$OUT" && settle && [ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = done ] && new_running && ! old_running'; teardown
setup; export SMART_PI_OLD_STACK="$OLD" STUB_SSH_DROP_AFTER_START=1000 SMART_DEPLOY_MIGRATE_TIMEOUT=2 STUB_UP_DELAY=2 STUB_Z2M_OFFLINE=1
check "migrate: when the connection is gone for good the Pi still rolls back on its own" '[ "$(deploy --migrate)" = 1 ] && settle && [ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = rolled-back ] && old_running && ! new_running'; teardown

# Signals on the Mac during the polling do not affect the Pi.
for sig in HUP TERM INT; do
  setup; export SMART_PI_OLD_STACK="$OLD" STUB_UP_DELAY=3
  if ! command -v perl > /dev/null 2>&1; then teardown; continue; fi
  # A background job of a script ignores SIGINT (and nohup HUP); perl restores the default for the job.
  perl -e '$SIG{INT} = "DEFAULT"; $SIG{HUP} = "DEFAULT"; exec @ARGV' bash "$DEPLOY" --migrate > "$OUT" 2>&1 < /dev/null &
  mac=$!
  for _ in $(seq 1 100); do grep -q "^systemd-run" "$CALLS" && break; sleep 0.1; done
  sleep 0.5
  kill -"$sig" "$mac"
  wait "$mac" 2> /dev/null
  # shellcheck disable=SC2034 # used by the check() expression
  mac_rc=$?
  check "a $sig on the Mac during the polling ends the Mac side with a note that the Pi is not affected" '[ "$mac_rc" -ge 129 ] && grep -qi "NOT affected" "$OUT"'
  settle
  check "after a $sig on the Mac the Pi finishes the migration on its own" '[ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = done ] && new_running && ! old_running'
  teardown
done

# Rollback at every step of the Pi side.
for failure in STUB_FAIL_TAR STUB_FAIL_TAR_VERIFY STUB_FAIL_OLD_STOP STUB_FAIL_CP STUB_FAIL_CHOWN STUB_FAIL_NEW_UP STUB_Z2M_OFFLINE STUB_Z2M_RESTARTS STUB_MOSQ_UNHEALTHY; do
  setup; export SMART_PI_OLD_STACK="$OLD"; export "$failure=1"
  check "migrate rolls back when $failure: exit 1, state rolled-back, old stack running, new stopped" '[ "$(deploy --migrate)" = 1 ] && [ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = rolled-back ] && old_running && ! new_running && grep -q "rolled back" "$OUT"'
  check "the old data are intact and no copy stays in place after $failure" '[ "$(cat "$OLD/zigbee2mqtt-data/database.db")" = devices ] && [ ! -e "$PI_DIR/zigbee2mqtt-data" ]'
  teardown
done
setup; export SMART_PI_OLD_STACK="$OLD" STUB_FAIL_TAR=1
check "a failed backup changes nothing of the old setup: the old stack is never stopped" '[ "$(deploy --migrate)" = 1 ] && ! grep -q "$OLD_STOP" "$CALLS" && old_running'; teardown
setup; export SMART_PI_OLD_STACK="$OLD" STUB_FAIL_CP=1
check "a half-finished copy is set aside, not deleted" '[ "$(deploy --migrate)" = 1 ] && ls "$PI_DIR"/migration/failed-data-*/database.db > /dev/null'; teardown

# The way back never starts the old stack unless the new one is verified stopped.
setup; export SMART_PI_OLD_STACK="$OLD" STUB_Z2M_OFFLINE=1 STUB_FAIL_NEW_STOP=1
check "rollback stops the new stack by container name when compose stop does not work, then starts the old one" '[ "$(deploy --migrate)" = 1 ] && grep -q "^docker stop smart-gateway-zigbee2mqtt-1" "$CALLS" && grep -q "^docker rm -f smart-gateway-zigbee2mqtt-1" "$CALLS" && old_running && ! new_running && [ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = rolled-back ]'; teardown
setup; export SMART_PI_OLD_STACK="$OLD" STUB_Z2M_OFFLINE=1 STUB_FAIL_NEW_STOP=1 STUB_FAIL_DOCKER_STOP=1
check "rollback with a new stack that cannot be stopped: failed-manual, exit 1, the old stack is NOT started" '[ "$(deploy --migrate)" = 1 ] && [ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = failed-manual ] && ! old_running && ! grep -q "^docker compose -f $OLD/docker-compose.yml up -d" "$CALLS" && new_running'
check "that failure prints the exact manual commands" 'grep -q "MANUAL ACTION" "$OUT" && grep -q "docker compose -f $OLD/docker-compose.yml up -d" "$OUT" && grep -q "docker compose --env-file secrets/gateway.env stop" "$OUT"'
check "the copy stays in place while the new stack still uses it" '[ -d "$PI_DIR/zigbee2mqtt-data" ] && [ ! -e "$PI_DIR"/migration/failed-data-* ]'
check "the next migration is refused while the state is failed-manual, and nothing is started" 'n=$(grep -c "^systemd-run" "$CALLS"); rm -f "$WORK/state/new_running"; : > "$WORK/state/old_running"; rm -rf "$PI_DIR/zigbee2mqtt-data"; [ "$(deploy --migrate)" = 1 ] && grep -qi "manual" "$OUT" && [ "$(grep -c "^systemd-run" "$CALLS")" = "$n" ]'
teardown
setup; export SMART_PI_OLD_STACK="$OLD" STUB_FAIL_NEW_UP=1 STUB_FAIL_OLD_UP=1
check "the old stack that does not start again leaves the state failed-manual" '[ "$(deploy --migrate)" = 1 ] && [ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = failed-manual ]'; teardown

# Signals sent to migrate.sh itself (systemd stop, hang-up): rollback.
for sig in HUP TERM INT; do
  setup; export STUB_UP_DELAY=3
  cp "$GATEWAY_DIR/migrate.sh" "$GATEWAY_DIR/start.sh" "$PI_DIR/"
  if ! command -v perl > /dev/null 2>&1; then teardown; continue; fi
  perl -e '$SIG{INT} = "DEFAULT"; $SIG{HUP} = "DEFAULT"; exec @ARGV' bash "$PI_DIR/migrate.sh" "$PI_DIR" "$OLD" 20260101T000000Z 300 2 1 > /dev/null 2>&1 < /dev/null &
  pi=$!
  for _ in $(seq 1 100); do grep -q "start-new" "$PI_DIR/migration/status" 2> /dev/null && break; sleep 0.1; done
  kill -"$sig" "$pi"
  wait "$pi" 2> /dev/null
  check "migrate.sh rolls back on $sig during the start" '[ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = rolled-back ] && old_running && ! new_running && grep -q "received $sig" "$PI_DIR"/migration/migrate-*.log'
  teardown
done

# A Pi side that vanished (killed, power loss): the Mac does not wait for ever.
setup; export SMART_PI_OLD_STACK="$OLD" STUB_NO_START=1 SMART_DEPLOY_STAMP=20260101T000000Z
mkdir -p "$PI_DIR/migration"
true &
dead_pid=$!
wait "$dead_pid"
echo "running 20260101T000000Z $dead_pid copy" > "$PI_DIR/migration/status"
check "migrate reports a Pi side that vanished without a final state, as unknown state" '[ "$(deploy --migrate)" = 1 ] && grep -q "UNKNOWN" "$OUT"'; teardown
setup; export SMART_PI_OLD_STACK="$OLD"; mkdir -p "$PI_DIR/migration"
echo "running 20250101T000000Z $$ copy" > "$PI_DIR/migration/status"
check "migrate refuses to start while another migration runs on the Pi" '[ "$(deploy --migrate)" = 1 ] && grep -qi "running on the Pi already" "$OUT" && ! grep -q "^rsync" "$CALLS"'; teardown
setup; export SMART_PI_OLD_STACK="$OLD" STUB_OLD_ONLY_MOSQ=1
check "migrate refuses when only Mosquitto of the old stack runs (not the zigbee2mqtt service)" '[ "$(deploy --migrate)" = 1 ] && grep -qi "zigbee2mqtt service" "$OUT" && ! grep -q "^rsync" "$CALLS"'; teardown


# --- fix round 2: stop verification fails closed, status race, launch messages, plain deploy vs. a migration ---
for ps_code in 1 124; do
  setup; export SMART_PI_OLD_STACK="$OLD" STUB_Z2M_OFFLINE=1 STUB_PS_FAIL=$ps_code
  check "rollback with failing ps probes (exit $ps_code) is failed-manual and never starts the old stack" '[ "$(deploy --migrate)" = 1 ] && [ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = failed-manual ] && ! grep -q "^docker compose -f $OLD/docker-compose.yml up -d" "$CALLS" && ! old_running && grep -q "MANUAL ACTION" "$OUT"'
  check "after the failed probes the copy stays where it is and the backup is kept" '[ -d "$PI_DIR/zigbee2mqtt-data" ] && ls "$PI_DIR"/migration/*.tar.gz > /dev/null'
  teardown
done
setup; export SMART_PI_OLD_STACK="$OLD" STUB_OLD_PS_FAIL=1
check "forward path: an old stack whose stop cannot be verified is not copied, the run rolls back" '[ "$(deploy --migrate)" = 1 ] && ! grep -q "cp -a" "$CALLS" && grep -q "could not verify that the old stack is stopped" "$OUT" && [ "$(cut -d" " -f1 "$PI_DIR/migration/status")" = rolled-back ] && old_running'; teardown

# The poll reads the status after it checked the pid: a run that finished in between is done, not vanished.
setup; export SMART_PI_OLD_STACK="$OLD" STUB_NO_START=1 SMART_DEPLOY_STAMP=20260101T000000Z
mkdir -p "$PI_DIR/migration"
true &
dead_pid=$!
wait "$dead_pid"
echo "running 20260101T000000Z $dead_pid start-new" > "$PI_DIR/migration/status"
export STUB_CUT_FINISH="$PI_DIR/migration/status|done 20260101T000000Z $dead_pid end"
check "a run that wrote done and exited between the status read and the pid check is reported as done" '[ "$(deploy --migrate)" = 0 ] && ! grep -q "UNKNOWN" "$OUT"'; teardown

# Launch messages.
setup; export SMART_PI_OLD_STACK="$OLD" STUB_SSH_BREAK_AFTER_START=1
check "an ssh drop right after the start of migrate.sh: the Mac warns that it may have started and still follows it to done" '[ "$(deploy --migrate)" = 0 ] && grep -q "MAY have started" "$OUT" && grep -q "sudo cat .*migration/status" "$OUT"'; teardown
setup; export SMART_PI_OLD_STACK="$OLD" STUB_SSH_BREAK_START=1 SMART_DEPLOY_START_GRACE=2
check "no status after the grace time: the Mac does not claim the old stack is untouched, gives the commands and the stopped-waiting note" '[ "$(deploy --migrate)" = 1 ] && grep -q "MAY still have started" "$OUT" && grep -q "sudo cat .*migration/status" "$OUT" && grep -q "sudo tail -n 40 .*migrate-" "$OUT" && grep -q "stopped waiting" "$OUT" && ! grep -qi "was not touched" "$OUT"'; teardown

# A plain deploy must not run beside a migration or over a failed-manual one.
setup; mkdir -p "$PI_DIR/migration" "$PI_DIR/zigbee2mqtt-data"; echo x > "$PI_DIR/zigbee2mqtt-data/database.db"
echo "running 20260101T000000Z $$ copy" > "$PI_DIR/migration/status"
check "a plain deploy refuses while a migration runs, names status file, log and runbook, and changes nothing" '[ "$(deploy)" = 1 ] && grep -q "migration is running on the Pi already" "$OUT" && grep -q "migration/status" "$OUT" && grep -q "migrate-" "$OUT" && grep -q "section 11" "$OUT" && ! grep -q "^rsync" "$CALLS" && no_stack_calls'
check "deploy --fresh refuses too" '[ "$(deploy --fresh)" = 1 ] && grep -q "running on the Pi already" "$OUT" && ! grep -q "^rsync" "$CALLS"'
echo "failed-manual 20260101T000000Z 999999 rollback" > "$PI_DIR/migration/status"
check "a plain deploy refuses after failed-manual and says how to clear it" '[ "$(deploy)" = 1 ] && grep -q "failed-manual" "$OUT" && grep -q "migration/status" "$OUT" && grep -q "section 11" "$OUT" && ! grep -q "^rsync" "$CALLS"'
echo "done 20260101T000000Z 999999 end" > "$PI_DIR/migration/status"
check "a finished migration does not block a plain deploy" '[ "$(deploy)" = 0 ]'
teardown

echo "deploy tests: $passed passed, $failures failed"
[ "$failures" = 0 ]
