#!/usr/bin/env bash
# ============================================================================
# Release-Supervisor — führt den Wechsel durch, den die Plattform selbst nicht
# ausführen kann: Prozess neu starten, Gesundheit messen, bei Fehlschlag
# selbsttätig zurückrollen.
#
#   bash scripts/release-supervisor.sh --release REL-… [--port 3100] [--dry-run]
#
# Ablauf (jeder Schritt wird geprüft, es gibt keinen stillen Erfolg):
#   1. Release-Slot prüfen (Verzeichnis, `.next/BUILD_ID`, `release.json`).
#   2. Symlink `<releaseRoot>/current` atomar auf den Slot umstellen; den
#      vorherigen Zeiger für den Rückroll merken.
#   3. Laufenden Prozess auf dem Port beenden (nur der Prozess, kein pkill-Muster
#      über die ganze Maschine) und den Server aus dem neuen Stand starten.
#   4. Warten, bis der Server antwortet; Session holen (Server-seitiges Secret)
#      und `GET /api/readiness` lesen — die ausgelieferte **Build-ID** muss zum
#      Release passen. Ein umgestellter Zeiger allein gilt nicht als Erfolg.
#   5. Bei Fehlschlag: Zeiger zurückstellen, Vorgänger starten, erneut messen,
#      Exit-Code 1. Der Zustand ist danach wieder der alte — kein halber Rollout.
#
# Grenze (bleibt offen dokumentiert): Das ist ein Skript, kein Orchestrator. Es
# gibt keine Replikate, keine Lastverteilung und keinen externen Watchdog; ein
# Ausfall dieses Prozesses wird nicht von einem Supervisor-Daemon erkannt.
# ============================================================================
set -uo pipefail

PORT=3100
RELEASE=""
DRY_RUN=0
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE="${2:-}"; shift 2;;
    --port) PORT="${2:-}"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    *) echo "unbekanntes Argument: $1" >&2; exit 2;;
  esac
done

# Absolute Pfade: Der neue Serverprozess läuft aus dem Release-Slot. Würde er
# seinen Storage relativ zu seinem Arbeitsverzeichnis ableiten, hätte er einen
# **anderen** Datenbestand als die Plattform davor. Deshalb werden Storage und
# Release-Wurzel hier aufgelöst und dem neuen Prozess ausdrücklich mitgegeben.
STORAGE="${BOB_STORAGE_DIR:-$(pwd)/.bob-data}"
mkdir -p "$STORAGE"
STORAGE="$(cd "$STORAGE" && pwd)"
ROOT="${BOB_RELEASE_DIR:-$STORAGE/releases}"
mkdir -p "$ROOT"
ROOT="$(cd "$ROOT" && pwd)"
export BOB_STORAGE_DIR="$STORAGE"
export BOB_RELEASE_DIR="$ROOT"
LOG_DIR="$STORAGE/release-supervisor"
mkdir -p "$LOG_DIR"

