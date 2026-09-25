#!/usr/bin/env bash
# ============================================================================
# Vollständiger API-Durchlauf (Betriebsprüfung) gegen die laufende Plattform.
#
#   BASE=http://localhost:3000 BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=… \
#     bash scripts/audit-api.sh
#
# Geprüft wird, was der Live-Nachweis (scripts/verify-live.sh) NICHT abdeckt:
#
#  1. Jede GET-Route antwortet mit Session (kein 5xx, keine leeren Antworten).
#  2. Jede POST-Route verkraftet unlesbare/leere Nutzdaten: kein 5xx
#     (eine 4xx ist die richtige Antwort).
#  3. Keine Route ist ohne Session erreichbar (401/428 statt Ausführung).
#  4. create/register-Aktionen lehnen unvollständige Nutzdaten mit 4xx ab und
#     persistieren **keinen** inhaltslosen Datensatz (kein Scheinzustand).
#  5. Bekannte Fehlerbilder bleiben geschlossen (Regression):
#       - Laufzeit-/Werkzeug-Registry speichert nicht den Request-Umschlag,
#       - Geräte-Discovery erzeugt kein Gerät ohne Identität,
#       - `/api/apps`, `/api/reliability`, `/api/runs` liefern echte Daten
#         (kein serialisiertes Promise = leerer Body).
#  6. Autonome Fehlerkette: Dispatch → Worker-Zyklus → Fehler-Incident mit
#     FIXING/Evidenz/Experiment/Plan → Lauf in Verifikation, Job zurückgestellt.
#
# Das Skript bricht nie ab, sondern zählt PASS/FAIL und gibt die echte
# Serverantwort aus. Aufruf gegen eine frische Instanz empfohlen.
# ============================================================================
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
JAR="$(mktemp -t bob-audit-XXXXXX)"
BODY="$(mktemp -t bob-audit-body-XXXXXX)"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf "  \033[32mPASS\033[0m %s\n" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "  \033[31mFAIL\033[0m %s\n" "$1"; [ -n "${2:-}" ] && printf "        %s\n" "$2"; }
step() { printf "\n\033[1m%s\033[0m\n" "$1"; }
body() { head -c 200 "$BODY" | tr -d '\n'; }
jqv()  { jq -r "$1" "$BODY" 2>/dev/null; }
# Feld aus einer bereits geholten Antwort lesen (z. B. eine angelegte ID).
jqf()  { printf '%s' "$2" | jq -r "$1" 2>/dev/null; }
api()  { curl -s -b "$JAR" -c "$JAR" -o "$BODY" -w '%{http_code}' -H 'content-type: application/json' "$@"; }
raw()  { curl -s -o "$BODY" -w '%{http_code}' -H 'content-type: application/json' "$@"; }

assert_status() { if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1: erwartet $2, erhalten $3" "$(body)"; fi; }
assert_not5xx() { case "$3" in 5*) bad "$1: Serverfehler $3" "$(body)";; *) ok "$1 ($3)";; esac; }
assert_json()   { if jq -e "$2" "$BODY" >/dev/null 2>&1; then ok "$1"; else bad "$1" "$(body)"; fi; }

# ---------------------------------------------------------------- Anmeldung
step "0. Anmeldung"
if [ "$(raw "$BASE/api/auth")" = "200" ] && jq -e '.initialized == false' "$BODY" >/dev/null 2>&1; then
  assert_status "Creator-Bootstrap" 201 "$(raw -c "$JAR" -X POST -d "{\"action\":\"bootstrap\",\"secret\":\"${BOB_BOOTSTRAP_SECRET:-}\",\"creatorName\":\"Audit\"}" "$BASE/api/auth")"
fi
SECRET="${BOB_CREATOR_LOGIN_SECRET:-}"
assert_status "Creator-Login" 201 "$(api -X POST -d "{\"action\":\"login\",\"secret\":\"$SECRET\"}" "$BASE/api/auth")"

# ------------------------------------------------------- 1. GET-Routen
step "1. Jede GET-Route mit Session (kein 5xx, keine leere Antwort)"
for route in $(find app/api -name route.ts | sed 's|app/api/||; s|/route.ts||' | sort); do
  [ "$route" = "auth" ] && continue
  code=$(api "$BASE/api/$route")
  case "$code" in
    2*) if [ -s "$BODY" ]; then ok "GET /api/$route ($code)"; else bad "GET /api/$route: leere Antwort"; fi;;
    405) ok "GET /api/$route (405 = nur POST)";;
    5*) bad "GET /api/$route: Serverfehler $code" "$(body)";;
    *) bad "GET /api/$route: unerwartet $code" "$(body)";;
  esac
done

