import {describe, expect, it} from "vitest";
import {embedText, searchKnowledgeVector, vectorIndexReport} from "../../lib/knowledge-vector";
import type {KnowledgeNode} from "../../lib/knowledge";

const node = (id: string, subject: string, object: string): KnowledgeNode => ({
  knowledgeId:id,
  layer:"SEMANTIC",
  subject,
  predicate:"supports",
  object,
  state:"SUPPORTED",
  confidence:"EVIDENCE_BASED",
  sourceIds:["SRC-1"],
  evidenceIds:["E-1"],
  createdAt:"2026-01-01T00:00:00.000Z",
  updatedAt:"2026-01-01T00:00:00.000Z"
});

describe("knowledge vector index", () => {
  it("creates normalized deterministic offline vectors", () => {
    const a = embedText("Sandbox Isolation Network");
    const b = embedText("Sandbox Isolation Network");
    expect(a).toEqual(b);
    expect(Math.sqrt(a.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 8);
  });

  it("ranks matching vocabulary above unrelated knowledge", () => {
    const nodes = [
      node("KN-A", "Sandbox Isolation", "Network denied"),
      node("KN-B", "Backup", "Database retention")
    ];
    const results = searchKnowledgeVector(nodes, "sandbox network isolation", 10);
    expect(results[0]?.knowledgeId).toBe("KN-A");
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it("has an explicit bounded vector index report", () => {
    const report = vectorIndexReport();
    expect(report.dimensions).toBe(256);
    expect(report.indexed).toBeGreaterThanOrEqual(0);
  });
});
