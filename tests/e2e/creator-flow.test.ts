import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("e2e-creator");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let audit: typeof import("../../lib/audit");
let provenance: typeof import("../../lib/provenance");
let knowledge: typeof import("../../lib/knowledge");
let runs: typeof import("../../lib/runs");

const AGENT = "AG-BUILD";

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  broker = await import("../../lib/execution-broker");
  audit = await import("../../lib/audit");
  provenance = await import("../../lib/provenance");
  knowledge = await import("../../lib/knowledge");
  runs = await import("../../lib/runs");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("E2E: Creator → Mission → Objective → Task → Agent → Authorization → Sandbox → Execution → Evidence → Knowledge", () => {
  it("führt den vollständigen autorisierten Pfad aus", async () => {
    const mission = cp.createMission({title: "E2E-Mission", objective: "Autonome Ausführung nachweisen", createdBy: "CREATOR"});
    const objective = cp.createObjective({missionId: mission.missionId, title: "E2E-Objective", description: "Nachweis"});
    const task = cp.createTask({
      missionId: mission.missionId,
      objectiveId: objective.objectiveId,
      title: "E2E-Task",
      risk: "LOW",
      assignedAgent: AGENT,
      createdBy: "CREATOR"
    });
    cp.updateTaskStatus(task.taskId, "RUNNING", 10);

    const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: AGENT, risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);

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

    const run = runs.createRun({taskId: task.taskId, agentId: AGENT, risk: "LOW", sandboxId: sandbox.sandboxId});
    runs.attachExecution(run.runId, `JOB-${run.runId}`, sandbox.sandboxId);

    const execution = await broker.executeAuthorized({
      taskId: task.taskId,
      agentId: AGENT,
      sandboxId: sandbox.sandboxId,
      capabilityTokenId: issued.token.id,
      runId: run.runId,
      environment: "development",
      argv: ["node", "-e", "process.stdout.write('e2e-ok')"]
    });

    expect(execution.accepted).toBe(true);
    expect(execution.stdout).toContain("e2e-ok");

    // Evidence + Wissen
    const evidence = knowledge.upsertKnowledge({
      layer: "EPISODIC",
      subject: task.taskId,
      predicate: "executed_successfully_in",
      object: sandbox.sandboxId,
      state: "OBSERVED",
      sourceIds: [run.runId]
    });
    expect(evidence.knowledgeId).toMatch(/^KN-/);
    expect(knowledge.knowledgeSummary().total).toBeGreaterThan(0);

    // Audit- und Provenance-Kette müssen integer sein.
    const chain = audit.verifyAuditChain();
    expect(chain.valid).toBe(true);
    expect(chain.length).toBeGreaterThan(0);

    const edges = provenance.listProvenance().edges;
    expect(edges.some(edge => edge.relation === "AUTHORIZED_BY")).toBe(true);
    expect(edges.some(edge => edge.relation === "EXECUTED_IN")).toBe(true);
  });

  it("blockiert einen Angriff: Agent → unauthorized capability → DENIED → Audit → Evidence", async () => {
    const mission = cp.createMission({title: "Angriff", objective: "Unbefugte Ausführung", createdBy: "CREATOR"});
    const task = cp.createTask({missionId: mission.missionId, title: "Angriffs-Task", risk: "LOW", assignedAgent: AGENT, createdBy: "CREATOR"});
    const sandbox = await fabric.createSandbox({type: "security", taskId: task.taskId, agentId: AGENT, risk: "LOW"});
    await fabric.startSandbox(sandbox.sandboxId);

    // 1. Selbstvergabe ist verboten und wird auditiert.
    expect(() =>
      authority.issueCapabilityToken({
        subject: AGENT,
        taskId: task.taskId,
        sandboxId: sandbox.sandboxId,
        environment: "development",
        capabilities: ["task:execute"],
        risk: "LOW",
        issuedBy: AGENT,
        issuedByKind: "AGENT",
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      })
    ).toThrow();

    // 2. Ausführung mit fremdem/ungültigem Token wird verweigert.
    await expect(
      broker.executeAuthorized({
        taskId: task.taskId,
        agentId: AGENT,
        sandboxId: sandbox.sandboxId,
        capabilityTokenId: "CAP-UNBEKANNT",
        environment: "development",
        argv: ["node", "-e", "process.stdout.write('darf-nicht-laufen')"]
      })
    ).rejects.toBeInstanceOf(broker.ExecutionDeniedError);

    // 3. Der Angriff ist als DENY auditiert und die Kette bleibt gültig.
    const denials = audit.auditSnapshot(200).filter(record => record.decision === "DENY");
    expect(denials.length).toBeGreaterThan(0);
    expect(audit.verifyAuditChain().valid).toBe(true);

    // 4. Negatives Wissen dokumentiert den Angriff nachvollziehbar.
    const note = knowledge.upsertKnowledge({
      layer: "NEGATIVE",
      subject: "Agent-Selbstautorisierung",
      predicate: "denied_by",
      object: "authority-Selbstvergabe und Broker-Preflight",
      state: "SUPPORTED",
      sourceIds: [task.taskId]
    });
    expect(note.state).toBe("ESTABLISHED");
    expect(knowledge.negativeKnowledge().length).toBeGreaterThan(0);
  });
});
