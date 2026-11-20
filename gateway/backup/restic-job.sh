#!/bin/sh
# Runs inside the restic container (service "backup" in compose.yaml): usage restic-job.sh backup|restore-test.
# The environment comes from secrets/backup.env (B2_*, RESTIC_PASSWORD) and compose.yaml (BACKUP_HOST_TAG = the gateway
# ID). RESTIC_REPOSITORY may be set from outside (tests use a local folder); otherwise it is the B2 bucket via its
# S3 endpoint, under the prefix pi. Nothing here prints a secret.
set -eu

: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is not set (secrets/backup.env)}"
: "${BACKUP_HOST_TAG:?BACKUP_HOST_TAG is not set}"
if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  : "${B2_ENDPOINT:?B2_ENDPOINT is not set (secrets/backup.env)}" "${B2_BUCKET:?B2_BUCKET is not set (secrets/backup.env)}"
  : "${B2_KEY_ID:?B2_KEY_ID is not set (secrets/backup.env)}" "${B2_APP_KEY:?B2_APP_KEY is not set (secrets/backup.env)}"
  RESTIC_REPOSITORY="s3:https://$B2_ENDPOINT/$B2_BUCKET/pi"
  export RESTIC_REPOSITORY
fi
if [ -n "${B2_KEY_ID:-}" ] && [ -n "${B2_APP_KEY:-}" ]; then
  AWS_ACCESS_KEY_ID=$B2_KEY_ID
  AWS_SECRET_ACCESS_KEY=$B2_APP_KEY
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
fi
unset B2_KEY_ID B2_APP_KEY
export RESTIC_PASSWORD

data=/data/zigbee2mqtt-data
# Home Assistant (compose profile ha). Docker creates the folder empty for the bind mount on a Pi without HA: an empty
# folder is left out, so the backup of such a Pi stays as it was.
ha=/data/homeassistant-data

backup() {
  if ! restic cat config > /dev/null 2>&1; then
    # No repository yet (first run), or no access: init says which.
    restic init || { echo "backup failed: the repository can neither be opened nor created (password, key or bucket wrong?)" >&2; exit 1; }
  fi
  # The Z2M log is noise; secrets/ goes in as well (the repository is encrypted with the restic password).
  set -- --exclude "$data/log" "$data" /data/secrets
  if [ -n "$(ls -A "$ha" 2> /dev/null)" ]; then
    # Without the recorder database (the history; the platform keeps it) and the logs.
    set -- "$@" --exclude "$ha/home-assistant_v2.db*" --exclude "$ha/*.log*" "$ha"
  fi
  restic backup --host "$BACKUP_HOST_TAG" --tag pi "$@"
  restic forget --host "$BACKUP_HOST_TAG" --tag pi --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
  restic check
  echo "backup completed"
}

restore_test() {
  tmp=$(mktemp -d /tmp/restore-test.XXXXXX)
  trap 'rm -rf "$tmp"' EXIT
  # Only the Z2M data and the list of HA's set-up integrations come back (not the secrets): the point is that the
  # latest snapshot is readable and complete. A snapshot without Home Assistant simply has no such file.
  restic restore latest --host "$BACKUP_HOST_TAG" --tag pi --target "$tmp" --include "$data" \
    --include "$ha/.storage/core.config_entries" > /dev/null \
    || { echo "restore test failed: the latest snapshot could not be restored (no snapshot, wrong password or no access?)" >&2; exit 1; }
  for f in configuration.yaml database.db; do
    [ -s "$tmp$data/$f" ] || { echo "restore test failed: $f is missing or empty in the restored snapshot" >&2; exit 1; }
  done
  # database.db holds one JSON object per line (zigbee-herdsman); a line that does not start with { means a torn or
  # damaged file. busybox grep: -v selects the lines that do not match, -q succeeds if there is one.
  if grep -qv '^{' "$tmp$data/database.db"; then
    echo "restore test failed: database.db in the restored snapshot has a line that is not a JSON object (damaged or torn copy?)" >&2
    exit 1
  fi
  # Home Assistant, when it is set up on this Pi: its list of integrations is one JSON object (python3 is not in the
  # restic image, so the first character stands in for a full parse).
  entries="$tmp$ha/.storage/core.config_entries"
  ha_note=""
  if [ -e "$entries" ]; then
    [ -s "$entries" ] || { echo "restore test failed: Home Assistant's .storage/core.config_entries is empty in the restored snapshot" >&2; exit 1; }
    [ "$(head -c 1 "$entries")" = "{" ] || { echo "restore test failed: Home Assistant's .storage/core.config_entries in the restored snapshot is not a JSON object" >&2; exit 1; }
    ha_note=", Home Assistant .storage/core.config_entries restored and a JSON object"
  fi
  [ ! -e "$tmp/data/secrets" ] || { echo "restore test failed: the restore brought back secrets/ (it must not)" >&2; exit 1; }
  echo "restored files:"
  (cd "$tmp" && find . -type f | head -n 100 | sed 's|^\.||')
  echo "restore test passed (configuration.yaml and database.db restored, not empty, database.db is JSON lines, no secrets$ha_note)"
}

case "${1:-}" in
  backup) backup ;;
  restore-test) restore_test ;;
  *) echo "usage: restic-job.sh backup|restore-test" >&2; exit 2 ;;
esac
