#!/usr/bin/env bash
# Puts the secrets of the Home Assistant gateway onto its Raspberry Pi: /srv/smart-gateway/secrets/ha (root, mode 700,
# files 600). Home Assistant is a second gateway kind with its own gateway ID and certificate, next to the Z2M gateway
# of the same Pi. Run it yourself in a terminal in the home network – secrets never pass through chat or CI.
# Usage: SMART_PI=<user@pi-host> infra/deploy/provision-ha.sh <ha-gateway-id> [--force]
# Needs the certificate of the HA gateway from infra/pki/pki.sh (issue-gateway <ha-gateway-id>) in SMART_PKI_DIR
# (default ~/.smart-pki): gateways/<id>.crt, gateways/<id>.key and ca.crt. The Z2M gateway must be provisioned first
# (provision-gateway.sh): its secrets/gateway.env must exist and must carry a different GATEWAY_ID. The operator user
# on the Pi needs passwordless sudo (sudo -n, no terminal is allocated); the folder gateway/ of the repo belongs in
# /srv/smart-gateway. It writes (docs/runbooks/gateway.md):
#   ha/ha.env       SMART_HA_GATEWAY_ID
#   ha/ca.crt, ha/gateway.crt, ha/gateway.key
# The next "pnpm gateway:deploy" switches the Home Assistant profile on because secrets/ha/ha.env exists.
# An existing secrets/ha is only replaced with --force. Everything travels in ONE ssh session as a tar stream on stdin,
# so no secret appears in a command line or in the output; the files are unpacked into secrets/ha.partial and moved into
# place only after every check passed, so a failed transfer leaves the old files in place.
# SMART_GATEWAY_DIR (default /srv/smart-gateway) and SMART_OPENSSL (an OpenSSL >= 3 binary) exist for tests and macOS.
set -euo pipefail
umask 077

usage() { echo "usage: SMART_PI=<user@pi-host> provision-ha.sh <ha-gateway-id> [--force]" >&2; exit 2; }
fail() { echo "provision-ha.sh: $*" >&2; exit 1; }

gateway_id="${1:-}"
force="${2:-}"
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
[ -z "$force" ] || [ "$force" = "--force" ] || usage
[[ "$gateway_id" =~ ^gw-[a-z0-9]{8}$ ]] || { echo "the gateway ID must match gw-[a-z0-9]{8} (see infra/pki/pki.sh issue-gateway)" >&2; exit 2; }
host="${SMART_PI:?set SMART_PI=<user@pi-host> (see .local/pi.md)}"
pki_dir="${SMART_PKI_DIR:-$HOME/.smart-pki}"
remote_dir="${SMART_GATEWAY_DIR:-/srv/smart-gateway}"
[[ "$remote_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "SMART_GATEWAY_DIR is not a plain absolute path"

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

# OpenSSL >= 3 like pki.sh (macOS ships LibreSSL).
openssl_bin=""
for candidate in "${SMART_OPENSSL:-openssl}" /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
  if command -v "$candidate" > /dev/null 2>&1 && "$candidate" version 2> /dev/null | grep -Eq '^OpenSSL [3-9]'; then
    openssl_bin=$(command -v "$candidate")
    break
  fi
done
[ -n "$openssl_bin" ] || fail "OpenSSL 3 or newer is required (brew install openssl@3, or set SMART_OPENSSL=/path/to/openssl)"

# The certificate is the one of this gateway, signed by the CA, and the key belongs to it. Nothing here prints a key.
subject=$("$openssl_bin" x509 -in "$src_crt" -noout -subject -nameopt RFC2253 2> /dev/null | sed -n 's/^subject=//p') || true
[ "$subject" = "CN=$gateway_id" ] || fail "the CN of $src_crt is not $gateway_id – wrong certificate; nothing was sent"
"$openssl_bin" verify -CAfile "$src_ca" "$src_crt" > /dev/null 2>&1 || fail "$src_crt is not signed by $src_ca – nothing was sent"
cert_pub=$("$openssl_bin" x509 -in "$src_crt" -noout -pubkey 2> /dev/null) || true
key_pub=$("$openssl_bin" pkey -in "$src_key" -pubout 2> /dev/null) || true
{ [ -n "$cert_pub" ] && [ "$cert_pub" = "$key_pub" ]; } || fail "the key of $gateway_id does not match its certificate – nothing was sent"

# 2. Read-only checks on the Pi. ssh -n keeps this script's stdin out of the remote command.
# shellcheck disable=SC2029 # the paths are validated above; expanding them locally is intended
sudo_state=$(ssh -n "$host" 'if ! sudo -n true 2> /dev/null; then echo nosudo; elif ! command -v tar > /dev/null 2>&1; then echo notar; else echo ok; fi') \
  || fail "could not reach the Pi ($host) – nothing was written"
case "$sudo_state" in
  ok) ;;
  nosudo) fail "sudo on the Pi asks for a password or is not allowed for this user – the transfer has no terminal for a prompt. Allow passwordless sudo for the operator user (docs/runbooks/gateway.md). Nothing was written" ;;
  *) fail "tar is not installed on the Pi – nothing was written" ;;
