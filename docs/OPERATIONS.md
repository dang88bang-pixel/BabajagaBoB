# Betrieb (Operations)

**Stand:** 2026-09-25
**Grundsatz:** Ein Betriebszustand wird gemessen, nicht behauptet. Jede
Statusaussage ist über eine Route oder einen Integritätsbericht belegbar.

## 1. Start und Konfiguration

```bash
npm install
npm run typecheck && npm run build
BOB_STORAGE_DIR=/var/lib/bob BOB_BOOTSTRAP_SECRET=<einmal-secret> \
BOB_CREATOR_LOGIN_SECRET=<creator-secret> BOB_SANDBOX_RUNTIME=local \
  npx next start -H 0.0.0.0 -p 3000
```

Relevante Variablen (siehe `.env.example`):

| Variable | Wirkung |
|---|---|
| `BOB_STORAGE_DIR` | Wurzel aller Stores, Sandboxes, Snapshots, Evidenz (Default `.bob-data`) |
| `BOB_BOOTSTRAP_SECRET` | einmaliges Bootstrap-Secret (≥ 16 Zeichen), danach verworfen |
| `BOB_CREATOR_LOGIN_SECRET` | Creator-Login (Alternative: `<BOB_STORAGE_DIR>/creator-token`, 0600) |
| `BOB_SANDBOX_RUNTIME` | `local` (Standard), `oci` (UNVERIFIED), `mock` (nur mit Freigabe) |
| `BOB_CONTROL_PLANE_TOKEN` + `BOB_ALLOW_LEGACY_CONTROL_TOKEN=1` | Legacy-Admin-Token, standardmäßig aus |

## 2. Speicherorte und Persistenz

- Kanonischer Store: `lib/persistence/store.ts`. Jede Datei ist ein Envelope mit
  Version, Digest und Zeitstempel; Schreiben erfolgt **atomar** (tmp-Datei mit
  `0600` + `rename`).
- Beim Lesen wird der Digest geprüft; eine Manipulation führt zu
  `StoreIntegrityError` und fail-closed-Verhalten statt stiller Weiterverwendung.
- Layout: `<BOB_STORAGE_DIR>/<store>.json`, Sandbox-Workspaces unter
  `<BOB_STORAGE_DIR>/sandboxes/<sandboxId>` (0700), Snapshots mit Manifest.
- `.bob-data` wird **nicht** versioniert; es gibt keinen zweiten, parallelen
  Backup-Store (bewusst: ein Parallel-Restore würde einen abweichenden Zustand
  erzeugen).

## 3. Betriebsrouten

| Route | Aussage |
|---|---|
| `GET /api/readiness` | Bereitschaft für Wiederherstellung (Runtime, Snapshot, Regression, Store) |
| `GET /api/persistence` | Integrität des Control-State, Events, Provenance-Zähler |
| `GET /api/control` | Control-Plane-Zustand inkl. Kill Switches, Agents, Sandboxes |
| `GET /api/audit` / `POST /api/audit {action:"verify"}` | Audit-Kette (HMAC) und Integritätsbericht |
| `GET /api/events`, `GET /api/timeline` | append-only Ereignisprotokoll und Kausalansicht |
| `GET /api/runtime` | Runtime-Modus, Health, Reconcile-Bedarf |
| `POST /api/runtime {action:"reconcile"}` | Abgleich Runtime ↔ Control State (Creator) |
| `GET /api/inbox` | Creator Inbox (`INFORM`, `ASK`, `BLOCK`, `ESCALATE`) |
| `GET /api/approvals`, `GET /api/governance` | offene Freigaben und Sperren |

## 4. Notfälle

| Lage | Vorgehen |
|---|---|
| Verdacht auf Fehlverhalten eines Agenten | Kill Switch für `AGENT` setzen (`POST /api/governance`), Ausführung ist sofort blockiert (409 am Gate) |
| Verdacht auf Manipulation an Daten | `GET /api/persistence` und Audit-Kette prüfen; bei Integritätsfehler stoppen, nicht „weiterarbeiten" |
| Systemweiter Stopp | Kill Switch `SYSTEM`; jede Ausführung verweigert, Freigabe nur durch Creator |
| Wiederherstellung nötig | `docs/RECOVERY.md`: Checkpoint → Plan → Ausführung → Verifikation; ohne Verifikation kein `ACCEPT` |
| Creator-Cookie verloren | Creator-Login mit Secret (`docs/BOOTSTRAP.md` §3a); nach 5 Fehlversuchen 15 min Sperre (423) |
| Provider muss sofort aufhören | `revokeProvider` (deaktiviert Bindungen) und Bindungen prüfen |

## 5. Beobachtbarkeit

- `observe(...)` erzeugt Domain-Events; Audit-Einträge sind HMAC-verkettet
  (`verifyAuditChain`), Provenance-Kanten verbinden Run, Token, Sandbox und Task.
- Begründungen liegen als strukturierter „Why?"-Record vor – **keine** versteckte
  Gedankenkette, keine Erfolgsmeldung ohne Evidenz.
- Secrets werden über `lib/secrets.ts` als kurzlebige Lease ausgegeben
  (TTL 300 s) und über `redact()` in Ausgaben maskiert.

## 6. Live-Verifikation (Betriebsprobe)

```bash
BOB_STORAGE_DIR=/tmp/bob-live BOB_BOOTSTRAP_SECRET=<secret> \
BOB_CREATOR_LOGIN_SECRET=<secret> BASE=http://localhost:3000 \
  bash scripts/verify-live.sh
```

Ergebnis des letzten Laufs: **89 PASS / 0 FAIL** (Details in `docs/TESTING.md`
§4a). Der Lauf deckt Auth, Kette, Sandbox/Snapshot, autorisierte Ausführung,
Angriffsblockaden, Fehlerkette bis `REGRESSION_LOCKED`, Governance/Lockdown,
Privacy, Provider, Geräte, Restore und Persistenz ab.

## 7. Offen

- Kein Metrik-/Alerting-Backend (kein Prometheus/OTel-Export); Beobachtung
  erfolgt über Events, Audit und Statusrouten.
- Keine Backup-/Restore-Automation für `BOB_STORAGE_DIR` (Dateisystem-Backup ist
  Betriebsaufgabe); der Store selbst schreibt atomar.
