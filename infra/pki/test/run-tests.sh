#!/usr/bin/env bash
# Tests for pki.sh. Everything is generated at runtime into a temporary SMART_PKI_DIR; no key material is committed.
# shellcheck disable=SC2016 # check() expressions are evaluated later on purpose
set -u
cd "$(dirname "$0")/.." || exit 1
PKI_SH="$(pwd)/pki.sh"
failures=0
passed=0

# The same OpenSSL pki.sh will pick (macOS ships LibreSSL as /usr/bin/openssl).
OSSL=""
for candidate in "${SMART_OPENSSL:-openssl}" /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
  if command -v "$candidate" > /dev/null 2>&1 && "$candidate" version | grep -Eq '^OpenSSL [3-9]'; then
    OSSL=$(command -v "$candidate")
    break
  fi
done
[ -n "$OSSL" ] || { echo "pki tests need OpenSSL 3 or newer (set SMART_OPENSSL)" >&2; exit 1; }
export SMART_OPENSSL="$OSSL"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export SMART_PKI_DIR="$WORK/pki"
export SMART_PKI_PASSPHRASE_FILE="$WORK/passphrase"
printf 'correct horse battery staple\n' > "$SMART_PKI_PASSPHRASE_FILE"

check() {
  if eval "$2"; then passed=$((passed + 1)); else echo "FAIL: $1"; failures=$((failures + 1)); fi
}
pki() { bash "$PKI_SH" "$@" < /dev/null; }
quiet() { "$@" > /dev/null 2>&1; }
mode_of() { stat -c %a "$1" 2> /dev/null || stat -f %Lp "$1"; }
epoch() { date -u -d "$1" +%s 2> /dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s; }
cn_of() { "$OSSL" x509 -in "$1" -noout -subject -nameopt RFC2253 | sed 's/^subject=CN=//'; }
gateway_count() { find "$SMART_PKI_DIR/gateways" -type f | wc -l | tr -d ' '; }

# --- init-ca ---
check "init-ca creates the CA" 'quiet pki init-ca && [ -f "$SMART_PKI_DIR/ca.crt" ] && [ -f "$SMART_PKI_DIR/ca.key" ] && [ -f "$SMART_PKI_DIR/crl.pem" ]'
# shellcheck disable=SC2034 # used by the check() expressions below
CA_KEY_SUM=$(cksum < "$SMART_PKI_DIR/ca.key")
check "init-ca refuses a second run" '! quiet pki init-ca'
check "init-ca leaves the existing CA key untouched" '[ "$(cksum < "$SMART_PKI_DIR/ca.key")" = "$CA_KEY_SUM" ]'
check "the CA key is encrypted" 'head -n 1 "$SMART_PKI_DIR/ca.key" | grep -q ENCRYPTED && ! "$OSSL" pkey -in "$SMART_PKI_DIR/ca.key" -passin pass:wrong-passphrase -noout > /dev/null 2>&1'
check "the CA is a P-256 CA with the CA constraints" 'ca_text=$("$OSSL" x509 -in "$SMART_PKI_DIR/ca.crt" -noout -text) && echo "$ca_text" | grep -q "prime256v1" && echo "$ca_text" | grep -q "CA:TRUE" && echo "$ca_text" | grep -q "Certificate Sign" && echo "$ca_text" | grep -q "CRL Sign" && echo "$ca_text" | grep -q "ecdsa-with-SHA256"'
check "the CA is valid for about 10 years" 'quiet "$OSSL" x509 -in "$SMART_PKI_DIR/ca.crt" -noout -checkend $((3600 * 24 * 3640)) && ! quiet "$OSSL" x509 -in "$SMART_PKI_DIR/ca.crt" -noout -checkend $((3600 * 24 * 3660))'
check "init-ca needs a passphrase" 'rm -rf "$WORK/nopass" && ! SMART_PKI_DIR="$WORK/nopass" SMART_PKI_PASSPHRASE_FILE= bash "$PKI_SH" init-ca < /dev/null > /dev/null 2>&1'
check "init-ca rejects a short passphrase" 'printf "short\n" > "$WORK/short" && rm -rf "$WORK/shortpki" && ! SMART_PKI_DIR="$WORK/shortpki" SMART_PKI_PASSPHRASE_FILE="$WORK/short" bash "$PKI_SH" init-ca < /dev/null > /dev/null 2>&1 && [ ! -e "$WORK/shortpki/ca.key" ]'

