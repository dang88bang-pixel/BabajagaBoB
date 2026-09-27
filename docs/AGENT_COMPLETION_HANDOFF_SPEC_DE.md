# BABAJAGA BOB — AGENT-INDEPENDENT COMPLETION & HANDOFF SPECIFICATION

**Purpose:** This document defines the repository as a self-describing, agent-independent engineering target. Any capable coding agent must be able to take a fresh checkout, reconstruct the intended system, inspect the current evidence, continue implementation, run verification, repair defects, and prepare a release without relying on hidden conversation context.

**Normative language:** MUST, MUST NOT, SHOULD, MAY.

## 1. Canonical source hierarchy

When reconstructing or changing the application, use this order:

1. Explicit security and authority rules.
2. `docs/APP_VOLLSTAENDIGE_SPEZIFIKATION_DE.md`.
3. `docs/acceptance/requirements.json`.
4. `docs/STATUS.md` and `docs/TODO.md` for current implementation/evidence state.
5. Component documentation under `docs/`.
6. Tests and verification scripts.
7. Source code.
8. README and UI wording.

Code MUST NOT silently weaken a higher-level requirement. A discrepancy MUST become a documented finding and, where appropriate, a repair.

## 2. Source-of-truth principle

The repository is the complete engineering handoff. No essential requirement may exist only in chat history.

A fresh agent MUST be able to determine:

- product purpose;
- architecture and module boundaries;
- domain entities and attributes;
- lifecycle/state machines;
- authority and permission rules;
- security boundaries;
- execution path;
- persistence model;
- event/audit/provenance model;
- agent roles and autonomy limits;
- sandbox/runtime behavior;
- experiments and knowledge rules;
- error and recovery lifecycle;
- provider/connector model;
- device/hardware model;
- computer-use boundary;
- offline behavior;
- UI/control-center requirements;
- testing and evidence requirements;
- deployment/rollback requirements;
- remaining blockers;
- exact commands needed to verify the repository.

## 3. Product target

BabajagaBoB is a GUI-first, local-first autonomous full-stack agent control plane.

It is not merely a chat UI.

The controlled lifecycle is:

`Creator → Authority → Mission → Objective → Agent → Plan → Task → Policy → Permission → Approval → Execution Gate → Execution Broker → Worker → Sandbox/Runtime → Action → Observation → Evidence → Verification → Result → Knowledge/Artifact → Regression → Approval → Deployment → Monitoring → Recovery → Learning`

Every relevant operation MUST have identity, status, timestamps, actor, authority context, and traceable provenance.

## 4. Autonomous-agent contract

An agent MAY autonomously, within delegated authority:

- plan work;
- decompose missions into tasks;
- research;
- inspect repository content;
- create isolated workspaces/sandboxes;
- generate code;
- run tests;
- run experiments;
- reproduce defects;
- collect evidence;
- compare hypotheses;
- prepare fixes;
- prepare branches/patches;
- perform regression testing;
- prepare recovery plans;
- prepare deployments.

An agent MUST NOT:

- self-grant authority;
- self-grant permissions;
- bypass approval;
- bypass Execution Gate or Execution Broker;
- turn a temporary delegation into permanent authority;
- exfiltrate secrets;
- silently transmit protected data;
- enable external processing/storage/training without policy;
- access unauthorized devices;
- manipulate audit/provenance;
- claim verification without evidence;
- claim recovery without successful verification;
- claim production readiness without acceptance evidence.

`approvalBypass` is permanently false.

## 5. Capability security model

All external and privileged functionality uses:

`CONNECTOR → CAPABILITY → PERMISSION → POLICY → APPROVAL → EXECUTION GATE → EXECUTION BROKER`

A connected provider/device/tool is never equivalent to authorization.

Default policy:

