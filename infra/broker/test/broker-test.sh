#!/usr/bin/env bash
# Tests for the broker image: optional mTLS listener, ACL, simulator user. Needs Docker. All certificates are
# generated at runtime with pki.sh into a temporary directory; no key material is committed.
# The broker runs like in production: read-only root file system, tmpfs for /tmp and /mosquitto/run.
# shellcheck disable=SC2016,SC2034 # check() expressions are evaluated later on purpose (they read status and out)
set -u
cd "$(dirname "$0")/../../.." || exit 1
PKI_SH="$(pwd)/infra/pki/pki.sh"
IMAGE=smart-brokertest:local
NET=smart-brokertest
PREFIX=smart-brokertest
failures=0
passed=0

OSSL=""
for candidate in "${SMART_OPENSSL:-openssl}" /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
  if command -v "$candidate" > /dev/null 2>&1 && "$candidate" version | grep -Eq '^OpenSSL [3-9]'; then
    OSSL=$(command -v "$candidate")
    break
  fi
done
[ -n "$OSSL" ] || { echo "broker tests need OpenSSL 3 or newer (set SMART_OPENSSL)" >&2; exit 1; }
export SMART_OPENSSL="$OSSL"

WORK=$(mktemp -d)
remove_test_containers() {
  docker rm -fv "$PREFIX-off" "$PREFIX-on" "$PREFIX-client" "$PREFIX-abort" > /dev/null 2>&1
  docker network rm "$NET" > /dev/null 2>&1
}
cleanup() {
  remove_test_containers
  rm -rf "$WORK"
}
trap cleanup EXIT
# Leftovers of an aborted earlier run would make the names below clash.
remove_test_containers

check() {
  if eval "$2"; then passed=$((passed + 1)); else echo "FAIL: $1"; failures=$((failures + 1)); fi
}
quiet() { "$@" > /dev/null 2>&1; }

API_PW=broker-test-api
SIM_PW=broker-test-sim
GW_A=gw-testaaaa
GW_B=gw-testbbbb
GW_REVOKED=gw-testcccc
GW_SIM=gw-testsimu

# --- throwaway PKI: the real CA and a foreign one ---
export SMART_PKI_PASSPHRASE_FILE="$WORK/passphrase"
printf 'correct horse battery staple\n' > "$SMART_PKI_PASSPHRASE_FILE"
pki() { SMART_PKI_DIR="$1" bash "$PKI_SH" "${@:2}" < /dev/null > /dev/null; }
PKI_DIR="$WORK/pki"
FOREIGN_DIR="$WORK/foreign-pki"
if ! { pki "$PKI_DIR" init-ca && pki "$PKI_DIR" issue-server broker \
  && pki "$PKI_DIR" issue-gateway "$GW_A" && pki "$PKI_DIR" issue-gateway "$GW_B" \
  && pki "$PKI_DIR" issue-gateway "$GW_REVOKED" && pki "$PKI_DIR" revoke "$GW_REVOKED" \
  && pki "$FOREIGN_DIR" init-ca && pki "$FOREIGN_DIR" issue-gateway "$GW_A"; }; then
  echo "could not set up the throwaway PKI" >&2
  exit 1
fi

# What the broker container gets (never the CA key) and what the client container gets.
CERTS="$WORK/certs"
CLIENT="$WORK/client"
mkdir -p "$CERTS" "$CLIENT"
for f in ca.crt server.crt server.key crl.pem; do cp "$PKI_DIR/$f" "$CERTS/$f"; done
cp "$PKI_DIR/ca.crt" "$CLIENT/ca.crt"
for id in "$GW_A" "$GW_B" "$GW_REVOKED"; do
  cp "$PKI_DIR/gateways/$id.crt" "$PKI_DIR/gateways/$id.key" "$CLIENT/"
