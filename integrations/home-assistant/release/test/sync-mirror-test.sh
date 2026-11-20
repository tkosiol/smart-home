#!/usr/bin/env bash
# Tests sync-mirror.sh against a local bare repository (no GitHub needed).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/../sync-mirror.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $*"; exit 1; }
# A fake monorepo root with the files the script mirrors.
root="$work/root"
comp="$root/integrations/home-assistant/custom_components/smart_bridge"
mkdir -p "$comp/translations" "$root/integrations/home-assistant/release"
printf '{\n  "domain": "smart_bridge",\n  "version": "1.2.3"\n}\n' >"$comp/manifest.json"
echo 'print("a")' >"$comp/__init__.py"
echo '{}' >"$comp/translations/en.json"
cp "$here/../hacs.json" "$here/../README.md" "$root/integrations/home-assistant/release/"
echo "license text" >"$root/LICENSE"
echo "unrelated" >"$root/integrations/home-assistant/NOT-MIRRORED"
export SMART_REPO_ROOT="$root"

git init -q --bare -b main "$work/mirror.git"
url="file://$work/mirror.git"
count() { git -C "$work/mirror.git" rev-list --count main; }
files() { git -C "$work/mirror.git" ls-tree -r --name-only main | LC_ALL=C sort; }
subject() { git -C "$work/mirror.git" log -1 --format=%s main; }

# Run 1: everything is mirrored, __pycache__ never.
mkdir "$comp/__pycache__" && echo x >"$comp/__pycache__/x.pyc"
mkdir "$comp/translations/__pycache__" && echo x >"$comp/translations/__pycache__/y.pyc"
version="$(bash "$script" "$url" aaaaaaa 2>/dev/null)"
[ "$version" = "1.2.3" ] || fail "version output was '$version'"
expected="LICENSE
README.md
custom_components/smart_bridge/__init__.py
custom_components/smart_bridge/manifest.json
custom_components/smart_bridge/translations/en.json
hacs.json"
[ "$(files)" = "$expected" ] || fail "unexpected files: $(files)"
[ "$(count)" = 1 ] || fail "expected 1 commit, got $(count)"
[ "$(subject)" = "sync from tkosiol/smart-home@aaaaaaa" ] || fail "commit subject: $(subject)"

# Run 2: nothing changed, so no new commit (the version is still printed).
version="$(bash "$script" "$url" bbbbbbb 2>/dev/null)"
[ "$version" = "1.2.3" ] || fail "version output on unchanged run was '$version'"
[ "$(count)" = 1 ] || fail "unchanged run created a commit"

# Run 3: a changed file creates a commit.
echo 'print("b")' >"$comp/__init__.py"
bash "$script" "$url" ccccccc >/dev/null 2>&1
[ "$(count)" = 2 ] || fail "changed run should add one commit"
[ "$(subject)" = "sync from tkosiol/smart-home@ccccccc" ] || fail "second commit subject: $(subject)"

# Run 4: a deleted source file disappears from the mirror.
rm "$comp/translations/en.json"
bash "$script" "$url" ddddddd >/dev/null 2>&1
if files | grep -q 'en.json'; then fail "removed file still mirrored"; fi

# The version output follows manifest.json.
sed -i.bak 's/1.2.3/1.3.0/' "$comp/manifest.json"
rm "$comp/manifest.json.bak"
[ "$(bash "$script" "$url" eeeeeee 2>/dev/null)" = "1.3.0" ] || fail "version did not follow manifest"

echo "sync-mirror tests passed"
