import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("int-provider");

let bootstrap: typeof import("../../lib/bootstrap");
let providers: typeof import("../../lib/provider-fabric");
let approvals: typeof import("../../lib/approvals");
let cp: typeof import("../../lib/control-plane");
let audit: typeof import("../../lib/audit");
let dataBoundary: typeof import("../../lib/data-boundary");
let providerRoute: typeof import("../../app/api/providers/route");
let sessions: typeof import("../../lib/session");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  providers = await import("../../lib/provider-fabric");
  approvals = await import("../../lib/approvals");
  cp = await import("../../lib/control-plane");
  audit = await import("../../lib/audit");
  dataBoundary = await import("../../lib/data-boundary");
  providerRoute = await import("../../app/api/providers/route");
  sessions = await import("../../lib/session");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

function grantApproval(providerId: string, endpointOrigin: string) {
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
    networkEffects: [`ausgehend zu ${endpointOrigin}`],
    affectedSystems: [providerId]
  });
  approvals.resolveApprovalRequest(approval.approvalId, "GRANTED", "CREATOR");
  return approval.approvalId;
}

describe("Provider Fabric (fail closed until brokered egress exists)", () => {
  it("startet mit entdeckten, aber deaktivierten Providern (Discovery ≠ Autorisierung)", () => {
    const list = providers.listProviders();
    expect(list.length).toBeGreaterThan(0);
    for (const provider of list) {
      expect(provider.enabled).toBe(false);
      expect(provider.lifecycle).toBe("DISCOVERED");
    }
    expect(providers.providerStoreReport().ok).toBe(true);
  });

  it("verweigert Verbindung ohne Creator-Freigabe oder mit unbekannter Freigabe", async () => {
    const endpoint = "https://temporal.local";
    await expect(providers.connectProvider("prov-temporal", endpoint, "secret-ref-test-only")).rejects.toThrow(/Creator approval/i);
    await expect(providers.connectProvider("prov-temporal", endpoint, "secret-ref-test-only", "APR-UNBEKANNT")).rejects.toThrow(/not granted/i);
    expect(providers.getProvider("prov-temporal")?.enabled).toBe(false);
  });

  it("bindet Freigaben an Provider und exakten HTTPS-Origin statt Teilstring", async () => {
    const endpoint = "https://api.openhands.example/v1";
    const unrelatedProvider = grantApproval("prov-daytona", "https://api.openhands.example");
    await expect(providers.connectProvider("prov-openhands", endpoint, "secret-ref-test-only", unrelatedProvider)).rejects.toThrow(/not scoped/i);

    const matchingOrigin = grantApproval("prov-openhands", "https://api.openhands.example");
    await expect(providers.connectProvider("prov-openhands", "https://api.openhands.example.evil/v1", "secret-ref-test-only", matchingOrigin)).rejects.toThrow(/not scoped/i);
    expect(providers.getProvider("prov-openhands")?.enabled).toBe(false);
  });

  it("verlangt HTTPS ohne URL-Credentials und eine Secret-Store-Referenz", async () => {
    const approvalId = grantApproval("prov-openhands", "https://api.openhands.example");
    await expect(providers.connectProvider("prov-openhands", "http://api.openhands.example/v1", "secret-ref-test-only", approvalId)).rejects.toThrow(/HTTPS/i);
    await expect(providers.connectProvider("prov-openhands", "https://user:password@api.openhands.example/v1", "secret-ref-test-only", approvalId)).rejects.toThrow(/HTTPS/i);
    await expect(providers.connectProvider("prov-openhands", "https://api.openhands.example/v1", " ", approvalId)).rejects.toThrow(/Secret Store reference/i);
    expect(providers.getProvider("prov-openhands")?.enabled).toBe(false);
  });

  it("behauptet trotz genehmigter Anfrage keinen Live-Status ohne Broker-Adapter", async () => {
    const endpoint = "https://api.openhands.example/v1";
    const approvalId = grantApproval("prov-openhands", new URL(endpoint).origin);
    await expect(providers.connectProvider("prov-openhands", endpoint, "secret-ref-test-only", approvalId))
      .rejects.toBeInstanceOf(providers.ProviderAdapterUnavailableError);
    const unchanged = providers.getProvider("prov-openhands");
    expect(unchanged?.lifecycle).toBe("DISCOVERED");
    expect(unchanged?.enabled).toBe(false);
    expect(unchanged?.endpoint).toBeUndefined();
    expect(unchanged?.credentialRef).toBeUndefined();
    expect(providers.providerSnapshot().telemetry["prov-openhands"]).toBeUndefined();
    const auditText = JSON.stringify(audit.auditSnapshot(200));
    expect(auditText).not.toContain("secret-ref-test-only");
  });

  it("antwortet über die API mit 503 und gibt keine Secret-Referenz zurück", async () => {
    const endpoint = "https://api.openhands.example/v1";
    const approvalId = grantApproval("prov-openhands", new URL(endpoint).origin);
    const {token} = sessions.createSession({actorId: "CREATOR", role: "OWNER"});
    const response = await providerRoute.POST(new Request("http://localhost/api/providers", {
      method: "POST",
      headers: {"content-type": "application/json", cookie: `${sessions.SESSION_COOKIE}=${token}`},
      body: JSON.stringify({action: "connect", id: "prov-openhands", endpoint, credentialRef: "secret-ref-test-only", approvalId})
    }));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("PROVIDER_ADAPTER_UNAVAILABLE");
    expect(body).not.toContain("secret-ref-test-only");
    expect(providers.getProvider("prov-openhands")?.enabled).toBe(false);
  });

  it("lässt keinen API-Aufrufer Lifecycle oder Heartbeat vortäuschen", async () => {
    const {token} = sessions.createSession({actorId: "CREATOR", role: "OWNER"});
    for (const action of ["state", "heartbeat"]) {
      const response = await providerRoute.POST(new Request("http://localhost/api/providers", {
        method: "POST",
        headers: {"content-type": "application/json", cookie: `${sessions.SESSION_COOKIE}=${token}`},
        body: JSON.stringify({action, id: "prov-openhands", lifecycle: "CONNECTED", health: "HEALTHY", latencyMs: 1})
      }));
      expect(response.status).toBe(400);
    }
    expect(providers.getProvider("prov-openhands")?.lifecycle).toBe("DISCOVERED");
    expect(providers.getProvider("prov-openhands")?.enabled).toBe(false);
  });

  it("bindet keine Capabilities solange keine brokerbestätigte Verbindung besteht", () => {
    expect(() => providers.bindProvider("prov-daytona", "TASK", "TASK-0001", ["sandbox"])).toThrow(/not connected/i);
    expect(() => providers.bindProvider("prov-temporal", "TASK", "TASK-0001", ["durable-execution"])).toThrow(/not connected/i);
  });

  it("widerruft Anbieter fail closed und erlaubt keine Wiederverbindung", async () => {
    const revoked = providers.revokeProvider("prov-temporal");
    expect(revoked.lifecycle).toBe("REVOKED");
    expect(revoked.enabled).toBe(false);
    const approvalId = grantApproval("prov-temporal", "https://temporal.local");
    await expect(providers.connectProvider("prov-temporal", "https://temporal.local", "secret-ref-test-only", approvalId)).rejects.toThrow(/revoked/i);
  });

  it("nimmt Heartbeats nur für eine bestehende Live-Verbindung an", () => {
    expect(() => providers.heartbeatProvider("prov-e2b", {health: "HEALTHY", latencyMs: 5})).toThrow(/requires a live connection/i);
    expect(providers.providerSnapshot().telemetry["prov-e2b"]).toBeUndefined();
  });

  it("blockiert geschützte Daten an Drittanbieter (fail closed)", () => {
    for (const dataClass of ["USER", "DEVICE", "SECRET", "ARTIFACT", "OTHER"] as const) {
      expect(() => providers.assertProviderPayloadAllowed("prov-e2b", dataClass)).toThrow(dataBoundary.DataBoundaryError);
    }
    expect(() => dataBoundary.assertNoProtectedDataForThirdParty("USER")).toThrow();
    expect(providers.getProvider("prov-e2b")?.dataPolicy).toBe("METADATA_ONLY");
  });

  it("auditiert abgelehnte Verbindungsversuche nachvollziehbar ohne Secret-Werte", async () => {
    const endpoint = "https://langgraph.local";
    const approvalId = grantApproval("prov-langgraph", new URL(endpoint).origin);
    await expect(providers.connectProvider("prov-langgraph", endpoint, "secret-ref-test-only", approvalId))
      .rejects.toBeInstanceOf(providers.ProviderAdapterUnavailableError);
    const events = audit.auditSnapshot(200).filter(record => record.action === "provider.connect");
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain("secret-ref-test-only");
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("blockiert Query- und Fragmentdaten in Provider-Endpoints", async () => {
    const endpoint = "https://celesto.local";
    const approvalId = grantApproval("prov-celesto", new URL(endpoint).origin);
    await expect(providers.connectProvider("prov-celesto", `${endpoint}?token=must-not-be-embedded`, "secret-ref-test-only", approvalId)).rejects.toThrow(/query|fragment/i);
    await expect(providers.connectProvider("prov-celesto", `${endpoint}#credential`, "secret-ref-test-only", approvalId)).rejects.toThrow(/query|fragment/i);
    expect(providers.getProvider("prov-celesto")?.enabled).toBe(false);
  });
});
