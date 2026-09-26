
# BABAJAGA BOB — VOLLSTÄNDIGE ANWENDUNGSSPEZIFIKATION

**Dokumenttyp:** verbindliche Soll-Spezifikation  
**Sprache:** Deutsch  
**Zweck:** 1:1-Rekonstruktion, Implementierung, Prüfung und Abnahme der Gesamtanwendung  
**Status:** kanonischer Soll-Zustand; unverifizierte Implementierungsanteile bleiben ausdrücklich offen.

## 0. Normative Regeln

MUSS = verpflichtend. DARF NICHT = verboten. SOLLTE = Zielanforderung. KANN = optional.

1. Jede verpflichtende Funktion MUSS implementiert, integriert und ausführbar sein.
2. Code, Mock, UI-Platzhalter oder statisches Demo-Verhalten allein gelten NICHT als fertig.
3. Eine Funktion ist erst VERIFIED, wenn ausführbare Tests und nachvollziehbare Evidence vorliegen.
4. Jede relevante Aktion MUSS eine eindeutige ID, einen Status und Zeitstempel besitzen.
5. Jede relevante Aktion MUSS auditierbar und provenance-fähig sein.
6. Kein Agent DARF seine eigene Authority erweitern.
7. Kein Agent DARF sich selbst höhere Permissions erteilen.
8. Connector-Verbindung bedeutet NICHT automatisch Schreib- oder Ausführungsberechtigung.
9. Netzwerkzugriff ist standardmäßig DENY.
10. Externe Verarbeitung, Speicherung und Training mit Projektdaten sind standardmäßig verboten.
11. Secrets dürfen nicht in Browser-Code, normalen Logs, Events, Screenshots oder unautorisierten Agent-Kontext gelangen.
12. Systemkritische Aktionen benötigen die definierte Authority und gegebenenfalls Creator-Approval.
13. Fehler dürfen nicht still verschluckt werden, außer bei explizit definierten erwarteten Zuständen.
14. UI-Status MUSS aus tatsächlichem Runtime-Zustand gespeist werden.
15. Recovery gilt erst nach erfolgreicher Verifikation als abgeschlossen.
16. ESTABLISHED Knowledge benötigt nachvollziehbare Evidence und Verification.
17. Kausalität darf nicht allein aus einer Behauptung oder einem ungeprüften Einzelergebnis entstehen.
18. Externe Integrationen MÜSSEN über Connector, Capability und Permission Layer laufen.
19. Produktive Änderungen MÜSSEN testbar, auditierbar und rückrollbar sein.
20. Unverifizierte Komponenten dürfen nicht als VERIFIED oder PRODUCTION READY bezeichnet werden.
21. Der Creator bleibt oberste Autorität für systemkritische Auswirkungen.
22. Agenten dürfen innerhalb ihrer delegierten Authority autonom planen, forschen, experimentieren, testen und vorbereiten.
23. Keine Capability darf zur allgemeinen Systemberechtigung eskalieren.
24. Diese Spezifikation ist Zielzustand; vorhandene Implementierung darf Anforderungen nicht stillschweigend reduzieren.

## 1. Produktdefinition

BabajagaBoB ist eine GUI-first Agent-Plattform für autonome Software-, Forschungs-, Experiment-, Geräte-, Runtime- und Integrationsaufgaben.

Kernmodule:

- Control Center / Creator
- Agent Orchestrator
- Agent Fabric
- Task Manager
- Mission Manager
- Permission Broker
- Policy Engine
- Execution Gate
- Execution Broker
- Worker Fabric
- Runtime Registry
- Sandbox Manager
- Experiment Engine
- Verification Engine
- Error Intelligence / Recovery
- Event / Audit / Provenance Fabric
- Research Stack
- Source Manager
- Document Engine
- Evidence / Claim Engine
- Knowledge Graph
- Tool / Skill Workshop
- Provider / Connector Manager
- Device / Hardware Fabric
- Computer Use
- Simulation / Visualization
- Offline Fabric
- Scheduler / Automation
- Observability
- Timeline / Replay / Why
- Approval Center
- Deployment / Release / Rollback
- Security / Privacy / Governance

## 2. Primärer End-to-End-Lifecycle

