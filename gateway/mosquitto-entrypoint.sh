#!/bin/sh
# Entry point of the gateway's Mosquitto container. Two jobs before the image's own entry point starts the broker:
#
# 1. The secrets arrive read-only and owned by root (mode 600, like on the Pi), but Mosquitto reads the password
#    file and the bridge key after it dropped to the mosquitto user. So they are copied into a tmpfs, owned by that
#    user.
# 2. The local broker gets an ACL: every user of the password file (Zigbee2MQTT's) may do everything, plus the user
#    "health" of the container health check and of deploy.sh, which may only read three things: $SYS/broker/uptime,
#    the bridge state (gw/<id>/bridge/connection, 1 or 0: Mosquitto also publishes its notification topic locally) and zigbee2mqtt/bridge/state (Zigbee2MQTT's
#    online/offline). Its password is public on purpose (a health check cannot keep a secret out of the process
#    list), so it must stay that powerless.
set -eu

SRC=/mosquitto/secrets-src
DST=/mosquitto/secrets

fail() {
  echo "mosquitto-entrypoint: $*" >&2
  exit 1
}

for f in passwd ca.crt gateway.crt gateway.key; do
  [ -s "$SRC/$f" ] || fail "$SRC/$f is missing or empty (run provision-gateway.sh)"
done

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# mosquitto_passwd replaces the file (the result is owned by whoever runs it), so it works on a copy that is
# installed afterwards.
cp "$SRC/passwd" "$WORKDIR/passwd"
mosquitto_passwd -b "$WORKDIR/passwd" health health > /dev/null 2>&1 || fail "could not add the health user"

: > "$WORKDIR/acl"
# shellcheck disable=SC2016 # $SYS is a topic name, not a variable
printf '%s\n' 'user health' 'topic read $SYS/broker/uptime' 'topic read gw/+/bridge/connection' \
  'topic read zigbee2mqtt/bridge/state' >> "$WORKDIR/acl"
users=0
cut -d: -f1 "$SRC/passwd" > "$WORKDIR/users"
while IFS= read -r user; do
  [ "$user" != health ] || fail "$SRC/passwd must not contain the user health (the entry point adds it with its own restricted rights)"
  # A name from the password file ends up in the ACL: only plain characters.
  case "$user" in
    '' | *[!A-Za-z0-9._-]*) fail "user name in $SRC/passwd has characters other than A-Z a-z 0-9 . _ -" ;;
  esac
  printf '\nuser %s\ntopic readwrite #\n' "$user" >> "$WORKDIR/acl"
  users=$((users + 1))
done < "$WORKDIR/users"
[ "$users" -gt 0 ] || fail "$SRC/passwd has no user besides health"

install -o mosquitto -g mosquitto -m 600 "$WORKDIR/passwd" "$DST/passwd"
install -o mosquitto -g mosquitto -m 600 "$WORKDIR/acl" "$DST/acl"
for f in ca.crt gateway.crt gateway.key; do
  install -o mosquitto -g mosquitto -m 600 "$SRC/$f" "$DST/$f"
done

# exec replaces this shell, so the EXIT trap would never run: the copies must not stay in the container.
rm -rf "$WORKDIR"
trap - EXIT
exec /docker-entrypoint.sh "$@"
