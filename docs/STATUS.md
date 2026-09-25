# Gesamtstatus BabajagaBoB

**Stand:** 2026-09-25
**Branch:** `arena/01a0d635-babajagabob`

## Statuslegende

Jede Komponente wird mit einem belegbaren Reifegrad geführt – ohne Prozentzahlen und ohne behauptete
Produktionsreife:

- **ARCHITECTURE** – Vertrag/Typen/Doku vorhanden, Ausführung fehlt
- **IMPLEMENTED** – Code vorhanden, kompiliert, nicht durch Tests belegt
- **INTEGRATED** – im realen Ablauf verdrahtet (Routen/Worker/Broker)
- **TESTED** – durch automatisierte Tests nachgewiesen
- **VERIFIED** – zusätzlich gegen die reale Umgebung ausgeführt und reproduzierbar
- **UNVERIFIED / PARTIAL / BLOCKED** – ausdrücklich offen bzw. nicht prüfbar

## Plattform

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Control Plane (Mission/Objective/Task) | TESTED | `tests/unit/control-plane.test.ts` |
| Persistenz (Envelope, Digest, atomar) | TESTED | `tests/unit/persistence.test.ts` (Manipulation → fail closed) |
| Authority (Token, TTL, Bindung) | TESTED | `tests/security/authority.test.ts` |
| Bootstrap / Creator-Initialisierung | TESTED | einmaliger Bootstrap, Doppelaufruf verweigert |
| Server-Session + API-Guard | TESTED | `tests/security/api-guard.test.ts`, `tests/security/api-gate.test.ts` |
| Aktionsspezifische Routen-Guards | TESTED | `tests/security/route-guards.test.ts`: 428 vor Bootstrap, 401 ohne Auth, `CREATOR_ONLY` für Agenten-Schreibzugriff auf Provenance/Knowledge, `CAPABILITY_DENIED` für Runs ohne `run:manage`, CSRF-Origin |
| Store-Migration und Reparatur | TESTED | `tests/unit/store-migration.test.ts` (22 Tests): v1→v2 migriert und schreibt v2, Sicherungskopie, Journaleintrag, fehlende Kette oder neuere Datei → fail closed, leerer Envelope (`payload: null`) wird erkannt, als `<datei>.null-payload` gesichert und neu initialisiert, Store-Name im Digest, Backup-Zuordnung ohne Präfixverwechslung (`workshop` vs. `workshop-executions`) |
| Creator Inbox | TESTED | `tests/security/inbox-route.test.ts`: Anlegen (201), Beantworten ausschließlich durch Creator, doppelte Beantwortung abgelehnt, unbekannte Aktion 400, Sessionpflicht; live `GET /api/inbox` 200 (zuvor 500) |
| Routen-Guards je Methode | TESTED | `tests/security/api-route-contract.test.ts` prüft jede exportierte Methode einzeln; sechs GET-Routen (`authority`, `cicd`, `devices`, `governance`, `providers`, `worker`) hatten keinen Guard und sind jetzt `*:read`-geschützt |
| Live-Nachweis über HTTP | VERIFIED | `scripts/verify-live.sh`: **120 Prüfungen / 0 Fehler** gegen `npx next start` (Storage `/tmp/bob-live9`, 2026-09-25); alle drei §49-Abnahmen plus Agentenweg über Capability-Token ohne Browser-Session |
| Backup mit Digest-Prüfung | TESTED | `tests/integration/metrics-backup.test.ts`: Kopien unter `<BOB_STORAGE_DIR>/backups` (0600), manipuliertes Backup → 409, Restore nur nach Version-/Digest-Prüfung |
| Betriebsmetriken (Prometheus-Text) | TESTED | `GET /api/metrics` (Session-pflichtig): Store-Integrität, Audit-Kette, Runs, Queue, Token, Incidents, Recovery, Wissen, Fabric, Kill Switches – nur Zahlen |
| Routenvertrag (strukturell) | TESTED | `tests/security/api-route-contract.test.ts`: jede Route außer `/api/auth` prüft eine konkrete Aktion, kein `publicAction` |
| API-Grenze (Middleware + Auth-Route) | TESTED | `middleware.ts`, `lib/api/api-gate.ts`, `app/api/auth/route.ts`; Creator-Login mit Sperre; live verifiziert (428/201/200/403) |
| Governance / Kill Switches | IMPLEMENTED | Code + Persistenz vorhanden, kein eigener Test |
| Agent Fabric (11 Rollen, Autonomie-Vertrag) | TESTED | `tests/unit/agent-fabric.test.ts`: 11 Rollen aus der Control Plane, keine Selbstvergabe/Produktion/Infrastruktur, Heartbeat und Handoffs |
| Execution Gate + Broker | TESTED | `tests/e2e/*`, `tests/security/argv-policy.test.ts` |
| Sandbox Fabric (Task-/Agent-Bindung) | TESTED | `tests/integration/sandbox-runtime.test.ts` |
| Lokale Runtime (`REAL_LOCAL`) | TESTED | echte Prozesse, `argv[]`, `shell:false`, Timeout-Kill |
| Apps / App-Module | TESTED | Modul-Sandbox über die Fabric gebunden (Task+Agent), `tests/integration/app-module-sandbox.test.ts` |
| argv-Policy (keine Shell-Strings) | TESTED | `lib/argv-policy.ts`, Broker-DENY + Runtime-Enforcement |
| OCI Runtime (`REAL_OCI`) | UNVERIFIED | kein Docker/Podman in der Umgebung; Härtungsflags ungeprüft |
| Task Queue / Runs | IMPLEMENTED | Lease/Retry/Dead-Letter, kein eigener Test |
| Worker / Dispatcher | IMPLEMENTED | `worker.cycle` getestet indirekt nicht; kein eigener Test |

