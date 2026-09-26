import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Worker-Zyklus und Fehlerkette.
 *
 * Beim vollständigen Durchlauf der Anwendung traten drei zusammenhängende
 * Defekte auf, die hier als Regression festgehalten werden:
 *
 * 1. Der Run wurde nie geleast. `startRun` warf dadurch
 *    "invalid run transition QUEUED -> RUNNING", und diese Ausnahme beendete
 *    den **gesamten** Zyklus: weitere Jobs blieben unbearbeitet, ohne dass der
 *    Zyklus das meldete.
 * 2. Der Fehlerpfad führte den Incident nicht bis `ROOT_CAUSE_FOUND`. Der
 *    Übergang nach `FIXING` war deshalb ungültig ("invalid error transition
 *    DIAGNOSING -> FIXING"); die Recovery wurde verschluckt.
 * 3. Nach der Recovery wurde zusätzlich ein Ausführungs-Retry geplant
 *    ("invalid run transition VERIFYING -> QUEUED"). Ein Lauf in Behandlung
 *    darf nicht erneut ausgeführt werden.
 *
 * Der Test prüft den vollständigen Pfad: Job scheitert → Fehler-Incident mit
 * Evidenz und Root Cause → Recovery-Plan begonnen → Run in Verifikation →
 * Job zurückgestellt, ohne einen Versuch zu verbrauchen.
 */

isolatedStorageRoot("worker-recovery");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let queue: typeof import("../../lib/queue");
let runs: typeof import("../../lib/runs");
let worker: typeof import("../../lib/worker");
let errors: typeof import("../../lib/error-intelligence");
let reliability: typeof import("../../lib/reliability");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  queue = await import("../../lib/queue");
  runs = await import("../../lib/runs");
  worker = await import("../../lib/worker");
  errors = await import("../../lib/error-intelligence");
  reliability = await import("../../lib/reliability");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Worker-Tester"});
});

