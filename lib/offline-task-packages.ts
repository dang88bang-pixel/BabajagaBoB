import crypto from "node:crypto";
import {getControlState} from "./control-plane";
import {getOfflineAsset, verifyOfflineAsset, type OfflineAssetKind} from "./offline-assets";
import {signOfflinePayload, verifyOfflinePayload, type OfflinePayloadSignature} from "./offline-fabric";
import {createStore} from "./persistence/store";
import {addProvenanceEdge, listProvenance, mergeProvenanceNode} from "./provenance";
import {listKnowledge, type KnowledgeNode} from "./knowledge";
import {listPlans} from "./plans";
import {observe} from "./observability";
import type {Risk, Sandbox, Status, Task} from "./types";

const SCHEMA = "bob.offline-task/v1" as const;
const PACKAGE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PACKAGE_BYTES = 2_000_000;
const MAX_ASSETS = 128;
const MAX_KNOWLEDGE = 100;
const MAX_RECORDS = 500;
const RISK_VALUES: readonly Risk[] = ["SAFE", "LOW", "MODERATE", "HIGH", "CRITICAL"];
const STATUS_VALUES: readonly Status[] = ["QUEUED", "PLANNING", "RUNNING", "THINKING", "EXECUTING", "EXPERIMENT", "TESTING", "OBSERVING", "VALIDATING", "WAITING", "BLOCKED", "APPROVAL_REQUIRED", "ERROR", "BUG", "RECOVERING", "ROLLING_BACK", "SUCCEEDED", "FAILED", "COMPLETED", "CANCELLED"];
const ASSET_KINDS: readonly OfflineAssetKind[] = ["PACKAGE", "MODEL", "DOCUMENTATION", "GIT", "CONTAINER", "SDK", "COMPILER", "DATASET"];

export type OfflineTaskPackagePayload = {
  schema: typeof SCHEMA;
  packageId: string;
  createdAt: string;
  expiresAt: string;
  task: {
    taskId: string;
    projectId: string;
    missionId: string;
    objectiveId: string;
    title: string;
    status: Status;
    progress: number;
    risk: Risk;
    assignedAgentId: string;
    requiresApproval: boolean;
    approvalId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  plan: {
    planId: string;
    version: number;
    planStepId: string;
    order: number;
    expectedEffect: string;
    stepAbortCriteria: string[];
    expectedEffects: string[];
    planAbortCriteria: string[];
  };
  sandbox: {
    sandboxId: string;
    type: Sandbox["type"];
    status: Status;
    lifecycle: Sandbox["lifecycle"];
    runtimeMode: Sandbox["runtimeMode"];
    network: "DENY";
  };
  assets: Array<{assetId: string; kind: OfflineAssetKind; name: string; digest: string; sizeBytes: number}>;
  knowledge: KnowledgeNode[];
  executionPolicy: {
    network: "DENY";
    brokerRequired: true;
    capabilityRequired: true;
    capabilitySecretIncluded: false;
    requiredCapabilities: ["task:execute", "sandbox:run"];
    maxRisk: Risk;
    approvalRequired: boolean;
    approvalId: string | null;
  };
};

export type OfflineTaskPackage = OfflineTaskPackagePayload & OfflinePayloadSignature;
type PackageRecord = {packageId: string; payloadDigest: string; originNodeId: string; createdAt: string; expiresAt: string; taskId: string; assetIds: string[]};
type Payload = {packages: PackageRecord[]};
const store = createStore<Payload>("offline-task-packages", 1, () => ({packages: []}));

type LocalPackageBindings = {taskId: string; planId: string; sandboxId: string; approvalId: string | null};
export type OfflineTaskPackageImport = {
  packageId: string;
  payloadDigest: string;
  originNodeId: string;
  sourceTaskId: string;
  assetIds: string[];
  importedAt: string;
  status: "IMPORTED" | "ACTIVE";
  localBindings?: LocalPackageBindings;
  activatedAt?: string;
  activatedBy?: string;
};
type ImportPayload = {imports: OfflineTaskPackageImport[]};
const importStore = createStore<ImportPayload>("offline-task-package-imports", 1, () => ({imports: []}));

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const requiredAndOptionalKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[]) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const objectRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hasControlCharacter = (value: string) => Array.from(value).some(character => {
  const code = character.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
});
const validText = (value: unknown, max = 512) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0");
const validId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 160 && !value.includes(":") && !hasControlCharacter(value);

function payloadFrom(input: OfflineTaskPackage): OfflineTaskPackagePayload {
  return {
    schema: input.schema,
    packageId: input.packageId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    task: input.task,
    plan: input.plan,
    sandbox: input.sandbox,
    assets: input.assets,
    knowledge: input.knowledge,
    executionPolicy: input.executionPolicy
  };
}

