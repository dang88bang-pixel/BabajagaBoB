import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Experiment-Engine: Replikation und Gegenbeispiel mit **echten** Läufen
 * (Fertigstellungsplan Phase 2, Punkt 5.3).
 *
 * Der Positivpfad bis `ESTABLISHED` ist in `tests/security/causal-integrity.test.ts`
 * abgedeckt. Hier werden die Negativäste der Kausalprüfung gegen die echte
 * Runtime belegt:
 *
 *  1. Zwei Replikationen mit unterschiedlichem Ausgang → „replications
 *     disagree" → kein ESTABLISHED (nur Übereinstimmung zählt).
 *  2. Eine Replikation mit Exit-Code ungleich 0 → „replication rejected" →
 *     Wissenszustand CONTRADICTED statt Erfolgsbehauptung.
 *  3. Ein argv-Policy-Verstoß (Shell-Interpreter) → Broker-Verweigerung ohne
 *     aufgezeichneten Lauf (fail closed, keine Schein-Beobachtung).
 *
 * Ein einzelner erfolgreicher Lauf darf niemals ESTABLISHED ergeben
 * (MASTER_COMPLETION_SPEC §12/§13).
 */

isolatedStorageRoot("science-replication");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let science: typeof import("../../lib/science");

let task: ReturnType<typeof cp.createTask>;
let sandbox: Awaited<ReturnType<typeof fabric.createSandbox>>;

const issueToken = () =>
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

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  science = await import("../../lib/science");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Replikations-Tester"});

  const mission = cp.createMission({title: "Replikations-Mission", objective: "Negativäste der Kausalprüfung", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: "Replikation", description: "Abweichende und verweigerte Replikationen"});
  task = cp.createTask({missionId: mission.missionId, objectiveId: objective.objectiveId, title: "Replikations-Task", risk: "LOW", assignedAgent: "AG-SCIENTIST", createdBy: "CREATOR"});
  sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-SCIENTIST", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
}, 120_000);

describe("Replikation: Übereinstimmung ist Pflicht", () => {
  it("verweigert ESTABLISHED, sobald zwei Replikationen abweichen", async () => {
    const experiment = science.createExperiment({
      experimentId: "EXP-REPL-DISAGREE",
      missionId: task.missionId,
      objectiveId: task.objectiveId!,
      title: "Abweichende Replikation",
      taskId: task.taskId,
      agentId: "AG-SCIENTIST",
      sandboxId: sandbox.sandboxId,
      hypothesis: "x bewirkt y",
      baseline: "Baseline",
      control: "Kontrolle",
      variables: ["x"],
      confounders: [],
      expectedResult: "y ändert sich",
      alternativeExplanations: []
    });

    const run = (kind: "BASELINE" | "CONTROL" | "REPLICATION", code: string) =>
      science.runExperiment({
        experimentId: experiment.experimentId,
        kind,
        sandboxId: sandbox.sandboxId,
        // Keine Shell-Metazeichen im argv (argv-Policy) — auch `;` ist verboten.
        argv: ["node", "-e", code],
        agentId: "AG-SCIENTIST",
        taskId: task.taskId,
        capabilityTokenId: issueToken().token.id,
        environment: "test"
      });

    // Alle drei Pflichtläufe werden akzeptiert ausgeführt.
    expect((await run("BASELINE", "process.stdout.write('baseline-ok')")).accepted).toBe(true);
    expect((await run("CONTROL", "process.stdout.write('control-ok')")).accepted).toBe(true);
    expect((await run("REPLICATION", "process.stdout.write('replikation-1')")).accepted).toBe(true);
    // Zweite Replikation mit abweichendem Exit-Code → andere Signatur.
    expect((await run("REPLICATION", "process.stdout.write('replikation-2'),process.exitCode=1")).accepted).toBe(false);

    const record = science.getExperiment(experiment.experimentId)!;
    expect(record.replicationCount).toBe(2);

    // Unabhängige Evidenz ist vorhanden — trotzdem darf die Abweichung nicht
    // als belegt gelten.
    science.addEvidence({experimentId: experiment.experimentId, kind: "REPRODUCTION", claim: "teilrepliziert", value: "uneinheitlich", knowledgeState: "SUPPORTED"});
    const validation = science.validateCausalChain(experiment.experimentId);
    expect(validation.valid).toBe(false);
    expect(validation.knowledgeState).not.toBe("ESTABLISHED");
    expect(validation.reasons).toContain("replications disagree");
    expect(validation.replicationAgreement).toBeLessThan(1);
  }, 180_000);
});

