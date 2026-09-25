import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import type {JobState, Risk} from "./types";

/**
 * Job-Queue (Abschnitt 7).
 *
 *   QUEUED → LEASED → RUNNING → SUCCEEDED
 *   RUNNING → FAILED → RETRY (Backoff) → QUEUED
 *   FAILED → DEAD_LETTER (Budget erschöpft)
 *
 * Garantien:
 *  - Jeder Job hat eine eigene `jobId`.
 *  - Lease + Heartbeat + Timeout: verwaiste Worker werden erkannt.
 *  - `idempotencyKey` verhindert die doppelte Ausführung derselben
 *    nicht-idempotenten Aktion.
 *  - Worker-Ownership: nur der Lease-Inhaber darf starten/heartbeaten/abschließen.
 */

export type Job = {
  jobId: string;
  taskId: string;
  runId?: string;
  agentId: string;
  state: JobState;
  attempt: number;
  maxAttempts: number;
  risk: Risk;
  priority: number;
  idempotencyKey: string;
  createdAt: string;
  leasedUntil?: string;
  leaseOwner?: string;
  lastHeartbeatAt?: string;
  nextAttemptAt?: string;
  backoffMs: number;
  timeoutMs: number;
  error?: string;
  deadLetterReason?: string;
};

type Payload = {jobs: Job[]};
const store = createStore<Payload>("queue", 2, () => ({jobs: []}));
const clone = <T>(value: T): T => structuredClone(value);

