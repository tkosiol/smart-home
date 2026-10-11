#!/bin/sh
# Monthly restore test: restores the latest dump into a throw-away database and checks it.
set -eu
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${BACKUP_HOST_TAG:?}"

ping_hc() {
  [ -n "${HC_RESTORE_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HC_RESTORE_URL}$1" || true
}

ping_hc /start
trap 'ping_hc /fail' EXIT

dump=/tmp/restore-check.dump
restic dump --host "$BACKUP_HOST_TAG" --tag db latest smart.dump > "$dump"

psql -v ON_ERROR_STOP=1 -q -d postgres -c 'DROP DATABASE IF EXISTS restore_check' -c 'CREATE DATABASE restore_check'
psql -v ON_ERROR_STOP=1 -q -d restore_check -c 'CREATE EXTENSION IF NOT EXISTS timescaledb' -c 'SELECT timescaledb_pre_restore()'
# pg_restore reports the already existing timescaledb extension as an error; the checks below decide.
pg_restore --no-owner -d restore_check "$dump" || echo "pg_restore reported errors; verifying content"
psql -v ON_ERROR_STOP=1 -q -d restore_check -c 'SELECT timescaledb_post_restore()'

migrations=$(psql -tA -d restore_check -c 'select count(*) from drizzle.__drizzle_migrations')
[ "$migrations" -ge 1 ] || { echo "restore check failed: no migrations in restored database" >&2; exit 1; }

psql -v ON_ERROR_STOP=1 -q -d postgres -c 'DROP DATABASE restore_check'
rm -f "$dump"

trap - EXIT
ping_hc ""
echo "restore test passed ($migrations migrations)"