| Resource/action | Default |
|---|---|
| Local analysis | allowed inside delegated scope |
| Sandbox creation | delegated scope |
| Sandbox execution | delegated scope |
| Internet | DENY |
| External API read | DENY |
| External API write | DENY |
| Repository read | explicit connector/capability |
| Repository write | explicit permission + critical-action approval |
| Deployment | explicit permission + approval |
| Device control | explicit authorization |
| Credential access | scoped broker only |
| Authority changes | Creator only |
| Approval bypass | NEVER |

All permissions MUST be scoped by subject, capability, resource, action, environment/task where applicable, expiry, and granting authority.

## 6. Execution invariant

There MUST be no protected execution path around the central authorization chain.

Canonical path:

`Agent/UI → API Guard → Authority/Permission Broker → Policy → Approval → Execution Gate → Execution Broker → Worker → Sandbox/Runtime/Connector/Device → Observation → Evidence/Audit/Provenance`

Any direct handler-to-tool, agent-to-shell, agent-to-device, agent-to-provider or agent-to-runtime path is a security defect unless it is itself the approved implementation of the same gate/broker contract.

## 7. Universal status fabric

Relevant entities MUST expose real runtime status.

Required states include:

`CREATED, QUEUED, PLANNING, WAITING, APPROVAL_REQUIRED, APPROVED, STARTING, RUNNING, EXPERIMENT, OBSERVING, VALIDATING, VERIFYING, SUCCEEDED, FAILED, BUG, BLOCKED, RECOVERING, CANCEL_REQUESTED, CANCELLED, REJECTED, EXPIRED, DEGRADED, OFFLINE`

Where measurable, progress MUST be 0–100.

At minimum a status record contains:

`statusId, entityId, entityType, state, progress, phase, message, startedAt, updatedAt, completedAt, actorId, runId, parentStatusId, errorId, approvalId`

The UI MUST derive status from real state, not simulated timers.

## 8. Core modules

The implementation target includes:

- Control Center / Creator
- Agent Orchestrator / Agent Fabric
- Mission / Objective / Task / Run
- Authority / Permission Broker / Policy Engine
- Execution Gate / Execution Broker
- Worker / Queue / Dispatcher
- Sandbox Manager
- Runtime Registry
- Experiment Engine
- Verification Engine
- Error Intelligence / Recovery
- Event / Audit / Provenance
- Research / Source / Document / Evidence / Claim
- Knowledge Graph / Knowledge State
- Buddy / Critic
- Tool Workshop / Skill Fabric
- Provider / Connector Manager
- Secret/Credential Vault
- Device / Hardware Fabric
- Computer Use
- Simulation / Visualization / Replay
- Offline Fabric
- Scheduler / Automation
- Observability
- Timeline / Replay / Why
- Approval Center
- Deployment / Release / Rollback
- Security / Privacy / Governance

## 9. Research and document fabric

Research is evidence-oriented, not a loose search result collection.

Supported source classes include:

- web;
- scientific literature;
- arXiv;
- PubMed;
- IEEE;
- manufacturer documentation;
- GitHub;
- patents;
- standards;
- technical PDFs;
- websites;
- forums/communities;
- local documents.

The Source Manager tracks discovery, retrieval, analysis, passages, claims, contradictions, dates, evidence type, and research-run provenance.

Document pipeline:

`Document → Parser → Chunks → Metadata → Index/Embeddings → Claims → Evidence`

Source, claim, interpretation and evidence MUST remain distinct objects.

## 10. Knowledge and scientific reasoning

Knowledge layers:

- EPISODIC
- SEMANTIC
- PROCEDURAL

Knowledge states:

- UNKNOWN
- HYPOTHESIS
- OBSERVED
- SUPPORTED
- ESTABLISHED
- CONTRADICTED
- REJECTED
- UNVERIFIED

`ESTABLISHED` requires evidence and verification.

Experiment lifecycle:

`Hypothesis → Baseline → Control → Intervention → Observation → Replication → Evidence → Validation → Knowledge State`

