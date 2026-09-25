import {beforeAll, describe, expect, it, vi} from "vitest";
import fs from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Ausführung → Evidenz (Abschnitt 4): Jede über den Broker autorisierte
 * Ausführung muss einen digest-gebundenen, persistenten Evidenzdatensatz
 * erzeugen, der im Audit und in der Provenance verkettet ist. Geprüft wird auch,
 * dass die Evidenz einen Neustart überlebt und der Digest den Inhalt bindet.
 */

const root = isolatedStorageRoot("execution-evidence");

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let artifacts: typeof import("../../lib/artifacts");
let audit: typeof import("../../lib/audit");
let provenance: typeof import("../../lib/provenance");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  broker = await import("../../lib/execution-broker");
  artifacts = await import("../../lib/artifacts");
  audit = await import("../../lib/audit");
  provenance = await import("../../lib/provenance");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Evidenz-Tester"});
});

async function authorizedExecution(stdout: string) {
  const mission = cp.createMission({title: `Evidenz ${stdout}`, objective: "Nachweis", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: "Objektiv", description: "Nachweis"});
  const task = cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: "Evidenz-Task",
    risk: "LOW",
    assignedAgent: "AG-BUILD",
    createdBy: "CREATOR"
  });
  const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  const token = authority.issueCapabilityToken({
    subject: "AG-BUILD",
    taskId: task.taskId,
    sandboxId: sandbox.sandboxId,
    environment: "test",
    capabilities: ["task:execute", "sandbox:run"],
    risk: "LOW",
    issuedBy: "CREATOR",
    issuedByKind: "CREATOR",
    expiresAt: new Date(Date.now() + 600_000).toISOString()
  });
  const result = await broker.executeAuthorized({
    taskId: task.taskId,
    agentId: "AG-BUILD",
    sandboxId: sandbox.sandboxId,
    capabilityTokenId: token.token.id,
    environment: "test",
    argv: ["node", "-e", `process.stdout.write('${stdout}')`]
  });
  return {task, sandbox, result};
}

describe("Ausführungs-Evidenz", () => {
  it("erzeugt digest-gebundene Evidenz mit Provenance-Verkettung", async () => {
    const {task, sandbox, result} = await authorizedExecution("evidenz-probe");

    expect(result.accepted).toBe(true);
    expect(result.stdout).toBe("evidenz-probe");
    expect(result.evidence?.artifactId).toBeTruthy();
    expect(result.evidence?.verified).toBe(true);

    const artifact = artifacts.getArtifact(result.evidence!.artifactId)!;
    expect(artifact.kind).toBe("EXECUTION");
    expect(artifact.taskId).toBe(task.taskId);
    expect(artifact.sandboxId).toBe(sandbox.sandboxId);
    expect(artifact.agentId).toBe("AG-BUILD");
    expect(artifact.knowledgeState).toBe("OBSERVED");
    expect(artifact.content).toContain("evidenz-probe");
    expect(artifact.digest).toHaveLength(64);
    expect(artifact.truncated).toBe(false);

    // Der Digest bindet den Inhalt, nicht nur einen Verweis.
    expect(artifacts.verifyArtifact(artifact.id).ok).toBe(true);

    // Filter nach Task liefert genau diese Evidenz.
    expect(artifacts.artifactSnapshot({taskId: task.taskId}).map(a => a.id)).toContain(artifact.id);
    expect(artifacts.artifactSnapshot({taskId: "TASK-unbekannt"})).toHaveLength(0);

    // Provenance: Evidenz-Knoten existiert und ist verknüpft.
    const graph = provenance.listProvenance();
    expect(graph.nodes.some(n => n.id === artifact.id && n.kind === "EVIDENCE")).toBe(true);
    expect(graph.edges.some(e => e.to === artifact.id)).toBe(true);

    // Audit-Kette bleibt gültig und enthält die Evidenzaufnahme.
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("persistiert Evidenz im Store (kein In-Memory-Zustand)", async () => {
    const {result} = await authorizedExecution("persistenz-probe");
    const file = path.join(root, "artifacts.json");
    expect(fs.existsSync(file)).toBe(true);
    const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(envelope.version).toBe(1);
    const stored = envelope.payload.artifacts.find((a: {id: string}) => a.id === result.evidence!.artifactId);
    expect(stored).toBeTruthy();
    expect(stored.digest).toBe(result.evidence!.digest);
    expect(stored.content).toContain("persistenz-probe");

    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("kürzt überlange Inhalte sichtbar und hält den Digest prüfbar", async () => {
    const long = "x".repeat(9000);
    const artifact = artifacts.recordArtifact(
      {
        name: "Langausgabe",
        kind: "EXECUTION",
        taskId: "TASK-000",
        runId: "",
        sandboxId: "SB-000",
        agentId: "AG-BUILD",
        knowledgeState: "OBSERVED"
      },
      long
    );
    expect(artifact.truncated).toBe(true);
    expect(artifact.bytes).toBe(9000);
    expect(artifact.content.length).toBe(artifacts.MAX_CONTENT_BYTES);
    expect(artifacts.verifyArtifact(artifact.id).ok).toBe(true);
  });

  it("erkennt manipulierte Evidenz (Digest-Prüfung schlägt an)", () => {
    const artifact = artifacts.recordArtifact(
      {
        name: "Manipulationsprobe",
        kind: "EXECUTION",
        taskId: "TASK-000",
        runId: "",
        sandboxId: "SB-000",
        agentId: "AG-BUILD",
        knowledgeState: "OBSERVED"
      },
      "original"
    );
    expect(artifacts.verifyArtifact(artifact.id).ok).toBe(true);
    // Direkte Manipulation der Store-Datei wird bei der Prüfung sichtbar.
    const file = path.join(root, "artifacts.json");
    const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
    const entry = envelope.payload.artifacts.find((a: {id: string}) => a.id === artifact.id);
    entry.content = "gefälscht";
    // Angreifer rechnet den Envelope-Digest korrekt neu — der Inhalt bleibt
    // trotzdem nachweisbar falsch, weil der Datensatz-Digest den Inhalt bindet.
    envelope.digest = createHash("sha256")
      .update(JSON.stringify({store: envelope.store, version: envelope.version, payload: envelope.payload}))
      .digest("hex");
    fs.writeFileSync(file, JSON.stringify(envelope));
    expect(artifacts.verifyArtifact(artifact.id).ok).toBe(false);

    // Und ein leerer/inhaltsloser Envelope wird als Befund gemeldet, nicht als Absturz.
    fs.writeFileSync(file, JSON.stringify({store: "artifacts", version: envelope.version, writtenAt: new Date().toISOString(), payload: null, digest: createHash("sha256").update(JSON.stringify({store: "artifacts", version: envelope.version, payload: null})).digest("hex")}));
    const broken = artifacts.verifyArtifact(artifact.id);
    expect(broken.ok).toBe(false);
    expect(broken.error).toBeTruthy();
  });
});
