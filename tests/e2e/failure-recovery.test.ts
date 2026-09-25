import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("e2e-failure");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let errors: typeof import("../../lib/error-intelligence");
let reliability: typeof import("../../lib/reliability");
let knowledge: typeof import("../../lib/knowledge");
let audit: typeof import("../../lib/audit");
let runs: typeof import("../../lib/runs");

const AGENT = "AG-BUILD";

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  broker = await import("../../lib/execution-broker");
  errors = await import("../../lib/error-intelligence");
  reliability = await import("../../lib/reliability");
  knowledge = await import("../../lib/knowledge");
  audit = await import("../../lib/audit");
  runs = await import("../../lib/runs");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("E2E: bewusster Fehler → Recovery → Regression → Knowledge (Abschnitt 49)", () => {
  it("durchläuft DETECTED bis REGRESSION_LOCKED mit echter Runtime, Snapshot und Verifikation", async () => {
    // --- Setup: Task + Sandbox + autorisierte Ausführung -------------------
    const mission = cp.createMission({title: "Fehler-Mission", objective: "Ausfall reproduzieren", createdBy: "CREATOR"});
    const objective = cp.createObjective({missionId: mission.missionId, title: "Fehler-Objective", description: "Recovery nachweisen"});
    const task = cp.createTask({
      missionId: mission.missionId,
      objectiveId: objective.objectiveId,
      title: "Fehler-Task",
      risk: "LOW",
      assignedAgent: AGENT,
      createdBy: "CREATOR"
    });
    const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: AGENT, risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);
    const run = runs.createRun({taskId: task.taskId, agentId: AGENT, risk: "LOW", sandboxId: sandbox.sandboxId});
    const issued = authority.issueCapabilityToken({
      subject: AGENT,
      taskId: task.taskId,
      sandboxId: sandbox.sandboxId,
      environment: "development",
      capabilities: ["task:execute", "sandbox:run"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });

    // --- Der bewusste Fehler: Ausführung endet mit Exit-Code 7 -------------
    const failed = await broker.executeAuthorized({
      taskId: task.taskId,
      agentId: AGENT,
      sandboxId: sandbox.sandboxId,
      capabilityTokenId: issued.token.id,
      runId: run.runId,
      environment: "development",
      // Bewusst fehlschlagend, aber ohne Shell-String: Exit-Code 7.
      argv: ["node", "-e", "process.exit(7)"]
    });
    expect(failed.accepted).toBe(false);
    expect(failed.exitCode).toBe(7);

    // --- Error Intelligence: DETECTED → DIAGNOSING ------------------------
    const incident = errors.createErrorIncident({
      severity: "HIGH",
      symptom: "Prozess endet mit Exit-Code 7",
      incident: "Autorisierte Ausführung beendet sich vorzeitig",
      failureMode: "Nicht behandelter Abbruch",
      contributingFactors: ["fehlende Fehlerbehandlung"],
      prevention: [],
      evidenceIds: [],
      taskId: task.taskId,
      runId: run.runId,
      agentId: AGENT,
      sandboxId: sandbox.sandboxId
    });
    expect(incident.status).toBe("DETECTED");

    const diagnosed = await errors.investigateError(incident.incidentId);
    expect(diagnosed.status).toBe("DIAGNOSING");
    expect(diagnosed.failureId).toBeTruthy();
    expect(diagnosed.diagnosticSandboxId).toMatch(/^SB-DIAG-/);

    // Diagnosesandbox muss real laufen (Integrationsnachweis).
    const diagnosticSandbox = cp.getControlState().sandboxes.find(s => s.sandboxId === diagnosed.diagnosticSandboxId);
    expect(diagnosticSandbox?.lifecycle).toBe("RUNNING");

    // --- Hypothese, Experiment, Evidenz, Root Cause ------------------------
    expect(errors.formHypothesis(incident.incidentId, "Der Abbruch entsteht durch die unbehandelte Fehlerbedingung im Lauf")).toBeTruthy();
    const experimenting = errors.startExperiment(incident.incidentId);
    expect(experimenting.status).toBe("EXPERIMENTING");
    expect(experimenting.experimentId).toMatch(/^EXP-/);

    const withEvidence = errors.recordExperimentEvidence(incident.incidentId, "reproduction", "Exit-Code 7 tritt reproduzierbar auf");
    expect(withEvidence.evidenceIds.length).toBeGreaterThan(0);

    const rooted = errors.establishRootCause(incident.incidentId, "Fehlerbedingung wird nicht behandelt und bricht den Lauf ab", []);
    expect(rooted.status).toBe("ROOT_CAUSE_FOUND");

    // --- Recovery: Snapshot, Restore, Verifikation -------------------------
    const fixing = await errors.prepareErrorRecovery(incident.incidentId);
    expect(fixing.status).toBe("FIXING");
    expect(fixing.recoveryId).toBeTruthy();

    const plan = await errors.executeRecoveryForIncident(incident.incidentId);
    expect(plan.status).toBe("EXECUTING");
    expect(plan.checkpointSnapshotId).toBeTruthy();

    // --- Regression: "Never Again" dauerhaft absichern ---------------------
    const withRegression = errors.createRegressionTest(incident.incidentId, ["node", "-e", "process.stdout.write('fixed')"]);
    expect(withRegression.regressionId).toMatch(/^REG-/);

    const verifiedRecovery = await errors.verifyRecoveryForIncident(incident.incidentId);
    expect(verifiedRecovery.status).toBe("VERIFIED");
    expect(verifiedRecovery.verificationId).toBeTruthy();
    // Eine verifizierte Recovery führt den Incident in die Fix-Verifikation;
    // der Eintritt ist idempotent (kein zweiter VERIFYING-Übergang).
    expect(errors.getErrorIncident(incident.incidentId)?.status).toBe("VERIFYING");

    // --- Verifikation des Fixes → LEARNED → REGRESSION_LOCKED --------------
    const fixVerification = await errors.verifyFix(incident.incidentId);
    expect(fixVerification.passed).toBe(true);
    // Der Eintritt in die Verifikationsphase ist idempotent: ein zweiter Aufruf
    // nach bereits gelerntem Fix bleibt erfolgreich und wirft keinen Statusfehler.
    const reverified = await errors.verifyFix(incident.incidentId);
    expect(reverified.passed).toBe(true);

    const locked = errors.learnFromError(incident.incidentId, "Fehlerbedingung wird behandelt; der Lauf bricht nicht mehr ab", "Regression-Suite bestanden");
    expect(locked.status).toBe("REGRESSION_LOCKED");
    expect(locked.knowledgeId).toBeTruthy();

    // --- Knowledge: negatives Wissen + semantische Ursache, verlinkt -------
    const negative = knowledge.negativeKnowledge().find(node => node.knowledgeId === locked.knowledgeId);
    expect(negative).toBeTruthy();
    expect(negative?.state).toBe("ESTABLISHED");
    expect(knowledge.knowledgeSummary().total).toBeGreaterThan(0);
    const semantic = knowledge.searchKnowledge("Nicht behandelter Abbruch").filter(node => node.layer === "SEMANTIC");
    expect(semantic.length).toBeGreaterThan(0);

    // --- Failure- und Recovery-Status sind verifiziert, nicht behauptet ----
    const failure = reliability.listFailures().find(record => record.failureId === diagnosed.failureId);
    expect(failure?.status).toBe("VERIFIED");
    expect(failure?.rootCause).toContain("Fehlerbedingung");
    expect(failure?.regressionId).toBe(withRegression.regressionId);
    // Genau ein Regressionstest pro Incident (kein Duplikat).
    const testsForIncident = (await import("../../lib/regression")).listRegressionTests().filter(test => test.incidentId === incident.incidentId);
    expect(testsForIncident.map(test => test.regressionId)).toEqual([withRegression.regressionId]);
    const storedPlan = reliability.getRecoveryPlan(fixing.recoveryId!);
    expect(storedPlan?.status).toBe("VERIFIED");

    // --- Audit- und Event-Kette bleiben integer ----------------------------
    expect(audit.verifyAuditChain().valid).toBe(true);
    const events = (await import("../../lib/events/log")).listDomainEvents({limit: 500});
    expect(events.some(event => event.type === "execution.failed")).toBe(true);
    expect(events.some(event => event.type === "recovery.verified")).toBe(true);
    expect(events.some(event => event.type === "regression.suite.passed")).toBe(true);
    expect(events.some(event => event.type === "error.learned" || event.type === "knowledge.upserted")).toBe(true);
  });

  it("verweigert Root Cause ohne Evidenz (kein Erfolg ohne Nachweis)", async () => {
    const mission = cp.createMission({title: "Evidenz-Mission", objective: "Evidenzpflicht prüfen", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Evidenz-Task", risk: "LOW", assignedAgent: AGENT, createdBy: "CREATOR"});
    const incident = errors.createErrorIncident({
      severity: "LOW",
      symptom: "Testfall ohne Evidenz",
      incident: "Evidenzpflicht prüfen",
      failureMode: "unbekannt",
      contributingFactors: [],
      prevention: [],
      evidenceIds: [],
      taskId: task.taskId,
      agentId: AGENT
    });
    const diagnosed = await errors.investigateError(incident.incidentId);
    expect(diagnosed.status).toBe("DIAGNOSING");
    expect(diagnosed.diagnosticSandboxId).toBeTruthy();
    errors.formHypothesis(incident.incidentId, "Eine Hypothese ohne Evidenz");
    expect(errors.startExperiment(incident.incidentId).status).toBe("EXPERIMENTING");
    expect(() => errors.establishRootCause(incident.incidentId, "Ursache ohne jeden Nachweis", [])).toThrow(/evidence/i);
  });
});
