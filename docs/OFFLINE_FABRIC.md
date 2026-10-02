# Offline Fabric — Evidence Sync and Local Asset Catalog (P2, accepted scope)

This increment implements an air-gap-friendly transfer of **already persisted execution evidence** and a catalog for assets that an operator has already staged locally. It does not open network access: operators move the signed JSON bundle or asset media by an approved offline channel. The app does not download packages, models, images, or data.

## Evidence bundle

Creator-only `POST /api/offline` actions:

```json
{"action":"export","artifactIds":["ART-…"]}
```

returns the selected artifacts plus the connected provenance subgraph. The bundle retains original artifact IDs, provenance IDs and timestamps. The receiving Creator imports it with:

```json
{"action":"import","bundle":{…}}
```

The receiver checks the envelope schema and size, payload SHA-256, per-peer HMAC signature, artifact content digests, provenance endpoints and identity conflicts before merging. Duplicate records are idempotent; an ID collision with different data is rejected. Provenance timestamps and edge IDs are preserved. Import history is persisted. If a process or storage failure occurs during a multi-store merge, retrying the same bundle is safe; no claim of cross-store transaction atomicity is made.

Only evidence and provenance are transferred. Capability secrets, approvals, task state and authorization edges are not minted or changed by sync. Offline work must still use the normal Authority → Execution Gate → Broker → local Runtime path. A bundle is not an execution token.

## Operator configuration

Both nodes need stable, unique `BOB_OFFLINE_NODE_ID` values. A sending node signs with its own `BOB_OFFLINE_SYNC_KEY` (minimum 32 UTF-8 bytes); the receiver maps the peer ID to that peer's key in `BOB_OFFLINE_PEER_KEYS` JSON. Exchange keys out of band, protect them as secrets, and do not reuse one key for multiple peers. Missing or invalid configuration fails closed. Keys are never included in bundles or API responses. HMAC provides authenticity/integrity, **not confidentiality**: bundles contain artifact text, so operators must encrypt the offline transport/media when the content is sensitive.

Example shape only — replace all values with independently generated secrets:

```text
BOB_OFFLINE_NODE_ID=field-node-01
BOB_OFFLINE_SYNC_KEY=<at-least-32-random-bytes>
BOB_OFFLINE_PEER_KEYS={"hub-node-01":"<peer-key-of-at-least-32-bytes>"}
```

The endpoint is Creator/session protected and rate-limited. Bundles are capped at 2 MB and 128 artifacts; artifact bodies retain the platform's existing 8 KiB-per-record content limit. Imported evidence is stored with its original digest and identity.

## Pre-staged local asset catalog

Creators can register and verify files already present beneath the offline asset root through `POST /api/offline`:

```json
{"action":"asset.register","kind":"MODEL","name":"local-model-v1","relativePath":"models/model.gguf"}
{"action":"asset.verify","assetId":"AS-…"}
```

`BOB_OFFLINE_ASSET_DIR` optionally selects an **absolute** root; otherwise the root is `<storageRoot>/offline-assets`. The catalog supports `PACKAGE`, `MODEL`, `DOCUMENTATION`, `GIT`, `CONTAINER`, `SDK`, `COMPILER` and `DATASET`. IDs are derived from kind, name and SHA-256 digest, so identical assets can be recognized across nodes when separately staged. Each file is hashed from an open file descriptor (maximum 20 GiB); path traversal, symlinks, non-files and digest/size changes fail closed. The catalog holds at most 5,000 entries.

Registration records metadata and a relative path; it does **not** copy or transport the file. Operators must stage files using trusted offline media. The endpoint is Creator/session protected. `GET /api/offline` exposes the catalog only to an authenticated Creator. Asset names, relative paths and hashes are operational metadata, not secrets.

## Signed offline Task Packages

Creator-only `POST /api/offline` supports:

```json
{"action":"package.create","taskId":"TASK-…","planId":"PLAN-…","assetIds":["AS-…"],"knowledgeIds":["KN-…"]}
{"action":"package.validate","taskPackage":{…},"requireLocalBindings":true}
```

A receiving Creator uses explicit import and activation actions:

```json
{"action":"package.import","taskPackage":{…}}
{"action":"package.activate","taskPackage":{…},"localTaskId":"TASK-…","localPlanId":"PLAN-…","localSandboxId":"SB-…","localApprovalId":"APR-…"}
```

