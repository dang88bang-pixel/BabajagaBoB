import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Computer-Use-Treiber, echter Ausführungspfad (Phase 4 / 7.2):
 * Eine CLI-Aktion läuft ausschließlich über Gate/Broker in einer gebundenen
 * DENY-Sandbox und erzeugt Evidenz, Audit und Provenance — wie jeder andere
 * autorisierte Systemlauf.
 */

process.env.BOB_NS_ISOLATION = "off";
isolatedStorageRoot("cu-drivers-int");

let drivers: typeof import("../../lib/computer-use-drivers");
let cu: typeof import("../../lib/computer-use");
let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let audit: typeof import("../../lib/audit");
let provenance: typeof import("../../lib/provenance");

beforeAll(async () => {
  vi.resetModules();
  drivers = await import("../../lib/computer-use-drivers");
  cu = await import("../../lib/computer-use");
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  audit = await import("../../lib/audit");
  provenance = await import("../../lib/provenance");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("CLI-Aktion über den autorisierten Systempfad", () => {
  it("führt PROCESS_READ in einer gebundenen DENY-Sandbox aus und erzeugt Evidenz", async () => {
    const mission = cp.createMission({title: "Computer-Use", objective: "CU-Aktionen über Broker", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "CLI-Aktion", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
    const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    expect(sandbox.network).toBe("DENY");
    await fabric.startSandbox(sandbox.sandboxId);

    const instance = cu.registerComputer({
      name: "CLI-Integration",
      kind: "CLI",
      os: "linux",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "CLI", actions: ["PROCESS_READ"], environments: ["test"], network: "DENY", risk: "LOW"}],
      authorized: false
    });
    cu.authorizeComputer(instance.id, true);
    cu.allocateComputer(instance.id, task.taskId, sandbox.sandboxId);
    cu.startComputer(instance.id);

    const attempt = await drivers.executeCuAction({instanceId: instance.id, action: "PROCESS_READ", requestedBy: "CREATOR"});
    expect(attempt.accepted).toBe(true);
    expect(attempt.exitCode).toBe(0);
    expect(attempt.driverId).toBe("cli-node");
    expect(attempt.evidence?.verified).toBe(true);

    const envelope = JSON.parse(attempt.evidence ? await readEvidenceOutput(attempt.evidence.artifactId) : "{}");
    expect(envelope.accepted).toBe(true);
    const processInfo = JSON.parse(envelope.stdout);
    expect(processInfo.pid).toBeGreaterThan(0);
    expect(processInfo.platform).toBe(process.platform);

    // Herkunft: Aktion hängt an der Instanz (EXECUTED_IN), Audit enthält sie.
    const graph = provenance.listProvenance();
    expect(graph.edges.some(edge => edge.from === attempt.attemptId && edge.to === instance.id && edge.relation === "EXECUTED_IN")).toBe(true);
    expect(audit.auditSnapshot().some(record => record.action === "computer-use:action" && record.decision === "ALLOW")).toBe(true);
    expect(audit.verifyAuditChain().valid).toBe(true);

    await fabric.destroySandbox(sandbox.sandboxId).catch(() => undefined);
  }, 60_000);

  it("eine BROWSER-Aktion ohne Browser-Binary wird ehrlich verweigert, nicht simuliert", async () => {
    const availability = drivers.browserDriver.availability();
    const mission = cp.createMission({title: "Computer-Use Browser", objective: "Ehrliche Verfügbarkeit", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Browser-Aktion", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
    const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);

    const instance = cu.registerComputer({
      name: "Browser-Integration",
      kind: "BROWSER",
      os: "linux",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "BROWSER", actions: ["NAVIGATE", "SCREENSHOT"], environments: ["test"], network: "DENY", risk: "MODERATE"}],
      authorized: false
    });
    cu.authorizeComputer(instance.id, true);
    cu.allocateComputer(instance.id, task.taskId, sandbox.sandboxId);

    if (availability.available) {
      // Metazeichenfreie URL über eine temporäre Datei — die argv-Policy
      // verbietet Shell-Metazeichen, deshalb kein data:-Markup im Test.
      const page = path.join(os.tmpdir(), `cu-browser-${crypto.randomUUID().slice(0, 8)}.html`);
      fs.writeFileSync(page, "<html><body><h1>cu</h1></body></html>");
      const attempt = await drivers.executeCuAction({instanceId: instance.id, action: "NAVIGATE", params: {url: `file://${page}`}, timeoutMs: 45_000, requestedBy: "CREATOR"});
      expect(attempt.driverId).toBe("browser-headless-chromium");
      expect(typeof attempt.accepted).toBe("boolean");
    } else {
      await expect(
        drivers.executeCuAction({instanceId: instance.id, action: "NAVIGATE", params: {url: "file:///tmp/cu-never.html"}, requestedBy: "CREATOR"})
      ).rejects.toThrow(/driver unavailable/);
      expect(availability.reason).toMatch(/Chromium|PATH/);
    }

    await fabric.destroySandbox(sandbox.sandboxId).catch(() => undefined);
  }, 60_000);
});

async function readEvidenceOutput(artifactId: string): Promise<string> {
  const artifacts = await import("../../lib/artifacts");
  const record = artifacts.getArtifact(artifactId);
  if (!record) throw new Error(`evidence artifact not found: ${artifactId}`);
  return record.content;
}
