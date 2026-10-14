#!/usr/bin/env bash
# Copies the broker's TLS material from the local PKI directory (infra/pki/pki.sh) into the stack on the VPS,
# switches the stack's .env to MQTT_TLS=on and recreates the broker. Run it yourself in a terminal.
# Usage: SMART_VPS=<user@host> infra/deploy/broker-certs.sh <staging|production>
# Reads ca.crt, server.crt, server.key, crl.pem and crl-next-update from SMART_PKI_DIR (default ~/.smart-pki).
# Re-run it after every revocation (pki.sh revoke) and before the certificates expire.
# All files travel in ONE ssh session as a tar stream on stdin, so no key content appears in a command line
# or in the output, and a failed transfer never leaves a mix of old and new files.
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
# The api reads crl-next-update to warn about an expiring CRL; the broker stops accepting gateways when it lapses.
min_crl_days=7

files=(ca.crt server.crt server.key crl.pem crl-next-update)
for name in "${files[@]}"; do
  if [ ! -s "$pki_dir/$name" ] || [ ! -r "$pki_dir/$name" ]; then
    echo "missing or unreadable $name in $pki_dir – run infra/pki/pki.sh init-ca, issue-server and crl first" >&2
    exit 1
  fi
done

iso_to_epoch() { date -u -d "$1" +%s 2> /dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s; }
crl_next_update=$(head -n 1 "$pki_dir/crl-next-update")
if ! [[ "$crl_next_update" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  echo "crl-next-update in $pki_dir is not an ISO 8601 UTC time – run infra/pki/pki.sh crl" >&2
  exit 1
fi
crl_seconds_left=$(($(iso_to_epoch "$crl_next_update") - $(date +%s)))
if [ "$crl_seconds_left" -lt $((min_crl_days * 86400)) ]; then
  echo "the CRL expires at $crl_next_update (less than $min_crl_days days from now or already expired) – run infra/pki/pki.sh crl first" >&2
  exit 1
fi

# shellcheck disable=SC2029 # remote_dir is a fixed path chosen above; expanding it locally is intended
usable=$(ssh -n "$host" "test -r $remote_dir/.env && test -w $remote_dir/.env && echo yes || echo no")
if [ "$usable" != yes ]; then
  echo "$remote_dir/.env does not exist or is not readable and writable on the VPS – run provision.sh first" >&2
  exit 1
fi

# One session: unpack into certs/.new, fix the modes, and only after everything succeeded move the files into
# place. The directory certs/ itself stays (containers bind-mount it). It is world-searchable so the api
# container (user node) can read the public files; server.key stays 600 and is read only by the broker
# entrypoint, which runs as root.
remote_script="umask 077 && cd $remote_dir && mkdir -p certs && chmod 755 certs && rm -rf certs/.new && mkdir certs/.new \
&& tar -xf - -C certs/.new ${files[*]} \
&& chmod 600 certs/.new/server.key && chmod 644 certs/.new/ca.crt certs/.new/server.crt certs/.new/crl.pem certs/.new/crl-next-update \
&& mv certs/.new/ca.crt certs/.new/server.crt certs/.new/server.key certs/.new/crl.pem certs/.new/crl-next-update certs/ \
&& rmdir certs/.new"
# COPYFILE_DISABLE keeps macOS tar from adding ._ metadata entries.
# shellcheck disable=SC2029 # see above
COPYFILE_DISABLE=1 tar -cf - -C "$pki_dir" "${files[@]}" | ssh "$host" "$remote_script"
echo "copied ${files[*]} to $remote_dir/certs (server.key mode 600, the rest 644)"

# MQTT_TLS is the only line this script changes in the .env. A grep failure other than "no line left" (status 1)
# stops the chain before the file is replaced.
# shellcheck disable=SC2029 # see above
ssh -n "$host" "cd $remote_dir && umask 077 && { grep -v '^MQTT_TLS=' .env > .env.new || [ \$? -eq 1 ]; } && echo MQTT_TLS=on >> .env.new && chmod 600 .env.new && mv .env.new .env"
echo "set MQTT_TLS=on in $remote_dir/.env"

# The recreate picks up both the new .env and the new files; the running release is compose.yaml + deploy.env.
# shellcheck disable=SC2029 # see above
ssh -n "$host" "cd $remote_dir && docker compose -f compose.yaml --env-file .env --env-file deploy.env up -d --no-deps --force-recreate broker"
echo "recreated the broker of $stack"
