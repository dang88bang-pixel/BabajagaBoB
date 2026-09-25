import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("int-load-broker");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let audit: typeof import("../../lib/audit");
let runs: typeof import("../../lib/runs");

const AGENT = "AG-BUILD";
const PARALLEL = 12;

/**
 * Belastungsprüfung (begrenzt, kein SLO-Nachweis): unter Nebenläufigkeit darf die
 * Autorisierungsgrenze nicht weicher werden. Geprüft wird, dass
 *  - jede parallele Ausführung durch den Broker geht (kein Bypass),
 *  - Bindung pro Sandbox/Token erhalten bleibt (keine Vermischung),
 *  - die Audit-Kette integer bleibt,
 *  - eine nicht autorisierte Ausführung auch unter Last verweigert wird.
 *
 * Die Aussage ist bewusst begrenzt: 12 parallele Läufe in einer Sandbox-Umgebung
 * ersetzen keinen Lasttest mit definierten SLOs.
 */
describe("Belastung: parallele autorisierte Ausführungen", () => {
  beforeAll(async () => {
    vi.resetModules();
    bootstrap = await import("../../lib/bootstrap");
    cp = await import("../../lib/control-plane");
    fabric = await import("../../lib/sandbox/fabric");
    authority = await import("../../lib/authority");
    broker = await import("../../lib/execution-broker");
    audit = await import("../../lib/audit");
    runs = await import("../../lib/runs");
    bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
  });

  it("führt 12 Läufe parallel aus, ohne die Autorisierung zu lockern", async () => {
    const mission = cp.createMission({title: "Last-Mission", objective: "Nebenläufigkeit prüfen", createdBy: "CREATOR"});
    expect(mission.missionId).toMatch(/^MIS-/);

    const contexts = [];
    for (let index = 0; index < PARALLEL; index += 1) {
      const task = cp.createTask({
        missionId: mission.missionId,
        title: `Last-Task ${index}`,
        risk: "LOW",
        assignedAgent: AGENT,
        createdBy: "CREATOR"
      });
      const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: AGENT, risk: "LOW"});
      await fabric.startSandbox(sandbox.sandboxId);
      const run = runs.createRun({taskId: task.taskId, agentId: AGENT, risk: "LOW", sandboxId: sandbox.sandboxId});
      const issued = authority.issueCapabilityToken({
        subject: AGENT,
        taskId: task.taskId,
        sandboxId: sandbox.sandboxId,
        environment: "test",
        capabilities: ["task:execute", "sandbox:run"],
        risk: "LOW",
        issuedBy: "CREATOR",
        issuedByKind: "CREATOR",
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
      });
      contexts.push({taskId: task.taskId, sandboxId: sandbox.sandboxId, runId: run.runId, tokenId: issued.token.id});
    }

    const results = await Promise.all(
      contexts.map((context, index) =>
        broker.executeAuthorized({
          taskId: context.taskId,
          agentId: AGENT,
          sandboxId: context.sandboxId,
          runId: context.runId,
          capabilityTokenId: context.tokenId,
          environment: "test",
          argv: ["node", "-e", `process.stdout.write('parallel-${index}')`]
        })
      )
    );

    expect(results.length).toBe(PARALLEL);
    for (const [index, result] of results.entries()) {
      expect(result.accepted).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`parallel-${index}`);
    }

    // Keine Vermischung der Bindungen: jede Sandbox kennt genau ihren Lauf.
    for (const context of contexts) {
      const sandbox = cp.getControlState().sandboxes.find(entry => entry.sandboxId === context.sandboxId);
      expect(sandbox?.taskId).toBe(context.taskId);
    }
    expect(audit.verifyAuditChain().valid).toBe(true);
  }, 120_000);

  it("verweigert einen fremden Sandbox-Bezug auch unter Nebenläufigkeit", async () => {
    const mission = cp.createMission({title: "Last-Mission 2", objective: "Fremdbindung prüfen", createdBy: "CREATOR"});
    const first = cp.createTask({missionId: mission.missionId, title: "Task A", risk: "LOW", assignedAgent: AGENT, createdBy: "CREATOR"});
    const second = cp.createTask({missionId: mission.missionId, title: "Task B", risk: "LOW", assignedAgent: AGENT, createdBy: "CREATOR"});
    const sandboxA = await fabric.createSandbox({type: "test", taskId: first.taskId, agentId: AGENT, risk: "LOW"});
    const sandboxB = await fabric.createSandbox({type: "test", taskId: second.taskId, agentId: AGENT, risk: "LOW"});
    await fabric.startSandbox(sandboxA.sandboxId);
    await fabric.startSandbox(sandboxB.sandboxId);

    const issued = authority.issueCapabilityToken({
      subject: AGENT,
      taskId: first.taskId,
      sandboxId: sandboxA.sandboxId,
      environment: "test",
      capabilities: ["task:execute", "sandbox:run"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });

    const attempts = Array.from({length: 6}, async (_, index) => {
      try {
        const result = await broker.executeAuthorized({
          taskId: index % 2 === 0 ? first.taskId : second.taskId,
          agentId: AGENT,
          // Absichtlich fremde Bindung: Token A darf nicht in Sandbox B ausführen.
          sandboxId: sandboxB.sandboxId,
          capabilityTokenId: issued.token.id,
          environment: "test",
          argv: ["node", "-e", "process.stdout.write('nope')"]
        });
        return {denied: !result.accepted, check: "accepted-false"};
      } catch (error) {
        // Der Broker verweigert hart (ExecutionDeniedError) – genau das ist das Ziel.
        return {denied: true, check: error instanceof Error ? error.name : "unknown"};
      }
    });
    const results = await Promise.all(attempts);
    expect(results.every(result => result.denied)).toBe(true);
    expect(results.every(result => ["ExecutionDeniedError", "accepted-false"].includes(result.check))).toBe(true);
    expect(audit.verifyAuditChain().valid).toBe(true);
  }, 120_000);
});
