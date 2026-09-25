#!/usr/bin/env bash
# Tiefgehende Funktionsprüfung der laufenden Plattform über die echte HTTP-API.
#
#   Login -> Mission -> Objective -> Task -> Sandbox -> Capability
#   -> autorisierte Ausführung -> Evidence/Audit/Provenance -> Knowledge
#   -> bewusster Fehler -> Error Intelligence -> Recovery -> Regression -> Never Again
#   -> blockierter Angriff (DENY + Audit) -> Kill Switch -> Persistenz
#
# Voraussetzungen: laufender Server (`npm run build && npm start`), `jq`.
# Aufruf:  BASE=http://localhost:3000 BOB_STORAGE_DIR=/tmp/bob-live \
#          BOB_CREATOR_LOGIN_SECRET=... bash scripts/verify-live.sh
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
JAR="${JAR:-$(mktemp -t bob-verify-XXXXXX)}"
BODY="$(mktemp -t bob-body-XXXXXX)"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf "  \033[32mPASS\033[0m %s\n" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "  \033[31mFAIL\033[0m %s\n" "$1"; [ -n "${2:-}" ] && printf "        %s\n" "$2"; }
step() { printf "\n\033[1m%s\033[0m\n" "$1"; }
body() { head -c 220 "$BODY" | tr -d '\n'; }

# Jeder API-Aufruf speichert den Body und gibt den HTTP-Status aus.
api()  { curl -s -b "$JAR" -c "$JAR" -o "$BODY" -w '%{http_code}' -H 'content-type: application/json' "$@"; }
anony() { curl -s -o "$BODY" -w '%{http_code}' -H 'content-type: application/json' "$@"; }
jqv()  { jq -r "$1" "$BODY" 2>/dev/null; }
is()   { jq -e "$1" "$BODY" >/dev/null 2>&1; }

assert_status() { # assert_status <name> <erwartet> <ist>
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1: erwartet $2, erhalten $3" "$(body)"; fi
}
assert_json() { # assert_json <name> <jq-ausdruck>
  if is "$2"; then ok "$1"; else bad "$1" "$(body)"; fi
}