Creator
→ Mission
→ Objective
→ Agent
→ Plan
→ Task
→ Policy / Permission
→ Approval
→ Execution Gate
→ Execution Broker
→ Worker
→ Sandbox / Runtime
→ Action
→ Observation
→ Evidence
→ Verification
→ Result
→ Knowledge / Artifact
→ Test
→ Approval
→ Deployment
→ Monitoring
→ Recovery
→ Learning / Regression

Jede Stufe besitzt ID, Status, Zeitstempel, Actor, Authority und Provenance.

## 3. Control Center

Hauptbereiche:

1. Dashboard
2. Creator
3. Agents
4. Missions
5. Objectives
6. Tasks
7. Runs
8. Experiments
9. Sandboxes
10. Runtimes
11. Tools
12. Skills
13. Providers / Integrations
14. Devices
15. Computer Use
16. Simulations
17. Knowledge
18. Research
19. Evidence
20. Timeline
21. Replay
22. Why
23. Approvals
24. Deployments
25. Recovery
26. Security
27. Audit
28. Settings

Jede laufende Aktion zeigt mindestens Status, Fortschritt, Phase, Actor, ID, Sandbox/Runtime, Zeit, Fehler/Warnungen, Approval und Ergebnis.

## 4. Universal Status Fabric

Allgemeine Zustände:

CREATED, QUEUED, PLANNING, WAITING, APPROVAL_REQUIRED, APPROVED, STARTING, RUNNING, EXPERIMENT, OBSERVING, VALIDATING, VERIFYING, SUCCEEDED, FAILED, BUG, BLOCKED, RECOVERING, CANCEL_REQUESTED, CANCELLED, REJECTED, EXPIRED, DEGRADED, OFFLINE.

Statusattribute:

- statusId
- entityId
- entityType
- state
- progress
- phase
- message
- startedAt
- updatedAt
- completedAt
- actorId
- runId
- parentStatusId
- errorId
- approvalId

Progress liegt zwischen 0 und 100, sofern messbar.

## 5. Creator

Attribute:

- creatorId
- identityId
- displayName
- authorityLevel
- sessionId
- preferences
- securityPolicy
- createdAt
- lastActiveAt

Creator darf:

- Agenten anlegen
- Authority delegieren
- Permissions vergeben/revozieren
- systemkritische Aktionen genehmigen
- Provider aktivieren
- Geräte autorisieren
- Deployments freigeben
- Recovery freigeben
- globale Sicherheitsregeln ändern

Alle Creator-Aktionen werden auditiert.

## 6. Agent Identity

Attribute:

- agentId
- name
- description
- role
- status
- authorityId
- autonomyProfileId
- capabilityIds
- toolIds
- skillIds
- runtimePolicyId
- networkPolicyId
- dataPolicyId
- budgetPolicyId
- parentAgentId
- version
- createdAt
- updatedAt

Mögliche Rollen:

- Supervisor
- Planner
- Researcher
- Builder
- Scientist
- Critic/Buddy
- QA
- Security
- Recovery
- Deployment
- Browser/Computer Use
- Integrator

Jeder Agent besitzt einen begrenzten Authority Scope.

## 7. Autonomy Profile

Attribute:

- profileId
- name
- planning
- research
- sandboxCreation
- experimentExecution
- codeGeneration
- codeExecution
- externalRead
- externalWrite
- deployment
- deviceControl
- credentialAccess
- approvalBypass
- maxConcurrentRuns
- maxRuntimeSeconds
- escalationPolicyId

approvalBypass MUSS immer false sein.

## 8. Capability- und Permission-Modell

Drei Ebenen:

CONNECTOR → CAPABILITY → PERMISSION

Capability-Attribute:

- capabilityId
- name
- domain
- riskLevel
- inputSchema
- outputSchema
- requiredPermissions
- requiredResources
- networkRequirement
- reversible
- approvalRequired

Permission-Attribute:

- permissionId
- subjectId
- capabilityId
- resourceScope
- actionScope
- expiresAt
- grantedBy
- reason
- status
- createdAt

Default-Matrix:

