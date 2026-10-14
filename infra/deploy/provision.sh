#!/usr/bin/env bash
# Creates a stack's .env on the VPS. Run it yourself in a terminal – secrets never pass through chat or CI.
# Usage: SMART_VPS=<user@host> infra/deploy/provision.sh <staging|production> [--force]
# --force rewrites the file but keeps the generated DB and broker passwords (the data volumes depend on them),
# the existing SMART_* runtime settings, MQTT_TLS (broker-certs.sh sets it to on) and, when a prompt is answered with
# Enter, the stored mail settings.
set -euo pipefail

environment="${1:-}"
force="${2:-}"
host="${SMART_VPS:?set SMART_VPS=<user@host> (see .local/server.md)}"

case "$environment" in
  staging) stack=smart-staging; domain=staging.smart.tillkosiol.de ;;
  production) stack=smart-prod; domain=smart.tillkosiol.de ;;
  *) echo "usage: provision.sh <staging|production> [--force]" >&2; exit 2 ;;
esac
remote_dir="docker/apps/$stack"

# shellcheck disable=SC2029 # remote_dir is a fixed path chosen above; expanding it locally is intended
exists=$(ssh -n "$host" "test -e $remote_dir/.env && echo yes || echo no")
case "$exists" in
  yes | no) ;;
  *) echo "could not check $remote_dir/.env on the VPS" >&2; exit 1 ;;
esac

existing=""
if [ "$exists" = yes ]; then
  if [ "$force" != "--force" ]; then
    echo "$remote_dir/.env already exists on the VPS; rerun with --force to replace it" >&2
    exit 1
  fi
  # shellcheck disable=SC2029 # see above
  existing=$(ssh -n "$host" "cat $remote_dir/.env")
fi

existing_value() { printf '%s\n' "$existing" | sed -n "s/^$1=//p" | head -n 1; }

keep_or_generate() {
  local value
  value=$(existing_value "$1")
  if [ -n "$value" ]; then printf '%s' "$value"; else openssl rand -hex 32; fi
}

