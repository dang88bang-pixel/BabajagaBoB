import fs from "node:fs";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Computer Use über den Execution Broker (Abschnitt 21).
 *
 * Die frühere Fassung dieser Datei war **nicht lauffähig**: Sie rief
 * `broker.executeComputerAuthorized` auf (die Funktion existierte nicht), ließ
 * Bootstrap, Task und Sandbox weg und erwartete die Delegation
 * `SYSTEM-WORKER → computer:execute`, die es nicht gab. Der Test hat den
 * fehlenden Ausführungspfad also nur beschrieben, nicht nachgewiesen.
 *
 * Jetzt gilt: Computer Use läuft ausschließlich über den Broker, mit derselben
 * Autorisierung wie eine Prozessausführung plus `computer:execute`. Geprüft wird
 * hier der ganze Weg (Bindung → Capability → Treiberprozess → Evidenz) **und**
 * jede Verweigerung, die dabei fail closed greifen muss.
 */

const root = isolatedStorageRoot("computer-broker");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let computers: typeof import("../../lib/computer-use");
let artifacts: typeof import("../../lib/artifacts");

const DRIVER = path.join(root, "driver.mjs");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  broker = await import("../../lib/execution-broker");
  computers = await import("../../lib/computer-use");
  artifacts = await import("../../lib/artifacts");

  // Treiber als Node-Modul: liest **eine** Aktion als JSON von stdin und
  // schreibt das Ergebnis als JSON auf stdout. Kein Shell-String, kein `sh`.
  fs.writeFileSync(
    DRIVER,
    'process.stdin.on("data",b=>{const x=JSON.parse(String(b));process.stdout.write(JSON.stringify({ok:true,action:x.action,computerId:x.computerId}));process.exit(0);});'
  );
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Computer-Tester"});
});

afterAll(() => {
  delete process.env.BOB_COMPUTER_DRIVER;
});

type Fixture = {
  taskId: string;
  sandboxId: string;
  computerId: string;
  tokenId: string;
};

/** Frischer, vollständig gebundener Kontext: Task → Sandbox → Computer → Token. */
async function fixture(
  label: string,
  capabilities = ["task:execute", "sandbox:run", "computer:execute"],
  bindComputerTo?: {taskId: string; sandboxId: string}
): Promise<Fixture> {
  const mission = cp.createMission({title: `Computer ${label}`, objective: "Computer Use über den Broker", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: `Ziel ${label}`, description: "Nachweis"});
  const task = cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: `Computer-Task ${label}`,
    risk: "LOW",
    assignedAgent: "AG-BUILD",
    createdBy: "CREATOR"
  });
  const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);

  // Jede Prüfung bekommt eine **eigene** Instanz: Eine freigegebene Instanz ist
  // `RELEASED` und wird nicht wieder vergeben (kein Recycling ohne Creator-Akt).
  const computer = computers.registerComputer({
    name: `Browser ${label}`,
    kind: "BROWSER",
    os: "sandbox",
    arch: "x64",
    network: "DENY",
    capabilities: [{kind: "BROWSER", actions: ["NAVIGATE", "CLICK", "TYPE", "SELECT", "SCREENSHOT", "OCR"], environments: ["test"], network: "DENY", risk: "MODERATE"}],
    authorized: false
  });
  computers.authorizeComputer(computer.id, true, "CREATOR");
  computers.allocateComputer(
    computer.id,
    bindComputerTo?.taskId ?? task.taskId,
    bindComputerTo?.sandboxId ?? sandbox.sandboxId
  );

  const token = authority.ensureExecutionCapability(
    "AG-BUILD",
    task.taskId,
    sandbox.sandboxId,
    "LOW",
    "test",
    capabilities.filter(capability => capability !== "task:execute" && capability !== "sandbox:run")
  );
  return {taskId: task.taskId, sandboxId: sandbox.sandboxId, computerId: computer.id, tokenId: token.id};
}

function request(context: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    taskId: context.taskId,
    agentId: "AG-BUILD",
    sandboxId: context.sandboxId,
    capabilityTokenId: context.tokenId,
    computerId: context.computerId,
    computerAction: "SCREENSHOT" as const,
    computerInput: {target: "startseite"},
    environment: "test",
    runId: `RUN-CU-${Date.now().toString(36)}`,
    ...overrides
  } as Parameters<typeof broker.executeComputerAuthorized>[0];
}