esac

# The Z2M gateway comes first, and the two gateways must not share an ID (one MQTT identity each). The file is read
# line by line on the Pi and never sourced.
# shellcheck disable=SC2029 # see above
z2m_state=$(ssh -n "$host" "if sudo -n test -f $remote_dir/secrets/gateway.env; then echo present; else echo missing; fi") \
  || fail "could not check $remote_dir/secrets on the Pi – nothing was written"
[ "$z2m_state" = present ] || fail "$remote_dir/secrets/gateway.env does not exist on the Pi – provision the Z2M gateway first (infra/deploy/provision-gateway.sh). Nothing was written"
# shellcheck disable=SC2029 # see above
z2m_id=$(ssh -n "$host" "sudo -n sed -n 's/^GATEWAY_ID=//p' $remote_dir/secrets/gateway.env | head -n 1") \
  || fail "could not read gateway.env on the Pi – nothing was written"
[[ "$z2m_id" =~ ^gw-[a-z0-9]{8}$ ]] || fail "gateway.env on the Pi holds no valid GATEWAY_ID – nothing was written"
[ "$z2m_id" != "$gateway_id" ] || fail "the HA gateway needs an ID different from the Z2M gateway ($z2m_id): run infra/pki/pki.sh issue-gateway for a new ID. Nothing was written"

# shellcheck disable=SC2029 # see above
exists=$(ssh -n "$host" "if sudo -n test -e $remote_dir/secrets/ha; then echo yes; else echo no; fi") \
  || fail "could not check $remote_dir/secrets/ha on the Pi – nothing was written"
case "$exists" in
  no) ;;
  yes)
    if [ "$force" != "--force" ]; then
      echo "$remote_dir/secrets/ha already exists on the Pi; rerun with --force to replace it" >&2
      exit 1
    fi
    ;;
  *) fail "could not check $remote_dir/secrets/ha on the Pi – nothing was written" ;;
esac

# 3. The files are staged in a private directory that is removed on exit, then sent as one tar stream.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
chmod 700 "$stage"
printf 'SMART_HA_GATEWAY_ID=%s\n' "$gateway_id" > "$stage/ha.env"
cp "$src_ca" "$stage/ca.crt"
cp "$src_crt" "$stage/gateway.crt"
cp "$src_key" "$stage/gateway.key"
chmod 600 "$stage/ha.env" "$stage/ca.crt" "$stage/gateway.crt" "$stage/gateway.key"
files=(ha.env ca.crt gateway.crt gateway.key)

# One session as root: unpack into secrets/ha.partial (root only), check, set the modes, and only then move it into
# place (the old secrets/ha is kept as ha.old until the move worked and restored if it did not). Any failure removes
# ha.partial and leaves the old files alone. $1 is the gateway directory. The script contains no single quote.
# shellcheck disable=SC2016 # the script runs on the Pi: $1 expands there
remote_script='set -e
umask 077
d=$1
[ -d "$d/secrets" ] || { echo "provision-ha: $d/secrets does not exist" >&2; exit 1; }
cd "$d/secrets"
rm -rf ha.partial
mkdir ha.partial
trap "rm -rf ha.partial" EXIT
tar -xf - --no-same-owner -C ha.partial '"${files[*]}"'
for f in ha.env ca.crt gateway.crt gateway.key; do
  [ -s "ha.partial/$f" ] || { echo "provision-ha: $f is missing or empty after unpacking" >&2; exit 1; }
done
grep -qx "SMART_HA_GATEWAY_ID=gw-[a-z0-9]*" ha.partial/ha.env || { echo "provision-ha: ha.env is malformed" >&2; exit 1; }
chmod 700 ha.partial
chmod 600 ha.partial/*
rm -rf ha.old
if [ -e ha ]; then
  mv ha ha.old
  mv ha.partial ha || { mv ha.old ha; exit 1; }
  rm -rf ha.old
else
  mv ha.partial ha
fi'
# COPYFILE_DISABLE keeps macOS tar from adding ._ metadata entries; --no-xattrs drops extended attributes such as
# com.apple.provenance, which GNU tar on the Pi would warn about ("unknown extended header keyword").
# shellcheck disable=SC2029 # see above
COPYFILE_DISABLE=1 tar --no-xattrs -cf - -C "$stage" "${files[@]}" | ssh "$host" "sudo -n sh -c '$remote_script' sh $remote_dir" \
  || fail "the transfer failed – the previous files on the Pi are unchanged"

echo "wrote ha.env, ca.crt, gateway.crt and gateway.key for $gateway_id to $remote_dir/secrets/ha on the Pi (root, directory 700, files 600)"
echo "next, from the Mac: SMART_PI=<user@pi-host> pnpm gateway:deploy   (the Home Assistant profile starts because secrets/ha/ha.env exists)"
