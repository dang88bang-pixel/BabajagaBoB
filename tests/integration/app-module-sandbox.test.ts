import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

const root = isolatedStorageRoot("int-app-module");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let apps: typeof import("../../lib/apps");
let approvals: typeof import("../../lib/approvals");
let fabric: typeof import("../../lib/sandbox/fabric");
let audit: typeof import("../../lib/audit");

const AGENT = "AG-BUILD";

async function fixture(assignedAgent: string | null = AGENT) {
  const mission = cp.createMission({title: "App", objective: "Modul installieren", createdBy: "CREATOR"});
  const task = cp.createTask({missionId: mission.missionId, title: "App-Task", risk: "LOW", createdBy: "CREATOR"});
  if (assignedAgent) cp.assignTask(task.taskId, assignedAgent);
  const app = apps.createApp({name: "Demo", version: "1.0.0", description: "Demo-App", taskId: task.taskId});
  apps.setAppState(app.id, "AWAITING_CONFIRMATION", 90, task.taskId);
  const module = apps.registerExecutableModule({
    appId: app.id,
    name: "demo-module",
    version: "1.0.0",
    entrypoint: "index.js",
    capabilities: ["read"],
    risk: "LOW",
    testsPassed: true,
    securityValidated: true,
    taskId: task.taskId
  });
  const approval = approvals.createApproval({
    taskId: task.taskId,
    requestedBy: "AG-BUILD",
    changeSummary: `Modul ${module.name} installieren`,
    why: "Freigabe für Installation",
    expectedEffect: "Modul läuft isoliert",
    risks: ["Sandbox-Nutzung"],
    testResults: ["Modul-Tests grün"],
    rollbackPlan: "Modul deaktivieren",
    files: [],
    dbChanges: [],
    networkEffects: [],
    affectedSystems: [module.id]
  });
  approvals.resolveApprovalRequest(approval.approvalId, "GRANTED", "CREATOR");
  return {task, app, module, approvalId: approval.approvalId};
}

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  apps = await import("../../lib/apps");
  approvals = await import("../../lib/approvals");
  fabric = await import("../../lib/sandbox/fabric");
  audit = await import("../../lib/audit");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("App-Modul-Sandbox über die Fabric (keine Runtime-Umgehung)", () => {
  it("verweigert die Installation ohne gebundenen Task (fail closed)", async () => {
    const {module, approvalId} = await fixture();
    await expect(apps.installExecutableModule(module.id, approvalId)).rejects.toThrow(/existing task|binding/i);
    expect(apps.listModules().find(entry => entry.id === module.id)?.sandboxId).toBeUndefined();
  });

  it("verweigert die Installation, wenn die Task keinen Agenten hat", async () => {
    const {module, approvalId, task} = await fixture(null);
    await expect(apps.installExecutableModule(module.id, approvalId, task.taskId)).rejects.toThrow(/assigned agent|binding/i);
  });

  it("installiert mit gebundener Task und registriert die Sandbox in der Control Plane", async () => {
    const {module, approvalId, task} = await fixture();
    const result = await apps.installExecutableModule(module.id, approvalId, task.taskId);
    expect(result.module.sandboxId).toBe(`SB-APP-${module.id}`);

    const registered = cp.getControlState().sandboxes.find(s => s.sandboxId === result.module.sandboxId);
    expect(registered?.taskId).toBe(task.taskId);
    expect(registered?.agentId).toBe(AGENT);
    expect(registered?.network).toBe("DENY");

    // Die Fabric bestätigt die Bindung, der Broker kann darauf aufbauen.
    const sandboxId = result.module.sandboxId;
    expect(sandboxId).toBeTruthy();
    expect(fabric.assertTaskSandboxBinding(task.taskId, sandboxId!).task.taskId).toBe(task.taskId);
  });

  it("startet und pausiert Module über die Fabric-Lifecycle-Operationen", async () => {
    const {module, approvalId, task} = await fixture();
    const installed = await apps.installExecutableModule(module.id, approvalId, task.taskId);
    const started = await apps.startExecutableModule(installed.module.id, task.taskId);
    expect(started.module.state).toBe("RUNNING");
    expect(cp.getControlState().sandboxes.find(s => s.sandboxId === started.module.sandboxId)?.lifecycle).toBe("RUNNING");

    const paused = await apps.pauseExecutableModule(installed.module.id);
    expect(paused.state).toBe("PAUSED");
    expect(cp.getControlState().sandboxes.find(s => s.sandboxId === paused.sandboxId)?.lifecycle).toBe("PAUSED");
  });

  it("legt Sandbox-Workspaces ausschließlich unterhalb des Sandbox-Roots an", async () => {
    const {module, approvalId, task} = await fixture();
    const installed = await apps.installExecutableModule(module.id, approvalId, task.taskId);
    await apps.startExecutableModule(installed.module.id, task.taskId);
    const workspace = path.join(root, "sandboxes", installed.module.sandboxId!);
    expect(fs.existsSync(workspace)).toBe(true);
    // Eigene Rechte pro Sandbox-Workspace (0700), kein Teilen zwischen Sandboxes.
    expect(fs.statSync(workspace).mode & 0o777).toBe(0o700);
  });

  it("auditiert Installation und Start nachvollziehbar", async () => {
    const actions = audit.auditSnapshot(300).map(record => record.action);
    expect(actions).toContain("app.module.install");
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});
