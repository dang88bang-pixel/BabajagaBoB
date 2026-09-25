import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import type {KnowledgeNode} from "./knowledge";

const DIMENSIONS = 256;
const store = createStore<Record<string, {knowledgeId:string; vector:number[]; textDigest:string}>>(
  "knowledge-vector",
  1,
  () => ({})
);

function tokens(text: string): string[] {
  return text
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(t => t.length >= 2)
    .slice(0, 512);
}

function hashIndex(token: string): number {
  const digest = crypto.createHash("sha256").update(token).digest();
  return digest.readUInt32BE(0) % DIMENSIONS;
}

/**
 * Lokaler, deterministischer Embedding-Fallback.
 *
 * Der Vektor ist absichtlich kein Wahrheits- oder Wissensspeicher: Er dient
 * ausschließlich der Kandidatensuche. Das Knowledge Graph bleibt die Quelle
 * der Wahrheit. Die Funktion benötigt weder Netzwerk noch externen Provider.
 */
export function embedText(text: string): number[] {
  const vector = Array<number>(DIMENSIONS).fill(0);
  const ts = tokens(text);
  if (ts.length === 0) return vector;
  for (const token of ts) {
    vector[hashIndex(token)] += 1 / Math.sqrt(ts.length);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map(value => value / norm) : vector;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== DIMENSIONS || b.length !== DIMENSIONS) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < DIMENSIONS; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : 0;
}

function nodeText(node: KnowledgeNode): string {
  return [node.subject, node.predicate, node.object, node.layer, node.state, node.conditions ?? "", node.verification ?? ""].join(" ");
}

export function indexKnowledgeNode(node: KnowledgeNode): void {
  const text = nodeText(node);
  const vector = embedText(text);
  const textDigest = crypto.createHash("sha256").update(text).digest("hex");
  store.update(index => {
    index[node.knowledgeId] = {knowledgeId: node.knowledgeId, vector, textDigest};
  });
}

export function removeKnowledgeNode(knowledgeId: string): void {
  store.update(index => {
    delete index[knowledgeId];
  });
}

export function rebuildKnowledgeVectorIndex(nodes: KnowledgeNode[]): {indexed: number} {
  return store.update(index => {
    const next: Record<string, {knowledgeId:string; vector:number[]; textDigest:string}> = {};
    for (const node of nodes) {
      const text = nodeText(node);
      next[node.knowledgeId] = {
        knowledgeId: node.knowledgeId,
        vector: embedText(text),
        textDigest: crypto.createHash("sha256").update(text).digest("hex")
      };
    }
    for (const [id, value] of Object.entries(next)) index[id] = value;
    for (const id of Object.keys(index)) if (!next[id]) delete index[id];
    return {indexed: nodes.length};
  });
}

export function searchKnowledgeVector(nodes: KnowledgeNode[], query: string, limit = 20): Array<{knowledgeId:string; score:number}> {
  const safeLimit = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 20));
  const index = store.read();
  const q = embedText(query);
  const results = nodes
    .map(node => {
      const entry = index[node.knowledgeId];
      if (!entry) {
        indexKnowledgeNode(node);
        return {knowledgeId: node.knowledgeId, score: cosine(q, embedText(nodeText(node)))};
      }
      return {knowledgeId: node.knowledgeId, score: cosine(q, entry.vector)};
    })
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.knowledgeId.localeCompare(b.knowledgeId))
    .slice(0, safeLimit);
  return results;
}

export function vectorIndexReport() {
  const report = store.integrity();
  return {dimensions: DIMENSIONS, indexed: Object.keys(store.read()).length, ...report};
}
