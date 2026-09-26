# Master Completion Specification

## Zweck

Diese Spezifikation definiert den vollständigen technischen Auftrag zur Fertigstellung von BabajagaBoB zu einer integrierten, sicher begrenzten, persistenten, testbaren und ausführbaren Autonomous-Agent-Plattform.

## 1. Zielarchitektur

`Creator → Mission → Objective → Task → Agent → Authorization → Sandbox → Experiment/Execution → Evidence → Validation → Audit → Provenance → Knowledge → Recovery`

Die Plattform muss autonom innerhalb delegierter Grenzen handeln können. Sie darf niemals eigene Autorität, Sicherheitsgrenzen, Creator-Governance, Audit-Historie oder Produktionsfreigaben verändern.

Grundprinzip:

`Intent → Policy → Authorization → Execution Gate → Broker → Isolated Runtime → Evidence`

## 2. Bestandsaufnahme und Fertigstellungsmodell

Vor größeren Änderungen Repository, APIs, Datenmodelle, Persistenz, Runtime, UI, Auth, CI und Tests vollständig untersuchen.

Eine laufende `SYSTEM_COMPLETION_MATRIX` führen:

- Bereich
- vorhanden
- fehlend
- Sicherheitsrisiko
- Abhängigkeiten
- Tests
- Status
- Priorität
- nächster Schritt

Statusstufen:

`ARCHITECTURE → IMPLEMENTED → INTEGRATED → TESTED → VERIFIED → PRODUCTION_READY`

Kein künstlicher Fortschritt durch Dateianzahl oder bloße Implementierung.

## 3. Control Plane

Zentral verwalten:

- Creator
- Agents
- Missions
- Objectives
- Tasks
- Runs
- Jobs
- Experiments
- Sandboxes
- Approvals
- Artifacts
- Deployments
- Devices
- Providers
- Knowledge
- Events
- Audit
- Provenance
- Recovery
- Governance
- Kill Switches

Alle Objekte benötigen eindeutige IDs.

## 4. Event, Audit und Provenance

Konsistente Kette:

`Intent → Task → Authorization → Run → Action → Observation → Evidence → Result`

Relevante Events benötigen mindestens Identität, Zeit, Actor/Agent, Task, Run, Sandbox, Action, Referenzen, Parent Event, Kausalrelation, Authorization, Provenance, Result und Status.

Kausalität ist nicht identisch mit zeitlicher Reihenfolge.

Unterstützte Relationen:

- CAUSED_BY
- DERIVED_FROM
- EXECUTED_IN
- AUTHORIZED_BY
- TESTED_BY
- PRODUCED
- OBSERVED
- REPRODUCED_BY
- CONTRADICTED_BY

Integritätsfehler dürfen nicht als valide Ketten erscheinen.

## 5. Jobs, Runs und Worker

Unterstütze:

`QUEUED → LEASED → RUNNING → HEARTBEAT → SUCCEEDED`

und Fehler-/Recovery-Pfade:

`RUNNING → FAILED → RETRY → RECOVERING → RUNNING`

`RUNNING → FAILED → DIAGNOSING → ROOT_CAUSE_FOUND → RECOVERY → VERIFYING → COMPLETED`

Erforderlich:

- eindeutige Run-/Job-IDs
- Lease
- Heartbeat
- Timeout
- Retry/Backoff
- Idempotency
- Cancellation
- stale lease detection
- Recovery
- Rollback
- Dead-letter state
- Worker ownership

Nicht-idempotente Aktionen dürfen nicht unkontrolliert doppelt laufen.

## 6. Authorization und Governance

Implementieren und testen:

- Creator authority
- scoped delegation
- capability tokens
- expiry
- revocation
- subject binding
- task binding
- sandbox binding
- risk binding
- environment binding
- RBAC
- ABAC
- kill switches
- approval requirements

Verboten:

- self-delegation
- capability escalation
- eigene Ablaufverlängerung
- Approval-Bypass
- Kill-Switch-Bypass
- Audit-Bypass
- Creator-Impersonation

## 7. Creator Bootstrap

Sicherer Initialisierungsmechanismus:

- kein hartcodiertes Secret
- kein Secret im Client
- kein Secret im Repository
- einmalige Initialisierung
- Creator als Root Authority
- Bootstrap Event
- Rotation
- Revocation
- fail-closed bei fehlender Konfiguration

## 8. Execution Broker

Vor jeder Ausführung prüfen:

