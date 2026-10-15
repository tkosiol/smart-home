#!/usr/bin/env bash
# The destructive part of "gateway:deploy --migrate", run ON THE PI as root and detached from the ssh session
# (deploy.sh starts it with systemd-run, or setsid/nohup), so a dropped connection or a Ctrl+C on the Mac cannot leave
# the Pi half-way. Usage: migrate.sh <gateway-dir> <old-stack-dir> <stamp> <compose-timeout> <wait> <poll>
#   stamp: UTC time of the run (YYYYMMDDTHHMMSSZ); names the backup (migration/<stamp>.tar.gz) and the log.
# Steps: check, backup (verified) -> stop the old stack (verified) -> save the restart policy of the old containers
# (migration/old-restart-<stamp>) and set them to "no", so a reboot or a dockerd restart cannot bring the old Z2M back
# beside the new one -> COPY the data folder (into zigbee2mqtt-data.partial, then mv into place: a kill or power loss
# leaves a .partial that no deploy accepts) -> modes -> the foreign-Z2M check of the plain deploy -> start.sh (start
# the new stack, wait for Z2M online and Mosquitto healthy). Any failure after the old stack is touched, and every
# signal (HUP INT TERM), rolls back: stop the new stack and VERIFY it is stopped (retry, then docker stop/rm by
# name); only then set the copy aside, restore the saved restart policies and start the old stack again, and verify
# it runs. If the new stack cannot be stopped, the old one is NOT started (the adapter and the broker certificate
# allow only one) and the state is failed-manual, with the exact commands in the log; the same if the saved policies
# could not be put back. The old data folder is never modified.
# State: <gateway-dir>/migration/status, one line "<state> <stamp> <pid> <step>", state is one of
#   running | done | rolled-back | failed-manual
# (rolled-back also means "failed before anything was changed"); log: <gateway-dir>/migration/migrate-<stamp>.log.
# The log holds commands and outcomes only, never a secret.
set -u
umask 077
export LC_ALL=C

DIR=${1:?gateway dir}
OLD=${2:?old stack dir}
STAMP=${3:?stamp}
CT=${4:?compose timeout}
WAIT=${5:?wait seconds}
POLL=${6:?poll seconds}

