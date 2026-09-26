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
  Zweiter Faktor: TOTP ist implementiert (siehe Abschnitt „Zweiter Faktor" unten); WebAuthn bleibt offen.
- **Fein-granulare RBAC pro Route:** Die Middleware erzwingt die Authentifizierungsgrenze
  (`control-plane:access`). Zusätzlich prüft **jede** Route außer `/api/auth` ihre konkrete Aktion über
  `guardRequest`/`guardOrDeny` (Creator-Pflicht für Mission/Objective/Task, Sandbox-Lebenszyklus, Runs,
  Governance, Provider, Apps, Tools/Skills/Runtimes, Simulation, Workshop und Backup sowie
  Provenance-/Knowledge-Schreibzugriff; `sandbox:run` für `POST /api/runtime`; `task:execute` für
  Task-Status; `run:manage` für Runs). `tests/security/api-route-contract.test.ts` erzwingt diese
  Vollständigkeit strukturell.
- **TLS:** Cookies werden nur dann mit `Secure` gesetzt, wenn die Anfrage über HTTPS kam
  (`x-forwarded-proto: https`) oder `BOB_COOKIE_SECURE=1` gesetzt ist. In Produktion ist TLS über
  einen Reverse Proxy zwingend.


## Zweiter Faktor (TOTP)

Aktivierung ist eine reine Deployment-Entscheidung über die Umgebung:

```bash
BOB_CREATOR_TOTP_SECRET=<BASE32, mind. 16 Zeichen>
```

- **Nicht gesetzt:** Login verhält sich wie bisher; `GET /api/auth` meldet
  `secondFactor: "NOT_CONFIGURED"`.
- **Gesetzt:** Der Faktor ist **verpflichtend** (fail closed). Fehlt `totpCode` oder
  stimmt er nicht, antwortet `POST /api/auth {action:"login"}` mit `403 TOTP_REQUIRED`
  und auditiert `creator.login.totp` als `DENY`. Bei erreichter Sperre (5 Fehlversuche /
  15 Minuten) greift weiterhin `423`.
- Codes gelten nur im Fenster ±1 × 30 s und **nur einmal**: akzeptierte Zeitschritte
  werden in `totpUsedSteps` gespeichert (Replay-Schutz).
- Antwort bei Erfolg: `{ok:true, actor:{…}, secondFactor:"TOTP"}`.

Implementierung: `lib/totp.ts` (RFC 6238, base32, `usedSteps`), `lib/creator-auth.ts`
(Store-Schema v2 mit Migration v1 → v2), `app/api/auth/route.ts`.

Die Migration eines bestehenden v1-Stores erfolgt automatisch beim ersten Lesen
(Digest-Prüfung → Sicherungskopie `creator-auth.json.pre-v1.bak` → Journal
`migrations.jsonl`) — ein Upgrade sperrt den Creator also nicht aus.
