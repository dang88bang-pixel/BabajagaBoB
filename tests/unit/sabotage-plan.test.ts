import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

/**
 * Sabotagekatalog (Abschnitt 37 / TEST-004).
 *
 * Der Katalog ist eine Nachweiskette: Wenn ein Anker nicht mehr passt (Regel
 * umbenannt, Funktion verschoben), mutiert `scripts/sabotage.mjs` nichts mehr —
 * der Lauf wäre grün und würde nichts beweisen. Diese Suite verhindert genau
 * das: Jeder Anker muss genau einmal vorkommen, jede genannte Testdatei muss
 * existieren, und die Prüfer müssen wirklich in der CI hängen.
 */

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, "docs", "acceptance", "sabotage-probes.json");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "ci.yml");

type Edit = {file: string; find: string; replace: string};
type Probe = {
  id: string;
  title: string;
  guard: string;
  file?: string;
  find?: string;
  replace?: string;
  edits?: Edit[];
  tests?: string[];
};

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8")) as {probes: Probe[]};

const editsOf = (probe: Probe): Edit[] =>
  probe.edits ?? (probe.file && probe.find !== undefined && probe.replace !== undefined ? [{file: probe.file, find: probe.find, replace: probe.replace}] : []);

describe("Sabotagekatalog", () => {
  it("enthält mindestens acht Proben mit eindeutigen IDs", () => {
    expect(catalog.probes.length).toBeGreaterThanOrEqual(8);
    const ids = catalog.probes.map(probe => probe.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("nennt zu jeder Probe eine überprüfbare Schutzaussage", () => {
    for (const probe of catalog.probes) {
      expect(probe.title?.length ?? 0).toBeGreaterThan(5);
      expect(probe.guard?.trim().length ?? 0, `${probe.id}: Schutzaussage fehlt`).toBeGreaterThan(10);
      expect(editsOf(probe).length, `${probe.id}: keine Änderung definiert`).toBeGreaterThan(0);
      expect((probe.tests ?? []).length, `${probe.id}: keine Testdatei genannt`).toBeGreaterThan(0);
    }
  });

  for (const probe of catalog.probes) {
    it(`Probe ${probe.id}: Anker genau einmal, Testdateien vorhanden`, () => {
      for (const edit of editsOf(probe)) {
        const target = path.join(ROOT, edit.file);
        expect(fs.existsSync(target), `${probe.id}: Datei fehlt ${edit.file}`).toBe(true);
        const source = fs.readFileSync(target, "utf8");
        const occurrences = source.split(edit.find).length - 1;
        expect(occurrences, `${probe.id}: Anker kommt ${occurrences}× in ${edit.file} vor`).toBe(1);
        expect(edit.replace).not.toBe(edit.find);
      }
      for (const test of probe.tests ?? []) {
        expect(fs.existsSync(path.join(ROOT, test)), `${probe.id}: Testdatei fehlt ${test}`).toBe(true);
      }
    });
  }

  it("prüft jede Sicherheitszusicherung, die die Matrix als Testgegenstand nennt", () => {
    // Die Proben müssen die tragenden Grenzen abdecken — Egress, Audit, Replay,
    // Freigabe, Kill-Switch, Enrollment, Persistenz-Integrität, Auslieferung.
    const ids = catalog.probes.map(probe => probe.id).join(" ");
    for (const expected of ["ALLOWLIST", "AUDIT", "TOKEN_REPLAY", "APPROVAL", "KILL_SWITCH", "ENROLLMENT", "DIGEST", "STAGING"]) {
      expect(ids, `keine Probe für ${expected}`).toContain(expected);
    }
  });

  it("verdrahtet beide Prüfer in der CI (sonst laufen sie nie)", () => {
    const workflow = fs.readFileSync(WORKFLOW, "utf8");
    expect(workflow).toContain("scripts/sabotage.mjs");
    expect(workflow).toContain("scripts/fault-injection.mjs");
    // Beide sind Pflichtstufen der Verifikation, nicht optionale Zusätze.
    expect(workflow).toContain("name: Sabotageproben (TEST-004)");
    expect(/needs: \[[^\]]*sabotage[^\]]*build[^\]]*\]/.test(workflow)).toBe(true);
  });

  it("meldet einen Katalog mit ungültigem Anker als Fehlschlag (echter Prüferlauf)", () => {
    // `--check` mutiert nichts und muss bei gültigem Katalog mit 0 enden.
    const output = execFileSync(process.execPath, [path.join(ROOT, "scripts", "sabotage.mjs"), "--check"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000
    });
    expect(output).toContain("Anker gültig");
    expect(output).toContain(`${catalog.probes.length}/${catalog.probes.length} Anker gültig`);
  });
});
