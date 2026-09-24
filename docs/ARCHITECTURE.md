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