function taskSnapshot(task: Task, approvalId: string | null): OfflineTaskPackagePayload["task"] {
  if (!task.objectiveId || !task.assignedAgent) throw new Error("offline task package requires an objective and assigned agent");
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    missionId: task.missionId,
    objectiveId: task.objectiveId,
    title: task.title,
    status: task.status,
    progress: task.progress,
    risk: task.risk,
    assignedAgentId: task.assignedAgent,
    requiresApproval: task.requiresApproval,
    approvalId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function assertLiveBindings(bundle: OfflineTaskPackagePayload) {
  const state = getControlState();
  const task = state.tasks.find(value => value.taskId === bundle.task.taskId);
  if (!task) throw new Error(`offline package task is not present in local control state: ${bundle.task.taskId}`);
  const grantedApproval = task.requiresApproval
    ? state.approvals.find(value => value.approvalId === bundle.task.approvalId && value.taskId === task.taskId && value.status === "GRANTED")
    : undefined;
  if (task.requiresApproval && !grantedApproval) throw new Error("offline package approval is missing, stale or not GRANTED");
  const approvalId = grantedApproval?.approvalId ?? null;
  const currentTask = taskSnapshot(task, approvalId);
  if (JSON.stringify(currentTask) !== JSON.stringify(bundle.task)) throw new Error("offline package task snapshot is stale or differs from local control state");

  const agent = state.agents.find(value => value.agentId === task.assignedAgent);
  if (!agent || !agent.capabilities.includes("task:execute") || !agent.capabilities.includes("sandbox:run")) throw new Error("offline package agent lacks required static capabilities");
  const riskRank: Record<Risk, number> = {SAFE: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4};
  if (riskRank[agent.maxRisk] < riskRank[task.risk]) throw new Error("offline package agent risk ceiling is insufficient");

  const plan = listPlans().find(value => value.planId === bundle.plan.planId);
  if (!plan || plan.status !== "ACTIVE" || plan.version !== bundle.plan.version || plan.objectiveId !== task.objectiveId) throw new Error("offline package plan is missing, stale or not ACTIVE");
  const step = plan.steps.find(value => value.stepId === bundle.plan.planStepId && value.taskId === task.taskId && value.order === bundle.plan.order);
  if (!step || step.expectedEffect !== bundle.plan.expectedEffect || JSON.stringify(step.abortCriteria) !== JSON.stringify(bundle.plan.stepAbortCriteria)) throw new Error("offline package plan step is stale or outside the task scope");
  if (JSON.stringify(plan.expectedEffects) !== JSON.stringify(bundle.plan.expectedEffects) || JSON.stringify(plan.abortCriteria) !== JSON.stringify(bundle.plan.planAbortCriteria)) throw new Error("offline package plan scope is stale");

  const sandbox = state.sandboxes.find(value => value.sandboxId === bundle.sandbox.sandboxId);
  if (!sandbox || sandbox.taskId !== task.taskId || sandbox.agentId !== task.assignedAgent || sandbox.network !== "DENY") throw new Error("offline package sandbox binding or DENY network policy is invalid");
  const currentSandbox = {sandboxId: sandbox.sandboxId, type: sandbox.type, status: sandbox.status, lifecycle: sandbox.lifecycle, runtimeMode: sandbox.runtimeMode, network: "DENY" as const};
  if (JSON.stringify(currentSandbox) !== JSON.stringify(bundle.sandbox)) throw new Error("offline package sandbox snapshot is stale or differs from local control state");
}

function persistPackageRecord(bundle: OfflineTaskPackagePayload & OfflinePayloadSignature) {
  const record: PackageRecord = {
    packageId: bundle.packageId,
    payloadDigest: bundle.payloadDigest,
    originNodeId: bundle.originNodeId,
    createdAt: bundle.createdAt,
    expiresAt: bundle.expiresAt,
    taskId: bundle.task.taskId,
    assetIds: bundle.assets.map(asset => asset.assetId)
  };
  const existing = store.read().packages.find(value => value.packageId === record.packageId);
  if (existing) {
    if (existing.payloadDigest !== record.payloadDigest || existing.originNodeId !== record.originNodeId || existing.taskId !== record.taskId) throw new Error(`offline task package id conflict: ${record.packageId}`);
    return;
  }
  store.update(value => {
    if (value.packages.length >= MAX_RECORDS) throw new Error("offline task package history is full");
    value.packages.push(record);
  });
}

export async function createOfflineTaskPackage(input: {taskId: string; planId: string; assetIds?: string[]; knowledgeIds?: string[]}): Promise<OfflineTaskPackage> {
  if (!input || typeof input !== "object" || !validId(input.taskId) || !validId(input.planId)) throw new Error("taskId and planId are required");
  const assetIds = input.assetIds ?? [];
  const knowledgeIds = input.knowledgeIds ?? [];
  if (!Array.isArray(assetIds) || assetIds.length > MAX_ASSETS || assetIds.some(id => !validId(id)) || new Set(assetIds).size !== assetIds.length) throw new Error(`assetIds must contain at most ${MAX_ASSETS} unique ids`);
  if (!Array.isArray(knowledgeIds) || knowledgeIds.length > MAX_KNOWLEDGE || knowledgeIds.some(id => !validId(id)) || new Set(knowledgeIds).size !== knowledgeIds.length) throw new Error(`knowledgeIds must contain at most ${MAX_KNOWLEDGE} unique ids`);

  const state = getControlState();
  const task = state.tasks.find(value => value.taskId === input.taskId);
  if (!task) throw new Error(`task not found: ${input.taskId}`);
  if (["SUCCEEDED", "FAILED", "COMPLETED", "CANCELLED"].includes(task.status)) throw new Error("terminal tasks cannot be packaged for offline work");
  if (!task.objectiveId || !task.assignedAgent) throw new Error("offline task package requires an objective and assigned agent");
  const agent = state.agents.find(value => value.agentId === task.assignedAgent);
  if (!agent || !agent.capabilities.includes("task:execute") || !agent.capabilities.includes("sandbox:run")) throw new Error("assigned agent lacks required static execution capabilities");
  const riskRank: Record<Risk, number> = {SAFE: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4};
  if (riskRank[agent.maxRisk] < riskRank[task.risk]) throw new Error("assigned agent risk ceiling is insufficient");

  const plan = listPlans().find(value => value.planId === input.planId);
  if (!plan || plan.status !== "ACTIVE" || plan.objectiveId !== task.objectiveId || !plan.steps.some(step => step.taskId === task.taskId)) throw new Error("offline package requires an ACTIVE plan step bound to the task objective");
  const step = plan.steps.find(value => value.taskId === task.taskId);
  if (!step) throw new Error("active plan step not found for task");

  const sandbox = state.sandboxes.find(value => value.taskId === task.taskId && value.agentId === task.assignedAgent && value.network === "DENY" && value.lifecycle !== "DESTROYED" && value.lifecycle !== "FAILED");
  if (!sandbox) throw new Error("offline package requires a task/agent-bound sandbox with network DENY");

  const approval = task.requiresApproval
    ? state.approvals.find(value => value.taskId === task.taskId && value.status === "GRANTED")
    : undefined;
  if (task.requiresApproval && !approval) throw new Error("offline package requires a GRANTED approval");
  const approvalId = approval?.approvalId ?? null;

  const assets: OfflineTaskPackagePayload["assets"] = [];
  for (const assetId of [...assetIds].sort()) {
    const asset = getOfflineAsset(assetId);
    if (!asset) throw new Error(`offline asset is not registered: ${assetId}`);
    const verification = await verifyOfflineAsset(assetId);
    if (!verification.valid) throw new Error(`offline asset does not verify: ${assetId}`);
    assets.push({assetId: asset.id, kind: asset.kind, name: asset.name, digest: asset.digest, sizeBytes: asset.sizeBytes});
  }

  const knowledgeStore = listKnowledge().nodes;
  const knowledge = [...knowledgeIds].sort().map(knowledgeId => {
    const node = knowledgeStore.find(value => value.knowledgeId === knowledgeId);
    if (!node) throw new Error(`offline knowledge item not found: ${knowledgeId}`);
    return JSON.parse(JSON.stringify(node)) as KnowledgeNode;
  });
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + PACKAGE_TTL_MS).toISOString();
  const payload: OfflineTaskPackagePayload = {
    schema: SCHEMA,
    packageId: `OTP-${crypto.randomUUID()}`,
    createdAt,
    expiresAt,
    task: taskSnapshot(task, approvalId),
    plan: {
      planId: plan.planId,
      version: plan.version,
      planStepId: step.stepId,
      order: step.order,
      expectedEffect: step.expectedEffect,
      stepAbortCriteria: structuredClone(step.abortCriteria),
      expectedEffects: structuredClone(plan.expectedEffects),
      planAbortCriteria: structuredClone(plan.abortCriteria)
    },
    sandbox: {sandboxId: sandbox.sandboxId, type: sandbox.type, status: sandbox.status, lifecycle: sandbox.lifecycle, runtimeMode: sandbox.runtimeMode, network: "DENY"},
    assets,
    knowledge,
    executionPolicy: {
      network: "DENY",
      brokerRequired: true,
      capabilityRequired: true,
      capabilitySecretIncluded: false,
      requiredCapabilities: ["task:execute", "sandbox:run"],
      maxRisk: task.risk,
      approvalRequired: task.requiresApproval,
      approvalId
    }
  };
  const envelope = signOfflinePayload(payload);
  const taskPackage: OfflineTaskPackage = {...payload, ...envelope};
  if (Buffer.byteLength(JSON.stringify(taskPackage), "utf8") > MAX_PACKAGE_BYTES) throw new Error("offline task package exceeds the size limit");
  validateShape(taskPackage);
  assertLiveBindings(payload);

  persistPackageRecord(taskPackage);
  observe({
    type: "offline.task-package.created",
    message: `Offline-Task-Paket ${taskPackage.packageId} erstellt`,
    status: "COMPLETED",
    actor: "CREATOR",
    taskId: task.taskId,
    sandboxId: sandbox.sandboxId,
    action: "offline.task-package.create",
    argumentsValue: {packageId: taskPackage.packageId, originNodeId: taskPackage.originNodeId, taskId: task.taskId, planId: plan.planId, assetCount: assets.length, knowledgeCount: knowledge.length, payloadDigest: taskPackage.payloadDigest}
  });
  mergeProvenanceNode({id: taskPackage.packageId, kind: "OFFLINE_TASK_PACKAGE", label: taskPackage.packageId, createdAt: taskPackage.createdAt});
  addProvenanceEdge({from: taskPackage.packageId, to: task.taskId, relation: "DERIVED_FROM", note: "Creator-signiertes Offline Task Package"});
  for (const asset of assets) addProvenanceEdge({from: taskPackage.packageId, to: asset.assetId, relation: "DERIVED_FROM", note: `Pinned offline asset ${asset.digest}`});
  return structuredClone(taskPackage);
}