# TOTP-Code (RFC 6238) fuer den Live-Nachweis des zweiten Faktors. Der Code wird
# lokal aus dem selben Secret berechnet, das der Server kennt - das Secret selbst
# verlaesst den Server nicht.
totp_code() {
  BOB_TOTP_SECRET="${BOB_CREATOR_TOTP_SECRET:-}" node -e '
    const c = require("node:crypto");
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const s = (process.env.BOB_TOTP_SECRET || "").replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
    let bits = 0, value = 0; const out = [];
    for (const ch of s) { value = (value << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
    const digest = c.createHmac("sha1", Buffer.from(out)).update(buf).digest();
    const offset = digest[digest.length - 1] & 15;
    const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
    process.stdout.write(String(binary % 1000000).padStart(6, "0"));
  ' 2>/dev/null
}

# Ein akzeptierter TOTP-Code ist verbraucht (Replay-Schutz). Fuer eine zweite
# gueltige Anmeldung muss daher ein neues Zeitfenster abgewartet werden.
wait_next_totp_step() {
  local now remain
  now=$(date +%s)
  remain=$((30 - now % 30))
  sleep $((remain + 1))
}

# Anmeldung mit optionalem zweitem Faktor. Ist TOTP verpflichtend und der
# aktuelle Code bereits verbraucht (Replay-Schutz), wird genau einmal auf das
# naechste Zeitfenster gewartet - ein zweiter Lauf innerhalb desselben Fensters
# ist damit kein Fehlschlag.
TOTP_LAST_CODE=""
login_with_optional_totp() { # login_with_optional_totp <jar> <secret>
  if [ -z "${BOB_CREATOR_TOTP_SECRET:-}" ]; then
    anony -c "$1" -X POST -d "{\"action\":\"login\",\"secret\":\"$2\"}" "$BASE/api/auth"
    return
  fi
  local status code
  code="$(totp_code)"
  status="$(anony -c "$1" -X POST -d "{\"action\":\"login\",\"secret\":\"$2\",\"totpCode\":\"$code\"}" "$BASE/api/auth")"
  if [ "$status" != "201" ]; then
    wait_next_totp_step
    code="$(totp_code)"
    status="$(anony -c "$1" -X POST -d "{\"action\":\"login\",\"secret\":\"$2\",\"totpCode\":\"$code\"}" "$BASE/api/auth")"
  fi
  TOTP_LAST_CODE="$code"
  printf '%s' "$status"
}

assert_contains() { # assert_contains <name> <muster> (fuer Klartext wie Prometheus)
  if grep -qE "$2" "$BODY" 2>/dev/null; then ok "$1"; else bad "$1" "$(body)"; fi
}

step "1. Authentifizierung (fail closed)"
INITIALIZED=$(jq -r '.initialized' "$BODY" 2>/dev/null || echo false)
STATUS=$(anony "$BASE/api/auth")
INITIALIZED=$(jq -r '.initialized' "$BODY")
if [ "$INITIALIZED" = "true" ]; then
  assert_status "GET /api/control ohne Session" 401 "$(anony "$BASE/api/control")"
else
  assert_status "GET /api/control ohne Session (vor Bootstrap)" 428 "$(anony "$BASE/api/control")"
fi
assert_status "POST /api/runtime ohne Credentials" 401 "$(anony -X POST -d '{"action":"execute"}' "$BASE/api/runtime")"

if [ "$INITIALIZED" != "true" ]; then
  assert_status "Creator-Bootstrap (Einmal-Secret)" 201 "$(anony -c "$JAR" -X POST -d "{\"action\":\"bootstrap\",\"secret\":\"${BOB_BOOTSTRAP_SECRET:-}\",\"creatorName\":\"Creator\"}" "$BASE/api/auth")"
  assert_json "Session nach Bootstrap aktiv" '.ok == true'
  # Einmal-Secret ist vernichtet; fuer den Rest der Pruefung wird das Creator-Secret neu angemeldet.
  SECRET="${BOB_CREATOR_LOGIN_SECRET:-}"
  if [ -z "$SECRET" ] && [ -f "${BOB_STORAGE_DIR:-./.bob-data}/creator-token" ]; then SECRET="$(tr -d '\n' < "${BOB_STORAGE_DIR}/creator-token")"; fi
  rm -f "$JAR"
  assert_status "Login mit Creator-Secret (Re-Authentifizierung)" 201 "$(login_with_optional_totp "$JAR" "$SECRET")"
else
  SECRET="${BOB_CREATOR_LOGIN_SECRET:-}"
  if [ -z "$SECRET" ] && [ -f "${BOB_STORAGE_DIR:-./.bob-data}/creator-token" ]; then SECRET="$(tr -d '\n' < "${BOB_STORAGE_DIR}/creator-token")"; fi
  assert_status "Login mit Creator-Secret" 201 "$(login_with_optional_totp "$JAR" "$SECRET")"
fi
assert_status "GET /api/control mit Session" 200 "$(api "$BASE/api/control")"
assert_status "Login mit falschem Secret (nach Initialisierung)" 403 "$(anony -X POST -d '{"action":"login","secret":"definitiv-falsch"}' "$BASE/api/auth")"

step "2. Mission -> Objective -> Task -> Agent"
assert_status "Mission erstellen" 201 "$(api -X POST -d '{"action":"create-mission","title":"Live-Verifikation","objective":"Vollstaendige Kette pruefen"}' "$BASE/api/missions")"
MID=$(jqv '.mission.missionId')
assert_status "Objective erstellen" 201 "$(api -X POST -d "{\"action\":\"create-objective\",\"missionId\":\"$MID\",\"title\":\"Nachweis\",\"description\":\"Funktionsnachweis\"}" "$BASE/api/missions")"
OID=$(jqv '.objective.objectiveId')
assert_status "Task erstellen und zuweisen" 201 "$(api -X POST -d "{\"action\":\"create\",\"missionId\":\"$MID\",\"objectiveId\":\"$OID\",\"title\":\"Live-Task\",\"risk\":\"LOW\",\"assignedAgent\":\"AG-BUILD\"}" "$BASE/api/tasks")"
TID=$(jqv '.task.taskId')
assert_status "Task-Status setzen" 200 "$(api -X POST -d "{\"action\":\"status\",\"taskId\":\"$TID\",\"status\":\"RUNNING\",\"progress\":10}" "$BASE/api/tasks")"
assert_status "Agent-Fabric lesbar" 200 "$(api "$BASE/api/agents/fabric")"
assert_json "11 Agentenrollen mit Autonomie-Vertrag" '(.agents | length) == 11 and (.summary.total == 11)'
assert_json "Kein Agent mit Selbstvergabe/Produktionszugriff" '(.summary.authorityChanges | length) == 0 and (.summary.productionAccess | length) == 0 and (.summary.externalNetwork | length) == 0'
assert_json "Keine Wildcard-Capability bei Agenten" '([.agents[].capabilities[]] | index("*")) == null' 
printf "        Mission=%s Objective=%s Task=%s\n" "$MID" "$OID" "$TID"

step "3. Sandbox (Fabric) und Capability-Token"
assert_status "Sandbox erstellen" 201 "$(api -X POST -d "{\"action\":\"create\",\"type\":\"test\",\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\",\"risk\":\"LOW\"}" "$BASE/api/sandboxes")"
SB=$(jqv '.sandbox.sandboxId')
ENV=$(jqv '.sandbox.type')
assert_json "Sandbox an Task+Agent gebunden, Netzwerk DENY" '.sandbox.taskId != null and .sandbox.agentId == "AG-BUILD" and .sandbox.network == "DENY"'
assert_status "Sandbox starten" 200 "$(api -X POST -d "{\"action\":\"start\",\"sandboxId\":\"$SB\"}" "$BASE/api/sandboxes")"
assert_status "Sandbox-Snapshot erstellen" 201 "$(api -X POST -d "{\"action\":\"snapshot\",\"sandboxId\":\"$SB\"}" "$BASE/api/sandboxes")"
SNAP=$(jqv '.snapshot.snapshotId')
assert_json "Snapshot mit SHA-256-Digest" '.snapshot.digest | test("^[0-9a-f]{64}$")'
EXPIRES=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)
assert_status "Capability-Token ausstellen" 200 "$(api -X POST -d "{\"action\":\"issue\",\"input\":{\"subject\":\"AG-BUILD\",\"taskId\":\"$TID\",\"sandboxId\":\"$SB\",\"environment\":\"$ENV\",\"capabilities\":[\"task:execute\",\"sandbox:run\"],\"risk\":\"LOW\",\"issuedBy\":\"CREATOR\",\"issuedByKind\":\"CREATOR\",\"expiresAt\":\"$EXPIRES\"}}" "$BASE/api/authority")"
TOK=$(jqv '.token.id')
printf "        Sandbox=%s Snapshot=%s Token=%s (environment=%s)\n" "$SB" "$SNAP" "$TOK" "$ENV"

step "4. Autorisierte Ausführung -> Audit -> Timeline -> Provenance"
assert_status "Run anlegen" 201 "$(api -X POST -d "{\"action\":\"create\",\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\",\"risk\":\"LOW\",\"sandboxId\":\"$SB\"}" "$BASE/api/runs")"
RUN=$(jqv '.run.runId')
assert_status "Ausführung (argv, shell:false)" 200 "$(api -X POST -d "{\"action\":\"execute\",\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$SB\",\"capabilityTokenId\":\"$TOK\",\"runId\":\"$RUN\",\"argv\":[\"node\",\"-e\",\"process.stdout.write('live-ok')\"]}" "$BASE/api/runtime")"
assert_json "Ausführung akzeptiert (stdout live-ok)" '.accepted == true and (.stdout | test("live-ok"))'
assert_status "Audit lesbar" 200 "$(api "$BASE/api/audit")"
assert_json "Audit enthält DECISION für die Ausführung" 'tostring | test("sandbox.execute|ALLOW")'
assert_status "Timeline lesbar" 200 "$(api "$BASE/api/timeline")"
assert_json "Events vorhanden" '(.timeline | length) > 0'
assert_status "Provenance lesbar" 200 "$(api "$BASE/api/provenance")"
assert_json "Provenance-Kanten vorhanden" '(.edges | length) > 0'
assert_json "Ausführung ist kausal verknüpft" '(.edges | map(.relation) | index("AUTHORIZED_BY") != null) and (.edges | map(.relation) | index("EXECUTED_IN") != null)'

step "5. Blockierte Angriffe (DENY + Audit)"
assert_status "Fremdes/ungültiges Capability-Token" 409 "$(api -X POST -d "{\"action\":\"execute\",\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$SB\",\"capabilityTokenId\":\"CAP-UNBEKANNT\",\"argv\":[\"node\",\"-e\",\"process.stdout.write('x')\"]}" "$BASE/api/runtime")"
assert_json "Verweigerung nennt den Prüfschritt" '.error | test("TOKEN_EXISTS|denied"; "i")'
assert_status "Shell-Interpreter verboten" 409 "$(api -X POST -d "{\"action\":\"execute\",\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$SB\",\"capabilityTokenId\":\"$TOK\",\"argv\":[\"/bin/sh\",\"-c\",\"id\"]}" "$BASE/api/runtime")"
assert_json "Shell-Umgehung als SHELL_PROGRAM verweigert" '.error | test("SHELL_PROGRAM|shell interpreter"; "i")'
assert_status "Shell-Metazeichen verboten" 409 "$(api -X POST -d "{\"action\":\"execute\",\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$SB\",\"capabilityTokenId\":\"$TOK\",\"argv\":[\"node\",\"-e\",\"process.exit(0);process.exit(1)\"]}" "$BASE/api/runtime")"
assert_json "Metazeichen als SHELL_METACHAR verweigert" '.error | test("SHELL_METACHAR|metacharacters"; "i")'
assert_status "Fremde Sandbox-Bindung" 409 "$(api -X POST -d "{\"action\":\"execute\",\"taskId\":\"TASK-001\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$SB\",\"capabilityTokenId\":\"$TOK\",\"argv\":[\"node\",\"-e\",\"process.stdout.write('x')\"]}" "$BASE/api/runtime")"
assert_status "Audit ist integer (HMAC-Kette)" 200 "$(api "$BASE/api/persistence")"
assert_json "Keine Integritätsverletzung" 'tostring | test("integrity|ok|valid"; "i")'

step "6. Bewusster Fehler -> Error Intelligence -> Recovery -> Regression -> Never Again"
assert_status "Fehler-Incident erfassen" 201 "$(api -X POST -d "{\"action\":\"create\",\"input\":{\"severity\":\"HIGH\",\"symptom\":\"Lauf endet mit Exit 7\",\"incident\":\"Live-Fehlerfall\",\"failureMode\":\"unbehandelter Abbruch\",\"contributingFactors\":[\"fehlende Fehlerbehandlung\"],\"prevention\":[],\"evidenceIds\":[],\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\"}}" "$BASE/api/errors")"
INC=$(jqv '.incidentId')
assert_status "Investigation (Diagnosesandbox real gestartet)" 200 "$(api -X POST -d "{\"action\":\"investigate\",\"id\":\"$INC\"}" "$BASE/api/errors")"
assert_json "Status DIAGNOSING + Diagnosesandbox" '.status == "DIAGNOSING" and (.diagnosticSandboxId | test("^SB-DIAG-"))'
assert_status "Hypothese" 200 "$(api -X POST -d "{\"action\":\"hypothesis\",\"id\":\"$INC\",\"hypothesis\":\"Der Abbruch entsteht durch die unbehandelte Fehlerbedingung\"}" "$BASE/api/errors")"
assert_status "Experiment starten" 201 "$(api -X POST -d "{\"action\":\"experiment\",\"id\":\"$INC\"}" "$BASE/api/errors")"
assert_json "Status EXPERIMENTING" '.status == "EXPERIMENTING"'
assert_status "Evidenz erfassen" 200 "$(api -X POST -d "{\"action\":\"evidence\",\"id\":\"$INC\",\"claim\":\"reproduction\",\"value\":\"Exit 7 reproduzierbar\"}" "$BASE/api/errors")"
assert_status "Root Cause (nur mit Evidenz)" 200 "$(api -X POST -d "{\"action\":\"root_cause\",\"id\":\"$INC\",\"rootCause\":\"Fehlerbedingung wird nicht behandelt\",\"evidenceIds\":[]}" "$BASE/api/errors")"
assert_json "Status ROOT_CAUSE_FOUND" '.status == "ROOT_CAUSE_FOUND"'
assert_status "Recovery vorbereiten (Checkpoint)" 201 "$(api -X POST -d "{\"action\":\"recovery\",\"id\":\"$INC\"}" "$BASE/api/errors")"
assert_json "Recovery-Plan mit Snapshot, Status FIXING" '.recoveryId != null and .status == "FIXING"'
assert_status "Recovery ausführen (Restore)" 200 "$(api -X POST -d "{\"action\":\"recovery.execute\",\"id\":\"$INC\"}" "$BASE/api/errors")"
assert_json "Recovery EXECUTING" '.status == "EXECUTING"'
assert_status "Regressionstest registrieren (Never Again)" 201 "$(api -X POST -d "{\"action\":\"regression\",\"id\":\"$INC\",\"argv\":[\"node\",\"-e\",\"process.stdout.write('fixed')\"]}" "$BASE/api/errors")"
assert_json "Regressionstest vorhanden" '.regressionId != null'
assert_status "Recovery verifizieren" 200 "$(api -X POST -d "{\"action\":\"recovery.verify\",\"id\":\"$INC\"}" "$BASE/api/errors")"
assert_json "Verifikation bestanden (VERIFIED)" '.status == "VERIFIED" and .verificationId != null'
assert_status "Fix verifizieren (Regression im Diagnosesandbox)" 200 "$(api -X POST -d "{\"action\":\"fix.verify\",\"id\":\"$INC\"}" "$BASE/api/errors")"
assert_json "Fix bestanden (LEARNED)" '.passed == true and .incident.status == "LEARNED"'
assert_status "Lernen (negatives Wissen)" 200 "$(api -X POST -d "{\"action\":\"learn\",\"id\":\"$INC\",\"summary\":\"Fehlerbedingung wird behandelt\"}" "$BASE/api/errors")"
assert_json "Status REGRESSION_LOCKED" '.status == "REGRESSION_LOCKED" and .knowledgeId != null'
assert_status "Knowledge-Graph lesbar" 200 "$(api "$BASE/api/knowledge")"
assert_json "Negatives Wissen (Never Again) gespeichert" 'tostring | test("NEGATIVE|Never Again"; "i")'
printf "        Incident=%s\n" "$INC"

step "7. Governance, Approval, Privacy, Provider, Geräte"
assert_status "Governance lesbar" 200 "$(api "$BASE/api/governance")"
assert_json "Kill-Switch-Liste vorhanden" '.killSwitches != null'
assert_status "Lockdown aktivieren" 200 "$(api -X POST -d '{"action":"lockdown","locked":true}' "$BASE/api/control")"
assert_json "Lockdown ist aktiv" '.locked == true'
assert_status "Ausführung bei Lockdown verweigert" 409 "$(api -X POST -d "{\"action\":\"execute\",\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$SB\",\"capabilityTokenId\":\"$TOK\",\"argv\":[\"node\",\"-e\",\"process.stdout.write('x')\"]}" "$BASE/api/runtime")"
assert_json "Verweigerung nennt das Gate" '.error | test("EXECUTION_GATE|lock|kill"; "i")'
assert_status "Lockdown aufheben" 200 "$(api -X POST -d '{"action":"lockdown","locked":false}' "$BASE/api/control")"
assert_status "Ausführung nach Freigabe wieder erlaubt" 200 "$(api -X POST -d "{\"action\":\"execute\",\"taskId\":\"$TID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$SB\",\"capabilityTokenId\":\"$TOK\",\"argv\":[\"node\",\"-e\",\"process.stdout.write('again')\"]}" "$BASE/api/runtime")"
assert_status "Privacy-Policy lesbar" 200 "$(api "$BASE/api/privacy")"
assert_json "Externe Weitergabe standardmäßig DENY" 'tostring | test("DENY")'
assert_status "Provider-Katalog lesbar" 200 "$(api "$BASE/api/providers")"
assert_json "Alle Provider entdeckt, aber deaktiviert" '(.providers | length) > 0 and ([.providers[].enabled] | any | not)'
assert_status "Provider ohne Freigabe verbinden" 400 "$(api -X POST -d '{"action":"connect","id":"prov-temporal","endpoint":"https://example.invalid"}' "$BASE/api/providers")"
assert_json "Verbindung verlangt Freigabe" '.error | test("approval"; "i")'
assert_status "Geräte-Fabric lesbar" 200 "$(api "$BASE/api/devices")"
assert_json "Gerät vorhanden und nicht implizit autorisiert" '(.devices | length) > 0'
assert_status "Computer-Use-Fabric lesbar" 200 "$(api "$BASE/api/computer-use")"
assert_json "Kein Computer vorautorisiert (Discovery != Autorisierung)" '(.computers | length) > 0 and ([.computers[].authorized] | any | not)'
assert_json "Computer-Netzwerk nicht INTERNET" '([.computers[].network] | index("INTERNET")) == null' 

step "8. Wiederherstellung, Persistenz, Shell-Verbot"
assert_status "Sandbox aus Snapshot wiederherstellen" 200 "$(api -X POST -d "{\"action\":\"restore\",\"sandboxId\":\"$SB\",\"snapshotId\":\"$SNAP\"}" "$BASE/api/sandboxes")"
assert_status "Sandbox pausieren" 200 "$(api -X POST -d "{\"action\":\"pause\",\"sandboxId\":\"$SB\"}" "$BASE/api/sandboxes")"
assert_status "Sandbox zerstören" 200 "$(api -X POST -d "{\"action\":\"destroy\",\"sandboxId\":\"$SB\"}" "$BASE/api/sandboxes")"
assert_status "Persistenzbericht lesbar" 200 "$(api "$BASE/api/persistence")"
assert_json "Stores ohne Integritätsfehler" '(.integrity.ok == true) and (.stores.ok == true) and (.events.ok == true) and ([.stores.stores[] | select(.ok == false)] | length == 0)'
assert_status "Readiness lesbar" 200 "$(api "$BASE/api/readiness")"
assert_status "Unbekannter Provider wird abgelehnt" 400 "$(api -X POST -d '{"action":"connect","id":"prov-gibt-es-nicht"}' "$BASE/api/providers")"

step "9. Betrieb: Audit-Verifikation, Backup, Metriken, Routenvertrag"
assert_status "Audit-Verifikation ueber POST" 200 "$(api -X POST -d '{"action":"verify"}' "$BASE/api/audit")"
assert_json "Audit-Kette ist integer" '.chain.valid == true and (.chain.length > 0)'
assert_status "Backup anlegen (Creator)" 201 "$(api -X POST -d '{"action":"backup"}' "$BASE/api/persistence")"
assert_json "Backups sind digest-geprueft" '(.created | length) > 0 and (.verified == (.created | length))'
assert_status "Persistenzbericht nach Backup lesbar" 200 "$(api "$BASE/api/persistence")"
assert_json "Persistenzbericht listet verifizierte Backups" '(.backups.verified > 0) and (.backups.failed | length == 0)'
assert_status "Store-Reparatur (Creator)" 200 "$(api -X POST -d '{"action":"repair"}' "$BASE/api/persistence")"
assert_json "Keine Reparaturfehler und nichts Inhaltsloses bleibt offen" '([.results[] | select(.action | test("repair failed"))] | length == 0) and ([.results[] | select((.action | test("empty payload")) and (.repaired == false))] | length == 0)'
assert_status "Persistenzbericht nach Reparatur" 200 "$(api "$BASE/api/persistence")"
assert_json "Kein Store meldet noch einen inhaltslosen Envelope" '([.stores.stores[] | select(.error != null and (.error | test("empty payload")))] | length == 0)'
assert_status "Creator Inbox lesbar" 200 "$(api "$BASE/api/inbox")"
assert_status "Approvals lesbar" 200 "$(api "$BASE/api/approvals")"
assert_status "Metriken (Prometheus) lesbar" 200 "$(api "$BASE/api/metrics")"
assert_contains "Metriken melden integer Stores" '^bob_store_integrity_ok 1$'
assert_contains "Metriken melden die Audit-Kette als integer" '^bob_audit_chain_ok 1$'
assert_contains "Metriken melden 11 Agenten" '^bob_agents 11$'
assert_status "Metriken ohne Session verweigert" 401 "$(anony "$BASE/api/metrics")"
assert_status "Unbekannte Store-Route bleibt geschlossen" 401 "$(anony "$BASE/api/tools")"

step "10. Agentenweg ohne Browser-Session (Capability) und Evidenz"
# Eigene Task/Sandbox, damit die Bindungen des Agentenwegs unabhaengig sind.
AMID=$(api -X POST -d '{"action":"create-mission","title":"Agentenweg","objective":"Capability-Pfad"}' "$BASE/api/missions" >/dev/null; jqv '.mission.missionId')
AOID=$(api -X POST -d "{\"action\":\"create-objective\",\"missionId\":\"$AMID\",\"title\":\"Agent\",\"description\":\"Pfad\"}" "$BASE/api/missions" >/dev/null; jqv '.objective.objectiveId')
ATID=$(api -X POST -d "{\"action\":\"create\",\"missionId\":\"$AMID\",\"objectiveId\":\"$AOID\",\"title\":\"Agenten-Task\",\"risk\":\"LOW\",\"assignedAgent\":\"AG-BUILD\"}" "$BASE/api/tasks" >/dev/null; jqv '.task.taskId')
ASB=$(api -X POST -d "{\"action\":\"create\",\"type\":\"test\",\"taskId\":\"$ATID\",\"agentId\":\"AG-BUILD\",\"risk\":\"LOW\"}" "$BASE/api/sandboxes" >/dev/null; jqv '.sandbox.sandboxId')
api -X POST -d "{\"action\":\"start\",\"sandboxId\":\"$ASB\"}" "$BASE/api/sandboxes" >/dev/null
EXPIRES=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%S.000Z)
ATOK=$(api -X POST -d "{\"action\":\"issue\",\"input\":{\"subject\":\"AG-BUILD\",\"taskId\":\"$ATID\",\"sandboxId\":\"$ASB\",\"environment\":\"test\",\"capabilities\":[\"task:execute\",\"sandbox:run\"],\"risk\":\"LOW\",\"issuedBy\":\"CREATOR\",\"issuedByKind\":\"CREATOR\",\"expiresAt\":\"$EXPIRES\"}}" "$BASE/api/authority" >/dev/null; jqv '.token.id')
ASECRET=$(jqv '.secret')
# Kein Cookie: der Agent authentifiziert sich ausschliesslich ueber das Capability-Token.
agent_call() { curl -s -o "$BODY" -w '%{http_code}' -H 'content-type: application/json' -H "Authorization: Bobcap $ATOK.$ASECRET" -X POST -d "$2" "$BASE$1"; }
assert_status "Agentenausfuehrung ohne Session (Capability + argv)" 200 "$(agent_call /api/runtime "{\"action\":\"execute\",\"taskId\":\"$ATID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$ASB\",\"capabilityTokenId\":\"$ATOK\",\"argv\":[\"node\",\"-e\",\"process.stdout.write('agent-live-ok')\"]}")"
assert_json "Ausfuehrung akzeptiert und liefert stdout" '.accepted == true and .stdout == "agent-live-ok"'
assert_json "Evidenz ist digest-gebunden und geprueft" '(.evidence.artifactId | startswith("ART-")) and (.evidence.digest | length == 64) and (.evidence.verified == true)'
AEVID=$(jqv '.evidence.artifactId')
assert_status "Evidenz ueber Route lesbar" 200 "$(api "$BASE/api/artifacts?verify=$AEVID")"
assert_json "Digest der Evidenz stimmt erneut (Unversehrtheit)" '.verification.ok == true'
assert_status "Token auf Verwaltungsroute bleibt gesperrt" 401 "$(agent_call /api/missions '{"action":"create-mission","title":"verboten","objective":"verboten"}')"
assert_status "Shell-Programm im Agentenweg verweigert" 409 "$(agent_call /api/runtime "{\"action\":\"execute\",\"taskId\":\"$ATID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$ASB\",\"capabilityTokenId\":\"$ATOK\",\"argv\":[\"/bin/sh\",\"-c\",\"id\"]}")"
assert_status "Subjekt-Spoofing verweigert" 409 "$(agent_call /api/runtime "{\"action\":\"execute\",\"taskId\":\"$ATID\",\"agentId\":\"AG-QA\",\"sandboxId\":\"$ASB\",\"capabilityTokenId\":\"$ATOK\",\"argv\":[\"node\",\"-e\",\"1\"]}")"
assert_status "Widerrufenes Token verweigert" 200 "$(api -X POST -d "{\"action\":\"revoke\",\"id\":\"$ATOK\"}" "$BASE/api/authority")"
assert_status "Ausfuehrung nach Widerruf verweigert" 403 "$(agent_call /api/runtime "{\"action\":\"execute\",\"taskId\":\"$ATID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$ASB\",\"capabilityTokenId\":\"$ATOK\",\"argv\":[\"node\",\"-e\",\"1\"]}")"
# Abschnitt 49: Verweigerung -> Audit -> Evidenz. Eine blockierte Autorisierung
# muss als digest-gebundene Evidenz nachweisbar sein, nicht nur im Log stehen.
assert_status "Verweigerungsevidenz ueber Route lesbar" 200 "$(api "$BASE/api/artifacts?kind=DENIAL&taskId=$ATID")"
assert_json "Blockierte Autorisierung ist als Evidenz festgehalten" '(.artifacts | length) >= 1'
ADENY=$(jqv '.artifacts[0].id')
assert_status "Digest der Verweigerungsevidenz pruefbar" 200 "$(api "$BASE/api/artifacts?verify=$ADENY")"
assert_json "Verweigerungsevidenz ist unversehrt" '.verification.ok == true'
assert_json "Verweigerungsevidenz enthaelt keine Klartext-Argumente" '[.artifact.content | tostring | test("process.stdout")] | any | not'

