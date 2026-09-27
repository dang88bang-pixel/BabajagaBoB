#!/usr/bin/env bash
# =============================================================================
# Einsprungpunkt des Container-Images.
#
# Aufgaben (bewusst klein gehalten):
#   1. Storage anlegen und Rechte prüfen (fail closed, wenn nicht schreibbar),
#   2. Pfade für Bootstrap-/Creator-Secret nennen — **niemals ausgeben**,
#   3. Optionale Extras (Namespace-Rootfs, cgroup-Hinweis) nur melden,
#   4. den übergebenen Befehl ersetzen (`exec`), damit SIGTERM beim Server
#      ankommt — nur so ist die Drainage aus `server.mjs` wirksam.
# =============================================================================
set -euo pipefail

STORAGE="${BOB_STORAGE_DIR:-/data}"
PORT_VALUE="${PORT:-3000}"

if ! mkdir -p "$STORAGE" 2>/dev/null; then
  echo "docker-entrypoint: BOB_STORAGE_DIR=$STORAGE ist nicht anlegbar (Volume-Rechte prüfen)." >&2
  exit 1
fi
if [ ! -w "$STORAGE" ]; then
  echo "docker-entrypoint: BOB_STORAGE_DIR=$STORAGE ist nicht beschreibbar (Besitz prüfen: chown node:node)." >&2
  exit 1
fi

echo "BabajagaBoB — Start"
echo "  Port:            ${PORT_VALUE} (Host ${BOB_HOSTNAME:-0.0.0.0})"
echo "  Storage:         ${STORAGE}"
echo "  Sandbox-Runtime: ${BOB_SANDBOX_RUNTIME:-local}"

# Bootstrap: Das Secret liegt entweder in der Umgebung oder wird vom Server als
# Datei erzeugt. Es wird hier ausdrücklich nicht ausgegeben — es steht in der
# Datei und ist Einmal-Secret.
if [ -n "${BOB_BOOTSTRAP_SECRET:-}" ]; then
  echo "  Bootstrap:       Secret aus BOB_BOOTSTRAP_SECRET (Umgebung)"
else
  echo "  Bootstrap:       Einmal-Secret wird erzeugt unter ${STORAGE}/bootstrap-token (0600)"
fi
if [ -n "${BOB_CREATOR_LOGIN_SECRET:-}" ]; then
  echo "  Creator-Login:   Secret aus BOB_CREATOR_LOGIN_SECRET (Umgebung)"
else
  echo "  Creator-Login:   Secret wird beim Bootstrap erzeugt unter ${STORAGE}/creator-token (0600)"
fi

# Die Session-Schicht ist in Produktion ohne HMAC-Schlüssel fail closed: Der
# Server würde starten, aber jede Anmeldung mit HTTP 500 beantworten. Lieber
# hier laut scheitern als dort still halb laufen.
if [ "${#BOB_SESSION_SECRET:-}" -lt 32 ]; then
  echo "docker-entrypoint: BOB_SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen." >&2
  echo "  Ohne den HMAC-Schlüssel kann die Session-Schicht keine Sitzung erstellen." >&2
  echo "  Beispiel: BOB_SESSION_SECRET=\$(node -e 'process.stdout.write(require(\"node:crypto\").randomBytes(48).toString(\"base64url\"))')" >&2
  exit 1
fi
echo "  Session-HMAC:    BOB_SESSION_SECRET gesetzt (${#BOB_SESSION_SECRET} Zeichen)"

if [ -d "${BOB_NS_ROOTFS:-/opt/bob/ns-rootfs}" ]; then
  echo "  Kernel-Isolation: Rootfs vorhanden (${BOB_NS_ROOTFS:-/opt/bob/ns-rootfs})"
else
  echo "  Kernel-Isolation: kein Rootfs — Stufe FILESYSTEM_ONLY (Ausführungen laufen ohne Namespaces)"
fi

exec "$@"
