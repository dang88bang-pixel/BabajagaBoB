import crypto from "node:crypto";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

isolatedStorageRoot("offline-unit");

let offline: typeof import("../../lib/offline/offline-fabric");
let bootstrap: typeof import("../../lib/bootstrap");
let cp: typeof import("../../lib/control-plane");
let provenance: typeof import("../../lib/provenance");

// Spiegel von contentDigest (sha256 hex).
const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

beforeAll(async () => {
  vi.resetModules();
  offline = await import("../../lib/offline/offline-fabric");
  bootstrap = await import("../../lib/bootstrap");
  cp = await import("../../lib/control-plane");
  provenance = await import("../../lib/provenance");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

function makeTask() {
  const mission = cp.createMission({title: "Offline", objective: "Offline-Bestand prüfen", createdBy: "CREATOR"});
  return cp.createTask({missionId: mission.missionId, title: "Offline-Task", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
}

describe("Offline-Bestand (Pakete/Modelle/Wissen)", () => {
  it("registriert Bestandseinträge mit Digest und Quelle", () => {
    const asset = offline.registerOfflineAsset({kind: "PACKAGE", name: "libfoo", version: "1.2.0", content: "paketinhalt-libfoo", source: "mirror-intern", addedBy: "CREATOR"});
    expect(asset.assetId).toMatch(/^OFFA-/);
    expect(asset.digest).toBe(sha("paketinhalt-libfoo"));
    expect(asset.status).toBe("AVAILABLE");
    expect(asset.source).toBe("mirror-intern");
    expect(asset.contentStored).toBe(true);
    expect(asset.content).toBe("paketinhalt-libfoo");
  });

  it("speichert Inhalte nur bis zur Grenze, darüber ehrliche Metadaten-Referenz", () => {
    const big = offline.registerOfflineAsset({kind: "MODEL", name: "grosses-modell", version: "1", content: "x".repeat(offline.OFFLINE_MAX_STORED_CONTENT_BYTES + 1), source: "mirror", addedBy: "CREATOR"});
    expect(big.contentStored).toBe(false);
    expect(big.content).toBeUndefined();
    expect(big.sizeBytes).toBe(offline.OFFLINE_MAX_STORED_CONTENT_BYTES + 1);
    expect(big.digest).toBe(sha("x".repeat(offline.OFFLINE_MAX_STORED_CONTENT_BYTES + 1)));
  });

  it("ist idempotent bei gleichem Digest", () => {
    const first = offline.registerOfflineAsset({kind: "MODEL", name: "klein", version: "0.1", content: "modellgewichte", source: "mirror", addedBy: "CREATOR"});
    const second = offline.registerOfflineAsset({kind: "MODEL", name: "klein", version: "0.1", content: "modellgewichte", source: "mirror", addedBy: "CREATOR"});
    expect(second.assetId).toBe(first.assetId);
    expect(offline.listOfflineAssets().filter(a => a.name === "klein")).toHaveLength(1);
  });

  it("überschreibt bei abweichendem Digest nicht still, sondern bildet eine Linie", () => {
    const first = offline.registerOfflineAsset({kind: "KNOWLEDGE", name: "handbuch", version: "2.0", content: "handbuch v2a", source: "mirror", addedBy: "CREATOR"});
    const second = offline.registerOfflineAsset({kind: "KNOWLEDGE", name: "handbuch", version: "2.0", content: "handbuch v2b", source: "mirror-neu", addedBy: "CREATOR"});
    expect(second.previousDigest).toBe(first.digest);
    const all = offline.listOfflineAssets(true).filter(a => a.name === "handbuch");
    expect(all).toHaveLength(2);
    expect(all.filter(a => a.status === "AVAILABLE")).toHaveLength(1);
    expect(all.filter(a => a.status === "SUPERSEDED")).toHaveLength(1);
    const graph = provenance.listProvenance();
    expect(graph.edges.some(edge => edge.from === second.assetId && edge.to === first.assetId && edge.relation === "DERIVED_FROM")).toBe(true);
  });

  it("verweigert ungültige Einträge fail closed", () => {
    expect(() => offline.registerOfflineAsset({kind: "WIDGET" as never, name: "x", version: "1", content: "y", source: "s", addedBy: "CREATOR"})).toThrow(/kind/);
    expect(() => offline.registerOfflineAsset({kind: "PACKAGE", name: "../escape", version: "1", content: "y", source: "s", addedBy: "CREATOR"})).toThrow(/name/);
    expect(() => offline.registerOfflineAsset({kind: "PACKAGE", name: "ok", version: "1", content: "", source: "s", addedBy: "CREATOR"})).toThrow(/content/);
    expect(() => offline.registerOfflineAsset({kind: "PACKAGE", name: "ok2", version: "1", content: "inhalt", source: "", addedBy: "CREATOR"})).toThrow(/source/);
  });
});

describe("Offline-Task-Pakete", () => {
  it("verlangt verfügbare Bestandseinträge (fail closed)", () => {
    const task = makeTask();
    expect(() =>
      offline.createOfflinePackage({taskId: task.taskId, assets: [{kind: "DATASET", name: "gibt-es-nicht", version: "1"}], createdBy: "CREATOR"})
    ).toThrow(/not available/);
  });

  it("baut ein Paket mit Manifest-Digest und Provenance-Kanten", () => {
    offline.registerOfflineAsset({kind: "DATASET", name: "messreihe", version: "1", content: "daten", source: "mirror", addedBy: "CREATOR"});
    const task = makeTask();
    const pkg = offline.createOfflinePackage({taskId: task.taskId, assets: [{kind: "DATASET", name: "messreihe", version: "1"}], createdBy: "CREATOR"});
    expect(pkg.digest).toMatch(/^[a-f0-9]{64}$/);
    const graph = provenance.listProvenance();
    expect(graph.nodes.some(node => node.id === pkg.packageId)).toBe(true);
    expect(graph.edges.some(edge => edge.from === pkg.packageId && edge.relation === "DERIVED_FROM")).toBe(true);
  });
});

describe("Herkunftstreuer Abgleich (Sync)", () => {
  it("plant UNCHANGED, IMPORT_PENDING, CONFLICT und LOCAL_ONLY", () => {
    offline.registerOfflineAsset({kind: "PACKAGE", name: "sync-a", version: "1", content: "inhalt-a", source: "mirror", addedBy: "CREATOR"});
    offline.registerOfflineAsset({kind: "PACKAGE", name: "sync-b", version: "1", content: "inhalt-b-lokal", source: "mirror", addedBy: "CREATOR"});
    offline.registerOfflineAsset({kind: "PACKAGE", name: "sync-nur-lokal", version: "1", content: "lokal", source: "mirror", addedBy: "CREATOR"});
    const sync = offline.planOfflineSync(
      {
        source: "upstream-registry",
        items: [
          {kind: "PACKAGE", name: "sync-a", version: "1", digest: sha("inhalt-a")},
          {kind: "PACKAGE", name: "sync-b", version: "1", digest: sha("ANDERS")},
          {kind: "PACKAGE", name: "sync-c", version: "1", digest: sha("neu")}
        ]
      },
      "CREATOR"
    );
    const byName = Object.fromEntries(sync.decisions.map(decision => [decision.name, decision]));
    expect(byName["sync-a"].action).toBe("UNCHANGED");
    expect(byName["sync-b"].action).toBe("CONFLICT");
    expect(byName["sync-c"].action).toBe("IMPORT_PENDING");
    expect(byName["sync-nur-lokal"].action).toBe("LOCAL_ONLY");
  });

  it("verweigert Manifeste mit ungültigen Digesten und Duplikaten", () => {
    expect(() => offline.planOfflineSync({source: "x", items: [{kind: "PACKAGE", name: "a", version: "1", digest: "kurz"}]}, "CREATOR")).toThrow(/digest/);
    expect(() =>
      offline.planOfflineSync(
        {source: "x", items: [{kind: "PACKAGE", name: "a", version: "1", digest: sha("1")}, {kind: "PACKAGE", name: "a", version: "1", digest: sha("1")}]},
        "CREATOR"
      )
    ).toThrow(/duplicate/);
  });

  it("Konfliktentscheidungen werden ausdrücklich dokumentiert", () => {
    offline.registerOfflineAsset({kind: "PACKAGE", name: "konflikt", version: "1", content: "lokal-inhalt", source: "mirror", addedBy: "CREATOR"});
    const sync = offline.planOfflineSync({source: "upstream", items: [{kind: "PACKAGE", name: "konflikt", version: "1", digest: sha("remote-inhalt")}]}, "CREATOR");
    const resolved = offline.resolveOfflineConflict(sync.syncId, {kind: "PACKAGE", name: "konflikt", version: "1"}, "KEEP_LOCAL", "CREATOR");
    expect(resolved.resolution).toBe("KEEP_LOCAL");
    expect(() => offline.resolveOfflineConflict(sync.syncId, {kind: "PACKAGE", name: "konflikt", version: "1"}, "KEEP_LOCAL", "CREATOR")).toThrow(/no open conflict/);
  });

  it("Import aus Remote-Manifesten prüft den Inhalt gegen den Manifest-Digest (fail closed)", () => {
    const item = {kind: "PACKAGE" as const, name: "remote-ok", version: "1", digest: sha("remote-inhalt-1")};
    expect(() => offline.importRemoteAsset({item, content: "anderer-inhalt", source: "upstream", addedBy: "CREATOR"})).toThrow(/digest mismatch/);
    const asset = offline.importRemoteAsset({item, content: "remote-inhalt-1", source: "upstream", addedBy: "CREATOR"});
    expect(asset.digest).toBe(item.digest);
  });
});
