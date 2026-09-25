import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("sec-authority");

let authority: typeof import("../../lib/authority");
let bootstrap: typeof import("../../lib/bootstrap");
let audit: typeof import("../../lib/audit");

const AGENT_ID = "AG-BUILD";

function tokenInput(overrides: Partial<Parameters<typeof authority.issueCapabilityToken>[0]> = {}) {
  return {
    subject: AGENT_ID,
    taskId: "TASK-0001",
    sandboxId: "SB-0001",
    environment: "development",
    capabilities: ["task:execute", "sandbox:run"],
    risk: "MODERATE" as const,
    issuedBy: "CREATOR",
    issuedByKind: "CREATOR" as const,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    ...overrides
  };
}

beforeAll(async () => {
  vi.resetModules();
  authority = await import("../../lib/authority");
  bootstrap = await import("../../lib/bootstrap");
  audit = await import("../../lib/audit");
});

describe("Authority (Sicherheitsinvarianten)", () => {
  it("bleibt vor dem Creator-Bootstrap fail closed", () => {
    expect(() => bootstrap.requireInitialized()).toThrow();
  });

  it("initialisiert den Creator genau einmal", () => {
    const result = bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
    expect(result.rootAuthorityId).toMatch(/^ROOT-/);
    expect(() => bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Zweiter"})).toThrow();
    expect(() => bootstrap.requireInitialized()).not.toThrow();
  });

  it("verweigert die Selbstvergabe von Capabilities", () => {
    expect(() => authority.issueCapabilityToken(tokenInput({issuedBy: AGENT_ID, issuedByKind: "AGENT"}))).toThrow();
  });

  it("verweigert Wildcard-Capabilities", () => {
    expect(() => authority.issueCapabilityToken(tokenInput({capabilities: ["*"]}))).toThrow();
  });

  it("verweigert TTL über dem Creator-Maximum", () => {
    expect(() =>
      authority.issueCapabilityToken(tokenInput({expiresAt: new Date(Date.now() + 60 * 60_000).toISOString()}))
    ).toThrow();
  });

  it("verweigert Risk-Eskalation durch Agenten", () => {
    expect(() =>
      authority.issueCapabilityToken(
        tokenInput({issuedBy: "SYSTEM-WORKER", issuedByKind: "AGENT", capabilities: ["task:execute"], risk: "CRITICAL"})
      )
    ).toThrow();
  });

  it("stellt ein gültiges, gebundenes Token aus und verifiziert das Secret", () => {
    const issued = authority.issueCapabilityToken(tokenInput());
    expect(issued.token.id).toMatch(/^CAP-/);
    expect(issued.secret.length).toBeGreaterThan(20);
    expect(authority.verifyCapabilitySecret(issued.token.id, issued.secret)).toBe(true);
    expect(authority.verifyCapabilitySecret(issued.token.id, "falsches-secret")).toBe(false);

    const context = {subject: AGENT_ID, taskId: "TASK-0001", sandboxId: "SB-0001", environment: "development"};
    expect(authority.validateCapabilityToken(issued.token.id, ["task:execute"], context).valid).toBe(true);
    expect(authority.validateCapabilityToken(issued.token.id, ["task:execute"], {...context, taskId: "TASK-9999"}).valid).toBe(false);
    expect(authority.validateCapabilityToken(issued.token.id, ["task:execute"], {...context, environment: "production"}).valid).toBe(false);
    expect(authority.validateCapabilityToken(issued.token.id, ["deployment:production"]).valid).toBe(false);

    authority.revokeCapabilityToken(issued.token.id, "CREATOR");
    expect(authority.validateCapabilityToken(issued.token.id, ["task:execute"], context).valid).toBe(false);
  });

  it("gibt aus dem Systempfad kein erschöpftes Token erneut heraus", () => {
    // Eine Autorisierung = eine Ausführung. Liefert die Systemausstellung ein
    // bereits verbrauchtes Token zurück, würde der Broker den nächsten Lauf als
    // Replay verweigern — obwohl scheinbar eine gültige Autorisierung vorliegt.
    const taskId = "TASK-0002";
    const sandboxId = "SB-0002";
    const first = authority.ensureExecutionCapability(AGENT_ID, taskId, sandboxId, "MODERATE", "development");
    expect(authority.ensureExecutionCapability(AGENT_ID, taskId, sandboxId, "MODERATE", "development").id).toBe(first.id);

    authority.consumeCapabilityToken(first.id, AGENT_ID);
    const second = authority.ensureExecutionCapability(AGENT_ID, taskId, sandboxId, "MODERATE", "development");
    expect(second.id).not.toBe(first.id);
    expect(authority.precheckCapabilityToken(second.id, ["task:execute", "sandbox:run"], {subject: AGENT_ID, taskId, sandboxId}).valid).toBe(true);
  });

  it("verweigert unbekannte Rollen fail closed (keine Ausnahme, kein Zugriff)", () => {
    // Gefunden im Aktionsdurchlauf: `roleAllows("GIBTSNICHT", …)` warf einen
    // TypeError aus dem Rechte-Modul, der als 400 durchgereicht wurde. Ein
    // unbekannter Rollenname darf niemals Rechte ergeben — und auch nicht als
    // Ausnahme die Entscheidungskette verlassen.
    expect(authority.roleAllows("GIBTSNICHT" as never, "sandbox:run")).toBe(false);
    expect(authority.roleAllows("DEVELOPER", "sandbox:run")).toBe(true);
    expect(authority.roleAllows("VIEWER", "sandbox:run")).toBe(false);
    expect(authority.roleAllows("OWNER", "")).toBe(false);

    const denied = authority.abacAllows(
      {actorId: "AG-X", role: "GIBTSNICHT" as never, capabilities: ["sandbox:run"], environment: "development"},
      {action: "sandbox:run", resource: "SB-X", risk: "LOW", requiresApproval: false, environment: "development"}
    );
    expect(denied.allowed).toBe(false);
  });

  it("führt einen über die API angelegten Lauf durch Queue und Lease in den Lauf", async () => {
    // `runs.start` verlangte einen geleasten Lauf; ein per API angelegter Lauf
    // ist CREATED. Ohne Dispatcher war die Aktion dadurch nicht benutzbar
    // ("invalid run transition CREATED -> RUNNING").
    const runs = await import("../../lib/runs");
    const created = runs.createRun({taskId: "TASK-0001", agentId: AGENT_ID, risk: "LOW", sandboxId: "SB-0001"});
    expect(created.state).toBe("CREATED");
    runs.queueRun(created.runId, "CREATOR");
    const leased = runs.leaseRun(created.runId, "CREATOR");
    expect(leased?.state).toBe("LEASED");
    expect(runs.startRun(created.runId)?.state).toBe("RUNNING");
  });

  it("auditiert jede Verweigerung (DENY) nachvollziehbar", () => {
    const denials = audit.auditSnapshot(200).filter(record => record.decision === "DENY");
    expect(denials.length).toBeGreaterThan(0);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});
