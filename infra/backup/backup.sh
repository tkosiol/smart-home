#!/bin/sh
# Nightly backup: database dump and stack configuration into the restic repository.
set -eu
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${BACKUP_HOST_TAG:?}"

ping_hc() {
  [ -n "${HC_BACKUP_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HC_BACKUP_URL}$1" || true
}

ping_hc /start
trap 'ping_hc /fail' EXIT

restic cat config > /dev/null 2>&1 || restic init
restic backup --host "$BACKUP_HOST_TAG" --tag db --stdin-filename smart.dump \
  --stdin-from-command -- pg_dump --format=custom --no-owner
restic backup --host "$BACKUP_HOST_TAG" --tag config --exclude '/stack-config/deploy.env.next' /stack-config
restic forget --host "$BACKUP_HOST_TAG" --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
restic check

trap - EXIT
ping_hc ""
echo "backup completed"
