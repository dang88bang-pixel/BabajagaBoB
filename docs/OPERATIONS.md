# Betrieb — Abschnitt 39/43

Implementierung: `lib/persistence/store.ts`, `lib/observability.ts`, `lib/metrics.ts`,
`lib/recovery-orchestrator.ts`, `lib/session.ts`, `lib/bootstrap.ts`,
Routen `app/api/persistence/route.ts`, `app/api/metrics/route.ts`,
`app/api/readiness/route.ts`, `app/api/audit/route.ts`, `scripts/verify-live.sh`.

## 1. Ablage und Zugriffsschutz

- Storage-Root: `BOB_STORAGE_DIR` (Standard `.bob-data`, im Repository **nicht** versioniert).
- Root-Verzeichnis `0700`, jede Store-Datei `0600`, geschrieben atomar (tmp + rename).
- Jeder Store ist ein Umschlag `{version, writtenAt, payload, digest}`; `digest` ist
  SHA-256 über `{version, payload}`. Passt der Digest nicht, wirft der Store
  `StoreIntegrityError` — fail closed, nichts wird „repariert".
- Schemawechsel laufen über **registrierte Migrationen** (`StoreOptions.migrations`):
  Digest-Prüfung zuerst, Sicherungskopie `<store>.json.pre-v{N}.bak` (0600), dann
  Migration und Journal (`migrations.jsonl`). Fehlt die Kette oder ist die Datei
  neuer als der Code, wird abgebrochen (kein Downgrade, kein Raten).
  Beleg: `tests/unit/store-migration.test.ts`.

## 2. Registrierte Stores

`control-state`, `audit`, `authority`, `bootstrap`, `creator-auth`, `sessions`,
`approvals`, `queue`, `runs`, `reliability`, `regression`, `errors`, `knowledge`,
`provenance`, `science`, `verifications`, `sandbox-snapshots`, `sandbox-runtime-local`,
`oci-runtime`, `providers`, `devices`, `computer-use`, `simulation`, `inbox`,
`events`, `governance`, `artifacts`, `cicd`, `skills`, `workshop`,
`workshop-executions`, `agent-handoffs` (32 Stores, Stand dieser Dokumentation;
`GET /api/persistence` nennt die aktuelle Liste).

Ein **inhaltsloser Envelope** (`payload: null`) ist der gefährlichste Zustand einer
Store-Datei: Der Digest passt, der Store meldet sich also als integer, jeder Lesezugriff
bricht aber ab. Deshalb gilt:

- `write(null|undefined)` wird verweigert (fail closed) — der Zustand kann nicht mehr entstehen.
- Beim Lesen wird ein solcher Datensatz erkannt, im Journal vermerkt
  (`<store>.json.null-payload`) und mit dem Initialzustand des Moduls neu angelegt.
- `POST /api/persistence {action:"repair"}` (Creator) prüft **alle** Stores und repariert
  sie in einem Durchgang; jede Reparatur wird auditiert (`persistence.repair`).
- Diagnose- und Backup-Instanzen verwenden dieselbe Initialisierungsfunktion wie der
  echte Store. Zuvor schrieb der Backup-Pfad für noch nie beschriebene Stores einen
  Envelope ohne Inhalt — genau daraus entstand der beschriebene Fehler.

`GET /api/persistence` liefert den Integritätsbericht (je Store Version, Digest-Status,
Größe, Existenz) und die Liste der Backups. `POST {action:"backup"}` (Creator) erzeugt
digest-geprüfte Sicherungen unter `<BOB_STORAGE_DIR>/backups`.

## 3. Metriken und Beobachtbarkeit

