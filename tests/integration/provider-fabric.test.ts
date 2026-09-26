import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("int-provider");

let bootstrap: typeof import("../../lib/bootstrap");
let providers: typeof import("../../lib/provider-fabric");
let approvals: typeof import("../../lib/approvals");
let cp: typeof import("../../lib/control-plane");
let audit: typeof import("../../lib/audit");
let dataBoundary: typeof import("../../lib/data-boundary");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  providers = await import("../../lib/provider-fabric");
  approvals = await import("../../lib/approvals");
  cp = await import("../../lib/control-plane");
  audit = await import("../../lib/audit");
  dataBoundary = await import("../../lib/data-boundary");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

function grantApproval(providerId: string) {
  const mission = cp.createMission({title: "Provider", objective: "Freigabe", createdBy: "CREATOR"});
  const task = cp.createTask({missionId: mission.missionId, title: "Provider-Task", risk: "LOW", assignedAgent: "AG-INT", createdBy: "CREATOR"});
  const approval = approvals.createApproval({
    taskId: task.taskId,
    requestedBy: "AG-INT",
    changeSummary: `Provider ${providerId} verbinden`,
    why: "Integration",
    expectedEffect: "Provider wird nutzbar",
    risks: ["Drittanbieter-Zugriff"],
    testResults: ["Adapter-Smoke lokal"],
    rollbackPlan: "Provider trennen und Bindungen deaktivieren",
    files: [],
    dbChanges: [],
    networkEffects: ["ausgehend zu Provider-Endpoint"],
    affectedSystems: [providerId]
  });
  approvals.resolveApprovalRequest(approval.approvalId, "GRANTED", "CREATOR");
  return approval.approvalId;
}

describe("Provider Fabric (persistent, fail closed)", () => {
  it("startet mit entdeckten, aber deaktivierten Providern (Discovery ≠ Autorisierung)", () => {
    const list = providers.listProviders();
    expect(list.length).toBeGreaterThan(0);
    for (const provider of list) {
      expect(provider.enabled).toBe(false);
      expect(provider.lifecycle).toBe("DISCOVERED");
    }
    expect(providers.providerStoreReport().ok).toBe(true);
  });

  it("verweigert Verbindung ohne explizite Freigabe", () => {
    expect(() => providers.connectProvider("prov-temporal", "https://temporal.local")).toThrow(/approval/i);
    expect(() => providers.connectProvider("prov-temporal", "https://temporal.local", undefined, "APR-UNBEKANNT")).toThrow(/approval/i);
    expect(providers.getProvider("prov-temporal")?.enabled).toBe(false);
  });

  it("verbindet erst mit erteilter Freigabe und persistiert den Zustand", () => {
    const approvalId = grantApproval("prov-temporal");
    const connected = providers.connectProvider("prov-temporal", "https://temporal.local", "secret-ref-temporal", approvalId);
    expect(connected.lifecycle).toBe("CONNECTED");
    expect(connected.enabled).toBe(true);
    // Persistenz: unabhängiger Lesepfad liefert denselben Zustand.
    expect(providers.getProvider("prov-temporal")?.lifecycle).toBe("CONNECTED");
    expect(providers.providerSnapshot().providers.find(p => p.id === "prov-temporal")?.lifecycle).toBe("CONNECTED");
  });

  it("bindet nur angebotene Capabilities und nur verbundene Provider", () => {
    expect(() => providers.bindProvider("prov-daytona", "TASK", "TASK-0001", ["sandbox"])).toThrow(/not connected/i);
    expect(() =>
      providers.bindProvider("prov-temporal", "TASK", "TASK-0001", ["gibt-es-nicht"])
    ).toThrow(/does not offer/);
    const binding = providers.bindProvider("prov-temporal", "TASK", "TASK-0001", ["durable-execution"]);
    expect(binding.active).toBe(true);
    expect(providers.listBindings().some(entry => entry.id === binding.id)).toBe(true);
  });

  it("deaktiviert Bindungen bei Widerruf und erlaubt keine Wiederverbindung", () => {
    const revoked = providers.revokeProvider("prov-temporal");
    expect(revoked.lifecycle).toBe("REVOKED");
    expect(providers.listBindings().filter(entry => entry.providerId === "prov-temporal").every(entry => !entry.active)).toBe(true);
    const approvalId = grantApproval("prov-temporal");
    expect(() => providers.connectProvider("prov-temporal", "https://temporal.local", undefined, approvalId)).toThrow(/revoked/i);
  });

  it("verfolgt Health über Heartbeats und blockiert ungesunde Provider", () => {
    const approvalId = grantApproval("prov-e2b");
    providers.connectProvider("prov-e2b", "https://e2b.local", undefined, approvalId);
    expect(providers.heartbeatProvider("prov-e2b", {health: "DEGRADED", latencyMs: 120}).lifecycle).toBe("DEGRADED");
    expect(providers.heartbeatProvider("prov-e2b", {health: "UNHEALTHY", message: "timeout"}).lifecycle).toBe("BLOCKED");
    expect(providers.providerSnapshot().telemetry["prov-e2b"].health).toBe("UNHEALTHY");
  });

  it("blockiert geschützte Daten an Drittanbieter (fail closed)", () => {
    // Der Provider-Datenvertrag ist METADATA_ONLY: jede geschützte Datenklasse
    // wird verweigert, unabhängig vom Typ.
    for (const dataClass of ["USER", "DEVICE", "SECRET", "ARTIFACT", "OTHER"] as const) {
      expect(() => providers.assertProviderPayloadAllowed("prov-e2b", dataClass)).toThrow(dataBoundary.DataBoundaryError);
    }
    expect(() => dataBoundary.assertNoProtectedDataForThirdParty("USER")).toThrow();
    expect(providers.getProvider("prov-e2b")?.dataPolicy).toBe("METADATA_ONLY");
  });

  it("auditiert Bindungen nachvollziehbar", () => {
    const bindingAudits = audit.auditSnapshot(200).filter(record => record.action === "provider.bind");
    expect(bindingAudits.length).toBeGreaterThan(0);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});
