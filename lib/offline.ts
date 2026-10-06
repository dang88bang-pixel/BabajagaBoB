import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {createStore} from "./persistence/store";
import {observe} from "./observability";

export type OfflineAssetKind = "PACKAGE" | "MODEL" | "DOCUMENT" | "KNOWLEDGE" | "RUNTIME" | "DATA";
export type OfflineAsset = {
  assetId: string;
  kind: OfflineAssetKind;
  name: string;
  version: string;
  origin: string;
  localPath?: string;
  digest: string;
  sizeBytes: number;
  createdAt: string;
};
export type OfflineTaskPackage = {
  packageId: string;
  taskId: string;
  createdAt: string;
  origin: string;
  network: "DENY";
  assetIds: string[];
  task: Record<string, unknown>;
  digest: string;
  state: "READY" | "EXECUTED" | "SYNCED" | "CONFLICT";
};
export type OfflineExecution = {
  executionId: string;
  packageId: string;
  origin: string;
  startedAt: string;
  finishedAt?: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  artifactIds: string[];
  logDigest?: string;
  evidenceIds: string[];
};
export type OfflineSyncRecord = {
  recordId: string;
  origin: string;
  kind: "PACKAGE" | "EXECUTION" | "ASSET";
  entityId: string;
  digest: string;
  exportedAt: string;
  lineage: string[];
};
export type OfflineConflict = {
  conflictId: string;
  entityId: string;
  localDigest: string;
  remoteDigest: string;
  origins: string[];
  createdAt: string;
  resolution: "PRESERVE_BOTH";
};

type Payload = {
  assets: OfflineAsset[];
  packages: OfflineTaskPackage[];
  executions: OfflineExecution[];
  sync: OfflineSyncRecord[];
  conflicts: OfflineConflict[];
};

const store = createStore<Payload>("offline", 1, () => ({
  assets: [], packages: [], executions: [], sync: [], conflicts: []
}));

const clone = <T,>(value: T): T => structuredClone(value);
const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;

function safeOrigin(origin: string): string {
  if (typeof origin !== "string" || origin.trim().length < 1 || origin.length > 200) throw new Error("offline origin required");
  return origin.trim();
}

function hashLocalPath(localPath: string): {digest: string; sizeBytes: number} {
  const resolved = path.resolve(localPath);
  const root = path.resolve(process.env.BOB_STORAGE_DIR ?? path.join(process.cwd(), ".bob-data"));
  if (!resolved.startsWith(root + path.sep)) throw new Error("offline asset path must stay inside BOB_STORAGE_DIR");
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("offline asset path must reference a file");
  if (stat.size > 512 * 1024 * 1024) throw new Error("offline asset exceeds 512 MiB registration limit");
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(resolved, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < stat.size) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - position), position);
      if (bytes <= 0) break;
      hash.update(buffer.subarray(0, bytes));
      position += bytes;
    }
  } finally {
    fs.closeSync(fd);
  }
  return {digest: hash.digest("hex"), sizeBytes: stat.size};
}

export function registerOfflineAsset(input: Omit<OfflineAsset, "assetId" | "digest" | "sizeBytes" | "createdAt"> & {digest?: string; sizeBytes?: number}): OfflineAsset {
  const origin = safeOrigin(input.origin);
  if (!input.name?.trim() || !input.version?.trim()) throw new Error("offline asset name and version required");
  let calculated = {digest: input.digest ?? "", sizeBytes: input.sizeBytes ?? 0};
  if (input.localPath) calculated = hashLocalPath(input.localPath);
  if (!/^[a-f0-9]{64}$/.test(calculated.digest)) throw new Error("offline asset requires a SHA-256 digest");
  if (!Number.isSafeInteger(calculated.sizeBytes) || calculated.sizeBytes < 0) throw new Error("offline asset size is invalid");
  const asset: OfflineAsset = {
    ...input,
    assetId: id("OFF-ASSET"),
    digest: calculated.digest,
    sizeBytes: calculated.sizeBytes,
    createdAt: new Date().toISOString(),
    origin
  };
  store.update(payload => { payload.assets.push(asset); });
  observe({type:"offline.asset.registered", message:`Offline-Asset ${asset.assetId} registriert`, status:"COMPLETED", actor:"AG-OFFLINE", action:"offline.asset.register", resource:asset.assetId, argumentsValue:{kind:asset.kind, origin:asset.origin, digest:asset.digest}});
  return clone(asset);
}

