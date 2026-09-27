# Deployment — Bereitstellung „ready to use“

**Stand:** 2026-09-27

Dieses Dokument beschreibt den vollständigen Weg von einem leeren System zu einer
laufenden, geprüften Instanz. Es ist bewusst ausführbar geschrieben: jeder
Schritt nennt den Befehl und das erwartete Ergebnis.

Reifegrade am Ende jedes Abschnitts — es wird nichts als „funktioniert“
behauptet, was in dieser Umgebung nicht ausgeführt wurde (siehe §9 Grenzen).

| Weg | Aufwand | Für wen | Reifegrad |
|---|---|---|---|
| [§2 Quickstart-Skript](#2-weg-1-quickstart-skript) | ein Befehl | lokaler Betrieb, Ausprobieren, Preview | VERIFIED (hier ausgeführt) |
| [§3 Container / Compose](#3-weg-2-container-und-compose) | ein Befehl | Server, reproduzierbare Umgebung | VERIFIED (Bau) / **NOT_VERIFIED** (Start ohne Daemon hier) |
| [§4 Manuell + systemd](#4-weg-3-manuell-und-systemd) | einige Schritte | Dauerbetrieb auf einem Host | TEILE VERIFIED (Server/Drainage getestet; Unit-Vorlage ungetestet) |

---

## 1. Voraussetzungen

| Bedingung | Prüfung | Bemerkung |
|---|---|---|
| Node.js ≥ 22 | `node -v` | das Image bringt Node 22 mit |
| npm ≥ 10 | `npm -v` | |
| ~1,5 GB Platte | `df -h .` | Build (~250 MB) + Namespace-Rootfs (~130 MB) + Stores |
| Freier Port (Standard 3000) | `ss -ltnp \| grep 3000` | über `PORT` setzbar |
| Optional: cgroup v2 + sudo | `stat -fc %T /sys/fs/cgroup` → `cgroup2fs` | nur für Speicher-/Prozesslimits |
| Optional: User-Namespaces | `unshare --user --pid --mount --fork true` | nur für Kernel-Isolation |
| Optional: Docker | `docker version` | nur für Weg 2 und die OCI-Runtime |

Der Start ist in jedem Fall fail closed: **ohne Creator-Bootstrap antwortet die
gesamte API mit `428 BOOTSTRAP_REQUIRED`** — mit Ausnahme von `/api/auth`, das
nur den Zustand meldet (keine Geheimnisse).

---

## 2. Weg 1: Quickstart-Skript

```bash
bash scripts/quickstart.sh                  # Port 3000, Storage .bob-data
PORT=3100 bash scripts/quickstart.sh        # anderer Port
bash scripts/quickstart.sh --verify         # danach die Betriebsprüfungen
bash scripts/quickstart.sh --stop           # Instanz geordnet anhalten
```

Das Skript ist idempotent und führt sechs Schritte aus: Node prüfen,
Abhängigkeiten installieren, `.env.local` mit zufälligen Secrets anlegen (0600,
nicht versioniert), Anwendung bauen, Produktionsserver starten, Creator-
Bootstrap durchführen. Am Ende gibt es Adresse, Creator-Secret und die Befehle
für Betriebsprüfung und Stopp aus.

Erwartetes Ergebnis (gekürzt):

```text
== 6/6 Creator-Bootstrap
  {"initialized":false,"requiresBootstrap":true,"failClosed":true,...}
  Bootstrap: {"ok":true,"rootAuthorityId":"...","creatorName":"Creator",...}

Bereit.

  Adresse:        http://127.0.0.1:3000
  Anmeldung:      Creator-Login mit dem Secret aus .bob-data/creator-token
```

Danach im Browser anmelden: **Creator-Login** mit dem Secret (siehe
`docs/BOOTSTRAP.md` §3a). Das Einmal-Bootstrap-Secret ist danach vernichtet.

**Reifegrad:** VERIFIED — in dieser Umgebung ausgeführt (Build, Start,
Bootstrap, Betriebsprüfung siehe §7).

---

## 3. Weg 2: Container und Compose

```bash
cp .env.example .env
# mindestens setzen:
#   BOB_BOOTSTRAP_SECRET=<mind. 16 Zeichen>
#   BOB_CREATOR_LOGIN_SECRET=<mind. 16 Zeichen>
docker compose up -d --build
docker compose logs -f bob
```

Eigenschaften des Images (`Dockerfile`):

- **Zwei Stufen.** Die Baustufe baut `.next`, erzeugt das Namespace-Rootfs
  (`/opt/bob/ns-rootfs`) und entfernt danach die Entwicklungsabhängigkeiten
  (`npm prune --omit=dev`). Die Laufzeitstufe enthält nur Produktionscode,
  Produktionsabhängigkeiten und wenige Systemwerkzeuge (`bash`, `util-linux`
  für `unshare`/`setpriv`, `procps`, `curl`).
- **Kein Root.** Der Dienst läuft als Benutzer `node`; Zustand liegt unter
  `/data` (benanntes Volume, dadurch überlebt er Neustarts und Imagewechsel).
- **Signale.** Der Einsprungpunkt ersetzt sich selbst (`exec`), damit `SIGTERM`
  beim Server ankommt — nur so greift die Drainage aus `server.mjs`.
- **Healthcheck.** Öffentlicher Endpunkt `/api/auth` (meldet nur
  `initialized`/`requiresBootstrap`, keine Geheimnisse); damit ist der
  Gesundheitszustand auch **vor** dem Bootstrap aussagekräftig.
- **Bootstrap.** Ist `BOB_BOOTSTRAP_SECRET` gesetzt, gilt es; sonst erzeugt der
  Server ein Einmal-Secret unter `/data/bootstrap-token` (0600). Auslesen:

  ```bash
  docker compose exec bob cat /data/bootstrap-token
  ```

Kernel-Isolation im Container verlangt zusätzliche Rechte
(`cap_add: [SYS_ADMIN]`, ggf. `seccomp=unconfined`) — in `docker-compose.yml`
auskommentiert und begründet. Ohne sie läuft die Plattform weiter, meldet aber
ehrlich `FILESYSTEM_ONLY` bzw. `cgroup: UNAVAILABLE` und **verweigert**
Ausführungen mit Speicher-/Prozesslimits (fail closed, kein stiller Rückfall).

**Reifegrad:** Bau und Konfiguration sind aus dem Repo ableitbar und geprüft;
ein **Start des Images ist in dieser Umgebung nicht ausgeführt** (kein
Docker-Daemon vorhanden) → `NOT_VERIFIED`. Die enthaltenen Bestandteile selbst
sind getestet: `server.mjs` (Drainage, `tests/integration/graceful-shutdown.test.ts`),
`build-ns-rootfs.sh` (`tests/integration/ns-isolation.test.ts`), Healthcheck-
Endpunkt (`scripts/verify-live.sh`).

---

## 4. Weg 3: Manuell und systemd

```bash
npm ci --no-audit --no-fund
npm run build
export NODE_ENV=production BOB_STORAGE_DIR=/srv/bob BOB_BOOTSTRAP_SECRET=… BOB_CREATOR_LOGIN_SECRET=…
node server.mjs                     # Produktionsserver mit Drainage
```

Ohne `NODE_ENV=production` startet `server.mjs` den Entwicklungsserver
(falscher Betriebsweg: kein Build, Dev-Lock blockiert weitere Instanzen).

`node server.mjs` ist der Betriebsweg (nicht `next start`): feste Bindung über
`BOB_HOSTNAME` (Standard `0.0.0.0`), `SIGTERM`/`SIGINT` leiten die Drainage ein,
`BOB_SHUTTING_DOWN=1` wird an die Control Plane gemeldet, neue Arbeit wird mit
`503` beantwortet, laufende Anfragen dürfen enden, nach
`BOB_SHUTDOWN_TIMEOUT_MS` wird hart geschlossen (Exit 1 — ein erzwungenes Ende
wird nie als sauberer Stopp ausgegeben).

Systemd-Vorlage (`/etc/systemd/system/babajagabob.service`):

```ini
[Unit]
Description=BabajagaBoB Control Plane
After=network.target

[Service]
Type=simple
User=bob
WorkingDirectory=/srv/bob/app
EnvironmentFile=/etc/babajagabob.env
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/srv/bob

[Install]
WantedBy=multi-user.target
```

`/etc/babajagabob.env` (0600, `chmod 600`, Besitz `bob`) enthält dieselben
Variablen wie §5. Danach: `systemctl daemon-reload && systemctl enable --now babajagabob`.

**Reifegrad:** Server, Drainage und Signalverhalten sind durch
`tests/integration/graceful-shutdown.test.ts` belegt. Die Unit-Vorlage ist in
dieser Umgebung **nicht** ausgeführt → Implementierung vorhanden, Startweg
`NOT_VERIFIED`.

---

## 5. Umgebungsvariablen

Vollständige, kommentierte Vorlage: `.env.example`. Kurzreferenz:

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `BOB_HOSTNAME` | `0.0.0.0` | Bindeadresse |
| `BOB_STORAGE_DIR` | `.bob-data` | Wurzel aller Stores, Sandboxes, Snapshots, Evidenz |
| `BOB_BOOTSTRAP_SECRET` | – | Einmal-Secret; sonst Datei `<storage>/bootstrap-token` (0600) |
| `BOB_CREATOR_LOGIN_SECRET` | – | Creator-Login (≥ 16 Zeichen); sonst Datei `<storage>/creator-token` (0600) |
| `BOB_SESSION_SECRET` | – | **Pflicht in Produktion** (≥ 32 Zeichen): HMAC-Schlüssel der Session-Schicht. Ohne ihn scheitert jede Session-Erstellung fail closed (HTTP 500 bei Bootstrap/Login); Rotation invalidiert bestehende Sessions bewusst |
| `BOB_CREATOR_TOTP_SECRET` | – | zweiter Faktor (Base32); gesetzt = **pflichtend** |
| `BOB_SANDBOX_RUNTIME` | `local` | `mock` · `local` · `oci` |
| `BOB_OCI_IMAGE` | `alpine:3.20` | nur für `oci` |
| `BOB_NS_ROOTFS` | `<storage>/ns-rootfs` | Rootfs der Kernel-Isolation |
| `BOB_NS_ISOLATION` | `auto` | `auto` · `on` · `off` |
| `BOB_CGROUP_DIR` | – | delegierter cgroup-v2-Unterbaum für Limits |
| `BOB_TRUST_PROXY` | aus | `1` wertet `X-Forwarded-Host`/`-Proto` aus (§6). **Achtung:** Der Next-Server lädt `.env.local` aus dem Projektverzeichnis automatisch nach (nur für ungesetzte Variablen). Eine zweite Instanz aus demselben Verzeichnis erbt sonst `TRUST_PROXY=1` — und da jede direkte Anfrage dann `x-forwarded-for: 127.0.0.1` trägt, sähe die Betriebsgrenze alle lokalen Clients als eine Identität. Test-/Prüfinstanzen nageln deshalb `BOB_TRUST_PROXY=0` ausdrücklich fest (siehe `scripts/verify-all.sh`) |
| `BOB_COOKIE_SAMESITE` | `strict` | `strict` · `lax` · `none` (`none` erzwingt `Secure`) |
| `BOB_COOKIE_SECURE` | aus | `1` erzwingt `Secure` (Pflichthinweis: nur mit TLS sinnvoll) |
| `BOB_SHUTDOWN_TIMEOUT_MS` | `15000` | Drainage-Fenster |
| `BOB_ALLOW_LEGACY_CONTROL_TOKEN` | aus | nur mit `BOB_CONTROL_PLANE_TOKEN`, Administration/CI |
| `BOB_OCI_REQUIRED` | aus | `1` macht den Docker-Daemon im OCI-Test zur Pflicht |

---

## 6. Reverse Proxy und TLS

Die Plattform erzwingt TLS selbst nicht; im Produktivbetrieb gehört ein Proxy
davor, der terminiert und die weitergeleiteten Header setzt. Ohne
`BOB_TRUST_PROXY=1` bleibt der Dienst fail closed: stimmen `Origin` und interner
`Host` nicht überein (hinter einem Proxy immer der Fall), werden cookie-
authentifizierte Mutationen mit `403 CSRF_ORIGIN` abgelehnt. Mit der Freigabe
gilt der **erste** Eintrag von `X-Forwarded-Host` — der vom äußersten Proxy
gesehene Wert; ein fremder `Origin` bleibt weiterhin verboten.

nginx-Beispiel:

```nginx
server {
  listen 443 ssl http2;
  server_name bob.example.org;

  ssl_certificate     /etc/letsencrypt/live/bob.example.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/bob.example.org/privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-Host  $host;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_read_timeout 300s;   # Sandbox-Ausführungen können länger dauern
  }
}
```

Entsprechend in der Instanz: `BOB_TRUST_PROXY=1`, `BOB_COOKIE_SECURE=1`.
`SameSite` kann auf `strict` bleiben — die Anwendung ist dann nur im
gleichnamigen Kontext erreichbar. Ist die Oberfläche in eine fremde Domäne
eingebettet (iframe-Vorschau, Portaldienst), ist `BOB_COOKIE_SAMESITE=none`
nötig; das erzwingt `Secure`. Mit diesen Headern bleiben Cookies (HttpOnly) und
CSRF-Schutz wirksam; der Browser erhält niemals Creator- oder Provider-Secrets
(`docs/SECURITY.md`, `docs/BOOTSTRAP.md` §4).

**Reifegrad:** Header-Auswertung und Cookie-Attribute sind durch
`tests/security/proxy-deployment.test.ts` (9 Tests) belegt — beide Richtungen:
ohne Freigabe darf ein fremder `X-Forwarded-Host` die Prüfung nicht aufweichen,
mit Freigabe gilt der öffentliche Host. Die nginx-Konfiguration selbst ist hier
nicht ausgeführt (`NOT_VERIFIED`).

---

## 7. Nach dem Start prüfen

Der schnellste Weg ist die Gesamtprüfung auf einer verworfenen Prüfinstanz —
sie baut alles selbst (Storage, Rootfs, Bootstrap, Prüfbudget) und meldet
Exit 0 nur ohne Fehlschlag:

```bash
bash scripts/verify-all.sh
```

Erwartet (Stand 2026-09-27): `verify-live.sh` 171/0, `audit-api.sh` 248/0,
`audit-actions.mjs` 525/0, `audit-ui.mjs` 92/0, `acceptance.mjs` 15/0 und
`--live` 84/0. Der Grenznachweis mit Standardbudget läuft bewusst separat
(eigene frische Instanz, eigenes Budgetfenster):

```bash
# eigene Instanz mit Standardbudget (ohne BOB_RATE_LIMIT_MAX, mit BOB_TRUST_PROXY=0)
BASE=http://127.0.0.1:3400 BOOTSTRAP_SECRET=… CREATOR_SECRET=… bash scripts/verify-rate-limit.sh
# erwartet: 6/0
```

Einzeln gegen eine bestehende Instanz, von „läuft“ bis „nachgewiesen“:

```bash
# 1. Erreichbarkeit und Bootstrap-Zustand (einziger öffentlicher Endpunkt)
curl -s http://127.0.0.1:3000/api/auth | head -c 300

# 2. Vollständige Betriebsprüfung (setzt Session/Bootstrap voraus)
BOB_SESSION_COOKIE="<session>" bash scripts/verify-live.sh

# 3. Alle Routen im Betrieb
bash scripts/audit-api.sh

# 4. Vollständige Aktions-/Attributprüfung
node scripts/audit-actions.mjs

# 5. Oberflächenprüfung (Auslieferung, Verträge, keine Geheimnisse im Browser)
node scripts/audit-ui.mjs

# 6. Abnahmeprüfer (statisch und live)
node scripts/acceptance.mjs
node scripts/acceptance.mjs --live
```

Eine Session erzeugt der Creator-Login:

```bash
curl -s -c /tmp/bob.cookie -X POST http://127.0.0.1:3000/api/auth \
  -H 'content-type: application/json' \
  -d '{"action":"login","secret":"<creator-secret>"}'
```

---

## 8. Betrieb: Daten, Update, Rückweg

- **Zustand:** alles unter `BOB_STORAGE_DIR` (Container: Volume `/data`).
  Stores sind JSON-Umschläge mit SHA-256-Digest, atomar geschrieben, Dateien
  `0600`. Sicherung prüfen: `POST /api/persistence {action:"backup.run"}`,
  Rückweg nur mit Digest-Prüfung (siehe `docs/OPERATIONS.md`).
- **Update (manuell):** `git pull` → `npm ci` → `npm run build` → `systemctl
  restart babajagabob` (Drainage) bzw. `docker compose up -d --build`.
  Der Zustand bleibt unberührt; Store-Migrationen laufen registriert und mit
  Sicherungskopie (kein Downgrade, kein Raten).
- **Update (Plattform):** Releases über Slots, Promotion-Gates und gemessene
  Build-ID — `docs/CI_CD.md`, `scripts/release-supervisor.sh`. „Aktiv“ gilt
  erst nach Messung, Promotion bleibt manuell und Creator-gebunden.
- **Notfall:** Kill Switch (`docs/SECURITY.md`), Recovery-Stufen
  (`docs/RECOVERY.md`), Readiness über `GET /api/readiness` (Session-pflichtig).

---

## 9. Fehlerbilder

| Bild | Ursache | Behebung |
|---|---|---|
| `428 BOOTSTRAP_REQUIRED` | Instanz noch nicht initialisiert | Bootstrap mit dem Einmal-Secret (`docs/BOOTSTRAP.md` §2) |
| `500` bei Bootstrap/Login | `BOB_SESSION_SECRET` fehlt oder zu kurz | HMAC-Schlüssel setzen (≥ 32 Zeichen), siehe §5; Rotation meldet bestehende Sessions bewusst ab |
| `401 SESSION_REQUIRED` | kein/abgelaufenes Session-Cookie | Creator-Login (Session 8 h, Erneuerung) |
| `403 CSRF_ORIGIN` | Betrieb hinter Proxy ohne Freigabe | `BOB_TRUST_PROXY=1`, Proxy setzt `X-Forwarded-Host` |
| Anmeldung sofort wieder abgemeldet | Cookie vom Browser verworfen | `BOB_COOKIE_SECURE=1` (TLS) bzw. `BOB_COOKIE_SAMESITE` passend zum Kontext |
| `409` bei Sandbox-Ausführung, Isolation „nicht verfügbar“ | Rootfs fehlt oder `unshare` nicht erlaubt | `bash scripts/build-ns-rootfs.sh`; ohne Namespaces `BOB_NS_ISOLATION=off` (dann nur `FILESYSTEM_ONLY`) |
| Speicher-/Prozesslimits verweigert | cgroup nicht delegiert | `scripts/setup-cgroup-delegation.sh`, Start über `scripts/cgroup-exec.sh` |
| `429 RATE_LIMITED` | Budgets der API-Grenze erreicht | `lib/api/rate-limit.ts`; Nachweis `scripts/verify-rate-limit.sh` |
| `503 SHUTTING_DOWN` | Drainage läuft | geordneter Neustart, danach automatisch wieder verfügbar |

---

## 10. Grenzen dieser Bereitstellung

- Der **Containerstart** ist hier nicht ausgeführt (kein Docker-Daemon) —
  `NOT_VERIFIED`. Bestandteile sind einzeln getestet, der Zusammenschluss nicht.
- Die **systemd-Unit** ist eine Vorlage, hier nicht gestartet — `NOT_VERIFIED`.
- Der **OCI-Test** belegt ohne Daemon nur das Fail-closed-Verhalten; der
  Lifecycle bleibt `NOT_VERIFIED` (Matrix `OCI-001`). Auf Hosts mit Docker:
  `BOB_OCI_REQUIRED=1 npm run test:oci`.
- **Dauerbetrieb** (Lastkurve über Stunden, Alarmierung mit Scraper, Scheduler
  für Sicherungen) bleibt `NOT_VERIFIED` — siehe `docs/TODO.md`.
- TLS-Terminierung ist Aufgabe des Betreibers; ohne TLS keine `Secure`-Cookies
  und damit keine eingebettete Nutzung aus fremden Kontexten.