| Fähigkeit | Standard |
|---|---|
| lokale Analyse | innerhalb Scope erlaubt |
| Sandbox erstellen | Agent-Scope |
| Sandbox-Code ausführen | Agent-Scope |
| Internet | DENY |
| externe API lesen | DENY |
| externe API schreiben | DENY |
| Repository lesen | Connector + Permission |
| Repository schreiben | EXPLICIT APPROVAL |
| Deployment | EXPLICIT APPROVAL |
| Gerät steuern | EXPLICIT AUTHORIZATION |
| Credentials lesen | DENY; nur scoped broker |
| Authority ändern | CREATOR ONLY |
| Approval umgehen | NEVER |

## 9. Permission Broker

Vor jeder geschützten Aktion prüfen:

1. Identität
2. Agent
3. Authority
4. Capability
5. Resource Scope
6. Policy
7. Approval
8. Expiration
9. Runtime/Sandbox
10. Network Policy
11. Data Policy

Ergebnis enthält:

- decisionId
- allowed
- reason
- requiredApproval
- evaluatedPolicies
- timestamp

Deny-by-default.

## 10. Execution Gate

Kein Agent darf direkt geschützte Tools ausführen.

Pfad:

Agent → Permission Broker → Policy → Approval → Execution Gate → Execution Broker → Worker → Runtime

Das Gate evaluiert und bindet den konkreten Aufruf vor Ausführung.

## 11. Task

Attribute:

- taskId
- missionId
- objectiveId
- parentTaskId
- title
- description
- priority
- status
- assignedAgentId
- requiredCapabilities
- dependencies
- inputs
- expectedOutputs
- constraints
- approvalRequired
- createdAt
- startedAt
- completedAt

Tasks müssen idempotent und wiederaufnehmbar sein.

## 12. Mission

Attribute:

- missionId
- title
- description
- creatorId
- objectives
- agentIds
- policyId
- status
- priority
- budgetId
- createdAt
- updatedAt

## 13. Run

Attribute:

- runId
- taskId
- agentId
- workerId
- sandboxId
- runtimeId
- status
- attempt
- leaseId
- startedAt
- finishedAt
- inputDigest
- outputDigest
- errorId
- evidenceIds

## 14. Worker Fabric

MUSS unterstützen:

- Lease
- Heartbeat
- Timeout
- Cancellation
- Retry
- Dead Letter
- Orphan Detection
- Idempotency
- Recovery

Worker darf keine nicht autorisierte Capability ausführen.

## 15. Sandbox Manager

Sandbox-Attribute:

- sandboxId
- name
- type
- runtimeId
- imageId
- ownerAgentId
- status
- networkPolicyId
- resourcePolicyId
- filesystemPolicyId
- secretPolicyId
- createdAt
- expiresAt
- snapshotIds

Sandbox-Typen:

- DEVELOPMENT
- EXPERIMENT
- TEST
- BROWSER
- SECURITY
- MIGRATION
- STAGING
- RECOVERY
- DIAGNOSTIC

Default:

- Netzwerk DENY
- minimale Capabilities
- read-only Basis
- Ressourcenlimits
- keine Host-Secrets
- keine ungeprüften Mounts

## 16. Runtime Registry

Runtime-Attribute:

- runtimeId
- name
- version
- platform
- architecture
- adapterType
- image
- capabilities
- buildSupported
- testSupported
- debugSupported
- sandboxSupported
- status

Status:

AVAILABLE, DEGRADED, UNAVAILABLE.

Runtime-Fähigkeiten dürfen nicht nur aus Namen angenommen, sondern müssen verifiziert werden.

## 17. OCI / Container Security

Wenn OCI verwendet wird, gelten mindestens:

- Netzwerk standardmäßig deaktiviert
- CPU-Limit
- RAM-Limit
- PID-Limit
- read-only Root-Filesystem
- kontrollierte writable Bereiche
- minimierte Capabilities
- no-new-privileges
- definierte Mounts
- Prozessgrenzen
- Timeout
- Cleanup
- Snapshot/Restore
- Integritätsprüfung

Production Ready erst nach ausführbarem Security-Nachweis.

## 18. Experiment Engine

Experiment-Attribute:

- experimentId
- missionId
- objectiveId
- taskId
- agentId
- sandboxId
- title
- hypothesis
- baseline
- control
- variables
- confounders
- expectedResult
- alternativeExplanations
- status
- knowledgeState
- evidenceIds
- observationIds
- replicationIds
- createdAt
- updatedAt

