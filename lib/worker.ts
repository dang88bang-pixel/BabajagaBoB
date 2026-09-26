import {expireLeases, claimNextJob, startJob, completeJob, failJob, heartbeatJob, getJob, queueSnapshot, deferJob, cancelJob} from "./queue";
import {
  attachExecution,
  beginDiagnosis,
  // Run-Ebene: FAILED → RECOVERING (nicht zu verwechseln mit dem Recovery-Plan!)
  beginRecovery as beginRunRecovery,
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
  leaseRun,
  recordRootCause,
  scheduleRetry,
  startRun
} from "./runs";
import {activeSandboxRuntime, activeRuntimeMode, reconcileActiveRuntime, runtimeHandle} from "./runtime-factory";
import {createErrorIncident, establishRootCauseFromFailure, investigateError, prepareErrorRecovery, transitionError} from "./error-intelligence";
import {beginRecovery as beginRecoveryPlan} from "./reliability";
import {ensureExecutionCapability} from "./authority";
import {executeAuthorized} from "./execution-broker";
import {getControlState, updateTaskStatus} from "./control-plane";
import type {RunState} from "./types";

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
  /**
   * Fehlgeschlagene Recovery-Versuche mit Grund. Ein leeres Array bedeutet:
   * alles, was als `recovered` gemeldet wurde, wurde auch wirklich begonnen
   * (kein stiller Fehlschlag mehr).
   */
  recoveryFailures: {runId: string; reason: string}[];
  /** Jobs, die in der Vorbereitung scheiterten (mit Grund) — nie still. */
  jobFailures: {jobId: string; reason: string}[];
  /** Zurückgestellte Jobs (Run in Behandlung) — Versuch nicht verbraucht. */
  deferred: string[];
  /** Abgebrochene Jobs (Run nicht mehr ausführbar). */
  cancelled: string[];
};

/** Run-Zustände, in denen eine Ausführung nicht stattfinden darf. */
const RUN_STATES_IN_TREATMENT: RunState[] = ["DIAGNOSING", "ROOT_CAUSE_FOUND", "RECOVERING", "VERIFYING"];

const HEARTBEAT_INTERVAL_MS = 5_000;

export async function runWorkerCycle(workerId = `worker-${process.pid}`): Promise<WorkerCycle> {
  const result: WorkerCycle = {workerId, expiredJobs: expireLeases(), staleRuns: expireStaleRuns(), observed: 0, leased: [], completed: [], failed: [], recovered: [], deadLettered: [], recoveryFailures: [], jobFailures: [], deferred: [], cancelled: []};
  const observations = await reconcileActiveRuntime();
  result.observed = observations.length;

  for (let i = 0; i < 10; i += 1) {
    const job = claimNextJob(workerId);
    if (!job) break;
    result.leased.push(job.jobId);

    // Run wiederherstellen oder neu anlegen; Jobs und Runs bleiben 1:1 verbunden.
    // Alles ab hier ist pro Job gekapselt: ein defekter Job darf den Zyklus nicht
    // abbrechen (früher beendete eine Ausnahme die gesamte Abarbeitung).
    try {
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

    // Läuft der Run bereits in Diagnose/Recovery/Verifikation, darf er nicht
    // gestartet werden. Der Job wird zurückgestellt (Versuch bleibt unverbraucht)
    // statt mehrfach sinnlos zu scheitern.
    if (RUN_STATES_IN_TREATMENT.includes(run.state)) {
      deferJob(job.jobId, `run in ${run.state}`, 30_000);
      result.deferred.push(job.jobId);
      continue;
    }

    if (!startJob(job.jobId, workerId)) {
      result.failed.push(job.jobId);
      continue;
    }

    // Der Run muss geleast sein, bevor er läuft: QUEUED → LEASED → RUNNING.
    // Ohne Lease wirft `startRun` "invalid run transition"; früher brach diese
    // Ausnahme den **gesamten** Zyklus ab, statt nur diesen Job zu behandeln.
    // Zustand stets frisch aus dem Store lesen — `queueRun`/`leaseRun` oben
    // geben neue Zustände zurück, die lokale Kopie ist danach veraltet.
    run = getRun(run.runId) ?? run;
    if (run.state === "QUEUED") run = leaseRun(run.runId, workerId) ?? run;
    if (run.state !== "LEASED") {
      // Endzustand (SUCCEEDED/DEAD_LETTER/CANCELLED o. Ä.): keine Ausführung.
      // Ein Fehlversuch würde nur das Retry-Budget verbrauchen, deshalb abbrechen.
      cancelJob(job.jobId, `run not executable: ${run.state}`);
      result.cancelled.push(job.jobId);
      continue;
    }
    if (!startRun(run.runId)) {
      failJob(job.jobId, "run could not be started", workerId);
      result.failed.push(job.jobId);
      continue;
    }
    run = getRun(run.runId) ?? run;

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
      let investigated = incident;
      try {
        investigated = await investigateError(incident.incidentId);
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
        // Fehler-Ebene: erst der vollständige Nachweispfad (Hypothese →
        // Experiment → Evidenz → Root Cause), danach der Recovery-Plan. Ohne
        // diese Stufen ist der Übergang nach FIXING ungültig — genau daran
        // scheiterte der autonome Fehlerpfad zuvor, ohne dass es auffiel. Der
        // Run bleibt dabei in FAILED, damit ein Retry weiterhin möglich ist.
        let chainStarted = false;
        try {
          establishRootCauseFromFailure(investigated.incidentId, `worker failure: ${message}`);
          const prepared = await prepareErrorRecovery(investigated.incidentId);
          if (!prepared.recoveryId) throw new Error("recovery plan was not created");
          await beginRecoveryPlan(prepared.recoveryId);
          chainStarted = true;
        } catch (recoveryError) {
          result.recoveryFailures.push({
            runId: run.runId,
            reason: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
          });
        }

        if (chainStarted) {
          // Run gehört jetzt der Recovery: FAILED → RECOVERING → VERIFYING.
          // Der Job wird zurückgestellt; der Fix gilt erst nach der
          // Recovery-Verifikation als bestätigt (kein Erfolg ohne Nachweis).
          if (!beginRunRecovery(run.runId)) {
            result.recoveryFailures.push({runId: run.runId, reason: "run recovery rejected (state not recoverable)"});
          } else if (!beginVerification(run.runId)) {
            result.recoveryFailures.push({runId: run.runId, reason: "verification rejected (state not verifiable)"});
          } else {
            deferJob(job.jobId, "run is in recovery/verification", 30_000);
            result.deferred.push(job.jobId);
            result.recovered.push(run.runId);
          }
        } else {
          // Kein Recovery-Plan: klassischer Wiederholungsversuch (FAILED → QUEUED).
          if (!scheduleRetry(run.runId)) {
            result.recoveryFailures.push({
              runId: run.runId,
              reason: `retry rejected at state ${getRun(run.runId)?.state ?? "unknown"}`
            });
          }
        }
      }
      result.failed.push(job.jobId);
    } finally {
      clearInterval(heartbeat);
    }
    } catch (jobError) {
      // Unerwarteter Fehler in der Job-Vorbereitung: Job scheitern lassen, Grund
      // festhalten, mit dem nächsten Job weitermachen.
      const reason = jobError instanceof Error ? jobError.message : String(jobError);
      try {
        failJob(job.jobId, reason, workerId);
      } catch {
        /* Job war bereits in einem Endzustand */
      }
      result.failed.push(job.jobId);
      result.jobFailures.push({jobId: job.jobId, reason});
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