1. Task existiert.
2. Agent existiert.
3. Agent ist autorisiert.
4. Sandbox existiert und ist korrekt gebunden.
5. Capability Token existiert und ist gültig.
6. Subject, Task, Sandbox, Risk und Environment stimmen.
7. Kill Switch ist nicht aktiv.
8. Approval ist vorhanden, falls erforderlich.
9. Netzwerkpolicy und Ressourcenlimits erlauben die Aktion.
10. Execution Gate erlaubt.

Erst danach darf die Runtime ausgeführt werden.

## 9. Sandbox Fabric

Sandbox-Typen:

- development
- experiment
- test
- browser
- security
- migration
- staging
- recovery
- diagnostic

Lifecycle:

`CREATE → CLONE → RESET → START → RUN → PAUSE → SNAPSHOT → RESTORE → DESTROY`

Jede Sandbox benötigt Environment, Ressourcenlimits, Netzwerkpolicy, Agent-/Task-Binding, Repository-/Dependency-State, Logs, Artefakte und Provenance.

Default:

`NETWORK = DENY`

## 10. OCI/Docker Runtime

Weiterentwickeln und verifizieren:

- Isolation
- read-only root filesystem
- capability dropping
- no-new-privileges
- CPU/Memory/PID-Limits
- Timeout
- Prozess- und Container-Cleanup
- Filesystem-Limits
- deterministische Namen
- Reconciliation
- Orphan Detection
- Artifact Collection
- Log Collection

Keine Shell-String-Ausführung; strukturierte `argv[]`.

Allowlist-Netzwerk bleibt fail-closed, solange keine kontrollierte Egress-Schicht vorhanden ist.

## 11. Snapshot/Restore

Snapshots sollen soweit technisch möglich Filesystem, Repository, Configuration, Dependency State, Runtime State, Metadata, Provenance, Timestamp und Digest erfassen.

Restore:

`RESTORE → VERIFY → SMOKE TEST → REGRESSION TEST → ACCEPT/REJECT`

Ein erfolgreicher Restore-Aufruf allein ist kein erfolgreicher Recovery-Nachweis.

## 12. Autonomous Experiment Engine

Workflow:

`QUESTION → OBJECTIVE → HYPOTHESIS → BASELINE → CONTROL → VARIABLE → EXPERIMENT → REPLICATION → OBSERVATION → EVIDENCE → ANALYSIS → CONCLUSION`

Experimentdaten:

- Hypothese
- Baseline
- Control
- Variablen
- erwartetes Ergebnis
- beobachtetes Ergebnis
- Messwerte
- Evidenz
- alternative Erklärungen
- Confounders
- Reproduktion

Ein einzelner erfolgreicher Lauf darf nicht automatisch `ESTABLISHED` ergeben.

## 13. Kausalitätsvalidierung

Prüfen:

- zeitliche Reihenfolge
- Vorbedingungen
- Intervention
- Kontrolle
- Reproduktion
- Alternativerklärung
- Confounder
- unabhängige Evidenz
- Regression
- Gegenbeispiel

Knowledge States:

`OBSERVED | SUPPORTED | ESTABLISHED | HYPOTHESIS | UNVERIFIED | CONTRADICTED | REJECTED | UNKNOWN`

Bei unzureichender Evidenz: `UNKNOWN`.

## 14. Error Intelligence

Lebenszyklus:

`DETECTED → TRIAGING → CONTAINED → REPRODUCING → DIAGNOSING → HYPOTHESIS → EXPERIMENTING → ROOT_CAUSE_FOUND → FIXING → VERIFYING → LEARNED → REGRESSION_LOCKED`

Fehlerstruktur:

`Symptom → Incident → Failure Mode → Root Cause → Contributing Factors → Prevention → Regression Test → Knowledge`

Automatisieren:

1. erkennen
2. isolieren
3. reproduzieren
4. Diagnose-Sandbox
5. Hypothese
6. Experiment
7. Evidenz
8. Root Cause
9. Fix
10. Test
11. Regression
12. Knowledge
13. Never-Again-Regel

## 15. Recovery

Workflow:

`FAILURE → CONTAIN → CHECKPOINT → DIAGNOSTIC → RECOVERY PLAN → RESTORE → VERIFY → REGRESSION → ACCEPT`

Tiers:

1. Retry
2. Isolated Recovery
3. Prepared Recovery
4. Autonomous Investigation
5. Creator Escalation

Recovery darf erst nach tatsächlicher Verifikation als erfolgreich gelten.

## 16. Regression Engine

Aus relevanten Fehlern dauerhafte Regressionstests erzeugen:

