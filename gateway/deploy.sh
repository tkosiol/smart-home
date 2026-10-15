#!/usr/bin/env bash
# Installs or updates the gateway stack on the Raspberry Pi from the Mac, and (once, with --migrate) moves the Pi
# over from the old Zigbee2MQTT setup, with an automatic way back. Run it yourself in the home network.
# Usage: SMART_PI=<user@pi-host> gateway/deploy.sh [--migrate | --fresh]      (pnpm gateway:deploy [--migrate | --fresh])
#   SMART_PI            ssh target of the Pi (required)
#   SMART_PI_OLD_STACK  folder of the old stack on the Pi, with docker-compose.yml (services mosquitto and
#                       zigbee2mqtt) and zigbee2mqtt-data (required with --migrate)
#   --fresh             a NEW Pi with a fresh adapter: allows the first start without Zigbee2MQTT data. Without it a
#                       plain deploy refuses to start when zigbee2mqtt-data is missing or empty (on an existing Pi
#                       the first run must be --migrate, otherwise Z2M would start with an empty Zigbee network).
# The operator user on the Pi needs passwordless sudo (sudo -n: no terminal is allocated) and Docker; the secrets
# come from infra/deploy/provision-gateway.sh and are never read, printed or transferred by this script.
#
# Every stage checks first and stops cleanly. Plain deploy:
#   preflight (ssh reachable within 10 s, sudo, secrets present, Z2M data present) -> rsync gateway/ to
#   /srv/smart-gateway (without secrets/, zigbee2mqtt-data/, run/, migration/) -> render.sh -> pull -> data folder
#   700/600 -> start.sh on the Pi (Mosquitto is recreated: the rendered file and the entry point are single-file bind
#   mounts; waits until Zigbee2MQTT is online, stable and Mosquitto healthy) -> backup timers -> status.
# With --migrate (the old stack must run), after the pull, the destructive part runs ON THE PI as gateway/migrate.sh,
#   detached (systemd-run, else setsid/nohup) so it survives this ssh session and this terminal: backup tarball
#   migration/<UTC time>.tar.gz (verified) -> stop the old stack -> COPY the data folder (never move) -> start the new
#   stack -> wait for Z2M. Any failure rolls back on the Pi: stop the new stack and verify it is stopped, set the copy
#   aside, start the old stack, verify it runs; if the new stack cannot be stopped the old one is NOT started and the
#   state is failed-manual. The Mac side only starts it and polls migration/status (bounded, tolerant of ssh drops);
#   Ctrl+C or a closed terminal here only stops the polling, the Pi finishes (or rolls back) on its own.
# Settings for tests: SMART_GATEWAY_DIR (default /srv/smart-gateway), SMART_CGROUP_CONTROLLERS,
# SMART_PROC_CGROUPS, SMART_DEPLOY_WAIT_SECONDS (120), SMART_DEPLOY_POLL_SECONDS (3),
# SMART_DEPLOY_PULL_TIMEOUT (900), SMART_DEPLOY_COMPOSE_TIMEOUT (300), SMART_DEPLOY_MIGRATE_TIMEOUT (1800: how
# long the Mac polls), SMART_DEPLOY_START_GRACE (90: how long the status of the started run may be missing),
# SMART_DEPLOY_DETACH (auto|nohup: nohup skips systemd-run), SMART_DEPLOY_STAMP,
# SMART_SYSTEMD_DIR (default /etc/systemd/system).
# At the end (Z2M online) it installs and enables the backup timers (gateway/systemd, nightly backup and weekly
# restore test, see gateway/backup); the pull includes the restic image of the compose profile backup.
# Every remote command is bounded: ssh connects within 10 s and notices a dead connection, compose, tar, cp, chown
# and render.sh run under timeout on the Pi, rsync has an I/O timeout.
set -euo pipefail

usage() {
  echo "usage: SMART_PI=<user@pi-host> [SMART_PI_OLD_STACK=<folder>] gateway/deploy.sh [--migrate | --fresh]" >&2
  exit 2
}
die() {
  echo "deploy.sh: $*" >&2
  exit 1
}
step() { echo "==> $*"; }

