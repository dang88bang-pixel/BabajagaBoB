#!/usr/bin/env bash
# =============================================================================
# BabajagaBoB in einem Schritt betriebsbereit machen (ohne Container).
#
#   bash scripts/quickstart.sh                 # Start auf Port 3000, Storage .bob-data
#   PORT=3100 bash scripts/quickstart.sh
#   bash scripts/quickstart.sh --verify        # danach die Betriebsprüfungen laufen lassen
#   bash scripts/quickstart.sh --stop          # Instanz wieder anhalten
#
# Ablauf:
#   1. Node-Version prüfen (mindestens 22)
#   2. Abhängigkeiten installieren, falls `node_modules` fehlt
#   3. `.env.local` anlegen (0600) — mit zufälligen Secrets, wenn nicht vorhanden.
#      Die Datei ist bewusst nicht versioniert (`.gitignore` → `.env*`).
#   4. Anwendung bauen, falls `.next/BUILD_ID` fehlt
#   5. Produktionsserver `node server.mjs` starten (Drainage statt hartem Abbruch)
#   6. warten, bis `/api/auth` antwortet
#   7. Creator-Bootstrap durchführen (einmalig) und Cookie ablegen
#   8. Zugangsdaten und nächste Schritte ausgeben
#
# Das Skript ist idempotent: ein zweiter Aufruf startet keinen zweiten Server
# und erzeugt keine neuen Secrets.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

PORT="${PORT:-3000}"
STORAGE="${BOB_STORAGE_DIR:-$REPO/.bob-data}"
ENV_FILE="$REPO/.env.local"
VERIFY=0
STOP=0

for argument in "$@"; do
  case "$argument" in
    --verify) VERIFY=1 ;;
    --stop) STOP=1 ;;
    --port=*) PORT="${argument#--port=}" ;;
    --storage=*) STORAGE="${argument#--storage=}" ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "quickstart: unbekannter Parameter $argument (--help zeigt die Optionen)" >&2; exit 2 ;;
  esac
done

