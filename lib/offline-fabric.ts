import crypto from "node:crypto";
import {artifactSnapshot, getArtifact, importVerifiedArtifact, type Artifact} from "./artifacts";
import {createStore} from "./persistence/store";
import {assertRealIdentifier, listProvenance, mergeProvenanceEdge, mergeProvenanceNode, provenanceRelations, type ProvenanceEdge, type ProvenanceNode, type ProvenanceNodeKind} from "./provenance";
import {observe} from "./observability";

/**
 * Air-gap evidence exchange. It transfers immutable evidence and its connected
 * provenance subgraph only; it never transfers capability secrets or changes
 * authorization, task, approval, or execution state.
 */
const SCHEMA = "bob.offline-evidence/v1" as const;
const MAX_ARTIFACTS = 128;
const MAX_NODES = 2_000;
const MAX_EDGES = 4_000;
const MAX_BUNDLE_BYTES = 2_000_000;
const PROVENANCE_KINDS: ProvenanceNodeKind[] = ["EVENT", "TASK", "RUN", "JOB", "SANDBOX", "CAPABILITY", "ARTIFACT", "ASSET", "OFFLINE_TASK_PACKAGE", "EVIDENCE", "EXPERIMENT", "INCIDENT", "RECOVERY", "REGRESSION", "KNOWLEDGE", "DEVICE", "PROVIDER", "AGENT", "WORKSHOP_ITEM", "DEPLOYMENT", "MISSION", "OBJECTIVE"];

type Payload = {imports: Array<{bundleId: string; digest: string; originNodeId: string; importedAt: string; artifactIds: string[]}>};
const store = createStore<Payload>("offline-fabric", 1, () => ({imports: []}));

type UnsignedBundle = {
  schema: typeof SCHEMA;
  bundleId: string;
  createdAt: string;
  originNodeId: string;
  artifacts: Artifact[];
  provenance: {nodes: ProvenanceNode[]; edges: ProvenanceEdge[]};
  payloadDigest: string;
};
export type OfflineEvidenceBundle = UnsignedBundle & {signature: string};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("offline bundle contains a non-JSON value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function assertAcyclicCausation(edges: ProvenanceEdge[]) {
  const graph = new Map<string, string[]>();
  for (const edge of edges) if (edge.relation === "CAUSED_BY") graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) if (!visit(next)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const id of graph.keys()) if (!visit(id)) throw new Error(`offline provenance contains a causal cycle involving ${id}`);
}

function localSigningKey(): Buffer {
  const configured = process.env.BOB_OFFLINE_SYNC_KEY;
  if (typeof configured !== "string" || Buffer.byteLength(configured, "utf8") < 32) {
    throw new Error("BOB_OFFLINE_SYNC_KEY must contain at least 32 UTF-8 bytes; offline export is disabled");
  }
  return Buffer.from(configured, "utf8");
}

function peerSigningKey(originNodeId: string): Buffer {
  const configured = process.env.BOB_OFFLINE_PEER_KEYS;
  if (!configured) throw new Error("BOB_OFFLINE_PEER_KEYS is not configured; offline import is disabled");
  let peers: unknown;
  try { peers = JSON.parse(configured); } catch { throw new Error("BOB_OFFLINE_PEER_KEYS must be a JSON object"); }
  if (!peers || typeof peers !== "object" || Array.isArray(peers)) throw new Error("BOB_OFFLINE_PEER_KEYS must be a JSON object");
  const key = (peers as Record<string, unknown>)[originNodeId];
  if (typeof key !== "string" || Buffer.byteLength(key, "utf8") < 32) throw new Error(`no valid offline signing key is configured for peer ${originNodeId}`);
  return Buffer.from(key, "utf8");
}

function localNodeId(): string {
  const id = process.env.BOB_OFFLINE_NODE_ID;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error("BOB_OFFLINE_NODE_ID must be a configured stable node identifier");
  }
  return id;
}

function signatureFor(body: Omit<OfflineEvidenceBundle, "signature">, key = localSigningKey()): string {
  return crypto.createHmac("sha256", key).update(canonical(body)).digest("hex");
}

export type OfflinePayloadSignature = {originNodeId: string; payloadDigest: string; signature: string};

/** Shared envelope for independently versioned offline payloads (for example task packages). */
export function signOfflinePayload(payload: unknown): OfflinePayloadSignature {
  const originNodeId = localNodeId();
  const payloadDigest = digest(payload);
  const unsigned = {originNodeId, payloadDigest};
  const signature = crypto.createHmac("sha256", localSigningKey()).update(canonical(unsigned)).digest("hex");
  return {originNodeId, payloadDigest, signature};
}

