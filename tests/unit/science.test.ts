import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Eigener Test für die Experiment-Engine (Science Layer) auf Modulebene
 * (Fertigstellungsplan Phase 2, Punkt 5.3). Die Kausalvalidierung mit realen
 * Läufen ist in `tests/security/causal-integrity.test.ts` abgedeckt; hier
 * werden Validierung, Zustände und Datenmodell des Moduls selbst geprüft —
 * ohne Ausführungen und ohne Funktionsänderung.
 */

let root = "";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-science-"));
  process.env.BOB_STORAGE_DIR = root;
  process.env.BOB_SANDBOX_RUNTIME = "local";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.BOB_STORAGE_DIR;
  delete process.env.BOB_BOOTSTRAP_SECRET;
  fs.rmSync(root, {recursive: true, force: true});
});

const validExperiment = (experimentId: string) => ({
  experimentId,
  missionId: "MIS-SCI-1",
  objectiveId: "OBJ-SCI-1",
  title: "Science-Test",
  taskId: "TASK-SCI-1",
  agentId: "AG-SCIENTIST",
  sandboxId: "SB-SCI-1",
  hypothesis: "x bewirkt y",
  baseline: "Baseline-Bedingung",
  control: "Kontroll-Bedingung",
  variables: ["x"],
  confounders: [] as string[],
  expectedResult: "y ändert sich",
  alternativeExplanations: [] as string[]
});

describe("Science Layer: Datenmodell und Validierung", () => {
  it("verlangt für Forschungsziele Titel und Beschreibung", async () => {
    const {createObjective} = await import("../../lib/science");
    expect(() => createObjective({missionId: "MIS-1", title: "", description: "d"})).toThrow(/title required/);
    expect(() => createObjective({missionId: "MIS-1", title: "t", description: "   "})).toThrow(/description required/);
    const objective = createObjective({missionId: "MIS-1", title: "Ziel", description: "Beschreibung"});
    expect(objective.objectiveId).toMatch(/^OBJ-/);
    expect(objective.status).toBe("PLANNED");
  });

  it("verlangt für Experimente Hypothese, Baseline, Kontrolle und Erwartung als Struktur", async () => {
    const {createExperiment} = await import("../../lib/science");
    expect(() => createExperiment({...validExperiment("EXP-SCI-A"), baseline: ""})).toThrow(/baseline required/);
    expect(() => createExperiment({...validExperiment("EXP-SCI-B"), variables: "x" as never})).toThrow(/variables required/);
    expect(() => createExperiment({...validExperiment("EXP-SCI-C"), confounders: null as never})).toThrow(/confounders required/);

    const experiment = createExperiment(validExperiment("EXP-SCI-D"));
    expect(experiment.knowledgeState).toBe("HYPOTHESIS");
    expect(experiment.status).toBe("PLANNING");
    expect(experiment.progress).toBe(0);
    expect(experiment.replicationCount).toBe(0);
    expect(experiment.evidenceIds).toEqual([]);
  });

  it("verweigert doppelte Experiment-Kennungen", async () => {
    const {createExperiment} = await import("../../lib/science");
    createExperiment(validExperiment("EXP-SCI-DUP"));
    expect(() => createExperiment(validExperiment("EXP-SCI-DUP"))).toThrow(/already exists/);
  });

  it("blockiert die direkte Beförderung nach ESTABLISHED (nur die Kausalprüfung darf das)", async () => {
    const {createExperiment, updateExperiment} = await import("../../lib/science");
    createExperiment(validExperiment("EXP-SCI-PROMO"));
    expect(() => updateExperiment("EXP-SCI-PROMO", {knowledgeState: "ESTABLISHED"})).toThrow(/validateCausalChain/);
    // Andere Zustandsfelder bleiben aktualisierbar.
    const updated = updateExperiment("EXP-SCI-PROMO", {status: "EXPERIMENT", progress: 25});
    expect(updated.status).toBe("EXPERIMENT");
    expect(updated.progress).toBe(25);
    expect(() => updateExperiment("EXP-UNBEKANNT", {progress: 1})).toThrow(/not found/);
  });

  it("verknüpft Evidenz mit dem Experiment und filtert sie je Experiment", async () => {
    const {createExperiment, addEvidence, listEvidence} = await import("../../lib/science");
    createExperiment(validExperiment("EXP-SCI-EVD"));
    const evidence = addEvidence({experimentId: "EXP-SCI-EVD", kind: "MEASUREMENT", claim: "y geändert", value: "42", knowledgeState: "SUPPORTED"});
    expect(evidence.evidenceId).toMatch(/^EVD-/);
    const experiment = (await import("../../lib/science")).getExperiment("EXP-SCI-EVD")!;
    expect(experiment.evidenceIds).toContain(evidence.evidenceId);
    expect(listEvidence("EXP-SCI-EVD")).toHaveLength(1);
    expect(listEvidence("EXP-ANDERES")).toHaveLength(0);
  });

  it("nennt in der Kausalprüfung ohne Läufe alle fehlenden Bausteine (HYPOTHESIS, nicht ESTABLISHED)", async () => {
    const {createExperiment, validateCausalChain, getExperiment} = await import("../../lib/science");
    createExperiment(validExperiment("EXP-SCI-VAL"));
    const validation = validateCausalChain("EXP-SCI-VAL");
    expect(validation.valid).toBe(false);
    expect(validation.knowledgeState).toBe("HYPOTHESIS");
    expect(validation.reasons).toEqual(expect.arrayContaining([
      "baseline missing",
      "control group missing",
      "replication missing",
      "no evidence recorded"
    ]));
    // Das Experiment wird dadurch nicht stillschweigend abgeschlossen.
    expect(getExperiment("EXP-SCI-VAL")!.status).toBe("EXPERIMENT");
  });

  it("verlangt zu dokumentierten Confoundern auch alternative Erklärungen", async () => {
    const {createExperiment, validateCausalChain} = await import("../../lib/science");
    createExperiment({...validExperiment("EXP-SCI-CONF"), confounders: ["Tageszeit"]});
    const validation = validateCausalChain("EXP-SCI-CONF");
    expect(validation.reasons).toContain("confounders present but no alternative explanations documented");
  });

  it("dokumentiert Entscheidungen persistent und zählt Wissenszustände", async () => {
    const science = await import("../../lib/science");
    science.createExperiment(validExperiment("EXP-SCI-SUM"));
    const decision = science.createDecision({
      taskId: "TASK-SCI-1",
      objective: "Auswahl des Experiments",
      observations: ["Beobachtung"],
      assumptions: ["Annahme"],
      hypothesis: "x bewirkt y",
      options: ["EXP-SCI-SUM"],
      expectedResult: "y ändert sich",
      conclusion: "Experiment gewählt",
      nextAction: "Baseline messen",
      evidenceIds: []
    });
    expect(decision.decisionId).toMatch(/^ADR-/);
    expect(science.listScience().decisions.map(d => d.decisionId)).toContain(decision.decisionId);

    const summary = science.experimentSummary();
    expect(summary.total).toBe(1);
    expect(summary.hypotheses).toBe(1);
    expect(summary.established).toBe(0);
    expect(summary.contradicted).toBe(0);

    const report = science.scienceStoreReport();
    expect(report.ok).toBe(true);
  });
});