BASE="http://127.0.0.1:${PORT}"
PID_FILE="$STORAGE/quickstart.pid"
LOG_FILE="$STORAGE/server.log"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- --stop -----
if [ "$STOP" = "1" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill -TERM "$(cat "$PID_FILE")" && echo "SIGTERM gesendet (Drainage läuft, Log: $LOG_FILE)"
    rm -f "$PID_FILE"
  else
    echo "keine laufende Instanz gefunden ($PID_FILE fehlt oder Prozess beendet)"
  fi
  exit 0
fi

# ------------------------------------------------------------ 1/6 Node -------
say "1/6 Node prüfen"
if ! command -v node >/dev/null 2>&1; then
  echo "node fehlt — benötigt wird Node 22 oder neuer." >&2; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node $NODE_MAJOR gefunden, benötigt wird 22 oder neuer." >&2; exit 1
fi
echo "  Node $(node -v)"

# ------------------------------------------------- 2/6 Abhängigkeiten --------
say "2/6 Abhängigkeiten"
if [ -d node_modules ] && [ -f node_modules/.package-lock.json ]; then
  echo "  node_modules vorhanden — übersprungen"
else
  npm ci --no-audit --no-fund
fi

# ------------------------------------------------------- 3/6 Umgebung --------
say "3/6 Umgebung ($ENV_FILE)"
mkdir -p "$STORAGE"
chmod 700 "$STORAGE" 2>/dev/null || true
random_secret() { # $1 = Bytes; base64url braucht kein Quoting in env-Dateien.
  node -e 'process.stdout.write(require("node:crypto").randomBytes(Number(process.argv[1])).toString("base64url"))' "$1"
}
if [ -f "$ENV_FILE" ]; then
  echo "  vorhanden — Secrets werden nicht überschrieben"
else
  {
    echo "# BabajagaBoB — lokale Instanz (erzeugt von scripts/quickstart.sh)."
    echo "# Nicht versioniert, nicht weitergeben: enthält echte Secrets."
    echo "PORT=${PORT}"
    echo "BOB_STORAGE_DIR=${STORAGE}"
    echo "BOB_BOOTSTRAP_SECRET=$(random_secret 32)"
    echo "BOB_CREATOR_LOGIN_SECRET=$(random_secret 32)"
    echo "# HMAC-Schlüssel der Session-Schicht (Pflicht in Produktion, mind. 32 Zeichen)."
    echo "# Rotation invalidiert bestehende Sessions bewusst — siehe docs/OPERATIONS.md."
    echo "BOB_SESSION_SECRET=$(random_secret 48)"
    echo "BOB_SANDBOX_RUNTIME=local"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  neu erzeugt (0600): Bootstrap-, Creator- und Session-Secret"
fi
# Nachgezogen: Instanzen aus einer früheren Fassung ohne Session-Secret wären
# in Produktion beim ersten Login mit HTTP 500 gescheitert (fail closed der
# Session-Schicht). Bestehende Werte bleiben unangetastet.
if ! grep -q '^BOB_SESSION_SECRET=.\+' "$ENV_FILE" 2>/dev/null; then
  echo "BOB_SESSION_SECRET=$(random_secret 48)" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  ergänzt: BOB_SESSION_SECRET (Pflicht in Produktion)"
fi

# Ab hier gilt die Umgebung aus der Datei (der Produktionsserver liest sie
# nicht selbst — `node server.mjs` lädt keine `.env`-Dateien).
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
PORT="${PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"

# ------------------------------------------------------------ 4/6 Build ------
say "4/6 Build"
if [ -f .next/BUILD_ID ]; then
  echo "  vorhandener Build (.next/BUILD_ID)"
else
  npm run build
fi

# ----------------------------------------------------------- 5/6 Server ------
say "5/6 Server starten (Port ${PORT})"
if curl -s -o /dev/null -m 2 "$BASE/api/auth" 2>/dev/null; then
  echo "  läuft bereits unter $BASE — kein zweiter Start"
else
  mkdir -p "$STORAGE"
  # Produktionsmodus: `server.mjs` startet ohne NODE_ENV=production den
  # Entwicklungsserver (falscher Betriebsweg, Dev-Lock blockiert weitere
  # Instanzen). Der Build aus Schritt 4 ist dafür die Voraussetzung.
  NODE_ENV=production nohup node server.mjs >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null -m 2 "$BASE/api/auth" 2>/dev/null; then break; fi
    sleep 1
  done
  if ! curl -s -o /dev/null -m 2 "$BASE/api/auth" 2>/dev/null; then
    echo "  Server nicht erreichbar — Log: $LOG_FILE" >&2
    tail -n 20 "$LOG_FILE" >&2 || true
    exit 1
  fi
  echo "  gestartet (PID $(cat "$PID_FILE"), Log $LOG_FILE)"
fi

# -------------------------------------------------------- 6/6 Bootstrap ------
say "6/6 Creator-Bootstrap"
COOKIE_JAR="$STORAGE/quickstart-cookie.txt"
STATUS="$(curl -s "$BASE/api/auth")"
echo "  $(echo "$STATUS" | head -c 200)"

if echo "$STATUS" | grep -q '"requiresBootstrap":true'; then
  SECRET="${BOB_BOOTSTRAP_SECRET:-}"
  if [ -z "$SECRET" ] && [ -f "$BOB_STORAGE_DIR/bootstrap-token" ]; then
    SECRET="$(tr -d '\n\r' < "$BOB_STORAGE_DIR/bootstrap-token")"
  fi
  if [ -z "$SECRET" ]; then
    echo "  kein Bootstrap-Secret auffindbar ($BOB_STORAGE_DIR/bootstrap-token)" >&2; exit 1
  fi
  ANSWER="$(curl -s -c "$COOKIE_JAR" -X POST "$BASE/api/auth" \
    -H 'content-type: application/json' \
    -d "{\"action\":\"bootstrap\",\"secret\":\"$SECRET\",\"creatorName\":\"Creator\"}")"
  chmod 600 "$COOKIE_JAR" 2>/dev/null || true
  echo "  Bootstrap: $(echo "$ANSWER" | head -c 200)"
else
  echo "  bereits initialisiert — Anmeldung mit dem Creator-Secret"
fi

# -------------------------------------------------------------- Ergebnis -----
CREATOR_SECRET="${BOB_CREATOR_LOGIN_SECRET:-}"
CREATOR_SOURCE="BOB_CREATOR_LOGIN_SECRET"
if [ -z "$CREATOR_SECRET" ] && [ -f "$BOB_STORAGE_DIR/creator-token" ]; then
  CREATOR_SECRET="$(tr -d '\n\r' < "$BOB_STORAGE_DIR/creator-token")"
  CREATOR_SOURCE="$BOB_STORAGE_DIR/creator-token"
fi

cat <<EOF

$(printf '\033[1m')Bereit.$(printf '\033[0m')

  Adresse:        $BASE
  Anmeldung:      Creator-Login mit dem Secret aus $CREATOR_SOURCE
  Storage:        $BOB_STORAGE_DIR
  Server-Log:     $LOG_FILE
  Anhalten:       BOB_STORAGE_DIR=$STORAGE bash scripts/quickstart.sh --stop

  Betriebsprüfung (optional):
    BOB_SESSION_COOKIE="\$(sed -n 's/.*bob_session[[:space:]]*//p' $COOKIE_JAR)" \\
      bash scripts/verify-live.sh
EOF

if [ -n "$CREATOR_SECRET" ]; then
  printf '\n  Creator-Secret (jetzt sicher verwahren, wird nicht erneut ausgegeben):\n    %s\n' "$CREATOR_SECRET"
fi

if [ "$VERIFY" = "1" ]; then
  say "Betriebsprüfungen"
  COOKIE_VALUE="$(sed -n 's/.*bob_session[[:space:]]*//p' "$COOKIE_JAR" | tail -n 1 | tr -d '\r\n')"
  BOB_SESSION_COOKIE="$COOKIE_VALUE" BASE="$BASE" bash scripts/verify-live.sh || {
    echo "  Prüfung mit Fehlern beendet (Details oben)." >&2
    exit 1
  }
fi
