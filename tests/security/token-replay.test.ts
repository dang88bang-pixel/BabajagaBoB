import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Wiederholungssperre für Capability-Token (Abschnitt 15/37).
 *
 * Eine Autorisierung ist **eine** Ausführung. Das Token wird vor dem Start
 * verbraucht; ein zweiter Lauf mit demselben Token ist ein Replay und wird
 * verweigert — mit Audit-DENY und Verweigerungsevidenz, nicht nur mit einer
 * Fehlermeldung. Mehrfachverwendung ist explizit (`maxUses`) und begrenzt.
 */

const root = isolatedStorageRoot("token-replay");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let artifacts: typeof import("../../lib/artifacts");
let audit: typeof import("../../lib/audit");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  broker = await import("../../lib/execution-broker");
  artifacts = await import("../../lib/artifacts");
  audit = await import("../../lib/audit");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Replay-Tester"});
  expect(root).toContain("token-replay");
});

async function prepare(label: string, maxUses?: number) {
  const mission = cp.createMission({title: `Replay ${label}`, objective: "Replay-Schutz", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: `R-${label}`, description: "Replay"});
  const task = cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: `Replay-Task ${label}`,
    risk: "LOW",
    assignedAgent: "AG-BUILD",
    createdBy: "CREATOR"
  });
  const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  const token = authority.issueCapabilityToken({
    subject: "AG-BUILD",
    taskId: task.taskId,
    sandboxId: sandbox.sandboxId,
    environment: "test",
    capabilities: ["task:execute", "sandbox:run"],
    risk: "LOW",
    issuedBy: "CREATOR",
    issuedByKind: "CREATOR",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    ...(maxUses === undefined ? {} : {maxUses})
  });
  return {task, sandbox, token, maxUses};
}

function run(prepared: Awaited<ReturnType<typeof prepare>>, marker: string) {
  return broker.executeAuthorized({
    taskId: prepared.task.taskId,
    agentId: "AG-BUILD",
    sandboxId: prepared.sandbox.sandboxId,
    capabilityTokenId: prepared.token.token.id,
    environment: "test",
    argv: ["node", "-e", `process.stdout.write('${marker}')`]
  });
}

describe("Capability-Token: Wiederholungssperre", () => {
  it("verweigert den zweiten Lauf mit demselben Token und legt Evidenz an", async () => {
    const prepared = await prepare("einfach");
    const first = await run(prepared, "einmal");
    expect(first.accepted).toBe(true);
    expect(first.stdout).toBe("einmal");

    await expect(run(prepared, "zweimal")).rejects.toThrow(/already used|replay/i);

    // Verbrauch ist persistiert und sichtbar.
    const token = authority.capabilityTokens().find(entry => entry.id === prepared.token.token.id);
    expect(token?.uses).toBe(1);
    expect(token?.maxUses).toBe(1);

    // Die Verweigerung ist nachweisbar: Audit-DENY + Verweigerungsevidenz.
    const records = audit.auditSnapshot(200).filter(record => record.resource === prepared.sandbox.sandboxId && record.decision === "DENY");
    expect(records.length).toBeGreaterThan(0);
    const denials = artifacts.artifactSnapshot({kind: "DENIAL", taskId: prepared.task.taskId});
    expect(denials.length).toBeGreaterThan(0);
    // Der Replay wird auf zwei Ebenen erkannt (Token-Validierung und Verbrauch);
    // beide Wege nennen den Grund „replay“ und halten ihn als Evidenz fest.
    const replayEvidence = denials.filter(entry => /replay/i.test(entry.content));
    expect(replayEvidence.length).toBeGreaterThan(0);
    expect(replayEvidence[0].content).toMatch(/TOKEN_REPLAY|token exhausted/);
    expect(audit.verifyAuditChain().valid).toBe(true);
  }, 60_000);

  it("erlaubt genau die ausdrücklich freigegebene Anzahl von Verwendungen", async () => {
    const prepared = await prepare("dreifach", 3);
    for (const marker of ["a", "b", "c"]) {
      const result = await run(prepared, marker);
      expect(result.accepted).toBe(true);
      expect(result.stdout).toBe(marker);
    }
    await expect(run(prepared, "d")).rejects.toThrow(/already used|replay/i);
    expect(authority.capabilityTokens().find(entry => entry.id === prepared.token.token.id)?.uses).toBe(3);
  }, 60_000);

  it("gibt bei paralleler Ausführung genau eine Autorisierung frei", async () => {
    const prepared = await prepare("parallel");
    const outcomes = await Promise.allSettled([run(prepared, "p1"), run(prepared, "p2"), run(prepared, "p3")]);
    const accepted = outcomes.filter(outcome => outcome.status === "fulfilled").length;
    expect(accepted).toBe(1);
    expect(authority.capabilityTokens().find(entry => entry.id === prepared.token.token.id)?.uses).toBe(1);
  }, 60_000);

  it("trennt Vorprüfung (Gate) und Verbrauch (Broker) sauber", async () => {
    const prepared = await prepare("vorpruefung");
    await run(prepared, "once");
    const id = prepared.token.token.id;
    // Das API-Gate prüft Authentizität und Scope — nicht den Verbrauch.
    const precheck = authority.precheckCapabilityToken(id, ["task:execute", "sandbox:run"], {
      taskId: prepared.task.taskId,
      sandboxId: prepared.sandbox.sandboxId,
      environment: "test"
    });
    expect(precheck.valid).toBe(true);
    // Der Verbrauch wird ausschließlich im Broker durchgesetzt (eine Stelle, dort Evidenz).
    const full = authority.validateCapabilityToken(id, ["task:execute", "sandbox:run"], {
      taskId: prepared.task.taskId,
      sandboxId: prepared.sandbox.sandboxId,
      environment: "test"
    });
    expect(full.valid).toBe(false);
    expect(full.reason).toMatch(/exhausted/);
  }, 60_000);

  it("weist unsinnige Nutzungsgrenzen bei der Ausstellung ab", () => {
    const base = {
      subject: "AG-BUILD",
      taskId: "TASK-egal",
      sandboxId: "SB-egal",
      environment: "test",
      capabilities: ["task:execute"],
      risk: "LOW" as const,
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR" as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    for (const maxUses of [0, -1, 1.5, authority.MAX_TOKEN_USES + 1]) {
      expect(() => authority.issueCapabilityToken({...base, maxUses})).toThrow(/maxUses/);
    }
  });
});