- `POST /api/audit {action:"verify"}` prüft die Hash-Kette (Länge, Brüche, Integrität).
- `GET /api/metrics` liefert Prometheus-Text (nur Zahlen, Session erforderlich):
  `bob_stores_total`, `bob_stores_healthy`, `bob_store_integrity_ok`,
  `bob_events_total`, `bob_event_store_ok`, `bob_audit_records`, `bob_audit_chain_ok`,
  `bob_audit_issues`, `bob_audit_store_ok`, `bob_missions`, `bob_objectives`,
  `bob_tasks`, `bob_agents`, `bob_tasks_by_status`, `bob_approvals_open`, `bob_runs`,
  `bob_runs_by_state`, `bob_queue_jobs`, `bob_sandboxes`, `bob_sandboxes_running`,
  `bob_capability_tokens`, `bob_capability_tokens_active`, `bob_error_incidents`,
  `bob_error_incidents_open`, `bob_error_incidents_learned`,
  `bob_error_incidents_escalated`, `bob_error_incidents_critical_open`,
  `bob_failures`, `bob_failures_verified`, `bob_recovery_plans` u. a.
- Ereignisse: `lib/events/log.ts` (kausale Kette, `causalParentId`), sichtbar über
  `GET /api/events` und `GET /api/timeline`.
- Werte sind Zählerstände, keine Erfolgsversprechen; fehlende Daten werden nicht „geschätzt".

## 4. Bereitschaft, Lockdown, Recovery

- `GET /api/readiness` → `{activeTasks, blockedTasks, lockdown, ready}`.
  `ready` ist nur wahr ohne Lockdown und ohne blockierte Task.
- System-Lockdown: `POST /api/control {action:"lockdown", locked:true}` (Creator).
  Danach verweigert der Execution Gate **jede** Ausführung (`EXECUTION_GATE`).
- Task-Isolation während Recovery setzt einen Task-Kill-Switch
  (`lib/recovery-orchestrator.ts#recoverFailure`).

## 5. Live-Verifikation (`scripts/verify-live.sh`)

Das Skript prüft die laufende Instanz über **echtes HTTP** und bricht bei der ersten
Abweichung ab (`set -euo pipefail`). Umfang: Bootstrap-/Login-Zustand, Session-Pflicht
(401/428), Missionen/Objectives/Tasks, Sandbox-Lifecycle inkl. Snapshot/Restore,
Ausführung mit Capability-Token, Verweigerungen (fremde Bindung, Shell-Programm,
widerrufenes Token, Lockdown), Evidence/Provenance/Audit-Kette, Metriken, Persistenz,
Backups, Readiness und Queue. Ergebnis wird als Anzahl `PASS`/`FAIL` ausgegeben.

Prüfumfang des Skripts (120 Prüfungen): Authentifizierung, Mission → Objective → Task →
Sandbox → Capability, autorisierte Ausführung mit Evidenzprüfung, Angriffsblockaden,
Fehlerkette bis `REGRESSION_LOCKED`, Governance/Privacy/Provider/Geräte/Computer Use,
Restore, Persistenz inkl. Backup und **Store-Reparatur**, Metriken, Readiness sowie der
Agentenweg ohne Browser-Session.

Beispiel:

```bash
BASE=http://localhost:3000 SECRET=<creator-login> STORAGE=/tmp/bob-live \
  bash scripts/verify-live.sh
```

## 6. Betriebsregeln

- Kein öffentlicher Probe-Endpunkt: auch `/api/readiness` und `/api/metrics` verlangen eine Session.
- Der Browser erhält **nie** Root-Token, Provider-/Device-Credentials oder Runtime-Secrets.
- `.bob-data` (bzw. `BOB_STORAGE_DIR`) wird nicht versioniert; Sicherungen bleiben local.
- Nach jedem Neustart: `verifyStoreBackup`-Bericht prüfen (`GET /api/persistence`).

## 7. Grenzen

- Ein automatischer Rollback von Deployments existiert nicht (`NOT_IMPLEMENTED`).
- Es gibt keine externen Alarmierungskanäle; Alarmregeln sind als Schwellen in
  `docs/SECURITY.md`/`docs/OPERATIONS.md` dokumentiert, müssen aber im Betrieb an ein
  Monitoring angebunden werden (`NOT_VERIFIED`).
- Ein Multi-Knoten-Betrieb (mehrere Control-Plane-Instanzen auf demselben Storage-Root)
  ist nicht unterstützt: Schreibvorgänge sind atomar, aber es gibt kein verteiltes Sperren.
