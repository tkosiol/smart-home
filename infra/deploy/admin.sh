#!/usr/bin/env bash
# Runs an administration command of the API inside the running stack on the VPS. Run it yourself in a terminal.
# Usage: SMART_VPS=<user@host> infra/deploy/admin.sh <staging|production> create-admin --email <address> --name <name>
# Only create-admin is allowed. Every argument reaches the remote command as exactly one word.
set -euo pipefail

usage() {
  echo "usage: SMART_VPS=<user@host> admin.sh <staging|production> create-admin --email <address> --name <name>" >&2
  exit 2
}

environment="${1:-}"
command="${2:-}"
[ "$#" -ge 2 ] || usage

case "$environment" in
  staging) stack=smart-staging ;;
  production) stack=smart-prod ;;
  *) usage ;;
esac
case "$command" in
  create-admin) ;;
  *) echo "admin.sh: command '$command' is not allowed" >&2; usage ;;
esac
host="${SMART_VPS:?set SMART_VPS=<user@host> (see .local/server.md)}"
shift 2

# Wraps a word in single quotes for the remote shell; a single quote inside becomes '\''.
quote() {
  local escaped=${1//\'/\'\\\'\'}
  printf "'%s'" "$escaped"
}

# The running release is compose.yaml + deploy.env (see deploy.sh).
remote="cd docker/apps/$stack && docker compose -f compose.yaml --env-file .env --env-file deploy.env exec -T api node dist/cli.js $command"
for argument in "$@"; do
  remote+=" $(quote "$argument")"
done

# shellcheck disable=SC2029 # the command is assembled and quoted above; expanding it locally is intended
ssh -t "$host" "$remote"
