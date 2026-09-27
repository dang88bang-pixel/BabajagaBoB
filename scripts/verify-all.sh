#!/usr/bin/env bash
# =============================================================================
# Vollständige Betriebsprüfung einer Instanz in einem Schritt.
#
#   BOB_SESSION_COOKIE=… BASE=http://127.0.0.1:3000 bash scripts/verify-all.sh
#   bash scripts/verify-all.sh                 # eigene Prüfinstanz auf Port 3300
#   bash scripts/verify-all.sh --port=3400 --keep   # Instanz nachher laufen lassen
#
# Was geprüft wird (jeweils mit dem echten Prüfskript, keine Sonderwege):
#
#   1. scripts/verify-live.sh     – durchgängige Kette inkl. Kernel-Isolation
#   2. scripts/audit-api.sh       – jede Route im Betrieb, Robustheit, Regression
#   3. scripts/audit-actions.mjs  – jede Aktion, Attribute, 14 Interaktionsketten
#   4. scripts/audit-ui.mjs       – Auslieferung, Datenverträge, keine Geheimnisse
#   5. scripts/acceptance.mjs     – Abnahmematrix statisch und live
#
# Ohne `BASE` startet das Skript eine eigene, verworfene Prüfinstanz (frischer
# Storage, angehobenes Prüfbudget `BOB_RATE_LIMIT_MAX=100000`): Die Suiten
# stellen zusammen weit mehr Anfragen als das Standardbudget zulässt, sonst
# würden sie sich gegenseitig mit `429` blockieren. Die Grenze selbst wird
# deshalb **separat** mit dem Standardbudget nachgewiesen:
# `scripts/verify-rate-limit.sh` (frische Instanz, eigene Kennungen).
#
# Exit-Code 0 nur, wenn jede Suite ohne Fehlschlag endet.
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

BASE_INPUT="${BASE:-}"
PORT="3300"
STORAGE="${STORAGE:-${TMPDIR:-/tmp}/bob-verify-$$}"
KEEP=0
OWN=0

for argument in "$@"; do
  case "$argument" in
    --port=*) PORT="${argument#--port=}" ;;
    --storage=*) STORAGE="${argument#--storage=}" ;;
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "verify-all: unbekannter Parameter $argument (--help zeigt die Optionen)" >&2; exit 2 ;;
  esac
done

SUMMARY=""
FAILED=0
SERVER_PID=""

record() { # record <name> <ausgabe>
  local name="$1" output="$2" line
  line="$(printf '%s' "$output" | grep -E 'Ergebnis' | tail -n 1)"
  [ -z "$line" ] && line="$(printf '%s' "$output" | grep -iE '(bestanden|failed|fehlgeschlagen)' | tail -n 1)"
  # (Command-Substitution schneidet `\n` am Ende ab — deshalb explizit anhängen,
  # sonst läuft die Zusammenfassung in einer Zeile zusammen.)
  SUMMARY+="$(printf '  %-28s %s' "$name" "${line:-ohne Ergebniszeile}")"$'\n'
  if printf '%s' "$output" | grep -qE '[1-9][0-9]* (fehlgeschlagen|failed)'; then FAILED=1; fi
  if [ -z "$line" ]; then FAILED=1; fi # Suite ohne Ergebniszeile (z. B. Abbruch) ist kein Erfolg.
}