Lifecycle:

Hypothesis → Baseline → Control → Intervention → Observation → Replication → Evidence → Validation → Knowledge State.

Direkte Hochstufung eines Experiments auf ESTABLISHED ist verboten.

## 19. Knowledge

Attribute:

- knowledgeId
- layer
- subject
- predicate
- object
- state
- confidence
- sourceIds
- evidenceIds
- verification
- experimentIds
- contradicts
- supports
- createdAt
- updatedAt

Layer:

- EPISODIC
- SEMANTIC
- PROCEDURAL

States:

- UNKNOWN
- HYPOTHESIS
- OBSERVED
- SUPPORTED
- ESTABLISHED
- CONTRADICTED
- REJECTED
- UNVERIFIED

ESTABLISHED benötigt Evidence und Verification.

## 20. Evidence

Attribute:

- evidenceId
- type
- sourceId
- experimentId
- claim
- value
- digest
- capturedAt
- capturedBy
- verificationState

VerificationState:

UNVERIFIED, VERIFIED, REJECTED.

Evidence darf nicht unbemerkt verändert werden.

## 21. Research Stack

Quellentypen:

- Web
- wissenschaftliche Literatur
- arXiv
- PubMed
- IEEE
- Herstellerdokumentation
- GitHub
- Patente
- Standards
- technische PDFs
- Webseiten
- Foren/Communities
- lokale Dokumente

Source-Attribute:

- sourceId
- type
- uri
- title
- publisher
- retrievedAt
- publishedAt
- contentDigest
- relevantPassages
- claimIds
- contradictingClaimIds
- evidenceType
- researchRunId

Quelle, Claim, Interpretation und Evidence müssen getrennt behandelt werden.

## 22. Document Engine

Zieltypen:

PDF, DOC/DOCX, XLS/XLSX, CSV, TXT, ZIP, HTML, Markdown, Bilder, OCR.

Pipeline:

Dokument → Parser → Chunks → Metadaten → Index/Embeddings → Claims → Evidence.

Lokale Dokumente müssen entsprechend Policy lokal verarbeitet werden können.

## 23. Knowledge Graph

Beziehungen:

- benötigt
- verwendet
- beschrieben in
- implementiert in
- abhängig von
- getestet mit
- widersprochen durch
- bestätigt durch Experiment
- abgeleitet aus
- ersetzt durch

## 24. Buddy / Critic

Der Critic prüft:

- Annahmen
- Evidenzlücken
- alternative Erklärungen
- Widersprüche
- Sicherheitsrisiken
- Regression
- Nebenwirkungen

Er darf keine Evidence erfinden.

## 25. Error Intelligence

Incident-Attribute:

- incidentId
- severity
- source
- runId
- agentId
- errorId
- symptom
- rootCause
- contributingFactors
- status
- evidenceIds
- regressionTestIds
- createdAt
- resolvedAt

Workflow:

Detect → Classify → Investigate → Reproduce → Experiment → Fix → Regression Test → Verify → Resolve → Learn.

## 26. Recovery

Workflow:

Detect → Snapshot/Checkpoint → Restore → Smoke Test → Regression → Verification → Resume.

Recovery gilt erst nach Test als erfolgreich.

## 27. Event Fabric

Event-Attribute:

- eventId
- sequence
- type
- timestamp
- actorId
- actorType
- authorityId
- action
- targetId
- targetType
- parentEventId
- causationId
- correlationId
- payloadDigest
- result
- evidenceIds

Eigenschaften:

- append-only
- sequenziert
- Integritätsprüfung
- kausal verknüpft
- auditierbar
- replay-fähig

## 28. Audit

Zu auditieren:

- Login/Session
- Authority
- Permission
- Connector
- Tool Call
- Agent Action
- Sandbox
- Runtime
- Device
- File Change
- Repository Change
- Network Permission
- External API
- Approval
- Deployment
- Recovery
- Security Event
- Configuration Change

## 29. Provenance

Rückverfolgbare Kette:

Artifact ← Run ← Task ← Agent ← Mission ← Plan ← Evidence ← Sources/Inputs

und:

Result → Decision → Action → Deployment.

## 30. Timeline / Replay / Why

Timeline zeigt:

