import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Computer Use über den zentralen Broker (Abschnitt 24/10).
 *
 * Geprüft wird, dass Computer-Aktionen **keinen** eigenen Ausführungspfad haben:
 * sie laufen durch Gate, Broker, Replay-Sperre und Evidenz wie jede
 * Sandbox-Ausführung. Ohne Treiber ist Computer Use verweigert, nicht simuliert.
 *
 * Drei Nachweise:
 *  1. autorisierte Aktion über einen echten Treiberprozess (stdin/stdout-JSON),
 *  2. Fremdbindung (andere Task) wird **vor** dem Verbrauch des Tokens verweigert,
 *  3. fehlender Treiber ist fail closed (keine Ausführung, keine Evidenz „erfolgreich").
 */

const root = isolatedStorageRoot("computer-broker");

type Modules = {
  bootstrap: typeof import("../../lib/bootstrap");
  cp: typeof import("../../lib/control-plane");
  fabric: typeof import("../../lib/sandbox/fabric");
  authority: typeof import("../../lib/authority");
  broker: typeof import("../../lib/execution-broker");
  computers: typeof import("../../lib/computer-use");
  audit: typeof import("../../lib/audit");
};

let m: Modules;

beforeAll(async () => {
  vi.resetModules();
  m = {
    bootstrap: await import("../../lib/bootstrap"),
    cp: await import("../../lib/control-plane"),
    fabric: await import("../../lib/sandbox/fabric"),
    authority: await import("../../lib/authority"),
    broker: await import("../../lib/execution-broker"),
    computers: await import("../../lib/computer-use"),
    audit: await import("../../lib/audit")
  };
  expect(root).toContain("computer-broker");
  m.bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Computer-Tester"});
});

/** Legt Mission, Objective, Task und Sandbox an — die Bindungskette des Brokers. */
async function prepareTask(label: string): Promise<{taskId: string; sandboxId: string}> {
  const mission = m.cp.createMission({title: `Computer ${label}`, objective: "Computer Use über den Broker", createdBy: "CREATOR"});
  const objective = m.cp.createObjective({missionId: mission.missionId, title: `OBJ-${label}`, description: "Computer Use"});
  const task = m.cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: `Computer-Task ${label}`,
    risk: "MODERATE",
    assignedAgent: "AG-BUILD",
    createdBy: "CREATOR"
  });
  const sandbox = await m.fabric.createSandbox({type: "browser", taskId: task.taskId, agentId: "AG-BUILD", risk: "MODERATE"});
  await m.fabric.startSandbox(sandbox.sandboxId);
  return {taskId: task.taskId, sandboxId: sandbox.sandboxId};
}

/** Erzeugt einen echten Treiber: JSON auf stdin, JSON auf stdout. */
function writeDriver(name: string, script?: string): string {
  const driver = path.join(root, name);
  fs.writeFileSync(
    driver,
    script ??
      [
        "let raw = '';",
        "process.stdin.on('data', chunk => { raw += String(chunk); });",
        "process.stdin.on('end', () => {",
        "  const request = JSON.parse(raw);",
        "  process.stdout.write(JSON.stringify({ok: true, action: request.action, target: request.input?.target ?? null}));",
        "  process.exit(0);",
        "});"
      ].join("\n"),
    {encoding: "utf8", mode: 0o700}
  );
  fs.chmodSync(driver, 0o700);
  return driver;
}