cleanup() {
  if [ -n "$SERVER_PID" ] && [ "$KEEP" = "0" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --------------------------------------------------------------- Instanz -----
if [ -z "$BASE_INPUT" ]; then
  OWN=1
  echo "== Eigene Prüfinstanz (Port $PORT, Storage $STORAGE)"
  command -v jq >/dev/null 2>&1 || { echo "jq fehlt (die Prüfskripte brauchen es)." >&2; exit 1; }
  if [ ! -f .next/BUILD_ID ]; then echo "Build fehlt — bitte 'npm run build' ausführen." >&2; exit 1; fi
  mkdir -p "$STORAGE"
  # Kernel-Isolation prüfen statt voraussetzen: Ohne Rootfs meldet die Instanz
  # ehrlich FILESYSTEM_ONLY und alle isolationsabhängigen Prüfungen scheitern.
  # Der Bau ist schnell (< 2 s) und braucht kein sudo.
  if [ ! -x "$STORAGE/ns-rootfs/bin/busybox" ]; then
    echo "  Namespace-Rootfs wird gebaut ($STORAGE/ns-rootfs) …"
    BOB_STORAGE_DIR="$STORAGE" bash scripts/build-ns-rootfs.sh > "$STORAGE/ns-rootfs-build.log" 2>&1 || {
      echo "  Rootfs-Bau fehlgeschlagen — Log: $STORAGE/ns-rootfs-build.log" >&2
      tail -n 10 "$STORAGE/ns-rootfs-build.log" >&2
      exit 1
    }
  fi
  # Geräte-Enrollment: Die Suiten prüfen beide Richtungen — ohne Geheimnis in
  # der *Anfrage* (fail closed) und mit Geheimnis (nur Discovery/Heartbeat).
  # Dafür muss das Geheimnis *serverseitig* konfiguriert sein; sonst antwortet
  # Enrollment mit 503 und sieben Prüfungen scheitern. Nicht gesetzt? Dann wird
  # eines für Server und Suiten erzeugt (reine Prüfinstanz, wird verworfen).
  if [ -z "${BOB_DEVICE_ENROLLMENT_SECRET:-}" ]; then
    BOB_DEVICE_ENROLLMENT_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"
    export BOB_DEVICE_ENROLLMENT_SECRET
    echo "  Enrollment-Geheimnis für die Prüfinstanz erzeugt"
  fi
  # Speicher-/Prozesslimits brauchen die cgroup-v2-Delegation. Ist sie nutzbar,
  # startet die Instanz innerhalb des Baums (sonst scheitern die
  # ressourcenabhängigen Prüfungen — ehrlich, aber rot).
  CGROUP_ROOT="${BOB_CGROUP_DIR:-/sys/fs/cgroup/bob}"
  USE_CGROUP=0
  if [ -w "$CGROUP_ROOT/cgroup.procs" ] && { [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; }; then
    USE_CGROUP=1
  else
    echo "  Hinweis: keine nutzbare cgroup-Delegation unter $CGROUP_ROOT —"
    echo "  ressourcenabhängige Prüfungen werden als UNAVAILABLE scheitern."
    echo "  (sudo BOB_CGROUP_DIR=$CGROUP_ROOT bash scripts/setup-cgroup-delegation.sh)"
  fi
  BOOTSTRAP="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"
  CREATOR="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"
  SESSION_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))')"
  # Die Prüfinstanz wird direkt über localhost angesprochen — ohne Proxy. Deshalb
  # wird `BOB_TRUST_PROXY` ausdrücklich auf 0 festgenagelt: Der Next-Server lädt
  # sonst `.env.local` aus dem Projektverzeichnis nach (nur für ungesetzte
  # Variablen) und würde ein dort für die Hauptinstanz konfiguriertes
  # `BOB_TRUST_PROXY=1` erben. Folge (gemessen): Jede Anfrage trägt dann
  # `x-forwarded-for: 127.0.0.1`, die Betriebsgrenze identifiziert alle Clients
  # als eine Identität und das Standardbudget wäre global statt pro Client.
  export NODE_ENV=production BOB_STORAGE_DIR="$STORAGE" BOB_BOOTSTRAP_SECRET="$BOOTSTRAP" BOB_CREATOR_LOGIN_SECRET="$CREATOR" \
    BOB_SESSION_SECRET="$SESSION_KEY" BOB_SANDBOX_RUNTIME=local BOB_TRUST_PROXY=0 \
    BOB_RATE_LIMIT_MAX=100000 BOB_AUTH_RATE_LIMIT_MAX=100000 PORT="$PORT" BOB_HOSTNAME=127.0.0.1
  if [ "$USE_CGROUP" = "1" ]; then
    BOB_CGROUP_DIR="$CGROUP_ROOT" bash scripts/cgroup-exec.sh node server.mjs > "$STORAGE/server.log" 2>&1 &
  else
    node server.mjs > "$STORAGE/server.log" 2>&1 &
  fi
  SERVER_PID=$!
  for _ in $(seq 1 60); do
    curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/api/auth" && break
    sleep 1
  done
  curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/api/auth" || { echo "Prüfinstanz nicht erreichbar: $STORAGE/server.log" >&2; exit 1; }
  # Die Antwort darf NICHT `bootstrap.json` heißen: Das ist der Dateiname des
  # Bootstrap-Stores — die Shell würde ihn beim Umleiten vorher auf 0 Bytes
  # kürzen und der Server mit `StoreIntegrityError` antworten (gemessen).
  curl -s -c "$STORAGE/cookie.txt" -X POST "http://127.0.0.1:$PORT/api/auth" \
    -H 'content-type: application/json' \
    -d "{\"action\":\"bootstrap\",\"secret\":\"$BOOTSTRAP\",\"creatorName\":\"Verify\"}" > "$STORAGE/verify-bootstrap-response.json"
  grep -q '"ok":true' "$STORAGE/verify-bootstrap-response.json" || { echo "Bootstrap fehlgeschlagen:"; cat "$STORAGE/verify-bootstrap-response.json"; exit 1; }
  export BASE="http://127.0.0.1:$PORT"
  export BOB_SESSION_COOKIE="$(sed -n 's/.*bob_session[[:space:]]*//p' "$STORAGE/cookie.txt" | tail -n 1 | tr -d '\r\n')"
  export BOB_CREATOR_LOGIN_SECRET="$CREATOR"
else
  export BASE="$BASE_INPUT"
fi

echo "== Prüfungen gegen $BASE"
[ -n "${BOB_SESSION_COOKIE:-}" ] || echo "  (ohne BOB_SESSION_COOKIE — Live-Routenprüfungen können 401 melden)"

# ------------------------------------------------------------- 1..5 Suiten ---
echo; echo "== 1/5 verify-live.sh"
OUT="$(bash scripts/verify-live.sh 2>&1)"; echo "$OUT" | tail -n 4; record "verify-live.sh" "$OUT"

echo; echo "== 2/5 audit-api.sh"
OUT="$(bash scripts/audit-api.sh 2>&1)"; echo "$OUT" | tail -n 4; record "audit-api.sh" "$OUT"

echo; echo "== 3/5 audit-actions.mjs"
OUT="$(node scripts/audit-actions.mjs 2>&1)"; echo "$OUT" | tail -n 4; record "audit-actions.mjs" "$OUT"

echo; echo "== 4/5 audit-ui.mjs"
OUT="$(node scripts/audit-ui.mjs 2>&1)"; echo "$OUT" | tail -n 4; record "audit-ui.mjs" "$OUT"

echo; echo "== 5/5 acceptance.mjs (statisch + live)"
OUT="$(node scripts/acceptance.mjs 2>&1)"; echo "$OUT" | tail -n 3; record "acceptance.mjs" "$OUT"
OUT="$(node scripts/acceptance.mjs --live 2>&1)"; echo "$OUT" | tail -n 3; record "acceptance.mjs --live" "$OUT"

echo; echo "== Zusammenfassung"
printf '%s' "$SUMMARY"
if [ "$OWN" = "1" ] && [ "$KEEP" = "0" ]; then echo "  Prüfinstanz wird beendet (Storage bleibt: $STORAGE)"; fi

if [ "$FAILED" = "0" ]; then echo; echo "Ergebnis: alle Suiten ohne Fehlschlag."; exit 0; fi
echo; echo "Ergebnis: mindestens eine Suite meldet Fehlschläge (siehe oben)." >&2
exit 1
