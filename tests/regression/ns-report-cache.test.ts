import fs from "node:fs";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

/**
 * Isolationsbericht darf nicht veralten.
 *
 * Gefundener Fehler: `isolationReport()` gab einen zwischengespeicherten Bericht
 * zurück, auch nachdem der Rootfs inzwischen gebaut war. Die Plattform meldete
 * dann dauerhaft `FILESYSTEM_ONLY` (und verweigerte jede Ausführung mit 409),
 * obwohl die Kernel-Isolation verfügbar war — erst ein Neustart half. Der
 * Bericht muss die Voraussetzungen daher bei jeder Abfrage erneut bewerten.
 */

const root = isolatedStorageRoot("ns-report-cache");
const rootfs = path.join(root, "rootfs");

let ns: typeof import("../../lib/ns-isolation");

beforeEach(async () => {
  vi.resetModules();
  delete process.env.BOB_NS_PROBE_FORCE_UNAVAILABLE;
  process.env.BOB_NS_ISOLATION = "on";
  process.env.BOB_NS_ROOTFS = rootfs;
  fs.rmSync(rootfs, {recursive: true, force: true});
  ns = await import("../../lib/ns-isolation");
});

afterEach(() => {
  fs.rmSync(rootfs, {recursive: true, force: true});
  delete process.env.BOB_NS_ROOTFS;
});

function buildRootfs() {
  fs.mkdirSync(path.join(rootfs, "bin"), {recursive: true});
  fs.writeFileSync(path.join(rootfs, "bin", "busybox"), "#!/bin/sh\n", {mode: 0o755});
}

describe("Isolationsbericht", () => {
  it("meldet ohne Rootfs den fehlenden Rootfs als Grund", () => {
    const report = ns.isolationReport();
    expect(report.level).toBe("FILESYSTEM_ONLY");
    expect(report.reason).toContain("Rootfs fehlt oder ist unvollständig");
  });

  it("erkennt einen später gebauten Rootfs ohne Neustart", () => {
    const before = ns.isolationReport();
    expect(before.reason).toContain("Rootfs fehlt oder ist unvollständig");

    buildRootfs();
    const after = ns.isolationReport();
    // Der Rootfs ist keine Voraussetzung mehr: der Bericht darf ihn nicht mehr
    // als Grund nennen (die tatsächliche Stufe hängt von der Umgebung ab).
    expect(after.reason ?? "").not.toContain("Rootfs fehlt");
    expect(after.rootfs).toBe(rootfs);
  });

  it("fällt wieder auf FILESYSTEM_ONLY zurück, wenn der Rootfs verschwindet", () => {
    buildRootfs();
    ns.isolationReport();
    fs.rmSync(rootfs, {recursive: true, force: true});
    const report = ns.isolationReport();
    expect(report.level).toBe("FILESYSTEM_ONLY");
    expect(report.reason).toContain("Rootfs fehlt oder ist unvollständig");
  });

  it("prüft den Rootfs bei jeder Abfrage erneut (kein Blind-Cache)", () => {
    buildRootfs();
    ns.isolationReport();
    fs.rmSync(rootfs, {recursive: true, force: true});
    const removal = ns.isolationReport();
    expect(removal.reason).toContain("Rootfs");
    buildRootfs();
    const rebuilt = ns.isolationReport();
    expect(rebuilt.reason ?? "").not.toContain("Rootfs fehlt");
  });
});
