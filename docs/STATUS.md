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
| API-Grenze (Middleware + Auth-Route) | TESTED | `middleware.ts`, `lib/api/api-gate.ts`, `app/api/auth/route.ts`; Creator-Login mit Sperre; live verifiziert (428/201/200/403) |
| Governance / Kill Switches | IMPLEMENTED | Code + Persistenz vorhanden, kein eigener Test |
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
| Recovery Plan (Tier, Schritte, Verifikationsplan) | TESTED | `EXECUTING` → `VERIFIED` inkl. Snapshot-Restore |
| Snapshot / Restore (echter Workspace, SHA-256) | TESTED | Digest-Prüfung, Restore-Verifikation |
| Recovery-Verifikation | TESTED | ohne Snapshot/Regression kein `ACCEPT` |

## Infrastruktur

| Komponente | Reifegrad | Nachweis / Hinweis |
|---|---|---|
| Audit Store (HMAC-Kette) | TESTED | `verifyAuditChain()` in mehreren Suiten |
| Event Store (append-only, kausal) | TESTED | `tests/e2e/failure-recovery.test.ts` prüft Eventtypen |
| Provenance | TESTED | `AUTHORIZED_BY` / `EXECUTED_IN` im E2E-Erfolgspfad |
| Privacy / Data Boundary | IMPLEMENTED | default `DENY`, kein eigener Test |
| Provider Fabric | TESTED | Katalog/Bindungen/Telemetrie persistent, Approval-gebundene Verbindung (`tests/integration/provider-fabric.test.ts`) |
| Device Fabric / Simulation / Computer Use | PARTIAL | persistent; Simulation und Computer Use ohne eigene Tests |
| CI/CD (`ci.yml`) | PARTIAL | Gates definiert; Ergebnis für den aktuellen Commit in CI noch zu bestätigen |
| Automatisierte Testsuiten | TESTED | 47 Tests grün, siehe `docs/TESTING.md` |

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

- Aktionsspezifische `guardRequest`-Prüfungen pro Route ergänzen (die Authentifizierungsgrenze ist über die
  Middleware bereits geschlossen).
- OCI-Runtime gegen einen echten Daemon verifizieren (`REAL_OCI`).
- Browser-/UI-E2E für das Control Center.
- Fehlende §44-Dokumente ergänzen (u. a. `AUTHORIZATION.md`, `SANDBOX.md`, `RUNTIME.md`, `RECOVERY.md`,
  `KNOWLEDGE.md`, `CI_CD.md`, `OPERATIONS.md`, `PROVIDERS.md`, `DEVICES.md`, `COMPUTER_USE.md`,
  `EXPERIMENTS.md`); fertig: `TESTING.md`, `SECURITY.md`, `BOOTSTRAP.md`.

Eine Produktionsreife-Aussage wird bewusst nicht getroffen; maßgeblich sind die oben belegten Reifegrade.
