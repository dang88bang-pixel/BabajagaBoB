import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("int-sandbox");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let verification: typeof import("../../lib/verification");
let runtimeFactory: typeof import("../../lib/runtime-factory");

async function makeTask(agentId = "AG-BUILD") {
  const mission = cp.createMission({title: "Integration", objective: "Sandbox prüfen", createdBy: "CREATOR"});
  return cp.createTask({missionId: mission.missionId, title: "Sandbox-Task", risk: "LOW", assignedAgent: agentId, createdBy: "CREATOR"});
}

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  verification = await import("../../lib/verification");
  runtimeFactory = await import("../../lib/runtime-factory");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("Sandbox-Fabric mit lokaler Runtime (REAL_LOCAL)", () => {
  it("erstellt eine an Task und Agent gebundene Sandbox", async () => {
    const task = await makeTask();
    const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    expect(sandbox.taskId).toBe(task.taskId);
    expect(sandbox.agentId).toBe("AG-BUILD");
    expect(sandbox.runtimeMode).toBe("real-local");
    expect(sandbox.network).toBe("DENY");
    const bound = fabric.assertTaskSandboxBinding(task.taskId, sandbox.sandboxId);
    expect(bound.task.taskId).toBe(task.taskId);
    expect(bound.sandbox.sandboxId).toBe(sandbox.sandboxId);
    expect(() => fabric.assertTaskSandboxBinding("TASK-9999", sandbox.sandboxId)).toThrow();
  });

  it("führt argv im Sandbox-Workspace aus (Smoketest)", async () => {
    const task = await makeTask();
    const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const smoke = await verification.runSmokeTest(sandbox.sandboxId);
    expect(smoke.accepted).toBe(true);
  });

  it("erstellt einen Snapshot mit Digest und verifiziert ihn", async () => {
    const task = await makeTask();
    const sandbox = await fabric.createSandbox({type: "recovery", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const snapshot = await fabric.snapshotSandbox(sandbox.sandboxId, "AG-BUILD");
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);
    const result = await verification.verifySandboxState({sandboxId: sandbox.sandboxId, snapshotId: snapshot.snapshotId, requireRegression: false});
    expect(result.acceptance).toBe("ACCEPT");
    expect(result.checks.some(check => check.kind === "SMOKE" && check.accepted)).toBe(true);
  });

  it("verweigert ALLOWLIST-Netzwerke (fail closed)", async () => {
    const task = await makeTask();
    await expect(
      fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", network: "ALLOWLIST"})
    ).rejects.toThrow();
  });

  it("verweigert Sandbox-Erstellung für nicht zugeordnete Agenten", async () => {
    const task = await makeTask("AG-BUILD");
    await expect(fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-QA", risk: "LOW"})).rejects.toThrow();
  });

  it("nutzt die konfigurierte Runtime (kein Mock im Test)", () => {
    expect(runtimeFactory.activeSandboxRuntime.mode).toBe("REAL_LOCAL");
  });
});
