import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Belastungs- und Grenzprüfung (bounded load test).
 *
 * Geprüft wird: Die Autorisierung bleibt auch unter Nebenläufigkeit intakt —
 * jede Ausführung geht durch Gate und Broker, jede erhält ihre eigene Evidenz,
 * keine Bindung greift auf einen fremden Task/eine fremde Sandbox über, und die
 * Audit-Kette bleibt trotz paralleler Schreibvorgänge integer.
 *
 * Bewusst **kein** Durchsatz-/SLO-Nachweis (keine Zeitreihe, keine
 * Lastkurve): der Test dokumentiert Belastbarkeit, nicht Performance-Ziele.
 */

const root = isolatedStorageRoot("load-broker");

const PARALLEL = 12;
const DENIED = 6;

let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let broker: typeof import("../../lib/execution-broker");
let artifacts: typeof import("../../lib/artifacts");
let audit: typeof import("../../lib/audit");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  broker = await import("../../lib/execution-broker");
  artifacts = await import("../../lib/artifacts");
  audit = await import("../../lib/audit");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Lasttester"});
  expect(root).toContain("load-broker");
});

type Prepared = {taskId: string; sandboxId: string; tokenId: string};

async function prepare(label: string): Promise<Prepared> {
  const mission = cp.createMission({title: `Last ${label}`, objective: "Nebenläufigkeit", createdBy: "CREATOR"});
  const objective = cp.createObjective({missionId: mission.missionId, title: `OBJ-${label}`, description: "Last"});
  const task = cp.createTask({
    missionId: mission.missionId,
    objectiveId: objective.objectiveId,
    title: `Last-Task ${label}`,
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
  return {taskId: task.taskId, sandboxId: sandbox.sandboxId, tokenId: token.token.id};
}

describe("Nebenläufige autorisierte Ausführung", () => {
  it(`führt ${PARALLEL} Ausführungen parallel aus und bindet jede Evidenz korrekt`, async () => {
    const prepared = await Promise.all(Array.from({length: PARALLEL}, (_, index) => prepare(String(index + 1))));

    const results = await Promise.all(
      prepared.map((entry, index) =>
        broker.executeAuthorized({
          taskId: entry.taskId,
          agentId: "AG-BUILD",
          sandboxId: entry.sandboxId,
          capabilityTokenId: entry.tokenId,
          environment: "test",
          argv: ["node", "-e", `process.stdout.write('parallel-${index}')`]
        })
      )
    );

    expect(results).toHaveLength(PARALLEL);
    for (const [index, result] of results.entries()) {
      expect(result.accepted, `Ausführung ${index} wurde akzeptiert`).toBe(true);
      expect(result.stdout).toBe(`parallel-${index}`);
      expect(result.evidence?.artifactId, `Ausführung ${index} hat Evidenz`).toBeTruthy();
      expect(result.evidence?.verified).toBe(true);
    }

    // Evidenz bleibt dem jeweiligen Task zugeordnet (keine Vermischung).
    const artifactIds = new Set(results.map(result => result.evidence!.artifactId));
    expect(artifactIds.size).toBe(PARALLEL);
    for (const [index, entry] of prepared.entries()) {
      const own = artifacts.artifactSnapshot({taskId: entry.taskId});
      expect(own).toHaveLength(1);
      expect(own[0].id).toBe(results[index].evidence!.artifactId);
      expect(own[0].sandboxId).toBe(entry.sandboxId);
      expect(artifacts.verifyArtifact(own[0].id).ok).toBe(true);
    }

    // Die Audit-Kette bleibt unter Nebenläufigkeit integer.
    const chain = audit.verifyAuditChain();
    expect(chain.valid).toBe(true);
    expect(chain.length).toBeGreaterThanOrEqual(PARALLEL);
  }, 120_000);

  it(`verweigert ${DENIED} Fremdbindungen auch unter Last`, async () => {
    const [first, second] = await Promise.all([prepare("fremd-a"), prepare("fremd-b")]);

    const denials = await Promise.all(
      Array.from({length: DENIED}, (_, index) =>
        broker
          .executeAuthorized({
            taskId: index % 2 === 0 ? second.taskId : first.taskId,
            agentId: "AG-BUILD",
            sandboxId: index % 2 === 0 ? first.sandboxId : second.sandboxId,
            capabilityTokenId: index % 2 === 0 ? first.tokenId : second.tokenId,
            environment: "test",
            argv: ["node", "-e", "process.stdout.write('darf-nicht')"]
          })
          .then(() => "AKZEPTIERT")
          .catch(error => (error instanceof Error ? error.message : "VERWEIGERT"))
      )
    );

    // Kein einziger Lauf darf mit fremder Bindung durchgehen.
    for (const outcome of denials) expect(outcome).not.toBe("AKZEPTIERT");

    // Keine Ausgabe der verweigerten Läufe darf in der Evidenz auftauchen.
    const contents = artifacts.artifactSnapshot({taskId: first.taskId}).concat(artifacts.artifactSnapshot({taskId: second.taskId}));
    for (const artifact of contents) expect(artifact.content).not.toContain("darf-nicht");

    // Verweigerungen sind auditiert und die Kette bleibt integer.
    expect(audit.verifyAuditChain().valid).toBe(true);
    const records = audit.auditSnapshot(200);
    expect(records.some(record => record.decision === "DENY")).toBe(true);
  }, 120_000);
});
