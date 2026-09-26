import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Kein Ausführungspfad umgeht den Execution Broker (Abschnitt 10/12/16).
 *
 * Regressionstests und Smoke-Tests der Verifikationspipeline sind echte
 * Prozessausführungen. Sie liefen früher direkt über die Runtime — damit
 * blockierte ein aktiver Kill Switch (Lockdown) sie **nicht**, es gab keine
 * Autorisierung und keine Evidenz. Das war der verbotene Pfad
 * `Tool → System`.
 *
 * Diese Suite hält den korrigierten Weg fest:
 *   SYSTEM-WORKER (delegiert vom Creator) → Gate → Broker → Runtime → Evidenz
 *
 * Geprüft wird:
 *  1. Ein Regressionstest läuft normal und erzeugt Evidenz + Audit.
 *  2. Im Lockdown werden Regressionstest **und** Smoke-Test verweigert.
 *  3. Nach Aufhebung laufen beide wieder.
 *  4. Ohne die Delegationskante CREATOR → SYSTEM-WORKER wird nichts ausgeführt.
 */

const root = isolatedStorageRoot("gate-bypass");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let regression: typeof import("../../lib/regression");
let verification: typeof import("../../lib/verification");
let governance: typeof import("../../lib/governance");
let artifacts: typeof import("../../lib/artifacts");
let audit: typeof import("../../lib/audit");
let authority: typeof import("../../lib/authority");
let eventLog: typeof import("../../lib/events/log");

async function makeSandbox() {
  const mission = cp.createMission({title: "Bypass", objective: "Kein Pfad um den Broker", createdBy: "CREATOR"});
  const task = cp.createTask({missionId: mission.missionId, title: "QA-Task", risk: "LOW", assignedAgent: "AG-QA", createdBy: "CREATOR"});
  const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-QA", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  return sandbox;
}

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  regression = await import("../../lib/regression");
  verification = await import("../../lib/verification");
  governance = await import("../../lib/governance");
  artifacts = await import("../../lib/artifacts");
  audit = await import("../../lib/audit");
  authority = await import("../../lib/authority");
  eventLog = await import("../../lib/events/log");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Bypass-Tester"});
  expect(root).toContain("gate-bypass");
});

describe("Regression und Smoke-Test laufen über den Broker", () => {
  it("führt einen Regressionstest autorisiert aus und legt Evidenz an", async () => {
    const sandbox = await makeSandbox();
    const test = regression.registerRegressionTest({
      name: "brokerpfad",
      description: "Regression muss über Gate, Broker und Evidenz laufen",
      argv: ["node", "-e", "process.stdout.write('broker-ok')"],
      createdBy: "AG-QA"
    });
    const before = artifacts.artifactSnapshot({taskId: sandbox.taskId}).length;
    const run = await regression.runRegressionTest(test.regressionId, sandbox.sandboxId);
    expect(run.accepted, run.output).toBe(true);
    // Evidenz je Lauf: der Lauf ist nachprüfbar, nicht nur protokolliert.
    const evidence = artifacts.artifactSnapshot({taskId: sandbox.taskId});
    expect(evidence.length).toBeGreaterThan(before);
    expect(evidence.some(entry => entry.kind === "EXECUTION")).toBe(true);
    // Autorisierung: das System-Token ist ausgestellt, gebunden und verbraucht.
    const systemTokens = authority.capabilityTokens().filter(token => token.issuedBy === "SYSTEM-WORKER");
    expect(systemTokens.length).toBeGreaterThan(0);
    expect(systemTokens.every(token => token.sandboxId === sandbox.sandboxId && token.subject === "AG-QA")).toBe(true);
    expect(audit.verifyAuditChain().valid).toBe(true);
    // Der Zweck ist im Ereignisstrom sichtbar: "warum" ist nachprüfbar, nicht nur "wer".
    const events = eventLog.listDomainEvents({});
    const purposes = events.filter(event => event.action === "sandbox.execute").map(event => event.purpose);
    expect(purposes).toContain("REGRESSION");
  }, 60_000);

  it("verweigert Regressionstest und Smoke-Test im Lockdown (Kill Switch greift)", async () => {
    const sandbox = await makeSandbox();
    const test = regression.registerRegressionTest({
      name: "lockdown-regression",
      description: "Im Lockdown darf kein Regressionstest laufen",
      argv: ["node", "-e", "process.stdout.write('darf-nicht')"],
      createdBy: "AG-QA"
    });
    const engaged = governance.engageSystemLockdown("gate-bypass test", "CREATOR");
    expect(engaged.active).toBe(true);
    try {
      await expect(regression.runRegressionTest(test.regressionId, sandbox.sandboxId)).rejects.toThrow(/EXECUTION_GATE|lockdown|lock/i);
      await expect(verification.runSmokeTest(sandbox.sandboxId)).resolves.toMatchObject({accepted: false});
      // Die Verweigerungen sind auditierbar (DENY), nicht still.
      const denials = audit.auditSnapshot(400).filter(record => record.decision === "DENY" && record.action === "sandbox.execute");
      expect(denials.length).toBeGreaterThan(0);
    } finally {
      governance.releaseSystemLockdown("gate-bypass test", "CREATOR");
    }
    // Nach Aufhebung läuft derselbe Test wieder.
    const after = await regression.runRegressionTest(test.regressionId, sandbox.sandboxId);
    expect(after.accepted, after.output).toBe(true);
  }, 90_000);

  it("führt ohne die Delegation CREATOR → SYSTEM-WORKER nichts aus (fail closed)", async () => {
    const sandbox = await makeSandbox();
    const test = regression.registerRegressionTest({
      name: "ohne-delegation",
      description: "Ohne Delegationskante gibt es keine Systemautorisierung",
      argv: ["node", "-e", "process.stdout.write('ohne')"],
      createdBy: "AG-QA"
    });
    // Delegationskante des System-Workers entziehen (simuliert fehlenden Bootstrap-Akt).
    const edge = authority.authorityGraph().find(entry => entry.to === "SYSTEM-WORKER");
    expect(edge).toBeTruthy();
    authority.revokeAuthorityEdge(edge!.id, "CREATOR");
    try {
      await expect(regression.runRegressionTest(test.regressionId, sandbox.sandboxId)).rejects.toThrow(/delegation|capabilities/i);
    } finally {
      // Wiederherstellung als neue Kante (die alte bleibt widerrufen).
      authority.addAuthorityEdge({
        id: `${edge!.id}-RESTORED`,
        from: "CREATOR",
        to: "SYSTEM-WORKER",
        kind: "DELEGATES",
        capabilities: edge!.capabilities,
        maxRisk: edge!.maxRisk,
        expiresAt: null
      });
    }
    const restored = await regression.runRegressionTest(test.regressionId, sandbox.sandboxId);
    expect(restored.accepted, restored.output).toBe(true);
  }, 90_000);
});