- Agent Actions
- Tool Calls
- Status
- Events
- Experimente
- Fehler
- Approvals
- Deployments
- Recovery

Replay rekonstruiert soweit technisch möglich reproduzierbare Zustände.

Why zeigt überprüfbare Gründe:

- Ziel
- relevante Inputs
- Policy
- Permission
- Evidence
- Ergebnis
- nächster Schritt

Es wird keine private interne Gedankenkette als Produktfunktion ausgegeben.

## 31. Connector Manager

Unterstützte Klassen:

- REST
- Web API
- WebSocket
- SSE
- MQTT
- Serial
- USB
- BLE
- Local Process
- Native Bridge

Connector-Attribute:

- connectorId
- name
- type
- providerId
- capabilities
- credentialRef
- networkPolicyId
- dataPolicyId
- status
- version

## 32. Provider / Drittanbieter

Provider benötigen:

- Registrierung
- Capability Discovery
- Credential Binding
- Data Policy
- Network Policy
- Permission Scope
- Health
- Audit
- Version
- Disconnect
- Revocation

Externe Daten dürfen nur gemäß Data Policy übertragen werden.

## 33. Secrets / Credential Vault

Secrets:

- nicht im Source Code
- nicht im Browser
- nicht in normalen Events
- nicht in unredigierten Logs
- nicht in Screenshots
- nicht in Evidence
- nicht an unautorisierte Agenten

Agenten erhalten ausschließlich scoped Zugriff für den konkreten Vorgang.

## 34. Data Protection

Für Benutzer-, Geräte-, App-, Projekt-, Credential-, Datei-, Netzwerk- und sonstige schützenswerte Daten:

- Policy-gesteuerte Speicherung
- Policy-gesteuerte Übertragung
- externe Verarbeitung nur explizit
- externes Training standardmäßig verboten
- externe Speicherung standardmäßig verboten
- Datenminimierung
- Verschlüsselung bei Speicherung
- Verschlüsselung bei Übertragung
- Log-Redaction
- Retention
- kontrollierte Löschung
- Audit

Unverschlüsselte Weitergabe an nicht autorisierte Dritte ist verboten.

## 35. Device / Hardware Fabric

Abstraktion für:

- USB
- Serial
- ADB
- Fastboot
- BLE
- Bluetooth
- WLAN
- NFC
- Kamera
- Sensoren
- SDR
- ESP32
- UWB
- Radar/mmWave
- externe Speicher
- Native Bridges

## 36. Device

Attribute:

- deviceId
- name
- manufacturer
- model
- serialHash
- trustState
- status
- capabilities
- connectorIds
- resourceProfile
- securityProfile
- ownerScope

TrustState:

UNKNOWN, DISCOVERED, IDENTIFIED, TRUSTED, AUTHORIZED, REVOKED.

Status:

OFFLINE, AVAILABLE, ALLOCATED, EXECUTING, ERROR.

## 37. Device Scheduler

Berücksichtigt:

- CPU
- RAM
- GPU
- OS
- Architektur
- Runtime
- Netzwerk
- Trust
- Capability
- Auslastung
- Agent Permission
- Task Constraints

## 38. Computer Use

Innerhalb autorisierter Device-/Sandbox-/Permission-Grenzen:

- Browser Navigation
- DOM
- Click
- Type
- Screenshot
- OCR
- Download
- Desktop Input
- Process Lifecycle
- CLI

Jede Aktion ist auditierbar.

## 39. CT45P / Native Bridge

Eine konkrete Bridge ist ein Connector innerhalb der Hardware Fabric.

Erlaubte Bereiche:

- Discovery
- Capability Reporting
- autorisierte Kommunikation
- Telemetrie
- definierte Aktionen

Schreibende/systemkritische Aktionen benötigen Device Authority.

## 40. Tool Workshop

Lifecycle:

Discovery → Specification → Implementation → Sandbox → Security Test → Unit Test → Integration Test → Experiment → Registration → Versioning.

Nur validierte Tools dürfen ACTIVE werden.

## 41. Skill Fabric

Skill kombiniert Tools.

Attribute:

- skillId
- name
- version
- description
- requiredCapabilities
- toolIds
- inputSchema
- outputSchema
- securityPolicyId
- testIds
- status

Status:

DRAFT, VALIDATED, ACTIVE, DEPRECATED.

