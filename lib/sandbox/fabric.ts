import {createStore} from "../persistence/store";
import {activeSandboxRuntime, runtimeModeLabel} from "../runtime-factory";
import {observe} from "../observability";
import {getControlState, destroySandboxRecord, getTask, registerSandbox, updateSandboxStatus} from "../control-plane";
import type {ResourceLimits, Risk, Sandbox, SandboxLifecycle, SandboxType} from "../types";

/**
 * Sandbox-Fabric (Abschnitt 11).
 *
 * Lifecycle: CREATE → CLONE → RESET → START → RUN → PAUSE → SNAPSHOT → RESTORE → DESTROY
 *
 * Jede Sandbox besitzt:
 *  - eigenes Environment (Workspace des Runtime-Adapters)
 *  - Ressourcenlimits (CPU/RAM/Storage/Timeout/Prozesse)
 *  - Netzwerkpolicy (Default DENY; ALLOWLIST ist fail-closed ohne Egress-Schicht)
 *  - Agent Permissions (Capability-Bindung über den Broker)
 *  - Task Binding (Sandbox gehört zu genau einer Task)
 *  - Repository/Dependency State im Snapshot-Manifest
 *  - Logs, Artifacts und Provenance über den Event-/Provenance-Pfad
 *
 * Sandbox-IDs sind eigenständig (`sandboxId`), Snapshots erhalten eigene IDs und
 * werden niemals als Artifact bezeichnet (Abschnitt 37.7: Snapshot ≠ Artifact).
 */

export type SandboxRequest = {
  sandboxId?: string;
  type: SandboxType;
  taskId: string;
  agentId: string;
  risk: Risk;
  network?: "DENY" | "ALLOWLIST";
  allowlist?: string[];
  limits?: Partial<ResourceLimits>;
  image?: string;
  argv?: string[];
};

export type SnapshotRecord = {
  snapshotId: string;
  sandboxId: string;
  createdAt: string;
  digest: string;
  sizeBytes?: number;
  runtimeMode: string;
};

type Payload = {snapshots: SnapshotRecord[]};
const snapshotStore = createStore<Payload>("sandbox-snapshots", 1, () => ({snapshots: []}));

const DEFAULTS: ResourceLimits = {cpuMillicores: 1000, memoryMb: 1024, storageMb: 2048, timeoutMs: 300_000, processes: 64};

function assertBinding(taskId: string, agentId: string) {
  const state = getControlState();
  const task = state.tasks.find(t => t.taskId === taskId);
  if (!task) throw new Error(`sandbox requires an existing task: ${taskId}`);
  if (!state.agents.some(a => a.agentId === agentId)) throw new Error(`sandbox requires an existing agent: ${agentId}`);
  if (task.assignedAgent && task.assignedAgent !== agentId) throw new Error(`sandbox agent ${agentId} is not assigned to task ${taskId}`);
  return task;
}

export async function createSandbox(request: SandboxRequest): Promise<Sandbox> {
  const task = assertBinding(request.taskId, request.agentId);
  if (request.network === "ALLOWLIST" || (request.allowlist?.length ?? 0) > 0) {
    throw new Error("ALLOWLIST networking is fail-closed until a controlled egress layer exists");
  }
  const sandboxId = request.sandboxId ?? `SB-${Date.now().toString(36).toUpperCase()}`;
  const limits: ResourceLimits = {...DEFAULTS, ...request.limits};
  const handle = await activeSandboxRuntime.create({
    id: sandboxId,
    type: request.type,
    network: {mode: "DENY", allowlist: []},
    limits,
    risk: request.risk,
    image: request.image,
    argv: request.argv
  });
  const sandbox: Sandbox = {
    sandboxId,
    projectId: getControlState().projectId,
    type: request.type,
    status: "RUNNING",
    lifecycle: handle.state === "RUNNING" ? "RUNNING" : "CREATED",
    network: "DENY",
    taskId: request.taskId,
    agentId: request.agentId,
    runtimeMode: handle.mode === "REAL_OCI" ? "real-oci" : handle.mode === "REAL_LOCAL" ? "real-local" : "mock",
    createdAt: new Date().toISOString()
  };
  registerSandbox({
    sandboxId: sandbox.sandboxId,
    type: sandbox.type,
    status: sandbox.status,
    lifecycle: sandbox.lifecycle,
    network: sandbox.network,
    taskId: sandbox.taskId,
    agentId: sandbox.agentId,
    runtimeMode: sandbox.runtimeMode
  });
  observe({
    type: "sandbox.created",
    message: `Sandbox ${sandboxId} (${request.type}) erstellt`,
    status: "RUNNING",
    actor: request.agentId,
    agentId: request.agentId,
    taskId: request.taskId,
    sandboxId,
    action: "sandbox.create",
    resource: sandboxId,
    argumentsValue: {type: request.type, limits, network: "DENY", runtime: runtimeModeLabel()}
  });
  void task;
  return sandbox;
}