function validateKnowledgeNode(value: unknown): value is KnowledgeNode {
  if (!objectRecord(value) || !requiredAndOptionalKeys(value, ["knowledgeId", "layer", "subject", "predicate", "object", "state", "confidence", "sourceIds", "evidenceIds", "createdAt", "updatedAt"], ["conditions", "verification"])) return false;
  const allowedLayers = ["WORKING", "EPISODIC", "SEMANTIC", "NEGATIVE"];
  const allowedStates = ["OBSERVED", "SUPPORTED", "ESTABLISHED", "HYPOTHESIS", "UNVERIFIED", "CONTRADICTED", "REJECTED", "UNKNOWN"];
  const allowedConfidence = ["EVIDENCE_BASED", "SINGLE_SOURCE", "UNVERIFIED"];
  return validId(value.knowledgeId) && allowedLayers.includes(String(value.layer)) && validText(value.subject, 2048) && validText(value.predicate, 2048) && validText(value.object, 8192) && allowedStates.includes(String(value.state)) && allowedConfidence.includes(String(value.confidence)) &&
    Array.isArray(value.sourceIds) && value.sourceIds.length <= 100 && value.sourceIds.every(validId) && Array.isArray(value.evidenceIds) && value.evidenceIds.length <= 100 && value.evidenceIds.every(validId) &&
    (value.conditions === undefined || validText(value.conditions, 4096)) && (value.verification === undefined || validText(value.verification, 4096)) && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt));
}

