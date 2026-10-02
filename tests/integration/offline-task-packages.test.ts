import fs from "node:fs";
import path from "node:path";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

const root = isolatedStorageRoot("offline-task-packages");
const assetRoot = path.join(root, "staged-assets");
const signingKey = "offline-task-package-test-key-0123456789";
process.env.BOB_OFFLINE_ASSET_DIR = assetRoot;
process.env.BOB_OFFLINE_NODE_ID = "field-node-test";
process.env.BOB_OFFLINE_SYNC_KEY = signingKey;
process.env.BOB_OFFLINE_PEER_KEYS = JSON.stringify({"field-node-test": signingKey});

let authRoute: typeof import("../../app/api/auth/route");
let offlineRoute: typeof import("../../app/api/offline/route");
let control: typeof import("../../lib/control-plane");
let fabric: typeof import("../../lib/sandbox/fabric");
let authority: typeof import("../../lib/authority");
let plans: typeof import("../../lib/plans");
let knowledge: typeof import("../../lib/knowledge");
let provenance: typeof import("../../lib/provenance");
let assets: typeof import("../../lib/offline-assets");
let packages: typeof import("../../lib/offline-task-packages");
let nsIsolation: typeof import("../../lib/ns-isolation");
let cookie = "";
let taskId = "";
let planId = "";
let assetId = "";
let stagedPath = "";
let signedPackage: Awaited<ReturnType<typeof packages.createOfflineTaskPackage>>;

