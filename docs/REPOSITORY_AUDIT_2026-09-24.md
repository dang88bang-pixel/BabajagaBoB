# Vollständige Repository-Prüfung

Stand: 2026-09-24
Branch: `feat/app-runtime-persistence`

## Prüfungsumfang

Geprüft wurden:

- Master Completion Specification
- Implementation Roadmap
- Specification Compliance Contract
- Control Plane / APIs
- Authority / RBAC / ABAC
- Execution Gate / Broker
- Sandbox / Mock / OCI Runtime
- Jobs / Runs / Worker
- Audit / Events / Observability / Provenance
- Science / Experiments / Causal Validation
- Error Intelligence / Recovery
- Knowledge
- Provider Fabric
- Device Fabric
- Computer Use
- Simulation
- CI/CD / Promotion
- Control Center / Observatory
- Privacy / Data Boundary
- Persistence
- Dokumentationsvollständigkeit
- Test-/CI-Struktur

## Gesamtbefund

**Nicht spezifikationskonform / nicht production-ready.**

Die Architektur enthält bereits einen großen Teil der vorgesehenen Bausteine, aber mehrere in der Master-Spezifikation ausdrücklich genannte P0/P1-Anforderungen sind noch nicht vollständig implementiert, integriert oder verifiziert.

Es darf deshalb aktuell weder `VERIFIED` noch `PRODUCTION_READY` für das Gesamtprojekt behauptet werden.

## Kritische Befunde

### P0 — API-Authorization unvollständig

Folgende mutierende APIs sind auf dem geprüften Branch nicht durch die zentrale Control-Plane-Authentifizierung geschützt:

- `/api/devices`
- `/api/knowledge`
- `/api/simulation`
- `/api/providers`
- `/api/cicd`

Das widerspricht der in der Master-Spezifikation geforderten API-Authorization und der Fail-Closed-Control-Plane.

Zusätzlich fehlt bei mehreren dieser APIs eine konsistente Actor/Capability/Task/Sandbox-Bindung.

**Status: FAIL**

### P0 — Browser-Mutationen

Das Control Center sendet Mutationen an `/api/control` ohne Authorization Header.

Gleichzeitig ist `requireControlPlaneAuth` fail-closed konfiguriert.

Damit sind UI-Mutationen in der aktuellen Architektur nicht vollständig integriert.

Das ist korrekt sicherheitsorientiert, aber funktional noch nicht fertig.

**Status: BLOCKED / PARTIAL**

Es darf insbesondere kein Control-Plane-Bearer-Token in den Browser verlagert werden.

### P0 — Creator Bootstrap

Die Authority-Schicht kennt `CREATOR` als Root Authority und verhindert Self-Granting.

Ein vollständiger, sicherer Creator-Bootstrap mit initialer Root-Konfiguration und einmaliger Provisionierung ist jedoch noch nicht als abgeschlossener End-to-End-Prozess nachgewiesen.

**Status: NOT_VERIFIED**

### P0 — Event-Causal-Parent

`observability.ts` verwendet aktuell:

`loadEvents()[0]`

als Default für den Causal Parent.

Da neue Events im Event Store vorne bzw. in unterschiedlicher Reihenfolge verwaltet werden, ist die Kausalrichtung nicht eindeutig vereinheitlicht.

Die Master-Spezifikation nennt genau diesen Punkt als zu prüfendes Problem.

**Status: FAIL**

### P0 — Event Store / Control Plane doppelte Persistenz

Events werden sowohl über Control-Plane-State als auch über den separaten Event Store verarbeitet.

Das schafft zwei potenzielle Quellen der Wahrheit.

Die Spezifikation fordert eine konsolidierte Event-/Audit-/Provenance-Fabric.

**Status: PARTIAL**

### P0 — Recovery Verification

`beginRecovery()` kann einen Snapshot restaurieren.

`verifyRecovery()` setzt danach jedoch im Wesentlichen den Status auf `VERIFIED`, ohne tatsächlich die spezifizierte Kette

`RESTORE → VERIFY → SMOKE TEST → REGRESSION TEST → ACCEPT/REJECT`

auszuführen.

Das ist eine direkte Abweichung von der Master-Spezifikation.

**Status: FAIL**

### P0 — OCI Snapshot/Restore

