import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Eigener Test für den Dispatcher (`dispatchTask`/`runOnce`) und den
 * Worker-Pfad (Fertigstellungsplan Phase 2, Punkt 5.2). Bisher wurde der
 * Dispatcher nur indirekt in der Fehlerinjektion benutzt; der Worker-Zyklus
 * war nur über seinen Fehlerpfad abgedeckt.
 *
 * Abgebildet wird das vorhandene Verhalten: Dispatch verweigert unbekannte
 * Tasks/Agenten, fremde Zuweisungen und Lockdown (fail closed); im Erfolgsfall
 * entstehen Run + Job + Sandbox gebunden und idempotent; `runOnce` führt über
 * Gate/Broker aus und beendet Run und Job — Erfolg wie Fehlschlag.
 */

isolatedStorageRoot("dispatcher-worker");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let dispatcher: typeof import("../../lib/dispatcher");
let queue: typeof import("../../lib/queue");
let runs: typeof import("../../lib/runs");
let worker: typeof import("../../lib/worker");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  dispatcher = await import("../../lib/dispatcher");
  queue = await import("../../lib/queue");
  runs = await import("../../lib/runs");
  worker = await import("../../lib/worker");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Dispatcher-Tester"});
});

const setupTask = (title: string) => {
  const mission = cp.createMission({title: `Dispatcher-Mission ${title}`, objective: "Dispatcher prüfen", createdBy: "CREATOR"});
  return cp.createTask({missionId: mission.missionId, title, risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
};

describe("dispatchTask: Verweigerung fail closed", () => {
  it("verweigert einen unbekannten Task und einen unbekannten Agenten", async () => {
    const task = setupTask("Unbekannt-Prüfung");
    await expect(dispatcher.dispatchTask({taskId: "TASK-GIBTSNICHT", agentId: "AG-BUILD", risk: "LOW"})).rejects.toThrow(/task not found/);
    await expect(dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-GIBTSNICHT", risk: "LOW"})).rejects.toThrow(/agent not found/);
  });

  it("verweigert die Ausführung durch einen nicht zugewiesenen Agenten", async () => {
    const task = setupTask("Fremdagent");
    await expect(dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-QA", risk: "LOW"})).rejects.toThrow(/assigned to/);
  });

  it("verweigert jeden Dispatch im Lockdown und lässt ihn nach Aufhebung wieder zu", async () => {
    const task = setupTask("Lockdown");
    cp.setLockdown(true, "CREATOR");
    await expect(dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"})).rejects.toThrow(/execution blocked/);
    cp.setLockdown(false, "CREATOR");
    const result = await dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    expect(result.state).toBe("QUEUED");
  });
});

describe("dispatchTask: Bindung und Idempotenz", () => {
  it("erzeugt Run, Job und Sandbox als gebundene Einheit im Zustand QUEUED", async () => {
    const task = setupTask("Bindung");
    const result = await dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    expect(result.runId).toMatch(/^RUN-/);
    expect(result.jobId).toMatch(/^JOB-/);
    expect(result.sandboxId).toBeTruthy();

    const run = runs.getRun(result.runId)!;
    expect(run.state).toBe("QUEUED");
    expect(run.jobId).toBe(result.jobId);
    expect(run.sandboxId).toBe(result.sandboxId);

    const job = queue.getJob(result.jobId)!;
    expect(job.state).toBe("QUEUED");
    expect(job.runId).toBe(result.runId);

    const sandbox = cp.getControlState().sandboxes.find(s => s.sandboxId === result.sandboxId);
    expect(sandbox).toBeTruthy();
    expect(sandbox!.taskId).toBe(task.taskId);
    expect(sandbox!.agentId).toBe("AG-BUILD");
  });

  it("gibt beim zweiten Dispatch dieselbe Bindung idempotent zurück (Regression Befund B5)", async () => {
    // Regression zu Befund B5 (behoben 2026-09-26): `createRun`/`enqueueJob`
    // deduplizieren über den Idempotenzschlüssel; zuvor rief `dispatchTask`
    // danach erneut `queueRun` auf und warf „invalid run transition
    // QUEUED -> QUEUED". Jetzt wird die vorhandene Bindung zurückgegeben —
    // ohne zweiten Run, zweiten Job oder eine zweite Sandbox.
    const task = setupTask("Idempotenz");
    const first = await dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    expect(first.state).toBe("QUEUED");
    expect(first.created).toBe(true);

    const second = await dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    expect(second.created).toBe(false);
    expect(second.runId).toBe(first.runId);
    expect(second.jobId).toBe(first.jobId);
    expect(second.sandboxId).toBe(first.sandboxId);
    expect(second.state).toBe("QUEUED");

    // Nichts wurde doppelt eingericht: genau ein Run, genau ein Job, genau
    // eine Sandbox zu diesem Task.
    expect(runs.listRuns().filter(r => r.taskId === task.taskId)).toHaveLength(1);
    expect(queue.queueSnapshot().filter(j => j.taskId === task.taskId)).toHaveLength(1);
    expect(cp.getControlState().sandboxes.filter(s => s.taskId === task.taskId)).toHaveLength(1);
  });
});

describe("runOnce: synchroner Worker-Schritt über Gate und Broker", () => {
  it("führt einen dispatchten Run real aus und schließt Run und Job erfolgreich ab", async () => {
    const task = setupTask("Erfolgspfad");
    const dispatch = await dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    await fabric.startSandbox(dispatch.sandboxId);

    const result = await dispatcher.runOnce({
      runId: dispatch.runId,
      workerId: "worker-once-ok",
      argv: ["node", "-e", "process.stdout.write('dispatch-ok')"]
    });

    expect(result.accepted).toBe(true);
    expect(result.message.trim().length).toBeGreaterThan(0);
    expect(runs.getRun(dispatch.runId)!.state).toBe("SUCCEEDED");
    expect(queue.getJob(dispatch.jobId)!.state).toBe("SUCCEEDED");
  }, 120_000);

  it("zählt einen Lauf mit Exit-Code ungleich 0 als Fehlschlag und plant den Retry", async () => {
    const task = setupTask("Fehlerpfad");
    const dispatch = await dispatcher.dispatchTask({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    await fabric.startSandbox(dispatch.sandboxId);

    const result = await dispatcher.runOnce({
      runId: dispatch.runId,
      workerId: "worker-once-fail",
      argv: ["node", "-e", "process.exit(3)"]
    });

    expect(result.accepted).toBe(false);
    expect(result.message.trim().length).toBeGreaterThan(0);
    // Der Run ist fehlgeschlagen; der Job geht mit Backoff zurück in die Queue
    // (Versuch 1 von 3 — kein Dead-Letter).
    expect(runs.getRun(dispatch.runId)!.state).toBe("FAILED");
    const job = queue.getJob(dispatch.jobId)!;
    expect(job.state).toBe("QUEUED");
    expect(job.attempt).toBe(1);
    expect(job.nextAttemptAt).toBeTruthy();
  }, 120_000);

  it("verweigert die Ausführung eines nicht vollständig gebundenen Runs", async () => {
    const task = setupTask("Ungebunden");
    const run = runs.createRun({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", idempotencyKey: `unbound:${task.taskId}`});
    await expect(dispatcher.runOnce({runId: run.runId})).rejects.toThrow(/not fully bound/);
  });
});

describe("runWorkerCycle: Job-Kapselung und Rückmeldung", () => {
  // Restlose Abmeldung wartender Jobs aus früheren Tests, damit der Zyklus
  // ausschließlich die Jobs dieses Tests sieht.
  const drainQueuedJobs = () => {
    for (const job of queue.queueSnapshot()) {
      if (job.state === "QUEUED") queue.cancelJob(job.jobId, "test-setup");
    }
  };

  it("meldet einen Run ohne Sandbox-Bindung als Fehlschlag und bricht den Zyklus nicht ab", async () => {
    drainQueuedJobs();
    const task = setupTask("Kapselung");
    const run = runs.createRun({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", idempotencyKey: `capsule:${task.taskId}`});
    expect(run.sandboxId).toBeNull();
    queue.enqueueJob({taskId: task.taskId, runId: run.runId, agentId: "AG-BUILD", risk: "LOW", idempotencyKey: `capsule-job:${task.taskId}`});

    const cycle = await worker.runWorkerCycle("worker-capsule");
    expect(cycle.failed).toHaveLength(1);
    expect(cycle.jobFailures).toEqual([]); // kein Vorbereitungsfehler, kontrollierter Pfad
    const job = queue.getJob(cycle.failed[0])!;
    expect(job.error).toContain("run has no sandbox binding");
    // Der Job geht mit Backoff zurück in die Queue (Versuch 1 von 3).
    expect(job.state).toBe("QUEUED");
    expect(job.nextAttemptAt).toBeTruthy();
    // Weitere Jobs wurden nicht bearbeitet.
    expect(cycle.completed).toEqual([]);
    expect(cycle.deferred).toEqual([]);
  }, 120_000);

  it("exekutiert einen Run in Behandlung nicht erneut (Zurückstellung statt Fehlversuch)", async () => {
    drainQueuedJobs();
    const task = setupTask("Behandlung");
    const run = runs.createRun({taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", sandboxId: "SB-GIBTSNICHT", idempotencyKey: `treat:${task.taskId}`});
    runs.queueRun(run.runId);
    runs.leaseRun(run.runId, "worker-treat");
    runs.startRun(run.runId);
    runs.failRun(run.runId, "Behandlungs-Testfehler");
    runs.beginDiagnosis(run.runId); // Run ist jetzt DIAGNOSING → in Behandlung
    queue.enqueueJob({taskId: task.taskId, runId: run.runId, agentId: "AG-BUILD", risk: "LOW", idempotencyKey: `treat-job:${task.taskId}`});

    const cycle = await worker.runWorkerCycle("worker-treat-2");
    expect(cycle.deferred).toHaveLength(1);
    expect(cycle.failed).toEqual([]);
    const job = queue.queueSnapshot().find(j => j.runId === run.runId)!;
    expect(job.deferredReason).toContain("DIAGNOSING");
    // Der Lease selbst zählt als Versuch; das Zurückstellen verbraucht keinen
    // zusätzlichen (Versuch bleibt bei 1, Budget 3).
    expect(job.attempt).toBe(1);
    expect(job.deferrals).toBeGreaterThan(0);
  }, 120_000);
});