function validateShape(input: unknown): OfflineTaskPackage {
  if (!objectRecord(input) || !exactKeys(input, ["schema", "packageId", "createdAt", "expiresAt", "task", "plan", "sandbox", "assets", "knowledge", "executionPolicy", "originNodeId", "payloadDigest", "signature"])) throw new Error("offline task package shape is invalid");
  const bundle = input as unknown as OfflineTaskPackage;
  if (bundle.schema !== SCHEMA || typeof bundle.packageId !== "string" || !/^OTP-[a-f0-9-]{36}$/.test(bundle.packageId)) throw new Error("offline task package identity or schema is invalid");
  const created = Date.parse(bundle.createdAt);
  const expires = Date.parse(bundle.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > Date.now() + 5 * 60_000 || expires <= Date.now() || expires <= created || expires - created > PACKAGE_TTL_MS) throw new Error("offline task package timestamps are invalid or expired");

  if (!objectRecord(bundle.task) || !exactKeys(bundle.task, ["taskId", "projectId", "missionId", "objectiveId", "title", "status", "progress", "risk", "assignedAgentId", "requiresApproval", "approvalId", "createdAt", "updatedAt"])) throw new Error("offline task package task snapshot is invalid");
  if (![bundle.task.taskId, bundle.task.projectId, bundle.task.missionId, bundle.task.objectiveId, bundle.task.assignedAgentId].every(validId) || !validText(bundle.task.title) || !STATUS_VALUES.includes(bundle.task.status) || ["SUCCEEDED", "FAILED", "COMPLETED", "CANCELLED"].includes(bundle.task.status) || !Number.isFinite(bundle.task.progress) || bundle.task.progress < 0 || bundle.task.progress > 100 || !RISK_VALUES.includes(bundle.task.risk) || typeof bundle.task.requiresApproval !== "boolean" || (bundle.task.approvalId !== null && !validId(bundle.task.approvalId)) || !Number.isFinite(Date.parse(bundle.task.createdAt)) || !Number.isFinite(Date.parse(bundle.task.updatedAt))) throw new Error("offline task package task values are invalid");
  if (bundle.task.requiresApproval && !bundle.task.approvalId) throw new Error("offline task package approval reference is required");

  if (!objectRecord(bundle.plan) || !exactKeys(bundle.plan, ["planId", "version", "planStepId", "order", "expectedEffect", "stepAbortCriteria", "expectedEffects", "planAbortCriteria"])) throw new Error("offline task package plan snapshot is invalid");
  if (![bundle.plan.planId, bundle.plan.planStepId].every(validId) || !Number.isSafeInteger(bundle.plan.version) || bundle.plan.version < 1 || !Number.isSafeInteger(bundle.plan.order) || bundle.plan.order < 1 || !validText(bundle.plan.expectedEffect) || !Array.isArray(bundle.plan.stepAbortCriteria) || bundle.plan.stepAbortCriteria.length > 100 || !bundle.plan.stepAbortCriteria.every(value => validText(value)) || !Array.isArray(bundle.plan.expectedEffects) || bundle.plan.expectedEffects.length > 100 || !bundle.plan.expectedEffects.every(value => validText(value)) || !Array.isArray(bundle.plan.planAbortCriteria) || bundle.plan.planAbortCriteria.length > 100 || !bundle.plan.planAbortCriteria.every(value => validText(value))) throw new Error("offline task package plan values are invalid");

  if (!objectRecord(bundle.sandbox) || !exactKeys(bundle.sandbox, ["sandboxId", "type", "status", "lifecycle", "runtimeMode", "network"])) throw new Error("offline task package sandbox snapshot is invalid");
  if (!validId(bundle.sandbox.sandboxId) || !["development", "experiment", "test", "browser", "security", "migration", "staging", "recovery", "diagnostic"].includes(bundle.sandbox.type) || !STATUS_VALUES.includes(bundle.sandbox.status) || !["CREATED", "RUNNING", "PAUSED", "SNAPSHOTTED", "RESTORED", "DESTROYED", "FAILED"].includes(bundle.sandbox.lifecycle) || !["real-local", "real-oci", "mock"].includes(bundle.sandbox.runtimeMode) || bundle.sandbox.network !== "DENY") throw new Error("offline task package sandbox values or network policy are invalid");

  if (!Array.isArray(bundle.assets) || bundle.assets.length > MAX_ASSETS || new Set(bundle.assets.map(asset => asset?.assetId)).size !== bundle.assets.length) throw new Error("offline task package asset list is invalid");
  for (const asset of bundle.assets) {
    if (!objectRecord(asset) || !exactKeys(asset, ["assetId", "kind", "name", "digest", "sizeBytes"]) || typeof asset.assetId !== "string" || !/^AS-[A-F0-9]{24}$/.test(asset.assetId) || !ASSET_KINDS.includes(asset.kind) || !validText(asset.name, 128) || !/^[a-f0-9]{64}$/.test(asset.digest) || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0 || asset.sizeBytes > 20 * 1024 * 1024 * 1024) throw new Error("offline task package asset reference is invalid");
  }
  if (!Array.isArray(bundle.knowledge) || bundle.knowledge.length > MAX_KNOWLEDGE || new Set(bundle.knowledge.map(node => node?.knowledgeId)).size !== bundle.knowledge.length || !bundle.knowledge.every(validateKnowledgeNode)) throw new Error("offline task package knowledge snapshot is invalid");

  if (!objectRecord(bundle.executionPolicy) || !exactKeys(bundle.executionPolicy, ["network", "brokerRequired", "capabilityRequired", "capabilitySecretIncluded", "requiredCapabilities", "maxRisk", "approvalRequired", "approvalId"]) || bundle.executionPolicy.network !== "DENY" || bundle.executionPolicy.brokerRequired !== true || bundle.executionPolicy.capabilityRequired !== true || bundle.executionPolicy.capabilitySecretIncluded !== false || JSON.stringify(bundle.executionPolicy.requiredCapabilities) !== JSON.stringify(["task:execute", "sandbox:run"]) || !RISK_VALUES.includes(bundle.executionPolicy.maxRisk) || typeof bundle.executionPolicy.approvalRequired !== "boolean" || (bundle.executionPolicy.approvalId !== null && !validId(bundle.executionPolicy.approvalId))) throw new Error("offline task package execution policy is invalid");
  if (bundle.executionPolicy.maxRisk !== bundle.task.risk || bundle.executionPolicy.approvalRequired !== bundle.task.requiresApproval || bundle.executionPolicy.approvalId !== bundle.task.approvalId) throw new Error("offline task package execution policy does not match task scope");

  if (Buffer.byteLength(JSON.stringify(bundle), "utf8") > MAX_PACKAGE_BYTES) throw new Error("offline task package exceeds the size limit");
  return bundle;
}