plain_path() { [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ ]] && [[ "$1" != *..* ]] && [[ "$1" != *//* ]]; }
{ plain_path "$DIR" && plain_path "$OLD"; } || { echo "migrate.sh: the folders must be plain absolute paths" >&2; exit 2; }
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "migrate.sh: bad stamp" >&2; exit 2; }
for number in "$CT" "$WAIT" "$POLL"; do
  [[ "$number" =~ ^[0-9]{1,5}$ ]] || { echo "migrate.sh: the time limits must be whole seconds" >&2; exit 2; }
done

MIG="$DIR/migration"
STATUS="$MIG/status"
LOG="$MIG/migrate-$STAMP.log"
PROJECT=smart-gateway
mkdir -p "$MIG" && chmod 700 "$MIG" || exit 2

# One run at a time (the fixed systemd unit name guards it too).
if [ -s "$STATUS" ]; then
  read -r previous_state _ previous_pid _ < "$STATUS"
  if [ "$previous_state" = running ] && [ "$previous_pid" != "$$" ] && kill -0 "$previous_pid" 2> /dev/null; then
    echo "migrate.sh: another migration is running (pid $previous_pid)" >&2
    exit 3
  fi
fi
exec >> "$LOG" 2>&1 < /dev/null

log() { printf '%s migrate: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
set_state() {
  printf '%s %s %s %s\n' "$1" "$STAMP" "$$" "${2:-}" > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"
}

finished=0
armed=0
data_created=0
POLICY_FILE="$MIG/old-restart-$STAMP"
PARTIAL="$DIR/zigbee2mqtt-data.partial"
policies_saved=0
restore_failed=0
copy_in_place=0

# --- compose helpers (the folder is the project directory; the old stack has its own compose file) ---
cd "$DIR" || exit 2
new_compose() { timeout -k 10 "$CT" docker compose --env-file secrets/gateway.env "$@"; }
old_compose() { timeout -k 10 "$CT" docker compose -f "$OLD/docker-compose.yml" "$@"; }
# A probe may only be trusted when it succeeded: a timeout, an error or a wedged Docker daemon gives empty output,
# which must never be read as "nothing runs" (the rollback would start the old stack while Z2M still holds the
# adapter). probe_out is the output; the return status is the command's.
probe_out=""
probe() { probe_out=$("$@" 2> /dev/null); }
# Is anything of the new project running? Asked twice, independently: compose and the project label.
# Returns 0 running, 1 verified stopped, 2 unknown (a probe failed).
new_state() {
  probe timeout -k 5 30 docker compose --env-file secrets/gateway.env ps --status running -q || return 2
  [ -z "$probe_out" ] || return 0
  probe timeout -k 5 30 docker ps -q --filter "label=com.docker.compose.project=$PROJECT" || return 2
  [ -z "$probe_out" ] || return 0
  return 1
}
old_z2m_running() {
  timeout -k 5 30 docker compose -f "$OLD/docker-compose.yml" ps --status running --services 2> /dev/null | grep -qx zigbee2mqtt
}
# Returns 0 running, 1 verified stopped, 2 unknown.
old_state() {
  probe timeout -k 5 30 docker compose -f "$OLD/docker-compose.yml" ps --status running -q || return 2
  [ -z "$probe_out" ] || return 0
  return 1
}

# The check of the plain deploy before it starts anything: a running container with zigbee2mqtt as service or in its
# image that is not part of the project smart-gateway (the old stack that came back by itself, one started by hand).
# A listing that fails refuses too: an empty answer proves nothing. Prints the names; returns 0 clean, 1 found, 2 unknown.
foreign_z2m() {
  local list foreign
  list=$(timeout -k 5 30 docker ps --format '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.Image}}|{{.Names}}' 2> /dev/null) || return 2
  foreign=$(printf '%s\n' "$list" | grep -v '^smart-gateway|' | grep -E '^[^|]*[|][^|]*zigbee2mqtt|^[^|]*[|][^|]*[|][^|]*zigbee2mqtt' | cut -d'|' -f4 | tr '\n' ' ')
  if [ -n "$foreign" ]; then printf '%s' "$foreign"; return 1; fi
  return 0
}

# Saves the restart policy of every container of the old stack and sets them to "no". The stack is stopped, but a
# stopped container with restart: always starts again after a reboot or a dockerd restart and would hold the adapter
# beside the new Zigbee2MQTT. All policies are read first (one that cannot be read fails: nothing is changed), the file
# is written (root only, atomically), then each container is updated. Returns 1 on any failure (the caller rolls back).
disable_old_restart() {
  local id policy lines="" count=0
  probe timeout -k 5 30 docker compose -f "$OLD/docker-compose.yml" ps -aq || { log "could not list the containers of the old stack"; return 1; }
  for id in $probe_out; do
    [[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { log "unexpected container id from the old stack"; return 1; }
    probe timeout -k 5 30 docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$id" || { log "could not read the restart policy of $id"; return 1; }
    policy=$probe_out
    case "$policy" in
      no | always | unless-stopped | on-failure) ;;
      *) log "unknown restart policy of $id"; return 1 ;;
    esac
    lines="$lines$id $policy
"
    count=$((count + 1))
  done
  [ "$count" -gt 0 ] || { log "the old stack has no containers to take the restart policy from"; return 1; }
  if ! { printf '%s' "$lines" > "$POLICY_FILE.tmp" && chmod 600 "$POLICY_FILE.tmp" && mv -f "$POLICY_FILE.tmp" "$POLICY_FILE"; }; then
    log "could not save the restart policies to $POLICY_FILE"
    return 1
  fi
  policies_saved=1
  log "saved the restart policy of $count old containers to $POLICY_FILE (root only)"
  while read -r id policy; do
    log "docker update --restart=no $id (was $policy)"
    timeout -k 5 60 docker update --restart=no "$id" > /dev/null || { log "could not set the restart policy of $id to no"; return 1; }
  done < "$POLICY_FILE"
  return 0
}

# Puts the saved restart policies back (the way back to the old stack). Tries every container; returns 1 if any failed.
restore_old_restart() {
  local id policy bad=0
  [ "$policies_saved" = 1 ] || return 0
  while read -r id policy; do
    log "docker update --restart=$policy $id (restoring the saved policy)"
    timeout -k 5 60 docker update --restart="$policy" "$id" > /dev/null || { log "could not restore the restart policy of $id"; bad=1; }
  done < "$POLICY_FILE"
  return "$bad"
}

end_with() {
  finished=1
  trap - EXIT
  set_state "$1" "$2"
  log "$1: $2"
  [ "$1" = "done" ] && exit 0
  exit 1
}

# Stops the new stack and proves it: compose stop (three tries), then docker stop and rm by container name.
# Only a probe that succeeded and found nothing counts as stopped; an unknown answer counts as still running.
stop_new_verified() {
  local try name state
  for try in 1 2 3; do
    log "stopping the new stack (try $try)"
    new_compose stop || log "compose stop failed"
    new_state
    state=$?
    if [ "$state" = 1 ]; then return 0; fi
    if [ "$state" = 2 ]; then log "could not tell whether the new stack stopped (a probe failed)"; fi
    sleep "$POLL"
  done
  if probe timeout -k 5 30 docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}'; then
    for name in $probe_out; do
      log "docker stop and rm of $name"
      timeout -k 10 120 docker stop "$name" || log "docker stop $name failed"
      timeout -k 10 120 docker rm -f "$name" || log "docker rm $name failed"
    done
  else
    log "could not list the containers of the new stack"
  fi
  sleep "$POLL"
  new_state
  [ $? = 1 ]
}

manual_help() {
  log "MANUAL ACTION NEEDED. $1"
  log "  1. check what runs:      sudo docker ps -a --filter label=com.docker.compose.project=$PROJECT"
  log "  2. stop the new stack:   cd $DIR && sudo docker compose --env-file secrets/gateway.env stop"
  if [ "$policies_saved" = 1 ]; then
    log "  3. restore the restart policy of the old containers (saved in $POLICY_FILE, lines '<container> <policy>'):"
    log "       sudo cat $POLICY_FILE | while read -r c p; do sudo docker update --restart=\"\$p\" \"\$c\"; done"
    log "  4. start the old stack:  sudo docker compose -f $OLD/docker-compose.yml up -d"
  else
    log "  3. start the old stack:  sudo docker compose -f $OLD/docker-compose.yml up -d"
  fi
  log "  The old data folder $OLD/zigbee2mqtt-data was never modified; the backup is $MIG/$STAMP.tar.gz"
  if [ "$data_created" = 1 ]; then
    log "  $DIR/zigbee2mqtt-data (or $PARTIAL) is the copy made by this run (move it away before a new --migrate)"
  fi
}

rollback() {
  trap '' HUP INT TERM
  armed=0
  set_state running rollback
  log "ROLLBACK: going back to the old stack"
  if ! stop_new_verified; then
    log "the new stack is still running or could not be verified as stopped; the old stack is NOT started"
    manual_help "The new stack could not be stopped (or not proven stopped)."
    end_with failed-manual "the new stack could not be stopped, the old stack was not started"
  fi
  log "the new stack is stopped (verified)"
  if [ "$data_created" = 1 ]; then
    # The copy is either still the .partial or already in place (then this run moved it there); never both.
    copy=$PARTIAL
    if [ "$copy_in_place" = 1 ]; then copy=$DIR/zigbee2mqtt-data; fi
    if [ -d "$copy" ]; then
      if mv "$copy" "$MIG/failed-data-$STAMP"; then
        log "the copied data folder was set aside in $MIG/failed-data-$STAMP (root only)"
      else
        log "could not set the copied data aside; $copy is the copy (the original is untouched)"
      fi
    fi
  fi
  # Before the old stack starts: its containers must restart again the way they did.
  if ! restore_old_restart; then restore_failed=1; fi
  log "starting the old stack"
  old_compose up -d || log "compose up of the old stack failed"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if old_z2m_running; then
      log "the old stack is running again ($OLD); its data were never modified"
      if [ "$restore_failed" = 1 ]; then
        manual_help "The old stack runs, but its saved restart policy could not be put back (it stays at no: it will not start after a reboot)."
        end_with failed-manual "the old stack runs again, but its restart policy was not restored"
      fi
      end_with rolled-back "the old stack is running again; fix the cause, then run --migrate again (the backup $STAMP.tar.gz stays)"
    fi
    sleep "$POLL"
  done
  log "OLD STACK DID NOT START AGAIN"
  manual_help "The old stack did not come back."
  end_with failed-manual "the old stack did not start again"
}

fail() {
  log "FAILED: $1"
  if [ "$armed" = 1 ]; then rollback; fi
  end_with rolled-back "$1 - nothing of the old setup was changed"
}

# shellcheck disable=SC2329 # runs through the trap
on_signal() {
  log "received $1"
  trap '' HUP INT TERM
  fail "interrupted by $1"
}
trap 'on_signal HUP' HUP
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
# shellcheck disable=SC2329 # runs through the trap
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$finished" = 0 ]; then
    log "the script ended unexpectedly (exit $rc)"
    fail "unexpected end of migrate.sh"
  fi
}
trap on_exit EXIT

