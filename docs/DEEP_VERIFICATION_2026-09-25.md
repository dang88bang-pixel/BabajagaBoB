# Deep Verification — 2026-09-25

## Verified
- CI run #696 for commit `a58f5be8317842b006512d96cf0f578bc4c5d758` passed all five jobs: lint/typecheck, unit/integration/regression, security/E2E/dependency audit, production build, verification gate.
- Repository has a committed `package-lock.json`; `npm ci` is therefore reproducible in CI.
- Security, E2E, regression and build stages are active in the workflow.
- Knowledge persistence uses the repository persistence abstraction with integrity checking.
- Science persistence uses the repository persistence abstraction and causal validation is explicit.
- Direct `ESTABLISHED` knowledge creation now requires evidence and verification.
- Direct experiment promotion to `ESTABLISHED` is blocked; causal validation remains the promotion path.
- Causal validation now checks baseline/control/replication presence, replication agreement, accepted observations and observation messages.
- Production CI/CD promotion requires all verification checks to pass, SMOKE stage and a granted approval.
- Mutating API authentication was added to the previously identified routes; a security route-check is part of CI.

## Current verification
- Latest head: `20ede98e685049129d9060fe9176b29fe1c9414e`
- CI run #700 is currently **PENDING**; no result is claimed yet.
- PR #3 is open and mergeable.

## Remaining blockers / next engineering targets
1. Complete and verify the latest CI run.
2. Close the control-plane authentication bootstrap gap without exposing credentials to browser code.
3. Unify event/audit/provenance persistence and causal-parent direction into one append-only event fabric.
4. Replace state-only recovery verification with executable smoke/regression verification against restored sandboxes.
5. Implement OCI snapshot/restore and real storage quota enforcement.
6. Complete Runtime Registry, Computer Use, Device scheduling, Simulation/3D, Offline Fabric and provider adapter execution.
7. Make Universal Status Fabric authoritative across every action/API/runtime and expose consistent progress/blocked/error/approval/experiment states in the Control Center.
8. Add browser/UI verification for the Control Center, Observatory, Timeline/Replay, Why view and approval flows.
9. Add concurrency/atomicity tests for persistent stores and multi-worker job leasing.
10. Keep production readiness **NOT VERIFIED** until these integration/runtime boundaries have executable evidence.

## Rule
Green CI is necessary but not sufficient. A component is only considered VERIFIED when implementation, integration, security boundary, persistence and executable evidence all agree.
