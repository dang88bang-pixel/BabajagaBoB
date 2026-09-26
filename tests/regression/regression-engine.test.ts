import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("reg-engine");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let regression: typeof import("../../lib/regression");

async function makeSandbox(type: "test" | "recovery" = "test") {
  const mission = cp.createMission({title: "Regression", objective: "Fehler dauerhaft absichern", createdBy: "CREATOR"});
  const task = cp.createTask({missionId: mission.missionId, title: "Regression-Task", risk: "LOW", assignedAgent: "AG-QA", createdBy: "CREATOR"});
  const sandbox = await fabric.createSandbox({type, taskId: task.taskId, agentId: "AG-QA", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  return sandbox;
}

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  regression = await import("../../lib/regression");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("Regression Engine", () => {
  it("verweigert Shell-Metazeichen in argv (kein Shell-String)", () => {
    expect(() =>
      regression.registerRegressionTest({
        name: "ungültig",
        description: "Shell-String statt argv",
        argv: ["sh", "-c", "echo ok; rm -rf /"],
        createdBy: "AG-QA"
      })
    ).toThrow();
  });

  it("registriert einen Regressionstest und lässt ihn im Sandbox laufen", async () => {
    const sandbox = await makeSandbox();
    const test = regression.registerRegressionTest({
      name: "smoke regression",
      description: "Prozessausführung im Sandbox muss erfolgreich sein",
      argv: ["node", "-e", "process.stdout.write('reg-ok')"],
      createdBy: "AG-QA"
    });
    expect(test.regressionId).toMatch(/^REG-/);
    const run = await regression.runRegressionTest(test.regressionId, sandbox.sandboxId);
    expect(run.accepted).toBe(true);
    expect(regression.regressionStatus()[test.regressionId]).toBe("PASS");
  });

  it("erkennt einen fehlschlagenden Regressionstest", async () => {
    const sandbox = await makeSandbox("recovery");
    const test = regression.registerRegressionTest({
      name: "failure regression",
      description: "Fehlerfall muss als FAIL erkannt werden",
      argv: ["node", "-e", "process.exit(3)"],
      createdBy: "AG-QA"
    });
    const run = await regression.runRegressionTest(test.regressionId, sandbox.sandboxId);
    expect(run.accepted).toBe(false);
    expect(regression.regressionStatus()[test.regressionId]).toBe("FAIL");
  });

  it("wertet eine Suite mit einem Fehlschlag als nicht bestanden", async () => {
    const sandbox = await makeSandbox("recovery");
    const suite = await regression.runRegressionSuite(sandbox.sandboxId);
    expect(suite.total).toBeGreaterThan(0);
    expect(suite.passed).toBe(false);
    expect(suite.failed.length).toBeGreaterThan(0);
  });

  it("persistiert Registrierung und Status im Store", () => {
    expect(regression.regressionStoreReport().ok).toBe(true);
  });
});