export function verifyOfflinePayload(payload: unknown, envelope: OfflinePayloadSignature): void {
  if (!envelope || typeof envelope.originNodeId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(envelope.originNodeId) || !/^[a-f0-9]{64}$/.test(envelope.payloadDigest) || !/^[a-f0-9]{64}$/.test(envelope.signature)) {
    throw new Error("offline payload signature envelope is invalid");
  }
  if (digest(payload) !== envelope.payloadDigest) throw new Error("offline payload digest mismatch");
  const unsigned = {originNodeId: envelope.originNodeId, payloadDigest: envelope.payloadDigest};
  const expected = crypto.createHmac("sha256", peerSigningKey(envelope.originNodeId)).update(canonical(unsigned)).digest();
  const actual = Buffer.from(envelope.signature, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error("offline payload signature verification failed");
}

function provenanceClosure(artifactIds: string[]) {
  const graph = listProvenance();
  const ids = new Set(artifactIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (ids.has(edge.from) || ids.has(edge.to)) {
        if (!ids.has(edge.from)) { ids.add(edge.from); changed = true; }
        if (!ids.has(edge.to)) { ids.add(edge.to); changed = true; }
      }
    }
    if (ids.size > MAX_NODES) throw new Error("offline provenance closure exceeds the node limit");
  }
  const nodes = graph.nodes.filter(node => ids.has(node.id));
  for (const artifactId of artifactIds) {
    if (!nodes.some(node => node.id === artifactId)) {
      const artifact = getArtifact(artifactId);
      if (!artifact) throw new Error(`offline artifact not found: ${artifactId}`);
      nodes.push({id: artifact.id, kind: "EVIDENCE", label: `Offline evidence ${artifact.kind}`, createdAt: artifact.producedAt});
    }
  }
  const edges = graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const nodeIds = new Set(nodes.map(node => node.id));
  if (edges.some(edge => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) throw new Error("offline export encountered an incomplete provenance graph");
  if (nodes.length > MAX_NODES || edges.length > MAX_EDGES) throw new Error("offline provenance closure exceeds bundle limits");
  return {nodes, edges};
}

export function createOfflineEvidenceBundle(artifactIds: string[]): OfflineEvidenceBundle {
  localSigningKey();
  localNodeId();
  if (!Array.isArray(artifactIds) || artifactIds.length === 0 || artifactIds.length > MAX_ARTIFACTS) {
    throw new Error(`offline export requires 1-${MAX_ARTIFACTS} artifact ids`);
  }
  if (artifactIds.some(id => typeof id !== "string") || new Set(artifactIds).size !== artifactIds.length) throw new Error("offline artifact ids must be unique strings");
  const artifacts = artifactIds.map(id => {
    const artifact = getArtifact(id);
    if (!artifact) throw new Error(`offline artifact not found: ${id}`);
    return artifact;
  });
  const provenance = provenanceClosure(artifactIds);
  const body: UnsignedBundle = {
    schema: SCHEMA,
    bundleId: `OB-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    originNodeId: localNodeId(),
    artifacts,
    provenance,
    payloadDigest: digest({artifacts, provenance})
  };
  const bundle: OfflineEvidenceBundle = {...body, signature: signatureFor(body)};
  if (Buffer.byteLength(canonical(bundle), "utf8") > MAX_BUNDLE_BYTES) throw new Error("offline evidence bundle exceeds the size limit");
  observe({
    type: "offline.bundle.created",
    message: `Offline-Evidenzpaket ${bundle.bundleId} erstellt`,
    status: "COMPLETED",
    actor: "CREATOR",
    action: "offline.bundle.create",
    resource: bundle.bundleId,
    argumentsValue: {originNodeId: bundle.originNodeId, artifactCount: artifacts.length, payloadDigest: bundle.payloadDigest}
  });
  return structuredClone(bundle);
}

function validateBundle(input: unknown): OfflineEvidenceBundle {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("offline evidence bundle must be an object");
  const bundle = input as OfflineEvidenceBundle;
  if (Buffer.byteLength(canonical(bundle), "utf8") > MAX_BUNDLE_BYTES) throw new Error("offline evidence bundle exceeds the size limit");
  if (bundle.schema !== SCHEMA || typeof bundle.bundleId !== "string" || !/^OB-[a-f0-9-]{36}$/.test(bundle.bundleId)) throw new Error("unsupported or invalid offline bundle identity");
  if (typeof bundle.createdAt !== "string" || !Number.isFinite(Date.parse(bundle.createdAt)) || Date.parse(bundle.createdAt) > Date.now() + 5 * 60_000) throw new Error("offline bundle timestamp is invalid");
  if (typeof bundle.originNodeId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(bundle.originNodeId)) throw new Error("offline bundle origin is invalid");
  if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length === 0 || bundle.artifacts.length > MAX_ARTIFACTS) throw new Error("offline bundle artifact list is invalid");
  if (!bundle.provenance || !Array.isArray(bundle.provenance.nodes) || !Array.isArray(bundle.provenance.edges) || bundle.provenance.nodes.length > MAX_NODES || bundle.provenance.edges.length > MAX_EDGES) {
    throw new Error("offline bundle provenance is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(bundle.payloadDigest) || !/^[a-f0-9]{64}$/.test(bundle.signature)) throw new Error("offline bundle digest or signature is invalid");

  const {signature, ...body} = bundle;
  if (digest({artifacts: bundle.artifacts, provenance: bundle.provenance}) !== bundle.payloadDigest) throw new Error("offline bundle payload digest mismatch");
  const expected = Buffer.from(signatureFor(body, peerSigningKey(bundle.originNodeId)), "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error("offline bundle signature verification failed");

  const artifactIds = new Set<string>();
  for (const artifact of bundle.artifacts) {
    if (artifactIds.has(artifact.id)) throw new Error(`duplicate artifact id in offline bundle: ${artifact.id}`);
    artifactIds.add(artifact.id);
  }
  const nodeIds = new Set<string>();
  for (const node of bundle.provenance.nodes) {
    if (!node || typeof node.id !== "string" || typeof node.label !== "string" || node.label.length > 512 || !PROVENANCE_KINDS.includes(node.kind) || typeof node.createdAt !== "string" || !Number.isFinite(Date.parse(node.createdAt)) || (node.runId !== undefined && typeof node.runId !== "string")) throw new Error("offline provenance node is invalid");
    assertRealIdentifier(node.id);
    if (nodeIds.has(node.id)) throw new Error(`duplicate provenance node in offline bundle: ${node.id}`);
    nodeIds.add(node.id);
  }
  for (const artifactId of artifactIds) if (!nodeIds.has(artifactId)) throw new Error(`offline artifact lacks a provenance node: ${artifactId}`);
  const edgeKeys = new Set<string>();
  const edgeIds = new Set<string>();
  for (const edge of bundle.provenance.edges) {
    if (!edge || typeof edge.id !== "string" || !/^PE-[A-Za-z0-9-]{8,128}$/.test(edge.id) || typeof edge.from !== "string" || typeof edge.to !== "string" || !provenanceRelations.includes(edge.relation) || typeof edge.createdAt !== "string" || !Number.isFinite(Date.parse(edge.createdAt)) || (edge.note !== undefined && (typeof edge.note !== "string" || edge.note.length > 512))) throw new Error("offline provenance edge is invalid");
    assertRealIdentifier(edge.from);
    assertRealIdentifier(edge.to);
    if (edgeIds.has(edge.id)) throw new Error(`duplicate provenance edge id in offline bundle: ${edge.id}`);
    edgeIds.add(edge.id);
    if (edge.from === edge.to || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error("offline provenance edge has an invalid endpoint");
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.relation}`;
    if (edgeKeys.has(key)) throw new Error("offline bundle contains a duplicate provenance edge");
    edgeKeys.add(key);
  }
  assertAcyclicCausation(bundle.provenance.edges);
  return bundle;
}

function assertNoConflicts(bundle: OfflineEvidenceBundle) {
  const priorBundle = store.read().imports.find(record => record.bundleId === bundle.bundleId);
  if (priorBundle && (priorBundle.digest !== bundle.payloadDigest || priorBundle.originNodeId !== bundle.originNodeId)) throw new Error(`offline bundle id conflict: ${bundle.bundleId}`);
  const currentArtifacts = new Map(bundle.artifacts.map(artifact => [artifact.id, getArtifact(artifact.id)]));
  for (const artifact of bundle.artifacts) {
    const existing = currentArtifacts.get(artifact.id);
    if (existing && canonical(existing) !== canonical(artifact)) throw new Error(`offline artifact id conflict: ${artifact.id}`);
  }
  const current = listProvenance();
  const nodes = new Map(current.nodes.map(node => [node.id, node]));
  const newNodeCount = bundle.provenance.nodes.filter(node => !nodes.has(node.id)).length;
  if (current.nodes.length + newNodeCount > 5000) throw new Error("provenance node store is full; offline merge refused");
  const existingArtifactCount = artifactSnapshot().length;
  const newArtifactCount = bundle.artifacts.filter(artifact => !currentArtifacts.get(artifact.id)).length;
  if (existingArtifactCount + newArtifactCount > 2000) throw new Error("artifact store is full; offline merge refused to evict existing evidence");
  for (const node of bundle.provenance.nodes) {
    const existing = nodes.get(node.id);
    if (existing && (existing.kind !== node.kind || existing.label !== node.label || existing.runId !== node.runId || existing.createdAt !== node.createdAt)) {
      throw new Error(`offline provenance node conflict: ${node.id}`);
    }
  }
  let newEdgeCount = 0;
  for (const edge of bundle.provenance.edges) {
    const sameId = current.edges.find(value => value.id === edge.id);
    if (sameId && canonical(sameId) !== canonical(edge)) throw new Error(`offline provenance edge id conflict: ${edge.id}`);
    const existing = current.edges.find(value => value.from === edge.from && value.to === edge.to && value.relation === edge.relation);
    if (existing && canonical(existing) !== canonical(edge)) throw new Error(`offline provenance edge identity conflict: ${edge.from} -> ${edge.to}`);
    if (!existing) newEdgeCount += 1;
  }
  if (current.edges.length + newEdgeCount > 10000) throw new Error("provenance edge store is full; offline merge refused");
  assertAcyclicCausation([...current.edges, ...bundle.provenance.edges]);
}

export function importOfflineEvidenceBundle(input: unknown): {bundleId: string; importedArtifacts: number; duplicateArtifacts: number; mergedNodes: number; mergedEdges: number} {
  const bundle = validateBundle(input);
  assertNoConflicts(bundle);
  let importedArtifacts = 0;
  let duplicateArtifacts = 0;
  for (const artifact of bundle.artifacts) {
    if (importVerifiedArtifact(artifact) === "IMPORTED") importedArtifacts += 1;
    else duplicateArtifacts += 1;
  }
  let mergedNodes = 0;
  let mergedEdges = 0;
  for (const node of bundle.provenance.nodes) if (mergeProvenanceNode(node) === "IMPORTED") mergedNodes += 1;
  for (const edge of bundle.provenance.edges) if (mergeProvenanceEdge(edge) === "IMPORTED") mergedEdges += 1;
  const importedAt = new Date().toISOString();
  store.update(payload => {
    if (!payload.imports.some(record => record.bundleId === bundle.bundleId)) {
      payload.imports.push({bundleId: bundle.bundleId, digest: bundle.payloadDigest, originNodeId: bundle.originNodeId, importedAt, artifactIds: bundle.artifacts.map(artifact => artifact.id)});
      if (payload.imports.length > 500) payload.imports.splice(0, payload.imports.length - 500);
    }
  });
  observe({
    type: "offline.bundle.imported",
    message: `Offline-Evidenzpaket ${bundle.bundleId} synchronisiert`,
    status: "COMPLETED",
    actor: "CREATOR",
    action: "offline.bundle.import",
    resource: bundle.bundleId,
    argumentsValue: {originNodeId: bundle.originNodeId, artifactCount: bundle.artifacts.length, payloadDigest: bundle.payloadDigest}
  });
  return {
    bundleId: bundle.bundleId,
    importedArtifacts,
    duplicateArtifacts,
    mergedNodes,
    mergedEdges
  };
}

export function offlineSyncHistory() {
  return structuredClone(store.read().imports);
}

export function offlineFabricReport() {
  let peerCount = 0;
  try {
    const peers: unknown = JSON.parse(process.env.BOB_OFFLINE_PEER_KEYS ?? "{}");
    if (peers && typeof peers === "object" && !Array.isArray(peers)) peerCount = Object.keys(peers).length;
  } catch { /* report only; malformed peer config remains visible as zero */ }
  return {
    store: store.integrity(),
    imports: store.read().imports.length,
    localNodeId: process.env.BOB_OFFLINE_NODE_ID ?? null,
    signingConfigured: Buffer.byteLength(process.env.BOB_OFFLINE_SYNC_KEY ?? "", "utf8") >= 32,
    peerCount
  };
}
