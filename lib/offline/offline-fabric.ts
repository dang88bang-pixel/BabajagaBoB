import crypto from "node:crypto";
import {createStore} from "../persistence/store";
import {contentDigest} from "../artifacts";
import {recordAudit} from "../audit";
import {observe} from "../observability";
import {addProvenanceEdge, addProvenanceNode} from "../provenance";
import {getControlState} from "../control-plane";
import {executeSystemAuthorized} from "../system-execution";
import type {ExecutionResult} from "../runtime";

/**
 * Offline Fabric (MASTER §36, Anforderung OFF-001, Phase 4 / 7.4).
 *
 * Arbeiten ohne Internet: ein lokaler Bestand aus Paketen, Modellen und
 * Wissen, offline gebaute Task-Pakete, Ausführung ohne Netz (DENY-Sandbox
 * über den autorisierten Systempfad) und ein späterer, **herkunftstreuer**
 * Abgleich: Jeder Eintrag trägt Digest und Quelle, nichts wird still
 * überschrieben — Abweichungen sind Konflikte, die eine explizite
 * Entscheidung verlangen und im Provenance-Graph landen.
 */

export type OfflineAssetKind = "PACKAGE" | "MODEL" | "KNOWLEDGE" | "DOCS" | "DATASET" | "IMAGE" | "TOOLCHAIN" | "GIT";
const ASSET_KINDS: OfflineAssetKind[] = ["PACKAGE", "MODEL", "KNOWLEDGE", "DOCS", "DATASET", "IMAGE", "TOOLCHAIN", "GIT"];

/**
 * Inhalte werden nur bis zu dieser Größe im Bestandsspeicher gehalten
 * (Standard 1 MiB, analog zum Sandbox-Output-Limit). Größere Einträge
 * bleiben ehrliche Metadaten-Referenzen: Digest, Quelle, Größe.
 */
export const OFFLINE_MAX_STORED_CONTENT_BYTES = Number(process.env.BOB_OFFLINE_MAX_CONTENT_BYTES ?? 1024 * 1024);

export type OfflineAsset = {
  assetId: string;
  kind: OfflineAssetKind;
  name: string;
  version: string;
  digest: string;
  sizeBytes: number;
  source: string;
  addedBy: string;
  addedAt: string;
  previousDigest?: string;
  status: "AVAILABLE" | "SUPERSEDED";
  /** Inhalt, wenn er unter die Speichergrenze fällt; sonst nur Digest-Referenz */
  content?: string;
  contentStored: boolean;
};

export type OfflineTaskPackage = {
  packageId: string;
  taskId: string;
  assetIds: string[];
  argv?: string[];
  createdBy: string;
  createdAt: string;
  digest: string;
};

export type OfflineRun = {
  runKey: string;
  packageId: string;
  taskId: string;
  sandboxId: string;
  startedAt: string;
  finishedAt: string;
  accepted: boolean;
  exitCode: number | null;
  timedOut: boolean;
  evidence?: {artifactId: string; digest: string; verified: boolean};
};

export type SyncAction = "UNCHANGED" | "IMPORT_PENDING" | "CONFLICT" | "LOCAL_ONLY";

export type SyncDecision = {
  kind: OfflineAssetKind;
  name: string;
  version: string;
  remoteDigest: string | null;
  localDigest: string | null;
  action: SyncAction;
  reason: string;
  resolution?: "KEEP_LOCAL" | "ACCEPT_REMOTE";
};

export type OfflineSync = {
  syncId: string;
  source: string;
  requestedBy: string;
  createdAt: string;
  decisions: SyncDecision[];
};

type Payload = {
  assets: OfflineAsset[];
  packages: OfflineTaskPackage[];
  runs: OfflineRun[];
  syncs: OfflineSync[];
};

const store = createStore<Payload>("offline-fabric", 1, () => ({assets: [], packages: [], runs: [], syncs: []}));

function assertAssetRef(kind: string, name: string, version: string) {
  if (!ASSET_KINDS.includes(kind as OfflineAssetKind)) throw new Error(`unknown offline asset kind: ${kind}`);
  if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) throw new Error(`invalid offline asset name: ${name}`);
  if (typeof version !== "string" || version.length === 0 || version.length > 64 || /[\s:]/.test(version)) throw new Error(`invalid offline asset version: ${version}`);
}