done
cp "$FOREIGN_DIR/gateways/$GW_A.crt" "$CLIENT/foreign.crt"
cp "$FOREIGN_DIR/gateways/$GW_A.key" "$CLIENT/foreign.key"
chmod 755 "$CLIENT"
chmod 644 "$CLIENT"/*

docker build -q -t "$IMAGE" infra/broker > /dev/null || { echo "docker build failed" >&2; exit 1; }
docker network create "$NET" > /dev/null || { echo "docker network create failed" >&2; exit 1; }

# A container that cannot even be started makes every later result meaningless: stop at once.
must_start() {
  "$@" > /dev/null || { echo "could not start the test container: $*" >&2; exit 1; }
}

# Starts the broker like in production; extra arguments are docker run options (env, mounts).
start_broker() {
  local name="$1"
  shift
  must_start docker run -d --name "$name" --network "$NET" --network-alias broker --read-only \
    --tmpfs /mosquitto/run --tmpfs /tmp -v /mosquitto/data \
    -e MQTT_USER=smart-api -e MQTT_PASSWORD="$API_PW" "$@" "$IMAGE"
}

must_start docker run -d --name "$PREFIX-client" --network "$NET" -v "$CLIENT:/c:ro" --entrypoint sleep "$IMAGE" 3600

cl() { docker exec "$PREFIX-client" "$@"; }

# Plain password connection on the internal listener, as smart-api or any other user.
api_pub() { cl mosquitto_pub -h broker -p 1883 -u smart-api -P "$API_PW" -q 1 -t "$1" -m "$2"; }
user_pub() { cl mosquitto_pub -h broker -p 1883 -u "$1" -P "$2" -q 1 -t "$3" -m "$4"; }
# mTLS connection as gateway $1 ("foreign" selects the certificate of the foreign CA).
gw_args() { printf '%s\n' -h broker -p 8883 --cafile /c/ca.crt --cert "/c/$1.crt" --key "/c/$1.key"; }
gw_pub() {
  local id="$1"
  shift
  # shellcheck disable=SC2046 # one argument per line
  cl mosquitto_pub $(gw_args "$id") -q 1 -t "$1" -m "$2"
}
tls_ready() { gw_pub "$GW_A" "gw/$GW_A/z2m/ready" 1 > /dev/null 2>&1; }

wait_for() {
  for _ in $(seq 1 40); do
    if "$@" > /dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}
api_ready() { cl mosquitto_sub -h broker -p 1883 -u smart-api -P "$API_PW" -t '$SYS/broker/uptime' -C 1 -W 2; }

# Calls "$@" every 0.25 s until the file $1 contains the line pattern $2 (a probe that went through a subscription
# that is not active yet is simply lost, so it is repeated); fails after about 10 s.
probe_until() {
  local out="$1" pattern="$2"
  shift 2
  for _ in $(seq 1 40); do
    "$@" > /dev/null 2>&1
    if grep -q "$pattern" "$out" 2> /dev/null; then return 0; fi
    sleep 0.25
  done
  return 1
}
# A subscriber that never became ready would make every "nothing arrived" check pass for the wrong reason.
require_ready() {
  if ! "$@"; then
    echo "FAIL: subscriber was not ready: $1 $2"
    failures=$((failures + 1))
  fi
}
LISTEN_WINDOW=10
probe_gw() { api_pub "gw/probe/z2m/ready" probe-ready; }

# Runs the function $2 while smart-api listens on gw/# (window of $LISTEN_WINDOW seconds, started once a probe
# has arrived) and writes what arrived into the file $1.
listen_while() {
  local out="$1" action="$2" pid
  cl mosquitto_sub -h broker -p 1883 -u smart-api -P "$API_PW" -t 'gw/#' -v -W "$LISTEN_WINDOW" > "$out" 2>&1 &
  pid=$!
  require_ready probe_until "$out" probe-ready probe_gw
  "$action"
  wait "$pid" 2> /dev/null
  return 0
}

# Runs a container that is expected to abort; sets status and out (exit code and log). A container that keeps
# running is a failure (status 99), not a hang.
run_expect_abort() {
  docker rm -f "$PREFIX-abort" > /dev/null 2>&1
  must_start docker run -d --name "$PREFIX-abort" --read-only --tmpfs /mosquitto/run --tmpfs /tmp -v /mosquitto/data \
    -e MQTT_USER=smart-api -e MQTT_PASSWORD="$API_PW" "$@" "$IMAGE"
  status=99
  for _ in $(seq 1 20); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$PREFIX-abort")" = false ]; then
      status=$(docker inspect -f '{{.State.ExitCode}}' "$PREFIX-abort")
      break
    fi
    sleep 0.5
  done
  out=$(docker logs "$PREFIX-abort" 2>&1)
  docker rm -fv "$PREFIX-abort" > /dev/null 2>&1
}

# --- TLS off (the default): no public listener, ACL and simulator rules ---
start_broker "$PREFIX-off"
check "the broker starts without MQTT_TLS" 'wait_for api_ready'
check "TLS off: the broker listens on 1883" 'docker exec "$PREFIX-off" netstat -ln | grep -q ":1883 "'
check "TLS off: nothing listens on 8883" '! docker exec "$PREFIX-off" netstat -ln | grep -q ":8883 "'
check "TLS off: no simulator user in the ACL" '! docker exec "$PREFIX-off" grep -q smart-simulator /mosquitto/run/acl && ! docker exec "$PREFIX-off" grep -q smart-simulator /mosquitto/run/passwd'
check "TLS off: anonymous connections are refused" '! quiet cl mosquitto_pub -h broker -p 1883 -t gw/x/z2m/x -m 1'
check "TLS off: a wrong password is refused" '! quiet cl mosquitto_pub -h broker -p 1883 -u smart-api -P wrong -t gw/x/z2m/x -m 1'
check "TLS off: the production health check passes" 'wait_for sh -c "[ \"\$(docker inspect -f {{.State.Health.Status}} $PREFIX-off)\" = healthy ]"'
check "TLS off: no generated file is world readable" '[ -z "$(docker exec "$PREFIX-off" find /mosquitto/run -type f -perm /077)" ]'
docker rm -fv "$PREFIX-off" > /dev/null 2>&1

# --- MQTT_TLS=on with an incomplete certificate set aborts with a message ---
for missing in ca.crt server.crt server.key crl.pem; do
  rm -rf "$WORK/partial"
  mkdir "$WORK/partial"
  for f in ca.crt server.crt server.key crl.pem; do
    if [ "$f" != "$missing" ]; then cp "$CERTS/$f" "$WORK/partial/$f"; fi
  done
  run_expect_abort -v "$WORK/partial:/mosquitto/certs:ro" -e MQTT_TLS=on
  check "MQTT_TLS=on without $missing exits with a message" '[ "$status" -ne 0 ] && echo "$out" | grep -q "MQTT_TLS=on but /mosquitto/certs/$missing is missing"'
done
run_expect_abort -e MQTT_TLS=maybe
check "an unknown MQTT_TLS value aborts instead of silently staying off" '[ "$status" -ne 0 ] && echo "$out" | grep -q "MQTT_TLS must be on or off"'

# --- the simulator gateway ID is checked before it reaches the ACL ---
NEWLINE_ID=$(printf 'gw-testsimu\ntopic readwrite #')
for bad in 'gw-abc' 'GW-testsimu' 'gw-TESTSIMU' 'gw-testsimu9' 'gw-testsimu/#' 'gw-test+imu' "$NEWLINE_ID" ''; do
  run_expect_abort -e MQTT_SIMULATOR_PASSWORD="$SIM_PW" -e "MQTT_SIMULATOR_GATEWAY_ID=$bad"
  check "simulator gateway ID '$(printf '%s' "$bad" | tr '\n' '|')' aborts the container" '[ "$status" -ne 0 ] && echo "$out" | grep -q "MQTT_SIMULATOR_GATEWAY_ID"'
done

# --- TLS on, with the simulator user ---
start_broker "$PREFIX-on" -v "$CERTS:/mosquitto/certs:ro" -e MQTT_TLS=on \
  -e MQTT_SIMULATOR_PASSWORD="$SIM_PW" -e MQTT_SIMULATOR_GATEWAY_ID="$GW_SIM"
check "TLS on: the broker starts and accepts a valid gateway certificate" 'wait_for tls_ready'
check "TLS on: nothing is stored under /mosquitto/data from the certificates" '[ -z "$(docker exec "$PREFIX-on" find /mosquitto/data -name "*.key" -o -name "*.crt")" ]'
check "TLS on: the private key copy is private to the broker user" '[ "$(docker exec "$PREFIX-on" stat -c "%U %a" /mosquitto/run/certs/server.key)" = "mosquitto 600" ]'

# Handshake failures
check "TLS on: a connection without a client certificate fails" '! quiet cl mosquitto_pub -h broker -p 8883 --cafile /c/ca.crt -q 1 -t gw/$GW_A/z2m/x -m 1'
check "TLS on: a certificate of a foreign CA fails" '! quiet gw_pub foreign "gw/$GW_A/z2m/x" 1'
check "TLS on: a revoked certificate fails" '! quiet gw_pub "$GW_REVOKED" "gw/$GW_REVOKED/z2m/x" 1'
check "TLS on: a client that does not trust the server CA fails" '! quiet cl mosquitto_pub -h broker -p 8883 --cert /c/$GW_A.crt --key /c/$GW_A.key -q 1 -t gw/$GW_A/z2m/x -m 1'

# Own prefix works, foreign prefix is dropped silently.
pub_prefixes() {
  gw_pub "$GW_A" "gw/$GW_A/z2m/x" own-prefix > /dev/null 2>&1
  gw_pub "$GW_A" "gw/$GW_B/z2m/x" foreign-prefix > /dev/null 2>&1
  gw_pub "$GW_A" "gw/$GW_A/bridge/connection" own-connection > /dev/null 2>&1
  gw_pub "$GW_A" "gw/$GW_B/bridge/connection" foreign-connection > /dev/null 2>&1
}
listen_while "$WORK/prefixes.out" pub_prefixes
check "a gateway publishes under its own prefix and smart-api receives it" 'grep -qx "gw/$GW_A/z2m/x own-prefix" "$WORK/prefixes.out" && grep -qx "gw/$GW_A/bridge/connection own-connection" "$WORK/prefixes.out"'
check "gateway A cannot publish under the prefix of gateway B" '! grep -q "foreign" "$WORK/prefixes.out"'

# Commands: only the own prefix is readable, and only while connected.
# gw_listen ID OUT TOPIC PROBE_TOPIC [mosquitto_sub options]: subscribes as gateway ID in the background and returns
# once smart-api's probe on PROBE_TOPIC has arrived; GW_LISTEN_PID is the subscriber (it ends after LISTEN_WINDOW).
probe_command() { api_pub "$1" probe-ready; }
gw_listen() {
  local id="$1" out="$2" topic="$3" probe="$4"
  shift 4
  # shellcheck disable=SC2046 # one argument per line
  cl mosquitto_sub $(gw_args "$id") -t "$topic" -v -W "$LISTEN_WINDOW" "$@" > "$out" 2>&1 &
  GW_LISTEN_PID=$!
  require_ready probe_until "$out" probe-ready probe_command "$probe"
}
gw_listen "$GW_A" "$WORK/commands.out" "gw/+/z2m/+/set" "gw/$GW_A/z2m/probe/set"
api_pub "gw/$GW_A/z2m/dev/set" own-command > /dev/null 2>&1
api_pub "gw/$GW_B/z2m/dev/set" foreign-command > /dev/null 2>&1
wait "$GW_LISTEN_PID" 2> /dev/null
check "a gateway receives commands for itself" 'grep -qx "gw/$GW_A/z2m/dev/set own-command" "$WORK/commands.out"'
check "a gateway never receives commands for another gateway" '! grep -q foreign-command "$WORK/commands.out"'

gw_listen "$GW_A" "$WORK/bridge-requests.out" "gw/+/z2m/bridge/request/#" "gw/$GW_A/z2m/bridge/request/probe"
api_pub "gw/$GW_A/z2m/bridge/request/permit_join" own-request > /dev/null 2>&1
api_pub "gw/$GW_B/z2m/bridge/request/permit_join" foreign-request > /dev/null 2>&1
wait "$GW_LISTEN_PID" 2> /dev/null
check "a gateway receives bridge requests for itself only" 'grep -q own-request "$WORK/bridge-requests.out" && ! grep -q foreign-request "$WORK/bridge-requests.out"'

# A persistent session (like the bridge's) must not collect QoS 0 commands while the gateway is offline.
# Session 1 subscribes (a probe proves it) and leaves after the first message; the session stays at the broker.
gw_listen "$GW_A" "$WORK/session1.out" "gw/$GW_A/z2m/dev/set" "gw/$GW_A/z2m/dev/set" -c -i "$GW_A-session" -q 0 -C 1
wait "$GW_LISTEN_PID" 2> /dev/null
api_pub "gw/$GW_A/z2m/dev/set" offline-command-qos1 > /dev/null 2>&1
cl mosquitto_pub -h broker -p 1883 -u smart-api -P "$API_PW" -q 0 -t "gw/$GW_A/z2m/dev/set" -m offline-command-qos0 > /dev/null 2>&1
gw_listen "$GW_A" "$WORK/session2.out" "gw/$GW_A/z2m/dev/set" "gw/$GW_A/z2m/dev/set" -c -i "$GW_A-session" -q 0
api_pub "gw/$GW_A/z2m/dev/set" online-command > /dev/null 2>&1
wait "$GW_LISTEN_PID" 2> /dev/null
check "a command sent while the gateway is connected arrives" 'grep -q online-command "$WORK/session2.out"'
check "commands sent while the gateway was offline do not arrive afterwards" '! grep -q offline-command "$WORK/session2.out"'

# --- simulator user: its own prefix only ---
sim_pubs() {
  user_pub smart-simulator "$SIM_PW" "gw/$GW_SIM/z2m/x" sim-own > /dev/null 2>&1
  user_pub smart-simulator "$SIM_PW" "gw/$GW_SIM/bridge/connection" sim-connection > /dev/null 2>&1
  user_pub smart-simulator "$SIM_PW" "gw/$GW_A/z2m/x" sim-foreign > /dev/null 2>&1
  user_pub smart-simulator "$SIM_PW" "gw/$GW_A/bridge/connection" sim-foreign-connection > /dev/null 2>&1
  user_pub smart-simulator "$SIM_PW" "other/topic" sim-other > /dev/null 2>&1
}
listen_while "$WORK/sim.out" sim_pubs
check "the simulator publishes under its own prefix" 'grep -qx "gw/$GW_SIM/z2m/x sim-own" "$WORK/sim.out" && grep -qx "gw/$GW_SIM/bridge/connection sim-connection" "$WORK/sim.out"'
check "the simulator cannot publish under a foreign prefix" '! grep -q "sim-foreign" "$WORK/sim.out" && ! grep -q "sim-other" "$WORK/sim.out"'

sim_listen_out="$WORK/sim-listen.out"
cl mosquitto_sub -h broker -p 1883 -u smart-simulator -P "$SIM_PW" -t 'gw/+/z2m/+/set' -v -W "$LISTEN_WINDOW" > "$sim_listen_out" 2>&1 &
sim_pid=$!
require_ready probe_until "$sim_listen_out" probe-ready probe_command "gw/$GW_SIM/z2m/probe/set"
api_pub "gw/$GW_SIM/z2m/dev/set" sim-command > /dev/null 2>&1
api_pub "gw/$GW_A/z2m/dev/set" sim-foreign-command > /dev/null 2>&1
wait "$sim_pid" 2> /dev/null
check "the simulator receives commands for its own gateway only" 'grep -q sim-command "$sim_listen_out" && ! grep -q sim-foreign-command "$sim_listen_out"'
check "the simulator cannot connect on the TLS listener without a certificate" '! quiet cl mosquitto_pub -h broker -p 8883 --cafile /c/ca.crt -u smart-simulator -P "$SIM_PW" -q 1 -t gw/$GW_SIM/z2m/x -m 1'

echo "broker tests: $passed passed, $failures failed"
[ "$failures" -eq 0 ]