beforeAll(async () => {
  fs.mkdirSync(assetRoot, {recursive: true, mode: 0o700});
  stagedPath = path.join(assetRoot, "model.bin");
  fs.writeFileSync(stagedPath, "staged offline model bytes");
  vi.resetModules();
  control = await import("../../lib/control-plane");
  fabric = await import("../../lib/sandbox/fabric");
  authority = await import("../../lib/authority");
  plans = await import("../../lib/plans");
  knowledge = await import("../../lib/knowledge");
  provenance = await import("../../lib/provenance");
  assets = await import("../../lib/offline-assets");
  packages = await import("../../lib/offline-task-packages");
  nsIsolation = await import("../../lib/ns-isolation");
  authRoute = await import("../../app/api/auth/route");
  offlineRoute = await import("../../app/api/offline/route");
  const login = await authRoute.POST(new Request("http://localhost:3000/api/auth", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Offline Package Creator"})
  }));
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

  const mission = control.createMission({title: "Offline package mission", objective: "Verified isolated work", createdBy: "CREATOR"});
  const objective = control.createObjective({missionId: mission.missionId, title: "Offline package objective", description: "A scoped offline task"});
  const task = control.createTask({missionId: mission.missionId, objectiveId: objective.objectiveId, title: "Use pinned offline model", risk: "LOW", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
  taskId = task.taskId;
  const plan = plans.createPlan({objectiveId: objective.objectiveId, taskIds: [task.taskId], expectedEffects: ["Local model output is recorded"], abortCriteria: ["Stop if asset digest differs"], createdBy: "CREATOR"});
  planId = plans.activatePlan(plan.planId).planId;
  const sandbox = await fabric.createSandbox({sandboxId: "SB-OFFLINE-PACKAGE", type: "test", taskId: task.taskId, agentId: "AG-BUILD", risk: "LOW"});
  await fabric.startSandbox(sandbox.sandboxId);
  const knowledgeNode = knowledge.upsertKnowledge({layer: "SEMANTIC", subject: "Offline run", predicate: "uses", object: "a pre-staged model", state: "SUPPORTED", sourceIds: ["DOC-OFFLINE"]});
  const registered = await assets.registerOfflineAsset({kind: "MODEL", name: "model-v1", relativePath: "model.bin"});
  assetId = registered.asset.id;
  signedPackage = await packages.createOfflineTaskPackage({taskId, planId, assetIds: [assetId], knowledgeIds: [knowledgeNode.knowledgeId]});
});

describe("Signed offline Task Packages", () => {
  it("exports a Creator-authorized, scope-pinned package and validates it through the Creator API", async () => {
    const anonymous = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "package.validate", taskPackage: signedPackage})
    }));
    expect([401, 403]).toContain(anonymous.status);

    const exported = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {cookie, "content-type": "application/json"},
      body: JSON.stringify({action: "package.create", taskId, planId, assetIds: [assetId], knowledgeIds: signedPackage.knowledge.map(node => node.knowledgeId)})
    }));
    expect(exported.status).toBe(201);
    const exportBody = await exported.json() as {taskPackage: typeof signedPackage};
    const result = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {cookie, "content-type": "application/json"},
      body: JSON.stringify({action: "package.validate", taskPackage: exportBody.taskPackage, requireLocalBindings: true})
    }));
    expect(result.status).toBe(200);
    const resultBody = await result.json() as {result: {packageId: string; assetsVerified: number; knowledgeCount: number; localBindingsVerified: boolean}};
    expect(resultBody.result).toMatchObject({packageId: exportBody.taskPackage.packageId, assetsVerified: 1, knowledgeCount: 1, localBindingsVerified: true});
    expect(exportBody.taskPackage.executionPolicy).toMatchObject({network: "DENY", brokerRequired: true, capabilityRequired: true, capabilitySecretIncluded: false, approvalRequired: false});
    expect(JSON.stringify(exportBody.taskPackage)).not.toContain(signingKey);
    expect(exportBody.taskPackage).not.toHaveProperty("argv");
    expect(exportBody.taskPackage).not.toHaveProperty("capabilityToken");
    const creatorCatalog = await offlineRoute.GET(new Request("http://localhost:3000/api/offline", {headers: {cookie}}));
    expect(creatorCatalog.status).toBe(200);
    expect((await creatorCatalog.json()).taskPackageImports).toEqual([]);

    const issued = authority.issueCapabilityToken({
      subject: "AG-BUILD",
      taskId,
      sandboxId: exportBody.taskPackage.sandbox.sandboxId,
      environment: exportBody.taskPackage.sandbox.type,
      capabilities: ["task:execute", "sandbox:run"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    });
    const creatorActionToken = authority.issueCapabilityToken({
      subject: "AG-BUILD",
      taskId,
      sandboxId: exportBody.taskPackage.sandbox.sandboxId,
      environment: "development",
      capabilities: ["task:execute", "sandbox:run", "offline:sync"],
      risk: "LOW",
      issuedBy: "CREATOR",
      issuedByKind: "CREATOR",
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    });
    const agentCreateAttempt = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {authorization: `Bobcap ${creatorActionToken.token.id}.${creatorActionToken.secret}`, "content-type": "application/json"},
      body: JSON.stringify({action: "package.create", taskId, planId})
    }));
    expect(agentCreateAttempt.status).toBe(403);
    expect((await agentCreateAttempt.json()).error).toBe("CREATOR_ONLY");
    for (const action of ["package.import", "package.activate"]) {
      const agentImportAttempt = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {authorization: `Bobcap ${creatorActionToken.token.id}.${creatorActionToken.secret}`, "content-type": "application/json"},
        body: JSON.stringify({action, taskPackage: exportBody.taskPackage, localTaskId: taskId, localPlanId: planId, localSandboxId: "SB-OFFLINE-PACKAGE"})
      }));
      expect(agentImportAttempt.status).toBe(403);
      expect((await agentImportAttempt.json()).error).toBe("CREATOR_ONLY");
    }

    const prematureExecution = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {authorization: `Bobcap ${issued.token.id}.${issued.secret}`, "content-type": "application/json"},
      body: JSON.stringify({action: "package.execute", taskPackage: exportBody.taskPackage, argv: ["node", "-e", "process.exit(0)"]})
    }));
    expect(prematureExecution.status).toBe(409);
    expect((await prematureExecution.json()).error).toBe("OFFLINE_PACKAGE_NOT_ACTIVATED");

    const imported = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {cookie, "content-type": "application/json"},
      body: JSON.stringify({action: "package.import", taskPackage: exportBody.taskPackage})
    }));
    expect(imported.status).toBe(201);
    expect((await imported.json()).record.status).toBe("IMPORTED");
    const duplicateImport = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {cookie, "content-type": "application/json"},
      body: JSON.stringify({action: "package.import", taskPackage: exportBody.taskPackage})
    }));
    expect(duplicateImport.status).toBe(200);
    expect((await duplicateImport.json()).duplicate).toBe(true);

    const activated = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {cookie, "content-type": "application/json"},
      body: JSON.stringify({action: "package.activate", taskPackage: exportBody.taskPackage, localTaskId: taskId, localPlanId: planId, localSandboxId: "SB-OFFLINE-PACKAGE"})
    }));
    expect(activated.status).toBe(200);
    expect((await activated.json()).record).toMatchObject({status: "ACTIVE", localBindings: {taskId, planId, sandboxId: "SB-OFFLINE-PACKAGE", approvalId: null}});
    const duplicateActivation = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {cookie, "content-type": "application/json"},
      body: JSON.stringify({action: "package.activate", taskPackage: exportBody.taskPackage, localTaskId: taskId, localPlanId: planId, localSandboxId: "SB-OFFLINE-PACKAGE"})
    }));
    expect(duplicateActivation.status).toBe(200);
    expect((await duplicateActivation.json()).duplicate).toBe(true);

    const isolation = nsIsolation.isolationReport();
    if (process.env.BOB_NS_ISOLATION === "on") expect(isolation.level).toBe("NAMESPACES");
    if (isolation.level === "NAMESPACES") {
      const assetPath = `.bob-offline-assets/${assetId}/content`;
      const readAsset = `process.stdout.write(require("fs").readFileSync(${JSON.stringify(assetPath)}, "utf8"))`;
      const execution = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {authorization: `Bobcap ${issued.token.id}.${issued.secret}`, "content-type": "application/json"},
        body: JSON.stringify({action: "package.execute", taskPackage: exportBody.taskPackage, argv: ["node", "-e", readAsset]})
      }));
      expect(execution.status).toBe(200);
      const executionBody = await execution.json() as {result: {accepted: boolean; stdout: string; evidence?: {artifactId: string; verified: boolean}}};
      expect(executionBody.result.accepted, JSON.stringify(executionBody.result)).toBe(true);
      expect(executionBody.result.stdout).toBe("staged offline model bytes");
      expect(executionBody.result.evidence?.verified).toBe(true);
      expect(executionBody.result.evidence?.artifactId).toBeTruthy();
    } else {
      const sentinel = path.join(root, "must-not-execute-without-isolation.txt");
      const execution = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {authorization: `Bobcap ${issued.token.id}.${issued.secret}`, "content-type": "application/json"},
        body: JSON.stringify({action: "package.execute", taskPackage: exportBody.taskPackage, argv: ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed')`]})
      }));
      expect(execution.status).toBe(503);
      expect((await execution.json()).error).toBe("OFFLINE_ISOLATION_UNAVAILABLE");
      expect(fs.existsSync(sentinel)).toBe(false);
    }

    const invalidSecret = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
      method: "POST",
      headers: {authorization: `Bobcap ${issued.token.id}.wrong-secret`, "content-type": "application/json"},
      body: JSON.stringify({action: "package.execute", taskPackage: exportBody.taskPackage, argv: ["node", "-e", "process.exit(0)"]})
    }));
    expect(invalidSecret.status).toBe(403);
  });

  it("imports and activates on a separate node, executes through its local Broker, then syncs provenance back", async () => {
    const receiverStorageRoot = path.join(root, "receiver-control-plane");
    const receiverAssetRoot = path.join(root, "receiver-assets");
    const receiverNodeId = "field-node-receiver";
    const receiverKey = "offline-task-package-receiver-key-012345";
    fs.mkdirSync(receiverStorageRoot, {recursive: true, mode: 0o700});
    fs.mkdirSync(receiverAssetRoot, {recursive: true, mode: 0o700});
    fs.copyFileSync(stagedPath, path.join(receiverAssetRoot, "model.bin"));

    const envKeys = ["BOB_STORAGE_DIR", "BOB_OFFLINE_ASSET_DIR", "BOB_OFFLINE_NODE_ID", "BOB_OFFLINE_SYNC_KEY", "BOB_OFFLINE_PEER_KEYS"] as const;
    const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    let evidenceId: string | null = null;
    let exportedBundle: unknown = null;
    let receiverTaskId = "";
    let receiverSandboxId = "";
    try {
      process.env.BOB_STORAGE_DIR = receiverStorageRoot;
      process.env.BOB_OFFLINE_ASSET_DIR = receiverAssetRoot;
      process.env.BOB_OFFLINE_NODE_ID = receiverNodeId;
      process.env.BOB_OFFLINE_SYNC_KEY = receiverKey;
      process.env.BOB_OFFLINE_PEER_KEYS = JSON.stringify({["field-node-test"]: signingKey});
      vi.resetModules();
      const receiverAuth = await import("../../app/api/auth/route");
      const receiverOffline = await import("../../app/api/offline/route");
      const receiverControl = await import("../../lib/control-plane");
      const receiverPlans = await import("../../lib/plans");
      const receiverFabric = await import("../../lib/sandbox/fabric");
      const receiverAssets = await import("../../lib/offline-assets");
      const receiverAuthority = await import("../../lib/authority");
      const receiverIsolation = await import("../../lib/ns-isolation");

      const login = await receiverAuth.POST(new Request("http://localhost:3000/api/auth", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Receiving Offline Creator"})
      }));
      expect(login.status).toBe(201);
      const receiverCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      const localAsset = await receiverAssets.registerOfflineAsset({kind: "MODEL", name: "model-v1", relativePath: "model.bin"});
      expect(localAsset.asset.id).toBe(assetId);
      expect(localAsset.asset.digest).toBe(signedPackage.assets[0]?.digest);

      const mission = receiverControl.createMission({title: "Received offline work", objective: "Execute a signed local task package", createdBy: "CREATOR"});
      const objective = receiverControl.createObjective({missionId: mission.missionId, title: "Offline model task", description: "Map the signed source task to a local objective"});
      const localTask = receiverControl.createTask({
        missionId: mission.missionId,
        objectiveId: objective.objectiveId,
        title: signedPackage.task.title,
        risk: signedPackage.task.risk,
        assignedAgent: signedPackage.task.assignedAgentId,
        requiresApproval: signedPackage.task.requiresApproval,
        createdBy: "CREATOR"
      });
      expect(localTask.taskId).not.toBe(signedPackage.task.taskId);
      expect(localTask.taskId).toContain(receiverNodeId);
      receiverTaskId = localTask.taskId;
      const localPlan = receiverPlans.activatePlan(receiverPlans.createPlan({
        objectiveId: objective.objectiveId,
        taskIds: [localTask.taskId],
        expectedEffects: signedPackage.plan.expectedEffects,
        abortCriteria: signedPackage.plan.planAbortCriteria,
        createdBy: "CREATOR"
      }).planId);
      const createdSandbox = await receiverFabric.createSandbox({
        type: signedPackage.sandbox.type,
        taskId: localTask.taskId,
        agentId: signedPackage.task.assignedAgentId,
        risk: localTask.risk,
        network: "DENY"
      });
      const localSandbox = await receiverFabric.startSandbox(createdSandbox.sandboxId);
      receiverSandboxId = localSandbox.sandboxId;

      const creatorActionToken = receiverAuthority.issueCapabilityToken({
        subject: signedPackage.task.assignedAgentId,
        taskId: localTask.taskId,
        sandboxId: localSandbox.sandboxId,
        environment: "development",
        capabilities: ["task:execute", "sandbox:run", "offline:sync"],
        risk: localTask.risk,
        issuedBy: "CREATOR",
        issuedByKind: "CREATOR",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      });
      for (const action of ["package.import", "package.activate"]) {
        const agentAttempt = await receiverOffline.POST(new Request("http://localhost:3000/api/offline", {
          method: "POST",
          headers: {authorization: `Bobcap ${creatorActionToken.token.id}.${creatorActionToken.secret}`, "content-type": "application/json"},
          body: JSON.stringify({action, taskPackage: signedPackage, localTaskId: localTask.taskId, localPlanId: localPlan.planId, localSandboxId: localSandbox.sandboxId})
        }));
        expect(agentAttempt.status).toBe(403);
        expect((await agentAttempt.json()).error).toBe("CREATOR_ONLY");
      }

      const imported = await receiverOffline.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {cookie: receiverCookie, "content-type": "application/json"},
        body: JSON.stringify({action: "package.import", taskPackage: signedPackage})
      }));
      expect(imported.status).toBe(201);
      expect((await imported.json()).record.status).toBe("IMPORTED");
      const activated = await receiverOffline.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {cookie: receiverCookie, "content-type": "application/json"},
        body: JSON.stringify({action: "package.activate", taskPackage: signedPackage, localTaskId: localTask.taskId, localPlanId: localPlan.planId, localSandboxId: localSandbox.sandboxId})
      }));
      expect(activated.status, await activated.clone().text()).toBe(200);
      expect((await activated.json()).record).toMatchObject({status: "ACTIVE", localBindings: {taskId: localTask.taskId, planId: localPlan.planId, sandboxId: localSandbox.sandboxId}});
      const issued = receiverAuthority.issueCapabilityToken({
        subject: signedPackage.task.assignedAgentId,
        taskId: localTask.taskId,
        sandboxId: localSandbox.sandboxId,
        environment: localSandbox.type,
        capabilities: ["task:execute", "sandbox:run"],
        risk: localTask.risk,
        issuedBy: "CREATOR",
        issuedByKind: "CREATOR",
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      });

      const assetPath = `.bob-offline-assets/${assetId}/content`;
      const readAsset = `process.stdout.write(require("fs").readFileSync(${JSON.stringify(assetPath)}, "utf8"))`;
      const execution = await receiverOffline.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {authorization: `Bobcap ${issued.token.id}.${issued.secret}`, "content-type": "application/json"},
        body: JSON.stringify({action: "package.execute", taskPackage: signedPackage, argv: ["node", "-e", readAsset]})
      }));
      if (receiverIsolation.isolationReport().level !== "NAMESPACES") {
        expect(execution.status).toBe(503);
        expect((await execution.json()).error).toBe("OFFLINE_ISOLATION_UNAVAILABLE");
        return;
      }
      expect(execution.status).toBe(200);
      const executionBody = await execution.json() as {result: {accepted: boolean; stdout: string; evidence?: {artifactId: string; verified: boolean}}};
      expect(executionBody.result.accepted).toBe(true);
      expect(executionBody.result.stdout).toBe("staged offline model bytes");
      expect(executionBody.result.evidence?.verified).toBe(true);
      evidenceId = executionBody.result.evidence?.artifactId ?? null;
      expect(evidenceId).toBeTruthy();

      const exportResponse = await receiverOffline.POST(new Request("http://localhost:3000/api/offline", {
        method: "POST",
        headers: {cookie: receiverCookie, "content-type": "application/json"},
        body: JSON.stringify({action: "export", artifactIds: [evidenceId]})
      }));
      expect(exportResponse.status).toBe(201);
      exportedBundle = (await exportResponse.json()).bundle;
    } finally {
      for (const key of envKeys) {
        const value = previousEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    if (exportedBundle && evidenceId) {
      const originalPeerKeys = process.env.BOB_OFFLINE_PEER_KEYS;
      try {
        process.env.BOB_OFFLINE_PEER_KEYS = JSON.stringify({"field-node-test": signingKey, [receiverNodeId]: receiverKey});
        const synced = await offlineRoute.POST(new Request("http://localhost:3000/api/offline", {
          method: "POST",
          headers: {cookie, "content-type": "application/json"},
          body: JSON.stringify({action: "import", bundle: exportedBundle})
        }));
        expect(synced.status).toBe(200);
        const syncBody = await synced.json() as {result: {importedArtifacts: number; mergedNodes: number; mergedEdges: number}};
        expect(syncBody.result.importedArtifacts).toBe(1);
        expect(syncBody.result.mergedNodes).toBeGreaterThan(0);
        expect(syncBody.result.mergedEdges).toBeGreaterThan(0);

        const syncedProvenance = provenance.listProvenance();
        const syncedNodeIds = new Set(syncedProvenance.nodes.map(node => node.id));
        expect(syncedNodeIds).toContain(evidenceId);
        expect(syncedNodeIds).toContain(signedPackage.packageId);
        expect(syncedNodeIds).toContain(receiverTaskId);
        expect(syncedNodeIds).toContain(receiverSandboxId);
        expect(syncedProvenance.nodes.find(node => node.id === signedPackage.packageId)?.createdAt).toBe(signedPackage.createdAt);
        expect(syncedProvenance.edges).toEqual(expect.arrayContaining([
          expect.objectContaining({from: evidenceId, to: signedPackage.packageId, relation: "DERIVED_FROM"}),
          expect.objectContaining({from: receiverTaskId, to: signedPackage.packageId, relation: "DERIVED_FROM"}),
          expect.objectContaining({from: receiverSandboxId, to: signedPackage.packageId, relation: "DERIVED_FROM"})
        ]));
      } finally {
        if (originalPeerKeys === undefined) delete process.env.BOB_OFFLINE_PEER_KEYS;
        else process.env.BOB_OFFLINE_PEER_KEYS = originalPeerKeys;
      }
    }
  }, 90_000);

  it("fails closed for tampering, unknown peers, modified assets and stale local snapshots", async () => {
    const changedPayload = structuredClone(signedPackage);
    changedPayload.task.title = "altered task";
    await expect(packages.validateOfflineTaskPackage(changedPayload)).rejects.toThrow(/digest mismatch/i);

    const originalPeers = process.env.BOB_OFFLINE_PEER_KEYS;
    try {
      process.env.BOB_OFFLINE_PEER_KEYS = "{}";
      await expect(packages.validateOfflineTaskPackage(signedPackage)).rejects.toThrow(/no valid offline signing key/i);
    } finally {
      process.env.BOB_OFFLINE_PEER_KEYS = originalPeers ?? "{}";
    }

    fs.writeFileSync(stagedPath, "modified model bytes");
    await expect(packages.validateOfflineTaskPackage(signedPackage)).rejects.toThrow(/asset failed local verification/i);
    fs.writeFileSync(stagedPath, "staged offline model bytes");

    control.updateTaskStatus(taskId, "WAITING");
    await expect(packages.validateOfflineTaskPackage(signedPackage, {requireLocalBindings: true})).rejects.toThrow(/task snapshot is stale/i);
  });

  it("refuses tasks without a granted approval before signing a package", async () => {
    const mission = control.createMission({title: "Approval mission", objective: "Approval must hold", createdBy: "CREATOR"});
    const objective = control.createObjective({missionId: mission.missionId, title: "Approval objective", description: "Requires human approval"});
    const task = control.createTask({missionId: mission.missionId, objectiveId: objective.objectiveId, title: "High-risk offline task", risk: "HIGH", assignedAgent: "AG-BUILD", createdBy: "CREATOR"});
    const plan = plans.createPlan({objectiveId: objective.objectiveId, taskIds: [task.taskId], expectedEffects: ["Scoped result"], abortCriteria: ["Stop on policy drift"], createdBy: "CREATOR"});
    plans.activatePlan(plan.planId);
    control.registerSandbox({sandboxId: "SB-OFFLINE-APPROVAL", type: "test", status: "QUEUED", lifecycle: "CREATED", network: "DENY", taskId: task.taskId, agentId: "AG-BUILD", runtimeMode: "mock"});
    await expect(packages.createOfflineTaskPackage({taskId: task.taskId, planId: plan.planId})).rejects.toThrow(/GRANTED approval/i);
  });
});