# --- issue-server ---
check "issue-server issues a certificate" 'quiet pki issue-server broker.example.org && [ -f "$SMART_PKI_DIR/server.crt" ] && [ -f "$SMART_PKI_DIR/server.key" ]'
check "the server certificate has the SAN and serverAuth" 'server_text=$("$OSSL" x509 -in "$SMART_PKI_DIR/server.crt" -noout -text) && echo "$server_text" | grep -q "DNS:broker.example.org" && echo "$server_text" | grep -q "TLS Web Server Authentication" && ! echo "$server_text" | grep -q "TLS Web Client Authentication"'
check "the server certificate verifies against the CA" 'quiet "$OSSL" verify -CAfile "$SMART_PKI_DIR/ca.crt" -purpose sslserver "$SMART_PKI_DIR/server.crt"'
check "the server certificate is not a CA" '"$OSSL" x509 -in "$SMART_PKI_DIR/server.crt" -noout -text | grep -q "CA:FALSE"'
check "issue-server refuses an invalid host name" '! quiet pki issue-server "a b" && ! quiet pki issue-server "x;y" && ! quiet pki issue-server "../x"'
check "issue-server does not replace an existing certificate" 'sum=$(cksum < "$SMART_PKI_DIR/server.key") && ! quiet pki issue-server other.example.org && [ "$(cksum < "$SMART_PKI_DIR/server.key")" = "$sum" ]'

# --- issue-gateway ---
check "issue-gateway without an ID generates a matching one" 'quiet pki issue-gateway && [ "$(gateway_count)" = 2 ] && for crt in "$SMART_PKI_DIR"/gateways/*.crt; do cn_of "$crt" | grep -Eq "^gw-[a-z0-9]{8}$" && [ "$(basename "$crt" .crt)" = "$(cn_of "$crt")" ] || exit 1; done'
check "issue-gateway issues a given valid ID" 'quiet pki issue-gateway gw-abcd1234 && [ "$(cn_of "$SMART_PKI_DIR/gateways/gw-abcd1234.crt")" = gw-abcd1234 ]'
# shellcheck disable=SC2034 # used by the check() expressions below
BEFORE=$(gateway_count)
for bad in smart-api smart-simulator gw-ABCDEFGH ../x gw-abc gw-abcdefghi "gw-abcd123/" "gw-abcd1234 x"; do
  check "issue-gateway refuses '$bad' and writes no file" '! quiet pki issue-gateway "$bad" && [ "$(gateway_count)" = "$BEFORE" ] && [ ! -e "$WORK/x.crt" ]'
done
check "issue-gateway refuses an existing ID" '! quiet pki issue-gateway gw-abcd1234'
check "the gateway certificate verifies against the CA" 'quiet "$OSSL" verify -CAfile "$SMART_PKI_DIR/ca.crt" -purpose sslclient "$SMART_PKI_DIR/gateways/gw-abcd1234.crt"'
check "the gateway certificate has clientAuth only" 'gw_text=$("$OSSL" x509 -in "$SMART_PKI_DIR/gateways/gw-abcd1234.crt" -noout -text) && echo "$gw_text" | grep -q "TLS Web Client Authentication" && ! echo "$gw_text" | grep -q "TLS Web Server Authentication" && echo "$gw_text" | grep -q "CA:FALSE"'
check "the gateway certificate is valid for about 2 years" 'quiet "$OSSL" x509 -in "$SMART_PKI_DIR/gateways/gw-abcd1234.crt" -noout -checkend $((3600 * 24 * 720)) && ! quiet "$OSSL" x509 -in "$SMART_PKI_DIR/gateways/gw-abcd1234.crt" -noout -checkend $((3600 * 24 * 740))'
check "the gateway key matches its certificate" '[ "$("$OSSL" x509 -in "$SMART_PKI_DIR/gateways/gw-abcd1234.crt" -noout -pubkey)" = "$("$OSSL" pkey -in "$SMART_PKI_DIR/gateways/gw-abcd1234.key" -pubout)" ]'

