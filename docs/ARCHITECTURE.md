# BabajagaBoB — Control Plane Architecture

## Execution boundary

UI/Public → Control Plane API → Job Queue → Agent Worker → Sandbox Runtime → Artifacts/Events

The browser never executes shell commands or receives raw secrets.

## Current foundation

- Next.js App Router
- Typed domain state
- Node.js route handlers
- Explicit lifecycle statuses
- Event fabric
- Emergency lockdown
- Network DENY-by-default indicator
- Server-side execution queue with job state, lease, retry budget and cancellation boundary
- No analytics, tracking, advertising or third-party data sharing in the application foundation

## Authority model

Technical capability and delegated authority remain separate concerns. A future capability token must be scoped to project, agent, task, environment, resource and risk policy.

## Lifecycle

Mission → Objective → Task → Run → Sandbox → Experiment/Test → Artifact → Deployment

Every execution transition should emit an append-only event and preserve provenance. The current event fabric is an in-memory foundation; durable storage is a separate persistence boundary and must not be simulated as durable until a real store is connected.

## Knowledge and causality

Structured records should use observable fields: objective, observation, assumption, hypothesis, action, expected result, observed result, evidence, conclusion and next action. Hidden model reasoning is not stored or exposed.

## Safety boundary

Lockdown is fail-closed. Discovery of external devices/services must never imply authorization. Network access is deny-by-default and future allowlists must be explicit.

## Runtime, tools and authority boundaries

The runtime is exposed only through server-side Control Plane routes. The current adapter is a mock lifecycle implementation: it models create/clone/reset/snapshot/restore/destroy/execute semantics and enforces the declared network boundary, but it does not expose a host shell and is not a production container/VM runtime.

The Tool Registry is versioned and records input schema, required capabilities, allowed environments, risk, resource limits, network requirements, side effects, reversibility and approval requirements. A tool definition does not itself grant authority.

Capability and Authority are separate graphs:
- Capability Graph: technical operations available to an agent.
- Authority Graph: explicit delegation from Creator/authorized issuer to agent, task, sandbox and capability.
- Self-grant and self-delegation are rejected at the service boundary.
- Capability tokens are scoped to task/sandbox/capabilities and have expiry.

Artifacts are provenance records linking agent, task, run, sandbox and knowledge state to a content digest. The current artifact store is in-memory and therefore is not presented as durable storage.

## Persistence boundary

ControlStore defines the persistence contract for control state, audit records and artifacts. InMemoryControlStore is the current implementation. A durable database adapter must implement this interface before the application claims restart-safe persistence.
