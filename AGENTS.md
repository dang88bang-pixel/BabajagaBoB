# BabajagaBoB — Agent Start Contract

This repository is intended to be completable by a fresh coding agent without hidden chat context.

## Read first

1. `docs/APP_VOLLSTAENDIGE_SPEZIFIKATION_DE.md`
2. `docs/AGENT_COMPLETION_HANDOFF_SPEC_DE.md`
3. `docs/acceptance/requirements.json`
4. `docs/acceptance/agent-completion-contract.json`
5. `docs/STATUS.md`
6. `docs/TODO.md`

## Before changing code

Inspect:

- current branch/HEAD and working tree;
- `package.json` scripts and dependencies;
- `.github/workflows/ci.yml`;
- relevant module documentation;
- acceptance requirements affected by the task;
- existing tests and verification scripts.

Never infer completion from prose. Verify the current repository state.

## Required engineering loop

For every change:

`Requirement → architecture/security review → implementation → unit test → integration test → security/regression test → runtime/UI/E2E test where applicable → evidence → documentation → acceptance status`

Repair root causes. Do not weaken tests to obtain green CI.

## Security invariants

Never:

- self-grant authority;
- escalate permissions;
- bypass approval;
- bypass Execution Gate/Broker;
- expose secrets;
- silently enable external processing/storage/training;
- access unauthorized devices/providers;
- manipulate audit/provenance;
- claim VERIFIED without reproducible evidence.

Network is deny-by-default.

## Completion rule

Do not report READY TO USE until all mandatory requirements for the declared target environment are implemented, integrated, security-bounded, tested and reproducibly verified.

A real external blocker may remain only when:

- it is explicitly documented;
- the missing evidence is identified;
- the exact verification procedure is documented;
- no safe local implementation work remains.

## Standard verification

At minimum, run the repository's own:

`typecheck → lint → build → unit → integration → regression → security → UI/E2E/runtime checks → acceptance`

Use the exact scripts in `package.json` and CI. Do not invent replacement evidence.

## Handoff

Before stopping, update:

- `docs/STATUS.md`
- `docs/TODO.md`
- `docs/acceptance/requirements.json`
- relevant component documentation

and leave the exact remaining blocker/next command if anything mandatory cannot yet be verified.

## Target

BabajagaBoB is a controlled autonomous agent platform, not merely a chat interface. Maximum autonomy is allowed inside delegated authority for research, planning, sandboxing, experimentation, coding, testing, diagnosis and preparation. System-critical effects remain explicitly permissioned and, where required, Creator-approved.