# Characters that an env file would read differently (comment, expansion, quoting).
env_unsafe='[$#"'\''\\`]'
# Reads a line; Enter keeps the stored value of the variable named $1, and without one the run stops.
prompt_or_keep() {
  local name=$1 text=$2 value
  read -r -p "$text" value
  if [ -z "$value" ]; then value=$(existing_value "$name"); fi
  if [ -z "$value" ]; then echo "$name is required – nothing was written" >&2; exit 1; fi
  if [[ "$value" =~ $env_unsafe ]]; then
    echo "$name must not contain \$ # quotes, backslashes or backticks – nothing was written" >&2
    exit 1
  fi
  printf '%s' "$value"
}

# Mail (Resend over SMTP). The key is read hidden and ends up only in the file on the VPS.
read -r -s -p "Resend API key (starts with re_; Enter keeps the stored one): " resend_key; echo
if [ -z "$resend_key" ]; then
  smtp_url=$(existing_value SMTP_URL)
  if [ -z "$smtp_url" ]; then echo "a Resend API key is required – nothing was written" >&2; exit 1; fi
elif [[ "$resend_key" =~ ^re_[A-Za-z0-9_]+$ ]]; then
  smtp_url="smtps://resend:$resend_key@smtp.resend.com:465"
else
  # Never echo the rejected value, it may be a secret of another kind.
  echo "that is not a Resend API key (expected re_ followed by letters, digits and underscores) – nothing was written" >&2
  exit 1
fi
unset resend_key
mail_from=$(prompt_or_keep MAIL_FROM "Sender of the mails, e.g. Smart Home <noreply@your-domain> (Enter keeps the stored one): ")
mail_allowlist=""
if [ "$environment" = staging ]; then
  mail_allowlist=$(prompt_or_keep MAIL_ALLOWLIST "Staging only: recipients that may receive mail, comma separated (Enter keeps the stored list): ")
  mail_allowlist=${mail_allowlist//[[:space:]]/}
fi

existing_hops=$(existing_value TRUSTED_PROXY_HOPS)
# MQTT_TLS stays off until broker-certs.sh has copied the certificates and switched it on; --force keeps that.
existing_tls=$(existing_value MQTT_TLS)
lines=(
  "STACK_NAME=$stack"
  "APP_DOMAIN=$domain"
  "APP_ORIGIN=https://$domain"
  # web nginx and Nginx Proxy Manager sit in front of the api.
  "TRUSTED_PROXY_HOPS=${existing_hops:-2}"
  "DB_PASSWORD=$(keep_or_generate DB_PASSWORD)"
  "MQTT_API_PASSWORD=$(keep_or_generate MQTT_API_PASSWORD)"
  "MQTT_TLS=${existing_tls:-off}"
  "SMTP_URL=$smtp_url"
  "MAIL_FROM=$mail_from"
)
if [ -n "$mail_allowlist" ]; then lines+=("MAIL_ALLOWLIST=$mail_allowlist"); fi

# Runtime settings (SMART_*) of an existing .env are carried over verbatim, also on --force.
while IFS= read -r smart_line; do
  lines+=("$smart_line")
done < <(printf '%s\n' "$existing" | grep '^SMART_' || true)

if [ "$environment" = production ]; then
  # Gateways reach the production broker from the internet; staging publishes 127.0.0.1:18883 only (compose default).
  existing_port=$(existing_value MQTT_PUBLIC_PORT)
  lines+=("MQTT_PUBLIC_PORT=${existing_port:-8883}")
  backup_uid=$(ssh -n "$host" "id -u")
  backup_gid=$(ssh -n "$host" "id -g")
  read -r -p "B2 S3 endpoint (e.g. s3.eu-central-003.backblazeb2.com): " b2_endpoint
  read -r -p "B2 bucket for VPS backups: " b2_bucket
  read -r -p "B2 keyID of the key smart-vps-restic (25 characters, starts with 00): " b2_key_id
  read -r -s -p "B2 application key (secret, starts with K): " b2_app_key; echo
  # Guard against swapping the two: never echo the rejected value, it may be the secret.
  if ! [[ "$b2_key_id" =~ ^00[0-9a-f]{23}$ ]]; then
    echo "that is not a B2 keyID (expected 25 hex characters starting with 00) – nothing was written" >&2
    exit 1
  fi
  if ! [[ "$b2_app_key" =~ ^K[0-9A-Za-z+/]{30}$ ]]; then
    echo "that is not a B2 application key (expected 31 characters starting with K) – nothing was written" >&2
    exit 1
  fi
  read -r -s -p "restic repository password (from your password manager): " restic_password; echo
  read -r -p "healthchecks.io ping URL for the nightly backup: " hc_backup
  read -r -p "healthchecks.io ping URL for the restore test: " hc_restore
  lines+=(
    "COMPOSE_PROFILES=backup"
    "BACKUP_UID=$backup_uid"
    "BACKUP_GID=$backup_gid"
    "B2_ENDPOINT=$b2_endpoint"
    "B2_BUCKET=$b2_bucket"
    "B2_KEY_ID=$b2_key_id"
    "B2_APP_KEY=$b2_app_key"
    "RESTIC_PASSWORD=$restic_password"
    "HC_BACKUP_URL=$hc_backup"
    "HC_RESTORE_URL=$hc_restore"
  )
fi

# shellcheck disable=SC2029 # see above
# certs/ is created here (not by Docker, which would make it root-owned); it is world-searchable like in
# broker-certs.sh so the containers can read the public files, the server key inside stays 600.
printf '%s\n' "${lines[@]}" | ssh "$host" "umask 077 && mkdir -p $remote_dir/certs && chmod 755 $remote_dir/certs && cat > $remote_dir/.env"
echo "wrote $remote_dir/.env on the VPS (mode 600) and created $remote_dir/certs"