# --- arguments and settings (nothing is contacted before they are valid) ---
migrate=0
fresh=0
case "${1:-}" in
  '') ;;
  --migrate) migrate=1 ;;
  --fresh) fresh=1 ;;
  *) usage ;;
esac
[ "$#" -le 1 ] || usage

host="${SMART_PI:-}"
[ -n "$host" ] || { echo "set SMART_PI=<user@pi-host> (see .local/pi.md)" >&2; usage; }
[[ "$host" =~ ^[A-Za-z0-9_][A-Za-z0-9._@-]*$ ]] || { echo "SMART_PI must be user@host or an ssh alias (no blanks, no leading hyphen)" >&2; exit 2; }

plain_path() { [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ ]] && [[ "$1" != *..* ]] && [[ "$1" != *//* ]]; }
dir="${SMART_GATEWAY_DIR:-/srv/smart-gateway}"
dir="${dir%/}"
plain_path "$dir" || { echo "SMART_GATEWAY_DIR is not a plain absolute path" >&2; exit 2; }
old=""
if [ "$migrate" = 1 ]; then
  old="${SMART_PI_OLD_STACK:-}"
  old="${old%/}"
  [ -n "$old" ] || { echo "--migrate needs SMART_PI_OLD_STACK=<folder of the old stack on the Pi>" >&2; usage; }
  plain_path "$old" || { echo "SMART_PI_OLD_STACK is not a plain absolute path" >&2; exit 2; }
fi
cgroup_controllers="${SMART_CGROUP_CONTROLLERS:-/sys/fs/cgroup/cgroup.controllers}"
proc_cgroups="${SMART_PROC_CGROUPS:-/proc/cgroups}"
{ plain_path "$cgroup_controllers" && plain_path "$proc_cgroups"; } || { echo "SMART_CGROUP_CONTROLLERS / SMART_PROC_CGROUPS are not plain absolute paths" >&2; exit 2; }
wait_seconds="${SMART_DEPLOY_WAIT_SECONDS:-120}"
poll_seconds="${SMART_DEPLOY_POLL_SECONDS:-3}"
pull_timeout="${SMART_DEPLOY_PULL_TIMEOUT:-900}"
compose_timeout="${SMART_DEPLOY_COMPOSE_TIMEOUT:-300}"
migrate_limit="${SMART_DEPLOY_MIGRATE_TIMEOUT:-1800}"
start_grace="${SMART_DEPLOY_START_GRACE:-90}"
detach="${SMART_DEPLOY_DETACH:-auto}"
[[ "$detach" =~ ^(auto|nohup)$ ]] || { echo "SMART_DEPLOY_DETACH must be auto or nohup" >&2; exit 2; }
stamp="${SMART_DEPLOY_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "SMART_DEPLOY_STAMP must look like 20260101T000000Z" >&2; exit 2; }
systemd_dir="${SMART_SYSTEMD_DIR:-/etc/systemd/system}"
systemd_dir="${systemd_dir%/}"
plain_path "$systemd_dir" || { echo "SMART_SYSTEMD_DIR is not a plain absolute path" >&2; exit 2; }
for number in "$wait_seconds" "$poll_seconds" "$pull_timeout" "$compose_timeout" "$migrate_limit" "$start_grace"; do
  [[ "$number" =~ ^[0-9]{1,5}$ ]] || { echo "the SMART_DEPLOY_* time limits must be whole seconds" >&2; exit 2; }
done

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ssh_opts=(-o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
# The local copy of the bridge notification (1 = connected, 0 = not): with notification_topic set, Mosquitto
# publishes it on the local broker too and not under $SYS. The health user may read it.
bridge_topic='gw/+/bridge/connection'

# --- remote scripts: no single quote inside (they travel inside single quotes), arguments as $1, $2, ... ---
S_PREFLIGHT=$(cat << 'EOF'
sudo -n true > /dev/null 2>&1 || { echo nosudo; exit 0; }
for c in docker rsync timeout tar systemctl; do
  command -v "$c" > /dev/null 2>&1 || { echo "missing:$c"; exit 0; }
done
sudo -n docker compose version > /dev/null 2>&1 || { echo "missing:docker-compose"; exit 0; }
sudo -n test -d "$1" || { echo nodir; exit 0; }
for f in gateway.env z2m.env backup.env passwd ca.crt gateway.crt gateway.key; do
  sudo -n test -s "$1/secrets/$f" || { echo "nosecret:$f"; exit 0; }
done
if sudo -n test -s "$1/migration/status"; then
  line=$(sudo -n cat "$1/migration/status" 2> /dev/null)
  mst=${line%% *}
  rest=${line#* }
  rest=${rest#* }
  mpid=${rest%% *}
  if [ "$mst" = running ] && sudo -n sh -c "kill -0 \"\$1\"" sh "$mpid" 2> /dev/null; then echo migrating; exit 0; fi
  if [ "$mst" = failed-manual ]; then echo needsmanual; exit 0; fi
fi
if [ "$4" = plain ] && [ -z "$(sudo -n ls -A "$1/zigbee2mqtt-data" 2> /dev/null)" ]; then echo nodata; exit 0; fi
cg=unknown
if [ -r "$2" ]; then
  if grep -qw memory "$2"; then cg=ok; else cg=nomem; fi
elif [ -r "$3" ]; then
  if grep -Eq "^memory[[:space:]]+[0-9]+[[:space:]]+[0-9]+[[:space:]]+1$" "$3"; then cg=ok; else cg=nomem; fi
fi
echo "ok:$cg"
EOF
)
S_OLD_CHECK=$(cat << 'EOF'
test -f "$1/docker-compose.yml" || { echo nocompose; exit 0; }
test -d "$1/zigbee2mqtt-data" || { echo nodata; exit 0; }
if [ -n "$(ls -A "$2/zigbee2mqtt-data" 2> /dev/null)" ]; then echo newdata; exit 0; fi
if [ -s "$2/migration/status" ]; then
  read -r st sp pid step < "$2/migration/status"
  if [ "$st" = running ] && kill -0 "$pid" 2> /dev/null; then echo migrating; exit 0; fi
  if [ "$st" = failed-manual ]; then echo needsmanual; exit 0; fi
fi
timeout -k 5 30 docker compose -f "$1/docker-compose.yml" config --services 2> /dev/null | grep -qx zigbee2mqtt || { echo notz2m; exit 0; }
timeout -k 5 30 docker compose -f "$1/docker-compose.yml" ps --status running --services 2> /dev/null | grep -qx zigbee2mqtt || { echo notrunning; exit 0; }
echo ok
EOF
)
S_RENDER=$(cat << 'EOF'
cd "$1" || exit 1
SMART_GATEWAY_DIR="$1" timeout -k 10 120 bash ./render.sh
EOF
)
# Z2M writes its settings (with the MQTT password and the frontend token) into configuration.yaml: the folder is
# for root only. The image runs as root, so root owns the data.
S_PERMS=$(cat << 'EOF'
set -e
d=$1/zigbee2mqtt-data
mkdir -p "$d"
timeout -k 5 "$2" chown -R root:root "$d"
chmod 700 "$d"
if [ -f "$d/configuration.yaml" ]; then chmod 600 "$d/configuration.yaml"; fi
EOF
)
S_PULL=$(cat << 'EOF'
cd "$1" || exit 1
COMPOSE_PROFILES=backup timeout -k 10 "$2" docker compose --env-file secrets/gateway.env pull
EOF
)
# start.sh (gateway folder on the Pi): up, then wait until Z2M is online and stable and Mosquitto healthy.
S_START=$(cat << 'EOF'
cd "$1" || exit 1
timeout -k 10 "$5" bash ./start.sh "$1" "$2" "$3" "$4"
EOF
)
# The units name /srv/smart-gateway: written with the real folder, replaced atomically (new file, then mv).
S_TIMERS=$(cat << 'EOF'
set -e
for u in smart-gateway-backup.service smart-gateway-backup.timer smart-gateway-restore-test.service smart-gateway-restore-test.timer; do
  sed "s|/srv/smart-gateway|$1|g" "$1/systemd/$u" > "$2/$u.new"
  chmod 644 "$2/$u.new"
  mv -f "$2/$u.new" "$2/$u"
done
systemctl daemon-reload
systemctl enable --now smart-gateway-backup.timer smart-gateway-restore-test.timer
# A timer that runs already takes a changed schedule only after a restart.
systemctl restart smart-gateway-backup.timer smart-gateway-restore-test.timer
EOF
)
# Starts migrate.sh detached from the ssh session: systemd-run (own unit, survives the session, TimeoutStopSec
# leaves time for the rollback), else setsid/nohup. Arguments: dir old stamp compose-timeout wait poll mode.
S_MIG_START=$(cat << 'EOF'
cd "$1" || exit 1
test -f ./migrate.sh || exit 4
mkdir -p migration
chmod 700 migration
if [ "$7" != nohup ] && command -v systemd-run > /dev/null 2>&1; then
  systemd-run --quiet --unit=smart-gateway-migrate --collect --property=TimeoutStopSec=900 --property=KillMode=process \
    bash "$1/migrate.sh" "$1" "$2" "$3" "$4" "$5" "$6" || exit 5
elif command -v setsid > /dev/null 2>&1; then
  setsid nohup bash "$1/migrate.sh" "$1" "$2" "$3" "$4" "$5" "$6" > /dev/null 2>&1 < /dev/null &
else
  nohup bash "$1/migrate.sh" "$1" "$2" "$3" "$4" "$5" "$6" > /dev/null 2>&1 < /dev/null &
fi
EOF
)
# The status line of migrate.sh ("<state> <stamp> <pid> <step>") and whether that process lived at the check.
S_MIG_STATUS=$(cat << 'EOF'
f=$1/migration/status
if [ -s "$f" ]; then
  pid=$(cut -d" " -f3 "$f")
  if kill -0 "$pid" 2> /dev/null; then alive=alive; else alive=dead; fi
  # Read AFTER the pid check: a run that finished in between has written its final state before it exited.
  cat "$f"
  echo "$alive"
else
  echo none
fi
EOF
)
S_MIG_LOG=$(cat << 'EOF'
tail -n 40 "$1/migration/migrate-$2.log" 2> /dev/null
EOF
)
S_STATUS=$(cat << 'EOF'
cd "$1" || exit 1
timeout -k 5 30 docker compose --env-file secrets/gateway.env ps
EOF
)
S_BRIDGE=$(cat << 'EOF'
cd "$1" || exit 1
timeout -k 5 20 docker compose --env-file secrets/gateway.env exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u health -P health -t "$2" -C 1 -W 5
EOF
)

# remote <user|root> <script> [argument...]: one bounded ssh call; the arguments are validated values.
remote() {
  local who=$1 script=$2 argument command
  shift 2
  [[ "$script" != *\'* ]] || die "internal error: a remote script contains a single quote"
  command="sh -c '$script' sh"
  for argument in "$@"; do command+=" '$argument'"; done
  if [ "$who" = root ]; then command="sudo -n $command"; fi
  ssh -n "${ssh_opts[@]}" "$host" "$command"
}

# --- interruption on the Mac: only the polling stops; the Pi finishes or rolls back on its own ---
migration_started=0
migration_over=0
# shellcheck disable=SC2329 # runs through the trap
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$migration_started" = 1 ] && [ "$migration_over" = 0 ]; then
    echo "" >&2
    echo "deploy.sh: stopped waiting; the migration on the Pi is NOT affected, it finishes or rolls back on its own." >&2
    echo "deploy.sh: look at it on the Pi: sudo cat $dir/migration/status ; sudo tail -n 40 $dir/migration/migrate-$stamp.log" >&2
  fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Prints the end of the migration log of this run (it holds commands and outcomes only, never a secret).
show_migration_log() {
  echo "---- migration log on the Pi ($dir/migration/migrate-$stamp.log) ----"
  remote root "$S_MIG_LOG" "$dir" "$stamp" 2> /dev/null | sed 's/^/  | /' || echo "  | (could not read the log over ssh)"
  echo "---- end of the log ----"
}

# Polls migration/status until the Pi side is over. Tolerates ssh failures (the Pi keeps working); bounded by
# migrate_limit. Sets migration_result to done, rolled-back, failed-manual, vanished, notstarted or timeout.
migration_result=""
poll_migration() {
  local deadline=$((SECONDS + migrate_limit)) grace=$((SECONDS + start_grace)) reply first alive state reply_stamp step last="" fails=0
  while :; do
    if reply=$(remote root "$S_MIG_STATUS" "$dir" 2> /dev/null); then
      fails=0
      first=$(printf '%s\n' "$reply" | sed -n 1p)
      alive=$(printf '%s\n' "$reply" | sed -n 2p)
      read -r state reply_stamp _ step <<< "$first"
      if [ "$reply_stamp" = "$stamp" ]; then
        if [ "$step" != "$last" ]; then echo "    Pi: $state ${step:-}"; last=$step; fi
        case "$state" in
          done | rolled-back | failed-manual) migration_result=$state; return 0 ;;
          running)
            if [ "$alive" != alive ]; then migration_result=vanished; return 0; fi ;;
        esac
      elif [ "$SECONDS" -ge "$grace" ]; then
        migration_result=notstarted
        return 0
      fi
    else
      fails=$((fails + 1))
      if [ "$fails" = 1 ]; then echo "    ssh to the Pi does not answer; the Pi keeps working on its own, retrying"; fi
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then migration_result=timeout; return 0; fi
    sleep "$poll_seconds" &
    wait $! || true
  done
}

# --- 1. preflight: reachable, sudo, secrets, Z2M data, (migration) old stack; nothing is changed ---
step "checking the Pi ($host)"
mode=plain
if [ "$migrate" = 1 ]; then mode=migrate; fi
if [ "$fresh" = 1 ]; then mode=fresh; fi
state=$(remote user "$S_PREFLIGHT" "$dir" "$cgroup_controllers" "$proc_cgroups" "$mode") \
  || die "the Pi ($host) is not reachable over ssh (10 s limit) - nothing was changed"
case "$state" in
  ok:ok) ;;
  ok:nomem)
    echo "warning: the Pi kernel has no memory cgroup, so mem_limit in compose.yaml is ignored (the containers run without a memory limit)."
    echo "warning: enable it with cgroup_enable=memory cgroup_memory=1 in the kernel command line (cmdline.txt on the Pi) and reboot." ;;
  ok:unknown) echo "note: could not tell whether the Pi kernel has a memory cgroup (mem_limit needs it)." ;;
  nosudo) die "sudo on the Pi asks for a password or is not allowed for this user - there is no terminal for a prompt. Allow passwordless sudo for the operator user (docs/runbooks/gateway.md). Nothing was changed" ;;
  missing:*) die "${state#missing:} is not installed on the Pi - nothing was changed" ;;
  nodir) die "$dir does not exist on the Pi - run infra/deploy/provision-gateway.sh first. Nothing was changed" ;;
  nosecret:*) die "$dir/secrets/${state#nosecret:} is missing or empty on the Pi - run infra/deploy/provision-gateway.sh first. Nothing was changed" ;;
  migrating) die "a migration is running on the Pi already - do not deploy now. Status: sudo cat $dir/migration/status, log: sudo tail -n 40 $dir/migration/migrate-*.log (docs/runbooks/gateway.md, section 11). Nothing was changed" ;;
  needsmanual) die "the last migration on the Pi ended in failed-manual and needs manual action first. Status: sudo cat $dir/migration/status, log: sudo tail -n 40 $dir/migration/migrate-*.log (docs/runbooks/gateway.md, section 11). After fixing it remove the status file: sudo rm $dir/migration/status. Nothing was changed" ;;
  nodata) die "$dir/zigbee2mqtt-data is missing or empty on the Pi. On an existing Pi the first run must be --migrate (it takes over the Zigbee network of the old setup; a plain deploy would start Zigbee2MQTT with an empty network and the paired devices would be lost). Only a NEW Pi with a fresh adapter uses --fresh. Nothing was changed" ;;
  *) die "unexpected answer from the Pi - nothing was changed" ;;
