import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {createStore} from "./persistence/store";
import {recordAudit} from "./audit";
import {observe} from "./observability";

export type OfflineResourceKind =
  | "MODEL" | "DOCUMENTATION" | "PACKAGE" | "GIT" | "CONTAINER_IMAGE"
  | "SDK" | "DATASET" | "VECTOR_INDEX" | "KNOWLEDGE_GRAPH";

export type OfflineResource = {
  id: string;
  kind: OfflineResourceKind;
  name: string;
  version?: string;
  location: string;
  sha256: string;
  sizeBytes: number;
  source?: string;
  metadata: Record<string, string>;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OfflineSyncRecord = {
  id: string;
  resourceId: string;
  direction: "IMPORT" | "EXPORT";
  sourceDigest: string;
  targetDigest: string;
  provenanceEventId?: string;
  status: "PREPARED" | "VERIFIED" | "REJECTED";
  createdAt: string;
};

type Payload = {resources: OfflineResource[]; sync: OfflineSyncRecord[]};
const store = createStore<Payload>("offline-fabric", 1, () => ({resources: [], sync: []}));

const sha256File = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function registerOfflineResource(input: Omit<OfflineResource, "id"|"sha256"|"sizeBytes"|"verified"|"createdAt"|"updatedAt">): OfflineResource {
  if (!input.name?.trim() || !input.location?.trim()) throw new Error("offline resource name and location required");
  const stat = fs.statSync(input.location);
  if (!stat.isFile()) throw new Error("offline resource must reference a file");
  const now = new Date().toISOString();
  const resource: OfflineResource = {
    ...input,
    id: `OFF-${crypto.randomUUID().slice(0, 10).toUpperCase()}`,
    sha256: sha256File(input.location),
    sizeBytes: stat.size,
    verified: false,
    createdAt: now,
    updatedAt: now
  };
  store.update(p => { p.resources.push(resource); });
  recordAudit({actor:"CREATOR", action:"offline.register", resource:resource.id, decision:"ALLOW"}, {kind:resource.kind,name:resource.name,sha256:resource.sha256});
  observe({type:"offline.resource.registered",message:`Offline-Ressource ${resource.id} registriert`,status:"COMPLETED",actor:"CREATOR",action:"offline.register",resource:resource.id});
  return structuredClone(resource);
}

export function verifyOfflineResource(id: string): OfflineResource {
  const payload = store.read();
  const resource = payload.resources.find(r => r.id === id);
  if (!resource) throw new Error("offline resource not found");
  let digest = "";
  try { digest = sha256File(resource.location); } catch { resource.verified = false; store.write(payload); throw new Error("offline resource is unavailable"); }
  if (digest !== resource.sha256) {
    resource.verified = false; resource.updatedAt = new Date().toISOString(); store.write(payload);
    recordAudit({actor:"CREATOR",action:"offline.verify",resource:id,decision:"DENY"},{reason:"DIGEST_MISMATCH"});
    throw new Error("offline resource digest mismatch");
  }
  resource.verified = true; resource.updatedAt = new Date().toISOString(); store.write(payload);
  recordAudit({actor:"CREATOR",action:"offline.verify",resource:id,decision:"ALLOW"},{sha256:digest});
  return structuredClone(resource);
}

export function listOfflineResources(kind?: OfflineResourceKind) {
  return structuredClone(store.read().resources.filter(r => !kind || r.kind === kind));
}

export function offlineStatus() {
  const payload = store.read();
  return {
    mode: "OFFLINE_FIRST",
    networkDefault: "DENY",
    resources: payload.resources.length,
    verified: payload.resources.filter(r => r.verified).length,
    unverified: payload.resources.filter(r => !r.verified).length,
    syncRecords: payload.sync.length,
    externalProcessing: "DENY",
    externalStorage: "DENY",
    externalTraining: "DENY"
  };
}

export function prepareOfflineSync(resourceId: string, targetDigest: string): OfflineSyncRecord {
  const resource = store.read().resources.find(r => r.id === resourceId);
  if (!resource) throw new Error("offline resource not found");
  if (!resource.verified) throw new Error("only verified offline resources may sync");
  if (!/^[a-f0-9]{64}$/.test(targetDigest)) throw new Error("target digest required");
  const record: OfflineSyncRecord = {
    id: `SYNC-${crypto.randomUUID().slice(0, 10).toUpperCase()}`,
    resourceId,
    direction: "EXPORT",
    sourceDigest: resource.sha256,
    targetDigest,
    status: "PREPARED",
    createdAt: new Date().toISOString()
  };
  store.update(p => p.sync.push(record));
  return structuredClone(record);
}

export function verifyOfflineSync(id: string, observedTargetDigest: string): OfflineSyncRecord {
  const payload = store.read();
  const record = payload.sync.find(s => s.id === id);
  if (!record) throw new Error("offline sync record not found");
  if (record.targetDigest !== observedTargetDigest) {
    record.status = "REJECTED"; store.write(payload);
    recordAudit({actor:"CREATOR",action:"offline.sync.verify",resource:id,decision:"DENY"},{reason:"TARGET_DIGEST_MISMATCH"});
    throw new Error("offline sync target digest mismatch");
  }
  record.status = "VERIFIED"; store.write(payload);
  recordAudit({actor:"CREATOR",action:"offline.sync.verify",resource:id,decision:"ALLOW"},{targetDigest:observedTargetDigest});
  observe({type:"offline.sync.verified",message:`Offline-Sync ${id} verifiziert`,status:"COMPLETED",actor:"CREATOR",action:"offline.sync.verify",resource:id});
  return structuredClone(record);
}

export function offlineStoreReport() { return store.integrity(); }