/**
 * Registriert einen Offline-Bestandseintrag mit Inhalt. Idempotent bei
 * gleichem Digest; bei abweichendem Digest derselben Version entsteht eine
 * neue Linie (`previousDigest`) und der alte Eintrag wird `SUPERSEDED` —
 * niemals wird still überschrieben (Herkunftstreue).
 */
export function registerOfflineAsset(input: {kind: OfflineAssetKind; name: string; version: string; content: string; source: string; addedBy: string}): OfflineAsset {
  assertAssetRef(input.kind, input.name, input.version);
  if (typeof input.content !== "string" || input.content.length === 0) throw new Error("offline asset content must be non-empty");
  if (typeof input.source !== "string" || input.source.length === 0) throw new Error("offline asset source is required (provenance)");
  const digest = contentDigest(input.content);
  const assetId = `OFFA-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  store.update(payload => {
    const existing = payload.assets.find(asset => asset.kind === input.kind && asset.name === input.name && asset.version === input.version && asset.status === "AVAILABLE");
    if (existing && existing.digest === digest) return;
    if (existing) existing.status = "SUPERSEDED";
    const sizeBytes = Buffer.byteLength(input.content, "utf8");
    const contentStored = sizeBytes <= OFFLINE_MAX_STORED_CONTENT_BYTES;
    payload.assets.push({
      assetId,
      kind: input.kind,
      name: input.name,
      version: input.version,
      digest,
      sizeBytes,
      source: input.source,
      addedBy: input.addedBy,
      addedAt: new Date().toISOString(),
      ...(existing ? {previousDigest: existing.digest} : {}),
      status: "AVAILABLE",
      ...(contentStored ? {content: input.content} : {}),
      contentStored
    });
  });
  const created = store.read().assets.find(asset => asset.assetId === assetId) ?? store.read().assets.find(asset => asset.kind === input.kind && asset.name === input.name && asset.version === input.version && asset.status === "AVAILABLE");
  if (!created) throw new Error("offline asset could not be persisted");
  addProvenanceNode({id: created.assetId, kind: "ARTIFACT", label: `offline:${created.kind.toLowerCase()} ${created.name}@${created.version}`});
  const superseded = store.read().assets.find(asset => asset.kind === input.kind && asset.name === input.name && asset.version === input.version && asset.status === "SUPERSEDED" && asset.digest === created.previousDigest);
  if (superseded) addProvenanceEdge({from: created.assetId, to: superseded.assetId, relation: "DERIVED_FROM", note: "offline asset lineage (digest changed, not overwritten)"});
  recordAudit({actor: input.addedBy, action: "offline:asset:register", decision: "ALLOW", resource: created.assetId}, {kind: input.kind, name: input.name, version: input.version, digest, superseded: Boolean(created.previousDigest)});
  observe({
    type: "offline.asset.registered",
    message: `Offline-Bestandseintrag ${input.kind} ${input.name}@${input.version} registriert${created.previousDigest ? " (neue Linie, Herkunft erhalten)" : ""}`,
    status: "RUNNING",
    actor: input.addedBy,
    action: "offline:asset:register",
    resource: created.assetId
  });
  return created;
}

export function listOfflineAssets(includeSuperseded = false): OfflineAsset[] {
  return store.read().assets.filter(asset => includeSuperseded || asset.status === "AVAILABLE");
}

export function findOfflineAsset(kind: OfflineAssetKind, name: string, version: string): OfflineAsset | undefined {
  return store.read().assets.find(asset => asset.kind === kind && asset.name === name && asset.version === version && asset.status === "AVAILABLE");
}

/**
 * Baut ein Offline-Task-Paket: alle referenzierten Bestandseinträge müssen
 * AVAILABLE sein (fail closed), das Manifest erhält einen Digest.
 */
export function createOfflinePackage(input: {taskId: string; assets: Array<{kind: OfflineAssetKind; name: string; version: string}>; argv?: string[]; createdBy: string}): OfflineTaskPackage {
  const state = getControlState();
  if (!state.tasks.some(task => task.taskId === input.taskId)) throw new Error(`task not found: ${input.taskId}`);
  if (!Array.isArray(input.assets) || input.assets.length === 0) throw new Error("offline package requires at least one asset");
  const assetIds: string[] = [];
  for (const ref of input.assets) {
    const asset = findOfflineAsset(ref.kind, ref.name, ref.version);
    if (!asset) throw new Error(`offline asset not available (fail closed): ${ref.kind} ${ref.name}@${ref.version}`);
    assetIds.push(asset.assetId);
  }
  const packageId = `OFFP-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const packageDigest = contentDigest(JSON.stringify({packageId, taskId: input.taskId, assetIds, argv: input.argv ?? null}));
  store.update(payload => {
    payload.packages.push({
      packageId,
      taskId: input.taskId,
      assetIds,
      ...(input.argv ? {argv: input.argv} : {}),
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      digest: packageDigest
    });
  });
  const created = store.read().packages.find(pkg => pkg.packageId === packageId);
  if (!created) throw new Error("offline package could not be persisted");
  addProvenanceNode({id: created.packageId, kind: "ARTIFACT", label: `offline:package für ${input.taskId}`});
  for (const assetId of assetIds) addProvenanceEdge({from: created.packageId, to: assetId, relation: "DERIVED_FROM", note: "offline package asset"});
  recordAudit({actor: input.createdBy, action: "offline:package:create", decision: "ALLOW", resource: created.packageId}, {taskId: input.taskId, assetIds, digest: created.digest});
  return created;
}

