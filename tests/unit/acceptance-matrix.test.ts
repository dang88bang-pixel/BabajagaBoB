import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

/**
 * Abnahme-Matrix (Phase 0 des Abnahmeplans, `docs/ABNAHMEPLAN.md`).
 *
 * Die Matrix ist der eingefrorene Acceptance Contract. Dieser Test belegt, dass
 * sie **prüfbar** bleibt und dass der Prüfer selbst nicht stillschweigend
 * durchgeht:
 *
 *  1. Die Matrix ist strukturell vollständig (IDs, Phasen, Statuswerte, Kette).
 *  2. Jede Anforderung mit `PASS` nennt Implementierung, Test und Nachweis.
 *  3. Der Prüfer `scripts/acceptance.mjs` läuft statisch **ohne Verstoß** durch.
 *  4. Der Prüfer erkennt einen **absichtlich gebrochenen** Nachweis (Negativprobe)
 *     — sonst wäre er wertlos.
 */

const MATRIX = "docs/acceptance/requirements.json";

type Requirement = {
  id: string;
  area: string;
  phase: string;
  requirement: string;
  implementation: string[];
  tests: {file: string; min: number}[];
  ui: string[];
  evidence: {kind: string; path?: string; script?: string}[];
  docs: string[];
  status: string;
  note: string;
};

type Matrix = {
  schema: string;
  frozenAt: string;
  statusValues: string[];
  rule: string;
  chain: string[];
  requiredDocs: string[];
  requirements: Requirement[];
};

const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as Matrix;

function runAcceptance(mutator?: (copy: Matrix) => void): {status: number; stdout: string} {
  const args = ["scripts/acceptance.mjs"];
  let dir: string | null = null;
  if (mutator) {
    // Negativprobe: nur die **Matrix** wird verändert, der Prüfer bleibt der echte.
    dir = mkdtempSync(path.join(os.tmpdir(), "bob-acceptance-"));
    const copy = structuredClone(matrix);
    mutator(copy);
    const file = path.join(dir, "requirements.json");
    writeFileSync(file, JSON.stringify(copy, null, 1));
    args.push(`--matrix=${file}`);
  }
  try {
    const stdout = execFileSync("node", args, {encoding: "utf8"});
    return {status: 0, stdout};
  } catch (error) {
    const failure = error as {status?: number; stdout?: string};
    return {status: failure.status ?? 1, stdout: failure.stdout ?? ""};
  } finally {
    if (dir) rmSync(dir, {recursive: true, force: true});
  }
}

describe("Abnahme-Matrix", () => {
  it("ist strukturell vollständig und deckt alle 18 Stufen der Zielkette ab", () => {
    expect(matrix.schema).toBe("bob-acceptance/1");
    expect(matrix.requirements.length).toBeGreaterThanOrEqual(80);
    expect(matrix.chain.length).toBe(18);
    const ids = matrix.requirements.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of matrix.requirements) {
      expect(matrix.statusValues, `${entry.id}: unbekannter Status`).toContain(entry.status);
      expect(entry.phase, `${entry.id}: Phase fehlt`).toMatch(/^P[0-5]$/);
      if (entry.status !== "PASS") {
        expect(entry.note.length, `${entry.id}: Nicht-PASS ohne Begründung`).toBeGreaterThan(20);
      }
    }
    // Jede Stufe der Zielkette hat genau eine Anforderung im Bereich „Zielkette".
    const stages = matrix.requirements.filter(entry => entry.area === "Zielkette").map(entry => entry.requirement.split(":")[0]);
    for (const stage of matrix.chain) expect(stages, `Stufe ${stage} fehlt in der Matrix`).toContain(stage);
  });

  it("verlangt für PASS Implementierung, Test und Nachweis", () => {
    const passing = matrix.requirements.filter(entry => entry.status === "PASS");
    expect(passing.length).toBeGreaterThan(50);
    const unproven = passing
      .filter(entry => entry.implementation.length === 0 || entry.tests.length === 0 || entry.evidence.length === 0)
      .map(entry => entry.id);
    expect(unproven, "PASS-Anforderungen ohne vollständigen Nachweis").toEqual([]);
  });

  it("läuft ohne Verstoß durch den Prüfer", () => {
    const result = runAcceptance();
    expect(result.stdout, result.stdout.split("\n").slice(-8).join("\n")).toContain("0 fehlgeschlagen");
    expect(result.status).toBe(0);
  });

  it("erkennt einen absichtlich gebrochenen Nachweis (der Prüfer ist nicht wertlos)", () => {
    // Ein PASS-Eintrag verliert seinen Nachweis → der Prüfer muss fehlschlagen.
    const result = runAcceptance(copy => {
      const target = copy.requirements.find(entry => entry.status === "PASS" && entry.evidence.length > 0);
      if (target) target.evidence = [];
    });
    expect(result.status, "Prüfer hätte den fehlenden Nachweis erkennen müssen").not.toBe(0);
    expect(result.stdout).toContain("Jede PASS-Anforderung hat Implementierung, Test und Nachweis");
  });
});
