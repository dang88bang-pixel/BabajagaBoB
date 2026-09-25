import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import type {CausalRelation} from "./events/log";

/**
 * Provenance-Graph (Abschnitt 6).
 *
 * Kanten sind explizite Behauptungen mit definierter Richtung:
 *   CAUSED_BY, DERIVED_FROM, EXECUTED_IN, AUTHORIZED_BY, TESTED_BY,
 *   PRODUCED, OBSERVED, REPRODUCED_BY, CONTRADICTED_BY
 *
 * Knoten referenzieren echte Domänen-IDs (`runId`, `taskId`, `sandboxId`,
 * `capabilityId`, `artifactId`, `eventId`, `regressionId`, `knowledgeId`).
 * Zusammengesetzte Ersatz-IDs sind unzulässig: `addProvenanceNode` prüft die
 * ID-Form und lehnt synthetische Verkettungen mehrerer IDs ab.
 */

export type ProvenanceRelation = CausalRelation;

export const provenanceRelations: ProvenanceRelation[] = [
  "CAUSED_BY",
  "DERIVED_FROM",
  "EXECUTED_IN",
  "AUTHORIZED_BY",
  "TESTED_BY",
  "PRODUCED",
  "OBSERVED",
  "REPRODUCED_BY",
  "CONTRADICTED_BY"
];

export type ProvenanceNodeKind =
  | "EVENT"
  | "TASK"
  | "RUN"
  | "JOB"
  | "SANDBOX"
  | "CAPABILITY"
  | "ARTIFACT"
  | "EVIDENCE"
  | "EXPERIMENT"
  | "INCIDENT"
  | "RECOVERY"
  | "REGRESSION"
  | "KNOWLEDGE"
  | "DEVICE"
  | "PROVIDER"
  | "AGENT"
  | "WORKSHOP_ITEM"
  | "DEPLOYMENT"
  | "MISSION"
  | "OBJECTIVE";

export type ProvenanceNode = {id: string; kind: ProvenanceNodeKind; label: string; runId?: string; createdAt: string};
export type ProvenanceEdge = {
  id: string;
  from: string;
  to: string;
  relation: ProvenanceRelation;
  createdAt: string;
  note?: string;
};

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceError";
  }
}

type Payload = {nodes: ProvenanceNode[]; edges: ProvenanceEdge[]};
const store = createStore<Payload>("provenance", 1, () => ({nodes: [], edges: []}));

/**
 * Prüft, dass eine Provenance-ID eine echte Domänen-ID ist.
 * Verboten: zusammengesetzte Ersatz-IDs wie "run:TASK-1:SB-1".
 */
export function assertRealIdentifier(id: string) {
  if (typeof id !== "string" || id.length === 0 || id.length > 160) throw new ProvenanceError("provenance id must be a non-empty string");
  if (id.includes(":")) throw new ProvenanceError(`synthetic provenance id rejected: ${id}`);
}

export function addProvenanceNode(node: Omit<ProvenanceNode, "createdAt">): ProvenanceNode {
  assertRealIdentifier(node.id);
  return store.update(payload => {
    const existing = payload.nodes.find(n => n.id === node.id);
    if (existing) return;
    payload.nodes.push({...node, createdAt: new Date().toISOString()});
    if (payload.nodes.length > 5000) payload.nodes.splice(0, payload.nodes.length - 5000);
  }).nodes.find(n => n.id === node.id) as ProvenanceNode;
}

export function addProvenanceEdge(edge: Omit<ProvenanceEdge, "id" | "createdAt">): ProvenanceEdge {
  if (!provenanceRelations.includes(edge.relation)) throw new ProvenanceError(`unsupported provenance relation ${edge.relation}`);
  if (edge.from === edge.to) throw new ProvenanceError("provenance self reference rejected");
  assertRealIdentifier(edge.from);
  assertRealIdentifier(edge.to);
  return store.update(payload => {
    if (!payload.nodes.some(n => n.id === edge.from)) throw new ProvenanceError(`provenance endpoint missing: ${edge.from}`);
    if (!payload.nodes.some(n => n.id === edge.to)) throw new ProvenanceError(`provenance endpoint missing: ${edge.to}`);
    if (payload.edges.some(e => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) return;
    payload.edges.push({...edge, id: `PE-${crypto.randomUUID()}`, createdAt: new Date().toISOString()});
    if (payload.edges.length > 10000) payload.edges.splice(0, payload.edges.length - 10000);
  }).edges.find(e => e.from === edge.from && e.to === edge.to && e.relation === edge.relation) as ProvenanceEdge;
}

export function listProvenance(): {nodes: ProvenanceNode[]; edges: ProvenanceEdge[]} {
  return structuredClone(store.read());
}

export function provenanceFor(id: string): {nodes: ProvenanceNode[]; edges: ProvenanceEdge[]} {
  const {nodes, edges} = store.read();
  const relevantEdges = edges.filter(e => e.from === id || e.to === id);
  const ids = new Set<string>([id, ...relevantEdges.flatMap(e => [e.from, e.to])]);
  return {nodes: nodes.filter(n => ids.has(n.id)), edges: relevantEdges};
}

export type ProvenanceVerification = {valid: boolean; nodes: number; edges: number; issues: string[]};

/**
 * Integritätsprüfung (Abschnitt 6):
 *  - Store-Digest unverändert
 *  - alle Kanten referenzieren existierende Knoten
 *  - keine Selbstreferenzen, nur definierte Relationen
 *  - CAUSED_BY-Graph ist azyklisch (Kausalität darf nicht im Kreis laufen)
 */
export function verifyProvenance(): ProvenanceVerification {
  const issues: string[] = [];
  const report = store.integrity();
  if (!report.ok) issues.push(report.error ?? "store integrity failure");
  const {nodes, edges} = store.read();
  const ids = new Set(nodes.map(n => n.id));
  for (const edge of edges) {
    if (!ids.has(edge.from)) issues.push(`edge ${edge.id} references missing node ${edge.from}`);
    if (!ids.has(edge.to)) issues.push(`edge ${edge.id} references missing node ${edge.to}`);
    if (!provenanceRelations.includes(edge.relation)) issues.push(`edge ${edge.id} has unsupported relation ${edge.relation}`);
    if (edge.from === edge.to) issues.push(`edge ${edge.id} is a self reference`);
  }
  const causation = new Map<string, string[]>();
  for (const edge of edges.filter(e => e.relation === "CAUSED_BY")) {
    causation.set(edge.from, [...(causation.get(edge.from) ?? []), edge.to]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of causation.get(node) ?? []) if (cycle(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of causation.keys()) {
    if (cycle(node)) {
      issues.push(`causal cycle detected involving ${node}`);
      break;
    }
  }
  return {valid: issues.length === 0, nodes: nodes.length, edges: edges.length, issues};
}

export function provenanceStoreReport() {
  return store.integrity();
}