esac

if [ "$migrate" = 1 ]; then
  step "checking the old stack ($old)"
  state=$(remote root "$S_OLD_CHECK" "$old" "$dir") || die "could not check the old stack on the Pi - nothing was changed"
  case "$state" in
    ok) ;;
    nocompose) die "$old/docker-compose.yml does not exist on the Pi - check SMART_PI_OLD_STACK. Nothing was changed" ;;
    nodata) die "$old/zigbee2mqtt-data does not exist on the Pi - check SMART_PI_OLD_STACK. Nothing was changed" ;;
    newdata) die "$dir/zigbee2mqtt-data already has content - a migration would merge into it. Is the Pi migrated already (deploy without --migrate)? Nothing was changed" ;;
    migrating) die "a migration is running on the Pi already (sudo cat $dir/migration/status, log $dir/migration/migrate-*.log). Nothing was changed" ;;
    needsmanual) die "the last migration ended in failed-manual (sudo cat $dir/migration/status, log $dir/migration/migrate-*.log on the Pi; docs/runbooks/gateway.md, section 11). Fix it by hand, then remove $dir/migration/status. Nothing was changed" ;;
    notz2m) die "$old/docker-compose.yml has no service zigbee2mqtt - check SMART_PI_OLD_STACK. Nothing was changed" ;;
    notrunning) die "the zigbee2mqtt service of the old stack ($old) is not running - start the whole old stack first, so the way back is a known good state. Nothing was changed" ;;
    *) die "unexpected answer from the Pi - nothing was changed" ;;
  esac