export async function validateOfflineTaskPackage(input: unknown, options: {requireLocalBindings?: boolean; actor?: string} = {}): Promise<{packageId: string; originNodeId: string; payloadDigest: string; taskId: string; assetsVerified: number; knowledgeCount: number; localBindingsVerified: boolean}> {
  const bundle = validateShape(input);
  const payload = payloadFrom(bundle);
  verifyOfflinePayload(payload, {originNodeId: bundle.originNodeId, payloadDigest: bundle.payloadDigest, signature: bundle.signature});
  for (const reference of bundle.assets) {
    const localAsset = getOfflineAsset(reference.assetId);
    if (!localAsset || localAsset.kind !== reference.kind || localAsset.name !== reference.name || localAsset.digest !== reference.digest || localAsset.sizeBytes !== reference.sizeBytes) throw new Error(`offline task package asset is not present with the pinned digest: ${reference.assetId}`);
    const verification = await verifyOfflineAsset(reference.assetId);
    if (!verification.valid) throw new Error(`offline task package asset failed local verification: ${reference.assetId}`);
  }
  if (bundle.executionPolicy.network !== "DENY") throw new Error("offline task package may not authorize network access");
  if (options.requireLocalBindings) assertLiveBindings(payload);
  const priorPackageNode = listProvenance().nodes.find(node => node.id === bundle.packageId);
  if (priorPackageNode && (priorPackageNode.kind !== "OFFLINE_TASK_PACKAGE" || priorPackageNode.label !== bundle.packageId || priorPackageNode.createdAt !== bundle.createdAt)) {
    throw new Error(`offline task package provenance id conflict: ${bundle.packageId}`);
  }
  persistPackageRecord(bundle);
  observe({
    type: "offline.task-package.validated",
    message: `Offline-Task-Paket ${bundle.packageId} validiert`,
    status: "COMPLETED",
    actor: options.actor ?? "CREATOR",
    taskId: bundle.task.taskId,
    sandboxId: bundle.sandbox.sandboxId,
    action: "offline.task-package.validate",
    argumentsValue: {packageId: bundle.packageId, originNodeId: bundle.originNodeId, taskId: bundle.task.taskId, assetCount: bundle.assets.length, knowledgeCount: bundle.knowledge.length, localBindingsVerified: Boolean(options.requireLocalBindings), payloadDigest: bundle.payloadDigest}
  });
  mergeProvenanceNode({id: bundle.packageId, kind: "OFFLINE_TASK_PACKAGE", label: bundle.packageId, createdAt: bundle.createdAt});
  const packageNode = listProvenance().nodes.find(node => node.id === bundle.packageId);
  if (!packageNode || packageNode.kind !== "OFFLINE_TASK_PACKAGE" || packageNode.label !== bundle.packageId || packageNode.createdAt !== bundle.createdAt) throw new Error(`offline task package provenance node is unavailable or inconsistent: ${bundle.packageId}`);
  if (options.requireLocalBindings) {
    for (const asset of bundle.assets) {
      const assetNode = listProvenance().nodes.find(node => node.id === asset.assetId);
      if (!assetNode || assetNode.kind !== "ASSET") throw new Error(`offline task package asset provenance node is unavailable: ${asset.assetId}`);
      if (!listProvenance().edges.some(edge => edge.from === bundle.packageId && edge.to === asset.assetId && edge.relation === "DERIVED_FROM")) {
        addProvenanceEdge({from: bundle.packageId, to: asset.assetId, relation: "DERIVED_FROM", note: `Pinned offline asset ${asset.digest}`});
      }
    }
  }
  if (options.requireLocalBindings) {
    const taskNode = listProvenance().nodes.find(node => node.id === bundle.task.taskId);
    if (!taskNode || taskNode.kind !== "TASK") throw new Error(`offline task package task provenance node is unavailable: ${bundle.task.taskId}`);
    if (!listProvenance().edges.some(edge => edge.from === bundle.packageId && edge.to === bundle.task.taskId && edge.relation === "DERIVED_FROM")) {
      addProvenanceEdge({from: bundle.packageId, to: bundle.task.taskId, relation: "DERIVED_FROM", note: "Validiertes Offline Task Package"});
    }
  }
  return {packageId: bundle.packageId, originNodeId: bundle.originNodeId, payloadDigest: bundle.payloadDigest, taskId: bundle.task.taskId, assetsVerified: bundle.assets.length, knowledgeCount: bundle.knowledge.length, localBindingsVerified: Boolean(options.requireLocalBindings)};
}

