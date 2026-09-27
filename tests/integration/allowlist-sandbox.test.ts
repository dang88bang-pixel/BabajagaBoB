import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * ALLOWLIST-Sandbox über die kontrollierte Ausgangsschicht.
 *
 * Der Punkt dieser Suite ist die **Umkehrung** der Freigabe: Ohne Allowlist
 * bleibt `ALLOWLIST` fail closed (wie vorher), und mit Allowlist ist der Proxy
 * der einzige Ausgang — der Prozess erhält die Proxy-Variablen und keinen
 * direkten Weg. Ein direkter Netzzugriff entsteht durch die Freigabe nie.
 */

const root = isolatedStorageRoot("allowlist-sandbox");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let egress: typeof import("../../lib/egress-proxy");

// Einmal je Suite: Der Bootstrap ist ausdrücklich einmalig (ein zweiter Aufruf
// wird verweigert). Die Module teilen sich deshalb das Storage-Root.
beforeAll(async () => {
  process.env.BOB_STORAGE_DIR = root;
  process.env.BOB_SANDBOX_RUNTIME = "local";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  process.env.BOB_NS_ISOLATION = "off";
  const modules = await Promise.all([
    import("../../lib/bootstrap"),
    import("../../lib/control-plane"),
    import("../../lib/sandbox/fabric"),
    import("../../lib/authority"),
    import("../../lib/execution-broker"),
    import("../../lib/egress-proxy")
  ]);
  [bootstrap, cp, fabric, authority, broker, egress] = modules;
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Egress-Tester"});
});

beforeEach(async () => {
  delete process.env.BOB_EGRESS_ALLOWLIST;
  await egress.stopEgressProxy();
});

afterEach(async () => {
  await egress.stopEgressProxy();
  delete process.env.BOB_EGRESS_ALLOWLIST;
});

afterAll(() => {
  delete process.env.BOB_STORAGE_DIR;
});

async function prepareTask(label: string) {
  const mission = cp.createMission({title: `Egress ${label}`, objective: "Ausgangsverkehr", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: `OBJ-${label}`, description: "Egress"});
  const task = cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: `Egress-Task ${label}`,
    risk: "LOW",
    assignedAgent: "AG-BUILD",
    createdBy: "CREATOR"
  });
  return {task};
}

describe("ALLOWLIST-Sandbox", () => {
  it("bleibt ohne Allowlist fail closed (Sandbox entsteht nicht)", async () => {
    const {task} = await prepareTask("A");
    await expect(
      fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", network: "ALLOWLIST"})
    ).rejects.toThrow(/fail-closed/);
    // Auch über eine Zielangabe ohne Allowlist entsteht kein Zugriff.
    await expect(
      fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW", allowlist: ["example.com:443"]})
    ).rejects.toThrow(/fail-closed/);
  });

  it("erlaubt ALLOWLIST nur mit konfigurierter Egress-Allowlist", async () => {
    process.env.BOB_EGRESS_ALLOWLIST = "example.com:443";
    const {task} = await prepareTask("B");
    const sandbox = await fabric.createSandbox({
      type: "test",
      taskId: task.taskId,
      agentId: "AG-BUILD",
      risk: "LOW",
      network: "ALLOWLIST"
    });
    expect(sandbox.network).toBe("ALLOWLIST");
    const handle = (await import("../../lib/runtime-factory")).runtimeHandle(sandbox.sandboxId);
    expect(handle?.network.mode).toBe("ALLOWLIST");
  });

  it("führt in der ALLOWLIST-Sandbox nur über den Proxy aus", async () => {
    process.env.BOB_EGRESS_ALLOWLIST = "example.com:443";
    const {port} = await egress.startEgressProxy({port: 0});
    const {task} = await prepareTask("C");
    const sandbox = await fabric.createSandbox({
      type: "test",
      taskId: task.taskId,
      agentId: "AG-BUILD",
      risk: "LOW",
      network: "ALLOWLIST"
    });
    await fabric.startSandbox(sandbox.sandboxId);

    const capability = authority.issueCapabilityToken({
      subject: "AG-BUILD",
      taskId: task.taskId,
      sandboxId: sandbox.sandboxId,
      environment: "test",
      capabilities: ["task:execute", "sandbox:run"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    });

    // Der Prozess meldet seine tatsächliche Umgebung zurück — kein Nachbau.
    const result = await broker.executeAuthorized({
      taskId: task.taskId,
      agentId: "AG-BUILD",
      sandboxId: sandbox.sandboxId,
      capabilityTokenId: capability.token.id,
      environment: "test",
      argv: ["node", "-e", "process.stdout.write(JSON.stringify({proxy: process.env.HTTPS_PROXY ?? null, egress: process.env.BOB_EGRESS ?? null}))"]
    });

    expect(result.accepted).toBe(true);
    const observed = JSON.parse(result.stdout) as {proxy: string | null; egress: string | null};
    expect(observed.egress).toBe("PROXY_ONLY");
    expect(observed.proxy).toBe(`http://127.0.0.1:${port}`);
    expect(result.evidence?.verified).toBe(true);
  });

  it("setzt in einer DENY-Sandbox keine Proxy-Variablen", async () => {
    const {task} = await prepareTask("D");
    const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const capability = authority.issueCapabilityToken({
      subject: "AG-BUILD",
      taskId: task.taskId,
      sandboxId: sandbox.sandboxId,
      environment: "test",
      capabilities: ["task:execute", "sandbox:run"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    });
    const result = await broker.executeAuthorized({
      taskId: task.taskId,
      agentId: "AG-BUILD",
      sandboxId: sandbox.sandboxId,
      capabilityTokenId: capability.token.id,
      environment: "test",
      argv: ["node", "-e", "process.stdout.write(String(process.env.HTTPS_PROXY ?? 'none'))"]
    });
    expect(result.accepted).toBe(true);
    expect(result.stdout).toBe("none");
  });
});
