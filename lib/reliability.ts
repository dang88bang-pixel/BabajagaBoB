import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {activeSandboxRuntime} from "./runtime-factory";
import {listSnapshots, restoreSandbox, snapshotSandbox} from "./sandbox/fabric";
import {verifySandboxState, type VerificationResult} from "./verification";
import {registerRegressionTest} from "./regression";

/**
 * Reliability / Recovery (Abschnitt 17).
 *
 *   FAILURE → CONTAIN → CHECKPOINT → DIAGNOSTIC → RECOVERY PLAN → RESTORE
 *           → VERIFY → REGRESSION → ACCEPT
 *
 * Begriffe bleiben getrennt (Abschnitt 37.7):
 *   Snapshot  = wiederherstellbarer Zustand (sandboxId, digest)
 *   Artifact  = erzeugtes Ergebnis (artifactId, digest) – siehe lib/artifacts.ts
 *
 * Recovery Tier:
 *   1 Retry · 2 Isolated Recovery · 3 Prepared Recovery
 *   4 Autonomous Investigation · 5 Creator Escalation
 *
 * `verifyRecovery` führt echte Smoke- und Regressionstests aus. Ohne bestandene
 * Verifikation ist der Status REJECTED, nicht VERIFIED.
 */

export type FailureRecord = {
  failureId: string;
  incidentId?: string;
  runId?: string;
  taskId?: string;
  symptom: string;
  incident: string;
  failureMode: string;
  rootCause?: string;
  contributingFactors: string[];
  prevention: string[];
  regressionId?: string;
  status: "OPEN" | "ANALYZING" | "CONTAINED" | "RESOLVED" | "VERIFIED";
  createdAt: string;
  updatedAt: string;
};

export type RecoveryTier = 1 | 2 | 3 | 4 | 5;

export type RecoveryPlan = {
  recoveryId: string;
  failureId: string;
  tier: RecoveryTier;
  steps: string[];
  /** Snapshot-Referenz (nicht Artifact!). */
  checkpointSnapshotId?: string;
  diagnosticSandboxId?: string;
  verificationPlan: string[];
  status: "PREPARED" | "EXECUTING" | "VERIFIED" | "REJECTED" | "FAILED" | "ESCALATED";
  verificationId?: string;
  verification?: Pick<VerificationResult, "verificationId" | "acceptance" | "reasons">;
  createdAt: string;
  updatedAt: string;
};

type Payload = {failures: FailureRecord[]; plans: RecoveryPlan[]};
const store = createStore<Payload>("reliability", 2, () => ({failures: [], plans: []}));

const persist = (payload: Payload) => store.write(payload);