describe("Computer Use through Execution Broker", () => {
  it("issues a scoped computer capability and executes only through the broker", async () => {
    process.env.BOB_COMPUTER_DRIVER = writeDriver("driver.mjs");
    const computers = m.computers;
    const authority = m.authority;
    const broker = m.broker;

    const {taskId, sandboxId} = await prepareTask("1");
    const computer = computers.listComputers()[0];
    computers.authorizeComputer(computer.id, true, "CREATOR");
    computers.allocateComputer(computer.id, taskId, sandboxId);
    computers.startComputer(computer.id);

    const capability = authority.ensureExecutionCapability("AG-BUILD", taskId, sandboxId, "MODERATE", "browser", [
      "computer:execute"
    ]);

    const result = await broker.executeComputerAuthorized({
      taskId,
      agentId: "AG-BUILD",
      sandboxId,
      capabilityTokenId: capability.id,
      runId: "RUN-CU-BROKER",
      environment: "browser",
      argv: ["COMPUTER_USE"],
      computerId: computer.id,
      computerAction: "SCREENSHOT",
      computerInput: {target: "test"}
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.accepted).toBe(true);
    // Der Treiber hat die Aktion wirklich erhalten (kein simulierter Erfolg).
    expect(result.computer.response?.action).toBe("SCREENSHOT");
    expect(result.computer.response?.target).toBe("test");
    // Evidenz ist digest-geprüft und nachgewiesen — ohne Broker-Pfad gäbe es sie nicht.
    expect(result.evidence?.artifactId).toMatch(/^ART-/);
    expect(result.evidence?.verified).toBe(true);
    // Genau eine Autorisierung = eine Ausführung.
    expect(authority.getCapabilityToken(capability.id)?.uses).toBe(1);
  });

  it("rejects a computer allocated to another task before consuming the capability", async () => {
    const computers = m.computers;
    const authority = m.authority;
    const broker = m.broker;

    const {taskId, sandboxId} = await prepareTask("2");

    // Eine zweite Instanz, ausdrücklich einer **anderen** Task zugeordnet.
    const other = computers.registerComputer({
      name: "Andere Browser-Instanz",
      kind: "BROWSER",
      os: "sandbox",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "BROWSER", actions: ["SCREENSHOT"], environments: ["browser"], network: "DENY", risk: "MODERATE"}]
    });
    computers.authorizeComputer(other.id, true, "CREATOR");
    computers.allocateComputer(other.id, "OTHER-TASK", "SB-OTHER");
    computers.startComputer(other.id);

    const capability = authority.ensureExecutionCapability("AG-BUILD", taskId, sandboxId, "MODERATE", "browser", [
      "computer:execute"
    ]);

    await expect(
      broker.executeComputerAuthorized({
        taskId,
        agentId: "AG-BUILD",
        sandboxId,
        capabilityTokenId: capability.id,
        environment: "browser",
        argv: ["COMPUTER_USE"],
        computerId: other.id,
        computerAction: "SCREENSHOT",
        computerInput: {}
      })
    ).rejects.toThrow(/different task/);

    // Die Fremdbindung darf kein gültiges Token verbrauchen.
    expect(authority.getCapabilityToken(capability.id)?.uses).toBe(0);
  });

  it("stays fail closed when no driver is configured", async () => {
    const computers = m.computers;
    const authority = m.authority;
    const broker = m.broker;

    const previous = process.env.BOB_COMPUTER_DRIVER;
    delete process.env.BOB_COMPUTER_DRIVER;
    try {
      expect(broker.computerDriverStatus().configured).toBe(false);

      const {taskId, sandboxId} = await prepareTask("3");
      // Eigene Instanz: die Seed-Instanz ist aus Test 1 noch im Zustand
      // EXECUTING und damit nicht erneut allokierbar.
      const computer = computers.registerComputer({
        name: "Instanz ohne Treiber",
        kind: "BROWSER",
        os: "sandbox",
        arch: "x64",
        network: "DENY",
        capabilities: [{kind: "BROWSER", actions: ["SCREENSHOT"], environments: ["browser"], network: "DENY", risk: "MODERATE"}]
      });
      computers.authorizeComputer(computer.id, true, "CREATOR");
      computers.allocateComputer(computer.id, taskId, sandboxId);
      computers.startComputer(computer.id);

      const capability = authority.ensureExecutionCapability("AG-BUILD", taskId, sandboxId, "MODERATE", "browser", [
        "computer:execute"
      ]);

      await expect(
        broker.executeComputerAuthorized({
          taskId,
          agentId: "AG-BUILD",
          sandboxId,
          capabilityTokenId: capability.id,
          environment: "browser",
          argv: ["COMPUTER_USE"],
          computerId: computer.id,
          computerAction: "SCREENSHOT"
        })
      ).rejects.toThrow(/COMPUTER_DRIVER/);

      expect(authority.getCapabilityToken(capability.id)?.uses).toBe(0);
    } finally {
      if (previous !== undefined) process.env.BOB_COMPUTER_DRIVER = previous;
    }
  });

  it("rejects an action the computer does not support", async () => {
    process.env.BOB_COMPUTER_DRIVER = writeDriver("driver-unsupported.mjs");
    const computers = m.computers;
    const authority = m.authority;
    const broker = m.broker;

    const {taskId, sandboxId} = await prepareTask("4");
    // CLI-Instanz ohne Terminal-Fähigkeit: TERMINAL_EXECUTE ist nicht erlaubt.
    const cli = computers.registerComputer({
      name: "CLI-Instanz",
      kind: "CLI",
      os: "linux",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "CLI", actions: ["FILE_READ"], environments: ["browser"], network: "DENY", risk: "LOW"}]
    });
    computers.authorizeComputer(cli.id, true, "CREATOR");
    computers.allocateComputer(cli.id, taskId, sandboxId);
    computers.startComputer(cli.id);

    const capability = authority.ensureExecutionCapability("AG-BUILD", taskId, sandboxId, "MODERATE", "browser", [
      "computer:execute"
    ]);

    await expect(
      broker.executeComputerAuthorized({
        taskId,
        agentId: "AG-BUILD",
        sandboxId,
        capabilityTokenId: capability.id,
        environment: "browser",
        argv: ["COMPUTER_USE"],
        computerId: cli.id,
        computerAction: "TERMINAL_EXECUTE"
      })
    ).rejects.toThrow(/COMPUTER_ACTION/);

    expect(authority.getCapabilityToken(capability.id)?.uses).toBe(0);
  });
});
