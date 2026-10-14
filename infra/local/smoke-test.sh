#!/usr/bin/env sh
# Verifies the local dev infrastructure is up and as locked down as intended.
set -eu

COMPOSE="docker compose -f infra/local/compose.yaml"
fail() { echo "FAIL: $1" >&2; exit 1; }

ext=$($COMPOSE exec -T db psql -U smart -d smart -tAc "select extversion from pg_extension where extname = 'timescaledb'")
[ -n "$ext" ] || fail "timescaledb extension is missing"

tz=$($COMPOSE exec -T db psql -U smart -d smart -tAc "show timezone")
[ "$tz" = "UTC" ] || fail "database time zone is '$tz', expected UTC"

if $COMPOSE exec -T broker mosquitto_pub -h localhost -t smoke/anonymous -m x >/dev/null 2>&1; then
  fail "anonymous MQTT publish was accepted"
fi

# shellcheck disable=SC2016 # the variables must expand inside the broker container
$COMPOSE exec -T broker sh -c '
  mosquitto_sub -h localhost -u "$MQTT_USER" -P "$MQTT_PASSWORD" -t gw/smoke/auth -C 1 -W 5 > /tmp/smoke.out &
  sleep 1
  mosquitto_pub -h localhost -u "$MQTT_USER" -P "$MQTT_PASSWORD" -t gw/smoke/auth -m ok
  wait
  grep -qx ok /tmp/smoke.out
' || fail "authenticated MQTT publish/subscribe failed"

# The simulator announces its gateway: the retained device list of its own prefix (read as the backend's user).
# shellcheck disable=SC2016 # the variables must expand inside the broker container
$COMPOSE exec -T broker sh -c '
  mosquitto_sub -h localhost -u "$MQTT_USER" -P "$MQTT_PASSWORD" -t "gw/$MQTT_SIMULATOR_GATEWAY_ID/z2m/bridge/devices" -C 1 -W 20 -F "%r %p" \
    | grep -q "^1 \[.*AY-303Z"
' || fail "the simulator did not publish its retained device list"

for pair in "db 5432" "broker 1883" "mail 1025" "mail 8025"; do
  # shellcheck disable=SC2086 # splitting "service port" into two words is intended
  set -- $pair
  address=$($COMPOSE port "$1" "$2")
  case "$address" in
    127.0.0.1:*) ;;
    *) fail "$1:$2 is published on '$address', expected 127.0.0.1 only" ;;
  esac
done

curl -fsS "http://127.0.0.1:8026/api/v1/info" >/dev/null || fail "mailpit API is unreachable"

echo "OK: local infrastructure smoke test passed"