`Incident → Root Cause → Regression Test → CI → PASS/FAIL`

Fehlgeschlagene Regressionen blockieren Promotion.

## 17. Knowledge Graph und Memory

Knowledge Graph statt ausschließlich Vector Search.

Unterstützen:

- Nodes/Edges
- Sources
- Evidence
- State
- Contradictions
- Derivations
- Reproduction
- Negative Knowledge

Memory Layer:

- Working
- Episodic
- Semantic
- Negative
- Provenance

Negative Knowledge dokumentiert bekannte Fehlversuche und deren Bedingungen.

## 18. Agent Fabric

Rollen:

- Supervisor
- Planner
- Builder
- Research
- Scientist
- QA
- Browser
- Guardian
- Operator
- Recovery
- Integrator

Delegation muss scoped, zeitlich begrenzt, task-/sandboxgebunden, widerrufbar und auditierbar sein.

## 19. Agent Workshop

Erzeugbare Komponenten:

- Tools
- Skills
- Runtime Adapter
- Connectors
- Debugger Adapter
- Parsers
- Compiler Adapter
- Test Harness
- Research Workflow
- Browser Skill
- GUI Skill
- Deployment Adapter
- Migration Tool
- Diagnostic Tool

Workflow:

`PROBLEM → DISCOVERY → SPEC → IMPLEMENTATION → SANDBOX → TEST → SECURITY → EXPERIMENT → VALIDATION → REGISTRATION → VERSION`

Neue Komponenten dürfen nicht automatisch privilegiert produktiv laufen.

## 20. Runtime Registry

Runtime-Definitionen müssen Name/Version, OS, Architektur, Compiler/Interpreter, Package Manager, Build, Test, Debug, Sandbox Support, Ressourcen- und Security Profile enthalten.

Beispiele: Python, Node/TS, Java/Kotlin, Go, Rust, C/C++, C#, Swift, Dart, PHP, Ruby, Lua, R, Julia, Scala, Haskell, Elixir/Erlang, SQL, WebAssembly, Container, VM, GPU, Embedded usw.

## 21. Provider Fabric

Lifecycle:

`DISCOVERED → EVALUATING → AUTHORIZED → CONNECTING → CONNECTED → DEGRADED → BLOCKED → REVOKED`

Provider benötigen Capabilities, Network/Data Requirements, Privacy Classification, Credentials, Health, Rate Limits, Cost Metadata, Failure Behavior und Revocation.

Externe Provider sind nicht automatisch vertrauenswürdig.

## 22. Privacy/Data Boundary

Defaults:

- Network DENY
- External Processing DENY
- External Storage DENY
- External Training DENY
- Tracking OFF
- Analytics OFF
- Advertising OFF
- Silent Telemetry OFF

Geschützte Klassen:

- DEVICE
- USER
- APP
- BROWSER
- NETWORK
- THIRD_PARTY
- SECRET
- ARTIFACT

Secrets niemals in Logs, Events, Prompt-Kontexten, Artefakten oder Provider-Payloads.

## 23. Device Fabric

Lifecycle:

`UNKNOWN → DISCOVERED → IDENTIFIED → TRUSTED → AUTHORIZED → AVAILABLE → ALLOCATED → EXECUTING → RESULT → RELEASED`

Discovery ist keine Authorization.

Device Agent:

- Capability Reporter
- Task Executor
- Sandbox Manager
- Resource Monitor
- Artifact Transfer
- Log Collector
- Secure Communication

Geräte müssen in Provenance erscheinen.

## 24. Computer Use

Browser:

- DOM
- Click
- Type
- Navigation
- Screenshot
- OCR
- Network Observation

Desktop:

- Mouse
- Keyboard
- Screenshot
- Window Management
- Process Management

CLI:

- Command
- Files
- Processes
- Logs

Nur autorisierte Computer Instances.

## 25. Simulation und Visualization

Trennung:

- Visualization = was existiert?
- Simulation = was könnte passieren?
- Experiment = was passiert unter kontrollierten Bedingungen?
- Causal Replay = was ist passiert und warum?

Unterstützen:

- Architecture Graph
- Flowchart
- Timeline
- State Machine
- Dependency Graph
- Network Graph
- 3D Scene
- Digital Twin
- Simulation
- Replay

Status:

`PLANNING → MODELING → SIMULATION → EXPERIMENT → OBSERVATION → VALIDATION`

## 26. Control Center UI

Hauptbereiche:

