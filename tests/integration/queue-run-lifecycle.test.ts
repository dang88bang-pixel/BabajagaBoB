import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Eigener Test für Task Queue / Jobs und Run-Lifecycle (Fertigstellungsplan
 * Phase 2, Punkt 5.1). Bisher war dieser Bereich nur `IMPLEMENTED` und wurde
 * lediglich indirekt über Worker-/Broker-Suiten mitgeprüft.
 *
 * Der Test bildet das **vorhandene** Verhalten ab (QUEUED → LEASED → RUNNING
 * → SUCCEEDED, Retry mit Backoff, Dead-Letter, Lease-Ablauf, Zurückstellen,
 * Abbruch, Worker-Ownership, Idempotenz). Er verändert keine Funktion.
 */

isolatedStorageRoot("queue-run-lifecycle");

let bootstrap: typeof import("../../lib/bootstrap");
let queue: typeof import("../../lib/queue");
let runs: typeof import("../../lib/runs");

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  queue = await import("../../lib/queue");
  runs = await import("../../lib/runs");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Queue-Tester"});
});

describe("Job-Queue: Lebenszyklus und Garantien", () => {
  it("führt einen Job über QUEUED → LEASED → RUNNING → SUCCEEDED", () => {
    const job = queue.enqueueJob({taskId: "TASK-QL-1", agentId: "AG-BUILD", risk: "LOW"});
    expect(job.state).toBe("QUEUED");
    expect(job.attempt).toBe(0);

    const leased = queue.leaseJob(job.jobId, "worker-a")!;
    expect(leased.state).toBe("LEASED");
    expect(leased.attempt).toBe(1);
    expect(leased.leaseOwner).toBe("worker-a");
    expect(leased.leasedUntil).toBeTruthy();

    const started = queue.startJob(job.jobId, "worker-a")!;
    expect(started.state).toBe("RUNNING");

    const done = queue.completeJob(job.jobId, "worker-a")!;
    expect(done.state).toBe("SUCCEEDED");
    expect(done.leasedUntil).toBeUndefined();

    // Aus einem Endzustand gibt es keine weiteren Übergänge.
    expect(queue.completeJob(job.jobId, "worker-a")).toBeNull();
    expect(queue.canTransitionJob("SUCCEEDED", "RUNNING")).toBe(false);
  });

  it("erzwingt Worker-Ownership: fremde Worker dürfen nicht starten, heartbeaten oder abschließen", () => {
    const job = queue.enqueueJob({taskId: "TASK-QL-2", agentId: "AG-BUILD", risk: "LOW"});
    queue.leaseJob(job.jobId, "worker-owner");
    expect(queue.startJob(job.jobId, "worker-fremd")).toBeNull();
    expect(queue.heartbeatJob(job.jobId, "worker-fremd")).toBeNull();
    expect(queue.completeJob(job.jobId, "worker-fremd")).toBeNull();
    // Der Eigentümer hingegen darf.
    expect(queue.startJob(job.jobId, "worker-owner")!.state).toBe("RUNNING");
    expect(queue.heartbeatJob(job.jobId, "worker-owner")!.lastHeartbeatAt).toBeTruthy();
    expect(queue.completeJob(job.jobId, "worker-owner")!.state).toBe("SUCCEEDED");
  });

  it("verhindert doppelte Einreihung über den Idempotenzschlüssel", () => {
    const first = queue.enqueueJob({taskId: "TASK-QL-3", agentId: "AG-BUILD", risk: "LOW", idempotencyKey: "idem-ql-1"});
    const second = queue.enqueueJob({taskId: "TASK-QL-3", agentId: "AG-BUILD", risk: "LOW", idempotencyKey: "idem-ql-1"});
    expect(second.jobId).toBe(first.jobId);
    expect(queue.queueSnapshot().filter(j => j.idempotencyKey === "idem-ql-1")).toHaveLength(1);
    // Aufräumen, damit spätere Tests keine wartenden Alt-Jobs vorfinden.
    queue.cancelJob(first.jobId, "test");
  });

  it("beansprucht Jobs nach Priorität, dann nach Alter", () => {
    const low = queue.enqueueJob({taskId: "TASK-QL-4a", agentId: "AG-BUILD", risk: "LOW", priority: 9, idempotencyKey: "prio-a"});
    const high = queue.enqueueJob({taskId: "TASK-QL-4b", agentId: "AG-BUILD", risk: "LOW", priority: 1, idempotencyKey: "prio-b"});
    const claimed = queue.claimNextJob("worker-prio")!;
    expect(claimed.jobId).toBe(high.jobId);
    expect(low.priority).toBeGreaterThan(high.priority);
    const claimedSecond = queue.claimNextJob("worker-prio")!;
    expect(claimedSecond.jobId).toBe(low.jobId);
    // Beide Test-Jobs sind jetzt geleast; nichts wartet mehr für spätere Tests.
  });

  it("plant nach einem Fehler einen Retry mit Backoff; der Job ist bis dahin nicht beanspruchbar", async () => {
    const job = queue.enqueueJob({taskId: "TASK-QL-5", agentId: "AG-BUILD", risk: "LOW", backoffMs: 25, idempotencyKey: "retry-ql-1"});
    queue.leaseJob(job.jobId, "worker-r");
    queue.startJob(job.jobId, "worker-r");
    const retried = queue.failJob(job.jobId, "absichtlicher Testfehler", "worker-r")!;
    expect(retried.state).toBe("QUEUED");
    expect(retried.error).toContain("absichtlicher Testfehler");
    expect(new Date(retried.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now() - 5);
    // Während des Backoffs ist der Job weder claim- noch leasebar.
    expect(queue.claimNextJob("worker-r2")).toBeNull();
    expect(queue.leaseJob(job.jobId, "worker-r2")).toBeNull();
    // Nach Ablauf der Frist ist er wieder verfügbar.
    await wait(60);
    const again = queue.leaseJob(job.jobId, "worker-r2")!;
    expect(again.state).toBe("LEASED");
    expect(again.attempt).toBe(2);
  });

  it("überführt einen Job in Dead-Letter, sobald das Retry-Budget erschöpft ist", () => {
    const job = queue.enqueueJob({taskId: "TASK-QL-6", agentId: "AG-BUILD", risk: "LOW", maxAttempts: 1, idempotencyKey: "dl-ql-1"});
    queue.leaseJob(job.jobId, "worker-dl");
    queue.startJob(job.jobId, "worker-dl");
    const dead = queue.failJob(job.jobId, "endgültig fehlgeschlagen", "worker-dl")!;
    expect(dead.state).toBe("DEAD_LETTER");
    expect(dead.deadLetterReason).toContain("retry budget exhausted");
    // Ein Dead-Letter-Job ist endgültig: kein Lease, kein Abbruch, kein Übergang.
    expect(queue.leaseJob(job.jobId, "worker-dl")).toBeNull();
    expect(queue.cancelJob(job.jobId)).toBeNull();
  });

  it("erkennt abgelaufene Leases (verwaiste Worker) und reiht den Job mit Backoff wieder ein", async () => {
    const job = queue.enqueueJob({taskId: "TASK-QL-7", agentId: "AG-BUILD", risk: "LOW", backoffMs: 10, maxAttempts: 2, idempotencyKey: "stale-ql-1"});
    queue.leaseJob(job.jobId, "worker-stale", 1);
    await wait(15);
    const expired = queue.expireLeases();
    expect(expired).toBeGreaterThanOrEqual(1);
    const requeued = queue.getJob(job.jobId)!;
    expect(requeued.state).toBe("QUEUED");
    expect(requeued.error).toBe("lease expired");
    expect(requeued.leaseOwner).toBeUndefined();
    expect(requeued.attempt).toBe(1); // der Fehlversuch zählt, der Rest nicht
  });

  it("überführt einen Job mit abgelaufener Lease in Dead-Letter, wenn das Budget erschöpft ist", async () => {
    const job = queue.enqueueJob({taskId: "TASK-QL-8", agentId: "AG-BUILD", risk: "LOW", maxAttempts: 1, idempotencyKey: "stale-dl-1"});
    queue.leaseJob(job.jobId, "worker-stale2", 1);
    await wait(15);
    queue.expireLeases();
    const dead = queue.getJob(job.jobId)!;
    expect(dead.state).toBe("DEAD_LETTER");
    expect(dead.deadLetterReason).toContain("lease expired");
  });

  it("stellt einen geleasten Job zurück, ohne einen Versuch zu verbrauchen (wachsende Frist)", () => {
    const job = queue.enqueueJob({taskId: "TASK-QL-9", agentId: "AG-BUILD", risk: "LOW", idempotencyKey: "defer-ql-1"});
    const leased = queue.leaseJob(job.jobId, "worker-defer")!;
    const attemptsAfterLease = leased.attempt;
    const first = queue.deferJob(job.jobId, "run in RECOVERING", 1_000)!;
    expect(first.state).toBe("QUEUED");
    expect(first.attempt).toBe(attemptsAfterLease);
    expect(first.deferrals).toBe(1);
    const second = queue.deferJob(job.jobId, "run in RECOVERING", 1_000)!;
    expect(second.deferrals).toBe(2);
    expect(new Date(second.nextAttemptAt!).getTime()).toBeGreaterThan(new Date(first.nextAttemptAt!).getTime());
  });

  it("stellt einen laufenden Job nicht zurück und bricht wartende oder geleasten Jobs auf Wunsch ab", () => {
    const running = queue.enqueueJob({taskId: "TASK-QL-10", agentId: "AG-BUILD", risk: "LOW", idempotencyKey: "cancel-ql-1"});
    queue.leaseJob(running.jobId, "worker-c1");
    queue.startJob(running.jobId, "worker-c1");
    expect(queue.deferJob(running.jobId, "unmöglich im Lauf")).toBeNull();
    expect(queue.cancelJob(running.jobId, "creator")!.state).toBe("CANCELLED");

    const queued = queue.enqueueJob({taskId: "TASK-QL-11", agentId: "AG-BUILD", risk: "LOW", idempotencyKey: "cancel-ql-2"});
    expect(queue.cancelJob(queued.jobId, "creator")!.state).toBe("CANCELLED");
    // Abgebrochene Jobs sind endgültig.
    expect(queue.leaseJob(queued.jobId, "worker-c1")).toBeNull();
  });

  it("meldet zwei Worker niemals denselben Job (kein Doppel-Lease)", async () => {
    queue.enqueueJob({taskId: "TASK-QL-12a", agentId: "AG-BUILD", risk: "LOW", idempotencyKey: "race-ql-1"});
    queue.enqueueJob({taskId: "TASK-QL-12b", agentId: "AG-BUILD", risk: "LOW", idempotencyKey: "race-ql-2"});
    const [claimA, claimB] = await Promise.all([
      Promise.resolve(queue.claimNextJob("worker-race-a")),
      Promise.resolve(queue.claimNextJob("worker-race-b"))
    ]);
    expect(claimA && claimB).toBeTruthy();
    expect(claimA!.jobId).not.toBe(claimB!.jobId);
    expect(claimA!.leaseOwner).toBe("worker-race-a");
    expect(claimB!.leaseOwner).toBe("worker-race-b");
    // Ein bereits geleasten Job bekommt kein zweiter Worker.
    expect(queue.leaseJob(claimA!.jobId, "worker-race-b")).toBeNull();
  });

  it("zeichnet ein konsistentes Queue-Bild (queueSummary)", () => {
    const summary = queue.queueSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.deadLetter).toBeGreaterThanOrEqual(2);
    expect(summary.queued + summary.leased + summary.running + summary.failed + summary.deadLetter).toBeLessThanOrEqual(summary.total);
  });
});