# --- CRL and revocation ---
check "a valid gateway passes the CRL check" 'quiet "$OSSL" verify -CAfile "$SMART_PKI_DIR/ca.crt" -crl_check -CRLfile "$SMART_PKI_DIR/crl.pem" -purpose sslclient "$SMART_PKI_DIR/gateways/gw-abcd1234.crt"'
check "revoke rejects an invalid or unknown ID" '! quiet pki revoke smart-api && ! quiet pki revoke gw-zzzzzzzz'
check "revoke succeeds" 'quiet pki revoke gw-abcd1234'
check "the CRL lists the serial of the revoked gateway" 'serial=$("$OSSL" x509 -in "$SMART_PKI_DIR/gateways/gw-abcd1234.crt" -noout -serial | sed "s/^serial=//") && "$OSSL" crl -in "$SMART_PKI_DIR/crl.pem" -noout -text | grep -q "Serial Number: $serial"'
check "the CRL check rejects the revoked gateway" '! quiet "$OSSL" verify -CAfile "$SMART_PKI_DIR/ca.crt" -crl_check -CRLfile "$SMART_PKI_DIR/crl.pem" -purpose sslclient "$SMART_PKI_DIR/gateways/gw-abcd1234.crt"'
check "the CRL check still accepts other gateways" 'other=$(find "$SMART_PKI_DIR/gateways" -name "gw-*.crt" ! -name gw-abcd1234.crt | head -n 1) && quiet "$OSSL" verify -CAfile "$SMART_PKI_DIR/ca.crt" -crl_check -CRLfile "$SMART_PKI_DIR/crl.pem" -purpose sslclient "$other"'
check "the CRL is signed by the CA" '"$OSSL" crl -in "$SMART_PKI_DIR/crl.pem" -CAfile "$SMART_PKI_DIR/ca.crt" -noout 2>&1 | grep -qi "verify OK"'
check "revoke twice does not fail and keeps the CRL" 'quiet pki revoke gw-abcd1234 && "$OSSL" crl -in "$SMART_PKI_DIR/crl.pem" -noout -text | grep -c "Serial Number" | grep -qx 1'
check "crl regenerates the CRL" 'quiet pki crl && "$OSSL" crl -in "$SMART_PKI_DIR/crl.pem" -noout -text | grep -q "Serial Number"'
check "crl-next-update is ISO 8601 UTC" 'grep -Eq "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$" "$SMART_PKI_DIR/crl-next-update"'
check "crl-next-update is about 365 days ahead" 'diff=$(( $(epoch "$(cat "$SMART_PKI_DIR/crl-next-update")") - $(date +%s) )) && [ "$diff" -gt $((3600 * 24 * 364)) ] && [ "$diff" -lt $((3600 * 24 * 366)) ]'

# --- status ---
check "status lists the expiry dates" 'out=$(pki status) && echo "$out" | grep -Eq "^CA: valid until .* 20[0-9]{2} GMT" && echo "$out" | grep -Eq "^server: valid until" && echo "$out" | grep -Eq "^gateway gw-abcd1234: revoked, valid until" && echo "$out" | grep -Eq "^gateway gw-[a-z0-9]{8}: valid, valid until" && echo "$out" | grep -q "^CRL: next update 20"'

# --- permissions ---
check "the PKI directory has mode 700 and all files 600" '[ "$(mode_of "$SMART_PKI_DIR")" = 700 ] && [ -z "$(find "$SMART_PKI_DIR" -type d ! -perm 700)" ] && [ -z "$(find "$SMART_PKI_DIR" -type f ! -perm 600)" ]'
check "no temporary files are left behind" '[ -z "$(find "$SMART_PKI_DIR" -name "tmp.*")" ]'
check "a new PKI directory is created with mode 700 even under a lax umask" 'rm -rf "$WORK/lax" && (umask 000 && SMART_PKI_DIR="$WORK/lax" bash "$PKI_SH" init-ca < /dev/null > /dev/null 2>&1) && [ "$(mode_of "$WORK/lax")" = 700 ] && [ -z "$(find "$WORK/lax" -type f ! -perm 600)" ]'

# --- environment ---
printf '#!/bin/sh\necho "LibreSSL 3.3.6"\n' > "$WORK/fake-libressl"
chmod +x "$WORK/fake-libressl"
check "an OpenSSL that is not OpenSSL 3 is refused with a hint" 'msg=$(SMART_OPENSSL="$WORK/fake-libressl" SMART_PKI_DIR="$WORK/other" bash "$PKI_SH" status < /dev/null 2>&1); [ $? -ne 0 ] && echo "$msg" | grep -q "OpenSSL 3" && echo "$msg" | grep -q SMART_OPENSSL'
check "an unknown command prints the usage" '[ "$(bash "$PKI_SH" frobnicate < /dev/null > /dev/null 2>&1; echo $?)" = 2 ]'
check "commands that need the CA fail without one" 'rm -rf "$WORK/empty" && ! SMART_PKI_DIR="$WORK/empty" quiet bash "$PKI_SH" issue-gateway < /dev/null'
check "without a passphrase file and a terminal signing is refused" '! SMART_PKI_PASSPHRASE_FILE= quiet bash "$PKI_SH" issue-gateway < /dev/null && [ "$(gateway_count)" = "$BEFORE" ]'
check "a wrong passphrase cannot issue a certificate" 'printf "another wrong passphrase\n" > "$WORK/wrong" && ! SMART_PKI_PASSPHRASE_FILE="$WORK/wrong" quiet bash "$PKI_SH" issue-gateway gw-wrong123 < /dev/null && [ ! -e "$SMART_PKI_DIR/gateways/gw-wrong123.crt" ]'
check "the passphrase never appears in the output" '! { pki status; pki crl; } 2>&1 | grep -q "correct horse"'

echo "pki tests: $passed passed, $failures failed"
[ "$failures" -eq 0 ]
