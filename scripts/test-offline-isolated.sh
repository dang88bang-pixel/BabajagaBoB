#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v unshare >/dev/null 2>&1; then
  echo "offline isolated test requires unshare(1)" >&2
  exit 1
fi
if ! unshare --user --map-root-user true; then
  echo "offline isolated test requires usable unprivileged user namespaces" >&2
  exit 1
fi

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/bob-offline-isolated.XXXXXX")"
cleanup() {
  rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

ROOTFS="$TEMP_ROOT/rootfs"
bash scripts/build-ns-rootfs.sh "$ROOTFS"

# The integration test asserts NAMESPACES is active when isolation is forced,
# then exercises import → local activation → staged asset execution → signed
# evidence/provenance sync across separate storage roots.
BOB_NS_ROOTFS="$ROOTFS" BOB_NS_ISOLATION=on npm exec -- vitest run tests/integration/offline-task-packages.test.ts --reporter=default