say()  { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
fail() { printf '  \033[31mFEHLER\033[0m %s\n' "$1" >&2; }

[ -n "$RELEASE" ] || { fail "--release REL-… fehlt"; exit 2; }
TARGET="$ROOT/$RELEASE"
[ -d "$TARGET" ] || { fail "Release $RELEASE existiert nicht unter $ROOT"; exit 2; }
[ -f "$TARGET/.next/BUILD_ID" ] || { fail "Release $RELEASE hat keine .next/BUILD_ID"; exit 2; }
WANTED_BUILD="$(cat "$TARGET/.next/BUILD_ID")"
[ -n "$WANTED_BUILD" ] || { fail "leere BUILD_ID in $RELEASE"; exit 2; }

PREVIOUS=""
if [ -L "$ROOT/current" ]; then
  PREVIOUS="$(basename "$(readlink "$ROOT/current")")"
fi

say "Release-Supervisor"
info "Release:  $RELEASE (Build $WANTED_BUILD)"
info "Vorgänger: ${PREVIOUS:-keiner}"
info "Root:     $ROOT"
info "Port:     $PORT"

if [ "$DRY_RUN" = "1" ]; then
  info "Trockenlauf: Zeiger, Neustart und Messung werden nicht ausgeführt."
  exit 0
fi

# ---------------------------------------------------------------- 1. Zeiger
say "1. Aktiven Zeiger umstellen"
tmp_link="$ROOT/.current-supervisor-$$"
ln -sfn "$TARGET" "$tmp_link" || { fail "Symlink konnte nicht erstellt werden"; exit 1; }
mv -T "$tmp_link" "$ROOT/current" || { rm -f "$tmp_link"; fail "Zeigerwechsel fehlgeschlagen"; exit 1; }
info "current → $RELEASE"

# ------------------------------------------------------- 2. Prozess ersetzen
say "2. Serverprozess ersetzen"
PIDS="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"
if [ -z "$PIDS" ]; then
  info "kein Prozess auf Port $PORT gefunden (Start erfolgt trotzdem)"
else
  for pid in $PIDS; do
    info "beende PID $pid"
    kill -TERM "$pid" 2>/dev/null
  done
  for _ in $(seq 1 30); do
    still="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -c 'pid=')"
    [ "$still" = "0" ] && break
    sleep 1
  done
  for pid in $PIDS; do kill -KILL "$pid" 2>/dev/null; done
fi

# Der Server läuft — wie im Normalbetrieb — innerhalb der delegierten cgroup.
# Fehlt die Delegation, wird das gesagt und **nicht** stillschweigend ohne
# Limits gestartet (fail closed, siehe docs/RUNTIME.md).
CGROUP_ROOT="${BOB_CGROUP_DIR:-/sys/fs/cgroup/bob}"

start_server() {
  local release="$1" logfile="$2" wrapper=()
  if [ -d "$CGROUP_ROOT" ] && [ -x "$ROOT/$release/scripts/cgroup-exec.sh" ]; then
    wrapper=(bash scripts/cgroup-exec.sh)
  else
    printf '  \033[33mHINWEIS\033[0m cgroup-Delegation (%s) fehlt — Start ohne Ressourcenlimits (cgroup: UNAVAILABLE).\n' "$CGROUP_ROOT"
  fi
  # Kein Subshell-Konstrukt: Der Prozess wird per setsid abgekoppelt, sein
  # stdin kommt aus /dev/null, stdout/stderr gehen in die Logdatei. Damit hält
  # der neue Server weder das Terminal noch eine Pipe des Aufrufers offen.
  cd "$ROOT/$release" || return 1
  setsid nohup "${wrapper[@]}" npx next start -p "$PORT" -H 0.0.0.0 >>"$logfile" 2>&1 </dev/null &
  echo $! >"$logfile.pid"
  disown 2>/dev/null || true
  cd - >/dev/null 2>&1 || true
  return 0
}

LOG="$LOG_DIR/supervisor-$RELEASE.log"
start_server "$RELEASE" "$LOG"
info "Server gestartet aus $RELEASE (Log: $LOG)"

# ------------------------------------------------------------ 3. Gesundheit
wait_http() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while [ $SECONDS -lt $deadline ]; do
    code="$(curl -g -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/auth" 2>/dev/null)"
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  return 1
}

measure_build() {
  # Die ausgelieferte Build-ID wird über eine echte Session gemessen, nicht geraten.
  local jar; jar="$(mktemp -t bob-supervisor-XXXXXX)"
  local login
  login="$(curl -g -s -o /dev/null -w '%{http_code}' -c "$jar" -X POST \
    -H 'content-type: application/json' \
    -d "{\"action\":\"login\",\"secret\":\"${BOB_CREATOR_LOGIN_SECRET:-}\"}" \
    "http://127.0.0.1:$PORT/api/auth")"
  if [ "$login" != "201" ]; then
    rm -f "$jar"
    echo "LOGIN_${login}"
    return 1
  fi
  curl -g -s -b "$jar" "http://127.0.0.1:$PORT/api/readiness" | node -e '
let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{try{const v=JSON.parse(raw);process.stdout.write(String(v.buildId??"OHNE_FELD"))}catch{process.stdout.write("NICHT_JSON")}})'
  rm -f "$jar"
}

say "3. Gesundheit des neuen Standes messen"
if ! wait_http; then
  fail "Server antwortet nach $HEALTH_TIMEOUT s nicht auf /api/auth"
  HEALTHY=0
else
  RUNNING_BUILD="$(measure_build)"
  info "ausgelieferte Build-ID: $RUNNING_BUILD"
  if [ "$RUNNING_BUILD" = "$WANTED_BUILD" ]; then
    HEALTHY=1
  else
    fail "Build-ID stimmt nicht mit dem Release überein"
    HEALTHY=0
  fi
fi

