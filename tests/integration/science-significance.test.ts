import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Signifikanzprüfung in der Kausalvalidierung (Abschnitt 15).
 *
 * Der Punkt dieser Suite ist die Umkehrung des Erfolgsnachweises: Ein
 * Experiment, das alle bisherigen Regeln erfüllt (Baseline, Kontrolle,
 * Replikation, Evidenz), darf **nicht** als `ESTABLISHED` gelten, wenn der
 * gemessene Unterschied auch Zufall sein kann. Umgekehrt bleibt ein Experiment
 * ohne Messwerte unverändert gültig — die Prüfung darf vorhandene Nachweise
 * nicht entwerten, sondern ergänzt sie um eine weitere Bedingung.
 *
 * Geprüft werden daher vier Zustände: ohne Messwerte, mit unzureichenden
 * Messwerten, mit einem nicht tragfähigen Unterschied und mit einem tragfähigen.
 */

let root = "";
let modules: {
  bootstrap: typeof import("../../lib/bootstrap");
  cp: typeof import("../../lib/control-plane");
  fabric: typeof import("../../lib/sandbox/fabric");
  authority: typeof import("../../lib/authority");
  science: typeof import("../../lib/science");
};

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-science-sig-"));
  process.env.BOB_STORAGE_DIR = root;
  process.env.BOB_SANDBOX_RUNTIME = "local";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  vi.resetModules();
  modules = {
    bootstrap: await import("../../lib/bootstrap"),
    cp: await import("../../lib/control-plane"),
    fabric: await import("../../lib/sandbox/fabric"),
    authority: await import("../../lib/authority"),
    science: await import("../../lib/science")
  };
  modules.bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Signifikanz-Tester"});
});

afterEach(() => {
  delete process.env.BOB_STORAGE_DIR;
  delete process.env.BOB_BOOTSTRAP_SECRET;
  fs.rmSync(root, {recursive: true, force: true});
});

/**
 * Legt ein vollständiges Experiment an: echte Läufe über den Broker
 * (Baseline ×2, Kontrolle ×2, Replikation ×2) plus unabhängige Evidenz.
 * Jede Ausführung erhält ihre eigene Autorisierung (Tokens sind einmalig).
 */
async function buildCompleteExperiment(label: string) {
  const {cp, fabric, authority, science} = modules;
  const mission = cp.createMission({title: `Signifikanz ${label}`, objective: "Tragfähigkeit", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: `OBJ-${label}`, description: "Signifikanz"});
  const task = cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: `Signifikanz-Task ${label}`,
    risk: "LOW",
    assignedAgent: "AG-SCIENTIST",
    createdBy: "CREATOR"
  });
  const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-SCIENTIST", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  const issueFor = () =>
    authority.issueCapabilityToken({
      subject: "AG-SCIENTIST",
      taskId: task.taskId,
      sandboxId: sandbox.sandboxId,
      environment: "test",
      capabilities: ["task:execute", "sandbox:run"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    });
  const experiment = science.createExperiment({
    experimentId: `EXP-SIG-${label}`,
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: `Signifikanz ${label}`,
    taskId: task.taskId,
    agentId: "AG-SCIENTIST",
    sandboxId: sandbox.sandboxId,
    hypothesis: "x bewirkt y",
    baseline: "ohne Eingriff",
    control: "mit Eingriff",
    variables: ["x"],
    confounders: [],
    expectedResult: "y steigt",
    alternativeExplanations: []
  });

  // Die Läufe gehören zum Experiment — erst anlegen, dann ausführen.
  const run = (kind: "BASELINE" | "CONTROL" | "REPLICATION", output: string) =>
    science.runExperiment({
      experimentId: experiment.experimentId,
      kind,
      sandboxId: sandbox.sandboxId,
      argv: ["node", "-e", `process.stdout.write('${output}')`],
      agentId: "AG-SCIENTIST",
      taskId: task.taskId,
      capabilityTokenId: issueFor().token.id,
      environment: "test"
    });

  await run("BASELINE", "baseline-1");
  await run("BASELINE", "baseline-2");
  await run("CONTROL", "control-1");
  await run("CONTROL", "control-2");
  await run("REPLICATION", "replicated-1");
  await run("REPLICATION", "replicated-1");
  science.addEvidence({
    experimentId: experiment.experimentId,
    kind: "REPRODUCTION",
    claim: "reproduziert",
    value: "zwei unabhängige Replikationen",
    knowledgeState: "SUPPORTED"
  });
  return {experiment, task, sandbox};
}

