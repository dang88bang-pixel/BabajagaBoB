#!/bin/sh
# ============================================================================
# Trusted wrapper for kernel-isolated execution (Runtime-Isolation REAL_NS).
#
# Dieser Wrapper ist **vertrauenswürdiger Laufzeit-Code**, nicht Agenteneingabe.
# Er garantiert:
#   - eigener Netzwerk-Namespace        → Netzwerk ist kernel-seitig DENY
#   - eigener PID-/IPC-/UTS-Namespace   → keine Sicht auf Host-Prozesse
#   - eigener Mount-Namespace           → Rootfs read-only, Workspace schreibbar
#   - User-Namespace mit UID-Mapping    → unprivilegierter Host-Prozess
#   - no_new_privs + Capability-Drop    → kein Nachziehen von Rechten
#
# Vertrag für Agenten-Argumente: `argv` wird ausschließlich positionell
# übergeben und **nur** über `"$@"` weitergereicht. Es gibt kein `eval`, keine
# String-Verkettung und keine Shell-Interpretation von Argumenten. Ein Argument
# wie `; rm -rf /` bleibt ein einzelnes Argument.
#
# Aufruf: ns-exec.sh <rootfs> <workspace> <argv...>
# ============================================================================
set -eu

if [ "$#" -lt 3 ]; then
  echo "ns-exec: usage: ns-exec.sh <rootfs> <workspace> <argv...>" >&2
  exit 125
fi

ROOTFS=$1
WORK=$2
shift 2

BB="$ROOTFS/bin/busybox"
if [ ! -x "$BB" ]; then
  echo "ns-exec: rootfs has no executable busybox: $ROOTFS" >&2
  exit 126
fi

# Mount-Punkte und Platzhalter müssen vor dem Read-only-Remount existieren.
mkdir -p "$ROOTFS/proc" "$ROOTFS/dev" "$ROOTFS/work" "$ROOTFS/.bob"
for node in null zero random urandom; do
  if [ ! -e "$ROOTFS/dev/$node" ]; then : > "$ROOTFS/dev/$node"; fi
done

# Platzhalter für den Capability-Drop-Helfer (Host-Binary, read-only gebunden).
CAPDROP=/bin/busybox
if [ -x /usr/bin/setpriv ]; then
  : > "$ROOTFS/.bob/setpriv"
  CAPDROP=/.bob/setpriv
  if [ -d "$ROOTFS/lib/x86_64-linux-gnu" ] && [ -e /lib/x86_64-linux-gnu/libcap-ng.so.0 ]; then
    : > "$ROOTFS/lib/x86_64-linux-gnu/libcap-ng.so.0"
    CAPLIB=/lib/x86_64-linux-gnu/libcap-ng.so.0
  fi
fi

# Rootfs read-only, Workspace als einziger schreibbarer Pfad.
"$BB" mount --bind "$ROOTFS" "$ROOTFS"
"$BB" mount -o remount,ro,bind "$ROOTFS"
"$BB" mount --bind "$WORK" "$ROOTFS/work"

# Nur die benötigten Geräte (kein vollständiges /dev des Hosts).
for node in null zero random urandom; do
  "$BB" mount --bind "/dev/$node" "$ROOTFS/dev/$node"
done

# Frischer procfs für den PID-Namespace (zeigt nur Prozesse dieses Namespace).
"$BB" mount -t proc proc "$ROOTFS/proc"

if [ "$CAPDROP" = "/.bob/setpriv" ]; then
  "$BB" mount --bind /usr/bin/setpriv "$ROOTFS/.bob/setpriv"
  if [ -n "${CAPLIB:-}" ]; then
    "$BB" mount --bind "$CAPLIB" "$ROOTFS/lib/x86_64-linux-gnu/libcap-ng.so.0"
  fi
  exec "$BB" chroot "$ROOTFS" /.bob/setpriv --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all -- "$@"
fi

exec "$BB" chroot "$ROOTFS" /bin/busybox setpriv --nnp --inh-caps=-all --ambient-caps=-all -- "$@"
