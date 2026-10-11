#!/usr/bin/env bash
# Creates a stack's .env on the VPS. Run it yourself in a terminal – secrets never pass through chat or CI.
# Usage: SMART_VPS=<user@host> infra/deploy/provision.sh <staging|production> [--force]
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
if ssh -n "$host" "test -e $remote_dir/.env" && [ "$force" != "--force" ]; then
  echo "$remote_dir/.env already exists on the VPS; rerun with --force to replace it" >&2
  exit 1
fi

generate() { openssl rand -hex 32; }

lines=(
  "STACK_NAME=$stack"
  "APP_DOMAIN=$domain"
  "DB_PASSWORD=$(generate)"
  "MQTT_API_PASSWORD=$(generate)"
)

if [ "$environment" = production ]; then
  read -r -p "B2 S3 endpoint (e.g. s3.eu-central-003.backblazeb2.com): " b2_endpoint
  read -r -p "B2 bucket for VPS backups: " b2_bucket
  read -r -p "B2 key ID (smart-vps-restic): " b2_key_id
  read -r -s -p "B2 application key: " b2_app_key; echo
  read -r -s -p "restic repository password (from your password manager): " restic_password; echo
  read -r -p "healthchecks.io ping URL for the nightly backup: " hc_backup
  read -r -p "healthchecks.io ping URL for the restore test: " hc_restore
  lines+=(
    "COMPOSE_PROFILES=backup"
    "B2_ENDPOINT=$b2_endpoint"
    "B2_BUCKET=$b2_bucket"
    "B2_KEY_ID=$b2_key_id"
    "B2_APP_KEY=$b2_app_key"
    "RESTIC_PASSWORD=$restic_password"
    "HC_BACKUP_URL=$hc_backup"
    "HC_RESTORE_URL=$hc_restore"
  )
fi

# shellcheck disable=SC2029 # remote_dir is a fixed path chosen above; expanding it locally is intended
printf '%s\n' "${lines[@]}" | ssh "$host" "umask 077 && mkdir -p $remote_dir && cat > $remote_dir/.env"
echo "wrote $remote_dir/.env on the VPS (mode 600)"