export function createOfflineTaskPackage(taskId: string, task: Record<string, unknown>, assetIds: string[], origin: string): OfflineTaskPackage {
  if (!taskId.trim()) throw new Error("taskId required");
  const payload = store.read();
  const assets = assetIds.map(assetId => payload.assets.find(asset => asset.assetId === assetId));
  if (assets.some(asset => !asset)) throw new Error("offline package references an unknown asset");
  const uniqueAssets = [...new Set(assetIds)];
  const body = {taskId, task, assetIds: uniqueAssets, origin:safeOrigin(origin), network:"DENY" as const};
  const pkg: OfflineTaskPackage = {
    packageId:id("OFF-PKG"),
    taskId,
    createdAt:new Date().toISOString(),
    origin:body.origin,
    network:"DENY",
    assetIds:uniqueAssets,
    task:clone(task),
    digest:digest(body),
    state:"READY"
  };
  store.update(next => { next.packages.push(pkg); });
  observe({type:"offline.package.created", message:`Offline-Task-Package ${pkg.packageId} erstellt`, status:"COMPLETED", actor:"AG-OFFLINE", taskId, action:"offline.package.create", resource:pkg.packageId, argumentsValue:{assetIds:uniqueAssets,network:"DENY",digest:pkg.digest}});
  return clone(pkg);
}

export function startOfflineExecution(packageId: string): OfflineExecution {
  const payload = store.read();
  const pkg = payload.packages.find(item => item.packageId === packageId);
  if (!pkg) throw new Error("offline package not found");
  if (pkg.state === "CONFLICT") throw new Error("offline package is conflicted");
  const execution: OfflineExecution = {executionId:id("OFF-RUN"), packageId, origin:pkg.origin, startedAt:new Date().toISOString(), status:"RUNNING", artifactIds:[], evidenceIds:[]};
  store.update(next => {
    const current = next.packages.find(item => item.packageId === packageId);
    if (!current || current.state === "CONFLICT") throw new Error("offline package became unavailable");
    current.state = "EXECUTED";
    next.executions.push(execution);
  });
  observe({type:"offline.execution.started", message:`Offline-Ausführung ${execution.executionId} gestartet`, status:"RUNNING", actor:"AG-OFFLINE", taskId:pkg.taskId, action:"offline.execute", resource:execution.executionId, argumentsValue:{packageId,network:"DENY"}});
  return clone(execution);
}

