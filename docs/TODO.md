# BabajagaBoB – vollständige Umsetzungs-Roadmap

Statuslegende: [x] umgesetzt · [~] in Arbeit/Grundlage vorhanden · [ ] offen

## 00. Fundament
- [x] Repository und Branch-Workflow
- [x] Next.js GUI-first Control Center
- [x] typisierte Domänenmodelle
- [x] Live Control Plane API
- [x] sichtbare Status-/Fortschrittszustände
- [x] Emergency Lockdown
- [x] Network DENY by default
- [x] Audit- und Event-Grundlage
- [x] Job Queue-Grundlage
- [x] Policy-Grundlage
- [x] Sandbox Runtime Interface + Mock Adapter
- [x] Tool Registry
- [x] Capability/Authority Boundary
- [x] Artifact Provenance
- [x] Persistence Interface

## 01. Kern-Ausführungsmaschine
- [ ] Run-Domäne mit Run-ID und Lifecycle
- [ ] Job Lease/Heartbeat/Expiry
- [ ] Retry Budget und Backoff
- [ ] Cancellation/Abort
- [ ] Worker Dispatcher
- [ ] Task → Run → Sandbox-Verknüpfung
- [ ] Runtime Adapter Registry
- [ ] Resource Enforcement
- [ ] Timeout Enforcement
- [ ] Recovery State Machine
- [ ] Rollback State Machine
- [ ] idempotente Aktionen

## 02. Autorität und Sicherheit
- [ ] RBAC: Owner/Admin/Developer/Reviewer/Operator/Viewer
- [ ] ABAC: Actor/Resource/Environment/Action/Risk/Time
- [ ] Capability Token vollständig scoped
- [ ] Token Revocation
- [ ] Delegation Chain Validation
- [ ] Creator Root Authority unveränderbar
- [ ] No self-grant / no impersonation
- [ ] Approval Gates
- [ ] Approval Center mit Änderungsumfang
- [ ] Secret Broker Interface
- [ ] Short-lived credentials
- [ ] Secret redaction
- [ ] Security event policy
- [ ] Kill Switch: System/Agent/Task/Experiment/Sandbox/Deployment

## 03. Sandbox- und Computer-Fabric
- [ ] echte Container Runtime Adapter
- [ ] VM Adapter Boundary
- [ ] Browser Sandbox
- [ ] Desktop/GUI Sandbox
- [ ] Linux/Windows/macOS-kompatible Adapter, soweit technisch/legal möglich
- [ ] Snapshot/Restore
- [ ] filesystem isolation
- [ ] process isolation
- [ ] network allowlist enforcement
- [ ] CPU/RAM/storage/process limits
- [x] device allocation boundary
- [x] Device Fabric foundation
- [x] Device trust states
- [x] Device capability discovery ≠ authorization
- [~] offline execution package boundary

## 04. Tool / Skill / Runtime Workshop
- [ ] Tool lifecycle: discover → spec → prototype → test → validate → register
- [ ] Tool versioning
- [ ] Tool compatibility matrix
- [ ] Skill registry
- [ ] Skill composition
- [ ] Runtime registry
- [ ] Runtime version/platform/architecture metadata
- [ ] debugger adapters
- [ ] parser/compiler adapters
- [ ] connector adapters
- [ ] browser/GUI skills
- [ ] deployment/migration/diagnostic tools
- [ ] automatic regression tests for generated tools

## 05. Agent Fabric
- [ ] Supervisor
- [ ] Planner
- [ ] Builder
- [ ] Research
- [ ] Scientist/Experiment
- [ ] QA
- [ ] Browser
- [ ] Security/Guardian
- [ ] Deployment/Operator
- [ ] Recovery
- [ ] Agent handoffs
- [ ] task routing
- [ ] workload scheduling
- [ ] agent health/heartbeat
- [x] autonomy profiles
- [ ] Creator delegation model

## 06. Mission / Experiment / Science Layer
- [ ] Creator → Mission → Objective → Task
- [x] experiment lifecycle
- [x] baseline/control/replication (data model)
- [ ] variables and confounders
- [x] expected vs observed results
- [x] evidence records
- [x] causal scope (foundation)
- [ ] knowledge state transitions
- [ ] contradiction handling
- [ ] unresolved/unknown state
- [ ] Agent Decision Record without hidden chain-of-thought
- [ ] experiment replay