# --------------------------------------------- 2. POST-Robustheit
step "2. POST-Routen mit unlesbaren/leeren Nutzdaten (kein 5xx)"
for route in $(find app/api -name route.ts | sed 's|app/api/||; s|/route.ts||' | sort); do
  [ "$route" = "auth" ] && continue
  for payload in '{kaputt' ''; do
    code=$(api -X POST -d "$payload" "$BASE/api/$route")
    assert_not5xx "POST /api/$route (Body: '${payload:-leer}')" 400 "$code"
  done
done

# --------------------------------------------- 3. Ohne Session
step "3. POST-Routen ohne Session (Guard greift vor der Verarbeitung)"
for route in dispatcher execution-gate promotion-gate runs secrets; do
  code=$(raw -X POST -d '{kaputt' "$BASE/api/$route")
  case "$code" in
    401|403|428) ok "POST /api/$route ohne Session → $code";;
    *) bad "POST /api/$route ohne Session: erwartet 401/403/428, erhalten $code" "$(body)";;
  esac
done

# --------------------------------------------- 4. Unvollständige Nutzdaten
step "4. create/register lehnt unvollständige Nutzdaten ab (kein Scheinzustand)"
rejects() { # rejects <route> <payload> <label>
  assert_status "$3" 400 "$(api -X POST -d "$2" "$BASE/api/$1")"
}
rejects skills       '{"action":"register"}'                          "Skills: ohne Definition"
rejects skills       '{"action":"register","skill":{}}'               "Skills: leere Definition"
rejects workshop     '{"action":"create","value":{}}'                 "Werkstatt: leeres Objekt"
rejects simulation   '{"action":"create","scenario":{}}'              "Simulation: leeres Szenario"
rejects apps         '{"action":"create","value":{}}'                 "Apps: leere App"
rejects cicd         '{"action":"create","value":{}}'                 "CI/CD: leere Pipeline"
rejects errors       '{"action":"create","input":{}}'                 "Fehler: leerer Incident"
rejects reliability  '{"action":"failure","value":{}}'                "Reliability: leerer Failure"
rejects computer-use '{"action":"register","computer":{}}'            "Computer Use: leerer Rechner"
rejects devices      '{"action":"discover","device":{}}'              "Geräte: Discovery ohne Identität"
rejects runtimes     '{"action":"register","input":{}}'               "Registry: leere Laufzeit"
rejects tools        '{"action":"register","tool":{}}'                "Registry: leeres Werkzeug"
rejects science      '{"action":"objective","value":{}}'              "Science: leeres Ziel"
rejects science      '{"action":"experiment","value":{}}'             "Science: leeres Experiment"
rejects secrets      '{"action":"issue"}'                             "Secrets: Lease ohne Subjekt"
rejects execution-gate '{}'                                           "Execution Gate: ohne taskId"

# --------------------------------------------- 5. Bekannte Fehlerbilder
step "5. Regression: frühere Fehlerbilder bleiben geschlossen"
# Eindeutige Kennungen: das Skript ist wiederholbar (auch gegen eine bereits
# initialisierte Instanz), ohne die Registry mit Dubletten zu füllen.
STAMP="$RANDOM$RANDOM"
assert_status "Laufzeit mit Definition wird angenommen" 201 "$(api -X POST -d "{\"action\":\"register\",\"input\":{\"id\":\"runtime.audit.$STAMP\",\"name\":\"Audit\",\"version\":\"1\",\"kind\":\"CUSTOM\",\"platforms\":[\"linux\"],\"architectures\":[\"x64\"],\"buildCommands\":[],\"testCommands\":[],\"sandboxSupport\":true,\"networkDefault\":\"DENY\"}}" "$BASE/api/runtimes")"
assert_json "Laufzeit hat kein action-Feld (kein Request-Umschlag gespeichert)" '(.runtime | has("action")) | not'
assert_status "Werkzeug mit Definition wird angenommen" 201 "$(api -X POST -d "{\"action\":\"register\",\"tool\":{\"id\":\"tool.audit.$STAMP\",\"version\":\"1.0.0\",\"name\":\"Audit\",\"description\":\"Pruefwerkzeug\",\"inputSchema\":{},\"capabilities\":[],\"allowedEnvironments\":[\"test\"],\"risk\":\"LOW\",\"timeoutMs\":1000,\"resourceLimits\":{\"cpuMillicores\":100,\"memoryMb\":128},\"network\":\"DENY\",\"sideEffects\":[],\"reversible\":true,\"approvalRequired\":false}}" "$BASE/api/tools")"
assert_json "Werkzeug hat kein action-Feld" '(.tool | has("action")) | not'

api "$BASE/api/devices" >/dev/null
assert_json "Keine Geräte ohne Identität im Bestand" '[.devices[] | select((.id // "") == "")] | length == 0'
api "$BASE/api/skills" >/dev/null
assert_json "Keine Skills ohne Identität im Bestand" '[.skills[] | select((.id // "") == "")] | length == 0'
api "$BASE/api/runtimes" >/dev/null
assert_json "Keine Laufzeiten ohne Identität" '[.runtimes[] | select((.id // "") == "")] | length == 0'
api "$BASE/api/workshop" >/dev/null
assert_json "Keine Werkstatt-Objekte ohne Namen" '[.items[] | select((.name // "") == "")] | length == 0'

