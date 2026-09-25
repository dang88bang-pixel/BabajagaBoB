import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import type {Risk, RunState} from "./types";

/**
 * Run-Lifecycle (Abschnitt 7).
 *
 *   CREATED → QUEUED → LEASED → RUNNING → SUCCEEDED
 *   RUNNING → FAILED → (RETRY) → QUEUED
 *   RUNNING → FAILED → DIAGNOSING → ROOT_CAUSE_FOUND → RECOVERING → VERIFYING → SUCCEEDED
 *   RUNNING → FAILED → … → DEAD_LETTER (Retry-Budget erschöpft)
 *
 * Runs verwenden eine eigene `runId`; es werden keine zusammengesetzten IDs
 * gebildet. Wiederholungen sind an `idempotencyKey` gebunden, sodass eine
 * fehlgeschlagene Aktion nicht unkontrolliert erneut ausgeführt wird.
 */

export type Run = {
  runId: string;
  jobId: string | null;
  taskId: string;
  agentId: string;
  sandboxId: string | null;
  state: RunState;
  attempt: number;
  maxAttempts: number;
  risk: Risk;
  idempotencyKey: string;
  workerId?: string;
  leaseUntil?: string;
  lastHeartbeatAt?: string;
  timeoutMs: number;
  backoffMs: number;
  nextAttemptAt?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  diagnostics?: string[];
  rootCause?: string;
  rollbackArtifactId?: string;
  deadLetterReason?: string;
};

type Payload = {runs: Run[]};
const store = createStore<Payload>("runs", 2, () => ({runs: []}));
const clone = <T>(value: T): T => structuredClone(value);