- Dashboard
- Agents
- Missions
- Tasks
- Runs
- Experiments
- Sandboxes
- Tests
- Deployments
- Approvals
- Artifacts
- Activity
- Timeline
- Provenance
- Errors
- Recovery
- Security
- Providers
- Devices
- Knowledge
- Simulation
- Replay
- Settings

Chat ist nur eine Oberfläche, nicht die gesamte Steuerzentrale.

## 27. Universelles Statusmodell

Alle Aktionen benötigen visuelle Status-/Fortschrittsanzeigen:

- QUEUED
- PLANNING
- RUNNING
- THINKING
- EXECUTING
- EXPERIMENT
- TESTING
- WAITING
- APPROVAL REQUIRED
- BLOCKED
- ERROR
- RECOVERING
- ROLLING BACK
- COMPLETED
- CANCELLED

Zusätzlich sichtbar:

- Fortschritt
- aktueller Schritt
- Laufzeit
- Actor
- Agent
- Task
- Sandbox
- Risiko
- nächster Schritt
- Fehler
- benötigte Aktion

## 28. Agent Observatory

Pro Agent:

- Task
- Schritt
- Status
- Fortschritt
- Sandbox
- Ressourcen
- letzte Aktion
- nächste Aktion
- Experimente
- Fehler
- Recovery
- Capabilities
- Authorization
- Provider
- Device

Live Timeline integrieren.

## 29. Warum-Funktion

Keine private Chain-of-Thought-Anzeige.

Stattdessen strukturiertes Arbeitsmodell:

`Objective → Observation → Assumption → Hypothesis → Plan → Action → Expected Result → Observed Result → Evidence → Conclusion → Next Action`

## 30. Creator Inbox

Modi:

- INFORM
- ASK
- BLOCK
- ESCALATE

Eskalieren bei unklarem Ziel, Zielkonflikt, Produktionsrisiko, unklarer Datenfreigabe, irreversibler Änderung oder fehlender Autorität.

## 31. Approval Center

Jede Freigabe zeigt:

- Änderung
- Begründung
- erwarteter Effekt
- Risiken
- Tests
- Dateien
- DB-Änderungen
- Netzwerkänderungen
- Rollback
- betroffene Systeme
- Agent
- Task
- Sandbox

Entscheidungen müssen nachvollziehbar und unveränderbar sein.

## 32. CI/CD

Pipeline:

`BRANCH → SANDBOX → LINT → TYPECHECK → UNIT → INTEGRATION → SECURITY → BUILD → BROWSER → EVALUATION → PREVIEW → APPROVAL → STAGING → SMOKE → PRODUCTION`

Fehler blockieren Promotion. Production darf nicht allein durch Agentenentscheidung freigegeben werden.

## 33. Teststrategie

Unit:

- Authority
- Policy
- Governance
- Persistence
- Knowledge
- Science
- Recovery

Integration:

- Broker
- Runtime
- Sandbox
- Queue
- Runs
- Error Intelligence

Security:

- privilege escalation
- self delegation
- revoked/expired token
- task/sandbox/risk mismatch
- kill-switch bypass
- approval bypass
- secret leakage
- network bypass

Regression: für jeden relevanten Fehler.

E2E:

`Creator → Task → Agent → Capability → Sandbox → Execution → Evidence → Error → Recovery → Verification → Knowledge`

## 34. Bekannte technische Punkte, zuerst prüfen

1. Error API: `beginRecovery` und `verifyRecovery` korrekt awaiten.
2. GitHub Actions Trigger und aktuellen Commit prüfen.
3. Echtes Linting einführen; `lint` darf nicht nur Typecheck bedeuten.
4. Event-Causal-Parent-Richtung vereinheitlichen.
5. Event Store/Control Plane gegen doppelte Eventpersistenz konsolidieren.
6. Provenance auf echte `runId` umstellen.
7. Snapshot und Artifact semantisch trennen.
8. Recovery Verification muss echte Tests ausführen.
9. Knowledge Persistence ergänzen.
10. Device Persistence ergänzen.
11. Simulation Persistence ergänzen.
12. Provider Persistence ergänzen.
13. Browser-Mutationen sicher serverseitig authentifizieren; Root Token nie an den Browser.
14. Creator Bootstrap implementieren.
15. API-Authorization um Actor/Capability/Task/Sandbox Binding erweitern.

## 35. Persistenz

Persistieren:

- Control State
- Jobs
- Runs
- Events
- Audit
- Provenance
- Authority
- Governance
- Approvals
- Science
- Errors
- Recovery
- Apps
- Gallery
- Providers
- Devices
- Knowledge
- Simulation

