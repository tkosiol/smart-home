#!/bin/sh
# Writes the runtime configuration served as /config.json from SMART_* environment variables.
# Runs as the unprivileged nginx user from /docker-entrypoint.d/ before nginx starts.
set -eu

# Must match the alias of `location = /config.json` in the nginx config.
target=/tmp/smart-config.json

# SMART_INSTANCE_APPEARANCE is JSON (instanceAppearanceSchema), the hoster's default theme. The
# app validates it and falls back to the build default if it is invalid; broken JSON makes the
# whole file fall back. The platform admin's value on the server wins over it (spec 3.8).
appearance="${SMART_INSTANCE_APPEARANCE:-}"
if [ -n "$appearance" ]; then
  printf '{"instanceAppearance":%s}\n' "$appearance" > "$target"
else
  printf '{}\n' > "$target"
fi