## 07. Learning / Reliability / Recovery
- [ ] Learn → Detect → Predict → Prepare → Recover → Verify
- [ ] incident model
- [ ] failure mode model
- [ ] root cause record
- [ ] contributing factors
- [ ] prevention action
- [x] Never-Again regression test linkage
- [ ] predictive readiness signals
- [ ] prepared rollback artifacts
- [ ] recovery rehearsals
- [~] autonomous investigation boundary
- [~] Creator escalation boundary

## 08. CI/CD und Software Lifecycle
- [x] branch-per-task (workflow contract)
- [x] sandbox-per-run
- [ ] commit provenance
- [ ] lint
- [ ] typecheck
- [ ] unit tests
- [ ] integration tests
- [ ] security scan
- [ ] build
- [ ] browser tests
- [ ] preview
- [ ] evaluation gate
- [ ] approval gate
- [ ] staging
- [ ] smoke tests
- [ ] production gate
- [ ] automatic rollback
- [ ] regression blocks promotion

## 09. Persistence / Data
- [x] durable ControlStore adapter (local atomic JSON)
- [x] transactional writes (atomic file replacement)
- [x] event persistence boundary with integrity-checked event log
- [~] audit persistence boundary (store-ready)
- [~] artifact metadata persistence boundary (store-ready)
- [x] provenance graph persistence with integrity checks
- [x] schema version + migration boundary
- [x] local backup/restore
- [x] SHA-256 integrity verification
- [x] bounded local backup retention
- [x] local-first/offline storage boundary
- [x] explicit external-provider boundary

## 10. Knowledge Fabric
- [x] working memory
- [x] episodic memory
- [x] semantic memory
- [x] negative knowledge
- [x] knowledge graph foundation
- [~] vector index boundary (not source of truth)
- [ ] source provenance
- [ ] observation/extraction/cross-check/reproduction pipeline
- [x] contradiction graph foundation
- [ ] confidence-free evidence states rather than one magic score

## 11. Visualization / Simulation
- [x] 2D visualization model foundation
- [x] flowchart model
- [x] timeline model
- [x] state machine model
- [x] dependency graph model
- [x] network graph model
- [x] 3D scene/model boundary
- [ ] digital twin
- [x] simulation scenarios
- [x] simulation results
- [x] Causal Replay event/provenance data boundary
- [~] live state visualization boundary

## 12. GUI / Control Center
- [x] Overview
- [x] Agents
- [x] Missions
- [x] Tasks
- [x] Queue
- [x] Approvals
- [x] Experiments
- [x] Sandboxes
- [x] Artifacts
- [x] Security placeholder
- [ ] Runtime dashboard
- [ ] Tool Workshop
- [ ] Capability Graph
- [ ] Authority Graph visualization
- [ ] Provenance Graph
- [ ] Agent Timeline
- [ ] Why? structured work record
- [ ] Creator Inbox: Inform / Ask / Block
- [ ] Goal Negotiation
- [ ] Simulation Mode
- [ ] deployment dashboard
- [ ] device pool
- [ ] integrations registry
- [ ] global search
- [ ] filters and event replay

## 13. Privacy
- [x] no analytics
- [x] no advertising
- [x] no tracking
- [x] no silent telemetry
- [x] no third-party sharing by default
- [x] explicit provider integrations
- [ ] network deny by default
- [ ] secret redaction
- [x] local-first data boundary
- [x] privacy policy/audit boundary
- [ ] hosting/backup/provider inventory before claiming absolute non-disclosure

## 14. Verification / Release
- [ ] typecheck
- [ ] production build
- [ ] unit/integration suite
- [ ] API contract tests
- [ ] browser verification
- [ ] security regression suite
- [ ] lockdown tests
- [ ] approval tests
- [ ] capability boundary tests
- [ ] runtime isolation tests
- [ ] provenance integrity tests
- [ ] CI green
- [ ] preview deployment
- [ ] release candidate
- [ ] PR review
- [ ] merge to main only after verification