## Lernen / Wissenschaft

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Experiment Engine (Baseline/Control/Replikation) | IMPLEMENTED | Kausalvalidierung vorhanden, kein eigener Test |
| Evidence Store | TESTED | `tests/e2e/failure-recovery.test.ts` (Evidenzpflicht) |
| Knowledge Graph (4 Schichten, negatives Wissen) | TESTED | Negatives Wissen nach Fehlerfall, `ESTABLISHED` verlangt Evidenz + Verifikation |
| Error Intelligence (Lifecycle bis `REGRESSION_LOCKED`) | TESTED | vollständige Kette in `tests/e2e/failure-recovery.test.ts` |
| Regression Engine | TESTED | echte Prozessausführung, Pass/Fail, leere Suite = fail closed |

## Recovery

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Failure Records | TESTED | Status `VERIFIED` erst nach Verifikation |
| Recovery Plan (Tier, Schritte, Verifikationsplan) | TESTED | Tier wird automatisch aus dem Fehlerbild abgeleitet (`lib/recovery-tier.ts`), `EXECUTING` → `VERIFIED` inkl. Snapshot-Restore; Stufe 4/5 nur mit Creator-Freigabe |
| Snapshot / Restore (echter Workspace, SHA-256) | TESTED | Digest-Prüfung, Restore-Verifikation |
| Recovery-Verifikation | TESTED | ohne Snapshot/Regression kein `ACCEPT` |

## Infrastruktur

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Audit Store (HMAC-Kette) | TESTED | `verifyAuditChain()` in mehreren Suiten |
| Event Store (append-only, kausal) | TESTED | `tests/e2e/failure-recovery.test.ts` prüft Eventtypen |
| Provenance | TESTED | Kanten im E2E-Erfolgspfad und im Live-Lauf (§4a in `docs/TESTING.md`); Schreibzugriff ist Creator-Aktion |
| Privacy / Data Boundary | IMPLEMENTED | default `DENY`, kein eigener Test |
| Provider Fabric | TESTED | Katalog/Bindungen/Telemetrie persistent, Approval-gebundene Verbindung (`tests/integration/provider-fabric.test.ts`) |
| Device Fabric / Simulation / Computer Use | PARTIAL | persistent; Simulation und Computer Use ohne eigene Tests |
| CI/CD (`ci.yml`) | TESTED | 5 Jobs (Lint/Typecheck, Unit/Integration/Regression, Security/E2E, Build, Promotion-Gate); grüne Läufe dokumentiert in `docs/CI_CD.md` |
| Automatisierte Testsuiten | TESTED | **27 Dateien / 155 Tests grün**, siehe `docs/TESTING.md` |

## Aktuelle Sicherheitsgrenzen

1. Kein GUI-direkter Shell-Zugriff; jede Ausführung läuft über Gate und Broker.
2. Task, Agent und Sandbox müssen zusammenpassen; Fremdbindung ist ein Fehler.
3. Capability Token muss zu Subjekt, Task, Sandbox, Umgebung und Risiko passen.
4. Selbstvergabe, Wildcards, TTL-Überschreitung und Risk-Eskalation sind verboten.
5. Kill Switch blockiert Execution; Freigabe nur durch CREATOR.
6. Netzwerk ist standardmäßig deaktiviert; `ALLOWLIST` ist fail closed.
7. Shell-Interpreter und Shell-Metazeichen sind in jedem `argv`-Element verboten.
8. Legacy-Administrationstoken ist standardmäßig deaktiviert und nie Creator.
9. OCI-Nutzung ohne Shell-Interpolation; Härtungsflags unverifiziert.
10. Geschützte Daten gehen nicht implizit an externe Provider.

## Offene Restarbeiten (faktisch, ohne Wertung)

- Aktionsspezifische `guardRequest`-Prüfungen für die restlichen, noch nicht verdrahteten Routen ergänzen
  (Kern- und Schreibpfade sind verdrahtet, übrige Routen sind über die Middleware fail closed).
- OCI-Runtime gegen einen echten Daemon verifizieren (`REAL_OCI`).
- Browser-/UI-E2E für das Control Center.
- §44-Dokumente sind vollständig (14 Dateien): `SECURITY.md`, `AUTHORIZATION.md`, `SANDBOX.md`,
  `RUNTIME.md`, `EXPERIMENTS.md`, `RECOVERY.md`, `KNOWLEDGE.md`, `PROVIDERS.md`, `DEVICES.md`,
  `COMPUTER_USE.md`, `CI_CD.md`, `TESTING.md`, `OPERATIONS.md`, `BOOTSTRAP.md`; Abschlussbericht:
  `docs/ABSCHLUSSBERICHT.md` (Struktur A–L).

Eine Produktionsreife-Aussage wird bewusst nicht getroffen; maßgeblich sind die oben belegten Reifegrade.
