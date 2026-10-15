#!/usr/bin/env bash
# Installs or updates the gateway stack on the Raspberry Pi from the Mac, and (once, with --migrate) moves the Pi
# over from the old Zigbee2MQTT setup, with an automatic way back. Run it yourself in the home network.
# Usage: SMART_PI=<user@pi-host> gateway/deploy.sh [--migrate]      (pnpm gateway:deploy [--migrate])
#   SMART_PI            ssh target of the Pi (required)
#   SMART_PI_OLD_STACK  folder of the old stack on the Pi, with docker-compose.yml (services mosquitto and
#                       zigbee2mqtt) and zigbee2mqtt-data (required with --migrate)
# The operator user on the Pi needs passwordless sudo (sudo -n: no terminal is allocated) and Docker; the secrets
# come from infra/deploy/provision-gateway.sh and are never read, printed or transferred by this script.
#
# Every stage checks first and stops cleanly. Without --migrate:
#   preflight (ssh reachable within 10 s, sudo, secrets present) -> rsync gateway/ to /srv/smart-gateway (without
#   secrets/, zigbee2mqtt-data/, run/, migration/) -> render.sh -> pull -> data folder 700/600 -> start (Mosquitto is
#   recreated: the rendered file and the entry point are single-file bind mounts) -> wait until Zigbee2MQTT reports
#   bridge/state online -> status (container, bridge 1/0).
# With --migrate (the old stack must run), after the pull and before anything of the old setup is touched:
#   tarball of <old>/zigbee2mqtt-data to migration/<UTC time>.tar.gz (root, 600) -> stop the old stack (stop, not
#   down) -> COPY the data folder (never move) -> start the new stack -> wait for Z2M (120 s).
#   Any failure after the old stack was stopped: stop the new stack, set the copied data aside in migration/, start
#   the old stack again, exit 1. The old data folder is never modified.
# Settings for tests: SMART_GATEWAY_DIR (default /srv/smart-gateway), SMART_CGROUP_CONTROLLERS,
# SMART_PROC_CGROUPS, SMART_DEPLOY_WAIT_SECONDS (120), SMART_DEPLOY_POLL_SECONDS (3),
# SMART_DEPLOY_PULL_TIMEOUT (900), SMART_DEPLOY_COMPOSE_TIMEOUT (300).
# Every remote command is bounded: ssh connects within 10 s and notices a dead connection, compose, tar and cp
# run under timeout on the Pi, rsync has an I/O timeout.
set -euo pipefail

usage() {
  echo "usage: SMART_PI=<user@pi-host> [SMART_PI_OLD_STACK=<folder>] gateway/deploy.sh [--migrate]" >&2
  exit 2
}
die() {
  echo "deploy.sh: $*" >&2
  exit 1
}
step() { echo "==> $*"; }

# --- arguments and settings (nothing is contacted before they are valid) ---
migrate=0
case "${1:-}" in
  '') ;;
  --migrate) migrate=1 ;;
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
for number in "$wait_seconds" "$poll_seconds" "$pull_timeout" "$compose_timeout"; do
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
for c in docker rsync timeout tar; do
  command -v "$c" > /dev/null 2>&1 || { echo "missing:$c"; exit 0; }
done
sudo -n docker compose version > /dev/null 2>&1 || { echo "missing:docker-compose"; exit 0; }
sudo -n test -d "$1" || { echo nodir; exit 0; }
for f in gateway.env z2m.env passwd ca.crt gateway.crt gateway.key; do
  sudo -n test -s "$1/secrets/$f" || { echo "nosecret:$f"; exit 0; }