# --- the run ---
set_state running start
log "migration $STAMP: new folder $DIR, old stack $OLD (pid $$)"

set_state running check
[ -f "$OLD/docker-compose.yml" ] || fail "$OLD/docker-compose.yml does not exist"
[ -d "$OLD/zigbee2mqtt-data" ] || fail "$OLD/zigbee2mqtt-data does not exist"
if [ -n "$(ls -A "$DIR/zigbee2mqtt-data" 2> /dev/null)" ]; then fail "$DIR/zigbee2mqtt-data already has content"; fi
if [ -e "$PARTIAL" ]; then fail "$PARTIAL exists: an earlier migration was interrupted during the copy (move it away, docs/runbooks/gateway.md section 11)"; fi
old_z2m_running || fail "the zigbee2mqtt service of the old stack is not running"

# The tarball is taken from the running Z2M; the copy after the stop is the consistent one.
set_state running backup
log "backup of $OLD/zigbee2mqtt-data to $MIG/$STAMP.tar.gz"
timeout -k 10 "$CT" tar -czf "$MIG/$STAMP.tar.gz" -C "$OLD" zigbee2mqtt-data || fail "the backup failed"
chmod 600 "$MIG/$STAMP.tar.gz" || fail "could not set the mode of the backup"
timeout -k 10 "$CT" tar -tzf "$MIG/$STAMP.tar.gz" > /dev/null || fail "the backup could not be read back"
log "backup verified"