## 42. GitHub / Repository

Erlaubte Read-Funktionen nach Connector-Freigabe:

- Repository lesen
- suchen
- Code analysieren
- Issues analysieren
- PRs analysieren
- Releases prüfen
- Dokumentation prüfen
- Dependencies analysieren
- Sandbox-Branches vorbereiten

Write-Funktionen wie Commit, Push, Merge, Release und Delete benötigen die entsprechende Permission und bei kritischen Änderungen Approval.

## 43. Development Pipeline

Agent → Workspace → Sandbox → Build → Unit Tests → Static Analysis → Integration Tests → Browser Tests → Hardware-in-the-loop falls relevant → Security Tests → Approval → Deployment.

## 44. Simulation / Visualization

Strikte Unterscheidung:

- Visualization = Darstellung vorhandener Zustände
- Simulation = hypothetische Ausführung
- Experiment = kontrollierte ausführbare Prüfung
- Replay = Rekonstruktion vergangener Abläufe

## 45. Offline Fabric

Soweit technisch möglich lokal:

- Modelle
- Dokumentation
- Git
- Package Mirrors
- Container Images
- SDKs
- Compiler
- Interpreter
- Daten
- Vector Index
- Knowledge Graph

Offline Evidence muss bei Sync provenance-erhaltend synchronisiert werden.

## 46. Scheduler / Automation

Automation kann zeit- oder ereignisbasiert sein.

Attribute:

- automationId
- trigger
- action
- permissionScope
- status
- createdBy

Status:

ACTIVE, PAUSED, DISABLED, ERROR.

## 47. Observability

Pflichtbereiche:

- Logs
- Metrics
- Events
- Traces
- Errors
- Task History
- Device Telemetry
- Experiment Telemetry
- Resource Usage

UI-Daten müssen auf persistierte/verifizierbare Daten zurückführbar sein.

## 48. Approval Center

Jede Approval-Ansicht muss zeigen:

- Was?
- Warum?
- Wer?
- Welche Daten?
- Welche Ressourcen?
- Risiken
- Permissions
- Tests
- Evidence
- Änderungen
- Rollback

Entscheidungen:

APPROVE, REJECT, REQUEST_CHANGES.

## 49. Deployment

Voraussetzungen:

- Build Artifact
- Version
- Test Evidence
- Security Evidence
- Approval
- Deployment Plan
- Rollback Plan
- Health Check
- Smoke Test
- Monitoring

Deployment ist erst nach erfolgreichem Smoke Test SUCCEEDED.

## 50. Rollback

Rollback:

1. Zielversion bestimmen
2. Artefakt verifizieren
3. Änderung ausführen
4. Health Check
5. Smoke Test
6. Regression Check
7. Status aktualisieren
8. Evidence erzeugen

## 51. Security Gates

Pflichtprüfungen:

- Authentication
- Authorization
- Privilege Escalation
- Self-Grant
- Secret Leakage
- SSRF
- Arbitrary Command Execution
- Sandbox Escape
- Network Bypass
- Audit Manipulation
- Provenance Manipulation
- Replay Attack
- Concurrent State Corruption
- Unauthorized Device Access
- Unauthorized Provider Access

## 52. Concurrency

Zu testen:

- zwei Worker auf denselben Job
- doppelte Events
- parallele Permission Changes
- parallele Agent Updates
- Snapshot während Run
- Recovery während Run
- Cancellation während Execution
- Lease Expiration
- Prozessabsturz

## 53. Persistenz

Mindestens folgende Entitäten benötigen persistente Integrität:

Agent, Mission, Objective, Task, Run, Sandbox, Runtime, Experiment, Evidence, Knowledge, Incident, Event, Approval, Connector, Device, Deployment, Automation.

## 54. Fehlerobjekt

Attribute:

- errorId
- code
- category
- severity
- message
- safeMessage
- stackRef
- entityId
- runId
- retryable
- recoveryStrategy
- createdAt

Sensitive Stack-Information darf nicht unredigiert an Benutzer oder externe Systeme gelangen.

## 55. Testpyramide

Pflicht:

1. Unit
2. Integration
3. Regression
4. Security
5. Concurrency
6. Runtime
7. API
8. Browser
9. E2E
10. Failure Injection
11. Recovery
12. Production-like

