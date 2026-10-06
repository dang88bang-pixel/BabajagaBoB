import {describe, expect, it} from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {vi} from "vitest";

describe("Offline Fabric", () => {
  it("builds and validates a task package without network", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),"bob-offline-"));
    process.env.BOB_STORAGE_DIR = dir;
    vi.resetModules();
    const offline = await import("../../lib/offline");
    const asset = offline.registerOfflineAsset({
      kind:"MODEL", name:"local-model", version:"1", origin:"DEVICE-A",
      digest:crypto.createHash("sha256").update("model").digest("hex"), sizeBytes:5
    });
    const pkg = offline.createOfflineTaskPackage("TASK-OFF-1",{command:"local-test"},[asset.assetId],"DEVICE-A");
    expect(pkg.network).toBe("DENY");
    expect(pkg.digest).toHaveLength(64);
    const run = offline.startOfflineExecution(pkg.packageId);
    const done = offline.finishOfflineExecution(run.executionId,{status:"SUCCEEDED",log:"offline ok"});
    expect(done.status).toBe("SUCCEEDED");
    expect(offline.offlineReport().executions).toBe(1);
  });

  it("preserves provenance and detects conflicting remote state", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),"bob-offline-sync-"));
    process.env.BOB_STORAGE_DIR = dir;
    vi.resetModules();
    const offline = await import("../../lib/offline");
    const digest = crypto.createHash("sha256").update("same").digest("hex");
    const first = offline.mergeOfflineSync([{recordId:"SYNC-1",origin:"A",kind:"PACKAGE",entityId:"PKG-1",digest,exportedAt:new Date().toISOString(),lineage:["PKG-1","ASSET-1"]}]);
    expect(first.accepted).toBe(1);
    const duplicate = offline.mergeOfflineSync([{recordId:"SYNC-2",origin:"A",kind:"PACKAGE",entityId:"PKG-1",digest,exportedAt:new Date().toISOString(),lineage:["PKG-1"]}]);
    expect(duplicate.duplicates).toBe(1);
    const conflictDigest = crypto.createHash("sha256").update("different").digest("hex");
    const conflict = offline.mergeOfflineSync([{recordId:"SYNC-3",origin:"B",kind:"PACKAGE",entityId:"PKG-1",digest:conflictDigest,exportedAt:new Date().toISOString(),lineage:["PKG-1"]}]);
    expect(conflict.conflicts).toBe(1);
    expect(offline.offlineSnapshot().conflicts).toHaveLength(1);
  });
});