The system MUST preserve alternative explanations and contradictions. It MUST NOT manufacture causal certainty from a single observation.

## 11. Error and recovery contract

Error lifecycle:

`Detect → Classify → Investigate → Reproduce → Experiment → Fix → Regression Test → Verify → Resolve → Learn`

Recovery lifecycle:

`Detect → Snapshot/Checkpoint → Restore/Fix → Smoke Test → Regression → Verification → Resume`

Recovery is successful only when verification passes.

A recovery record MUST retain the triggering incident, evidence, chosen strategy, changed artifacts, tests, verification result and final state.

## 12. Event, audit and provenance

The event fabric is the canonical causal history.

Event records include:

`eventId, sequence, type, timestamp, actorId, actorType, authorityId, action, targetId, targetType, parentEventId, causationId, correlationId, payloadDigest, result, evidenceIds`

Properties:

- append-only;
- sequenced;
- integrity checked;
- causally linked;
- auditable;
- replayable where technically possible.

Audit covers authentication, authority, permission, connectors, tool calls, agent actions, sandboxes, runtimes, devices, file/repository changes, network permissions, external APIs, approvals, deployments, recovery and configuration/security events.

Provenance MUST connect artifacts to runs/tasks/agents/missions/plans and evidence/sources/inputs.

## 13. External integrations

Connector classes include:

- REST/Web API
- WebSocket
- SSE
- MQTT
- Serial
- USB
- BLE
- Local Process
- Native Bridge

Provider registration MUST include capability discovery, credentials, network/data policy, permission scope, health, version, audit, disconnect and revocation.

No provider may receive protected data merely because it is installed.

## 14. Secret and data boundary

Secrets MUST NOT appear in:

- source code;
- browser bundles;
- ordinary logs;
- screenshots;
- events;
- evidence;
- untrusted agent context.

Credential use MUST be scoped and brokered.

Default external policy:

- external processing: DENY;
- external storage: DENY;
- external training: DENY;
- network: DENY.

Sensitive data MUST be encrypted at rest and in transit where applicable, redacted from operational telemetry, retention-controlled and auditable.

## 15. Device and computer-use fabric

Device abstraction MUST support the architecture for:

USB, Serial, ADB, Fastboot, BLE, Bluetooth, WLAN, NFC, cameras, sensors, SDR, ESP32, UWB, radar/mmWave, external storage and native bridges.

Device trust states:

`UNKNOWN, DISCOVERED, IDENTIFIED, TRUSTED, AUTHORIZED, REVOKED`

Device runtime states:

`OFFLINE, AVAILABLE, ALLOCATED, EXECUTING, ERROR`

Discovery is not authorization.

Computer Use actions such as navigation, click, type, select, screenshot, OCR, download, process lifecycle, file read and terminal operations MUST be capability- and permission-controlled and audited.

A concrete browser/desktop driver is an implementation detail behind this boundary; it MUST NOT become a bypass.

## 16. Offline-first operation

Offline resources may include:

- models;
- documentation;
- Git;
- package mirrors;
- container images;
- SDKs;
- compilers/interpreters;
- datasets;
- vector indexes;
- knowledge graphs.

Local resources MUST be digest-verified. Offline import/export/sync MUST preserve provenance and verify target integrity. Domain-specific merge rules are required for packages, models, knowledge and other stateful resources.

## 17. Sandbox/runtime contract

Sandbox defaults:

- network deny;
- minimal capabilities;
- read-only base;
- bounded resources;
- no host secrets;
- no unverified mounts;
- deterministic cleanup;
- timeout;
- snapshot/restore where supported.

OCI/container execution, when enabled, MUST use security hardening including network isolation, resource limits, read-only rootfs, capability minimization, no-new-privileges, bounded writable areas, PID limits and cleanup.

A runtime capability MUST be demonstrated, not inferred from a runtime name.

## 18. GitHub/repository engineering

The agent may inspect/search/analyze repositories when authorized.