fi

# --- 2. copy the package: never the secrets, the Z2M data, the rendered file or the backups ---
step "copying gateway/ to $dir"
rsync -rlt --no-owner --no-group --chmod=go-w,go+rX --timeout=60 \
  --exclude=/secrets/ --exclude=/zigbee2mqtt-data/ --exclude=/run/ --exclude=/migration/ --exclude=/test/ \
  --rsh="ssh ${ssh_opts[*]}" --rsync-path="sudo -n rsync" \
  "$source_dir/" "$host:$dir/" || die "rsync to the Pi failed - the running stack was not touched"

# --- 3. render, pull ---
step "rendering the Mosquitto configuration"
remote root "$S_RENDER" "$dir" || die "render.sh failed on the Pi - the running stack was not touched"
step "pulling the images"
remote root "$S_PULL" "$dir" "$pull_timeout" || die "docker compose pull failed (or took more than ${pull_timeout} s) - the running stack was not touched"

if [ "$migrate" = 1 ]; then
  # --- 4. migration: the destructive part runs on the Pi, detached ---
  step "starting the migration on the Pi (detached: it survives this terminal and the ssh session)"
  migration_started=1
  launch_rc=0
  remote root "$S_MIG_START" "$dir" "$old" "$stamp" "$compose_timeout" "$wait_seconds" "$poll_seconds" "$detach" || launch_rc=$?
  case "$launch_rc" in
    0) ;;
    4 | 5) migration_started=0; die "migrate.sh could not be started on the Pi (exit $launch_rc: no migrate.sh, or systemd-run failed) - the old stack was not touched" ;;
    *)
      echo "warning: the ssh call that starts migrate.sh failed (exit $launch_rc). The migration MAY have started on the Pi; waiting for its status."
      echo "warning: to look yourself: sudo cat $dir/migration/status ; sudo tail -n 40 $dir/migration/migrate-$stamp.log" ;;
  esac
  step "waiting for the Pi (up to $((migrate_limit)) s; Ctrl+C only stops the waiting)"
  poll_migration
  migration_over=1
  show_migration_log
  case "$migration_result" in
    done) ;;
    rolled-back) die "the migration failed and was rolled back: the old stack runs again (details in the log above). Nothing of the old setup was changed" ;;
    failed-manual) die "the migration failed and needs MANUAL ACTION on the Pi (the commands are in the log above; the old stack was not started on purpose if the new one could not be stopped)" ;;
    vanished) die "migrate.sh on the Pi ended without a final state (killed after TimeoutStopSec, or the Pi lost power?). The state of the stacks is UNKNOWN: on the Pi check sudo docker ps -a, sudo cat $dir/migration/status, the log $dir/migration/migrate-$stamp.log and sudo journalctl -u smart-gateway-migrate (docs/runbooks/gateway.md, section 11)" ;;
    notstarted)
      migration_over=0
      die "no status of this run appeared on the Pi within ${start_grace} s. The migration MAY still have started (or may start late), so the old stack may be touched. Check on the Pi: sudo cat $dir/migration/status ; sudo tail -n 40 $dir/migration/migrate-$stamp.log ; sudo systemctl status smart-gateway-migrate ; sudo docker ps -a" ;;
    *) migration_over=0; die "gave up waiting after ${migrate_limit} s; the migration on the Pi is NOT stopped and finishes or rolls back on its own (sudo cat $dir/migration/status)" ;;
  esac