function assertLocalActivationBindings(bundle: OfflineTaskPackagePayload, bindings: LocalPackageBindings) {
  const state = getControlState();
  const task = state.tasks.find(value => value.taskId === bindings.taskId);
  if (!task || ["SUCCEEDED", "FAILED", "COMPLETED", "CANCELLED"].includes(task.status)) throw new Error("offline package local task is missing or terminal");
  if (task.title !== bundle.task.title || task.risk !== bundle.task.risk || task.requiresApproval !== bundle.task.requiresApproval || task.assignedAgent !== bundle.task.assignedAgentId) {
    throw new Error("offline package does not match the receiving task title, risk, approval policy or agent binding");
  }
  if (!task.objectiveId || !task.assignedAgent) throw new Error("offline package receiving task requires a local objective and assigned agent");
  const agent = state.agents.find(value => value.agentId === task.assignedAgent);
  if (!agent || !bundle.executionPolicy.requiredCapabilities.every(capability => agent.capabilities.includes(capability))) throw new Error("receiving agent lacks the package's required static capabilities");
  const riskRank: Record<Risk, number> = {SAFE: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4};
  if (riskRank[agent.maxRisk] < riskRank[task.risk]) throw new Error("receiving agent risk ceiling is insufficient");

  const plan = listPlans().find(value => value.planId === bindings.planId);
  if (!plan || plan.status !== "ACTIVE" || plan.objectiveId !== task.objectiveId || plan.expectedEffects.length !== bundle.plan.expectedEffects.length || JSON.stringify(plan.expectedEffects) !== JSON.stringify(bundle.plan.expectedEffects) || JSON.stringify(plan.abortCriteria) !== JSON.stringify(bundle.plan.planAbortCriteria)) {
    throw new Error("offline package receiving plan is missing, inactive or differs from the signed plan scope");
  }
  const step = plan.steps.find(value => value.taskId === task.taskId);
  const mappedExpectedEffect = bundle.plan.expectedEffect.split(bundle.task.taskId).join(task.taskId);
  if (!step || step.order !== bundle.plan.order || step.expectedEffect !== mappedExpectedEffect || JSON.stringify(step.abortCriteria) !== JSON.stringify(bundle.plan.stepAbortCriteria)) {
    throw new Error("offline package receiving plan step differs from the signed task scope");
  }

  const sandbox = state.sandboxes.find(value => value.sandboxId === bindings.sandboxId);
  if (!sandbox || sandbox.taskId !== task.taskId || sandbox.agentId !== task.assignedAgent || sandbox.type !== bundle.sandbox.type || sandbox.network !== "DENY" || sandbox.lifecycle !== "RUNNING" || sandbox.status !== "RUNNING") {
    throw new Error("offline package receiving sandbox is missing, stopped or outside the local DENY task/agent binding");
  }
  if (task.requiresApproval) {
    if (!bindings.approvalId) throw new Error("offline package activation requires a local GRANTED approval");
    const approval = state.approvals.find(value => value.approvalId === bindings.approvalId && value.taskId === task.taskId && value.status === "GRANTED");
    if (!approval) throw new Error("offline package local approval is missing or not GRANTED");
  } else if (bindings.approvalId !== null) {
    throw new Error("offline package without an approval requirement may not bind an approval");
  }
  return {task, sandbox};
}

