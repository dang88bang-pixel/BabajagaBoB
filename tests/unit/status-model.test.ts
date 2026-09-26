import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {
  isKnownStatus,
  isTerminalStatus,
  statusLabel,
  statusMeta,
  statusModelReport,
  statusOutcome,
  statusTone,
  STATUS_MODEL,
  STATUS_VALUES
} from "../../lib/status";

/**
 * Status-Modell (Abschnitt 5 / 34).
 *
 * Der Typ `Status` ist die Quelle, das Modell die Darstellung. Diese Tests
 * verbinden beide: Jeder deklarierte Zustand muss beschrieben sein, jede
 * Beschreibung muss eine Farbe haben, die die Oberfläche wirklich kennt, und
 * jeder neue Zustand muss von einem echten Produzenten erzeugt werden. Damit
 * fällt auf, wenn ein Zustand nur „im Modell“ existiert.
 */

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

describe("Status-Modell", () => {
  it("beschreibt jeden im Typ deklarierten Zustand", () => {
    const union = /export type Status =([\s\S]*?);/.exec(read("lib/types.ts"))?.[1] ?? "";
    const declared = [...union.matchAll(/"([A-Z_]+)"/g)].map(match => match[1]).sort();
    expect(declared.length).toBeGreaterThanOrEqual(20);
    expect(declared).toEqual([...STATUS_VALUES].sort());
    const report = statusModelReport();
    expect(report.incomplete).toEqual([]);
    expect(report.duplicateLabels).toEqual([]);
    expect(report.total).toBe(STATUS_VALUES.length);
    expect(Object.keys(STATUS_MODEL).length).toBe(STATUS_VALUES.length);
  });

  it("hat für jeden Zustand eine Farbe, die die Oberfläche kennt", () => {
    const css = read("app/globals.css");
    const missing = STATUS_VALUES.filter(status => !css.includes(`.badge.${statusTone(status)}`));
    expect(missing).toEqual([]);
  });

  it("behandelt unbekannte Werte als unbekannt, nicht als gesund", () => {
    expect(isKnownStatus("RUNNING")).toBe(true);
    expect(isKnownStatus("HEALTHY")).toBe(false);
    expect(isKnownStatus(undefined)).toBe(false);
    expect(statusMeta("HEALTHY").label).toBe("Unbekannt");
    expect(statusMeta("HEALTHY").outcome).toBe("OPEN");
    expect(statusLabel("SUCCEEDED")).toBe("Erfolgreich");
  });

  it("kennzeichnet nur echte Endzustände als terminal", () => {
    const terminal = STATUS_VALUES.filter(isTerminalStatus);
    expect(terminal.sort()).toEqual(["CANCELLED", "COMPLETED", "FAILED", "SUCCEEDED"]);
    expect(isTerminalStatus("RUNNING")).toBe(false);
    expect(isTerminalStatus("RECOVERING")).toBe(false);
    expect(statusOutcome("BUG")).toBe("FAILURE");
    expect(statusOutcome("CANCELLED")).toBe("ABORTED");
    expect(statusModelReport().groups.CLOSED.sort()).toEqual(["CANCELLED", "COMPLETED", "FAILED", "SUCCEEDED"]);
  });

  it("wird von echten Produzenten der neuen Zustände erzeugt", () => {
    // Ein Zustand, den niemand erzeugt, ist eine Behauptung ohne Funktion.
    expect(read("lib/science.ts")).toContain('record.status = "OBSERVING"');
    expect(read("lib/runs.ts")).toContain('next === "VERIFYING" ? "VALIDATING"');
    expect(read("lib/runs.ts")).toContain('next === "SUCCEEDED" ? "SUCCEEDED"');
    expect(read("lib/runs.ts")).toContain('next === "FAILED" || next === "DEAD_LETTER" ? "FAILED"');
    expect(read("lib/error-intelligence.ts")).toContain('status: "BUG"');
    expect(read("lib/error-intelligence.ts")).toContain("export function isSoftwareDefect");
  });
});