describe("Worker-Zyklus: Lease, Ausführung, Fehlerkette", () => {
  it("führt den Run durch Lease und Ausführung und scheitert kontrolliert (kein Zyklusabbruch)", async () => {
    const mission = cp.createMission({title: "Worker-Mission", objective: "Fehlerpfad prüfen", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Worker-Task", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});

    // Bewusst unbrauchbare Sandbox-Bindung: der Lauf muss fail closed scheitern.
    const run = runs.createRun({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", sandboxId: "SB-GIBTSNICHT"});
    queue.enqueueJob({taskId: task.taskId, runId: run.runId, agentId: "AG-BUILD", risk: "LOW"});

    const cycle = await worker.runWorkerCycle("worker-test");

    // Der Job wurde abgearbeitet — nicht stillschweigend übersprungen.
    expect(cycle.leased).toContain(queue.queueSnapshot().find(job => job.runId === run.runId)!.jobId);
    expect(cycle.failed.length).toBe(1);
    // Kein Vorbereitungsfehler: Lease und Start liefen durch (Regression zu
    // "invalid run transition QUEUED -> RUNNING").
    expect(cycle.jobFailures).toEqual([]);
    expect(cycle.recoveryFailures).toEqual([]);
    expect(cycle.recovered).toContain(run.runId);
  }, 120_000);

  it("führt den Incident über Hypothese, Experiment, Evidenz und Root Cause bis FIXING", async () => {
    const incident = errors.listErrorIncidents()[0];
    expect(incident, "Fehler-Incident zum Run").toBeTruthy();
    expect(incident.status).toBe("FIXING");
    expect(incident.hypothesis?.length ?? 0).toBeGreaterThan(5);
    expect(incident.experimentId).toMatch(/^EXP-/);
    expect(incident.evidenceIds.length).toBeGreaterThan(0);
    expect(incident.rootCause?.length ?? 0).toBeGreaterThan(5);
    expect(incident.recoveryId).toMatch(/^REC-/);
  }, 60_000);

  it("beginnt den Recovery-Plan mit abgeleiteter Stufe und echtem Checkpoint", async () => {
    const incident = errors.listErrorIncidents()[0];
    const plan = reliability.getRecoveryPlan(incident.recoveryId!);
    expect(plan, "Recovery-Plan").toBeTruthy();
    expect(plan!.status).toBe("EXECUTING");
    expect(plan!.tier).toBeGreaterThanOrEqual(1);
    expect(plan!.steps.length).toBeGreaterThan(0);
    expect(plan!.failureId).toBe(incident.failureId);
  }, 60_000);

  it("setzt den Run in Verifikation und stellt den Job zurück, ohne einen Versuch zu verbrauchen", async () => {
    const job = queue.queueSnapshot().find(entry => entry.state === "QUEUED");
    expect(job, "zurückgestellter Job").toBeTruthy();
    expect(job!.deferredReason).toContain("recovery");
    expect(job!.deferrals).toBeGreaterThan(0);
    expect(job!.attempt).toBeLessThan(job!.maxAttempts);
    const run = runs.getRun(job!.runId!);
    expect(run!.state).toBe("VERIFYING");
  }, 60_000);

  it("führt einen Run in Behandlung nicht erneut aus und zählt keine Fehlversuche", async () => {
    const before = queue.queueSnapshot().find(entry => entry.state === "QUEUED")!;
    const second = await worker.runWorkerCycle("worker-test-2");
    // Die Wartezeit läuft noch: der Job wird nicht erneut beansprucht.
    expect(second.leased).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(second.deferred).toEqual([]);
    const after = queue.queueSnapshot().find(entry => entry.jobId === before.jobId)!;
    expect(after.attempt).toBe(before.attempt);
  }, 120_000);
});

describe("deferJob: Zurückstellen ohne Versuchsverbrauch", () => {
  it("stellt einen geleasten Job mit wachsender Frist zurück", () => {
    const job = queue.enqueueJob({taskId: "TASK-X", agentId: "AG-BUILD", risk: "LOW"});
    const leased = queue.leaseJob(job.jobId, "worker-x")!;
    expect(leased.state).toBe("LEASED");
    // Der Lease selbst zählt als Versuch; das Zurückstellen darf keinen
    // weiteren Versuch verbrauchen.
    const attemptsAfterLease = leased.attempt;
    const first = queue.deferJob(job.jobId, "run in RECOVERING", 1_000)!;
    expect(first.state).toBe("QUEUED");
    expect(first.attempt).toBe(attemptsAfterLease);
    expect(first.deferrals).toBe(1);
    const second = queue.deferJob(job.jobId, "run in RECOVERING", 1_000)!;
    expect(second.deferrals).toBe(2);
    expect(new Date(second.nextAttemptAt!).getTime()).toBeGreaterThan(new Date(first.nextAttemptAt!).getTime());
  });

  it("stellt einen laufenden Job nicht zurück", () => {
    const job = queue.enqueueJob({taskId: "TASK-Y", agentId: "AG-BUILD", risk: "LOW"});
    queue.leaseJob(job.jobId, "worker-y");
    queue.startJob(job.jobId, "worker-y");
    expect(queue.deferJob(job.jobId, "run in RECOVERING")).toBeNull();
  });
});

describe("establishRootCauseFromFailure: Nachweis vor Ursache", () => {
  it("verweigert eine Ursache ohne Diagnose-Sandbox (kein erfundener Nachweis)", () => {
    const incident = errors.createErrorIncident({
      severity: "MEDIUM",
      symptom: "Ausfall ohne Sandbox",
      incident: "kein Diagnosepfad verfügbar",
      failureMode: "RUN_EXECUTION_FAILURE",
      contributingFactors: ["isolated runtime"],
      prevention: [],
      evidenceIds: [],
      error: "kein Diagnosepfad verfügbar"
    });
    errors.transitionError(incident.incidentId, "TRIAGING");
    errors.transitionError(incident.incidentId, "CONTAINED");
    errors.transitionError(incident.incidentId, "REPRODUCING");
    errors.transitionError(incident.incidentId, "DIAGNOSING");
    expect(() => errors.establishRootCauseFromFailure(incident.incidentId, "Ausfallmeldung ohne Sandbox"))
      .toThrow(/sandbox/i);
    // Der Incident bleibt in DIAGNOSING stehen — kein Zwischenzustand mit
    // behaupteter Ursache.
    expect(errors.getErrorIncident(incident.incidentId)!.rootCause).toBeFalsy();
  });
});
