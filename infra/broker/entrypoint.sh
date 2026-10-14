#!/bin/sh
# Renders the broker configuration, password file and ACL on every start into /mosquitto/run (a tmpfs in the
# stack, the root file system is read-only), so no hash, secret or certificate copy is ever committed or persisted.
set -eu
: "${MQTT_USER:?MQTT_USER is required}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required}"

fail() {
  echo "broker: $*" >&2
  exit 1
}

# The ACL grants the backend's rights to this name, and certificates (gw-xxxxxxxx) can never carry it.
[ "$MQTT_USER" = smart-api ] || fail "MQTT_USER must be smart-api (the ACL grants the backend's rights to that name)"

RUN=/mosquitto/run
mkdir -p "$RUN"
# Nothing sensitive lives on the data volume any more; remove the password file earlier versions left there.
rm -f /mosquitto/data/passwd

# Mosquitto reads these files again after dropping privileges, so the broker user owns them.
secure() {
  chown mosquitto:mosquitto "$@"
  chmod 0600 "$@"
}

cp /mosquitto/config/mosquitto.conf "$RUN/mosquitto.conf"
cp /mosquitto/config/acl "$RUN/acl"

PASSWD="$RUN/passwd"
rm -f "$PASSWD"
mosquitto_passwd -c -b "$PASSWD" "$MQTT_USER" "$MQTT_PASSWORD"

# The simulator is an optional extra user for its own gateway prefix. The ID is checked before it is
# written into the ACL: a value with a line break or a wildcard must never become an ACL line.
if [ -n "${MQTT_SIMULATOR_PASSWORD:-}" ]; then
  id="${MQTT_SIMULATOR_GATEWAY_ID:-}"
  case "$id" in
    gw-[a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9]) ;;
    *) fail "MQTT_SIMULATOR_GATEWAY_ID must match gw-[a-z0-9]{8} when MQTT_SIMULATOR_PASSWORD is set" ;;
  esac
  mosquitto_passwd -b "$PASSWD" smart-simulator "$MQTT_SIMULATOR_PASSWORD"
  cat >> "$RUN/acl" << ACL

user smart-simulator
topic write gw/$id/z2m/#
topic write gw/$id/bridge/connection
topic read  gw/$id/z2m/+/set
topic read  gw/$id/z2m/bridge/request/#
ACL
fi

# Certificates arrive read-only and owned by the deploy user: the public files (also visible to the api) under
# /mosquitto/certs, the server key alone under /mosquitto/certs-private. mosquitto reads them after dropping
# privileges, so they are copied into the tmpfs, owned by the broker user. TLS is only switched on when asked
# for and complete: a half-provisioned stack must not open a public listener.
cert_source() {
  if [ "$1" = server.key ]; then echo "/mosquitto/certs-private/$1"; else echo "/mosquitto/certs/$1"; fi
}
case "${MQTT_TLS:-off}" in
  off) ;;
  on)
    for f in ca.crt server.crt server.key crl.pem; do
      [ -s "$(cert_source "$f")" ] || fail "MQTT_TLS=on but $(cert_source "$f") is missing"
    done
    install -d -o mosquitto -g mosquitto -m 700 "$RUN/certs"
    for f in ca.crt server.crt server.key crl.pem; do
      install -o mosquitto -g mosquitto -m 600 "$(cert_source "$f")" "$RUN/certs/"
    done
    cat /mosquitto/config/tls.conf >> "$RUN/mosquitto.conf"
    ;;
  *) fail "MQTT_TLS must be on or off" ;;
esac

secure "$RUN/mosquitto.conf" "$RUN/acl" "$PASSWD"

exec mosquitto -c "$RUN/mosquitto.conf"