export function listOfflinePackages(): OfflineTaskPackage[] {
  return store.read().packages;
}

/**
 * Offline-Ausführung eines Pakets: ausschließlich in einer DENY-Sandbox und
 * ausschließlich über den autorisierten Systempfad (Gate → Broker → Evidenz);
 * es gibt keinen Ausführungsweg am Broker vorbei.
 */
export async function executeOfflinePackage(input: {packageId: string; sandboxId: string; argv: string[]; timeoutMs?: number}): Promise<OfflineRun> {
  const pkg = store.read().packages.find(entry => entry.packageId === input.packageId);
  if (!pkg) throw new Error(`offline package not found: ${input.packageId}`);
  const state = getControlState();
  const sandbox = state.sandboxes.find(entry => entry.sandboxId === input.sandboxId);
  if (!sandbox) throw new Error(`sandbox not found: ${input.sandboxId}`);
  if (sandbox.network !== "DENY") throw new Error("offline execution requires a DENY-network sandbox (no egress)");
  const startedAt = new Date().toISOString();
  let result: ExecutionResult;
  try {
    result = await executeSystemAuthorized({purpose: "OFFLINE_PACKAGE", sandboxId: input.sandboxId, argv: input.argv, ...(input.timeoutMs !== undefined ? {timeoutMs: input.timeoutMs} : {})});
  } catch (error) {
    recordAudit({actor: "SYSTEM", action: "offline:execute", decision: "DENY", resource: input.packageId}, {sandboxId: input.sandboxId, reason: error instanceof Error ? error.message : String(error)});
    throw error;
  }
  const runKey = `OFFR-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  store.update(payload => {
    payload.runs.push({
      runKey,
      packageId: input.packageId,
      taskId: pkg.taskId,
      sandboxId: input.sandboxId,
      startedAt,
      finishedAt: new Date().toISOString(),
      accepted: result.accepted,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ...(result.evidence ? {evidence: {artifactId: result.evidence.artifactId, digest: result.evidence.digest, verified: result.evidence.verified}} : {})
    });
  });
  const run = store.read().runs.find(entry => entry.runKey === runKey);
  if (!run) throw new Error("offline run could not be persisted");
  if (run.evidence) {
    addProvenanceNode({id: run.evidence.artifactId, kind: "EVIDENCE", label: `offline:run ${run.runKey}`, runId: run.runKey});
    addProvenanceEdge({from: pkg.packageId, to: run.evidence.artifactId, relation: "PRODUCED", note: "offline execution evidence"});
  }
  recordAudit({actor: "SYSTEM", action: "offline:execute", decision: result.accepted ? "ALLOW" : "DENY", resource: input.packageId}, {runKey: run.runKey, sandboxId: input.sandboxId, accepted: result.accepted, exitCode: result.exitCode});
  observe({
    type: "offline.run.finished",
    message: `Offline-Ausführung ${run.runKey} ${result.accepted ? "erfolgreich" : "fehlgeschlagen"} (exit ${result.exitCode ?? "-"}), Sandbox ${input.sandboxId} (DENY)`,
    status: result.accepted ? "RUNNING" : "FAILED",
    actor: "SYSTEM",
    action: "offline:execute",
    resource: input.packageId
  });
  return run;
}

export function listOfflineRuns(): OfflineRun[] {
  return store.read().runs;
}

export type RemoteManifestItem = {kind: OfflineAssetKind; name: string; version: string; digest: string};
export type RemoteManifest = {source: string; items: RemoteManifestItem[]};

/**
 * Herkunftstreuer Abgleich (Sync): vergleicht ein Remote-Manifest mit dem
 * lokalen Bestand. Gleiche Digeste sind UNCHANGED, abweichende Digeste sind
 * CONFLICT (nichts wird automatisch überschrieben), unbekannte Einträge sind
 * IMPORT_PENDING, lokale Alleingänge LOCAL_ONLY. Jede Entscheidung wird
 * persistiert, auditiert und im Provenance-Graph verankert.
 */
export function planOfflineSync(manifest: RemoteManifest, requestedBy: string): OfflineSync {
  if (typeof manifest.source !== "string" || manifest.source.length === 0) throw new Error("sync source is required (provenance)");
  if (!Array.isArray(manifest.items)) throw new Error("sync manifest items must be an array");
  const decisions: SyncDecision[] = [];
  const seen = new Set<string>();
  for (const item of manifest.items) {
    assertAssetRef(item.kind, item.name, item.version);
    if (typeof item.digest !== "string" || !/^[a-f0-9]{64}$/.test(item.digest)) throw new Error(`sync manifest digest is invalid for ${item.name}@${item.version}`);
    const key = `${item.kind}:${item.name}@${item.version}`;
    if (seen.has(key)) throw new Error(`sync manifest contains duplicate entry: ${key}`);
    seen.add(key);
    const local = findOfflineAsset(item.kind, item.name, item.version);
    if (!local) {
      decisions.push({kind: item.kind, name: item.name, version: item.version, remoteDigest: item.digest, localDigest: null, action: "IMPORT_PENDING", reason: "remote entry is not in the local inventory"});
    } else if (local.digest === item.digest) {
      decisions.push({kind: item.kind, name: item.name, version: item.version, remoteDigest: item.digest, localDigest: local.digest, action: "UNCHANGED", reason: "digests match"});
    } else {
      decisions.push({kind: item.kind, name: item.name, version: item.version, remoteDigest: item.digest, localDigest: local.digest, action: "CONFLICT", reason: "digest mismatch — provenance-preserving merge requires an explicit decision"});
    }
  }
  for (const asset of listOfflineAssets()) {
    if (!seen.has(`${asset.kind}:${asset.name}@${asset.version}`)) {
      decisions.push({kind: asset.kind, name: asset.name, version: asset.version, remoteDigest: null, localDigest: asset.digest, action: "LOCAL_ONLY", reason: "local asset has no remote counterpart"});
    }
  }
  const syncId = `OFFS-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  store.update(payload => {
    payload.syncs.push({syncId, source: manifest.source, requestedBy, createdAt: new Date().toISOString(), decisions});
  });
  const sync = store.read().syncs.find(entry => entry.syncId === syncId);
  if (!sync) throw new Error("offline sync could not be persisted");
  addProvenanceNode({id: sync.syncId, kind: "EVENT", label: `offline:sync von ${manifest.source}`});
  for (const decision of decisions) {
    const local = findOfflineAsset(decision.kind, decision.name, decision.version);
    if (!local) continue;
    if (decision.action === "UNCHANGED") addProvenanceEdge({from: sync.syncId, to: local.assetId, relation: "TESTED_BY", note: "offline sync verified digest"});
    if (decision.action === "CONFLICT") addProvenanceEdge({from: local.assetId, to: sync.syncId, relation: "CONTRADICTED_BY", note: "offline sync digest conflict"});
    if (decision.action === "LOCAL_ONLY") addProvenanceEdge({from: sync.syncId, to: local.assetId, relation: "OBSERVED", note: "local-only offline asset"});
  }
  recordAudit({actor: requestedBy, action: "offline:sync", decision: "ALLOW", resource: sync.syncId}, {source: manifest.source, summary: summarizeDecisions(decisions)});
  observe({
    type: "offline.sync.planned",
    message: `Offline-Abgleich ${sync.syncId} von ${manifest.source}: ${decisions.length} Entscheidungen (${decisions.filter(d => d.action === "CONFLICT").length} Konflikte)`,
    status: "RUNNING",
    actor: requestedBy,
    action: "offline:sync",
    resource: sync.syncId
  });
  return sync;
}