done
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
timeout -k 5 30 docker compose -f "$1/docker-compose.yml" config --services 2> /dev/null | grep -qx zigbee2mqtt || { echo notz2m; exit 0; }
[ -n "$(timeout -k 5 30 docker compose -f "$1/docker-compose.yml" ps --status running -q 2> /dev/null)" ] || { echo notrunning; exit 0; }
echo ok
EOF
)
S_RENDER=$(cat << 'EOF'
cd "$1" || exit 1
SMART_GATEWAY_DIR="$1" bash ./render.sh
EOF
)
# Z2M writes its settings (with the MQTT password and the frontend token) into configuration.yaml: the folder is
# for root only. The image runs as root, so root owns the data.
S_PERMS=$(cat << 'EOF'
set -e
d=$1/zigbee2mqtt-data
mkdir -p "$d"
chown -R root:root "$d"
chmod 700 "$d"
if [ -f "$d/configuration.yaml" ]; then chmod 600 "$d/configuration.yaml"; fi
EOF
)
S_PULL=$(cat << 'EOF'
cd "$1" || exit 1
timeout -k 10 "$2" docker compose --env-file secrets/gateway.env pull
EOF
)
S_UP=$(cat << 'EOF'
cd "$1" || exit 1
timeout -k 10 "$2" docker compose --env-file secrets/gateway.env up -d --force-recreate mosquitto || exit 1
timeout -k 10 "$2" docker compose --env-file secrets/gateway.env up -d
EOF
)
S_STOP_NEW=$(cat << 'EOF'
cd "$1" || exit 1
timeout -k 10 "$2" docker compose --env-file secrets/gateway.env stop
EOF
)
S_BACKUP=$(cat << 'EOF'
set -e
umask 077
mkdir -p "$1/migration"
chmod 700 "$1/migration"
f=$1/migration/$3.tar.gz
timeout -k 10 "$4" tar -czf "$f" -C "$2" zigbee2mqtt-data
chmod 600 "$f"
tar -tzf "$f" > /dev/null
EOF
)
S_STOP_OLD=$(cat << 'EOF'
timeout -k 10 "$2" docker compose -f "$1/docker-compose.yml" stop
EOF
)
S_COPY=$(cat << 'EOF'
set -e
mkdir -p "$1/zigbee2mqtt-data"
timeout -k 10 "$3" cp -a "$2/zigbee2mqtt-data/." "$1/zigbee2mqtt-data/"
EOF
)
S_START_OLD=$(cat << 'EOF'
timeout -k 10 "$2" docker compose -f "$1/docker-compose.yml" up -d
EOF
)
S_OLD_RUNNING=$(cat << 'EOF'
[ -n "$(timeout -k 5 30 docker compose -f "$1/docker-compose.yml" ps --status running -q 2> /dev/null)" ]
EOF
)
S_SET_ASIDE=$(cat << 'EOF'
set -e
if [ -d "$1/zigbee2mqtt-data" ]; then
  mkdir -p "$1/migration"
  chmod 700 "$1/migration"
  mv "$1/zigbee2mqtt-data" "$1/migration/failed-data-$2"
fi
EOF
)
# Z2M is up when its container runs and the retained bridge/state says online. The health user of the local
# broker (public password, may only read this topic, the uptime and the bridge state) needs no secret in argv.
S_Z2M_STATE=$(cat << 'EOF'
cd "$1" || exit 1
[ -n "$(timeout -k 5 20 docker compose --env-file secrets/gateway.env ps --status running -q zigbee2mqtt 2> /dev/null)" ] || exit 3
timeout -k 5 20 docker compose --env-file secrets/gateway.env exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u health -P health -t zigbee2mqtt/bridge/state -C 1 -W 5
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

# --- the way back ---
rollback_armed=0
data_created=0
stamp=$(date -u +%Y%m%dT%H%M%SZ)

rollback() {
  set +e
  rollback_armed=0
  echo "" >&2
  echo "deploy.sh: the migration failed - going back to the old stack" >&2
  remote root "$S_STOP_NEW" "$dir" "$compose_timeout" > /dev/null 2>&1 || echo "deploy.sh: could not stop the new stack; check: sudo docker compose --env-file secrets/gateway.env ps (in $dir)" >&2
  if [ "$data_created" = 1 ]; then
    if remote root "$S_SET_ASIDE" "$dir" "$stamp" > /dev/null 2>&1; then
      echo "deploy.sh: the copied data folder was set aside in $dir/migration/failed-data-$stamp (root only)" >&2
    else
      echo "deploy.sh: could not set the copied data aside: $dir/zigbee2mqtt-data on the Pi is the copy, the original is untouched" >&2
    fi
  fi
  remote root "$S_START_OLD" "$old" "$compose_timeout" > /dev/null 2>&1
  if remote root "$S_OLD_RUNNING" "$old" > /dev/null 2>&1; then
    echo "deploy.sh: the old stack is running again ($old); its data were never modified" >&2
    echo "deploy.sh: the backup tarball $stamp.tar.gz is in $dir/migration; fix the cause, then run --migrate again" >&2
  else
    echo "deploy.sh: OLD STACK DID NOT START AGAIN. Start it by hand on the Pi:" >&2
    echo "deploy.sh:   sudo docker compose -f $old/docker-compose.yml up -d" >&2
    echo "deploy.sh: its data folder $old/zigbee2mqtt-data was never modified" >&2
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$rollback_armed" = 1 ]; then rollback; fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

# Waits up to wait_seconds for Z2M's bridge/state online on the local broker.
wait_online() {
  local deadline=$((SECONDS + wait_seconds)) reply
  while :; do
    reply=$(remote root "$S_Z2M_STATE" "$dir" 2> /dev/null) || reply=""
    case "$reply" in
      *'"online"'* | online) return 0 ;;
    esac
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep "$poll_seconds"
  done
}

# --- 1. preflight: reachable, sudo, secrets, (migration) old stack; nothing is changed ---
step "checking the Pi ($host)"
state=$(remote user "$S_PREFLIGHT" "$dir" "$cgroup_controllers" "$proc_cgroups") \
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
    notz2m) die "$old/docker-compose.yml has no service zigbee2mqtt - check SMART_PI_OLD_STACK. Nothing was changed" ;;
    notrunning) die "the old stack ($old) is not running - start it first, so the way back is a known good state. Nothing was changed" ;;
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