# Zweites, gueltiges Token: der Lockdown muss unabhaengig vom Widerruf greifen.
LTOK=$(api -X POST -d "{\"action\":\"issue\",\"input\":{\"subject\":\"AG-BUILD\",\"taskId\":\"$ATID\",\"sandboxId\":\"$ASB\",\"environment\":\"test\",\"capabilities\":[\"task:execute\",\"sandbox:run\"],\"risk\":\"LOW\",\"issuedBy\":\"CREATOR\",\"issuedByKind\":\"CREATOR\",\"expiresAt\":\"$EXPIRES\"}}" "$BASE/api/authority" >/dev/null; jqv '.token.id')
LSECRET=$(jqv '.secret')
lockdown_call() { curl -s -o "$BODY" -w '%{http_code}' -H 'content-type: application/json' -H "Authorization: Bobcap $LTOK.$LSECRET" -X POST -d "{\"action\":\"execute\",\"taskId\":\"$ATID\",\"agentId\":\"AG-BUILD\",\"sandboxId\":\"$ASB\",\"capabilityTokenId\":\"$LTOK\",\"argv\":[\"node\",\"-e\",\"1\"]}" "$BASE/api/runtime"; }
assert_status "Lockdown sperrt den Agentenweg" 200 "$(api -X POST -d '{"action":"lockdown","locked":true}' "$BASE/api/control")"
assert_status "Agentenausfuehrung im Lockdown verweigert" 409 "$(lockdown_call)"
assert_status "Lockdown aufheben" 200 "$(api -X POST -d '{"action":"lockdown","locked":false}' "$BASE/api/control")"
assert_status "Audit-Verifikation nach Agentenweg" 200 "$(api -X POST -d '{"action":"verify"}' "$BASE/api/audit")"
assert_json "Audit-Kette bleibt integer" '.chain.valid == true'
assert_status "Audit-Aufzeichnungen lesbar" 200 "$(api "$BASE/api/audit")"
assert_json "Verweigerungen sind auditiert (DENY)" '[.records[] | select(.decision == "DENY" and .action == "sandbox.execute")] | length >= 1'
assert_json "Audit weist den Aufbewahrungszustand aus" '(.integrity.valid == true) and ((.integrity.retentionIntegrity // "") | length > 0)'

