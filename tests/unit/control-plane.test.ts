import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

isolatedStorageRoot("unit-control-plane");

let cp: typeof import("../../lib/control-plane");

beforeAll(async () => {
  vi.resetModules();
  cp = await import("../../lib/control-plane");
});

describe("Control Plane: Pflichtfelder der Kette", () => {
  // Gefunden im vollständigen Aktionsdurchlauf: `createMission` akzeptierte
  // leere Attribute und erzeugte eine inhaltslose Mission (Status PLANNING) —
  // die Kette Mission → Objective → Task hing danach an einem leeren Objekt.
  it("verweigert eine Mission ohne Titel, Ziel oder Urheber", () => {
    expect(() => cp.createMission({title: "", objective: "Ziel", createdBy: "CREATOR"})).toThrow(/title/i);
    expect(() => cp.createMission({title: "   ", objective: "Ziel", createdBy: "CREATOR"})).toThrow(/title/i);
    expect(() => cp.createMission({title: "Titel", objective: "", createdBy: "CREATOR"})).toThrow(/objective/i);
    expect(() => cp.createMission({title: "Titel", objective: "Ziel", createdBy: ""})).toThrow(/createdBy/i);
    expect(() => cp.createMission(undefined as never)).toThrow(/required/i);
  });

  it("legt keine Mission an, wenn die Eingabe verweigert wird", () => {
    const before = cp.snapshot().missions.length;
    expect(() => cp.createMission({title: "", objective: "", createdBy: "CREATOR"})).toThrow();
    expect(cp.snapshot().missions).toHaveLength(before);
  });
});

describe("Control Plane (kanonische Entitäten)", () => {
  it("legt Mission, Objective und Task mit eigenen IDs an", () => {
    const mission = cp.createMission({title: "Unit-Mission", objective: "Ziel prüfen", createdBy: "CREATOR"});
    expect(mission.missionId).toMatch(/^MIS-/);

    const objective = cp.createObjective({missionId: mission.missionId, title: "Unit-Objective", description: "Beschreibung"});
    expect(objective.objectiveId).toMatch(/^OBJ-/);
    expect(objective.missionId).toBe(mission.missionId);

    const task = cp.createTask({
      missionId: mission.missionId,
      objectiveId: objective.objectiveId,
      title: "Unit-Task",
      risk: "LOW",
      assignedAgent: "AG-BUILD",
      createdBy: "CREATOR"
    });
    expect(task.taskId).toMatch(/^TASK-/);
    expect(task.taskId).not.toBe(mission.missionId);
    expect(cp.getTask(task.taskId)?.taskId).toBe(task.taskId);
  });

  it("setzt requiresApproval bei hohem Risiko", () => {
    const mission = cp.createMission({title: "Risiko-Mission", objective: "Risiko", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Risiko-Task", risk: "HIGH", createdBy: "CREATOR"});
    expect(task.requiresApproval).toBe(true);
  });

  it("weist unbekannte Agenten und Missions zurück", () => {
    const mission = cp.createMission({title: "Abweisung", objective: "x", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Abweisung-Task", risk: "LOW", createdBy: "CREATOR"});
    expect(() => cp.assignTask(task.taskId, "AG-UNBEKANNT")).toThrow();
    expect(() => cp.createTask({missionId: "MIS-UNBEKANNT", title: "x", risk: "LOW", createdBy: "CREATOR"})).toThrow();
  });

  it("persistiert den Zustand im kanonischen Store", () => {
    expect(cp.controlStateReport().ok).toBe(true);
    expect(cp.PROJECT_ID).toBe("PRJ-BOB");
  });

  it("verweigert Task-Updates für unbekannte Tasks", () => {
    expect(() => cp.updateTaskStatus("TASK-9999", "RUNNING")).toThrow();
  });
});