# --- 4. migration: backup, stop the old stack, copy ---
if [ "$migrate" = 1 ]; then
  step "backing up $old/zigbee2mqtt-data to $dir/migration/$stamp.tar.gz"
  remote root "$S_BACKUP" "$dir" "$old" "$stamp" "$compose_timeout" || die "the backup failed - the old stack was not touched"
  rollback_armed=1
  step "stopping the old stack"
  remote root "$S_STOP_OLD" "$old" "$compose_timeout" || die "the old stack could not be stopped"
  step "copying the data folder (the old one stays as it is)"
  data_created=1
  remote root "$S_COPY" "$dir" "$old" "$compose_timeout" || die "copying the data folder failed"
fi

# --- 5. start ---
step "setting the Z2M data folder to 700 and configuration.yaml to 600"
remote root "$S_PERMS" "$dir" || die "could not set the modes of the Z2M data folder"
step "starting the stack"
remote root "$S_UP" "$dir" "$compose_timeout" || die "docker compose up failed"
step "waiting for Zigbee2MQTT to report online (up to ${wait_seconds} s)"
wait_online || die "Zigbee2MQTT did not report bridge/state online within ${wait_seconds} s (logs: sudo docker compose --env-file secrets/gateway.env logs zigbee2mqtt, in $dir)"
rollback_armed=0
# Z2M may have rewritten configuration.yaml at its start.
remote root "$S_PERMS" "$dir" || echo "warning: could not set the modes of the Z2M data folder again" >&2

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

if [ "$migrate" = 1 ]; then
  echo ""
  echo "Migration done. The old stack is stopped, not removed; its data folder is unchanged."
  echo "  backup:   $dir/migration/$stamp.tar.gz (root only)"
  echo "  way back: on the Pi, sudo docker compose --env-file secrets/gateway.env stop (in $dir), then"
  echo "            sudo docker compose -f $old/docker-compose.yml up -d"
  echo "  after you have checked everything (frontend, devices, the app): remove the old stack for good with"
  echo "            sudo docker compose -f $old/docker-compose.yml down"
  echo "  (a stopped old stack with restart: always starts again after a reboot and would fight for the adapter)."
fi