export const RUN_TRANSITIONS: Record<RunState, RunState[]> = {
  CREATED: ["QUEUED", "CANCELLED"],
  QUEUED: ["LEASED", "CANCELLED", "DEAD_LETTER"],
  LEASED: ["RUNNING", "QUEUED", "FAILED", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED", "RECOVERING", "DIAGNOSING"],
  DIAGNOSING: ["ROOT_CAUSE_FOUND", "FAILED", "DEAD_LETTER"],
  ROOT_CAUSE_FOUND: ["RECOVERING", "FAILED", "DEAD_LETTER"],
  RECOVERING: ["VERIFYING", "RUNNING", "FAILED", "ROLLED_BACK", "DEAD_LETTER"],
  VERIFYING: ["SUCCEEDED", "FAILED", "ROLLED_BACK", "DEAD_LETTER"],
  FAILED: ["QUEUED", "DIAGNOSING", "RECOVERING", "ROLLED_BACK", "DEAD_LETTER", "CANCELLED"],
  PAUSED: ["QUEUED", "RUNNING", "CANCELLED"],
  SUCCEEDED: [],
  CANCELLED: [],
  ROLLED_BACK: ["QUEUED", "DEAD_LETTER"],
  DEAD_LETTER: []
};

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

function transition<T extends Run>(run: Run, next: RunState, reason: string, mutate: (r: Run) => void = () => undefined): T {
  if (!canTransitionRun(run.state, next)) throw new Error(`invalid run transition ${run.state} -> ${next}`);
  run.state = next;
  mutate(run);
  store.update(payload => {
    const index = payload.runs.findIndex(r => r.runId === run.runId);
    if (index >= 0) payload.runs[index] = run;
    else payload.runs.push(run);
  });
  observe({
    type: `run.${next.toLowerCase()}`,
    message: `Run ${run.runId}: ${next} (${reason})`,
    status: next === "SUCCEEDED" ? "COMPLETED" : next === "FAILED" || next === "DEAD_LETTER" ? "ERROR" : next === "VERIFYING" ? "TESTING" : "RUNNING",
    actor: run.agentId,
    agentId: run.agentId,
    taskId: run.taskId,
    runId: run.runId,
    jobId: run.jobId ?? undefined,
    sandboxId: run.sandboxId ?? undefined,
    action: "run.transition",
    resource: run.runId,
    decision: next === "FAILED" || next === "DEAD_LETTER" ? "ERROR" : "ALLOW",
    argumentsValue: {from: run.state, to: next, reason}
  });
  void transition;
  return clone(run as T);
}

export function createRun(input: {
  taskId: string;
  agentId: string;
  risk: Risk;
  sandboxId?: string;
  idempotencyKey?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
}): Run {
  const idempotencyKey = input.idempotencyKey ?? `task:${input.taskId}`;
  const existing = store.read().runs.find(r => r.idempotencyKey === idempotencyKey && !["FAILED", "SUCCEEDED", "CANCELLED", "DEAD_LETTER", "ROLLED_BACK"].includes(r.state));
  if (existing) return clone(existing);
  const run: Run = {
    runId: `RUN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    jobId: null,
    taskId: input.taskId,
    agentId: input.agentId,
    sandboxId: input.sandboxId ?? null,
    state: "CREATED",
    attempt: 0,
    maxAttempts: input.maxAttempts ?? 3,
    risk: input.risk,
    idempotencyKey,
    timeoutMs: input.timeoutMs ?? 300_000,
    backoffMs: input.backoffMs ?? 5_000,
    createdAt: new Date().toISOString()
  };
  store.update(payload => {
    payload.runs.push(run);
    if (payload.runs.length > 2000) payload.runs.splice(0, payload.runs.length - 2000);
  });
  observe({
    type: "run.created",
    message: `Run ${run.runId} erstellt`,
    status: "QUEUED",
    actor: run.agentId,
    agentId: run.agentId,
    taskId: run.taskId,
    runId: run.runId,
    action: "run.create",
    resource: run.runId,
    argumentsValue: {idempotencyKey, risk: run.risk, sandboxId: run.sandboxId}
  });
  return clone(run);
}

export function listRuns(): Run[] {
  return clone(store.read().runs);
}

export function getRun(runId: string): Run | null {
  return clone(store.read().runs.find(r => r.runId === runId) ?? null);
}

export function findRunByJob(jobId: string): Run | null {
  return clone(store.read().runs.find(r => r.jobId === jobId) ?? null);
}

function mutate(runId: string, mutateFn: (run: Run) => void): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  mutateFn(run);
  store.update(payload => {
    const index = payload.runs.findIndex(r => r.runId === runId);
    if (index >= 0) payload.runs[index] = run;
  });
  return clone(run);
}

export function attachExecution(runId: string, jobId: string, sandboxId: string): Run {
  const run = mutate(runId, r => {
    r.jobId = jobId;
    r.sandboxId = sandboxId;
  });
  if (!run) throw new Error("run not found");
  observe({
    type: "run.execution.attached",
    message: `Run ${runId} mit Job und Sandbox verknüpft`,
    status: "RUNNING",
    actor: run.agentId,
    agentId: run.agentId,
    taskId: run.taskId,
    runId,
    jobId,
    sandboxId,
    action: "run.attach",
    resource: runId,
    argumentsValue: {jobId, sandboxId}
  });
  return run;
}

export function queueRun(runId: string, workerId?: string): Run {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) throw new Error("run not found");
  return transition(run, "QUEUED", "run queued", r => {
    r.workerId = workerId;
  });
}

export function leaseRun(runId: string, workerId: string, leaseMs = 60_000): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (run.state !== "QUEUED") return null;
  return transition(run, "LEASED", `leased by ${workerId}`, r => {
    r.workerId = workerId;
    r.leaseUntil = new Date(Date.now() + leaseMs).toISOString();
    r.lastHeartbeatAt = new Date().toISOString();
  });
}

export function startRun(runId: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (run.state === "CREATED" || run.state === "QUEUED" || run.state === "LEASED") {
    return transition(run, "RUNNING", "worker started execution", r => {
      r.attempt += 1;
      r.startedAt = new Date().toISOString();
      r.lastHeartbeatAt = new Date().toISOString();
      r.leaseUntil = new Date(Date.now() + r.timeoutMs).toISOString();
    });
  }
  if (run.state === "RECOVERING" || run.state === "FAILED") {
    return transition(run, "RUNNING", "retry attempt", r => {
      r.attempt += 1;
      r.lastHeartbeatAt = new Date().toISOString();
    });
  }
  return null;
}

export function heartbeatRun(runId: string, leaseMs = 60_000): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run || !["RUNNING", "LEASED", "RECOVERING", "VERIFYING"].includes(run.state)) return null;
  return mutate(runId, r => {
    r.lastHeartbeatAt = new Date().toISOString();
    r.leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  });
}

export function completeRun(runId: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (run.state === "RUNNING") return transition(run, "SUCCEEDED", "execution finished", r => {r.finishedAt = new Date().toISOString()});
  if (run.state === "VERIFYING") return transition(run, "SUCCEEDED", "verification passed after recovery", r => {r.finishedAt = new Date().toISOString()});
  return null;
}

export function failRun(runId: string, error: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (!canTransitionRun(run.state, "FAILED")) return null;
  return transition(run, "FAILED", error, r => {
    r.error = error.slice(0, 2000);
    r.finishedAt = new Date().toISOString();
  });
}

export function beginDiagnosis(runId: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (!canTransitionRun(run.state, "DIAGNOSING")) return null;
  return transition(run, "DIAGNOSING", "failure analysis started", r => {
    r.diagnostics = [...(r.diagnostics ?? []), `diagnosis started at ${new Date().toISOString()}`];
  });
}

export function recordRootCause(runId: string, rootCause: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (!canTransitionRun(run.state, "ROOT_CAUSE_FOUND")) return null;
  return transition(run, "ROOT_CAUSE_FOUND", rootCause, r => {
    r.rootCause = rootCause.slice(0, 2000);
  });
}

export function beginRecovery(runId: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  const allowed: RunState[] = ["FAILED", "DIAGNOSING", "ROOT_CAUSE_FOUND", "RUNNING"];
  if (!allowed.includes(run.state) || !canTransitionRun(run.state, "RECOVERING")) return null;
  return transition(run, "RECOVERING", "recovery started", () => undefined);
}

export function beginVerification(runId: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (!canTransitionRun(run.state, "VERIFYING")) return null;
  return transition(run, "VERIFYING", "recovery verification started", () => undefined);
}

export function cancelRun(runId: string, actor = "system"): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (!canTransitionRun(run.state, "CANCELLED")) return null;
  return transition(run, "CANCELLED", `cancelled by ${actor}`, r => {
    r.finishedAt = new Date().toISOString();
  });
}

export function rollbackRun(runId: string, artifactId?: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (!canTransitionRun(run.state, "ROLLED_BACK")) return null;
  return transition(run, "ROLLED_BACK", "rollback executed", r => {
    r.rollbackArtifactId = artifactId;
    r.finishedAt = new Date().toISOString();
  });
}

export function deadLetterRun(runId: string, reason: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (!canTransitionRun(run.state, "DEAD_LETTER")) return null;
  return transition(run, "DEAD_LETTER", reason, r => {
    r.deadLetterReason = reason;
    r.finishedAt = new Date().toISOString();
  });
}

/** Retry mit Backoff: setzt den Run zurück in die Queue und plant den nächsten Versuch. */
export function scheduleRetry(runId: string): Run | null {
  const run = store.read().runs.find(r => r.runId === runId);
  if (!run) return null;
  if (run.attempt >= run.maxAttempts) return deadLetterRun(runId, `retry budget exhausted after ${run.attempt} attempts`);
  const backoff = run.backoffMs * Math.max(1, run.attempt);
  return transition(run, "QUEUED", `retry ${run.attempt}/${run.maxAttempts}`, r => {
    r.nextAttemptAt = new Date(Date.now() + backoff).toISOString();
  });
}

/** Erkennt Runs mit abgelaufener Lease (verwaiste Worker). */
export function expireStaleRuns(at = Date.now()): string[] {
  const stale: string[] = [];
  for (const run of store.read().runs) {
    if (!["LEASED", "RUNNING", "RECOVERING", "VERIFYING"].includes(run.state)) continue;
    if (!run.leaseUntil) continue;
    if (new Date(run.leaseUntil).getTime() > at) continue;
    stale.push(run.runId);
  }
  for (const runId of stale) {
    const run = store.read().runs.find(r => r.runId === runId);
    if (!run) continue;
    if (run.attempt >= run.maxAttempts) deadLetterRun(runId, "lease expired and retry budget exhausted");
    else {
      transition(run, "FAILED", "lease expired (stale worker)", r => {
        r.error = "lease expired";
      });
      const failed = store.read().runs.find(r => r.runId === runId);
      if (failed) transition(failed, "QUEUED", "requeue after stale lease", r => {
        r.nextAttemptAt = new Date(Date.now() + r.backoffMs).toISOString();
        r.workerId = undefined;
        r.leaseUntil = undefined;
      });
    }
  }
  return stale;
}

export function runSummary() {
  const runs = store.read().runs;
  return {
    total: runs.length,
    running: runs.filter(r => ["RUNNING", "LEASED"].includes(r.state)).length,
    failed: runs.filter(r => r.state === "FAILED").length,
    recovering: runs.filter(r => ["RECOVERING", "DIAGNOSING", "VERIFYING"].includes(r.state)).length,
    deadLetter: runs.filter(r => r.state === "DEAD_LETTER").length
  };
}

export function runStoreReport() {
  return store.integrity();
}
