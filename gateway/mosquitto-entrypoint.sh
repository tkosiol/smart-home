#!/bin/sh
# Entry point of the gateway's Mosquitto container. The secrets arrive read-only and owned by root (mode 600,
# like on the Pi), but Mosquitto reads the password file and the bridge key after it dropped to the mosquitto
# user. So they are copied into a tmpfs, owned by that user, before the image's own entry point starts the broker.
set -eu

SRC=/mosquitto/secrets-src
DST=/mosquitto/secrets

for f in passwd ca.crt gateway.crt gateway.key; do
  [ -s "$SRC/$f" ] || {
    echo "mosquitto-entrypoint: $SRC/$f is missing or empty (run provision-gateway.sh)" >&2
    exit 1
  }
done
for f in passwd ca.crt gateway.crt gateway.key; do
  install -o mosquitto -g mosquitto -m 600 "$SRC/$f" "$DST/$f"
done

exec /docker-entrypoint.sh "$@"
