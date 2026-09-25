import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import type {KnowledgeState} from "./types";

/**
 * Knowledge Graph (Abschnitt 19/20).
 *
 * Vier getrennte Gedächtnisebenen:
 *   WORKING   – aktueller Task
 *   EPISODIC  – was konkret passiert ist
 *   SEMANTIC  – verallgemeinerte Erkenntnisse
 *   NEGATIVE  – bekannte Fehlversuche und Grenzen ("Was funktioniert nicht?")
 *
 * Wissen stützt sich ausschließlich auf überprüfbare Quellen/Evidenz
 * (`sourceIds`, `evidenceIds`). Widersprüche werden als Kanten geführt, und
 * `confidence` ist bewusst keine "magische Zahl", sondern eine Evidenzklasse.
 */

export type MemoryLayer = "WORKING" | "EPISODIC" | "SEMANTIC" | "NEGATIVE";

export type KnowledgeRelation = "SUPPORTS" | "CONTRADICTS" | "DERIVED_FROM" | "REPRODUCED_BY" | "DEPENDS_ON" | "OBSERVED_IN";

export type EvidenceClass = "EVIDENCE_BASED" | "SINGLE_SOURCE" | "UNVERIFIED";

export type KnowledgeNode = {
  knowledgeId: string;
  layer: MemoryLayer;
  subject: string;
  predicate: string;
  object: string;
  state: KnowledgeState;
  confidence: EvidenceClass;
  sourceIds: string[];
  evidenceIds: string[];
  conditions?: string;
  verification?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEdge = {
  edgeId: string;
  from: string;
  to: string;
  relation: KnowledgeRelation;
  createdAt: string;
};

type Payload = {nodes: KnowledgeNode[]; edges: KnowledgeEdge[]};
const store = createStore<Payload>("knowledge", 1, () => ({nodes: [], edges: []}));

function classify(sourceIds: string[], evidenceIds: string[]): EvidenceClass {
  if (evidenceIds.length > 0) return "EVIDENCE_BASED";
  if (sourceIds.length > 0) return "SINGLE_SOURCE";
  return "UNVERIFIED";
}

export function upsertKnowledge(x: {
  layer: MemoryLayer;
  subject: string;
  predicate: string;
  object: string;
  state: KnowledgeState;
  sourceIds?: string[];
  evidenceIds?: string[];
  conditions?: string;
  verification?: string;
}): KnowledgeNode {
  if (x.state === "ESTABLISHED" && (x.evidenceIds ?? []).length === 0) throw new Error("ESTABLISHED knowledge requires evidenceIds");
  if (x.state === "ESTABLISHED" && !x.verification?.trim()) throw new Error("ESTABLISHED knowledge requires verification");
  const payload = store.read();
  const existing = payload.nodes.find(n => n.subject === x.subject && n.predicate === x.predicate && n.object === x.object);
  const now = new Date().toISOString();
  if (existing) {
    existing.state = x.state;
    existing.sourceIds = [...new Set([...existing.sourceIds, ...(x.sourceIds ?? [])])];
    existing.evidenceIds = [...new Set([...existing.evidenceIds, ...(x.evidenceIds ?? [])])];
    existing.confidence = classify(existing.sourceIds, existing.evidenceIds);
    existing.verification = x.verification ?? existing.verification;
    existing.updatedAt = now;
    store.write(payload);
    return structuredClone(existing);
  }
  const node: KnowledgeNode = {
    knowledgeId: `KN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    layer: x.layer,
    subject: x.subject,
    predicate: x.predicate,
    object: x.object,
    state: x.state,
    confidence: classify(x.sourceIds ?? [], x.evidenceIds ?? []),
    sourceIds: x.sourceIds ?? [],
    evidenceIds: x.evidenceIds ?? [],
    conditions: x.conditions,
    verification: x.verification,
    createdAt: now,
    updatedAt: now
  };
  payload.nodes.push(node);
  store.write(payload);
  observe({
    type: "knowledge.upserted",
    message: `Wissen ${node.knowledgeId} (${node.layer}) aktualisiert`,
    status: "COMPLETED",
    actor: "AG-SCIENTIST",
    agentId: "AG-SCIENTIST",
    action: "knowledge.upsert",
    resource: node.knowledgeId,
    argumentsValue: {layer: node.layer, state: node.state, predicate: node.predicate}
  });
  return structuredClone(node);
}

export function updateKnowledge(
  knowledgeId: string,
  patch: Partial<Pick<KnowledgeNode, "state" | "object" | "sourceIds" | "evidenceIds" | "conditions" | "verification">>
): KnowledgeNode {
  const payload = store.read();
  const node = payload.nodes.find(n => n.knowledgeId === knowledgeId);
  if (!node) throw new Error("knowledge node not found");
  if (patch.state === "ESTABLISHED" && (patch.evidenceIds ?? node.evidenceIds).length === 0) throw new Error("ESTABLISHED knowledge requires evidenceIds");
  if (patch.state === "ESTABLISHED" && !(patch.verification ?? node.verification)?.trim()) throw new Error("ESTABLISHED knowledge requires verification");
  Object.assign(node, patch);
  node.confidence = classify(node.sourceIds, node.evidenceIds);
  node.updatedAt = new Date().toISOString();
  store.write(payload);
  return structuredClone(node);
}

export function linkKnowledge(from: string, to: string, relation: KnowledgeRelation): KnowledgeEdge {
  const payload = store.read();
  if (!payload.nodes.some(n => n.knowledgeId === from)) throw new Error(`knowledge node not found: ${from}`);
  if (!payload.nodes.some(n => n.knowledgeId === to)) throw new Error(`knowledge node not found: ${to}`);
  const existing = payload.edges.find(e => e.from === from && e.to === to && e.relation === relation);
  if (existing) return structuredClone(existing);
  const edge: KnowledgeEdge = {edgeId: `KEDGE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, from, to, relation, createdAt: new Date().toISOString()};
  payload.edges.push(edge);
  store.write(payload);
  observe({
    type: "knowledge.linked",
    message: `Wissenskante ${relation} verknüpft`,
    status: "COMPLETED",
    actor: "AG-SCIENTIST",
    agentId: "AG-SCIENTIST",
    action: "knowledge.link",
    resource: edge.edgeId,
    argumentsValue: {from, to, relation}
  });
  return structuredClone(edge);
}

export function getKnowledge(knowledgeId: string): KnowledgeNode | null {
  return structuredClone(store.read().nodes.find(n => n.knowledgeId === knowledgeId) ?? null);
}

export function searchKnowledge(query: string): KnowledgeNode[] {
  const q = query.toLowerCase();
  return structuredClone(
    store.read().nodes.filter(n => [n.subject, n.predicate, n.object, n.state, n.layer, n.conditions ?? ""].some(value => value.toLowerCase().includes(q)))
  );
}

export function listKnowledge() {
  return structuredClone(store.read());
}

export function knowledgeByLayer(layer: MemoryLayer): KnowledgeNode[] {
  return structuredClone(store.read().nodes.filter(n => n.layer === layer));
}

export function negativeKnowledge(): KnowledgeNode[] {
  return knowledgeByLayer("NEGATIVE");
}

export function contradictions(): {from: string; to: string}[] {
  return store
    .read()
    .edges.filter(e => e.relation === "CONTRADICTS")
    .map(e => ({from: e.from, to: e.to}));
}

/** Wissen ohne überprüfbare Quelle ist explizit als UNKNOWN markiert. */
export function unverifiedKnowledge(): KnowledgeNode[] {
  return structuredClone(store.read().nodes.filter(n => n.confidence === "UNVERIFIED" && !["UNKNOWN", "UNVERIFIED", "HYPOTHESIS"].includes(n.state)));
}

export function knowledgeSummary() {
  const payload = store.read();
  return {
    total: payload.nodes.length,
    byLayer: payload.nodes.reduce<Record<string, number>>((acc, n) => ({...acc, [n.layer]: (acc[n.layer] ?? 0) + 1}), {}),
    byState: payload.nodes.reduce<Record<string, number>>((acc, n) => ({...acc, [n.state]: (acc[n.state] ?? 0) + 1}), {}),
    contradictions: payload.edges.filter(e => e.relation === "CONTRADICTS").length,
    negative: payload.nodes.filter(n => n.layer === "NEGATIVE").length
  };
}

export function knowledgeStoreReport() {
  return store.integrity();
}