## 56. End-to-End-Abnahmeszenario

1. Anwendung starten
2. Creator Bootstrap
3. Creator Session
4. Agent anlegen
5. Mission anlegen
6. Objective anlegen
7. Task erzeugen
8. Agent planen lassen
9. Permission prüfen
10. Sandbox erzeugen
11. Runtime wählen
12. Experiment ausführen
13. Observation erfassen
14. Evidence erzeugen
15. Replication durchführen
16. Ergebnis validieren
17. Knowledge erzeugen
18. Regression Test erzeugen
19. Approval anzeigen
20. Build erzeugen
21. Security Tests
22. Deployment
23. Smoke Test
24. Fehler simulieren
25. Recovery
26. Restore prüfen
27. Timeline prüfen
28. Replay prüfen
29. Why prüfen
30. vollständige Audit-Kette prüfen

## 57. Rekonstruktionsumfang

Eine neue Implementierung muss aus diesem Dokument rekonstruieren können:

- Domänenmodell
- Entitäten
- Attribute
- Zustände
- Beziehungen
- Berechtigungen
- Capabilities
- Datenflüsse
- Eventmodell
- Audit
- Provenance
- Runtime
- Sandbox
- Agenten
- Experimentlogik
- Recovery
- Integrationen
- UI-Navigation
- Statusdarstellung
- Testanforderungen
- Sicherheitsanforderungen
- Abnahmekriterien

Nicht dokumentiertes Verhalten darf nicht still als Spezifikation angenommen werden.

## 58. Definitionen

IMPLEMENTED = Code vorhanden.

INTEGRATED = Abhängige Komponenten funktionieren gemeinsam.

VERIFIED = ausführbare Tests und Evidence bestehen.

PRODUCTION_READY = zusätzlich Security, Recovery, Monitoring, Rollback und Betriebsbedingungen nachgewiesen.

DONE = Requirement erfüllt und dokumentiert.

## 59. Requirement-Status

Jede Requirement-ID benötigt:

- requirementId
- implementationRefs
- testRefs
- securityTestRefs
- evidenceRefs
- documentationRefs
- status

Status:

NOT_STARTED, PLANNED, IMPLEMENTED, INTEGRATED, VERIFIED, PRODUCTION_READY, BLOCKED.

## 60. Offene Verifikationsbereiche

Folgende Punkte dürfen nicht ohne ausführbaren Nachweis als vollständig gelten:

- Creator Bootstrap
- Event/Audit/Provenance-Fabric
- OCI Snapshot/Restore
- echte Ressourcenquoten
- Runtime Registry
- Computer Use
- Device Scheduling/Fabric
- Simulation/3D-Fabric
- Offline-Fabric
- Provider-Adapter-Ausführung
- vollständige UI-Verifikation
- Concurrency-Verifikation
- Failure-Injection/Recovery
- Gesamt-E2E

Diese Liste ist Prüfauftrag, keine Behauptung über den aktuellen Implementierungsstand.

## 61. Fertigstellungsreihenfolge

P0 Fundament:
- Specification / Acceptance Matrix
- Authentication / Authorization
- Creator Bootstrap
- Event / Audit / Provenance
- Execution Gate / Broker
- Sandbox Security

P1 Runtime:
- Queue / Worker / Run
- Sandbox Lifecycle
- Snapshot / Restore
- Recovery
- Experiment Engine
- Causal Validation
- Error Intelligence
- Regression
- Universal Status

P2 Agent Fabric:
- Orchestrator
- Planner
- Researcher
- Builder
- Scientist
- Critic
- QA
- Security
- Recovery
- Deployment

P3 Erweiterungsfabric:
- Runtime Registry
- Tool Workshop
- Skill Fabric
- Provider Fabric
- Device Fabric
- Computer Use
- Simulation
- Offline

P4 Control Center:
- Observatory
- Timeline
- Replay
- Why
- Approval Center
- Research
- Knowledge
- Security
- Integrations

P5 Production:
- Deployment
- Backup
- Restore
- Migration
- Rollback
- Monitoring
- Operational Security

P6 Final Acceptance:
- Requirement Matrix
- E2E
- Security
- Concurrency
- Recovery
- Browser
- Production-like
- Dokumentationsprüfung

