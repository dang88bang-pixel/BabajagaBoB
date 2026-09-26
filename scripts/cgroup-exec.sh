#!/usr/bin/env bash
# ============================================================================
# Startet ein Kommando im delegierten cgroup-v2-Teilbaum.
#
#   BOB_CGROUP_DIR=/sys/fs/cgroup/bob bash scripts/cgroup-exec.sh npx next start
#
# Hintergrund (gemessen, siehe docs/RUNTIME.md §2b): Prozesse dürfen nur
# innerhalb ihres eigenen delegierten Teilbaums verschoben werden. Läuft der
# Startprozess in einem fremden (z. B. root-eigenen) Zweig, verweigert der
# Kernel jeden Beitritt mit EACCES — auch wenn der Zielzweig dem Benutzer
# gehört. Dieses Skript verschiebt **sich selbst** einmalig in den delegierten
# Baum (dafür ist genau ein privilegierter Schritt nötig) und startet dann das
# Kommando als Kind — damit liegen Server und alle Ausführungen innerhalb der
# Delegation und `memory.max`/`pids.max` greifen.
#
# Ohne `sudo` bricht das Skript ab, statt still ohne Limits weiterzulaufen
# (fail closed): ein Betrieb ohne Delegation muss bewusst als
# `cgroup: "UNAVAILABLE"` gestartet werden.
# ============================================================================
set -euo pipefail

ROOT="${BOB_CGROUP_DIR:-/sys/fs/cgroup/bob}"
[ -d "$ROOT" ] || { echo "cgroup-exec: $ROOT fehlt — zuerst scripts/setup-cgroup-delegation.sh ausführen" >&2; exit 1; }
[ "$#" -gt 0 ] || { echo "cgroup-exec: kein Kommando angegeben" >&2; exit 1; }

RUN="$ROOT/run-$$"
mkdir -p "$RUN"

current="$(cat /proc/self/cgroup | sed 's/^0:://')"
if [ "$current" = "${RUN#/sys/fs/cgroup}" ] || [ "${current#"${ROOT#/sys/fs/cgroup}/"}" != "$current" ]; then
  : # bereits innerhalb der Delegation
else
  if ! echo $$ > "$RUN/cgroup.procs" 2>/dev/null; then
    sudo sh -c "echo $$ > '$RUN/cgroup.procs'" 2>/dev/null || {
      echo "cgroup-exec: Beitritt zu $RUN verweigert (Delegation prüfen: scripts/setup-cgroup-delegation.sh)" >&2
      exit 1
    }
  fi
fi
[ "$(cat /proc/self/cgroup | sed 's/^0:://')" = "${RUN#/sys/fs/cgroup}" ] || { echo "cgroup-exec: Prozess ist nicht im delegierten Baum" >&2; exit 1; }

echo "cgroup-exec: pid $$ in ${RUN} (Controller: $(cat "$ROOT/cgroup.subtree_control" 2>/dev/null || echo '?'))" >&2
exec "$@"
