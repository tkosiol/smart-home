# shellcheck shell=bash
# shellcheck disable=SC2034 # bk_hc_url and bk_hc_restore_url are read by the scripts that source this file
# Shared by backup.sh and restore-test.sh (sourced; runs on the Pi as root, started by systemd). Reads
# secrets/backup.env as KEY=value lines (never sourced), validates it without ever printing a value, sends the
# healthchecks.io pings (the URL goes to curl on stdin, so it is in no command line and in no log) and starts the
# restic container through Docker Compose, which reads the same file as the service's env file.
# SMART_GATEWAY_DIR (default /srv/smart-gateway) exists for tests.

bk_die() {
  echo "$bk_name: $*" >&2
  exit 1
}

# bk_init <script name>: the gateway folder and the two files the run needs.
bk_init() {
  bk_name=$1
  bk_dir="${SMART_GATEWAY_DIR:-/srv/smart-gateway}"
  bk_dir="${bk_dir%/}"
  [[ "$bk_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || bk_die "SMART_GATEWAY_DIR is not a plain absolute path"
  bk_env="$bk_dir/secrets/backup.env"
  [ -f "$bk_env" ] || bk_die "$bk_env does not exist - run infra/deploy/provision-gateway.sh on the Mac first (it writes backup.env)"
  [ -r "$bk_env" ] || bk_die "$bk_env is not readable (the backup runs as root)"
  [ -f "$bk_dir/secrets/gateway.env" ] || bk_die "$bk_dir/secrets/gateway.env does not exist - run infra/deploy/provision-gateway.sh first"
}

# bk_load_env: parses backup.env. Sets bk_hc_url / bk_hc_restore_url as soon as a usable ping URL was read (so a
# broken file can still report the failure), and bk_error (a message without any value) when the file is no good.
bk_hc_url=''
bk_hc_restore_url=''
bk_error=''
bk_load_env() {
  local line n=0 key value var unsafe host_pattern url_pattern
  unsafe='[$#"'\''\\`[:space:]]'
  host_pattern='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
  url_pattern='^https://[A-Za-z0-9._~:/=%+-]+$'
  bk_error=''
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in '' | '#'*) continue ;; esac
    if ! [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
      [ -n "$bk_error" ] || bk_error="backup.env line $n is not KEY=value"
      continue
    fi
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    case "$key" in
      B2_ENDPOINT | B2_BUCKET | B2_KEY_ID | B2_APP_KEY | RESTIC_PASSWORD | HC_BACKUP_URL | HC_RESTORE_URL) ;;
      *)
        [ -n "$bk_error" ] || bk_error="backup.env line $n has a key that is not allowed"
        continue ;;
    esac
    var="bk_v_$key"
    if [ -n "${!var+x}" ]; then
      [ -n "$bk_error" ] || bk_error="backup.env line $n repeats $key"
      continue
    fi
    printf -v "$var" '%s' "$value"
    if [ -z "$value" ]; then
      [ -n "$bk_error" ] || bk_error="backup.env: $key is empty"
      continue
    fi
    case "$key" in
      B2_ENDPOINT) [[ "$value" =~ $host_pattern ]] || { [ -n "$bk_error" ] || bk_error="backup.env: B2_ENDPOINT must be a host name without https://"; } ;;
      B2_BUCKET) [[ "$value" =~ ^[A-Za-z0-9-]{6,50}$ ]] || { [ -n "$bk_error" ] || bk_error="backup.env: B2_BUCKET is not a bucket name"; } ;;
      HC_BACKUP_URL | HC_RESTORE_URL)
        if [[ "$value" =~ $url_pattern ]]; then
          if [ "$key" = HC_BACKUP_URL ]; then bk_hc_url=$value; else bk_hc_restore_url=$value; fi
        else
          [ -n "$bk_error" ] || bk_error="backup.env: $key must be an https:// URL without special characters"
        fi ;;
      *) if [[ "$value" =~ $unsafe ]]; then
        [ -n "$bk_error" ] || bk_error="backup.env: $key contains a blank, \$ # a quote, a backslash or a backtick"
      fi ;;
    esac
  done < "$bk_env"
  for key in B2_ENDPOINT B2_BUCKET B2_KEY_ID B2_APP_KEY RESTIC_PASSWORD HC_BACKUP_URL; do
    var="bk_v_$key"
    if [ -z "${!var+x}" ]; then
      [ -n "$bk_error" ] || bk_error="backup.env: $key is missing"
    fi
  done
  [ -z "$bk_error" ]
}

# bk_wait_clock: the Pi has no real-time clock, so right after a boot the time can be far off, and S3 requests
# signed with a wrong time fail (or restic writes snapshots with a wrong date). After=time-sync.target only orders the
# units (that target passes at once unless systemd-time-wait-sync is enabled), so the scripts wait themselves, before any
# restic or S3 work: up to SMART_CLOCK_WAIT_SECONDS (default 600) until timedatectl reports NTPSynchronized=yes.
# Returns 1 when the clock did not synchronize. Without timedatectl (SMART_TIMEDATECTL overrides the name, for tests)
# it returns 0 at once: there is nothing to ask.
bk_wait_clock() {
  local tool="${SMART_TIMEDATECTL:-timedatectl}" limit="${SMART_CLOCK_WAIT_SECONDS:-600}" poll="${SMART_CLOCK_POLL_SECONDS:-5}" deadline synced
  command -v "$tool" > /dev/null 2>&1 || return 0
  [[ "$limit" =~ ^[0-9]{1,5}$ && "$poll" =~ ^[0-9]{1,3}$ ]] || bk_die "SMART_CLOCK_WAIT_SECONDS and SMART_CLOCK_POLL_SECONDS must be whole seconds"
  deadline=$((SECONDS + limit))
  while :; do
    synced=$("$tool" show -p NTPSynchronized --value 2> /dev/null) || synced=""
    [ "$synced" = yes ] && return 0
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep "$poll"
  done
}

# bk_ping <base url> <suffix>: start, fail or success ("") ping. The URL is handed to curl as a config on stdin.
bk_ping() {
  [ -n "$1" ] || return 0
  printf 'url = "%s%s"\n' "$1" "$2" | curl -fsS -m 10 --retry 3 -o /dev/null -K - 2> /dev/null \
    || echo "$bk_name: warning: the healthchecks.io ping ${2:-success} did not go through" >&2
}

# bk_run <job>: runs the restic container for backup or restore-test; its output is the log.
bk_run() {
  cd "$bk_dir" || bk_die "cannot enter $bk_dir"
  docker compose --env-file secrets/gateway.env --profile backup run --rm -T backup "$1" < /dev/null
}