else
  # --- 4. plain deploy: modes, start, wait ---
  step "setting the Z2M data folder to 700 and configuration.yaml to 600"
  remote root "$S_PERMS" "$dir" "$compose_timeout" || die "could not set the modes of the Z2M data folder"
  step "starting the stack and waiting for Zigbee2MQTT (online and stable, up to ${wait_seconds} s)"
  rc=0
  remote root "$S_START" "$dir" "$compose_timeout" "$wait_seconds" "$poll_seconds" "$((2 * compose_timeout + wait_seconds + 60))" || rc=$?
  case "$rc" in
    0) ;;
    1) die "docker compose up failed" ;;
    *) die "Zigbee2MQTT did not report bridge/state online and stable within ${wait_seconds} s, or Mosquitto is not healthy (logs: sudo docker compose --env-file secrets/gateway.env logs zigbee2mqtt, in $dir)" ;;
  esac
  # Z2M may have rewritten configuration.yaml at its start.
  remote root "$S_PERMS" "$dir" "$compose_timeout" || echo "warning: could not set the modes of the Z2M data folder again" >&2
fi

# --- 5. backup timers ---
step "installing the backup timers (nightly backup 03:30, weekly restore test)"
remote root "$S_TIMERS" "$dir" "$systemd_dir" || die "could not install the backup timers (the stack is running; check $dir/systemd and $systemd_dir on the Pi)"

