import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("unit-agent-fabric");

let fabric: typeof import("../../lib/agent-fabric");
let cp: typeof import("../../lib/control-plane");
let bootstrap: typeof import("../../lib/bootstrap");

beforeAll(async () => {
  vi.resetModules();
  fabric = await import("../../lib/agent-fabric");
  cp = await import("../../lib/control-plane");
  bootstrap = await import("../../lib/bootstrap");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("Agent Fabric (11 Rollen mit Autonomie-Vertrag)", () => {
  it("führt genau die 11 Rollen der Control Plane – ohne zweite, abweichende Liste", () => {
    const nodes = fabric.listAgentNodes();
    expect(nodes.length).toBe(11);
    expect(new Set(nodes.map(n => n.kind)).size).toBe(11);
    expect(nodes.map(n => n.agentId).sort()).toEqual(cp.getControlState().agents.map(a => a.agentId).sort());
    expect(nodes.map(n => n.kind).sort()).toEqual([
      "BROWSER", "BUILDER", "GUARDIAN", "INTEGRATOR", "OPERATOR", "PLANNER", "QA", "RECOVERY", "RESEARCH", "SCIENTIST", "SUPERVISOR"
    ]);
  });

  it("erlaubt keinem Agenten Selbstvergabe, Produktion oder Infrastruktur", () => {
    const summary = fabric.agentFabricSummary();
    expect(summary.authorityChanges).toEqual([]);
    expect(summary.productionAccess).toEqual([]);
    for (const node of fabric.listAgentNodes()) {
      expect(node.profile.authorityChanges).toBe(false);
      expect(node.profile.production).toBe(false);
      expect(node.profile.infrastructure).toBe(false);
      expect(node.profile.externalNetwork).toBe(false);
      // Wildcards wären eine Rechteausweitung ohne Grund.
      expect(node.capabilities).not.toContain("*");
    }
  });

  it("lässt Heartbeats und Statusänderungen über die Control Plane laufen", () => {
    const heartbeat = fabric.heartbeatAgent("AG-RECOVERY");
    expect(heartbeat?.kind).toBe("RECOVERY");
    const updated = fabric.updateAgentStatus("AG-RECOVERY", "RUNNING", 40, "Wiederherstellung vorbereiten");
    expect(updated?.status).toBe("RUNNING");
    expect(updated?.progress).toBe(40);
    // Unbekannte Agenten sind kein stiller Erfolg.
    expect(fabric.heartbeatAgent("AG-UNBEKANNT")).toBeNull();
    expect(fabric.updateAgentStatus("AG-UNBEKANNT", "RUNNING", 1)).toBeNull();
  });

  it("verweigert Selbstübergaben und unbekannte Agenten", () => {
    const mission = cp.createMission({title: "Übergabe-Mission", objective: "Handoff prüfen", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Übergabe-Task", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
    expect(() => fabric.requestHandoff("AG-BUILD", "AG-BUILD", task.taskId, "Selbstübergabe")).toThrow(/self handoff/);
    expect(() => fabric.requestHandoff("AG-BUILD", "AG-UNBEKANNT", task.taskId, "unbekannt")).toThrow(/not found/);
    const handoff = fabric.requestHandoff("AG-BUILD", "AG-QA", task.taskId, "Verifikation anfordern");
    expect(handoff.status).toBe("REQUESTED");
    expect(fabric.resolveHandoff(handoff.id, "ACCEPTED").status).toBe("ACCEPTED");
    expect(fabric.listHandoffs().some(h => h.id === handoff.id)).toBe(true);
  });
});