Writes such as:

- create/update/delete;
- commit;
- push;
- merge;
- release;

require the corresponding permission and critical-action approval according to policy.

Every repository mutation MUST be auditable and tied to a task/run/agent.

## 19. Development lifecycle

Every application change follows:

1. identify requirement;
2. inspect affected architecture;
3. inspect permission/security implications;
4. inspect data model;
5. inspect event/provenance implications;
6. implement;
7. unit test;
8. integration test;
9. security test;
10. regression/E2E test as applicable;
11. collect evidence;
12. update documentation;
13. update acceptance status.

Agents MUST repair root causes rather than merely suppressing test failures.

## 20. UI/Control Center requirements

The Control Center must expose at least:

Dashboard, Creator, Agents, Missions, Objectives, Tasks, Runs, Experiments, Sandboxes, Runtimes, Tools, Skills, Providers/Integrations, Devices, Computer Use, Simulations, Knowledge, Research, Evidence, Timeline, Replay, Why, Approvals, Deployments, Recovery, Security, Audit, Settings.

Every active workflow must visibly expose:

- state;
- progress;
- current phase;
- task/run/entity ID;
- actor;
- runtime/sandbox where relevant;
- start/update time;
- warnings/errors;
- approval requirement;
- result.

Required visual status vocabulary includes at minimum RUNNING/IN PROGRESS, EXPERIMENT, BUG/ERROR, BLOCKED, APPROVAL REQUIRED, VERIFYING and COMPLETED.

## 21. Testing contract

The repository MUST maintain:

1. unit;
2. integration;
3. regression;
4. security;
5. concurrency;
6. runtime;
7. API;
8. browser/UI;
9. E2E;
10. failure injection;
11. recovery;
12. production-like tests.

A test suite passing is not by itself proof of production readiness if required real-environment evidence is missing.

## 22. Acceptance semantics

Use these exact meanings:

- IMPLEMENTED = source exists and compiles.
- INTEGRATED = connected to the intended runtime path.
- TESTED = automated test evidence exists.
- VERIFIED = executable/reproducible evidence proves the requirement.
- PRODUCTION_READY = verified plus security, monitoring, recovery, rollback and operational prerequisites.
- DONE = requirement is satisfied, documented and accepted.

Never upgrade status merely because code exists.

## 23. Machine-readable requirement contract

Every requirement record MUST identify:

- requirementId;
- area;
- phase;
- requirement text;
- implementation references;
- tests;
- security tests;
- evidence;
- documentation;
- status;
- note for every partial/unverified/blocked state.

No `PASS` is valid without implementation + test + evidence.

## 24. Fresh-agent bootstrap procedure

A new agent MUST execute this sequence before making substantive changes:

### A. Repository identity
- inspect branch, HEAD and working tree;
- inspect package scripts;
- inspect CI;
- inspect README;
- inspect canonical specification;
- inspect acceptance matrix.

### B. Current evidence
- inspect `docs/STATUS.md`;
- inspect `docs/TODO.md`;
- run typecheck/lint/build;
- run unit/integration/security/regression suites;
- run available live verification;
- inspect CI evidence for the current commit.

### C. Gap inventory
Build a table:

| Requirement | Code | Integration | Tests | Evidence | Status | Next action |
|---|---|---|---|---|---|---|

Do not rely on prose claims.

### D. Repair loop
For every gap:

`Requirement → Root cause → Patch → Test → Security test → Evidence → Documentation → Matrix update`

### E. Final acceptance
Run the complete applicable suite and acceptance script. A release is blocked by unresolved mandatory FAIL/NOT_IMPLEMENTED or by a mandatory NOT_VERIFIED item whose evidence is required for the target environment.

## 25. Environment-aware verification

A fresh agent MUST distinguish:

- code unavailable;
- dependency unavailable;
- infrastructure unavailable;
- credentials unavailable;
- external service intentionally disabled by policy;
- feature not implemented;
- feature implemented but unverified.