`package.import` verifies the peer signature, expiry, digest and already-staged local assets, then persists an `IMPORTED` record only. It does not create a task, issue authority, grant approval or execute. The receiving Creator prepares a local task, active plan and running DENY-network sandbox through the normal Control Plane APIs, then explicitly binds those IDs with `package.activate`. Activation checks the local title, risk, assigned agent and approval requirement against the signed task; the local plan must match the signed expected effects/abort criteria and the sandbox must be bound to that task/agent with `network: DENY`. If the package requires approval, `localApprovalId` must reference a locally **GRANTED** approval. The source approval is not imported or trusted. Imported task/package IDs remain in the signed payload and provenance; new locally-created task IDs are node-scoped when `BOB_OFFLINE_NODE_ID` is configured.

Creation requires a live, non-terminal task, its assigned agent's static execution capabilities and risk ceiling, an ACTIVE plan step, a task/agent-bound sandbox with `network: DENY`, and a GRANTED approval whenever the task requires one. The package pins the task/plan/sandbox snapshot, selected local assets by digest, selected Knowledge nodes, a 24-hour expiry and explicit broker/capability/network policy. It contains no capability token or secret, command/argv, or permission to bypass the broker. The whole canonical payload is SHA-256 digested and signed with the node's HMAC key; a receiving node verifies the peer signature and re-hashes every locally staged referenced asset. Optional `requireLocalBindings` additionally rejects a stale/different local task, plan or sandbox binding.

A Task Package is a signed work specification, **not an execution credential**. `package.validate` only verifies; `package.import` records a verified package; `package.activate` binds it to local, Creator-prepared resources. Neither import nor activation issues capabilities or executes commands. `package.execute` requires a separate Bobcap header, rechecks the active local task/plan/sandbox/approval bindings, and dispatches argv through `executeAuthorized` (Authority → Policy → Approval → Execution Gate → Broker → Runtime). The broker consumes the one-use capability; no credential is taken from the package. Before dispatch, pinned files are copied and re-hashed into `.bob-offline-assets/<assetId>/content` inside a local sandbox workspace. Execution is refused with 503 unless OCI or kernel `NAMESPACES` isolation is actually reported; local-workspace asset staging is supported only with `NAMESPACES`. `npm run test:offline:isolated` builds a disposable rootfs, requires a working user namespace, and exercises a separate receiver storage root: import, activation against local bindings, broker-authorized asset read in `/work`, evidence export, and provenance-preserving sync back to the origin. The script removes its temporary rootfs when it exits. OCI asset mounting/staging is not implemented, so OCI execution with asset pins is refused.

## Remaining scope — not PASS

`OFF-001` is **PASS for the specified offline scope**. The repeatable receiver-to-origin proof passed: `npm run test:offline:isolated` built a disposable rootfs, confirmed `NAMESPACES` isolation, imported and activated the signed package against receiver-local task/plan/sandbox bindings, executed through the local Broker using an operator-staged, digest-pinned asset, then synchronized signed Evidence and Provenance back to the origin. The test asserts the returned Evidence, receiver Task and Sandbox IDs, package identity/timestamp, and their Provenance edges in the origin graph. The receiver uses a separate storage root but is simulated within one test process; this is not a physical multi-host transport test. Assets remain operator-staged through trusted offline media: the catalog verifies content-derived IDs, size and SHA-256 rather than downloading or transporting assets. Application-level asset transport and OCI asset mounting are separate scope; OCI asset mounting is unsupported, while the NAMESPACES local-workspace path is supported. The deterministic `lib/knowledge-vector.ts` index is local and requires no model service; it is not an automatic model/package mirror. Verification also passed with `npm run test:offline` (10/10) and `npm run verify` (lint, typecheck, production build and complete test suite; the unrelated OCI-runtime test is skipped without a Docker daemon).

Tests: `npm run test:offline` covers signed cross-store transfer, preserved provenance identity/timestamps, duplicate imports, tamper rejection, missing-key denial, unauthenticated route denial, Creator API asset registration/verification, path boundary checks, local asset tamper detection, bounded workspace staging, signed task package creation/validation/import/activation, stale bindings, package tampering, invalid peer keys, Creator-only actions, Broker capability binding and the fail-closed non-isolated runtime path. `npm run test:offline:isolated` requires an actual NAMESPACES-capable host and proves successful separate-node asset execution plus signed Evidence/Provenance synchronization back to the origin.
