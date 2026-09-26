#!/usr/bin/env bash
# ============================================================================
# Startet die Plattform vollständig betriebsbereit — idempotent und in einem
# Schritt. Genau das, was ein Neustart der Maschine erfordert:
#
#   1. Repository-Stand ausrichten (HEAD = Remote, keine Änderungen verlieren)
#   2. Abhängigkeiten installieren            (npm ci)
#   3. cgroup-v2-Delegation einrichten        (scripts/setup-cgroup-delegation.sh)
#   4. Namespace-Rootfs bauen                 (scripts/build-ns-rootfs.sh)
#   5. Anwendung bauen                        (next build)
#   6. Server **innerhalb der Delegation** starten (scripts/cgroup-exec.sh)
#
# Aufruf:
#   bash scripts/dev-up.sh                 # Standard: Port 3000, Storage /tmp/bob-live
#   PORT=3200 STORAGE=/tmp/bob-x bash scripts/dev-up.sh
#
# Ohne `sudo` wird Schritt 3 übersprungen und die Plattform läuft ehrlich mit
# `cgroup: UNAVAILABLE` (Ausführungen mit Speicher-/Prozesslimits werden dann
# verweigert, statt still ohne Limit zu laufen) — siehe docs/RUNTIME.md §2b.
#
# Hinweis: Dieses Skript ist für Entwicklung/Betrieb gedacht. In der CI läuft es
# nicht (kein `sudo`, kein dauerhafter Server); dort gelten `npm test` und die
# Jobs aus .github/workflows/ci.yml.
# ============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
STORAGE="${STORAGE:-/tmp/bob-live}"
CGROUP_DIR="${BOB_CGROUP_DIR:-/sys/fs/cgroup/bob}"
BRANCH="${BRANCH:-$(git -C "$REPO" rev-parse --abbrev-ref HEAD)}"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

say "1/6 Repository-Stand ausrichten ($BRANCH)"
git -C "$REPO" fetch -q origin "$BRANCH" || echo "  (kein Remote-Zugriff — übersprungen)"
if git -C "$REPO" rev-parse -q --verify FETCH_HEAD >/dev/null 2>&1; then
  # Arbeitsbaum unverändert lassen: nur HEAD/Index auf den Remote-Stand setzen,
  # sofern der Inhalt bereits dem Remote entspricht (Reset-Szenario).
  if git -C "$REPO" diff --quiet FETCH_HEAD -- . ':(exclude)node_modules' 2>/dev/null; then
    git -C "$REPO" reset --soft FETCH_HEAD && git -C "$REPO" reset -q HEAD
    echo "  HEAD = $(git -C "$REPO" rev-parse --short HEAD), Arbeitsbaum sauber"
  else
    echo "  HEAD = $(git -C "$REPO" rev-parse --short HEAD), lokale Änderungen bleiben erhalten"
  fi
fi

# Ohne diese Secrets lässt sich eine frische Instanz nicht initialisieren:
# /api/health und /api/control antworten dann mit 428 BOOTSTRAP_REQUIRED, und
# /api/auth bootstrap meldet "no bootstrap secret is configured". Das ist eine
# häufige Stolperfalle beim Bring-up — deshalb hier ausdrücklich warnen.
if [ -z "${BOB_BOOTSTRAP_SECRET:-}" ] || [ -z "${BOB_CREATOR_LOGIN_SECRET:-}" ]; then
  echo "  WARNUNG: BOB_BOOTSTRAP_SECRET/BOB_CREATOR_LOGIN_SECRET sind nicht gesetzt."
  echo "           Eine frische Instanz bleibt damit uninitialisiert (428 BOOTSTRAP_REQUIRED)."
  echo "           Beispiel: BOB_BOOTSTRAP_SECRET=... BOB_CREATOR_LOGIN_SECRET=... bash scripts/dev-up.sh"
fi

say "2/6 Abhängigkeiten installieren"
if [ -d "$REPO/node_modules" ] && [ -f "$REPO/node_modules/.package-lock.json" ]; then
  echo "  node_modules vorhanden — übersprungen (npm ci bei Bedarf manuell)"
else
  (cd "$REPO" && npm ci --no-audit --no-fund)
fi

say "3/6 cgroup-v2-Delegation einrichten ($CGROUP_DIR)"
if [ "$(id -u)" = "0" ]; then
  BOB_CGROUP_DIR="$CGROUP_DIR" bash "$REPO/scripts/setup-cgroup-delegation.sh"
elif sudo -n true 2>/dev/null; then
  sudo -n env BOB_CGROUP_DIR="$CGROUP_DIR" bash "$REPO/scripts/setup-cgroup-delegation.sh"
else
  echo "  kein sudo verfügbar — Plattform läuft mit cgroup: UNAVAILABLE (fail closed für Limits)"
fi

say "4/6 Namespace-Rootfs bauen"
mkdir -p "$STORAGE"
if [ -x "$STORAGE/ns-rootfs/bin/busybox" ] || [ -d "$STORAGE/ns-rootfs/bin" ]; then
  echo "  Rootfs vorhanden: $STORAGE/ns-rootfs"
else
  BOB_STORAGE_DIR="$STORAGE" bash "$REPO/scripts/build-ns-rootfs.sh"
fi

say "5/6 Anwendung bauen"
(cd "$REPO" && npm run build)

say "6/6 Server starten (Port $PORT, Storage $STORAGE)"
echo "  Log: $STORAGE/server.log — Stoppen mit: pkill -f 'next start'"
cd "$REPO"
export BOB_STORAGE_DIR="$STORAGE" BOB_CGROUP_DIR="$CGROUP_DIR" BOB_NS_ISOLATION="${BOB_NS_ISOLATION:-on}" \
       BOB_SANDBOX_RUNTIME="${BOB_SANDBOX_RUNTIME:-local}" PORT
if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
  exec bash "$REPO/scripts/cgroup-exec.sh" npx next start -p "$PORT" -H 0.0.0.0
else
  exec npx next start -p "$PORT" -H 0.0.0.0
fi