export async function importOfflineTaskPackage(input: unknown, actor = "CREATOR"): Promise<{record: OfflineTaskPackageImport; duplicate: boolean; validation: Awaited<ReturnType<typeof validateOfflineTaskPackage>>}> {
  const bundle = validateShape(input);
  const validation = await validateOfflineTaskPackage(bundle, {actor});
  const assetIds = bundle.assets.map(asset => asset.assetId).sort();
  let duplicate = false;
  importStore.update(payload => {
    const existing = payload.imports.find(value => value.packageId === bundle.packageId);
    if (existing) {
      if (existing.payloadDigest !== bundle.payloadDigest || existing.originNodeId !== bundle.originNodeId || existing.sourceTaskId !== bundle.task.taskId || JSON.stringify(existing.assetIds) !== JSON.stringify(assetIds)) {
        throw new Error(`offline task package import conflict: ${bundle.packageId}`);
      }
      duplicate = true;
      return;
    }
    if (payload.imports.length >= MAX_RECORDS) throw new Error("offline task package import history is full");
    payload.imports.push({
      packageId: bundle.packageId,
      payloadDigest: bundle.payloadDigest,
      originNodeId: bundle.originNodeId,
      sourceTaskId: bundle.task.taskId,
      assetIds,
      importedAt: new Date().toISOString(),
      status: "IMPORTED"
    });
  });
  const record = importStore.read().imports.find(value => value.packageId === bundle.packageId);
  if (!record) throw new Error(`offline task package import record could not be persisted: ${bundle.packageId}`);
  if (!duplicate) {
    observe({
      type: "offline.task-package.imported",
      message: `Offline-Task-Paket ${bundle.packageId} auf diesem Knoten importiert`,
      status: "COMPLETED",
      actor,
      taskId: bundle.task.taskId,
      action: "offline.task-package.import",
      argumentsValue: {packageId: bundle.packageId, originNodeId: bundle.originNodeId, payloadDigest: bundle.payloadDigest, assetCount: bundle.assets.length, knowledgeCount: bundle.knowledge.length}
    });
  }
  return {record: structuredClone(record), duplicate, validation};
}

