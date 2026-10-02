import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it, vi} from "vitest";
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

const TEST_SYNC_KEY = "offline-test-shared-key-32-bytes!!";

describe("Offline evidence fabric", () => {
  it("syncs signed evidence and exact provenance idempotently without transferring authority", async () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-offline-source-"));
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bob-offline-target-"));
    const previous = {
      storage: process.env.BOB_STORAGE_DIR,
      key: process.env.BOB_OFFLINE_SYNC_KEY,
      node: process.env.BOB_OFFLINE_NODE_ID,
      peers: process.env.BOB_OFFLINE_PEER_KEYS,
      runtime: process.env.BOB_SANDBOX_RUNTIME,
      ns: process.env.BOB_NS_ISOLATION
    };
    try {
      process.env.BOB_OFFLINE_SYNC_KEY = TEST_SYNC_KEY;
      process.env.BOB_OFFLINE_NODE_ID = "offline-source";
      process.env.BOB_STORAGE_DIR = sourceRoot;
      process.env.BOB_SANDBOX_RUNTIME = "local";
      process.env.BOB_NS_ISOLATION = "off";
      vi.resetModules();

      const artifacts = await import("../../lib/artifacts");
      const provenance = await import("../../lib/provenance");
      const sourceFabric = await import("../../lib/offline-fabric");
      const artifact = artifacts.recordArtifact({
        name: "Air-gap run evidence",
        kind: "OFFLINE_TEST",
        taskId: "TASK-OFFLINE-SYNC",
        runId: "RUN-OFFLINE-SYNC",
        sandboxId: "SB-OFFLINE-SYNC",
        agentId: "AG-BUILD",
        knowledgeState: "OBSERVED",
        contentType: "text/plain"
      }, "result created without network access");
      const producedAt = "2026-09-30T12:00:00.000Z";
      provenance.mergeProvenanceNode({id: "TASK-OFFLINE-SYNC", kind: "TASK", label: "Air-gap task", createdAt: producedAt});
      provenance.mergeProvenanceNode({id: "RUN-OFFLINE-SYNC", kind: "RUN", label: "Air-gap run", runId: "RUN-OFFLINE-SYNC", createdAt: producedAt});
      provenance.mergeProvenanceNode({id: artifact.id, kind: "EVIDENCE", label: "Air-gap evidence", runId: "RUN-OFFLINE-SYNC", createdAt: producedAt});
      provenance.addProvenanceEdge({from: "RUN-OFFLINE-SYNC", to: "TASK-OFFLINE-SYNC", relation: "CAUSED_BY", note: "offline execution scope"});
      provenance.addProvenanceEdge({from: "RUN-OFFLINE-SYNC", to: artifact.id, relation: "PRODUCED", note: "offline evidence"});
      const bundle = sourceFabric.createOfflineEvidenceBundle([artifact.id]);
      expect(bundle.originNodeId).toBe("offline-source");
      expect(bundle.signature).toMatch(/^[a-f0-9]{64}$/);
      expect(bundle.provenance.nodes.find(node => node.id === "RUN-OFFLINE-SYNC")?.createdAt).toBe(producedAt);
      expect(JSON.stringify(bundle)).not.toMatch(/secret|capabilityToken/i);

      process.env.BOB_STORAGE_DIR = targetRoot;
      process.env.BOB_OFFLINE_NODE_ID = "offline-target";
      process.env.BOB_OFFLINE_SYNC_KEY = "offline-target-signing-key-32-bytes";
      delete process.env.BOB_OFFLINE_PEER_KEYS;
      vi.resetModules();
      const untrustedFabric = await import("../../lib/offline-fabric");
      expect(() => untrustedFabric.importOfflineEvidenceBundle(bundle)).toThrow(/BOB_OFFLINE_PEER_KEYS/);

      process.env.BOB_OFFLINE_PEER_KEYS = JSON.stringify({"offline-source": TEST_SYNC_KEY});
      vi.resetModules();
      const targetFabric = await import("../../lib/offline-fabric");
      const targetArtifacts = await import("../../lib/artifacts");
      const targetProvenance = await import("../../lib/provenance");
      const first = targetFabric.importOfflineEvidenceBundle(bundle);
      expect(first.importedArtifacts).toBe(1);
      expect(first.duplicateArtifacts).toBe(0);
      expect(first.mergedNodes).toBe(3);
      expect(first.mergedEdges).toBe(2);
      expect(targetArtifacts.getArtifact(artifact.id)).toEqual(artifact);
      expect(targetProvenance.listProvenance().nodes.find(node => node.id === "RUN-OFFLINE-SYNC")?.createdAt).toBe(producedAt);
      const repeated = targetFabric.importOfflineEvidenceBundle(bundle);
      expect(repeated.importedArtifacts).toBe(0);
      expect(repeated.duplicateArtifacts).toBe(1);
      expect(repeated.mergedNodes).toBe(0);
      expect(repeated.mergedEdges).toBe(0);
      expect(targetFabric.offlineSyncHistory()).toHaveLength(1);

      const tampered = structuredClone(bundle);
      tampered.artifacts[0].content = "tampered after signing";
      expect(() => targetFabric.importOfflineEvidenceBundle(tampered)).toThrow(/payload digest mismatch/i);
      const forged = {...bundle, signature: "0".repeat(64)};
      expect(() => targetFabric.importOfflineEvidenceBundle(forged)).toThrow(/signature verification failed/i);
    } finally {
      vi.resetModules();
      fs.rmSync(sourceRoot, {recursive: true, force: true});
      fs.rmSync(targetRoot, {recursive: true, force: true});
      if (previous.storage === undefined) delete process.env.BOB_STORAGE_DIR; else process.env.BOB_STORAGE_DIR = previous.storage;
      if (previous.key === undefined) delete process.env.BOB_OFFLINE_SYNC_KEY; else process.env.BOB_OFFLINE_SYNC_KEY = previous.key;
      if (previous.node === undefined) delete process.env.BOB_OFFLINE_NODE_ID; else process.env.BOB_OFFLINE_NODE_ID = previous.node;
      if (previous.peers === undefined) delete process.env.BOB_OFFLINE_PEER_KEYS; else process.env.BOB_OFFLINE_PEER_KEYS = previous.peers;
      if (previous.runtime === undefined) delete process.env.BOB_SANDBOX_RUNTIME; else process.env.BOB_SANDBOX_RUNTIME = previous.runtime;
      if (previous.ns === undefined) delete process.env.BOB_NS_ISOLATION; else process.env.BOB_NS_ISOLATION = previous.ns;
    }
  });

  it("fails closed if the shared signing key or stable node identity is missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-offline-config-"));
    const previous = {storage: process.env.BOB_STORAGE_DIR, key: process.env.BOB_OFFLINE_SYNC_KEY, node: process.env.BOB_OFFLINE_NODE_ID};
    try {
      process.env.BOB_STORAGE_DIR = root;
      delete process.env.BOB_OFFLINE_SYNC_KEY;
      delete process.env.BOB_OFFLINE_NODE_ID;
      vi.resetModules();
      const fabric = await import("../../lib/offline-fabric");
      expect(() => fabric.createOfflineEvidenceBundle(["ART-NOT-FOUND"])).toThrow(/BOB_OFFLINE_SYNC_KEY/);
      const route = await import("../../app/api/offline/route");
      const denied = await route.GET(new Request("http://localhost:3000/api/offline"));
      expect([401, 428]).toContain(denied.status);
    } finally {
      vi.resetModules();
      fs.rmSync(root, {recursive: true, force: true});
      if (previous.storage === undefined) delete process.env.BOB_STORAGE_DIR; else process.env.BOB_STORAGE_DIR = previous.storage;
      if (previous.key === undefined) delete process.env.BOB_OFFLINE_SYNC_KEY; else process.env.BOB_OFFLINE_SYNC_KEY = previous.key;
      if (previous.node === undefined) delete process.env.BOB_OFFLINE_NODE_ID; else process.env.BOB_OFFLINE_NODE_ID = previous.node;
    }
  });

  it("routes Creator export and sync through the authenticated API", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bob-offline-api-"));
    const previous = {
      storage: process.env.BOB_STORAGE_DIR,
      key: process.env.BOB_OFFLINE_SYNC_KEY,
      node: process.env.BOB_OFFLINE_NODE_ID,
      peers: process.env.BOB_OFFLINE_PEER_KEYS,
      bootstrap: process.env.BOB_BOOTSTRAP_SECRET
    };
    try {
      process.env.BOB_STORAGE_DIR = root;
      process.env.BOB_OFFLINE_SYNC_KEY = TEST_SYNC_KEY;
      process.env.BOB_OFFLINE_NODE_ID = "offline-api-node";
      process.env.BOB_OFFLINE_PEER_KEYS = JSON.stringify({"offline-api-node": TEST_SYNC_KEY});
      process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
      vi.resetModules();
      const auth = await import("../../app/api/auth/route");
      const boot = await auth.POST(new Request("http://localhost:3000/api/auth", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Offline API Test"})
      }));
      expect(boot.status).toBe(201);
      const cookie = (boot.headers.get("set-cookie") ?? "").split(";")[0];
      expect(cookie).toMatch(/^bob_session=/);

      const artifacts = await import("../../lib/artifacts");
      const artifact = artifacts.recordArtifact({
        name: "Offline API evidence",
        kind: "API_TEST",
        taskId: "TASK-OFFLINE-API",
        runId: "RUN-OFFLINE-API",
        sandboxId: "SB-OFFLINE-API",
        agentId: "AG-BUILD",
        knowledgeState: "OBSERVED"
      }, "api evidence payload");
      const route = await import("../../app/api/offline/route");
      fs.mkdirSync(path.join(root, "offline-assets"), {recursive: true});
      fs.writeFileSync(path.join(root, "offline-assets", "package.tgz"), "pre-staged package bytes");
      const registeredAsset = await route.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {cookie, "content-type": "application/json"},
        body: JSON.stringify({action: "asset.register", kind: "PACKAGE", name: "test-package", relativePath: "package.tgz"})
      }));
      expect(registeredAsset.status).toBe(201);
      const assetBody = await registeredAsset.json() as {asset: {id: string}};
      const verifiedAsset = await route.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {cookie, "content-type": "application/json"},
        body: JSON.stringify({action: "asset.verify", assetId: assetBody.asset.id})
      }));
      expect(verifiedAsset.status).toBe(200);
      const exported = await route.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {cookie, "content-type": "application/json"},
        body: JSON.stringify({action: "export", artifactIds: [artifact.id]})
      }));
      expect(exported.status).toBe(201);
      const exportedBody = await exported.json() as {bundle: {bundleId: string}};
      expect(exportedBody.bundle.bundleId).toMatch(/^OB-/);

      const imported = await route.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {cookie, "content-type": "application/json"},
        body: JSON.stringify({action: "import", bundle: exportedBody.bundle})
      }));
      expect(imported.status).toBe(200);
      expect((await imported.json()).result.duplicateArtifacts).toBe(1);
    } finally {
      vi.resetModules();
      fs.rmSync(root, {recursive: true, force: true});
      if (previous.storage === undefined) delete process.env.BOB_STORAGE_DIR; else process.env.BOB_STORAGE_DIR = previous.storage;
      if (previous.key === undefined) delete process.env.BOB_OFFLINE_SYNC_KEY; else process.env.BOB_OFFLINE_SYNC_KEY = previous.key;
      if (previous.node === undefined) delete process.env.BOB_OFFLINE_NODE_ID; else process.env.BOB_OFFLINE_NODE_ID = previous.node;
      if (previous.peers === undefined) delete process.env.BOB_OFFLINE_PEER_KEYS; else process.env.BOB_OFFLINE_PEER_KEYS = previous.peers;
      if (previous.bootstrap === undefined) delete process.env.BOB_BOOTSTRAP_SECRET; else process.env.BOB_BOOTSTRAP_SECRET = previous.bootstrap;
    }
  });
});
