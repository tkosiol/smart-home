#!/usr/bin/env bash
# Weekly restore test (systemd: smart-gateway-restore-test.timer): restores the latest snapshot of the Z2M data into a
# temporary folder in the container and checks that configuration.yaml and database.db are there and not empty.
# Pings HC_RESTORE_URL (start, success, fail) when backup.env has one; without it only a failure is reported, on the
# HC_BACKUP_URL (the check of the nightly backup then goes down, which is the alarm). Runs as root on the Pi.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=gateway/backup/lib.sh
. "$here/lib.sh"

bk_init restore-test.sh
ping_success() { [ -z "$bk_hc_restore_url" ] || bk_ping "$bk_hc_restore_url" ""; }
ping_start() { [ -z "$bk_hc_restore_url" ] || bk_ping "$bk_hc_restore_url" /start; }
ping_fail() { bk_ping "${bk_hc_restore_url:-$bk_hc_url}" /fail; }
bk_load_env || {
  ping_fail
  bk_die "$bk_error - the restore test did not run"
}
trap 'exit 143' INT TERM
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then ping_fail; fi
  exit "$rc"
}
trap on_exit EXIT
ping_start
bk_run restore-test
trap - EXIT
ping_success