describe("Computer Use über den Execution Broker", () => {
  it("führt eine Aktion über den Broker aus, verbraucht genau ein Token und legt Evidenz ab", async () => {
    process.env.BOB_COMPUTER_DRIVER = DRIVER;
    const context = await fixture("Erfolg");

    const result = await broker.executeComputerAuthorized(request(context));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.accepted).toBe(true);
    expect(result.computerId).toBe(context.computerId);
    expect(result.action).toBe("SCREENSHOT");
    expect(JSON.parse(result.stdout).ok).toBe(true);
    expect(authority.getCapabilityToken(context.tokenId)?.uses).toBe(1);

    // Evidenz ist digest-gebunden, der Ausführung zugeordnet und prüfbar.
    const artifact = artifacts.getArtifact(result.evidence!.artifactId)!;
    expect(artifact.kind).toBe("COMPUTER_USE");
    expect(artifact.taskId).toBe(context.taskId);
    expect(artifact.sandboxId).toBe(context.sandboxId);
    expect(artifact.content).toContain("SCREENSHOT");
    expect(result.evidence!.verified).toBe(true);
    expect(artifacts.verifyArtifact(artifact.id).ok).toBe(true);

    // Der Computer ist nach der Ausführung wieder frei, nicht „autorisiert" geblieben.
    expect(computers.listComputers().find(entry => entry.id === context.computerId)?.state).toBe("AVAILABLE");
  });

  it("verweigert einen Computer, der einer anderen Task gehört — ohne das Token zu verbrauchen", async () => {
    process.env.BOB_COMPUTER_DRIVER = DRIVER;
    // Fremdbindung: Der Computer gehört einer anderen Task, das Token dieser Task.
    const other = await fixture("Andere");
    const context = await fixture("Fremdaufgabe", undefined, {taskId: other.taskId, sandboxId: other.sandboxId});

    await expect(broker.executeComputerAuthorized(request(context))).rejects.toThrow(/different task/);
    expect(authority.getCapabilityToken(context.tokenId)?.uses).toBe(0);
  });

  it("verlangt die Fähigkeit computer:execute im Capability-Token", async () => {
    process.env.BOB_COMPUTER_DRIVER = DRIVER;
    const context = await fixture("OhneFaehigkeit", ["task:execute", "sandbox:run"]);

    await expect(broker.executeComputerAuthorized(request(context))).rejects.toThrow(/execution denied/);
    expect(authority.getCapabilityToken(context.tokenId)?.uses).toBe(0);
  });

  it("verweigert eine Aktion, die von der Computer-Fähigkeit nicht gedeckt ist", async () => {
    process.env.BOB_COMPUTER_DRIVER = DRIVER;
    const context = await fixture("Fremdaktion");

    // `TERMINAL_EXECUTE` gehört nicht zur Browser-Fähigkeit der Default-Instanz.
    await expect(broker.executeComputerAuthorized(request(context, {computerAction: "TERMINAL_EXECUTE"}))).rejects.toThrow(/not granted/);
    expect(authority.getCapabilityToken(context.tokenId)?.uses).toBe(0);
  });

  it("meldet ohne konfigurierten Treiber nichts als ausgeführt (fail closed)", async () => {
    const context = await fixture("OhneTreiber");
    delete process.env.BOB_COMPUTER_DRIVER;

    await expect(broker.executeComputerAuthorized(request(context))).rejects.toThrow(/no computer driver/);
    expect(authority.getCapabilityToken(context.tokenId)?.uses).toBe(0);
    expect(computers.listComputers().find(entry => entry.id === context.computerId)?.state).toBe("ALLOCATED");
  });

  it("lehnt eine Shell als Treiber ab", async () => {
    const context = await fixture("ShellTreiber");
    process.env.BOB_COMPUTER_DRIVER = "/bin/bash";

    await expect(broker.executeComputerAuthorized(request(context))).rejects.toThrow(/shell interpreter|node module/);
    expect(authority.getCapabilityToken(context.tokenId)?.uses).toBe(0);
  });
});
