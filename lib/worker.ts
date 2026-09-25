import {expireLeases, claimNextJob, startJob, completeJob, failJob, heartbeatJob, getJob, queueSnapshot} from "./queue";
import {
  attachExecution,
  beginDiagnosis,
  beginRecovery,
  beginVerification,
  completeRun,
  createRun,
  deadLetterRun,
  expireStaleRuns,
  failRun,
  findRunByJob,
  getRun,
  heartbeatRun,
  listRuns,
  queueRun,
  recordRootCause,
  scheduleRetry,
  startRun
} from "./runs";
import {activeSandboxRuntime, activeRuntimeMode, reconcileActiveRuntime, runtimeHandle} from "./runtime-factory";
import {createErrorIncident, investigateError, transitionError} from "./error-intelligence";
import {ensureExecutionCapability} from "./authority";
import {executeAuthorized} from "./execution-broker";
import {getControlState, updateTaskStatus} from "./control-plane";

/**
 * Worker-Ausführungsschleife (Abschnitt 7/42).
 *
 * Ein Worker-Zyklus:
 *  1. abgelaufene Leases und verwaiste Runs erkennen
 *  2. Runtime-Zustand abgleichen (Orphan-Erkennung)
 *  3. nächsten Job beanspruchen (Worker-Ownership)
 *  4. Run binden und starten
 *  5. Heartbeats senden, Ausführung über den Broker
 *  6. Erfolg abschließen oder Fehler → Diagnose → Recovery vorbereiten
 */

export type WorkerCycle = {
  workerId: string;
  expiredJobs: number;
  staleRuns: string[];
  observed: number;
  leased: string[];
  completed: string[];
  failed: string[];
  recovered: string[];
  deadLettered: string[];
};

const HEARTBEAT_INTERVAL_MS = 5_000;

export async function runWorkerCycle(workerId = `worker-${process.pid}`): Promise<WorkerCycle> {
  const result: WorkerCycle = {workerId, expiredJobs: expireLeases(), staleRuns: expireStaleRuns(), observed: 0, leased: [], completed: [], failed: [], recovered: [], deadLettered: []};
  const observations = await reconcileActiveRuntime();
  result.observed = observations.length;

  for (let i = 0; i < 10; i += 1) {
    const job = claimNextJob(workerId);
    if (!job) break;
    result.leased.push(job.jobId);

    // Run wiederherstellen oder neu anlegen; Jobs und Runs bleiben 1:1 verbunden.
    let run = job.runId ? getRun(job.runId) : findRunByJob(job.jobId);
    if (!run) {
      run = createRun({taskId: job.taskId, agentId: job.agentId, risk: job.risk, idempotencyKey: `job:${job.jobId}`});
    }
    if (!run.sandboxId) {
      failJob(job.jobId, "run has no sandbox binding", workerId);
      failRun(run.runId, "run has no sandbox binding");
      result.failed.push(job.jobId);
      continue;
    }
    if (run.jobId === null) {
      try {
        attachExecution(run.runId, job.jobId, run.sandboxId);
      } catch {
        /* Bindung kann bereits bestehen */
      }
    }
    if (run.state === "CREATED") queueRun(run.runId, workerId);

    if (!startJob(job.jobId, workerId)) {
      result.failed.push(job.jobId);
      continue;
    }
    if (!startRun(run.runId)) {
      failJob(job.jobId, "run could not be started", workerId);
      result.failed.push(job.jobId);
      continue;
    }

    const heartbeat = setInterval(() => {
      heartbeatJob(job.jobId, workerId);
      heartbeatRun(run!.runId);
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const state = getControlState();
      const task = state.tasks.find(t => t.taskId === run!.taskId);
      if (!task) throw new Error(`task not found: ${run.taskId}`);
      const sandbox = state.sandboxes.find(s => s.sandboxId === run!.sandboxId);
      if (!sandbox) throw new Error(`sandbox not registered: ${run.sandboxId}`);

      // Runtime-Liveness: niemals gegen eine fehlende/gestoppte Sandbox ausführen.
      const handle = runtimeHandle(sandbox.sandboxId);
      if (handle && !["RUNNING", "READY"].includes(handle.state)) throw new Error(`sandbox runtime is not executable: ${handle.state}`);
      if (activeRuntimeMode === "oci" && !handle) throw new Error("sandbox runtime handle is missing (reconciliation required)");

      updateTaskStatus(task.taskId, "EXECUTING", Math.max(task.progress, 50));
      const capability = ensureExecutionCapability(run.agentId, run.taskId, sandbox.sandboxId, task.risk, sandbox.type);
      const execution = await executeAuthorized({
        taskId: run.taskId,
        agentId: run.agentId,
        sandboxId: sandbox.sandboxId,
        capabilityTokenId: capability.id,
        runId: run.runId,
        environment: sandbox.type,
        argv: ["agent-execution"]
      });
      if (!execution.accepted) throw new Error(`execution rejected: ${execution.message}`);

      completeJob(job.jobId, workerId);
      completeRun(run.runId);
      updateTaskStatus(task.taskId, "COMPLETED", 100);
      result.completed.push(job.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const incident = createErrorIncident({
        severity: "HIGH",
        symptom: "Worker-Ausführung fehlgeschlagen",
        incident: message,
        failureMode: "RUN_EXECUTION_FAILURE",
        contributingFactors: ["worker execution path"],
        prevention: [],
        evidenceIds: [],
        taskId: run.taskId,
        runId: run.runId,
        agentId: run.agentId,
        sandboxId: run.sandboxId ?? undefined,
        error: message
      });
      transitionError(incident.incidentId, "TRIAGING");
      // Autonome Untersuchung: Diagnose-Sandbox, Failure-Record, Recovery-Plan.
      try {
        await investigateError(incident.incidentId);
      } catch {
        /* Untersuchung darf den Worker-Zyklus nicht abbrechen */
      }
      beginDiagnosis(run.runId);
      recordRootCause(run.runId, `worker failure: ${message.slice(0, 500)}`);

      const failedJob = failJob(job.jobId, message, workerId);
      if (failedJob?.state === "DEAD_LETTER") {
        deadLetterRun(run.runId, "job retry budget exhausted");
        result.deadLettered.push(job.jobId);
      } else {
        failRun(run.runId, message);
        beginRecovery(run.runId);
        beginVerification(run.runId);
        scheduleRetry(run.runId);
        result.recovered.push(run.runId);
      }
      result.failed.push(job.jobId);
    } finally {
      clearInterval(heartbeat);
    }
  }

  return result;
}

export function workerSnapshot() {
  return {
    jobs: queueSnapshot(),
    runs: listRuns(),
    runtime: {mode: activeSandboxRuntime.mode, health: "see /api/runtime"},
    job: (jobId: string) => getJob(jobId),
    run: (runId: string) => getRun(runId)
  };
}

/** Nur für Tests/Diagnose: registriert einen Run ohne Broker-Ausführung. */
export function createQueuedRun(input: {taskId: string; agentId: string; sandboxId: string; risk: "SAFE" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL"}) {
  return createRun({...input, idempotencyKey: `manual:${input.taskId}:${Date.now()}`});
}
