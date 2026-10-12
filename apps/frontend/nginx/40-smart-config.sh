#!/bin/sh
# Writes the runtime configuration served as /config.json from SMART_* environment variables.
# Runs as the unprivileged nginx user from /docker-entrypoint.d/ before nginx starts.
set -eu

target="${SMART_CONFIG_TARGET:-/tmp/smart-config.json}"

case "${SMART_INSTANCE_APPEARANCE_EDITOR:-false}" in
  true) editor=true ;;
  *) editor=false ;;
esac

# SMART_INSTANCE_APPEARANCE is JSON (instanceAppearanceSchema). The app validates it and falls
# back to the build default if it is invalid; broken JSON makes the whole file fall back.
appearance="${SMART_INSTANCE_APPEARANCE:-}"
if [ -n "$appearance" ]; then
  printf '{"features":{"instanceAppearanceEditor":%s},"instanceAppearance":%s}\n' \
    "$editor" "$appearance" > "$target"
else
  printf '{"features":{"instanceAppearanceEditor":%s}}\n' "$editor" > "$target"
fi
