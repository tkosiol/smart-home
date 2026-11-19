#!/usr/bin/env bash
# Tests for the Home Assistant integration (smart_bridge). Needs Docker only: Python, Home Assistant and ruff run
# in a container with the integration folder mounted, so nothing is installed on the host.
# Phase 1: ruff format/check and pytest (pure protocol tests and, later, HA tests). Phase 2 (Docker test against a
# real Home Assistant image) is added with the integration itself.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PYTHON_IMAGE=python:3.14.10-slim-trixie
PIP_CACHE=smart-ha-integration-pip-cache

command -v docker > /dev/null 2>&1 || { echo "ha integration tests need Docker" >&2; exit 1; }

echo "== phase 1: ruff and pytest ($PYTHON_IMAGE)"
# The mount is read-only; caches go to /tmp so the working tree stays clean.
docker run --rm \
  -v "$ROOT:/work:ro" -v "$PIP_CACHE:/root/.cache/pip" \
  -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONPATH=/work \
  -w /work "$PYTHON_IMAGE" sh -euc '
    pip install --quiet --disable-pip-version-check -r requirements-test.txt
    ruff format --check --no-cache .
    ruff check --no-cache .
    pytest -q -p no:cacheprovider
  '
echo "ha integration tests passed"