# --- 6. status ---
step "status"
remote root "$S_STATUS" "$dir" || echo "warning: could not read the container status" >&2
bridge=$(remote root "$S_BRIDGE" "$dir" "$bridge_topic" 2> /dev/null) || bridge=""
case "$bridge" in
  1) echo "Bridge to the platform broker: connected (1)" ;;
  0) echo "warning: Bridge to the platform broker: not connected (0) - check BROKER_HOST, the certificate and the clock of the Pi (docs/runbooks/gateway.md)" ;;
  *) echo "warning: Bridge state unknown (no answer from the local broker)" ;;
esac
echo "Zigbee2MQTT: online"
echo ""
echo "Backup: run the first backup once by hand and check the ping on healthchecks.io (the nightly timer comes at 03:30):"
echo "  sudo bash $dir/backup/backup.sh     (log: sudo journalctl -u smart-gateway-backup, or the output of the command)"
echo "  then in healthchecks.io the check of the Pi backup must show a fresh success ping."

if [ "$migrate" = 1 ]; then
  echo ""
  echo "Migration done. The old stack is stopped, not removed; its data folder is unchanged."
  echo "  backup:   $dir/migration/$stamp.tar.gz (root only; taken from the running old Z2M, the copy after the stop is the consistent one)"
  echo "  way back: on the Pi, sudo docker compose --env-file secrets/gateway.env stop (in $dir), then"
  echo "            sudo docker compose -f $old/docker-compose.yml up -d"
  echo "            (devices paired since the migration are NOT in the old data folder and are lost on the way back)"
  echo "  after you have checked everything (frontend, devices, the app): remove the old stack for good with"
  echo "            sudo docker compose -f $old/docker-compose.yml down"
  echo "  (a stopped old stack with restart: always starts again after a reboot and would fight for the adapter)."
fi
