# Bootstrap und Creator-Session

**Stand:** 2026-09-25

## 1. Erststart (fail closed)

Vor dem Creator-Bootstrap ist die Plattform geschlossen:

- `GET /api/*` (außer `/api/auth`) → **428** (Bootstrap erforderlich).
- Es existiert kein Creator, keine Root Authority und keine Session.

Das Einmal-Secret wird beim Serverstart bzw. über `bootstrapStatus()`/`ensureBootstrapSecret()`
erzeugt:

- gesetzt über `BOB_BOOTSTRAP_SECRET` (z. B. in Containern/CI), sonst
- Datei `<BOB_STORAGE_DIR>/bootstrap-token` mit Rechten `0600`; nur der Hash wird persistiert.

## 2. Bootstrap

```bash
curl -X POST http://localhost:3000/api/auth \
  -H 'content-type: application/json' \
  -d '{"action":"bootstrap","secret":"<einmal-secret>","creatorName":"Creator"}'
```

Ablauf: Secret-Prüfung (timing-safe) → Creator wird Root Authority → Delegationen für
`SYSTEM-WORKER` und `AG-GUARD` → Einmal-Secret wird **vernichtet** → Session wird ausgestellt.

Antwort `201` mit `Set-Cookie: bob_session=<sessionId>.<secret>; HttpOnly; SameSite=Strict`
(und `Secure`, wenn die Anfrage über HTTPS kam). Fehlerfälle:

| Fall | Status |
|---|---|
| falsches Secret | 403 `SECRET_MISMATCH` |
| bereits initialisiert | 409 `ALREADY_INITIALIZED` |
| Root widerrufen | 423 `ROOT_REVOKED` |
| fehlender Input | 400 `INPUT` |

## 3. Session-Betrieb

- `GET /api/auth` → `{initialized, requiresBootstrap, revoked, failClosed, authenticated, actor}`
  (ohne Secrets; vor dem Bootstrap nur Statusinformationen).
- Session-TTL: 8 Stunden, Sliding Renewal in der letzten Stunde.
- `POST /api/auth {"action":"renew"}` → neue Session, alte wird widerrufen (nur wenn die
  Restlaufzeit unter 2 Stunden liegt).
- `POST /api/auth {"action":"logout"}` → Session widerrufen, Cookie gelöscht (`Max-Age=0`).
- Jede `/api/*`-Anfrage außerhalb `/api/auth` verlangt eine gültige Session
  (`middleware.ts` → `lib/api/api-gate.ts`). Agent-Token und Legacy-Administrationstoken werden
  dort **nicht** akzeptiert.

## 3a. Re-Authentifizierung (Creator-Login)

Damit der Creator nach Verlust des Cookies nicht ausgesperrt bleibt, erzeugt der Bootstrap genau ein
server-seitiges Creator-Secret:

- Datei `<BOB_STORAGE_DIR>/creator-token` mit Rechten `0600` (nur der SHA-256-Hash wird persistiert), oder
- Serverumgebungsvariable `BOB_CREATOR_LOGIN_SECRET` (>= 16 Zeichen) in kontrollierten Deployments.

```bash
curl -X POST http://localhost:3000/api/auth \
  -H 'content-type: application/json' \
  -d '{"action":"login","secret":"<creator-secret>"}'
```

| Fall | Status |
|---|---|
| Anmeldung erfolgreich | 201 + neue HttpOnly-Session |
| falsches Secret | 403 `CREATOR_SECRET_MISMATCH` |
| 5 Fehlversuche innerhalb von 15 Minuten | 423 `CREATOR_LOCKED` (Sperre 15 Minuten) |
| kein Secret konfiguriert | 428 `NO_CREATOR_SECRET` |
| Root widerrufen | 423 `ROOT_REVOKED` |

Eigenschaften: Vergleich in konstanter Zeit, jeder Versuch wird auditiert (`creator.login` ALLOW/DENY bzw.
`creator.login.locked`), Fehlversuche werden nach Ablauf des Fensters bereinigt, und das Secret verlässt den
Server niemals über eine API. `GET /api/auth` meldet nur `loginAvailable`, `loginSecretSource` und `locked`.
Rotation: `rotateCreatorSecret(actor)` (nur CREATOR) erzeugt ein neues Secret.

## 4. Was der Browser niemals erhält

Root-/Authority-Token, Provider-Secrets, Geräte-Credentials, Runtime-Secrets und das
Bootstrap-Secret werden nicht an den Browser ausgeliefert. Gespeichert wird nur der SHA-256-Hash
des Session-Geheimnisses.

## 5. Betriebsgrenzen (offen)

- **Zweiter Faktor:** Der Creator-Login ist ein einzelnes Inhaber-Secret (Datei/Umgebungsvariable). Ein
  zweiter Faktor (z. B. TOTP/WebAuthn) ist nicht implementiert und als offener Punkt geführt.
- **Fein-granulare RBAC pro Route:** Die Middleware erzwingt die Authentifizierungsgrenze
  (`control-plane:access`). Zusätzlich prüfen die Kern- und Schreibpfade ihre konkrete Aktion über
  `guardRequest`/`guardOrDeny` (Creator-Pflicht für Mission/Objective/Task, Sandbox-Lebenszyklus,
  Runs, Governance, Provider und Provenance-/Knowledge-Schreibzugriff; `sandbox:run` für
  `POST /api/runtime`; `task:execute` für Task-Status; `run:manage` für Runs). Für noch nicht
  verdrahtete Routen bleibt die Middleware die Grenze – fail closed, aber ohne Aktionsprüfung.
- **TLS:** Cookies werden nur dann mit `Secure` gesetzt, wenn die Anfrage über HTTPS kam
  (`x-forwarded-proto: https`) oder `BOB_COOKIE_SECURE=1` gesetzt ist. In Produktion ist TLS über
  einen Reverse Proxy zwingend.
