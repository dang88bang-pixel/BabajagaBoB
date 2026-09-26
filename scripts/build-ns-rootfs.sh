#!/usr/bin/env bash
# ============================================================================
# Baut den Rootfs für die Namespace-Isolation (Runtime-Isolation REAL_NS).
#
# Der Rootfs ist das "Basis-Image" der isolierten Ausführung: er enthält Node
# (für `argv: ["node", …]`) plus die benötigten Shared Libraries und BusyBox
# (statisch, musl) als Init-/Hilfsbinary (mount, chroot, setpriv, sh).
#
# Aufruf:  bash scripts/build-ns-rootfs.sh [zielverzeichnis]
#          Standardziel: ${BOB_NS_ROOTFS:-${BOB_STORAGE_DIR:-.bob-data}/ns-rootfs}
#
# Hinweis Supply Chain: BusyBox wird aus dem npm-Paket `busybox-static` bezogen
# (devDependency, testbar/versioniert). Für den Produktivbetrieb muss der Rootfs
# vom Betreiber bereitgestellt und geprüft werden (siehe docs/RUNTIME.md).
# ============================================================================
set -euo pipefail

TARGET="${1:-${BOB_NS_ROOTFS:-${BOB_STORAGE_DIR:-.bob-data}/ns-rootfs}}"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "build-ns-rootfs: node nicht gefunden" >&2; exit 1; }

# BusyBox (statisch) lokalisieren: explizite Angabe oder devDependency.
BB="${BOB_NS_BUSYBOX:-}"
if [ -z "$BB" ]; then
  for candidate in \
    "$(dirname "$0")/../node_modules/busybox-static/bin/busybox" \
    "$(dirname "$0")/../node_modules/.bin/busybox"; do
    if [ -x "$candidate" ]; then BB="$candidate"; break; fi
  done
fi

rm -rf "$TARGET"
mkdir -p "$TARGET"/{bin,proc,dev,tmp,work,root}
mkdir -p "$TARGET/lib/x86_64-linux-gnu" "$TARGET/lib64" "$TARGET/usr/lib/x86_64-linux-gnu"

# Node + die von `ldd` gemeldeten Bibliotheken kopieren.
cp "$NODE_BIN" "$TARGET/bin/node"
copy_libs() {
  local binary="$1"
  # Beide ldd-Formen: "lib => /pfad" und der Interpreter selbst ("/lib64/ld-linux…").
  ldd "$binary" 2>/dev/null | awk '{ if ($2 == "=>" && $3 ~ /^\//) print $3; else if ($1 ~ /^\//) print $1 }' | sort -u | while read -r lib; do
    [ -f "$lib" ] || continue
    case "$lib" in
      /lib/x86_64-linux-gnu/*) cp -n "$lib" "$TARGET/lib/x86_64-linux-gnu/" ;;
      /lib64/*) cp -n "$lib" "$TARGET/lib64/" ;;
      /usr/lib/x86_64-linux-gnu/*) cp -n "$lib" "$TARGET/usr/lib/x86_64-linux-gnu/" ;;
    esac
  done
}
copy_libs "$NODE_BIN"

if [ -n "$BB" ] && [ -x "$BB" ]; then
  cp "$BB" "$TARGET/bin/busybox"
  chmod 0755 "$TARGET/bin/busybox"
  # Alle Applets als Symlinks (sh, mount, chroot, setpriv, ip, …).
  while read -r applet; do
    [ -n "$applet" ] || continue
    [ "$applet" = "busybox" ] && continue
    ln -sf busybox "$TARGET/bin/$applet"
  done < <("$TARGET/bin/busybox" --list 2>/dev/null || true)
else
  echo "WARNUNG: BusyBox fehlt (npm i -D busybox-static oder BOB_NS_BUSYBOX setzen)." >&2
  echo "         Ohne BusyBox ist der Rootfs für die Namespace-Isolation unbrauchbar." >&2
  exit 2
fi

chmod 0755 "$TARGET/bin" "$TARGET/work"
echo "Rootfs gebaut: $TARGET"
echo "  node:    $("$TARGET/bin/node" --version 2>/dev/null || echo '-')"
echo "  busybox: $("$TARGET/bin/busybox" 2>&1 | head -1)"
echo "  Größe:   $(du -sh "$TARGET" | cut -f1)"
