import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {createStore, storageRoot} from "./persistence/store";
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

export type OfflineBundleManifest = {schemaVersion: 1; bundleId: string; createdAt: string; resources: Array<Pick<OfflineResource,"id"|"kind"|"name"|"version"|"sha256"|"sizeBytes"|"source"|"metadata"> & {file: string}>; manifestSha256: string};

type Payload = {resources: OfflineResource[]; sync: OfflineSyncRecord[]; bundles: string[]};
const store = createStore<Payload>("offline-fabric", 1, () => ({resources: [], sync: [], bundles: []}));

const sha256File = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const safeId = (value: string) => /^[A-Za-z0-9._-]+$/.test(value) ? value : value.replace(/[^A-Za-z0-9._-]/g, "_");
const manifestDigest = (manifest: Omit<OfflineBundleManifest,"manifestSha256">) => crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

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

export function exportOfflineBundle(resourceIds: string[], destination: string): OfflineBundleManifest {
  if (!Array.isArray(resourceIds) || resourceIds.length === 0) throw new Error("at least one resource is required");
  const absolute = fs.realpathSync.native ? fs.realpathSync.native(storageRoot()) : fs.realpathSync(storageRoot());
  const target = fs.existsSync(destination) ? fs.realpathSync(destination) : destination;
  if (target === absolute || target.startsWith(absolute + "/")) throw new Error("offline bundle destination must be outside the storage root");
  fs.mkdirSync(target, {recursive:true, mode:0o700});
  const payload = store.read();
  const selected = resourceIds.map(id => payload.resources.find(r => r.id === id));
  if (selected.some(r => !r)) throw new Error("offline bundle references an unknown resource");
  const resources = selected.map(resource => {
    const verified = verifyOfflineResource(resource!.id);
    const file = `${safeId(verified.id)}.resource`;
    fs.copyFileSync(verified.location, path.join(target, file));
    return {id:verified.id,kind:verified.kind,name:verified.name,version:verified.version,sha256:verified.sha256,sizeBytes:verified.sizeBytes,source:verified.source,metadata:verified.metadata,file};
  });
  const base: Omit<OfflineBundleManifest,"manifestSha256"> = {schemaVersion:1,bundleId:`BND-${crypto.randomUUID().slice(0,10).toUpperCase()}`,createdAt:new Date().toISOString(),resources};
  const manifest: OfflineBundleManifest = {...base,manifestSha256:manifestDigest(base)};
  fs.writeFileSync(path.join(target,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
  store.update(p => p.bundles.push(manifest.bundleId));
  recordAudit({actor:"CREATOR",action:"offline.bundle.export",resource:manifest.bundleId,decision:"ALLOW"},{resourceIds,manifestSha256:manifest.manifestSha256});
  observe({type:"offline.bundle.exported",message:`Offline-Bundle ${manifest.bundleId} erstellt`,status:"COMPLETED",actor:"CREATOR",action:"offline.bundle.export",resource:manifest.bundleId});
  return structuredClone(manifest);
}

export function importOfflineBundle(bundleDirectory: string): {bundleId:string; imported:string[]} {
  const manifestPath = path.join(bundleDirectory,"manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath,"utf8")) as OfflineBundleManifest;
  if (manifest.schemaVersion !== 1 || !manifest.bundleId || !Array.isArray(manifest.resources)) throw new Error("invalid offline bundle manifest");
  const {manifestSha256,...base} = manifest;
  if (manifestDigest(base) !== manifestSha256) throw new Error("offline bundle manifest digest mismatch");
  const imported:string[]=[];
  const destinationRoot=path.join(storageRoot(),"offline-imports",safeId(manifest.bundleId));
  fs.mkdirSync(destinationRoot,{recursive:true,mode:0o700});
  for (const item of manifest.resources) {
    if (!item.id || !item.file || !/^[A-Za-z0-9._-]+$/.test(item.file)) throw new Error("invalid offline bundle file name");
    const sourceFile=path.join(bundleDirectory,item.file);
    if (!fs.statSync(sourceFile).isFile()) throw new Error(`offline bundle file missing: ${item.file}`);
    const digest=sha256File(sourceFile);
    if (digest !== item.sha256) throw new Error(`offline bundle digest mismatch: ${item.id}`);
    const existing=store.read().resources.find(r=>r.id===item.id);
    if(existing && existing.sha256!==item.sha256){
      recordAudit({actor:"CREATOR",action:"offline.bundle.merge",resource:item.id,decision:"DENY"},{reason:"PROVENANCE_CONFLICT",existingDigest:existing.sha256,incomingDigest:item.sha256,bundleId:manifest.bundleId});
      throw new Error(`offline bundle provenance conflict: ${item.id}`);
    }
    const destination=path.join(destinationRoot,safeId(item.id));
    fs.copyFileSync(sourceFile,destination);
    const now=new Date().toISOString();
    store.update(p=>{
      const current=p.resources.find(r=>r.id===item.id);
      const resource:OfflineResource={id:item.id,kind:item.kind,name:item.name,version:item.version,location:destination,sha256:item.sha256,sizeBytes:item.sizeBytes,source:item.source,metadata:{...(current?.metadata??{}),...item.metadata,bundleId:manifest.bundleId},verified:true,createdAt:current?.createdAt??now,updatedAt:now};
      if(current) Object.assign(current,resource); else p.resources.push(resource);
    });
    imported.push(item.id);
  }
  store.update(p=>p.bundles.push(manifest.bundleId));
  recordAudit({actor:"CREATOR",action:"offline.bundle.import",resource:manifest.bundleId,decision:"ALLOW"},{imported});
  observe({type:"offline.bundle.imported",message:`Offline-Bundle ${manifest.bundleId} importiert`,status:"COMPLETED",actor:"CREATOR",action:"offline.bundle.import",resource:manifest.bundleId});
  return {bundleId:manifest.bundleId,imported};
}

export function offlineStoreReport() { return {...store.integrity(),bundles:store.read().bundles.length}; }
