#!/usr/bin/env bash
# Puts the secrets of one gateway onto its Raspberry Pi: /srv/smart-gateway/secrets (root, mode 700, files 600).
# Run it yourself in a terminal in the home network – secrets never pass through chat or CI.
# Usage: SMART_PI=<user@pi-host> infra/deploy/provision-gateway.sh <gateway-id> [--force]
# Needs the gateway certificate from infra/pki/pki.sh (issue-gateway) in SMART_PKI_DIR (default ~/.smart-pki):
# gateways/<id>.crt, gateways/<id>.key and ca.crt. The operator user on the Pi needs passwordless sudo
# (sudo -n, no terminal is allocated) and Docker; the folder gateway/ of the repo belongs in /srv/smart-gateway.
# It writes (docs/runbooks/gateway.md):
#   gateway.env  GATEWAY_ID, BROKER_HOST, BROKER_PORT, Z2M_SERIAL_DEVICE
#   z2m.env      ZIGBEE2MQTT_CONFIG_MQTT_USER, ..._MQTT_PASSWORD, ..._FRONTEND_AUTH_TOKEN (generated)
#   passwd       the password file of the local broker (hashed on the Pi with the pinned mosquitto image)
#   backup.env   B2_ENDPOINT, B2_BUCKET, B2_KEY_ID, B2_APP_KEY, RESTIC_PASSWORD, HC_BACKUP_URL (for the backup, plan 5b task 5)
#                (optional HC_RESTORE_URL: added by hand, then kept by --force)
#   ca.crt, gateway.crt, gateway.key
# --force replaces an existing set but keeps the generated Z2M password and frontend token and, when a prompt is
# answered with Enter, the stored settings. Without a stored value a prompt stays required. A hand-added
# HC_RESTORE_URL line of backup.env (the ping of the weekly restore test, no prompt) is kept too.
# Everything travels in ONE ssh session as a tar stream on stdin, so no secret appears in a command line or in the
# output; nothing on the Pi changes before all checks passed, and a failed transfer leaves the old files in place.
# SMART_GATEWAY_DIR (default /srv/smart-gateway) and SMART_SERIAL_BY_ID_DIR (default /dev/serial/by-id) exist for tests.
set -euo pipefail
umask 077

usage() { echo "usage: SMART_PI=<user@pi-host> provision-gateway.sh <gateway-id> [--force]" >&2; exit 2; }
fail() { echo "provision-gateway.sh: $*" >&2; exit 1; }

gateway_id="${1:-}"
force="${2:-}"
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
[ -z "$force" ] || [ "$force" = "--force" ] || usage
[[ "$gateway_id" =~ ^gw-[a-z0-9]{8}$ ]] || { echo "the gateway ID must match gw-[a-z0-9]{8} (see infra/pki/pki.sh issue-gateway)" >&2; exit 2; }
host="${SMART_PI:?set SMART_PI=<user@pi-host> (see .local/pi.md)}"
pki_dir="${SMART_PKI_DIR:-$HOME/.smart-pki}"
remote_dir="${SMART_GATEWAY_DIR:-/srv/smart-gateway}"
serial_dir="${SMART_SERIAL_BY_ID_DIR:-/dev/serial/by-id}"
[[ "$remote_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "SMART_GATEWAY_DIR is not a plain absolute path"
[[ "$serial_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "SMART_SERIAL_BY_ID_DIR is not a plain absolute path"

# 1. Local checks, before anything is sent. The key goes only onto its own gateway.
src_crt="$pki_dir/gateways/$gateway_id.crt"
src_key="$pki_dir/gateways/$gateway_id.key"
src_ca="$pki_dir/ca.crt"
for file in "$src_crt" "$src_key" "$src_ca"; do
  if [ ! -s "$file" ] || [ ! -r "$file" ]; then
    echo "missing or unreadable $file – run infra/pki/pki.sh init-ca and issue-gateway $gateway_id first" >&2
    exit 1
  fi
done

# The image that hashes the passwords is the one compose.yaml runs: one pin, one place.
compose_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../gateway/compose.yaml"
mosquitto_image=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(eclipse-mosquitto:[A-Za-z0-9._-]*\)[[:space:]]*$/\1/p' "$compose_file" 2> /dev/null | head -n 1)
[ -n "$mosquitto_image" ] || fail "no eclipse-mosquitto image found in gateway/compose.yaml"

# 2. Read-only checks on the Pi. ssh -n keeps the answers on this script's stdin out of the remote command.
# shellcheck disable=SC2029 # the paths are validated above; expanding them locally is intended
sudo_state=$(ssh -n "$host" 'if ! sudo -n true 2> /dev/null; then echo nosudo; elif ! command -v docker > /dev/null 2>&1; then echo nodocker; elif ! command -v tar > /dev/null 2>&1; then echo notar; else echo ok; fi') \
  || fail "could not reach the Pi ($host) – nothing was written"
case "$sudo_state" in
  ok) ;;
  nosudo) fail "sudo on the Pi asks for a password or is not allowed for this user – the transfer has no terminal for a prompt. Allow passwordless sudo for the operator user (docs/runbooks/gateway.md). Nothing was written" ;;
  nodocker) fail "docker is not installed on the Pi – nothing was written" ;;
  *) fail "tar is not installed on the Pi – nothing was written" ;;