describe("Signifikanz in der Kausalvalidierung", () => {
  it("behält die bisherige Gültigkeit ohne Messwerte bei (kein Nachteil, kein Erfolg)", async () => {
    const {science} = modules;
    const {experiment} = await buildCompleteExperiment("A");

    const validation = science.validateCausalChain(experiment.experimentId);
    expect(validation.valid).toBe(true);
    expect(validation.knowledgeState).toBe("ESTABLISHED");
    expect(validation.measurementCount).toBe(0);
    // Keine Messwerte → keine Aussage, und ausdrücklich kein „signifikant“.
    expect(validation.significance.computed).toBe(false);
    expect(validation.significance.significant).toBeNull();
    expect(validation.significance.reason).toMatch(/fehlen numerische Messwerte/i);
  });

  it("blockiert ESTABLISHED, wenn der Unterschied nicht tragfähig ist", async () => {
    const {science} = modules;
    const {experiment} = await buildCompleteExperiment("B");

    // Zwei Messungen je Gruppe, Unterschied deutlich kleiner als die Streuung.
    for (const value of [100, 110]) science.addMeasurement({experimentId: experiment.experimentId, group: "BASELINE", label: "dauer-ms", value});
    for (const value of [102, 112]) science.addMeasurement({experimentId: experiment.experimentId, group: "CONTROL", label: "dauer-ms", value});

    const validation = science.validateCausalChain(experiment.experimentId);
    expect(validation.measurementCount).toBe(4);
    expect(validation.significance.computed).toBe(true);
    expect(validation.significance.method).toBe("WELCH_T");
    expect(validation.significance.significant).toBe(false);
    expect(validation.valid).toBe(false);
    expect(validation.knowledgeState).not.toBe("ESTABLISHED");
    expect(validation.reasons.join(" | ")).toMatch(/not statistically significant/);
    // Die Stichprobe ist zusätzlich zu klein — beide Grenzen werden benannt.
    expect(validation.significance.confidence).toBe("INSUFFICIENT");
    expect(validation.reasons.join(" | ")).toMatch(/sample size below the required/);
  });

  it("akzeptiert ESTABLISHED nur mit tragfähigem Unterschied", async () => {
    const {science} = modules;
    const {experiment} = await buildCompleteExperiment("C");

    for (const value of [100, 101, 99, 100]) science.addMeasurement({experimentId: experiment.experimentId, group: "BASELINE", label: "dauer-ms", value});
    for (const value of [120, 121, 119, 120]) science.addMeasurement({experimentId: experiment.experimentId, group: "CONTROL", label: "dauer-ms", value});

    const validation = science.validateCausalChain(experiment.experimentId);
    expect(validation.significance.computed).toBe(true);
    expect(validation.significance.significant).toBe(true);
    expect(validation.significance.confidence).toBe("SUFFICIENT");
    expect(validation.significance.confidenceInterval).not.toBeNull();
    expect(validation.valid).toBe(true);
    expect(validation.knowledgeState).toBe("ESTABLISHED");
    expect(validation.reasons).toEqual([]);
  });

  it("weist nicht-endliche und falsch skalierte Messwerte ab", async () => {
    const {science} = modules;
    const {experiment} = await buildCompleteExperiment("D");

    expect(() =>
      science.addMeasurement({experimentId: experiment.experimentId, group: "BASELINE", label: "dauer-ms", value: Number.NaN})
    ).toThrow(/finite number/);
    expect(() =>
      science.addMeasurement({experimentId: experiment.experimentId, group: "BASELINE", label: "dauer-ms", value: Number.POSITIVE_INFINITY})
    ).toThrow(/finite number/);
    expect(() =>
      science.addMeasurement({experimentId: experiment.experimentId, group: "IRGENDWAS" as never, label: "dauer-ms", value: 1})
    ).toThrow(/BASELINE, CONTROL or REPLICATION/);

    const valid = science.addMeasurement({experimentId: experiment.experimentId, group: "BASELINE", label: "dauer-ms", value: 101});
    expect(valid.measurementId).toMatch(/^MEA-/);
    expect(science.listMeasurements(experiment.experimentId)).toHaveLength(1);
  });

  it("zählt Messwerte und prüfbare Experimente in der Übersicht", async () => {
    const {science} = modules;
    const first = await buildCompleteExperiment("E1");
    const second = await buildCompleteExperiment("E2");

    science.addMeasurement({experimentId: first.experiment.experimentId, group: "BASELINE", label: "dauer-ms", value: 100});
    science.addMeasurement({experimentId: first.experiment.experimentId, group: "BASELINE", label: "dauer-ms", value: 101});
    science.addMeasurement({experimentId: first.experiment.experimentId, group: "CONTROL", label: "dauer-ms", value: 130});
    science.addMeasurement({experimentId: first.experiment.experimentId, group: "CONTROL", label: "dauer-ms", value: 131});

    const summary = science.significanceSummary();
    expect(summary.measurements).toBe(4);
    // Nur das erste Experiment hat beide Gruppen — das zweite ist nicht prüfbar.
    expect(summary.withMeasurements).toBe(1);
    expect(summary.computed).toBe(1);
    expect(summary.significant).toBe(1);
    expect(summary.undecidable).toBe(1);
    expect(second.experiment.experimentId).toMatch(/^EXP-SIG-E2$/);
  });
});