## 62. Absolute Sicherheitsgrenzen

Kein Agent, Skill, Connector oder Provider darf:

1. Self-Grant ausführen.
2. Permissions eskalieren.
3. Approval umgehen.
4. Secrets exfiltrieren.
5. unautorisierten Netzwerkzugriff herstellen.
6. unautorisierte Geräte steuern.
7. unautorisierte externe Verarbeitung durchführen.
8. unautorisierte Speicherung durchführen.
9. unautorisierte Daten weitergeben.
10. Audit/Provenance manipulieren.
11. Verification ohne Evidence behaupten.
12. Recovery ohne Test behaupten.
13. Production Readiness ohne Abnahme behaupten.
14. systemkritische Aktionen verdeckt ausführen.
15. temporäre Delegation dauerhaft machen.
16. Execution Gate oder Permission Broker umgehen.

## 63. Zielarchitektur

Creator
→ Control Center
→ Control Plane
→ Identity / Authority
→ Permission Broker
→ Policy Engine
→ Approval Center
→ Agent Orchestrator
→ Agent Fabric
→ Task / Job / Run Fabric
→ Execution Gate
→ Execution Broker
→ Sandbox / Runtime / Tool / Skill / Device / Computer Use / Provider
→ Observation / Evidence
→ Verification / Knowledge / Regression / Recovery
→ Event / Audit / Provenance
→ Timeline / Replay / Why / Observatory
→ Deployment / Monitoring / Recovery

## 64. Verbindliche Zieldefinition

Die Anwendung ist nicht das Chatfenster. Sie ist die gesamte kontrollierte Agent-Infrastruktur:

Creator → Authority → Agent → Plan → Task → Execution → Sandbox → Runtime → Observation → Evidence → Verification → Knowledge → Approval → Deployment → Monitoring → Recovery.

Alle externen Dienste, Geräte, Modelle, APIs und Tools sind kontrollierte Ressourcen.

Der Agent darf maximal innerhalb seiner delegierten Authority autonom handeln.

Der Creator behält die Kontrolle über systemkritische Auswirkungen.

Jeder relevante Vorgang bleibt nachvollziehbar, prüfbar, reproduzierbar und soweit technisch möglich rücksetzbar.

## 65. Änderungsregel

Bei jeder Änderung:

1. Requirement identifizieren.
2. Auswirkungen bestimmen.
3. Permission-/Security-Auswirkungen bestimmen.
4. Datenmodell prüfen.
5. Event-/Provenance-Auswirkungen prüfen.
6. Implementieren.
7. Unit Test.
8. Integration Test.
9. Security Test.
10. E2E/Regression.
11. Evidence speichern.
12. Dokumentation aktualisieren.
13. Requirement-Status aktualisieren.

## 66. Gesamt-Definition of Done

Das Gesamtprodukt ist erst vollständig, wenn:

- alle verpflichtenden Requirements implementiert sind
- alle Kernpfade integriert sind
- alle Security Gates bestanden sind
- kritische Datenflüsse geschützt sind
- kritische Zustände persistiert werden
- Recovery ausführbar ist
- Rollback ausführbar ist
- E2E erfolgreich ist
- Browser/UI verifiziert ist
- keine bekannten kritischen Security-Lücken offen sind
- externe Integrationen permission-gesteuert sind
- Audit und Provenance vollständig sind
- Statusanzeigen echte Runtime-Zustände darstellen
- Offline-Funktionen soweit spezifiziert nachgewiesen sind
- Agenten innerhalb ihrer Authority autonom arbeiten
- systemkritische Aktionen unter Creator-/Approval-Kontrolle bleiben
- die vollständige Requirement-Matrix PASS oder einen ausdrücklich dokumentierten externen Blocker enthält.

## 67. Dokumentstatus

Dieses Dokument ist die kanonische deutschsprachige Soll-Spezifikation für Rekonstruktion und Fertigstellung von BabajagaBoB.

Bei Konflikten gilt:

1. explizite Sicherheitsregel
2. Authority-/Permission-Regel
3. Acceptance Requirement
4. technische Implementierung
5. UI-Darstellung

Eine bestehende Implementierung darf diese Spezifikation nicht stillschweigend abschwächen.

**ENDE**
