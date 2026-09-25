import {beforeEach, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

/**
 * Persistenzpflicht (Abschnitt 39): Betriebszustand darf nicht im Speicher
 * leben. Geprüft wird das hart — nach `vi.resetModules()` wird die Laufzeit
 * neu geladen und muss denselben Zustand aus dem Storage-Root lesen.
 */

const root = isolatedStorageRoot("runtime-persistence");

beforeEach(() => {
  vi.resetModules();
  process.env.BOB_STORAGE_DIR = root;
});

describe("Persistenz von Betriebszustand", () => {
  it("behält CI/CD-Pipelines, Prüfstände und Promotion-Stufen", async () => {
    const first = await import("../../lib/cicd");
    const pipeline = first.createPipeline({taskId: "TASK-1", branch: "feature/x"});
    first.updateCheck(pipeline.id, "LINT", "PASSED", "ok");
    first.updateCheck(pipeline.id, "UNIT", "PASSED", "ok");
    for (const kind of ["TYPECHECK", "INTEGRATION", "SECURITY", "BUILD", "BROWSER", "EVALUATION", "SMOKE"] as const) {
      first.updateCheck(pipeline.id, kind, "PASSED", "ok");
    }
    first.promote(pipeline.id, "STAGING");
    first.promote(pipeline.id, "SMOKE");

    vi.resetModules();
    const second = await import("../../lib/cicd");
    const reloaded = second.listPipelines().find(entry => entry.id === pipeline.id);
    expect(reloaded).toBeTruthy();
    expect(reloaded!.stage).toBe("SMOKE");
    expect(reloaded!.checks.filter(check => check.status === "PASSED")).toHaveLength(9);

    // Production bleibt an die Smoke-Stufe und vollständige Prüfungen gebunden.
    expect(second.promote(pipeline.id, "PRODUCTION").stage).toBe("PRODUCTION");
  });

  it("blockiert Production auch nach Neustart, wenn Prüfungen fehlen", async () => {
    const first = await import("../../lib/cicd");
    const pipeline = first.createPipeline({taskId: "TASK-2", branch: "feature/y"});
    first.promote(pipeline.id, "STAGING");
    first.promote(pipeline.id, "SMOKE");

    vi.resetModules();
    const second = await import("../../lib/cicd");
    expect(() => second.promote(pipeline.id, "PRODUCTION")).toThrow(/verification incomplete/);
  });

  it("behält Werkstatt-Objekte und Ausführungshistorie", async () => {
    const first = await import("../../lib/workshop");
    const item = first.createWorkshopItem({
      kind: "TOOL",
      name: "Beispielwerkzeug",
      description: "Test",
      version: "1.0.0",
      capabilities: ["sandbox.snapshot"],
      risk: "LOW",
      dependencies: [],
      provenance: "unit-test",
      tests: []
    });
    first.advanceWorkshop(item.id, "SPECIFICATION");

    vi.resetModules();
    const second = await import("../../lib/workshop");
    const reloaded = second.listWorkshop().find(entry => entry.id === item.id);
    expect(reloaded?.stage).toBe("SPECIFICATION");

    const execution = await import("../../lib/workshop-execution");
    const run = execution.executeWorkshopStep(item.id, "PROTOTYPE");
    expect(run.run.status).toBe("SUCCEEDED");

    vi.resetModules();
    const executionsAgain = await import("../../lib/workshop-execution");
    expect(executionsAgain.listWorkshopExecutions().some(entry => entry.workshopId === item.id)).toBe(true);
  });

  it("behält registrierte Skills", async () => {
    const first = await import("../../lib/skills");
    first.registerSkill({
      id: "skill.example",
      name: "Beispiel",
      description: "Test",
      lifecycle: "VALIDATED",
      capabilities: ["sandbox.snapshot"],
      risk: "LOW"
    } as never);

    vi.resetModules();
    const second = await import("../../lib/skills");
    expect(second.listSkills().map(skill => skill.id)).toContain("skill.example");
  });

  it("behält Agenten-Übergaben", async () => {
    const first = await import("../../lib/agent-fabric");
    const handoff = first.requestHandoff("AG-PLAN", "AG-BUILD", "TASK-3", "Umsetzung");

    vi.resetModules();
    const second = await import("../../lib/agent-fabric");
    const reloaded = second.listHandoffs().find(entry => entry.id === handoff.id);
    expect(reloaded?.status).toBe("REQUESTED");

    second.resolveHandoff(handoff.id, "ACCEPTED");
    vi.resetModules();
    const third = await import("../../lib/agent-fabric");
    expect(third.listHandoffs().find(entry => entry.id === handoff.id)?.status).toBe("ACCEPTED");
  });
});