export const JOB_TRANSITIONS: Record<JobState, JobState[]> = {
  QUEUED: ["LEASED", "CANCELLED", "DEAD_LETTER"],
  LEASED: ["RUNNING", "QUEUED", "FAILED", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: ["QUEUED", "DEAD_LETTER", "CANCELLED"],
  CANCELLED: [],
  DEAD_LETTER: []
};

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

function transition(job: Job, next: JobState, reason: string, mutateFn: (j: Job) => void = () => undefined): Job {
  if (!canTransitionJob(job.state, next)) throw new Error(`invalid job transition ${job.state} -> ${next}`);
  job.state = next;
  mutateFn(job);
  store.update(payload => {
    const index = payload.jobs.findIndex(j => j.jobId === job.jobId);
    if (index >= 0) payload.jobs[index] = job;
    else payload.jobs.push(job);
  });
  observe({
    type: `job.${next.toLowerCase()}`,
    message: `Job ${job.jobId}: ${next} (${reason})`,
    status: next === "SUCCEEDED" ? "COMPLETED" : next === "FAILED" || next === "DEAD_LETTER" ? "ERROR" : "RUNNING",
    actor: job.leaseOwner ?? job.agentId,
    agentId: job.agentId,
    taskId: job.taskId,
    runId: job.runId,
    jobId: job.jobId,
    action: "job.transition",
    resource: job.jobId,
    decision: next === "FAILED" || next === "DEAD_LETTER" ? "ERROR" : "ALLOW",
    argumentsValue: {to: next, reason, attempt: job.attempt, owner: job.leaseOwner}
  });
  return clone(job);
}

export function queueSnapshot(): Job[] {
  return clone(store.read().jobs);
}

export function getJob(jobId: string): Job | null {
  return clone(store.read().jobs.find(j => j.jobId === jobId) ?? null);
}

export function enqueueJob(input: {
  taskId: string;
  runId?: string;
  agentId: string;
  risk: Risk;
  maxAttempts?: number;
  idempotencyKey?: string;
  priority?: number;
  timeoutMs?: number;
  backoffMs?: number;
}): Job {
  const idempotencyKey = input.idempotencyKey ?? input.taskId;
  const existing = store.read().jobs.find(j => j.idempotencyKey === idempotencyKey && !["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTER"].includes(j.state));
  if (existing) return clone(existing);
  const job: Job = {
    jobId: `JOB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    taskId: input.taskId,
    runId: input.runId,
    agentId: input.agentId,
    state: "QUEUED",
    attempt: 0,
    maxAttempts: input.maxAttempts ?? 3,
    risk: input.risk,
    priority: input.priority ?? 5,
    idempotencyKey,
    createdAt: new Date().toISOString(),
    backoffMs: input.backoffMs ?? 5_000,
    timeoutMs: input.timeoutMs ?? 300_000
  };
  store.update(payload => {
    payload.jobs.push(job);
    if (payload.jobs.length > 2000) payload.jobs.splice(0, payload.jobs.length - 2000);
  });
  observe({
    type: "job.enqueued",
    message: `Job ${job.jobId} eingereiht`,
    status: "QUEUED",
    actor: job.agentId,
    agentId: job.agentId,
    taskId: job.taskId,
    runId: job.runId,
    jobId: job.jobId,
    action: "queue.enqueue",
    resource: job.jobId,
    argumentsValue: {idempotencyKey, risk: job.risk}
  });
  return clone(job);
}

function writeJob(job: Job) {
  store.update(payload => {
    const index = payload.jobs.findIndex(j => j.jobId === job.jobId);
    if (index >= 0) payload.jobs[index] = job;
  });
}

export function leaseJob(jobId: string, workerId = "worker-local", leaseMs = 60_000): Job | null {
  const job = store.read().jobs.find(j => j.jobId === jobId);
  if (!job || job.state !== "QUEUED") return null;
  if (job.attempt >= job.maxAttempts) return null;
  if (job.nextAttemptAt && new Date(job.nextAttemptAt).getTime() > Date.now()) return null;
  return transition(job, "LEASED", `leased by ${workerId}`, j => {
    j.attempt += 1;
    j.leaseOwner = workerId;
    j.leasedUntil = new Date(Date.now() + leaseMs).toISOString();
    j.lastHeartbeatAt = new Date().toISOString();
  });
}

/** Nächsten ausführbaren Job beanspruchen (Worker-Ownership, Priorität, Backoff). */
export function claimNextJob(workerId: string, leaseMs = 60_000): Job | null {
  const candidate = store
    .read()
    .jobs.filter(j => j.state === "QUEUED" && j.attempt < j.maxAttempts && (!j.nextAttemptAt || new Date(j.nextAttemptAt).getTime() <= Date.now()))
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))[0];
  return candidate ? leaseJob(candidate.jobId, workerId, leaseMs) : null;
}

export function startJob(jobId: string, workerId?: string): Job | null {
  const job = store.read().jobs.find(j => j.jobId === jobId);
  if (!job || job.state !== "LEASED") return null;
  if (workerId && job.leaseOwner && job.leaseOwner !== workerId) return null;
  return transition(job, "RUNNING", `worker ${job.leaseOwner ?? "unknown"} started`, j => {
    j.lastHeartbeatAt = new Date().toISOString();
    j.leasedUntil = new Date(Date.now() + j.timeoutMs).toISOString();
  });
}

export function heartbeatJob(jobId: string, workerId?: string, leaseMs = 60_000): Job | null {
  const job = store.read().jobs.find(j => j.jobId === jobId);
  if (!job || !["LEASED", "RUNNING"].includes(job.state)) return null;
  if (workerId && job.leaseOwner && job.leaseOwner !== workerId) return null;
  job.lastHeartbeatAt = new Date().toISOString();
  job.leasedUntil = new Date(Date.now() + leaseMs).toISOString();
  writeJob(job);
  return clone(job);
}

export function completeJob(jobId: string, workerId?: string): Job | null {
  const job = store.read().jobs.find(j => j.jobId === jobId);
  if (!job || !["LEASED", "RUNNING"].includes(job.state)) return null;
  if (workerId && job.leaseOwner && job.leaseOwner !== workerId) return null;
  return transition(job, "SUCCEEDED", "execution completed", j => {
    j.leasedUntil = undefined;
  });
}

export function failJob(jobId: string, error: string, workerId?: string): Job | null {
  const job = store.read().jobs.find(j => j.jobId === jobId);
  if (!job || ["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTER"].includes(job.state)) return null;
  if (workerId && job.leaseOwner && job.leaseOwner !== workerId) return null;
  const failed = transition(job, "FAILED", error, j => {
    j.error = error.slice(0, 2000);
    j.leasedUntil = undefined;
  });
  if (failed.attempt >= failed.maxAttempts) return deadLetterJob(jobId, `retry budget exhausted after ${failed.attempt} attempts`);
  const failure = store.read().jobs.find(j => j.jobId === jobId);
  if (!failure) return null;
  return transition(failure, "QUEUED", "scheduled retry with backoff", j => {
    j.nextAttemptAt = new Date(Date.now() + j.backoffMs * Math.max(1, j.attempt)).toISOString();
    j.leasedUntil = undefined;
    j.leaseOwner = undefined;
  });
}

export function deadLetterJob(jobId: string, reason: string): Job | null {
  const job = store.read().jobs.find(j => j.jobId === jobId);
  if (!job || !canTransitionJob(job.state, "DEAD_LETTER")) return null;
  return transition(job, "DEAD_LETTER", reason, j => {
    j.deadLetterReason = reason;
    j.leasedUntil = undefined;
  });
}

/** Abgelaufene Leases erkennen; Job requeuen oder in Dead-Letter überführen. */
export function expireLeases(at = Date.now()): number {
  const expired = store.read().jobs.filter(j => ["LEASED", "RUNNING"].includes(j.state) && j.leasedUntil && new Date(j.leasedUntil).getTime() <= at);
  for (const job of expired) {
    const current = store.read().jobs.find(j => j.jobId === job.jobId);
    if (!current) continue;
    transition(current, "FAILED", "lease expired (stale worker)", j => {
      j.error = "lease expired";
      j.leasedUntil = undefined;
    });
    const failed = store.read().jobs.find(j => j.jobId === job.jobId);
    if (!failed) continue;
    if (failed.attempt >= failed.maxAttempts) deadLetterJob(job.jobId, "lease expired and retry budget exhausted");
    else
      transition(failed, "QUEUED", "requeue after stale lease", j => {
        j.nextAttemptAt = new Date(Date.now() + j.backoffMs).toISOString();
        j.leaseOwner = undefined;
        j.leasedUntil = undefined;
      });
  }
  return expired.length;
}

export function cancelJob(jobId: string, actor = "system"): Job | null {
  const job = store.read().jobs.find(j => j.jobId === jobId);
  if (!job || !canTransitionJob(job.state, "CANCELLED")) return null;
  return transition(job, "CANCELLED", `cancelled by ${actor}`, j => {
    j.leasedUntil = undefined;
  });
}

export function queueSummary() {
  const jobs = store.read().jobs;
  return {
    total: jobs.length,
    queued: jobs.filter(j => j.state === "QUEUED").length,
    leased: jobs.filter(j => j.state === "LEASED").length,
    running: jobs.filter(j => j.state === "RUNNING").length,
    failed: jobs.filter(j => j.state === "FAILED").length,
    deadLetter: jobs.filter(j => j.state === "DEAD_LETTER").length
  };
}

export function queueStoreReport() {
  return store.integrity();
}
