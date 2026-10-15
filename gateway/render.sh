#!/usr/bin/env bash
# Renders run/mosquitto.conf from mosquitto.conf.template and secrets/gateway.env. Runs on the gateway as root
# (sudo), before every start of the stack. The directory defaults to /srv/smart-gateway; SMART_GATEWAY_DIR
# overrides it (tests). gateway.env is parsed, never sourced: it is read as root, so it must not run code.
# Nothing is written unless every value is valid; the output replaces the old file atomically (mode 600).
set -euo pipefail
umask 077

DIR="${SMART_GATEWAY_DIR:-/srv/smart-gateway}"
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mosquitto.conf.template"
ENV_FILE="$DIR/secrets/gateway.env"
OUT_DIR="$DIR/run"

fail() {
  echo "render.sh: $*" >&2
  exit 1
}

[ -r "$TEMPLATE" ] || fail "template not found: $TEMPLATE"
[ -r "$ENV_FILE" ] || fail "cannot read $ENV_FILE (run provision-gateway.sh first)"

GATEWAY_ID=""
BROKER_HOST=""
BROKER_PORT=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '' | '#'*) continue ;;
    GATEWAY_ID=*) GATEWAY_ID="${line#GATEWAY_ID=}" ;;
    BROKER_HOST=*) BROKER_HOST="${line#BROKER_HOST=}" ;;
    BROKER_PORT=*) BROKER_PORT="${line#BROKER_PORT=}" ;;
  esac
done < "$ENV_FILE"

# Values end up in a configuration file: only these shapes are allowed, nothing with spaces, line breaks or
# braces. The host is a DNS name (labels of letters, digits and hyphens, at most 253 characters) or an IPv4 address.
[[ "$GATEWAY_ID" =~ ^gw-[a-z0-9]{8}$ ]] || fail "GATEWAY_ID in $ENV_FILE must match gw-[a-z0-9]{8}"
[[ "$BROKER_HOST" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] \
  && [ "${#BROKER_HOST}" -le 253 ] || fail "BROKER_HOST in $ENV_FILE is not a valid host name"
[[ "$BROKER_PORT" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$BROKER_PORT))" -ge 1 ] && [ "$((10#$BROKER_PORT))" -le 65535 ] \
  || fail "BROKER_PORT in $ENV_FILE must be a port number (1-65535)"
BROKER_PORT=$((10#$BROKER_PORT))

mkdir -p "$OUT_DIR"
tmp=$(mktemp "$OUT_DIR/.mosquitto.conf.XXXXXX")
trap 'rm -f "$tmp"' EXIT
# Bash replaces the placeholders literally; the values were validated above and contain no special characters.
content=$(< "$TEMPLATE")
content="${content//\{\{GATEWAY_ID\}\}/$GATEWAY_ID}"
content="${content//\{\{BROKER_HOST\}\}/$BROKER_HOST}"
content="${content//\{\{BROKER_PORT\}\}/$BROKER_PORT}"
printf '%s\n' "$content" > "$tmp"
if grep -q '{{' "$tmp"; then fail "unresolved placeholder in the template"; fi
chmod 600 "$tmp"
mv -f "$tmp" "$OUT_DIR/mosquitto.conf"
trap - EXIT
echo "render.sh: wrote $OUT_DIR/mosquitto.conf for $GATEWAY_ID"