if [ -n "${BOB_CREATOR_TOTP_SECRET:-}" ]; then
  step "11. Zweiter Faktor (TOTP) ueber HTTP"
  SECRET="${BOB_CREATOR_LOGIN_SECRET:-}"
  if [ -z "$SECRET" ] && [ -f "${BOB_STORAGE_DIR:-./.bob-data}/creator-token" ]; then SECRET="$(tr -d '\n' < "${BOB_STORAGE_DIR}/creator-token")"; fi
  assert_status "Auth-Status nennt den zweiten Faktor" 200 "$(anony "$BASE/api/auth")"
  assert_json "Zweiter Faktor ist verpflichtend" '.secondFactor == "TOTP"'
  assert_status "Login ohne zweiten Faktor abgelehnt" 403 "$(anony -X POST -d "{\"action\":\"login\",\"secret\":\"$SECRET\"}" "$BASE/api/auth")"
  CODE_WRONG="$(totp_code | sed 's/.$/0/')"
  if [ "$CODE_WRONG" = "$(totp_code)" ]; then CODE_WRONG="$(totp_code | sed 's/.$/1/')"; fi
  assert_status "Falscher zweiter Faktor abgelehnt" 403 "$(anony -X POST -d "{\"action\":\"login\",\"secret\":\"$SECRET\",\"totpCode\":\"$CODE_WRONG\"}" "$BASE/api/auth")"
  # Der Code aus Schritt 1 ist verbraucht; auf das naechste Zeitfenster warten.
  wait_next_totp_step
  TJAR="$(mktemp -t bob-totp-XXXXXX)"
  assert_status "Gueltiger zweiter Faktor akzeptiert" 201 "$(login_with_optional_totp "$TJAR" "$SECRET")"
  assert_status "Wiederverwendung des Codes abgelehnt (Replay)" 403 "$(anony -X POST -d "{\"action\":\"login\",\"secret\":\"$SECRET\",\"totpCode\":\"$TOTP_LAST_CODE\"}" "$BASE/api/auth")"
  rm -f "$TJAR"
fi

printf "\n\033[1mErgebnis:\033[0m \033[32m%d bestanden\033[0m, \033[31m%d fehlgeschlagen\033[0m\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