# Antworten dürfen kein serialisiertes Promise (leeres Objekt) sein.
assert_status "Installation eines unbekannten Moduls ist ein Fehler" 400 "$(api -X POST -d '{"action":"install-module","moduleId":"MOD-gibtsnicht","approvalId":"APR-x"}' "$BASE/api/apps")"
assert_json "Fehlermeldung statt leerem Erfolg" '.error != null'
assert_status "Verifikation einer unbekannten Recovery ist ein Fehler" 400 "$(api -X POST -d '{"action":"verify","id":"REC-gibtsnicht"}' "$BASE/api/reliability")"
assert_json "Fehlermeldung statt leerem Plan" '.error != null'
# Unbekannter Lauf: 409 (ungültiger Übergang) oder 400 — Hauptsache Fehler statt leerer Erfolg.
code=$(api -X POST -d '{"action":"recover","runId":"RUN-gibtsnicht"}' "$BASE/api/runs")
case "$code" in 40*) ok "Recovery eines unbekannten Runs ist ein Fehler ($code)";; *) bad "Recovery eines unbekannten Runs: erwartet 4xx, erhalten $code" "$(body)";; esac
assert_json "Fehlermeldung statt leerem Lauf" '.error != null'

# ------------------------------- 6. Autonome Fehlerkette (Worker <-> Recovery)
step "6. Regression: autonome Fehlerkette (Lease -> Ausführung -> Recovery -> Verifikation)"
# Früher brach der Worker-Zyklus beim ersten Job ab ("invalid run transition
# QUEUED -> RUNNING"); der Fehler-Incident erreichte nie FIXING, und ein
# zusätzlicher Retry lief nach der Verifikation in einen ungültigen Übergang.
api -X POST -d "{\"action\":\"create-mission\",\"title\":\"Audit-Kette $STAMP\",\"objective\":\"Fehlerpfad live prüfen\"}" "$BASE/api/missions" >/dev/null
MISSION=$(jqv '(.mission.missionId)')
api -X POST -d "{\"action\":\"create\",\"missionId\":\"$MISSION\",\"title\":\"Audit-Task $STAMP\",\"risk\":\"LOW\",\"assignedAgent\":\"AG-BUILD\"}" "$BASE/api/tasks" >/dev/null
TASK=$(jqv '(.task.taskId)')
if [ -n "$MISSION" ] && [ -n "$TASK" ]; then ok "Mission/Task für die Fehlerkette angelegt ($MISSION/$TASK)"; else bad "Mission/Task konnten nicht angelegt werden" "$(body)"; fi

assert_status "Dispatch legt Lauf, Job und Sandbox an" 201 "$(api -X POST -d "{\"action\":\"dispatch\",\"taskId\":\"$TASK\",\"agentId\":\"AG-BUILD\",\"risk\":\"LOW\",\"sandboxType\":\"test\"}" "$BASE/api/dispatcher")"
assert_json "Dispatch liefert einen Lauf" '(.runId // "") | test("^RUN-")'

CYCLE=$(api -X POST -d '{}' "$BASE/api/worker")
assert_json "Worker-Zyklus ohne Vorbereitungsfehler" '(.jobFailures | length) == 0'
assert_json "Worker-Zyklus ohne Recovery-Fehler" '(.recoveryFailures | length) == 0'
assert_json "Job wurde beansprucht und abgearbeitet" '(.leased | length) >= 1 and (.failed | length) >= 1'
assert_json "Fehlerpfad stellt den Job zurück statt ihn zu verbrauchen" '(.deferred | length) >= 1'

api "$BASE/api/errors" >/dev/null
assert_json "Fehler-Incident erreicht FIXING mit Evidenz, Experiment und Plan" '((.incidents // []) | map(select(.status == "FIXING" and (.evidenceIds | length) > 0 and ((.experimentId // "") | test("^EXP-")) and ((.recoveryId // "") | test("^REC-")))) | length) >= 1'
api "$BASE/api/reliability" >/dev/null
assert_json "Recovery-Plan ist begonnen (EXECUTING) und hat einen Checkpoint" '((.plans // []) | map(select(.status == "EXECUTING" and ((.checkpointSnapshotId // "") | test("^SNP-")))) | length) >= 1'
api "$BASE/api/runs" >/dev/null
RUN_STATE=$(jqv '([.runs[] | .state] | last)')
case "$RUN_STATE" in
  VERIFYING|RECOVERING) ok "Lauf ist in Behandlung ($RUN_STATE) statt erneut ausgeführt";;
  *) bad "Lauf in unerwartetem Zustand: $RUN_STATE" "";;
esac

step "Ergebnis"
printf "Ergebnis: \033[32m%d bestanden\033[0m, \033[31m%d fehlgeschlagen\033[0m\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
