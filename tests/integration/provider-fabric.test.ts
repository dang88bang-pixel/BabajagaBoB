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
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {status: 200}));
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

  it("verweigert Verbindung ohne explizite Freigabe", async () => {
    await expect(providers.connectProvider("prov-temporal", "https://1.1.1.1/health")).rejects.toThrow(/approval/i);
    await expect(providers.connectProvider("prov-temporal", "https://1.1.1.1/health", undefined, "APR-UNBEKANNT")).rejects.toThrow(/approval/i);
    expect(providers.getProvider("prov-temporal")?.enabled).toBe(false);
  });

  it("verbindet erst mit erteilter Freigabe und persistiert den Zustand", async () => {
    const approvalId = grantApproval("prov-temporal");
    const connected = await providers.connectProvider("prov-temporal", "https://1.1.1.1/health", "secret-ref-temporal", approvalId);
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

  it("deaktiviert Bindungen bei Widerruf und erlaubt keine Wiederverbindung", async () => {
    const revoked = providers.revokeProvider("prov-temporal");
    expect(revoked.lifecycle).toBe("REVOKED");
    expect(providers.listBindings().filter(entry => entry.providerId === "prov-temporal").every(entry => !entry.active)).toBe(true);
    const approvalId = grantApproval("prov-temporal");
    await expect(providers.connectProvider("prov-temporal", "https://1.1.1.1/health", undefined, approvalId)).rejects.toThrow(/revoked/i);
  });

  it("verfolgt Health über Heartbeats und blockiert ungesunde Provider", async () => {
    const approvalId = grantApproval("prov-e2b");
    await providers.connectProvider("prov-e2b", "https://1.1.1.1/health", undefined, approvalId);
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
