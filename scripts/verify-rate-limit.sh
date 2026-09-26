#!/usr/bin/env bash
# Live-Nachweis der Betriebsgrenze (OPS-004) mit dem **Standardbudget**.
#
# Die übrigen Live-Suiten laufen mit einem angehobenen Prüfbudget
# (`BOB_RATE_LIMIT_MAX=100000`), damit ihre vielen Aufrufe nicht in die Grenze
# laufen. Damit ist die Grenze selbst noch nicht nachgewiesen: Dieses Skript
# spricht eine frische Instanz **ohne** Überschreibung an und belegt, dass die
# Standardwerte greifen:
#
#   * der 31. Anmeldeversuch wird abgewiesen (Standardbudget 30 für /api/auth),
#   * die Antwort trägt `retry-after` als positive Ganzzahl,
#   * der Fehlercode ist RATE_LIMITED,
#   * die Abweisung steht als DENY in der Audit-Kette (blockierte Aktion -> Nachweis).
#
# Reihenfolge: Erst anmelden (Sitzung für die Audit-Prüfung), **dann** fluten.
# Die Anmeldung selbst löst sonst die Kontosperre (`CREATOR_LOCKED`) aus, die
# zusätzlich zur Betriebsgrenze greift und den Nachweis verhindern würde.
#
# Aufruf:  BASE=http://localhost:3200 bash scripts/verify-rate-limit.sh
# Voraussetzung: `jq`, frischer Storage (Standardbudget, kein aufgebrauchtes Fenster).
set -uo pipefail

BASE="${BASE:-http://localhost:3200}"
BOOTSTRAP_SECRET="${BOOTSTRAP_SECRET:-ratelimit-bootstrap}"
CREATOR_SECRET="${CREATOR_SECRET:-ratelimit-creator}"
PASS=0; FAIL=0
# Eigene Kennung je Lauf: das Budgetfenster ist identitätsgebunden, ein zweiter
# Lauf darf nicht auf dem Verbrauch des ersten aufsetzen.
TAG="$$"
SESSION_UA="ratelimit-nachweis-session-$TAG"
FLOOD_UA="ratelimit-nachweis-flut-$TAG"
ok()  { PASS=$((PASS+1)); printf "  \033[32mPASS\033[0m %s\n" "$1"; }
bad() { FAIL=$((FAIL+1)); printf "  \033[31mFAIL\033[0m %s\n" "$1"; [ -n "${2:-}" ] && printf "        %s\n" "$2"; }

echo
echo "Live-Nachweis der Betriebsgrenze (Standardbudget) gegen $BASE (Kennung $TAG)"

# 1) Vorbereitung: Bootstrap (frische Instanz) und Anmeldung für die Audit-Prüfung.
curl -s -o /dev/null -H 'content-type: application/json' -H "user-agent: $SESSION_UA" \
  -X POST "$BASE/api/auth" -d "{\"action\":\"bootstrap\",\"secret\":\"$BOOTSTRAP_SECRET\",\"creatorName\":\"Grenznachweis\"}" || true
token="$(curl -s -D - -o /dev/null -H 'content-type: application/json' -H "user-agent: $SESSION_UA" \
  -X POST "$BASE/api/auth" -d "{\"action\":\"login\",\"secret\":\"$CREATOR_SECRET\"}" \
  | tr -d '\r' | awk 'tolower($1)=="set-cookie:"{print $2}' | cut -d';' -f1)"
if [ -n "$token" ]; then
  ok "Anmeldung für die Audit-Prüfung erhalten"
else
  bad "keine Sitzung erhalten" "Login gegen $BASE/api/auth fehlgeschlagen (läuft die Instanz mit Standardbudget und frischem Storage?)"
fi

# 2) Flut mit einer eigenen Kennung bis zur Abweisung.
attempts=0; first_deny=0; retry_after=""
for i in $(seq 1 90); do
  attempts=$i
  headers="$(curl -s -D - -o /tmp/ratelimit-body.json \
    -H 'content-type: application/json' \
    -H "user-agent: $FLOOD_UA" \
    -X POST "$BASE/api/auth" \
    -d '{"action":"login","secret":"bewusst-falsch"}' 2>/dev/null)"
  status="$(printf '%s' "$headers" | head -1 | awk '{print $2}')"
  if [ "$status" = "429" ]; then
    first_deny=$i
    retry_after="$(printf '%s' "$headers" | tr -d '\r' | awk 'tolower($1)=="retry-after:"{print $2}' | tail -1)"
    break
  fi
done

# Standardbudget für /api/auth laut OPERATIONS.md: 30 erlaubte Versuche, der 31. wird abgewiesen.
if [ "$first_deny" -eq 31 ]; then
  ok "Standardbudget greift live: 30 erlaubt, der 31. Anmeldeversuch wird abgewiesen"
elif [ "$first_deny" -gt 0 ]; then
  bad "Abweisung erst nach $first_deny Versuchen (Standardbudget erwartet: 30 erlaubt)" \
      "Läuft die Instanz mit angehobenem Prüfbudget (BOB_RATE_LIMIT_MAX/BOB_AUTH_RATE_LIMIT_MAX)?"
else
  bad "kein 429 innerhalb von $attempts Versuchen - greift die Betriebsgrenze nicht?" \
      "BOB_RATE_LIMIT_MAX/BOB_AUTH_RATE_LIMIT_MAX müssen ungesetzt sein"
fi

if printf '%s' "$retry_after" | grep -Eq '^[0-9]+$' && [ "${retry_after:-0}" -ge 1 ]; then
  ok "retry-after ist eine positive Ganzzahl (${retry_after}s)"
else
  bad "retry-after fehlt oder ist ungültig" "erhalten: '${retry_after:-}'"
fi

body="$(cat /tmp/ratelimit-body.json 2>/dev/null)"
if [ "$(printf '%s' "$body" | jq -r '.error // empty' 2>/dev/null)" = "RATE_LIMITED" ]; then
  ok "Fehlercode der Abweisung ist RATE_LIMITED"
else
  bad "unerwarteter Fehlercode" "$(printf '%s' "$body" | head -c 200)"
fi

# 3) Die Abweisung muss als DENY in der Audit-Kette stehen.
if [ -n "$token" ]; then
  audit="$(curl -s -H "cookie: $token" "$BASE/api/audit")"
  denial="$(printf '%s' "$audit" | jq -r '[.records[]? | select(.action=="rate-limit" and .decision=="DENY")] | length' 2>/dev/null)"
  if [ "${denial:-0}" -ge 1 ]; then
    ok "begrenzter Anmeldeversuch steht im Audit (${denial} DENY-Einträge)"
  else
    bad "kein Audit-DENY für den begrenzten Anmeldeversuch gefunden" "Antwort: $(printf '%s' "$audit" | head -c 200)"
  fi
  # Die Kette muss auch nach dem Vorfall unversehrt sein.
  chain_ok="$(printf '%s' "$audit" | jq -r '.chain.valid // empty' 2>/dev/null)"
  if [ "$chain_ok" = "true" ]; then
    ok "Audit-Kette bleibt nach dem Vorfall gültig"
  else
    bad "Audit-Kette nach dem Vorfall ungültig" "$(printf '%s' "$audit" | jq -c '.chain' 2>/dev/null | head -c 200)"
  fi
fi

echo
printf "\033[1mErgebnis:\033[0m \033[32m%d bestanden\033[0m, \033[31m%d fehlgeschlagen\033[0m\n\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
