import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it, vi} from "vitest";

function isolatedAssets(label: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bob-${label}-`));
  const assetRoot = path.join(root, "airgap");
  fs.mkdirSync(assetRoot, {recursive: true, mode: 0o700});
  process.env.BOB_STORAGE_DIR = path.join(root, "data");
  process.env.BOB_OFFLINE_ASSET_DIR = assetRoot;
  return {root, assetRoot};
}

describe("Offline asset catalog", () => {
  it("registers pre-staged assets by content digest and verifies duplicates idempotently", async () => {
    const previous = {storage: process.env.BOB_STORAGE_DIR, assetRoot: process.env.BOB_OFFLINE_ASSET_DIR};
    const {root, assetRoot} = isolatedAssets("offline-assets");
    try {
      fs.writeFileSync(path.join(assetRoot, "compiler.bin"), Buffer.from("local compiler bytes"));
      vi.resetModules();
      const assets = await import("../../lib/offline-assets");
      const first = await assets.registerOfflineAsset({kind: "COMPILER", name: "compiler-v1", relativePath: "compiler.bin"});
      expect(first.duplicate).toBe(false);
      expect(first.asset.id).toMatch(/^AS-[A-F0-9]{24}$/);
      expect(first.asset.digest).toMatch(/^[a-f0-9]{64}$/);
      expect((await assets.verifyOfflineAsset(first.asset.id)).valid).toBe(true);

      fs.mkdirSync(path.join(assetRoot, "mirror"));
      fs.copyFileSync(path.join(assetRoot, "compiler.bin"), path.join(assetRoot, "mirror", "compiler-copy.bin"));
      const duplicate = await assets.registerOfflineAsset({kind: "COMPILER", name: "compiler-v1", relativePath: "mirror/compiler-copy.bin"});
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.asset.id).toBe(first.asset.id);
      expect(assets.listOfflineAssets()).toHaveLength(1);
    } finally {
      vi.resetModules();
      fs.rmSync(root, {recursive: true, force: true});
      if (previous.storage === undefined) delete process.env.BOB_STORAGE_DIR; else process.env.BOB_STORAGE_DIR = previous.storage;
      if (previous.assetRoot === undefined) delete process.env.BOB_OFFLINE_ASSET_DIR; else process.env.BOB_OFFLINE_ASSET_DIR = previous.assetRoot;
    }
  });

  it("stages digest-pinned assets into a bounded workspace and rejects staged tampering/symlinks", async () => {
    const previous = {storage: process.env.BOB_STORAGE_DIR, assetRoot: process.env.BOB_OFFLINE_ASSET_DIR};
    const {root, assetRoot} = isolatedAssets("offline-assets-stage");
    try {
      fs.writeFileSync(path.join(assetRoot, "sdk.tgz"), "pinned offline sdk");
      const workspace = path.join(root, "sandbox-workspace");
      fs.mkdirSync(workspace, {recursive: true});
      vi.resetModules();
      const assets = await import("../../lib/offline-assets");
      const registered = await assets.registerOfflineAsset({kind: "SDK", name: "sdk-v1", relativePath: "sdk.tgz"});
      const pin = {assetId: registered.asset.id, kind: registered.asset.kind, name: registered.asset.name, digest: registered.asset.digest, sizeBytes: registered.asset.sizeBytes};
      const first = await assets.stageOfflineAssetsInWorkspace({packageId: "OTP-12345678-1234-1234-1234-123456789abc", assets: [pin], workspace, maxBytes: 1_048_576});
      expect(first[0].workspacePath).toBe(`.bob-offline-assets/${registered.asset.id}/content`);
      expect(fs.readFileSync(path.join(workspace, first[0].workspacePath), "utf8")).toBe("pinned offline sdk");
      expect(fs.statSync(path.join(workspace, first[0].workspacePath)).mode & 0o777).toBe(0o400);
      await expect(assets.stageOfflineAssetsInWorkspace({packageId: "OTP-12345678-1234-1234-1234-123456789abc", assets: [pin], workspace, maxBytes: 1_048_576})).resolves.toHaveLength(1);

      const badWorkspace = path.join(root, "symlink-workspace");
      fs.mkdirSync(badWorkspace);
      fs.symlinkSync(path.join(root, "outside"), path.join(badWorkspace, ".bob-offline-assets"));
      await expect(assets.stageOfflineAssetsInWorkspace({packageId: "OTP-12345678-1234-1234-1234-123456789abc", assets: [pin], workspace: badWorkspace, maxBytes: 1_048_576})).rejects.toThrow(/symlink/i);

      const stagedPath = path.join(workspace, first[0].workspacePath);
      fs.chmodSync(stagedPath, 0o600);
      fs.writeFileSync(stagedPath, "modified after staging");
      await expect(assets.stageOfflineAssetsInWorkspace({packageId: "OTP-12345678-1234-1234-1234-123456789abc", assets: [pin], workspace, maxBytes: 1_048_576})).rejects.toThrow(/identity conflict/i);
    } finally {
      vi.resetModules();
      fs.rmSync(root, {recursive: true, force: true});
      if (previous.storage === undefined) delete process.env.BOB_STORAGE_DIR; else process.env.BOB_STORAGE_DIR = previous.storage;
      if (previous.assetRoot === undefined) delete process.env.BOB_OFFLINE_ASSET_DIR; else process.env.BOB_OFFLINE_ASSET_DIR = previous.assetRoot;
    }
  });

  it("detects modified assets and refuses traversal, symlinks and oversized/non-files", async () => {
    const previous = {storage: process.env.BOB_STORAGE_DIR, assetRoot: process.env.BOB_OFFLINE_ASSET_DIR};
    const {root, assetRoot} = isolatedAssets("offline-assets-boundary");
    const outside = path.join(root, "outside.bin");
    try {
      fs.writeFileSync(path.join(assetRoot, "model.gguf"), "model version one");
      fs.writeFileSync(outside, "outside asset");
      fs.symlinkSync(outside, path.join(assetRoot, "linked.bin"));
      vi.resetModules();
      const assets = await import("../../lib/offline-assets");
      const registered = await assets.registerOfflineAsset({kind: "MODEL", name: "model-v1", relativePath: "model.gguf"});
      fs.writeFileSync(path.join(assetRoot, "model.gguf"), "model version two");
      const verification = await assets.verifyOfflineAsset(registered.asset.id);
      expect(verification.valid).toBe(false);
      expect(verification.error).toMatch(/mismatch/i);
      await expect(assets.registerOfflineAsset({kind: "MODEL", name: "traversal", relativePath: "../outside.bin"})).rejects.toThrow(/invalid segment|escapes/i);
      await expect(assets.registerOfflineAsset({kind: "MODEL", name: "symlink", relativePath: "linked.bin"})).rejects.toThrow(/symlink/i);
      await expect(assets.registerOfflineAsset({kind: "MODEL", name: "directory", relativePath: "."})).rejects.toThrow(/invalid segment/i);
    } finally {
      vi.resetModules();
      fs.rmSync(root, {recursive: true, force: true});
      if (previous.storage === undefined) delete process.env.BOB_STORAGE_DIR; else process.env.BOB_STORAGE_DIR = previous.storage;
      if (previous.assetRoot === undefined) delete process.env.BOB_OFFLINE_ASSET_DIR; else process.env.BOB_OFFLINE_ASSET_DIR = previous.assetRoot;
    }
  });
});