export async function activateOfflineTaskPackage(input: {
  taskPackage: unknown;
  localTaskId: string;
  localPlanId: string;
  localSandboxId: string;
  localApprovalId?: string;
  actor: string;
}): Promise<{record: OfflineTaskPackageImport; duplicate: boolean; validation: Awaited<ReturnType<typeof validateOfflineTaskPackage>>}> {
  if (!input || typeof input !== "object" || !validId(input.localTaskId) || !validId(input.localPlanId) || !validId(input.localSandboxId) || (input.localApprovalId !== undefined && !validId(input.localApprovalId)) || !validText(input.actor, 128)) {
    throw new Error("offline task package activation requires valid local task, plan, sandbox and actor bindings");
  }
  const bundle = validateShape(input.taskPackage);
  const validation = await validateOfflineTaskPackage(bundle, {actor: input.actor});
  const imported = importStore.read().imports.find(value => value.packageId === bundle.packageId);
  if (!imported) throw new Error("offline task package must be imported on this node before activation");
  if (imported.payloadDigest !== bundle.payloadDigest || imported.originNodeId !== bundle.originNodeId || imported.sourceTaskId !== bundle.task.taskId) {
    throw new Error(`offline task package does not match its imported record: ${bundle.packageId}`);
  }
  const localBindings: LocalPackageBindings = {
    taskId: input.localTaskId,
    planId: input.localPlanId,
    sandboxId: input.localSandboxId,
    approvalId: input.localApprovalId ?? null
  };
  const {task, sandbox} = assertLocalActivationBindings(bundle, localBindings);
  if (imported.status === "ACTIVE" && JSON.stringify(imported.localBindings) !== JSON.stringify(localBindings)) {
    throw new Error(`offline task package is already activated with different local bindings: ${bundle.packageId}`);
  }
  const packageNode = listProvenance().nodes.find(node => node.id === bundle.packageId);
  if (!packageNode || packageNode.kind !== "OFFLINE_TASK_PACKAGE" || packageNode.createdAt !== bundle.createdAt) throw new Error("offline package provenance node is unavailable for activation");
  // Preserve the signed source/receiver relationship so a later evidence bundle
  // can be merged back without re-minting the package identity.
  addProvenanceEdge({from: task.taskId, to: bundle.packageId, relation: "DERIVED_FROM", note: `Activated from ${bundle.originNodeId} package digest ${bundle.payloadDigest}`});
  addProvenanceEdge({from: sandbox.sandboxId, to: bundle.packageId, relation: "DERIVED_FROM", note: "Receiving sandbox activated for signed offline task package"});

  let duplicate = false;
  importStore.update(payload => {
    const record = payload.imports.find(value => value.packageId === bundle.packageId);
    if (!record) throw new Error("offline task package import record disappeared during activation");
    if (record.payloadDigest !== bundle.payloadDigest || record.originNodeId !== bundle.originNodeId) throw new Error(`offline task package import conflict: ${bundle.packageId}`);
    if (record.status === "ACTIVE") {
      if (JSON.stringify(record.localBindings) !== JSON.stringify(localBindings)) throw new Error(`offline task package is already activated with different local bindings: ${bundle.packageId}`);
      duplicate = true;
      return;
    }
    record.status = "ACTIVE";
    record.localBindings = localBindings;
    record.activatedAt = new Date().toISOString();
    record.activatedBy = input.actor;
  });
  const record = importStore.read().imports.find(value => value.packageId === bundle.packageId);
  if (!record) throw new Error(`offline task package activation record could not be persisted: ${bundle.packageId}`);
  if (!duplicate) {
    observe({
      type: "offline.task-package.activated",
      message: `Offline-Task-Paket ${bundle.packageId} an lokale Control-Plane-Bindungen aktiviert`,
      status: "COMPLETED",
      actor: input.actor,
      taskId: task.taskId,
      sandboxId: sandbox.sandboxId,
      action: "offline.task-package.activate",
      argumentsValue: {packageId: bundle.packageId, originNodeId: bundle.originNodeId, payloadDigest: bundle.payloadDigest, localTaskId: task.taskId, localPlanId: localBindings.planId, localSandboxId: sandbox.sandboxId, localApprovalId: localBindings.approvalId}
    });
  }
  return {record: structuredClone(record), duplicate, validation};
}

export function getOfflineTaskPackageImport(packageId: string): OfflineTaskPackageImport | null {
  const record = importStore.read().imports.find(value => value.packageId === packageId);
  return record ? structuredClone(record) : null;
}

export function offlineTaskPackageExecutionBinding(input: unknown): {
  packageId: string;
  payloadDigest: string;
  localTaskId: string;
  localAgentId: string;
  localPlanId: string;
  localSandboxId: string;
  localApprovalId: string | null;
  environment: string;
  risk: Risk;
  runtimeMode: Sandbox["runtimeMode"];
} {
  const bundle = validateShape(input);
  const record = importStore.read().imports.find(value => value.packageId === bundle.packageId);
  if (!record || record.status !== "ACTIVE" || !record.localBindings) throw new Error("offline task package has not been activated on this control plane");
  if (record.payloadDigest !== bundle.payloadDigest || record.originNodeId !== bundle.originNodeId || record.sourceTaskId !== bundle.task.taskId) throw new Error("offline task package does not match the active receiving record");
  const {task, sandbox} = assertLocalActivationBindings(bundle, record.localBindings);
  if (!task.assignedAgent) throw new Error("offline package receiving task has no assigned agent");
  return {
    packageId: bundle.packageId,
    payloadDigest: bundle.payloadDigest,
    localTaskId: task.taskId,
    localAgentId: task.assignedAgent,
    localPlanId: record.localBindings.planId,
    localSandboxId: sandbox.sandboxId,
    localApprovalId: record.localBindings.approvalId,
    environment: sandbox.type,
    risk: task.risk,
    runtimeMode: sandbox.runtimeMode
  };
}

export function offlineTaskPackageImportHistory(): OfflineTaskPackageImport[] {
  return structuredClone(importStore.read().imports);
}

export function offlineTaskPackageHistory(): PackageRecord[] {
  return structuredClone(store.read().packages);
}

export function offlineTaskPackageStoreReport() {
  return {store: store.integrity(), count: store.read().packages.length, imports: importStore.integrity(), importCount: importStore.read().imports.length};
}
