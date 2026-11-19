#!/usr/bin/env bash
# Starts the gateway stack and waits until Zigbee2MQTT is really up. Runs on the Pi as root, called by deploy.sh
# (plain deploy) and migrate.sh (migration), both from the gateway folder's copy on the Pi.
# Usage: start.sh <gateway-dir> <compose-timeout> <wait-seconds> <poll-seconds>
# Exit codes: 0 up and verified, 1 docker compose up failed, 2 Zigbee2MQTT not online and stable in time.
# "Up" means: the Z2M container runs, Mosquitto is healthy, the retained zigbee2mqtt/bridge/state says online (read
# with the health user of the local broker: public password, only a few status topics, no secret in argv), and the
# answer is not stale. A retained "online" survives a Z2M that never connects (for example no adapter), so the
# container must also be the one this start created (started after the start of this script) or, if compose left
# it alone, must not have restarted since; and two polls in a row must show the same container start and restart
# count (a restart loop changes them).
set -u
export LC_ALL=C

DIR=${1:?gateway dir}
CT=${2:?compose timeout}
WAIT=${3:?wait seconds}
POLL=${4:?poll seconds}
cd "$DIR" || exit 1

compose() { timeout -k 10 "$CT" docker compose --env-file secrets/gateway.env "$@"; }
probe_compose() { timeout -k 5 20 docker compose --env-file secrets/gateway.env "$@"; }

# Marker (UTC, same format as Docker's StartedAt) and the restart count of a Z2M container that already exists.
marker=$(date -u +%Y-%m-%dT%H:%M:%S)
baseline=-1
z2m_id=$(probe_compose ps -q zigbee2mqtt 2> /dev/null)
if [ -n "$z2m_id" ]; then
  baseline=$(timeout -k 5 20 docker inspect -f '{{.RestartCount}}' "$z2m_id" 2> /dev/null) || baseline=-1
fi

# Mosquitto is always recreated: the rendered configuration and the entry point are single-file bind mounts.
compose up -d --force-recreate mosquitto || { echo "start.sh: docker compose up (mosquitto) failed"; exit 1; }
compose up -d || { echo "start.sh: docker compose up failed"; exit 1; }

reason=""
previous=""
probe() {
  local z m info running restarts started health payload signature
  z=$(probe_compose ps -q zigbee2mqtt 2> /dev/null)
  m=$(probe_compose ps -q mosquitto 2> /dev/null)
  if [ -z "$z" ] || [ -z "$m" ]; then reason="a container is missing"; previous=""; return 1; fi
  info=$(timeout -k 5 20 docker inspect -f '{{.State.Running}} {{.RestartCount}} {{.State.StartedAt}}' "$z" 2> /dev/null) || info=""
  read -r running restarts started <<< "$info"
  if [ "$running" != true ]; then reason="the zigbee2mqtt container is not running"; previous=""; return 1; fi
  if [[ "$started" < "$marker" ]] && [ "$restarts" != "$baseline" ]; then
    reason="the zigbee2mqtt container restarted ($restarts restarts)"
    previous=""
    return 1
  fi
  health=$(timeout -k 5 20 docker inspect -f '{{.State.Health.Status}}' "$m" 2> /dev/null) || health=""
  if [ "$health" != healthy ]; then reason="Mosquitto is not healthy (${health:-unknown})"; previous=""; return 1; fi
  payload=$(probe_compose exec -T mosquitto mosquitto_sub -h 127.0.0.1 -u health -P health -t zigbee2mqtt/bridge/state -C 1 -W 5 2> /dev/null)
  case "$payload" in
    *'"online"'* | online) ;;
    *) reason="bridge/state is not online"; previous=""; return 1 ;;
  esac
  signature="$restarts $started"
  if [ "$signature" = "$previous" ]; then return 0; fi
  previous=$signature
  reason="waiting for a second matching poll"
  return 1
}

deadline=$((SECONDS + WAIT))
while :; do
  if probe; then echo "start.sh: Zigbee2MQTT is online and Mosquitto healthy"; exit 0; fi
  [ "$SECONDS" -lt "$deadline" ] || break
  sleep "$POLL"
done
echo "start.sh: Zigbee2MQTT did not report bridge/state online within ${WAIT} s ($reason)"
exit 2