Der OCI-Adapter meldet ausdrücklich:

- clone nicht implementiert
- reset nicht implementiert
- snapshot nicht implementiert
- restore nicht implementiert

Damit ist die reale OCI-Recovery-Kette noch nicht vorhanden.

**Status: NOT_IMPLEMENTED**

### P1 — Knowledge Persistence

`lib/knowledge.ts` hält Records und Edges ausschließlich im Prozessspeicher.

Es existiert keine persistente Knowledge-Store-Schicht.

Die Master-Spezifikation verlangt persistentes Knowledge.

**Status: FAIL**

### P1 — Device Persistence

`lib/devices.ts` verwendet einen In-Memory-State.

Discovery/Authorization/Allocation überleben keinen Prozess-Neustart.

**Status: FAIL**

### P1 — Simulation Persistence

`lib/simulation.ts` verwendet einen In-Memory-State.

**Status: FAIL**

### P1 — Provider Persistence

Provider Catalog, Bindings und Telemetrie werden im aktuellen Modulzustand gehalten.

Insbesondere `bindings` und `telemetry` sind nicht persistent.

**Status: FAIL**

### P1 — Tests

Im Repository ist keine vollständige Teststruktur mit Unit-, Integration-, Security-, Regression- und E2E-Test-Suite nachweisbar.

Die CI führt aktuell nur:

- `npm install`
- `npm run typecheck`
- `npm run build`

aus.

Das erfüllt nicht die spezifizierte Teststrategie.

**Status: FAIL**

### P1 — CI/CD

Die interne Pipeline kennt zwar die Check-Typen:

- LINT
- TYPECHECK
- UNIT
- INTEGRATION
- SECURITY
- BUILD
- BROWSER
- EVALUATION
- SMOKE

führt diese aber nicht automatisch als reale CI-Kette aus.

Die GitHub-CI selbst führt derzeit nur Typecheck und Build aus.

**Status: PARTIAL**

### P1 — Regression Engine

RegressionTestIds können gespeichert werden, aber ein vollständiger automatischer Ablauf

`Incident → Root Cause → Regression Test → CI → PASS/FAIL`

ist nicht nachgewiesen.

**Status: NOT_IMPLEMENTED / PARTIAL**

### P1 — Knowledge Causality

Science kann aktuell nach einzelnen akzeptierten Experimentläufen Zustände wie `SUPPORTED` setzen.

Die spezifizierte Causal Validation mit Baseline, Control, Replication, Alternative Explanations und Confounder-Prüfung ist noch nicht als verpflichtender Gate-Prozess integriert.

**Status: PARTIAL**

### P1 — Provider Fabric

Provider-Definitionen und Lifecycle sind vorhanden.

Die tatsächlichen externen Provider-Adapter sind jedoch noch überwiegend Katalog-/State-Modelle und keine vollständig verifizierten Live-Integrationen.

**Status: PARTIAL**

### P1 — Device Fabric

Trust- und Authorization-Zustände sind modelliert.

Reale Discovery, Device Agent, dynamisches Scheduling, Remote Execution, Artifact Transfer und sichere Synchronisation sind noch nicht vollständig implementiert.

**Status: PARTIAL**

### P1 — Computer Use

Das Modell für Computer Instances existiert, aber ein vollständiger Browser/Desktop/CLI-Computer-Use Runtime-Pfad mit Snapshots, Credentials, Logs und Provenance ist noch nicht nachgewiesen.

**Status: PARTIAL**

### P1 — Simulation

Szenariozustände und Visualisierungsarten sind vorhanden.

Eine reale 2D/3D-Render-/Simulation-/Digital-Twin-Pipeline ist noch nicht integriert.

**Status: PARTIAL**

### P1 — Runtime Fabric

Runtime Registry existiert, aber die Registry ist noch klein und die universelle Runtime-Ausführung über viele Sprachen/Plattformen ist noch nicht vollständig vorhanden.

**Status: PARTIAL**

### P1 — UI / Universal Status

Das Control Center zeigt bereits Status und Progress für mehrere Kernobjekte.

Die vollständige Forderung, dass **alle relevanten Aktionen und Funktionen** systemweit konsistent Status, Fortschritt, aktuelle Phase, Fehler, Approval und Next Action darstellen, ist noch nicht nachgewiesen.