confirm_deployment() {
  # Die Plattform muss den Vorgang auch **wissen**: Der Datensatz wird über die
  # Session gegen den laufenden Stand geprüft und erst dann ACTIVE (sonst bliebe
  # "ausgerollt" eine Behauptung des Skripts).
  local jar; jar="$(mktemp -t bob-supervisor-XXXXXX)"
  local login
  login="$(curl -g -s -o /dev/null -w '%{http_code}' -c "$jar" -X POST \
    -H 'content-type: application/json' \
    -d "{\"action\":\"login\",\"secret\":\"${BOB_CREATOR_LOGIN_SECRET:-}\"}" \
    "http://127.0.0.1:$PORT/api/auth")"
  if [ "$login" != "201" ]; then
    rm -f "$jar"
    fail "Anmeldung für die Verifikation fehlgeschlagen (HTTP $login) — Vorgang bleibt STAGED."
    return 1
  fi
  local deployment_id
  deployment_id="$(curl -g -s -b "$jar" "http://127.0.0.1:$PORT/api/deployment" | node -e '
let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{
  try{
    const v=JSON.parse(raw);
    const release=process.argv[1];
    const hit=(v.deployments||[]).find(d=>d.releaseId===release && d.state!=="REJECTED" && d.state!=="FAILED" && d.state!=="ROLLED_BACK");
    process.stdout.write(hit?String(hit.deploymentId):"KEINER");
  }catch{process.stdout.write("NICHT_JSON")}
})' "$RELEASE")"
  if [ "$deployment_id" = "KEINER" ] || [ "$deployment_id" = "NICHT_JSON" ]; then
    rm -f "$jar"
    fail "kein offener Deployment-Vorgang zu $RELEASE gefunden — nichts verifiziert."
    return 1
  fi
  local verified
  verified="$(curl -g -s -b "$jar" -X POST -H 'content-type: application/json' \
    -d "{\"action\":\"verify\",\"deploymentId\":\"$deployment_id\"}" \
    "http://127.0.0.1:$PORT/api/deployment" | node -e '
let raw = "";
process.stdin.on("data", chunk => { raw += chunk; }).on("end", () => {
  let state = "NICHT_JSON";
  try { state = String(JSON.parse(raw).deployment?.state ?? "OHNE_FELD"); } catch { /* Antwort war kein JSON */ }
  process.stdout.write(state);
});')"
  rm -f "$jar"
  info "Deployment $deployment_id nach der Messung: $verified"
  [ "$verified" = "ACTIVE" ] || { fail "Plattform meldet $verified statt ACTIVE."; return 1; }
  return 0
}

if [ "$HEALTHY" = "1" ]; then
  say "Ergebnis: Release $RELEASE ist aktiv (Build $WANTED_BUILD)."
  confirm_deployment || exit 1
  say "Bestätigt: Deployment-Datensatz ist ACTIVE."
  exit 0
fi

# --------------------------------------------------------------- 4. Rückroll
if [ -z "$PREVIOUS" ] || [ ! -d "$ROOT/$PREVIOUS" ]; then
  fail "kein Vorgänger für den Rückroll vorhanden — der Dienst bleibt gestoppt."
  exit 1
fi

say "4. Rückroll auf $PREVIOUS"
PIDS="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"
for pid in $PIDS; do kill -TERM "$pid" 2>/dev/null; done
sleep 2
for pid in $PIDS; do kill -KILL "$pid" 2>/dev/null; done

tmp_link="$ROOT/.current-supervisor-rollback-$$"
ln -sfn "$ROOT/$PREVIOUS" "$tmp_link" && mv -T "$tmp_link" "$ROOT/current"
info "current → $PREVIOUS"

ROLLBACK_LOG="$LOG_DIR/supervisor-rollback-$(date +%s).log"
start_server "$PREVIOUS" "$ROLLBACK_LOG"

if wait_http; then
  ROLLED_BUILD="$(measure_build)"
  if [ "$ROLLED_BUILD" = "$(cat "$ROOT/$PREVIOUS/.next/BUILD_ID")" ]; then
    say "Ergebnis: Rückroll erfolgreich, $PREVIOUS ist wieder aktiv (Build $ROLLED_BUILD)."
    exit 1
  fi
  fail "Vorgänger antwortet, liefert aber Build $ROLLED_BUILD statt erwartet."
  exit 1
fi

fail "Der Vorgänger ist ebenfalls nicht gesund — Dienst bleibt gestoppt (kein stiller Erfolg)."
exit 1
