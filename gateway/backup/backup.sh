#!/usr/bin/env bash
# Nightly Pi backup (systemd: smart-gateway-backup.timer, 03:30): restic backup of zigbee2mqtt-data/ (without log/)
# and secrets/ to the B2 bucket, retention 7 daily / 4 weekly / 6 monthly, restic check, healthchecks.io pings
# (start, success, fail on the HC_BACKUP_URL of secrets/backup.env). The restic work runs in the backup service of
# compose.yaml (restic-job.sh); lib.sh explains the handling of backup.env. Runs as root on the Pi.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=gateway/backup/lib.sh
. "$here/lib.sh"

bk_init backup.sh
bk_load_env || {
  bk_ping "$bk_hc_url" /fail
  bk_die "$bk_error - nothing was backed up"
}
trap 'exit 143' INT TERM
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then bk_ping "$bk_hc_url" /fail; fi
  exit "$rc"
}
trap on_exit EXIT
bk_ping "$bk_hc_url" /start
bk_wait_clock || bk_die "clock not synchronized (timedatectl does not report NTPSynchronized=yes) - nothing was backed up"
bk_run backup
trap - EXIT
bk_ping "$bk_hc_url" ""