function requireSandbox(sandboxId: string): Sandbox {
  const sandbox = getControlState().sandboxes.find(s => s.sandboxId === sandboxId);
  if (!sandbox) throw new Error(`sandbox not registered: ${sandboxId}`);
  return sandbox;
}

export async function startSandbox(sandboxId: string): Promise<Sandbox> {
  requireSandbox(sandboxId);
  const handle = await activeSandboxRuntime.start(sandboxId);
  return updateSandboxStatus(sandboxId, handle.state === "RUNNING" ? "RUNNING" : "WAITING", handle.state as SandboxLifecycle);
}

export async function pauseSandbox(sandboxId: string): Promise<Sandbox> {
  requireSandbox(sandboxId);
  const handle = await activeSandboxRuntime.pause(sandboxId);
  return updateSandboxStatus(sandboxId, "WAITING", handle.state as SandboxLifecycle);
}

export async function resetSandbox(sandboxId: string): Promise<Sandbox> {
  requireSandbox(sandboxId);
  const handle = await activeSandboxRuntime.reset(sandboxId);
  return updateSandboxStatus(sandboxId, "WAITING", handle.state as SandboxLifecycle);
}

export async function cloneSandbox(sourceSandboxId: string, target: SandboxRequest): Promise<Sandbox> {
  requireSandbox(sourceSandboxId);
  assertBinding(target.taskId, target.agentId);
  const sandboxId = target.sandboxId ?? `SB-${Date.now().toString(36).toUpperCase()}`;
  const limits: ResourceLimits = {...DEFAULTS, ...target.limits};
  await activeSandboxRuntime.clone(sourceSandboxId, {
    id: sandboxId,
    type: target.type,
    network: {mode: "DENY", allowlist: []},
    limits,
    risk: target.risk
  });
  const sandbox: Sandbox = {
    sandboxId,
    projectId: getControlState().projectId,
    type: target.type,
    status: "WAITING",
    lifecycle: "CREATED",
    network: "DENY",
    taskId: target.taskId,
    agentId: target.agentId,
    runtimeMode: runtimeModeLabel() === "REAL_OCI" ? "real-oci" : runtimeModeLabel() === "REAL_LOCAL" ? "real-local" : "mock",
    createdAt: new Date().toISOString()
  };
  registerSandbox({
    sandboxId: sandbox.sandboxId,
    type: sandbox.type,
    status: sandbox.status,
    lifecycle: sandbox.lifecycle,
    network: sandbox.network,
    taskId: sandbox.taskId,
    agentId: sandbox.agentId,
    runtimeMode: sandbox.runtimeMode
  });
  observe({
    type: "sandbox.cloned",
    message: `Sandbox ${sandboxId} aus ${sourceSandboxId} geklont`,
    status: "PLANNING",
    actor: target.agentId,
    agentId: target.agentId,
    taskId: target.taskId,
    sandboxId,
    action: "sandbox.clone",
    resource: sandboxId,
    causedBy: undefined
  });
  return sandbox;
}

