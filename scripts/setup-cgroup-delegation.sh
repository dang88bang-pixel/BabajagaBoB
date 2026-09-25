#!/usr/bin/env bash
# ============================================================================
# Richtet die cgroup-v2-Delegation für die Ressourcenlimits ein (Root-Schritt).
#
#   sudo BOB_CGROUP_DIR=/sys/fs/cgroup/bob bash scripts/setup-cgroup-delegation.sh [benutzer]
#
# Warum das nötig ist (gemessen, nicht theoretisch):
#
#  1. Der delegierte Teilbaum allein genügt **nicht**. cgroup v2 prüft beim
#     Verschieben eines Prozesses die Schreibrechte auf `cgroup.procs` des
#     Ziels. Ohne `chown` dieser Datei scheitert jeder Beitritt mit EACCES,
#     obwohl das Verzeichnis dem Benutzer gehört.
#  2. Prozesse dürfen **nur innerhalb** ihres eigenen delegierten Teilbaums
#     verschoben werden (Delegation Containment). Läuft der Plattformprozess
#     (z. B. `next start`) selbst in einem root-eigenen Zweig — etwa dem
#     Standardzweig der Sitzung —, schlägt der Beitritt ebenfalls mit EACCES
#     fehl. Er muss deshalb einmalig in den delegierten Baum verschoben werden;
#     dafür gibt es `scripts/cgroup-exec.sh`.
#
# Ohne Delegation läuft die Plattform weiter, meldet aber ehrlich
# `resourceLimits.cgroup = "UNAVAILABLE"` und verweigert Ausführungen, die
# Speicher-/Prozesslimits verlangen (fail closed, siehe docs/RUNTIME.md §2b).
# ============================================================================
set -euo pipefail

ROOT="${BOB_CGROUP_DIR:-/sys/fs/cgroup/bob}"
TARGET_USER="${1:-${SUDO_USER:-$(id -un)}}"
TARGET_GROUP="$(id -gn "$TARGET_USER")"
PARENT="$(dirname "$ROOT")"

[ "$(id -u)" = "0" ] || { echo "setup-cgroup-delegation: als root ausführen (sudo)" >&2; exit 1; }
case "$ROOT" in /sys/fs/cgroup/*) ;; *) echo "setup-cgroup-delegation: $ROOT liegt nicht unter /sys/fs/cgroup" >&2; exit 1;; esac

mkdir -p "$ROOT"
chown "$TARGET_USER:$TARGET_GROUP" "$ROOT"
# Kontroll- und Limitdateien, die die Plattform schreiben muss.
for file in cgroup.procs cgroup.subtree_control memory.max pids.max cpu.max; do
  [ -e "$ROOT/$file" ] && chown "$TARGET_USER:$TARGET_GROUP" "$ROOT/$file"
done
# Controller für den Teilbaum freigeben (nur im übergeordneten Zweig wirksam).
for controller in cpu memory pids; do
  if grep -qw "$controller" "$PARENT/cgroup.subtree_control" 2>/dev/null; then continue; fi
  echo "+$controller" > "$PARENT/cgroup.subtree_control" 2>/dev/null || true
done
# Eigene Controller im delegierten Zweig an die Kinder weitergeben, damit
# memory.max/pids.max in den Je-Ausführung-Zweigen gesetzt werden können.
if ! grep -q "memory" "$ROOT/cgroup.subtree_control" 2>/dev/null; then
  echo "+cpu +memory +pids" > "$ROOT/cgroup.subtree_control" 2>/dev/null || true
fi

echo "cgroup-Delegation eingerichtet:"
echo "  Baum:            $ROOT  (Eigentümer $TARGET_USER:$TARGET_GROUP)"
echo "  Controller:      $(cat "$ROOT/cgroup.controllers" 2>/dev/null || echo '?')"
echo "  an Kinder:       $(cat "$ROOT/cgroup.subtree_control" 2>/dev/null || echo '?')"
echo
echo "Nächster Schritt: die Plattform innerhalb der Delegation starten, z. B."
echo "  BOB_CGROUP_DIR=$ROOT bash scripts/cgroup-exec.sh npx next start -p 3000 -H 0.0.0.0"
echo "Prüfen: GET /api/runtime → isolation.resourceLimits.cgroup == \"ENFORCED\""
