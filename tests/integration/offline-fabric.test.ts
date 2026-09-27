import crypto from "node:crypto";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Offline Fabric (MASTER §36 / OFF-001, Phase 4 / 7.4):
 * lokaler Bestand → Task-Paket → Offline-Ausführung ohne Netz (DENY-Sandbox,
 * autorisierter Systempfad) → Evidenz → herkunftstreuer Abgleich.
 */

process.env.BOB_NS_ISOLATION = "off";
isolatedStorageRoot("offline-int");

const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

let offline: typeof import("../../lib/offline/offline-fabric");
let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let audit: typeof import("../../lib/audit");
let provenance: typeof import("../../lib/provenance");

function makeTask() {
  const mission = cp.createMission({title: "Offline-Betrieb", objective: "Ohne Internet arbeiten", createdBy: "CREATOR"});
  return cp.createTask({missionId: mission.missionId, title: "Offline-Task", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
}

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  audit = await import("../../lib/audit");
  provenance = await import("../../lib/provenance");
  offline = await import("../../lib/offline/offline-fabric");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("Offline-Flow: Bestand → Paket → Ausführung ohne Netz → Evidenz", () => {
  it("führt ein Offline-Paket in einer DENY-Sandbox über den autorisierten Systempfad aus", async () => {
    const pkgAsset = offline.registerOfflineAsset({kind: "PACKAGE", name: "runner", version: "1.0.0", content: "runner-paket-inhalt", source: "mirror-lokal", addedBy: "CREATOR"});
    const knowAsset = offline.registerOfflineAsset({kind: "KNOWLEDGE", name: "runbook", version: "3", content: "runbook-wissen", source: "doku-export", addedBy: "CREATOR"});
    const task = makeTask();
    const pkg = offline.createOfflinePackage({
      taskId: task.taskId,
      assets: [
        {kind: "PACKAGE", name: "runner", version: "1.0.0"},
        {kind: "KNOWLEDGE", name: "runbook", version: "3"}
      ],
      createdBy: "CREATOR"
    });
    expect(pkg.assetIds.sort()).toEqual([knowAsset.assetId, pkgAsset.assetId].sort());

    const sandbox = await fabric.createSandbox({type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
    expect(sandbox.network).toBe("DENY");
    await fabric.startSandbox(sandbox.sandboxId);

    const run = await offline.executeOfflinePackage({
      packageId: pkg.packageId,
      sandboxId: sandbox.sandboxId,
      argv: ["node", "-e", 'process.stdout.write("offline-ok")']
    });
    expect(run.accepted).toBe(true);
    expect(run.exitCode).toBe(0);
    expect(run.evidence, "Offline-Lauf muss Evidenz über den Brokerpfad erzeugen").toBeDefined();
    expect(run.evidence?.verified).toBe(true);

    // Herkunft: Paket → Evidenz, Bestand → Paket.
    const graph = provenance.listProvenance();
    expect(graph.edges.some(edge => edge.from === pkg.packageId && edge.to === run.evidence?.artifactId && edge.relation === "PRODUCED")).toBe(true);

    // Audit-Kette bleibt gültig und enthält die Offline-Aktionen.
    expect(audit.verifyAuditChain().valid).toBe(true);
    const actions = audit.auditSnapshot().map(record => record.action);
    expect(actions).toContain("offline:asset:register");
    expect(actions).toContain("offline:package:create");
    expect(actions).toContain("offline:execute");

    await fabric.destroySandbox(sandbox.sandboxId).catch(() => undefined);
  }, 60_000);

  it("verweigert Offline-Ausführung außerhalb einer DENY-Sandbox", async () => {
    const task = makeTask();
    offline.registerOfflineAsset({kind: "PACKAGE", name: "allein", version: "1", content: "inhalt", source: "mirror", addedBy: "CREATOR"});
    const pkg = offline.createOfflinePackage({taskId: task.taskId, assets: [{kind: "PACKAGE", name: "allein", version: "1"}], createdBy: "CREATOR"});
    cp.registerSandbox({
      sandboxId: "SB-OFF-NET",
      type: "test",
      status: "RUNNING",
      lifecycle: "RUNNING",
      network: "ALLOWLIST",
      taskId: task.taskId,
      agentId: "AG-BUILD",
      runtimeMode: "real-local"
    });
    await expect(
      offline.executeOfflinePackage({packageId: pkg.packageId, sandboxId: "SB-OFF-NET", argv: ["node", "-e", 'process.stdout.write("x")']})
    ).rejects.toThrow(/DENY/);
  });
});

describe("Herkunftstreuer Abgleich nach Wiederkehr (Sync → Merge)", () => {
  it("importiert Remote-Inhalte nur mit gültigem Digest und dokumentiert Konflikte", async () => {
    offline.registerOfflineAsset({kind: "MODEL", name: "lokales-modell", version: "2", content: "lokale-gewichte", source: "mirror", addedBy: "CREATOR"});
    const remoteNeu = {kind: "DATASET" as const, name: "katalog", version: "1", digest: sha("katalogdaten")};
    const sync = offline.planOfflineSync(
      {
        source: "upstream-nach-wiederkehr",
        items: [
          {kind: "MODEL", name: "lokales-modell", version: "2", digest: sha("ABWEICHEND")},
          remoteNeu
        ]
      },
      "CREATOR"
    );
    const byName = Object.fromEntries(sync.decisions.map(decision => [decision.name, decision]));
    expect(byName["lokales-modell"].action).toBe("CONFLICT");
    expect(byName["katalog"].action).toBe("IMPORT_PENDING");

    // Konfliktentscheidung ist ein expliziter Akt und wird auditiert.
    const resolved = offline.resolveOfflineConflict(sync.syncId, {kind: "MODEL", name: "lokales-modell", version: "2"}, "ACCEPT_REMOTE", "CREATOR");
    expect(resolved.resolution).toBe("ACCEPT_REMOTE");

    // Manipulierter Remote-Inhalt wird fail closed abgewiesen.
    await expect(Promise.resolve().then(() => offline.importRemoteAsset({item: remoteNeu, content: "anderer-inhalt-als-vereinbart", source: "upstream", addedBy: "CREATOR"}))).rejects.toThrow(/digest mismatch/);

    // Korrekter Remote-Inhalt übernimmt die Herkunft aus dem Manifest.
    const imported = offline.importRemoteAsset({item: remoteNeu, content: "katalogdaten", source: "upstream-nach-wiederkehr", addedBy: "CREATOR"});
    expect(imported.digest).toBe(remoteNeu.digest);
    expect(imported.source).toBe("upstream-nach-wiederkehr");

    const summary = offline.offlineFabricSummary();
    expect(summary.syncs.conflicts).toBeGreaterThan(0);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});