export async function destroySandbox(sandboxId: string): Promise<void> {
  const sandbox = requireSandbox(sandboxId);
  await activeSandboxRuntime.destroy(sandboxId);
  destroySandboxRecord(sandboxId);
  observe({
    type: "sandbox.destroyed",
    message: `Sandbox ${sandboxId} zerstört`,
    status: "COMPLETED",
    actor: sandbox.agentId,
    agentId: sandbox.agentId,
    taskId: sandbox.taskId,
    sandboxId,
    action: "sandbox.destroy",
    resource: sandboxId
  });
}

export async function snapshotSandbox(sandboxId: string, actor: string): Promise<SnapshotRecord> {
  const sandbox = requireSandbox(sandboxId);
  const snapshot = await activeSandboxRuntime.snapshot(sandboxId);
  const record: SnapshotRecord = {
    snapshotId: snapshot.id,
    sandboxId,
    createdAt: snapshot.createdAt,
    digest: snapshot.digest,
    sizeBytes: snapshot.sizeBytes,
    runtimeMode: runtimeModeLabel()
  };
  snapshotStore.update(payload => {
    payload.snapshots.push(record);
    if (payload.snapshots.length > 500) payload.snapshots.splice(0, payload.snapshots.length - 500);
  });
  updateSandboxStatus(sandboxId, "WAITING", "SNAPSHOTTED");
  observe({
    type: "sandbox.snapshot.created",
    message: `Snapshot ${record.snapshotId} für ${sandboxId} erstellt`,
    status: "COMPLETED",
    actor,
    agentId: sandbox.agentId,
    taskId: sandbox.taskId,
    sandboxId,
    action: "sandbox.snapshot",
    resource: record.snapshotId,
    outputRef: record.snapshotId,
    argumentsValue: {digest: record.digest, sizeBytes: record.sizeBytes}
  });
  return record;
}

export async function restoreSandbox(sandboxId: string, snapshotId: string, actor: string): Promise<Sandbox> {
  const sandbox = requireSandbox(sandboxId);
  const known = snapshotStore.read().snapshots.find(s => s.snapshotId === snapshotId);
  if (!known) throw new Error(`unknown snapshot: ${snapshotId}`);
  if (known.sandboxId !== sandboxId) throw new Error("snapshot does not belong to this sandbox");
  const handle = await activeSandboxRuntime.restore(sandboxId, snapshotId);
  const updated = updateSandboxStatus(sandboxId, "WAITING", handle.state as SandboxLifecycle);
  observe({
    type: "sandbox.restored",
    message: `Sandbox ${sandboxId} aus Snapshot ${snapshotId} wiederhergestellt`,
    status: "RECOVERING",
    actor,
    agentId: sandbox.agentId,
    taskId: sandbox.taskId,
    sandboxId,
    action: "sandbox.restore",
    resource: snapshotId,
    inputRef: snapshotId,
    argumentsValue: {digest: known.digest}
  });
  return updated;
}

export function listSnapshots(sandboxId?: string): SnapshotRecord[] {
  return snapshotStore.read().snapshots.filter(s => !sandboxId || s.sandboxId === sandboxId).map(s => ({...s}));
}

export function listSandboxes(): Sandbox[] {
  return getControlState().sandboxes;
}

export function sandboxSummary() {
  const sandboxes = listSandboxes();
  return {
    total: sandboxes.length,
    byType: sandboxes.reduce<Record<string, number>>((acc, s) => ({...acc, [s.type]: (acc[s.type] ?? 0) + 1}), {}),
    running: sandboxes.filter(s => s.lifecycle === "RUNNING").length,
    networkDeny: sandboxes.filter(s => s.network === "DENY").length
  };
}

export function assertTaskSandboxBinding(taskId: string, sandboxId: string) {
  const sandbox = requireSandbox(sandboxId);
  if (sandbox.taskId !== taskId) throw new Error(`sandbox ${sandboxId} is not bound to task ${taskId}`);
  const task = getTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  return {sandbox, task};
}

export function snapshotStoreReport() {
  return snapshotStore.integrity();
}