armed=1
set_state running stop-old
log "stopping the old stack"
old_compose stop || fail "the old stack could not be stopped"
old_state
case $? in
  1) ;;
  0) fail "the old stack is still running after stop" ;;
  *) fail "could not verify that the old stack is stopped (a probe failed)" ;;
esac

# The old containers stay stopped for a while: their restart policy must not bring them back (see disable_old_restart).
set_state running old-restart
log "setting the restart policy of the old containers to no (saved first)"
disable_old_restart || fail "could not save and set the restart policy of the old containers"

# Z2M writes its settings (with the MQTT password and the frontend token) into configuration.yaml: root only.
set_modes() {
  local d=${1:-$DIR/zigbee2mqtt-data}
  timeout -k 5 "$CT" chown -R root:root "$d" || return 1
  chmod 700 "$d" || return 1
  if [ -f "$d/configuration.yaml" ]; then chmod 600 "$d/configuration.yaml" || return 1; fi
}

# The copy is made beside the final folder and moved into place when it is complete (a rename): a kill or a power
# loss during the copy leaves only the .partial, never a half-filled zigbee2mqtt-data that a deploy would start on.
set_state running copy
log "copying the data folder into $PARTIAL (the old one stays as it is)"
data_created=1
mkdir "$PARTIAL" || fail "could not create $PARTIAL"
timeout -k 10 "$CT" cp -a "$OLD/zigbee2mqtt-data/." "$PARTIAL/" || fail "copying the data folder failed"
set_state running modes
set_modes "$PARTIAL" || fail "could not set the modes of the copied Z2M data folder"
# An empty folder of an earlier --fresh run is replaced (rmdir refuses one with content); mv into it would nest.
if [ -d "$DIR/zigbee2mqtt-data" ]; then rmdir "$DIR/zigbee2mqtt-data" || fail "$DIR/zigbee2mqtt-data is not empty"; fi
mv "$PARTIAL" "$DIR/zigbee2mqtt-data" || fail "could not move the copy into place"
copy_in_place=1
log "the copy is in place"

set_state running start-new
# Right before the start, the check the plain deploy does: no second Zigbee2MQTT beside the new one.
foreign=$(foreign_z2m)
case $? in
  0) ;;
  1) fail "another Zigbee2MQTT container is running that is not part of the smart-gateway stack: $foreign" ;;
  *) fail "could not list the running containers, so it cannot be ruled out that another Zigbee2MQTT runs" ;;
esac
log "starting the new stack and waiting for Zigbee2MQTT (up to $WAIT s)"
timeout -k 10 $((2 * CT + WAIT + 60)) bash "$DIR/start.sh" "$DIR" "$CT" "$WAIT" "$POLL"
rc=$?
case "$rc" in
  0) ;;
  1) fail "docker compose up of the new stack failed" ;;
  *) fail "Zigbee2MQTT did not come up (online and stable, Mosquitto healthy) within $WAIT s" ;;
esac
set_modes || log "warning: could not set the modes again after the start"
armed=0
end_with "done" "the new stack runs; the old stack is stopped, not removed"