esac

# shellcheck disable=SC2029 # see above
exists=$(ssh -n "$host" "if sudo -n test -e $remote_dir/secrets/gateway.env; then echo yes; else echo no; fi") \
  || fail "could not check $remote_dir/secrets on the Pi – nothing was written"
existing=""
case "$exists" in
  no) ;;
  yes)
    if [ "$force" != "--force" ]; then
      echo "$remote_dir/secrets already holds a gateway.env on the Pi; rerun with --force to replace it" >&2
      exit 1
    fi
    # The stored values come back through ssh into this variable only; they are never printed.
    # shellcheck disable=SC2016 # the script runs on the Pi
    existing=$(ssh -n "$host" "sudo -n sh -c 'cd \"\$1/secrets\" && for f in gateway.env z2m.env backup.env; do if [ -f \"\$f\" ]; then cat \"\$f\"; echo; fi; done' sh $remote_dir") \
      || fail "could not read the stored settings on the Pi – nothing was written"
    ;;
  *) fail "could not check $remote_dir/secrets on the Pi – nothing was written" ;;
esac

existing_value() { printf '%s\n' "$existing" | sed -n "s/^$1=//p" | head -n 1; }

# Characters that an env file would read differently (comment, expansion, quoting) and blanks.
env_unsafe='[$#"'\''\\`[:space:]]'
host_pattern='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'

# Reads a line into the variable named $1; Enter keeps the stored value of the variable named $2, then the default $5,
# and without any the run stops. $typed tells whether the value was typed (yes) or not. With "secret" as $4 the input is hidden; the value is never printed.
typed=no
ask_or_keep() {
  local var=$1 name=$2 text=$3 mode=${4:-} default=${5:-} value
  if [ "$mode" = secret ]; then
    read -r -s -p "$text" value
    echo >&2
  else
    read -r -p "$text" value
  fi
  typed=yes
  if [ -z "$value" ]; then typed=no; value=$(existing_value "$name"); fi
  if [ -z "$value" ]; then value=$default; fi
  if [ -z "$value" ]; then fail "$name is required – nothing was written"; fi
  if [[ "$value" =~ $env_unsafe ]]; then
    fail "$name must not contain blanks, \$ # quotes, backslashes or backticks – nothing was written"
  fi
  printf -v "$var" '%s' "$value"
}

# The adapter: the only entry of /dev/serial/by-id on the Pi is the default, otherwise it is asked for.
# shellcheck disable=SC2029 # see above
serial_candidates=$(ssh -n "$host" "ls -1 $serial_dir 2> /dev/null || true") || fail "could not list $serial_dir on the Pi – nothing was written"
serial_default=""
if [ -n "$serial_candidates" ] && [ "$(printf '%s\n' "$serial_candidates" | wc -l | tr -d ' ')" = 1 ]; then
  serial_default="$serial_dir/$serial_candidates"
elif [ -n "$serial_candidates" ]; then
  echo "several adapters in $serial_dir:" >&2
  printf '%s\n' "$serial_candidates" | sed "s|^|  $serial_dir/|" >&2
fi

broker_host='' broker_port='' serial_device='' b2_endpoint='' b2_bucket='' b2_key_id='' b2_app_key='' restic_password='' hc_backup='' # set by ask_or_keep
ask_or_keep broker_host BROKER_HOST "Host name of the platform broker, e.g. mqtt.<your-app-domain> (Enter keeps the stored one): "
{ [[ "$broker_host" =~ $host_pattern ]] && [ "${#broker_host}" -le 253 ]; } || fail "BROKER_HOST is not a valid host name – nothing was written"
ask_or_keep broker_port BROKER_PORT "Port of the platform broker (Enter keeps the stored one, default 8883): " "" 8883
{ [[ "$broker_port" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$broker_port))" -ge 1 ] && [ "$((10#$broker_port))" -le 65535 ]; } || fail "BROKER_PORT must be a port number (1-65535) – nothing was written"
broker_port=$((10#$broker_port))
ask_or_keep serial_device Z2M_SERIAL_DEVICE "Zigbee adapter, path of the device on the Pi${serial_default:+ [$serial_default]} (Enter keeps the stored one or the shown one): " "" "$serial_default"
# Only plain path characters (no colon: Compose reads ...:/dev/zigbee as host:container) inside /dev, no "..".
[[ "$serial_device" =~ ^/[A-Za-z0-9._/+@-]+$ ]] && [[ "$serial_device" != *..* ]] || fail "Z2M_SERIAL_DEVICE is not a plain device path – nothing was written"
case "$serial_device" in
  /dev/* | "$serial_dir"/*) ;;
  *) fail "Z2M_SERIAL_DEVICE must be a path below /dev – nothing was written" ;;
esac
# shellcheck disable=SC2029 # see above
present=$(ssh -n "$host" "if test -e $serial_device; then echo yes; else echo no; fi") || fail "could not check $serial_device on the Pi – nothing was written"
[ "$present" = yes ] || fail "$serial_device does not exist on the Pi (adapter not plugged in?) – nothing was written"

ask_or_keep b2_endpoint B2_ENDPOINT "B2 S3 endpoint, host only, e.g. s3.eu-central-003.backblazeb2.com (Enter keeps the stored one): "
[[ "$b2_endpoint" =~ $host_pattern ]] || fail "B2_ENDPOINT must be a host name without https:// – nothing was written"
ask_or_keep b2_bucket B2_BUCKET "B2 bucket for the gateway backups (Enter keeps the stored one): "
[[ "$b2_bucket" =~ ^[A-Za-z0-9-]{6,50}$ ]] || fail "B2_BUCKET is not a bucket name (6-50 letters, digits, hyphens) – nothing was written"
ask_or_keep b2_key_id B2_KEY_ID "B2 keyID of the key smart-pi-restic, 25 characters starting with 00, hidden (Enter keeps the stored one): " secret
# Guard against swapping the two: the rejected value is never echoed, it may be the secret.
[[ "$b2_key_id" =~ ^00[0-9a-f]{23}$ ]] || fail "that is not a B2 keyID (expected 25 hex characters starting with 00) – nothing was written"
ask_or_keep b2_app_key B2_APP_KEY "B2 application key of smart-pi-restic, secret, starts with K (Enter keeps the stored one): " secret
[[ "$b2_app_key" =~ ^K[0-9A-Za-z+/]{30}$ ]] || fail "that is not a B2 application key (expected 31 characters starting with K) – nothing was written"
ask_or_keep restic_password RESTIC_PASSWORD "restic repository password of the Pi backup, from your password manager (Enter keeps the stored one): " secret
if [ "$typed" = yes ]; then
  read -r -s -p "restic repository password again: " restic_again
  echo >&2
  [ "$restic_again" = "$restic_password" ] || fail "the two restic passwords differ – nothing was written"
  unset restic_again
fi
# The ping URL contains a secret token: hidden, and without ? and & (nothing but a plain path).
ask_or_keep hc_backup HC_BACKUP_URL "healthchecks.io ping URL for the nightly Pi backup, hidden (Enter keeps the stored one): " secret
[[ "$hc_backup" =~ ^https://[A-Za-z0-9._~:/=%+-]+$ ]] || fail "HC_BACKUP_URL must be an https:// URL – nothing was written"
hc_restore=$(existing_value HC_RESTORE_URL)
if [ -n "$hc_restore" ] && ! [[ "$hc_restore" =~ ^https://[A-Za-z0-9._~:/=%+-]+$ ]]; then
  echo "warning: the stored HC_RESTORE_URL is not a plain https:// URL (backup.sh would refuse it) and is not kept; add it again by hand" >&2
  hc_restore=""
fi

# The Z2M password and the frontend token are generated (64 hex characters); --force keeps the stored ones.
keep_or_generate() {
  local value
  value=$(existing_value "$1")
  if [ -n "$value" ] && ! [[ "$value" =~ $env_unsafe ]]; then printf '%s' "$value"; else openssl rand -hex 32; fi
}
z2m_user=z2m
z2m_password=$(keep_or_generate ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD)
z2m_token=$(keep_or_generate ZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN)
[ -n "$z2m_password" ] && [ -n "$z2m_token" ] || fail "could not generate the Z2M password and token (openssl?) – nothing was written"

# 3. The files are staged in a private directory that is removed on exit, then sent as one tar stream.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
chmod 700 "$stage"
write_file() { local name=$1; shift; printf '%s\n' "$@" > "$stage/$name"; chmod 600 "$stage/$name"; }
write_file gateway.env "GATEWAY_ID=$gateway_id" "BROKER_HOST=$broker_host" "BROKER_PORT=$broker_port" "Z2M_SERIAL_DEVICE=$serial_device"
write_file z2m.env "ZIGBEE2MQTT_CONFIG_MQTT_USER=$z2m_user" "ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD=$z2m_password" "ZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN=$z2m_token"
backup_lines=("B2_ENDPOINT=$b2_endpoint" "B2_BUCKET=$b2_bucket" "B2_KEY_ID=$b2_key_id" "B2_APP_KEY=$b2_app_key" "RESTIC_PASSWORD=$restic_password" "HC_BACKUP_URL=$hc_backup")
# HC_RESTORE_URL has no prompt: a stored one stays (only a plain https URL, like backup.sh demands; the value is never printed).
if [ -n "$hc_restore" ]; then backup_lines+=("HC_RESTORE_URL=$hc_restore"); fi
write_file backup.env "${backup_lines[@]}"
# Plain text for "mosquitto_passwd -U" on the Pi, which turns the file into a hashed password file in place: the
# password never appears in a command line (mosquitto_passwd -b would put it in argv).
write_file passwd.plain "$z2m_user:$z2m_password"
cp "$src_ca" "$stage/ca.crt"
cp "$src_crt" "$stage/gateway.crt"
cp "$src_key" "$stage/gateway.key"
chmod 600 "$stage/ca.crt" "$stage/gateway.crt" "$stage/gateway.key"
files=(gateway.env z2m.env backup.env passwd.plain ca.crt gateway.crt gateway.key)

# One session as root: unpack into secrets/.new (root only), hash the password file there, set the modes, and only
# after everything succeeded move the files into place. Any failure removes .new and leaves the old files alone.
# $1 is the gateway directory, $2 the mosquitto image. The script contains no single quote: it travels inside them.
# shellcheck disable=SC2016 # the script runs on the Pi: $1, $2 and $PWD expand there
remote_script='set -e
umask 077
d=$1
if [ ! -d "$d" ]; then mkdir -p "$d"; chmod 755 "$d"; fi
mkdir -p "$d/secrets"
chmod 700 "$d/secrets"
chown "$(id -u):$(id -g)" "$d/secrets"
cd "$d/secrets"
rm -rf .new
mkdir .new
trap "rm -rf .new" EXIT
tar -xf - --no-same-owner -C .new '"${files[*]}"'
docker run --rm --network none -v "$PWD/.new:/work" "$2" mosquitto_passwd -U /work/passwd.plain
mv .new/passwd.plain .new/passwd
for f in gateway.env z2m.env backup.env passwd ca.crt gateway.crt gateway.key; do
  [ -s ".new/$f" ] || { echo "provision-gateway: $f is missing or empty after unpacking" >&2; exit 1; }
done
grep -q "^z2m:[$]7[$]" .new/passwd || { echo "provision-gateway: passwd is not a hashed password file" >&2; exit 1; }
chmod 600 .new/*
mv -f .new/gateway.env .new/z2m.env .new/backup.env .new/passwd .new/ca.crt .new/gateway.crt .new/gateway.key .'
# COPYFILE_DISABLE keeps macOS tar from adding ._ metadata entries.
# shellcheck disable=SC2029 # see above
COPYFILE_DISABLE=1 tar -cf - -C "$stage" "${files[@]}" | ssh "$host" "sudo -n sh -c '$remote_script' sh $remote_dir $mosquitto_image" \
  || fail "the transfer failed – the previous files on the Pi are unchanged"

echo "wrote gateway.env, z2m.env, passwd, backup.env, ca.crt, gateway.crt and gateway.key for $gateway_id to $remote_dir/secrets on the Pi (root, directory 700, files 600)"
echo "the Z2M frontend token is not shown here; read it on the Pi: sudo cat $remote_dir/secrets/z2m.env (line ZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN)"
echo "next, from the Mac: SMART_PI=<user@pi-host> pnpm gateway:deploy   (checks, renders, starts and waits for Zigbee2MQTT)"
echo "the first time on a Pi that still runs the old setup: add --migrate (docs/runbooks/gateway.md, section 11); a new Pi with a fresh adapter: --fresh"