/**
 * Explizite Konfliktentscheidung (Creator-Akt): KEEP_LOCAL bestätigt den
 * lokalen Stand, ACCEPT_REMOTE erklärt den Remote-Stand zur neuen Linie —
 * der tatsächliche Import erfolgt über `importRemoteAsset` mit Inhaltsprüfung.
 */
export function resolveOfflineConflict(syncId: string, ref: {kind: OfflineAssetKind; name: string; version: string}, resolution: "KEEP_LOCAL" | "ACCEPT_REMOTE", decidedBy: string): SyncDecision {
  const sync = store.read().syncs.find(entry => entry.syncId === syncId);
  if (!sync) throw new Error(`offline sync not found: ${syncId}`);
  const open = sync.decisions.find(entry => entry.kind === ref.kind && entry.name === ref.name && entry.version === ref.version && entry.action === "CONFLICT" && !entry.resolution);
  if (!open) throw new Error(`no open conflict for ${ref.kind} ${ref.name}@${ref.version} in ${syncId}`);
  store.update(payload => {
    const target = payload.syncs.find(entry => entry.syncId === syncId)?.decisions.find(entry => entry.kind === ref.kind && entry.name === ref.name && entry.version === ref.version && entry.action === "CONFLICT" && !entry.resolution);
    if (target) target.resolution = resolution;
  });
  recordAudit({actor: decidedBy, action: "offline:sync:resolve", decision: "ALLOW", resource: syncId}, {kind: ref.kind, name: ref.name, version: ref.version, resolution});
  const updated = store.read().syncs.find(entry => entry.syncId === syncId)?.decisions.find(entry => entry.kind === ref.kind && entry.name === ref.name && entry.version === ref.version);
  if (!updated) throw new Error("conflict resolution was not persisted");
  return updated;
}

