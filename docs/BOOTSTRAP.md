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

## 4. Was der Browser niemals erhält

Root-/Authority-Token, Provider-Secrets, Geräte-Credentials, Runtime-Secrets und das
Bootstrap-Secret werden nicht an den Browser ausgeliefert. Gespeichert wird nur der SHA-256-Hash
des Session-Geheimnisses.

## 5. Betriebsgrenzen (offen)

- **Re-Authentifizierung:** Es gibt (noch) keinen zweiten Creator-Login-Weg. Das Einmal-Secret wird
  beim Bootstrap bewusst vernichtet; bei Root-Widerruf ist Re-Bootstrap standardmäßig deaktiviert
  (`revokeRoot`). Geht das Session-Cookie verloren, bleibt die Oberfläche geschlossen
  (`401 SESSION_REQUIRED`) – das ist fail closed, aber operativ eine Lücke und als offener Punkt in
  `docs/STATUS.md` geführt.
- **Fein-granulare RBAC pro Route:** Die Middleware erzwingt die Authentifizierungsgrenze
  (`control-plane:access`); aktionsspezifische Prüfungen (Risiko, Task/Sandbox-Bindung,
  Creator-Pflicht) gehören in die Route über `guardRequest` und sind noch nicht überall verdrahtet.
- **TLS:** Cookies werden nur dann mit `Secure` gesetzt, wenn die Anfrage über HTTPS kam
  (`x-forwarded-proto: https`) oder `BOB_COOKIE_SECURE=1` gesetzt ist. In Produktion ist TLS über
  einen Reverse Proxy zwingend.