describe("Replikation: Fehlschlag ist ein Gegenbeispiel", () => {
  it("stuft das Wissen auf CONTRADICTED, wenn die Replikation mit Fehlschlag endet", async () => {
    const experiment = science.createExperiment({
      experimentId: "EXP-REPL-REJECTED",
      missionId: task.missionId,
      objectiveId: task.objectiveId!,
      title: "Fehlgeschlagene Replikation",
      taskId: task.taskId,
      agentId: "AG-SCIENTIST",
      sandboxId: sandbox.sandboxId,
      hypothesis: "x bewirkt y",
      baseline: "Baseline",
      control: "Kontrolle",
      variables: ["x"],
      confounders: [],
      expectedResult: "y ändert sich",
      alternativeExplanations: []
    });

    // Eine real ausgeführte Replikation mit Exit-Code ungleich 0 ist kein
    // Erfolg: accepted=false, Wissenszustand CONTRADICTED statt Behauptung.
    const failed = await science.runExperiment({
      experimentId: experiment.experimentId,
      kind: "REPLICATION",
      sandboxId: sandbox.sandboxId,
      argv: ["node", "-e", "process.exitCode=7"],
      agentId: "AG-SCIENTIST",
      taskId: task.taskId,
      capabilityTokenId: issueToken().token.id,
      environment: "test"
    });
    expect(failed.accepted).toBe(false);
    expect(failed.exitCode).toBe(7);

    const validation = science.validateCausalChain(experiment.experimentId);
    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("replication rejected");
    expect(validation.knowledgeState).toBe("CONTRADICTED");

    const summary = science.experimentSummary();
    expect(summary.contradicted).toBeGreaterThanOrEqual(1);
    expect(summary.established).toBe(0);
  }, 120_000);

  it("lässt einen argv-Policy-Verstoß als Verweigerung scheitern (fail closed, keine Schein-Beobachtung)", async () => {
    const experiment = science.createExperiment({
      experimentId: "EXP-REPL-POLICY",
      missionId: task.missionId,
      objectiveId: task.objectiveId!,
      title: "Policy-Verweigerung",
      taskId: task.taskId,
      agentId: "AG-SCIENTIST",
      sandboxId: sandbox.sandboxId,
      hypothesis: "x bewirkt y",
      baseline: "Baseline",
      control: "Kontrolle",
      variables: ["x"],
      confounders: [],
      expectedResult: "y ändert sich",
      alternativeExplanations: []
    });

    // Shell-Interpreter sind in jedem argv-Element verboten: Der Broker wirft
    // eine Verweigerung, statt einen Lauf aufzuzeichnen.
    await expect(
      science.runExperiment({
        experimentId: experiment.experimentId,
        kind: "REPLICATION",
        sandboxId: sandbox.sandboxId,
        argv: ["sh", "-c", "echo replikation"],
        agentId: "AG-SCIENTIST",
        taskId: task.taskId,
        capabilityTokenId: issueToken().token.id,
        environment: "test"
      })
    ).rejects.toThrow(/shell interpreter 'sh' is forbidden/);

    // Es wurde kein Lauf aufgezeichnet — die Verweigerung ist keine Beobachtung.
    expect(science.listExperimentRuns(experiment.experimentId)).toHaveLength(0);
    expect(science.validateCausalChain(experiment.experimentId).knowledgeState).toBe("HYPOTHESIS");
  }, 120_000);
});
