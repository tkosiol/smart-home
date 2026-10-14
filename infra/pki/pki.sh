#!/usr/bin/env bash
# Gateway PKI: a private CA, the broker's server certificate and one client certificate per gateway.
# Run it yourself in a terminal; the CA key never leaves your machine and is protected by a passphrase.
# Usage: pki.sh init-ca
#        pki.sh issue-server <host>
#        pki.sh issue-gateway [<id>]
#        pki.sh revoke <id>
#        pki.sh crl
#        pki.sh status
# SMART_PKI_DIR           state directory (default ~/.smart-pki, mode 700, files mode 600)
# SMART_PKI_PASSPHRASE_FILE  read the CA key passphrase from this file instead of prompting (tests, stack test)
# SMART_OPENSSL           path of an OpenSSL >= 3 binary (macOS ships LibreSSL; use e.g. Homebrew openssl@3)
set -euo pipefail
umask 077

# Gateway IDs are the certificate CN and the broker user name (use_identity_as_username):
# only this shape may be issued, so no certificate can ever act as smart-api or smart-simulator.
GATEWAY_ID_RE='^gw-[a-z0-9]{8}$'
new_gateway_id() {
  local id
  id="gw-$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 8 || true)"
  printf '%s' "$id"
}

HOST_RE='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
CA_DAYS=3650
LEAF_DAYS=730
CRL_DAYS=365

usage() {
  cat >&2 << 'USAGE'
usage: pki.sh init-ca
       pki.sh issue-server <host>
       pki.sh issue-gateway [<id>]
       pki.sh revoke <id>
       pki.sh crl
       pki.sh status
USAGE
  exit 2
}

die() {
  echo "pki.sh: $*" >&2
  exit 1
}

find_openssl() {
  local candidate
  if [ -n "${SMART_OPENSSL:-}" ]; then
    candidates=("$SMART_OPENSSL")
  else
    candidates=(openssl /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl)
  fi
  for candidate in "${candidates[@]}"; do
    if command -v "$candidate" > /dev/null 2>&1 \
      && "$candidate" version 2> /dev/null | grep -Eq '^OpenSSL [3-9]'; then
      command -v "$candidate"
      return 0
    fi
  done
  die "OpenSSL 3 or newer is required (LibreSSL, the macOS default, does not work). Install it (brew install openssl@3) or set SMART_OPENSSL=/path/to/openssl"
}

command_name="${1:-}"
[ -n "$command_name" ] || usage

