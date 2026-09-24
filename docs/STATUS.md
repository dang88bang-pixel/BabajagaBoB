# Gesamtstatus BabajagaBoB

**Datum:** 2026-09-23  
**Branch:** `feat/app-runtime-persistence`

## Statuslegende

- 🟢 implementiert / nutzbar
- 🟡 Grundlage vorhanden / Integration oder Härtung offen
- 🔴 noch nicht implementiert

## Plattform

| Komponente | Status | Hinweis |
|---|---|---|
| Control Center | 🟢 | GUI-first Leitstelle |
| Status-/Progress-Modell | 🟢 | explizite Laufzustände |
| Control Plane | 🟢 | zentrale Orchestrierung |
| Task Queue | 🟢 | Lease, Retry, Cancel |
| Run Lifecycle | 🟢 | persistent |
| Agent Fabric | 🟡 | Rollen/Profile vorhanden, Worker-Verteilung offen |
| Authority | 🟢 | scoped Tokens + Delegation |
| Governance | 🟢 | Kill Switch + Delegation |
| Approval Center | 🟢 | persistente Freigaben |
| Execution Gate | 🟢 | fail-closed |
| Execution Broker | 🟢 | zentrale Runtime-Grenze |
| Sandbox Registry | 🟢 | Task/Agent-Bindung |
| Mock Runtime | 🟢 | isoliertes Entwicklungsmodell |
| OCI Runtime | 🟡 | Docker/OCI, Snapshot/Restore noch offen |

## Wissenschaft / Lernen

| Komponente | Status | Hinweis |
|---|---|---|
| Experimente | 🟢 | Baseline/Control/Replication-Modell |
| Evidence | 🟢 | persistente Science-Daten |
| Knowledge States | 🟢 | OBSERVED bis ESTABLISHED etc. |
| Error Intelligence | 🟢 | Diagnose-/Root-Cause-Lifecycle |
| Never-Again Knowledge | 🟢 | Fehler können als negatives Wissen landen |
| Regression Harness | 🟡 | Datenmodell vorhanden, echte Testausführung offen |
| Causal Replay | 🟡 | Events/Provenance vorhanden, Kausalprüfung ausbauen |

## Recovery

| Komponente | Status | Hinweis |
|---|---|---|
| Failure Records | 🟢 | persistent |
| Recovery Plan | 🟢 | persistent |
| Sandbox Checkpoint | 🟢 | Mock Runtime |
| Restore | 🟡 | OCI Backend fehlt |
| Regression Verification | 🟡 | Workflow vorhanden, echte Testausführung ausbauen |
| Automatische Recovery | 🟡 | Controller vorhanden, Produktionsautomatisierung offen |

## Infrastruktur

| Komponente | Status | Hinweis |
|---|---|---|
| Lokale Persistenz | 🟢 | Integritätsdigest + atomisches Schreiben |
| Audit Store | 🟢 | lokal/persistent |
| Event Store | 🟢 | lokal/persistent |
| Provenance | 🟢 | Relationsmodell |
| Privacy Boundary | 🟢 | fail-closed Policy |
| Provider Fabric | 🟡 | Registry/Lifecycle, keine implizite Provider-Nutzung |
| Device Fabric | 🟡 | Autorisierungsmodell, Remote-Ausführung offen |
| Knowledge Graph | 🟡 | Modell vorhanden, Persistenz/Index offen |
| Simulation Fabric | 🟡 | Szenario-/Visualisierungsmodell |
| CI/CD Promotion | 🟡 | Gates vorhanden, reale Provider-Anbindung offen |

## Aktuelle Sicherheitsgrenzen

1. Kein GUI-direkter Shell-Zugriff.
2. Ausführung nur über Control Plane und Broker.
3. Task, Agent und Sandbox müssen zusammenpassen.
4. Capability Token muss auf Subject, Task, Sandbox und Risiko passen.
5. Kill Switch blockiert Execution.
6. Kritische Aktionen sind nicht automatisch ausführbar.
7. Netzwerk ist standardmäßig deaktiviert.
8. OCI nutzt keine Shell-Interpolation.
9. Geschützte Daten dürfen nicht implizit an externe Provider gegeben werden.
10. Control-Plane-Mutationen sind serverseitig authentifiziert.

## Kritische Restarbeiten vor Produktionsreife

### P0
- echte automatisierte Test-/Regression-Suite
- CI grün verifizieren
- sichere Creator-Session/Auth statt gemeinsamem Bearer
- verteilte/atomare Persistenz für Mehrprozessbetrieb
- echte OCI Snapshot-/Restore-Strategie
- Recovery mit realer Regression-Ausführung

### P1
- echte Agent Worker
- Job Scheduler / Heartbeats über mehrere Prozesse
- Egress Proxy für Allowlist-Netzwerk
- Provider-Adapter mit expliziter Autorisierung
- Device Agent Protocol
- persistenter Knowledge Graph
- Browser-/Desktop-Sandbox

### P2
- vollständige 2D/3D Simulation
- Digital Twin
- umfangreicher Causal Replay
- automatische Tool-/Skill-Entwicklung
- Produktions-CI/CD und Deployment Adapter

## Fortschrittsbild

**Implementierte Plattformgrundlage: ~65–75%**  
**Produktionsreife: deutlich darunter**, weil reale verteilte Ausführung, Authentifizierung, CI, OCI-Recovery und echte Regressionstests noch fehlen.

Die Prozentwerte sind Architektur-/Implementierungsindikatoren, keine Testabdeckung und keine Garantie für Produktionssicherheit.
