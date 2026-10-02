import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

type Fixture = {
  computerId: string;
  taskId: string;
  sandboxId: string;
  capabilityTokenId: string;
  computers: typeof import("../../lib/computer-use");
  authority: typeof import("../../lib/authority");
  broker: typeof import("../../lib/execution-broker");
};

let root: string;
let fixture: Fixture;

async function setupFixture(driverPath?: string, computerTaskId?: string, computerSandboxId?: string): Promise<Fixture> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-computer-broker-"));
  process.env.BOB_STORAGE_DIR = root;
  process.env.BOB_SANDBOX_RUNTIME = "local";
  process.env.BOB_NS_ISOLATION = "off";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  if (driverPath) process.env.BOB_COMPUTER_DRIVER = driverPath;
  else delete process.env.BOB_COMPUTER_DRIVER;
  vi.resetModules();

  const bootstrap = await import("../../lib/bootstrap");
  const cp = await import("../../lib/control-plane");
  const fabric = await import("../../lib/sandbox/fabric");
  const computers = await import("../../lib/computer-use");
  const authority = await import("../../lib/authority");
  const broker = await import("../../lib/execution-broker");

  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Computer Broker Test"});
  // Computer use is not part of the default SYSTEM-WORKER delegation. It is
  // deliberately added here as a Creator-authorized, explicit extra scope.
  authority.addAuthorityEdge({
    id: `EDGE-COMPUTER-${Date.now()}`,
    from: "CREATOR",
    to: "SYSTEM-WORKER",
    kind: "DELEGATES",
    capabilities: ["task:execute", "sandbox:run", "computer:execute"],
    maxRisk: "HIGH",
    expiresAt: null
  }, "CREATOR");

  const mission = cp.createMission({title: "Computer broker", objective: "Computer actions via broker", createdBy: "CREATOR"});
  const task = cp.createTask({
    missionId: mission.missionId,
    title: "Browser action",
    risk: "LOW",
    assignedAgent: "AG-BROWSER",
    createdBy: "CREATOR"
  });
  const sandbox = await fabric.createSandbox({type: "browser", taskId: task.taskId, agentId: "AG-BROWSER", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);

  const computer = computers.listComputers()[0];
  computers.authorizeComputer(computer.id, true, "CREATOR");
  computers.allocateComputer(computer.id, computerTaskId ?? task.taskId, computerSandboxId ?? sandbox.sandboxId);
  computers.startComputer(computer.id);

  const capability = authority.ensureExecutionCapability(
    "AG-BROWSER",
    task.taskId,
    sandbox.sandboxId,
    "LOW",
    "browser",
    ["computer:execute"]
  );
  return {
    computerId: computer.id,
    taskId: task.taskId,
    sandboxId: sandbox.sandboxId,
    capabilityTokenId: capability.id,
    computers,
    authority,
    broker
  };
}

beforeEach(async () => {
  fixture = await setupFixture();
});

describe("Computer Use durch den Execution Broker", () => {
  it("führt eine eng gebundene Computer-Aktion mit einer einmaligen Capability aus", async () => {
    const driver = path.join(root, "driver.mjs");
    fs.writeFileSync(
      driver,
      'process.stdin.on("data",b=>{const x=JSON.parse(String(b)); process.stdout.write(JSON.stringify({ok:true,action:x.action})); process.exit(0);});'
    );
    fs.chmodSync(driver, 0o700);
    process.env.BOB_COMPUTER_DRIVER = driver;
    // Das erste Fixture wurde ohne Treiber initialisiert. Ein neuer, sauberer
    // Fixture stellt sicher, dass Stores und Runtime alle auf denselben Root zeigen.
    fixture = await setupFixture(driver);

    const result = await fixture.broker.executeComputerAuthorized({
      taskId: fixture.taskId,
      agentId: "AG-BROWSER",
      sandboxId: fixture.sandboxId,
      capabilityTokenId: fixture.capabilityTokenId,
      runId: "RUN-CU-BROKER",
      environment: "browser",
      argv: ["COMPUTER_USE"],
      computerId: fixture.computerId,
      computerAction: "SCREENSHOT",
      computerInput: {target: "test"}
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.accepted).toBe(true);
    expect(result.output).toEqual({ok: true, action: "SCREENSHOT"});
    expect(result.evidence?.verified).toBe(true);
    expect(fixture.authority.getCapabilityToken(fixture.capabilityTokenId)?.uses).toBe(1);
    expect(fixture.computers.getComputer(fixture.computerId)?.state).toBe("ALLOCATED");
  });

  it("weist eine fremde Task-/Sandbox-Allokation vor Token-Verbrauch ab", async () => {
    fixture = await setupFixture(undefined, "OTHER-TASK", "SB-OTHER");

    await expect(fixture.broker.executeComputerAuthorized({
      taskId: fixture.taskId,
      agentId: "AG-BROWSER",
      sandboxId: fixture.sandboxId,
      capabilityTokenId: fixture.capabilityTokenId,
      argv: ["COMPUTER_USE"],
      computerId: fixture.computerId,
      computerAction: "SCREENSHOT",
      computerInput: {}
    })).rejects.toThrow(/different task/);

    expect(fixture.authority.getCapabilityToken(fixture.capabilityTokenId)?.uses).toBe(0);
  });

  it("leakt Computer-Eingaben weder in Audit noch in Events oder Evidence", async () => {
    const driver = path.join(root, "driver.mjs");
    fs.writeFileSync(driver, 'process.stdin.on("data",()=>process.stdout.write(JSON.stringify({ok:true})));');
    fixture = await setupFixture(driver);

    const marker = "private-computer-input-marker";
    const result = await fixture.broker.executeComputerAuthorized({
      taskId: fixture.taskId,
      agentId: "AG-BROWSER",
      sandboxId: fixture.sandboxId,
      capabilityTokenId: fixture.capabilityTokenId,
      argv: ["COMPUTER_USE"],
      computerId: fixture.computerId,
      computerAction: "TYPE",
      computerInput: {text: marker}
    });
    const artifacts = await import("../../lib/artifacts");
    const audit = await import("../../lib/audit");
    const events = await import("../../lib/events/log");
    const evidence = artifacts.getArtifact(result.evidence!.artifactId)!;

    expect(evidence.content).not.toContain(marker);
    expect(JSON.stringify(audit.auditSnapshot(100))).not.toContain(marker);
    expect(JSON.stringify(events.listDomainEvents({limit: 100}))).not.toContain(marker);
    expect(evidence.content).toContain("inputDigest");
  });
});