export function recordFailure(input: Omit<FailureRecord, "failureId" | "createdAt" | "updatedAt" | "status">): FailureRecord {
  const timestamp = new Date().toISOString();
  const failure: FailureRecord = {
    ...input,
    failureId: `FAIL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    status: "OPEN",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const payload = store.read();
  payload.failures.push(failure);
  persist(payload);
  observe({
    type: "failure.recorded",
    message: `Failure ${failure.failureId} erfasst`,
    status: "ERROR",
    actor: "AG-RECOVERY",
    agentId: "AG-RECOVERY",
    taskId: failure.taskId,
    runId: failure.runId,
    action: "reliability.failure.record",
    resource: failure.failureId,
    decision: "ERROR",
    argumentsValue: {symptom: failure.symptom, failureMode: failure.failureMode}
  });
  return structuredClone(failure);
}

export function listFailures(): FailureRecord[] {
  return structuredClone(store.read().failures);
}

export function updateFailure(failureId: string, patch: Partial<FailureRecord>): FailureRecord {
  const payload = store.read();
  const failure = payload.failures.find(f => f.failureId === failureId);
  if (!failure) throw new Error("failure not found");
  Object.assign(failure, patch, {updatedAt: new Date().toISOString()});
  persist(payload);
  return structuredClone(failure);
}

export function prepareRecovery(input: {
  failureId: string;
  steps: string[];
  verificationPlan?: string[];
  diagnosticSandboxId?: string;
  tier?: RecoveryTier;
  checkpointSnapshotId?: string;
}): RecoveryPlan {
  const timestamp = new Date().toISOString();
  const plan: RecoveryPlan = {
    recoveryId: `REC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    failureId: input.failureId,
    tier: input.tier ?? 2,
    steps: input.steps,
    checkpointSnapshotId: input.checkpointSnapshotId,
    diagnosticSandboxId: input.diagnosticSandboxId,
    verificationPlan: input.verificationPlan ?? ["smoke test", "regression suite"],
    status: "PREPARED",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const payload = store.read();
  payload.plans.push(plan);
  persist(payload);
  observe({
    type: "recovery.prepared",
    message: `Recovery-Plan ${plan.recoveryId} (Tier ${plan.tier}) vorbereitet`,
    status: "RECOVERING",
    actor: "AG-RECOVERY",
    agentId: "AG-RECOVERY",
    action: "recovery.prepare",
    resource: plan.recoveryId,
    argumentsValue: {steps: plan.steps, tier: plan.tier}
  });
  return structuredClone(plan);
}

export function getRecoveryPlan(recoveryId: string): RecoveryPlan | null {
  return structuredClone(store.read().plans.find(p => p.recoveryId === recoveryId) ?? null);
}

export function listRecoveryPlans(): RecoveryPlan[] {
  return structuredClone(store.read().plans);
}

/**
 * Checkpoint: echter Snapshot des Sandbox-Zustands (nicht zu verwechseln mit
 * einem Artifact). Wird nur erstellt, wenn eine Sandbox referenziert ist.
 */
export async function createCheckpoint(input: {failureId: string; sandboxId: string; actor?: string}) {
  const failure = store.read().failures.find(f => f.failureId === input.failureId);
  if (!failure) throw new Error("failure not found");
  const snapshot = await snapshotSandbox(input.sandboxId, input.actor ?? "AG-RECOVERY");
  return {failureId: input.failureId, snapshotId: snapshot.snapshotId, digest: snapshot.digest};
}

/** Recovery ausführen: Containment + Restore (echte Runtime-Operation). */
export async function beginRecovery(recoveryId: string, actor = "AG-RECOVERY"): Promise<RecoveryPlan> {
  const payload = store.read();
  const plan = payload.plans.find(p => p.recoveryId === recoveryId);
  if (!plan) throw new Error("recovery plan not found");
  if (plan.status !== "PREPARED") throw new Error(`recovery is not prepared (status ${plan.status})`);
  const failure = payload.failures.find(f => f.failureId === plan.failureId);
  if (failure) failure.status = "CONTAINED";

  if (plan.diagnosticSandboxId && plan.checkpointSnapshotId) {
    await restoreSandbox(plan.diagnosticSandboxId, plan.checkpointSnapshotId, actor);
  }
  plan.status = "EXECUTING";
  plan.updatedAt = new Date().toISOString();
  persist({failures: payload.failures, plans: payload.plans});
  observe({
    type: "recovery.executing",
    message: `Recovery ${recoveryId} ausgeführt`,
    status: "RECOVERING",
    actor,
    agentId: actor,
    sandboxId: plan.diagnosticSandboxId,
    action: "recovery.execute",
    resource: recoveryId,
    argumentsValue: {restored: Boolean(plan.diagnosticSandboxId && plan.checkpointSnapshotId), tier: plan.tier}
  });
  return structuredClone(plan);
}

/**
 * Verifikation: führt echte Smoke- und Regressionstests aus. Nur bei ACCEPT wird
 * der Plan VERIFIED; sonst REJECTED (kein Erfolg ohne Nachweis).
 */
export async function verifyRecovery(recoveryId: string, actor = "AG-QA"): Promise<RecoveryPlan> {
  const payload = store.read();
  const plan = payload.plans.find(p => p.recoveryId === recoveryId);
  if (!plan) throw new Error("recovery plan not found");
  if (plan.status !== "EXECUTING") throw new Error("recovery must be executed before verification");
  const sandboxId = plan.diagnosticSandboxId;
  if (!sandboxId) throw new Error("recovery has no diagnostic sandbox; verification cannot run");

  const verification = await verifySandboxState({
    sandboxId,
    snapshotId: plan.checkpointSnapshotId,
    regressionIds: payload.failures.find(f => f.failureId === plan.failureId)?.regressionId ? [payload.failures.find(f => f.failureId === plan.failureId)!.regressionId!] : undefined
  });

  plan.verificationId = verification.verificationId;
  plan.verification = {verificationId: verification.verificationId, acceptance: verification.acceptance, reasons: verification.reasons};
  plan.status = verification.acceptance === "ACCEPT" ? "VERIFIED" : "REJECTED";
  plan.updatedAt = new Date().toISOString();
  const failure = payload.failures.find(f => f.failureId === plan.failureId);
  if (failure) failure.status = verification.acceptance === "ACCEPT" ? "VERIFIED" : "ANALYZING";
  persist({failures: payload.failures, plans: payload.plans});

  observe({
    type: verification.acceptance === "ACCEPT" ? "recovery.verified" : "recovery.rejected",
    message: `Recovery ${recoveryId}: ${plan.status}`,
    status: verification.acceptance === "ACCEPT" ? "COMPLETED" : "ERROR",
    actor,
    agentId: actor,
    sandboxId,
    action: "recovery.verify",
    resource: recoveryId,
    decision: verification.acceptance === "ACCEPT" ? "ALLOW" : "DENY",
    argumentsValue: {verificationId: verification.verificationId, reasons: verification.reasons}
  });
  return structuredClone(plan);
}

export function resolveFailure(failureId: string, rootCause: string, regressionId?: string): FailureRecord {
  const payload = store.read();
  const failure = payload.failures.find(f => f.failureId === failureId);
  if (!failure) throw new Error("failure not found");
  failure.rootCause = rootCause;
  failure.regressionId = regressionId;
  failure.status = "RESOLVED";
  failure.updatedAt = new Date().toISOString();
  persist(payload);
  observe({
    type: "failure.resolved",
    message: `Failure ${failureId} gelöst`,
    status: "COMPLETED",
    actor: "AG-RECOVERY",
    agentId: "AG-RECOVERY",
    taskId: failure.taskId,
    runId: failure.runId,
    action: "reliability.failure.resolve",
    resource: failureId,
    argumentsValue: {rootCause, regressionId}
  });
  return structuredClone(failure);
}

/** "Never Again": erzeugt einen dauerhaften Regressionstest aus einem Failure. */
export function lockRegressionFromFailure(failureId: string, argv: string[], createdBy = "AG-QA") {
  const failure = store.read().failures.find(f => f.failureId === failureId);
  if (!failure) throw new Error("failure not found");
  const test = registerRegressionTest({
    incidentId: failure.incidentId,
    rootCause: failure.rootCause,
    name: `Regression for ${failure.failureId}`,
    description: failure.symptom,
    argv,
    createdBy
  });
  const payload = store.read();
  const record = payload.failures.find(f => f.failureId === failureId);
  if (record) {
    record.regressionId = test.regressionId;
    record.prevention = [...new Set([...record.prevention, `Regressionstest ${test.regressionId}`])];
    record.updatedAt = new Date().toISOString();
    persist(payload);
  }
  return test;
}

/** Verfügbare Checkpoints für einen Failure (Snapshot ≠ Artifact). */
export function failureCheckpoints(failureId: string) {
  const failure = store.read().failures.find(f => f.failureId === failureId);
  if (!failure) throw new Error("failure not found");
  const sandboxId = store.read().plans.find(p => p.failureId === failureId)?.diagnosticSandboxId;
  return sandboxId ? listSnapshots(sandboxId) : [];
}

export function reliabilitySnapshot() {
  const payload = store.read();
  return {
    failures: structuredClone(payload.failures),
    plans: structuredClone(payload.plans),
    runtimeMode: activeSandboxRuntime.mode
  };
}

export function recoverySummary() {
  const plans = store.read().plans;
  return {
    total: plans.length,
    prepared: plans.filter(p => p.status === "PREPARED").length,
    verified: plans.filter(p => p.status === "VERIFIED").length,
    rejected: plans.filter(p => p.status === "REJECTED").length,
    byTier: plans.reduce<Record<string, number>>((acc, p) => ({...acc, [String(p.tier)]: (acc[String(p.tier)] ?? 0) + 1}), {})
  };
}

export function reliabilityStoreReport() {
  return store.integrity();
}