**Status: PARTIAL**

## Positive Befunde

Bereits substantiell vorhanden:

- Creator > Agent Authority Prinzip
- Capability Tokens
- Task-/Sandbox-/Agent-Bindings
- Self-Grant-Schutz
- Risk Scoping
- Kill Switches
- Approval Gate
- Execution Gate
- Execution Broker
- strukturierter Sandbox Runtime Contract
- echter OCI/Docker-Adapter als Grundlage
- Network-DENY im OCI-Adapter
- Resource Limits
- no-new-privileges
- cap-drop ALL
- read-only filesystem
- PID Limits
- Audit Store
- Event Store
- Provenance Store
- persistenter Control Store
- persistente Jobs/Runs
- persistente Science-Daten
- persistente Error-/Recovery-Daten
- Privacy/Data Boundary
- External Processing DENY
- External Disclosure DENY
- Network DENY Default
- Approval Center-Grundlage
- Error Intelligence Grundstruktur
- Experiment-Grundstruktur
- Agent Fabric Grundstruktur
- Runtime Registry Grundstruktur
- Provider Fabric Grundstruktur
- Device Fabric Grundstruktur
- Computer-Use Grundstruktur
- Simulation-Grundstruktur
- Gallery/Creation Trace
- CI-Baseline

## Dokumentationsbefund

Die Master-Spezifikation fordert zusätzlich:

- `docs/SECURITY.md`
- `docs/AUTHORIZATION.md`
- `docs/RECOVERY.md`
- `docs/KNOWLEDGE.md`
- `docs/PROVIDERS.md`
- `docs/DEVICES.md`
- `docs/CI_CD.md`
- `docs/TESTING.md`

Diese Dokumente sind auf dem geprüften Branch derzeit nicht vorhanden.

Vorhanden sind unter anderem:

- `README.md`
- `docs/STATUS.md`
- `docs/ARCHITECTURE.md`
- `docs/MASTER_COMPLETION_SPEC.md`
- `docs/IMPLEMENTATION_ROADMAP.md`
- `docs/SPEC_COMPLIANCE.md`

**Status: PARTIAL**

## Keine Production-Freigabe

Der aktuelle Repository-Zustand erfüllt die Abschlusskriterien aus Abschnitt 41 der Master-Spezifikation nicht.

Insbesondere fehlen noch nachweisbare vollständige E2E-Ketten:

### Execution

`Creator → Mission → Objective → Task → Agent Assignment → Capability Authorization → Sandbox → Runtime → Execution → Evidence → Audit → Provenance → Result`

### Recovery

`Failure → Detection → Containment → Reproduction → Diagnosis → Root Cause → Recovery → Verification → Regression Test → Knowledge`

### Security

`Agent → unauthorized capability → DENIED → Audit → Evidence`

## Priorisierte nächste Schritte

### P0 — zuerst blockierend

1. Alle mutierenden APIs zentral authentifizieren.
2. Actor/Capability/Task/Sandbox Binding auf API-Ebene durchsetzen.
3. sicheren Creator Bootstrap implementieren.
4. Event-Causal-Parent-Richtung vereinheitlichen.
5. Event Store und Control Plane als eindeutige Event-Quelle konsolidieren.
6. Browser-Mutation-Auth sicher integrieren.
7. Recovery Verification als echte Testkette implementieren.
8. OCI Snapshot/Restore/Recovery implementieren oder explizit blockieren.

### P1 — danach

9. Knowledge persistent machen.
10. Devices persistent machen.
11. Simulation persistent machen.
12. Providers persistent machen.
13. Regression Engine implementieren.
14. Causal Validation als echtes Gate implementieren.
15. Security/Unit/Integration/Regression/E2E Tests hinzufügen.
16. CI um die reale Testpipeline erweitern.
17. Universal Status Fabric vollständig durchsetzen.
18. fehlende Dokumentationen ergänzen.

## Bewertungsregel

Diese Prüfung verwendet bewusst keine Gesamtprozentzahl als Ersatz für Verifikation.

Ein Bereich gilt erst als abgeschlossen, wenn seine spezifizierten Anforderungen durch Code **und** reproduzierbare Tests/Evidence nachgewiesen sind.

**Repository-Gesamtstatus: NOT VERIFIED**

**Production Readiness: NOT READY**