/**
 * Import aus einem Remote-Manifest: Der Inhalt wird **vor** der Aufnahme
 * gegen den im Manifest deklarierten Digest geprüft (fail closed) und dann
 * über den regulären Registrierungsweg mit voller Herkunft aufgenommen.
 */
export function importRemoteAsset(input: {item: RemoteManifestItem; content: string; source: string; addedBy: string}): OfflineAsset {
  if (typeof input.item?.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.item.digest)) throw new Error("remote manifest digest is invalid");
  const computed = contentDigest(input.content);
  if (computed !== input.item.digest) throw new Error(`remote asset digest mismatch: manifest ${input.item.digest}, content ${computed} — import refused (provenance)`);
  return registerOfflineAsset({kind: input.item.kind, name: input.item.name, version: input.item.version, content: input.content, source: input.source, addedBy: input.addedBy});
}

export function listOfflineSyncs(): OfflineSync[] {
  return store.read().syncs;
}

export function summarizeDecisions(decisions: SyncDecision[]): Record<SyncAction, number> {
  const summary: Record<SyncAction, number> = {UNCHANGED: 0, IMPORT_PENDING: 0, CONFLICT: 0, LOCAL_ONLY: 0};
  for (const decision of decisions) summary[decision.action] += 1;
  return summary;
}

export function offlineFabricSummary() {
  const payload = store.read();
  const available = payload.assets.filter(asset => asset.status === "AVAILABLE");
  return {
    assets: {total: payload.assets.length, available: available.length, superseded: payload.assets.length - available.length},
    packages: payload.packages.length,
    runs: {total: payload.runs.length, accepted: payload.runs.filter(run => run.accepted).length},
    syncs: {total: payload.syncs.length, conflicts: payload.syncs.reduce((count, sync) => count + sync.decisions.filter(decision => decision.action === "CONFLICT").length, 0)},
    defaultNetwork: "DENY"
  };
}