describe("Run-Lifecycle: Zustandsmaschine", () => {
  const freshRun = (key: string) => runs.createRun({taskId: `TASK-RL-${key}`, agentId: "AG-BUILD", risk: "LOW", idempotencyKey: `rl:${key}`});

  it("führt einen Run über CREATED → QUEUED → LEASED → RUNNING → SUCCEEDED", () => {
    const run = freshRun("happy");
    expect(run.state).toBe("CREATED");
    expect(runs.queueRun(run.runId).state).toBe("QUEUED");
    const leased = runs.leaseRun(run.runId, "worker-run")!;
    expect(leased.state).toBe("LEASED");
    expect(leased.workerId).toBe("worker-run");
    // Ein zweiter Lease auf denselben Run ist ausgeschlossen.
    expect(runs.leaseRun(run.runId, "worker-run2")).toBeNull();
    const started = runs.startRun(run.runId)!;
    expect(started.state).toBe("RUNNING");
    expect(started.attempt).toBe(1);
    expect(started.startedAt).toBeTruthy();
    const done = runs.completeRun(run.runId)!;
    expect(done.state).toBe("SUCCEEDED");
    expect(done.finishedAt).toBeTruthy();
  });

  it("verweigert Übergänge außerhalb der Zustandsmaschine", () => {
    const run = freshRun("invalid");
    // Ohne Lease/Queue kein Start, kein Abschluss, keine Herzschlag-Aktualisierung.
    expect(runs.completeRun(run.runId)).toBeNull();
    expect(runs.heartbeatRun(run.runId)).toBeNull();
    expect(runs.canTransitionRun("SUCCEEDED", "RUNNING")).toBe(false);
    expect(runs.canTransitionRun("CREATED", "RUNNING")).toBe(false);
    // Abgebrochene Runs sind endgültig.
    runs.queueRun(run.runId);
    expect(runs.cancelRun(run.runId, "creator")!.state).toBe("CANCELLED");
    expect(runs.cancelRun(run.runId, "creator")).toBeNull();
  });

  it("plant Wiederholungen mit Backoff und erschöpft das Retry-Budget bis Dead-Letter", () => {
    const run = runs.createRun({taskId: "TASK-RL-budget", agentId: "AG-BUILD", risk: "LOW", maxAttempts: 2, idempotencyKey: "rl:budget", backoffMs: 5});
    runs.queueRun(run.runId);
    // Versuch 1
    runs.leaseRun(run.runId, "worker-b1");
    runs.startRun(run.runId);
    expect(runs.failRun(run.runId, "Fehler 1")!.state).toBe("FAILED");
    const retry = runs.scheduleRetry(run.runId)!;
    expect(retry.state).toBe("QUEUED");
    expect(retry.nextAttemptAt).toBeTruthy();
    // Versuch 2 (Budget 2) → danach Dead-Letter statt weiterem Retry.
    runs.leaseRun(run.runId, "worker-b2");
    runs.startRun(run.runId);
    runs.failRun(run.runId, "Fehler 2");
    const dead = runs.scheduleRetry(run.runId)!;
    expect(dead.state).toBe("DEAD_LETTER");
    expect(dead.deadLetterReason).toContain("retry budget exhausted");
  });

  it("erkennt abgelaufene Run-Leases und plant den Run neu ein", async () => {
    const run = freshRun("stale");
    runs.queueRun(run.runId);
    runs.leaseRun(run.runId, "worker-stale-run", 1);
    await wait(15);
    const stale = runs.expireStaleRuns();
    expect(stale).toContain(run.runId);
    const after = runs.getRun(run.runId)!;
    expect(after.state).toBe("QUEUED");
    expect(after.error).toBe("lease expired");
    expect(after.workerId).toBeUndefined();
    expect(after.nextAttemptAt).toBeTruthy();
  });

  it("führt den Diagnose- und Recovery-Pfad bis zur bestandenen Verifikation", () => {
    const run = freshRun("recovery");
    runs.queueRun(run.runId);
    runs.leaseRun(run.runId, "worker-diag");
    runs.startRun(run.runId);
    runs.failRun(run.runId, "Diagnosepfad-Testfehler");
    expect(runs.beginDiagnosis(run.runId)!.state).toBe("DIAGNOSING");
    expect(runs.recordRootCause(run.runId, "bekannte Testursache")!.state).toBe("ROOT_CAUSE_FOUND");
    expect(runs.getRun(run.runId)!.rootCause).toContain("bekannte Testursache");
    expect(runs.beginRecovery(run.runId)!.state).toBe("RECOVERING");
    expect(runs.beginVerification(run.runId)!.state).toBe("VERIFYING");
    // Heartbeat ist auch in der Verifikation möglich (Behandlung läuft).
    expect(runs.heartbeatRun(run.runId)!.lastHeartbeatAt).toBeTruthy();
    expect(runs.completeRun(run.runId)!.state).toBe("SUCCEEDED");
  });

  it("dokumentiert einen Rollback mit Artefakt und erlaubt danach das Wiedereinreihen", () => {
    const run = freshRun("rollback");
    runs.queueRun(run.runId);
    runs.leaseRun(run.runId, "worker-rb");
    runs.startRun(run.runId);
    runs.failRun(run.runId, "Rollback-Testfehler");
    const rolled = runs.rollbackRun(run.runId, "ART-ROLLBACK-1")!;
    expect(rolled.state).toBe("ROLLED_BACK");
    expect(rolled.rollbackArtifactId).toBe("ART-ROLLBACK-1");
    expect(runs.canTransitionRun("ROLLED_BACK", "QUEUED")).toBe(true);
  });
});
