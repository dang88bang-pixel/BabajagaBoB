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
- `.bob-data` wird **nicht** versioniert. Es gibt keinen zweiten *Live*-Store:
  `POST /api/persistence {action:"backup"}` legt Kopien unter
  `<BOB_STORAGE_DIR>/backups` an (0600), die vor Gebrauch gegen Version und Digest
  geprüft werden. Ein manipuliertes Backup wird mit **409** abgelehnt – ein
  Scheinerfolg ist damit ausgeschlossen.
- `GET /api/persistence` listet Backups mit Prüfergebnis (`verified`, `failed[]`).

## 3. Betriebsrouten

| Route | Aussage |
|---|---|
| `GET /api/readiness` | Bereitschaft für Wiederherstellung (Runtime, Snapshot, Regression, Store) |
| `GET /api/metrics` | Betriebsmetriken im Prometheus-Textformat (Session-pflichtig, nur Zähler) |
| `POST /api/persistence {action:"backup"}` | Creator-Aktion: digest-geprüfte Kopien aller Stores |
| `POST /api/persistence {action:"restore"}` | Creator-Aktion: Restore nur nach Pfad-, Versions- und Digest-Prüfung |
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

## 4a. Metriken und Alarme

`GET /api/metrics` liefert Prometheus-Text (Session-pflichtig). Enthalten sind u. a.
`bob_store_integrity_ok`, `bob_audit_chain_ok`, `bob_runs_by_state`, `bob_queue_jobs`,
`bob_capability_tokens_active`, `bob_error_incidents_open`, `bob_recovery_rejected`,
`bob_knowledge_negative`, `bob_providers_connected`, `bob_devices_authorized`,
`bob_computers_authorized` und `bob_kill_switches_active`. Alle Werte stammen aus Stores
oder Integritätsprüfungen; nicht lesbare Quellen werden nicht geschätzt.

Empfohlene Alarmregeln (Betriebsseite, nicht im Code):

| Alarm | Bedingung | Bedeutung |
|---|---|---|
| Integrität | `bob_store_integrity_ok == 0` oder `bob_audit_chain_ok == 0` | sofort stoppen, nicht weiterarbeiten |
| Sperren | `bob_kill_switches_active{scope="SYSTEM"} == 1` | System ist fail closed gesperrt |
| Fehler | `bob_error_incidents_critical_open > 0` | kritischer Incident offen |
| Recovery | `bob_recovery_rejected > 0` | Wiederherstellung nicht nachgewiesen |
| Autorisierung | `bob_capability_tokens_active` unerwartet hoch/niedrig | Token-Hygiene prüfen |

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

Ergebnis des letzten Laufs: **101 PASS / 0 FAIL** (Details in `docs/TESTING.md`
§4a). Der Lauf deckt Auth, Kette, Sandbox/Snapshot, autorisierte Ausführung,
Angriffsblockaden, Fehlerkette bis `REGRESSION_LOCKED`, Governance/Lockdown,
Privacy, Provider, Geräte, Restore und Persistenz ab.

## 7. Offen

- Kein Metrik-Scraper/Alertmanager im Repository: der Export ist vorhanden
  (`/api/metrics`), die Alarmregeln sind beschrieben, aber nicht automatisiert.
- Backups müssen ausgelöst werden (`POST /api/persistence {action:"backup"}`);
  es gibt keinen geplanten Job und keine Aufbewahrungsregel (Rotation).