Stores benötigen:

- Version
- Digest
- Atomic Write
- Recovery
- Corruption Detection
- restriktive Dateirechte

Store-Interfaces abstrahieren für spätere Datenbankmigration.

## 36. Offline First

Offline:

- lokale Modelle
- Dokumentation
- Package Mirrors
- Git
- Container Images
- Compiler
- SDKs
- Datasets
- Knowledge Index

Online:

- Web Research
- aktuelle Dokumentation
- Package/API Discovery
- Compatibility Checks
- externe Tests

Offline Flow:

`Task Package → Offline Execution → Artifacts → Logs → Evidence → Sync → Provenance Merge`

## 37. Autonome Experiment-/Sandbox-Erstellung

Der Agent muss Experimentbedarf erkennen, Sandbox spezifizieren/erstellen, Runtime/Ressourcen/Netzwerkpolicy wählen, Experiment durchführen, messen, replizieren, Evidenz sammeln, dokumentieren, Knowledge aktualisieren und Regression erzeugen können.

Autonomie ist innerhalb delegierter Grenzen erlaubt; Sicherheits-/Autoritätsgrenzen sind unveränderbar.

## 38. Selbstheilung

Implementieren:

`Detect → Predict → Prepare → Recover → Verify`

Signals:

- CPU
- Memory
- Queue Depth
- API Latency
- Error Rate
- Dependency Health
- Deployment Health
- Test Flakiness
- Runtime Failure Rate

Vorbereiten:

- Diagnostic Sandbox
- Rollback Artifact
- Verified Backup
- Reproduction Workload
- Regression Test

## 39. Dokumentation

Pflegen:

- README.md
- docs/ARCHITECTURE.md
- docs/STATUS.md
- docs/SECURITY.md
- docs/AUTHORIZATION.md
- docs/SANDBOX.md
- docs/RUNTIME.md
- docs/EXPERIMENTS.md
- docs/RECOVERY.md
- docs/KNOWLEDGE.md
- docs/PROVIDERS.md
- docs/DEVICES.md
- docs/COMPUTER_USE.md
- docs/CI_CD.md
- docs/TESTING.md
- docs/OPERATIONS.md
- docs/BOOTSTRAP.md

Dokumentation muss dem tatsächlichen Code entsprechen.

## 40. Arbeitsweise

Nach jedem größeren Abschnitt:

1. analysieren
2. implementieren
3. typecheck
4. tests
5. integration
6. security check
7. documentation
8. commit
9. status update

Keine großen ungetesteten Änderungen.

Bei Fehlern:

`FAILURE → REPRODUCE → TRIAGE → ROOT CAUSE → FIX → REGRESSION TEST → VERIFY`

Nicht Tests abschwächen, um grün zu werden.

Bei Unsicherheit:

`UNKNOWN / UNVERIFIED / BLOCKED / NOT_IMPLEMENTED`

statt Fake-Erfolg.

## 41. Abschlusskriterien

Mindestens muss funktionieren:

`Creator → Mission → Objective → Task → Agent Assignment → Capability Authorization → Sandbox → Experiment/Execution → Runtime → Observation → Evidence → Audit → Provenance → Result`

Ein absichtlich erzeugter Fehler muss durchlaufen:

`Failure → Detection → Containment → Reproduction → Diagnosis → Root Cause → Recovery → Verification → Regression Test → Knowledge`

Ein Autorisierungsangriff muss blockiert und auditiert werden:

`Agent → unauthorized capability → DENIED → Audit → Evidence`

## 42. Abschlussbericht

Der deutsche Abschlussbericht enthält:

- Implementiert
- Verifiziert
- Teilimplementiert
- Sicherheitsgrenzen
- Runtime real vs. simuliert
- Tests und Ergebnisse
- CI-Zustand
- Persistenz
- Recovery
- Provider
- Device Fabric
- Production Readiness

Production Readiness ausschließlich mit:

`PASS | PARTIAL | FAIL | NOT_IMPLEMENTED | NOT_VERIFIED`

## 43. Endgültige Leitprinzipien

`Creator Authority > Agent Authority`

`Safety/Governance > Agent Objective`

`Evidence > Assumption`

`Verification > Assertion`

`Fail Closed > Unsafe Execution`

Die Plattform soll nachvollziehbar autonom handeln, ihre Handlungen begrenzen, Ergebnisse überprüfen, aus Fehlern lernen und bei Unsicherheit korrekt anhalten können.