PKI_DIR="${SMART_PKI_DIR:-$HOME/.smart-pki}"
case "$PKI_DIR" in
  /*) ;;
  *) PKI_DIR="$PWD/$PKI_DIR" ;;
esac
if [[ "$PKI_DIR" == *[\$\#\"\\]* ]]; then
  die "SMART_PKI_DIR must not contain \$ # quotes or backslashes"
fi

OPENSSL=$(find_openssl)
mkdir -p "$PKI_DIR"
chmod 700 "$PKI_DIR"
WORK=$(mktemp -d "$PKI_DIR/tmp.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

CONF="$WORK/openssl.cnf"
cat > "$CONF" << CONFIG
[ ca ]
default_ca = smart_ca

[ smart_ca ]
database = $PKI_DIR/index.txt
serial = $PKI_DIR/serial
crlnumber = $PKI_DIR/crlnumber
new_certs_dir = $PKI_DIR/newcerts
certificate = $PKI_DIR/ca.crt
private_key = $PKI_DIR/ca.key
default_md = sha256
default_crl_days = $CRL_DAYS
unique_subject = no
policy = policy_any
copy_extensions = none

[ policy_any ]
commonName = supplied

[ req ]
distinguished_name = req_dn
prompt = no

[ req_dn ]
CN = placeholder

[ v3_ca ]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
CONFIG

# --- helpers ---

# Reads the CA key passphrase once (file or hidden prompt) into SMART_PKI_PW, which openssl reads
# through -passin env: – the passphrase never appears in a command line.
read_passphrase() {
  local confirm="${1:-}" again
  if [ -n "${SMART_PKI_PASSPHRASE_FILE:-}" ]; then
    [ -r "$SMART_PKI_PASSPHRASE_FILE" ] || die "cannot read SMART_PKI_PASSPHRASE_FILE"
    SMART_PKI_PW=$(head -n 1 "$SMART_PKI_PASSPHRASE_FILE")
  else
    [ -t 0 ] || die "no terminal to ask for the CA key passphrase (set SMART_PKI_PASSPHRASE_FILE)"
    read -r -s -p "CA key passphrase: " SMART_PKI_PW
    echo
    if [ "$confirm" = confirm ]; then
      read -r -s -p "Repeat the passphrase: " again
      echo
      [ "$SMART_PKI_PW" = "$again" ] || die "the passphrases differ – nothing was written"
    fi
  fi
  [ "${#SMART_PKI_PW}" -ge 8 ] || die "the CA key passphrase must have at least 8 characters"
  export SMART_PKI_PW
}

require_ca() {
  [ -f "$PKI_DIR/ca.crt" ] && [ -f "$PKI_DIR/ca.key" ] || die "no CA in $PKI_DIR – run init-ca first"
}

valid_gateway_id() { [[ "$1" =~ $GATEWAY_ID_RE ]]; }

# nextUpdate of the CRL as ISO 8601 UTC. Parsed by hand: BSD and GNU date disagree on options.
write_next_update() {
  local line mon day time year month
  line=$("$OPENSSL" crl -in "$PKI_DIR/crl.pem" -noout -nextupdate)
  read -r mon day time year _ <<< "${line#nextUpdate=}"
  case "$mon" in
    Jan) month=01 ;; Feb) month=02 ;; Mar) month=03 ;; Apr) month=04 ;; May) month=05 ;; Jun) month=06 ;;
    Jul) month=07 ;; Aug) month=08 ;; Sep) month=09 ;; Oct) month=10 ;; Nov) month=11 ;; Dec) month=12 ;;
    *) die "cannot read the CRL's nextUpdate" ;;
  esac
  printf '%s-%s-%02dT%sZ\n' "$year" "$month" "$((10#$day))" "$time" > "$PKI_DIR/crl-next-update"
}

generate_crl() {
  "$OPENSSL" ca -config "$CONF" -gencrl -crldays "$CRL_DAYS" -passin env:SMART_PKI_PW -out "$PKI_DIR/crl.pem" 2> /dev/null
  write_next_update
}

# Signs the CSR $1 into the certificate $2 with the extensions in the file $3 (no section header).
sign() {
  "$OPENSSL" ca -config "$CONF" -batch -notext -days "$LEAF_DAYS" -md sha256 \
    -in "$1" -out "$2" -extfile "$3" -passin env:SMART_PKI_PW 2> "$WORK/ca.log" \
    || { cat "$WORK/ca.log" >&2; die "signing failed"; }
}

new_key() {
  "$OPENSSL" genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -pkeyopt ec_param_enc:named_curve -out "$1"
}

cert_end() { "$OPENSSL" x509 -in "$1" -noout -enddate | sed 's/^notAfter=//'; }

# --- commands ---

init_ca() {
  if [ -e "$PKI_DIR/ca.crt" ] || [ -e "$PKI_DIR/ca.key" ] || [ -e "$PKI_DIR/index.txt" ]; then
    die "a CA already exists in $PKI_DIR – refusing to overwrite it"
  fi
  read_passphrase confirm
  mkdir -p "$PKI_DIR/newcerts" "$PKI_DIR/gateways"
  chmod 700 "$PKI_DIR/newcerts" "$PKI_DIR/gateways"
  : > "$PKI_DIR/index.txt"
  printf '00%s\n' "$("$OPENSSL" rand -hex 8)" > "$PKI_DIR/serial"
  echo 01 > "$PKI_DIR/crlnumber"
  new_key "$WORK/ca-plain.key"
  "$OPENSSL" pkcs8 -topk8 -v2 aes-256-cbc -in "$WORK/ca-plain.key" -out "$PKI_DIR/ca.key" -passout env:SMART_PKI_PW
  "$OPENSSL" req -new -x509 -config "$CONF" -key "$PKI_DIR/ca.key" -passin env:SMART_PKI_PW \
    -subj "/CN=Smart Home Gateway CA" -days "$CA_DAYS" -sha256 -extensions v3_ca -out "$PKI_DIR/ca.crt"
  generate_crl
  echo "created the CA in $PKI_DIR (valid until $(cert_end "$PKI_DIR/ca.crt"))"
  echo "keep ca.key and its passphrase safe (password manager, backup); it is never copied to the VPS"
}

issue_server() {
  local host="${1:-}"
  [ -n "$host" ] || usage
  [[ "$host" =~ $HOST_RE ]] || die "'$host' is not a valid host name"
  require_ca
  if [ -e "$PKI_DIR/server.crt" ] || [ -e "$PKI_DIR/server.key" ]; then
    die "a server certificate already exists – remove server.crt and server.key to issue a new one"
  fi
  read_passphrase
  new_key "$WORK/server.key"
  "$OPENSSL" req -new -config "$CONF" -key "$WORK/server.key" -subj "/CN=$host" -out "$WORK/server.csr"
  cat > "$WORK/server.ext" << EXT
basicConstraints = CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:$host
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EXT
  sign "$WORK/server.csr" "$WORK/server.crt" "$WORK/server.ext"
  mv "$WORK/server.key" "$PKI_DIR/server.key"
  mv "$WORK/server.crt" "$PKI_DIR/server.crt"
  echo "issued the server certificate for $host (valid until $(cert_end "$PKI_DIR/server.crt"))"
}

issue_gateway() {
  local id="${1:-}"
  require_ca
  if [ -z "$id" ]; then
    id=$(new_gateway_id)
  fi
  valid_gateway_id "$id" || die "'$id' is not a valid gateway ID (expected gw- followed by 8 characters a-z0-9)"
  if [ -e "$PKI_DIR/gateways/$id.crt" ] || [ -e "$PKI_DIR/gateways/$id.key" ]; then
    die "gateway $id already exists"
  fi
  read_passphrase
  mkdir -p "$PKI_DIR/gateways"
  chmod 700 "$PKI_DIR/gateways"
  new_key "$WORK/gateway.key"
  "$OPENSSL" req -new -config "$CONF" -key "$WORK/gateway.key" -subj "/CN=$id" -out "$WORK/gateway.csr"
  cat > "$WORK/gateway.ext" << 'EXT'
basicConstraints = CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EXT
  sign "$WORK/gateway.csr" "$WORK/gateway.crt" "$WORK/gateway.ext"
  mv "$WORK/gateway.key" "$PKI_DIR/gateways/$id.key"
  mv "$WORK/gateway.crt" "$PKI_DIR/gateways/$id.crt"
  echo "issued the gateway certificate $id (valid until $(cert_end "$PKI_DIR/gateways/$id.crt"))"
  echo "files: $PKI_DIR/gateways/$id.crt and $id.key (the key goes only onto that gateway)"
}

revoke() {
  local id="${1:-}" serial
  [ -n "$id" ] || usage
  valid_gateway_id "$id" || die "'$id' is not a valid gateway ID"
  require_ca
  [ -f "$PKI_DIR/gateways/$id.crt" ] || die "no certificate for $id in $PKI_DIR/gateways"
  serial=$("$OPENSSL" x509 -in "$PKI_DIR/gateways/$id.crt" -noout -serial | sed 's/^serial=//')
  read_passphrase
  if grep -q "^R.*[[:space:]]${serial}[[:space:]]" "$PKI_DIR/index.txt"; then
    echo "$id is already revoked; regenerating the CRL"
  else
    "$OPENSSL" ca -config "$CONF" -revoke "$PKI_DIR/gateways/$id.crt" -passin env:SMART_PKI_PW 2> "$WORK/ca.log" \
      || { cat "$WORK/ca.log" >&2; die "revoking failed"; }
    echo "revoked $id (serial $serial)"
  fi
  generate_crl
  echo "new CRL written; copy it to the VPS with infra/deploy/broker-certs.sh"
}

crl() {
  require_ca
  read_passphrase
  generate_crl
  echo "new CRL written (next update $(cat "$PKI_DIR/crl-next-update"))"
}

status() {
  local cert id state
  require_ca
  echo "CA: valid until $(cert_end "$PKI_DIR/ca.crt")"
  if [ -f "$PKI_DIR/server.crt" ]; then
    echo "server: valid until $(cert_end "$PKI_DIR/server.crt")"
  else
    echo "server: no certificate yet"
  fi
  for cert in "$PKI_DIR"/gateways/*.crt; do
    [ -e "$cert" ] || continue
    id=$(basename "$cert" .crt)
    state=valid
    if grep -q "^R.*[[:space:]]$("$OPENSSL" x509 -in "$cert" -noout -serial | sed 's/^serial=//')[[:space:]]" "$PKI_DIR/index.txt"; then
      state=revoked
    fi
    echo "gateway $id: $state, valid until $(cert_end "$cert")"
  done
  echo "CRL: next update $(cat "$PKI_DIR/crl-next-update" 2> /dev/null || echo unknown)"
}

case "$command_name" in
  init-ca) [ "$#" -eq 1 ] || usage; init_ca ;;
  issue-server) [ "$#" -eq 2 ] || usage; issue_server "$2" ;;
  issue-gateway) [ "$#" -le 2 ] || usage; issue_gateway "${2:-}" ;;
  revoke) [ "$#" -eq 2 ] || usage; revoke "$2" ;;
  crl) [ "$#" -eq 1 ] || usage; crl ;;
  status) [ "$#" -eq 1 ] || usage; status ;;
  *) usage ;;
esac