An infrastructure limitation MUST NOT be converted into a fake PASS.

When an external dependency cannot be tested safely, the repository MUST record the exact blocker and the exact command/procedure needed to verify it later.

## 26. Autonomous completion policy

Agents are expected to continue until one of these conditions is true:

1. all requirements are DONE/VERIFIED/PRODUCTION_READY; or
2. a real external blocker prevents further verification; or
3. a Creator approval is required by the security model; or
4. a required hardware/provider resource is genuinely unavailable.

Before stopping, the agent MUST:

- implement all safe local work;
- repair all reproducible defects;
- run all available verification;
- update acceptance evidence;
- update status/TODO;
- leave a precise next-action list;
- never claim completion if mandatory evidence is missing.

## 27. Handoff artifact

At every substantial milestone the repository SHOULD contain:

- current commit/branch;
- verification commands;
- verification results;
- changed requirements;
- evidence references;
- open blockers;
- security decisions;
- migration/rollback notes;
- next deterministic action.

This permits another agent to continue without conversational context.

## 28. Release gate

A release candidate requires:

- clean typecheck;
- clean lint;
- successful build;
- unit/integration/regression success;
- security success;
- applicable runtime verification;
- API contract verification;
- UI/browser verification where required;
- E2E;
- failure injection/recovery;
- acceptance matrix;
- audit/provenance integrity;
- documented external blockers;
- rollback procedure.

Critical security failures block release.

## 29. Final “100% ready” definition

The application may be described as **READY TO USE** only when the target environment's mandatory requirements are:

- implemented;
- integrated;
- security-bounded;
- tested;
- reproducibly verified;
- documented;
- observable;
- recoverable where applicable;
- deployable/rollbackable where applicable.

“100% complete” means 100% of the frozen requirements for the declared target environment, not that every optional connector, hardware device or future integration exists.

## 30. Required repository deliverables

The repository MUST retain:

- `docs/APP_VOLLSTAENDIGE_SPEZIFIKATION_DE.md` — canonical product specification;
- `docs/AGENT_COMPLETION_HANDOFF_SPEC_DE.md` — this agent-independent completion contract;
- `docs/acceptance/requirements.json` — machine-readable acceptance matrix;
- `docs/STATUS.md` — evidence-backed implementation state;
- `docs/TODO.md` — open gaps only;
- component security/operation documentation;
- executable test and verification scripts.

## 31. Original project requirements incorporated

The source project brief also establishes these architectural intentions:

- make the platform an agent system rather than a collection of unrelated plugins;
- use Agent Orchestrator, Task Manager, Permission Broker, Execution Engine, Verification Engine, Audit/Event Store, Sandbox Manager, Experiment Engine, Buddy/Critic and Resource Manager as the core spine;
- build a Source Manager and Document Engine;
- connect GitHub through permissions;
- use a controlled development/build/test pipeline;
- introduce a Hardware Abstraction Layer rather than direct device commands;
- represent device capabilities explicitly and distinguish “capability exists” from “capability verified”;
- use a central Connector Manager for APIs and device transports;
- use a scoped Credentials Vault;
- provide logs, metrics, events, traces, errors, task history and telemetry;
- maintain a Knowledge Graph;
- provide scheduled/event-driven automation;
- keep optional creative integrations such as Canva outside the critical agent core;
- never grant an attached service automatic agent rights.

## 32. Non-negotiable safety boundary

The system's autonomy is deliberately asymmetric:

**Maximum autonomy:** research, planning, sandboxing, experimentation, coding, testing, diagnosis, simulation, evidence collection and preparation within delegated authority.

**Explicit control:** authority changes, sensitive credentials, external writes, critical device control, repository mutations of consequence, deployment, irreversible or system-critical operations.

This boundary is part of the product definition and MUST survive future refactors.

---
**End of agent-independent completion specification.**
