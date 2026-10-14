#!/usr/bin/env bash
# Copies the broker's TLS material from the local PKI directory (infra/pki/pki.sh) into the stack on the VPS,
# switches the stack's .env to MQTT_TLS=on and recreates the broker. Run it yourself in a terminal.
# Usage: SMART_VPS=<user@host> infra/deploy/broker-certs.sh <staging|production>
# Reads ca.crt, server.crt, server.key, crl.pem and crl-next-update from SMART_PKI_DIR (default ~/.smart-pki).
# Re-run it after every revocation (pki.sh revoke) and before the certificates expire.
# Every file travels on stdin of ssh, so no key content appears in a command line or in the output.
set -euo pipefail

environment="${1:-}"
case "$environment" in
  staging) stack=smart-staging ;;
  production) stack=smart-prod ;;
  *) echo "usage: SMART_VPS=<user@host> broker-certs.sh <staging|production>" >&2; exit 2 ;;
esac
host="${SMART_VPS:?set SMART_VPS=<user@host> (see .local/server.md)}"
pki_dir="${SMART_PKI_DIR:-$HOME/.smart-pki}"
remote_dir="docker/apps/$stack"

# name:mode on the VPS. The directory is world-searchable so the api container (user node) can read the
# public files; server.key stays 600 and is read only by the broker entrypoint, which runs as root.
files=(ca.crt:644 server.crt:644 server.key:600 crl.pem:644 crl-next-update:644)
for entry in "${files[@]}"; do
  if [ ! -s "$pki_dir/${entry%%:*}" ]; then
    echo "missing ${entry%%:*} in $pki_dir – run infra/pki/pki.sh init-ca, issue-server and crl first" >&2
    exit 1
  fi
done

# shellcheck disable=SC2029 # remote_dir is a fixed path chosen above; expanding it locally is intended
exists=$(ssh -n "$host" "test -f $remote_dir/.env && echo yes || echo no")
if [ "$exists" != yes ]; then
  echo "$remote_dir/.env does not exist on the VPS – run provision.sh first" >&2
  exit 1
fi

for entry in "${files[@]}"; do
  name=${entry%%:*}
  mode=${entry##*:}
  # shellcheck disable=SC2029 # see above
  ssh "$host" "umask 077 && cd $remote_dir && mkdir -p certs && chmod 755 certs && cat > certs/$name.new && chmod $mode certs/$name.new && mv certs/$name.new certs/$name" < "$pki_dir/$name"
  echo "copied $name to $remote_dir/certs (mode $mode)"
done

# MQTT_TLS is the only line this script changes in the .env.
# shellcheck disable=SC2029 # see above
ssh -n "$host" "cd $remote_dir && umask 077 && { grep -v '^MQTT_TLS=' .env || true; echo MQTT_TLS=on; } > .env.new && chmod 600 .env.new && mv .env.new .env"
echo "set MQTT_TLS=on in $remote_dir/.env"

# The recreate picks up both the new .env and the new files; the running release is compose.yaml + deploy.env.
# shellcheck disable=SC2029 # see above
ssh -n "$host" "cd $remote_dir && docker compose -f compose.yaml --env-file .env --env-file deploy.env up -d --no-deps --force-recreate broker"
echo "recreated the broker of $stack"