export function finishOfflineExecution(executionId: string, input: {status:"SUCCEEDED"|"FAILED"; artifactIds?:string[]; evidenceIds?:string[]; log?:string}): OfflineExecution {
  const payload = store.read();
  const execution = payload.executions.find(item => item.executionId === executionId);
  if (!execution) throw new Error("offline execution not found");
  if (execution.status !== "RUNNING") throw new Error("offline execution is already terminal");
  execution.status = input.status;
  execution.finishedAt = new Date().toISOString();
  execution.artifactIds = [...new Set(input.artifactIds ?? [])];
  execution.evidenceIds = [...new Set(input.evidenceIds ?? [])];
  execution.logDigest = input.log === undefined ? execution.logDigest : digest(input.log);
  store.update(next => {
    const current = next.executions.find(item => item.executionId === executionId);
    if (!current || current.status !== "RUNNING") throw new Error("offline execution changed concurrently");
    Object.assign(current, execution);
  });
  observe({type:"offline.execution.finished", message:`Offline-Ausführung ${executionId}: ${execution.status}`, status:execution.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED", actor:"AG-OFFLINE", action:"offline.execute.finish", resource:executionId, decision:execution.status === "SUCCEEDED" ? "ALLOW" : "DENY", argumentsValue:{artifactIds:execution.artifactIds,evidenceIds:execution.evidenceIds,logDigest:execution.logDigest}});
  return clone(execution);
}

function syncDigest(record: OfflineSyncRecord): string {
  return digest({...record, exportedAt:undefined});
}

export function exportOfflineSync(origin: string): OfflineSyncRecord[] {
  const source = safeOrigin(origin);
  const payload = store.read();
  const records: OfflineSyncRecord[] = [
    ...payload.assets.filter(x => x.origin === source).map(x => ({recordId:id("SYNC"),origin:source,kind:"ASSET" as const,entityId:x.assetId,digest:x.digest,exportedAt:new Date().toISOString(),lineage:[x.assetId]})),
    ...payload.packages.filter(x => x.origin === source).map(x => ({recordId:id("SYNC"),origin:source,kind:"PACKAGE" as const,entityId:x.packageId,digest:x.digest,exportedAt:new Date().toISOString(),lineage:[x.packageId,...x.assetIds]})),
    ...payload.executions.filter(x => x.origin === source).map(x => ({recordId:id("SYNC"),origin:source,kind:"EXECUTION" as const,entityId:x.executionId,digest:digest(x),exportedAt:new Date().toISOString(),lineage:[x.executionId,x.packageId,...x.artifactIds,...x.evidenceIds]}))
  ];
  store.update(next => { next.sync.push(...records); });
  return clone(records);
}

export function mergeOfflineSync(records: OfflineSyncRecord[]): {accepted:number;duplicates:number;conflicts:number} {
  if (!Array.isArray(records) || records.length > 500) throw new Error("invalid offline sync batch");
  let accepted=0, duplicates=0, conflicts=0;
  store.update(payload => {
    for (const incoming of records) {
      if (!incoming?.recordId || !incoming.entityId || !incoming.origin || !/^[a-f0-9]{64}$/.test(incoming.digest)) throw new Error("invalid offline sync record");
      const same = payload.sync.find(existing => existing.entityId === incoming.entityId);
      if (!same) { payload.sync.push(clone(incoming)); accepted++; continue; }
      if (same.digest === incoming.digest) { duplicates++; continue; }
      const conflict: OfflineConflict = {conflictId:id("OFF-CONFLICT"),entityId:incoming.entityId,localDigest:same.digest,remoteDigest:incoming.digest,origins:[same.origin,incoming.origin],createdAt:new Date().toISOString(),resolution:"PRESERVE_BOTH"};
      payload.conflicts.push(conflict);
      conflicts++;
    }
  });
  if (accepted || conflicts) observe({type:"offline.sync.merged",message:`Offline-Abgleich: ${accepted} neu, ${duplicates} Duplikate, ${conflicts} Konflikte`,status:conflicts ? "BUG" : "COMPLETED",actor:"AG-OFFLINE",action:"offline.sync.merge",argumentsValue:{accepted,duplicates,conflicts}});
  return {accepted,duplicates,conflicts};
}

export function offlineSnapshot() {
  const payload = store.read();
  return {assets:clone(payload.assets),packages:clone(payload.packages),executions:clone(payload.executions),sync:clone(payload.sync),conflicts:clone(payload.conflicts)};
}

export function offlineReport() {
  const report = store.integrity();
  const payload = store.read();
  return {storeOk:report.ok, assets:payload.assets.length,packages:payload.packages.length,executions:payload.executions.length,syncRecords:payload.sync.length,conflicts:payload.conflicts.length,networkDefault:"DENY" as const};
}
