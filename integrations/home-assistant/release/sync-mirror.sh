#!/usr/bin/env bash
# Mirrors the Home Assistant integration into the HACS repository.
#
# Usage: sync-mirror.sh <mirror-git-url> <source-sha>
#
# Clones the mirror, replaces its content with custom_components/smart_bridge/ (without __pycache__), hacs.json,
# README.md and LICENSE, commits only if something changed and pushes to main. Prints the integration version from
# manifest.json on stdout (everything else goes to stderr). The URL may contain a token: it is never printed.
# SMART_REPO_ROOT overrides the repository root (used by the test).
set -euo pipefail

[ "$#" -eq 2 ] || { echo "usage: sync-mirror.sh <mirror-git-url> <source-sha>" >&2; exit 2; }
mirror_url="$1"
source_sha="$2"

root="${SMART_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
integration="$root/integrations/home-assistant"
component="$integration/custom_components/smart_bridge"

[ -f "$component/manifest.json" ] || { echo "manifest.json not found" >&2; exit 1; }
version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$component/manifest.json")"
[ -n "$version" ] || { echo "no version in manifest.json" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
clone="$work/mirror"

# Errors from git may contain the URL: keep them out of the logs.
git clone --quiet "$mirror_url" "$clone" >/dev/null 2>&1 || { echo "cloning the mirror failed" >&2; exit 1; }
git -C "$clone" checkout --quiet -B main

# Replace the content (everything but .git).
find "$clone" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
mkdir -p "$clone/custom_components"
cp -R "$component" "$clone/custom_components/smart_bridge"
find "$clone/custom_components" -name __pycache__ -type d -prune -exec rm -rf {} +
cp "$integration/release/hacs.json" "$integration/release/README.md" "$root/LICENSE" "$clone/"

git -C "$clone" add -A
if git -C "$clone" diff --cached --quiet; then
  echo "mirror is up to date" >&2
else
  git -C "$clone" -c user.name="smart-home-mirror" -c user.email="mirror@users.noreply.github.com" \
    commit --quiet -m "sync from tkosiol/smart-home@${source_sha}"
  git -C "$clone" push --quiet origin HEAD:main >/dev/null 2>&1 || { echo "pushing to the mirror failed" >&2; exit 1; }
  echo "mirror updated" >&2
fi

echo "$version"
