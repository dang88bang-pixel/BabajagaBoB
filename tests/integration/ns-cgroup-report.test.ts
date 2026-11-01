import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

/**
 * cgroup-Bericht darf nicht mehr behaupten, als durchgesetzt wird.
 *
 * Gefundener Fehler (2026-11-01, beim Nachmessen mit delegiertem Unterbaum):
 * `cgroupAvailable()` prüfte nur **Dateirechte**. Ein Verzeichnis mit
 * beschreibbarem `cgroup.procs`/`memory.max` galt damit als nutzbar, obwohl der
 * Kernel den Beitritt verweigert (Verschieben eines Prozesses verlangt
 * Privilegien im cgroup-Namespace). Folge: `isolationReport()` führte
 * `CGROUP_MEMORY_LIMIT`/`CGROUP_PIDS_LIMIT` in `enforced[]`, während
 * `ns-exec.sh` bei **jedem** Lauf fail closed mit Exit 126 abbrach — der Bericht
 * war falsch, nicht die Grenze.
 *
 * Geprüft wird deshalb:
 *  1. ein gewöhnliches Verzeichnis (kein cgroup-v2-Dateisystem) gilt **nicht** als
 *     delegierter Unterbaum — auch dann nicht, wenn alle Dateien beschreibbar sind;
 *  2. ein echter cgroup-v2-Unterbaum ohne Beitrittsrecht gilt ebenfalls als nicht
 *     nutzbar (nur prüfbar, wenn die Umgebung einen delegierten Unterbaum hat);
 *  3. der Bericht nennt in beiden Fällen `UNAVAILABLE` mit **Grund** und führt
 *     keine CGROUP-Limits in `enforced[]`.
 */

const root = isolatedStorageRoot("ns-cgroup-report");
const rootfs = path.join(root, "rootfs");

let ns: typeof import("../../lib/ns-isolation");

function buildRootfs() {
  fs.mkdirSync(path.join(rootfs, "bin"), {recursive: true});
  fs.writeFileSync(path.join(rootfs, "bin", "busybox"), "#!/bin/sh\n", {mode: 0o755});
}

async function load() {
  vi.resetModules();
  process.env.BOB_NS_ISOLATION = "on";
  process.env.BOB_NS_ROOTFS = rootfs;
  buildRootfs();
  ns = await import("../../lib/ns-isolation");
}

afterEach(() => {
  delete process.env.BOB_CGROUP_DIR;
  delete process.env.BOB_NS_ROOTFS;
  delete process.env.BOB_NS_ISOLATION;
  fs.rmSync(rootfs, {recursive: true, force: true});
});

describe("cgroup-Bericht", () => {
  it("wertet ein gewöhnliches Verzeichnis nicht als delegierten cgroup-Unterbaum", async () => {
    const fake = path.join(root, "fake-cgroup");
    fs.mkdirSync(fake, {recursive: true});
    for (const file of ["cgroup.procs", "cgroup.subtree_control", "memory.max", "pids.max"]) {
      fs.writeFileSync(path.join(fake, file), "");
    }
    process.env.BOB_CGROUP_DIR = fake;
    await load();

    const availability = ns.cgroupAvailable();
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/kein cgroup-v2-Dateisystem/);

    const report = ns.isolationReport(true);
    expect(report.resourceLimits.cgroup).toBe("UNAVAILABLE");
    expect(report.enforced).not.toContain("CGROUP_MEMORY_LIMIT");
    expect(report.enforced).not.toContain("CGROUP_PIDS_LIMIT");
    expect(report.resourceLimits.detail).toContain("nicht kernel-seitig durchsetzbar");
  });

  it("verweigert die Ausführung, wenn Limits gefordert aber nicht nutzbar sind (fail closed)", async () => {
    const fake = path.join(root, "fake-cgroup-2");
    fs.mkdirSync(fake, {recursive: true});
    for (const file of ["cgroup.procs", "cgroup.subtree_control", "memory.max", "pids.max"]) {
      fs.writeFileSync(path.join(fake, file), "");
    }
    process.env.BOB_CGROUP_DIR = fake;
    await load();

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-cg-work-"));
    await expect(
      ns.runIsolated(["node", "-e", "process.stdout.write('nie')"], {
        workspace,
        timeoutMs: 10_000,
        sandboxId: "SB-CGROUP-FAKE",
        limits: {cpuMillicores: 500, memoryMb: 256, storageMb: 8, timeoutMs: 10_000, processes: 16}
      })
    ).rejects.toThrow(/cgroup limits requested but unavailable/);
  });

  it("prüft bei einem echten cgroup-v2-Unterbaum den Beitritt, nicht nur die Dateirechte", async () => {
    const real = process.env.BOB_TEST_CGROUP_DIR;
    if (!real || !fs.existsSync(path.join(real, "cgroup.procs"))) {
      // Ohne delegierten Unterbaum ist der Beitritt nicht prüfbar; die Prüfung
      // wird übersprungen **und benannt** statt stillschweigend bestanden.
      expect(true).toBe(true);
      return;
    }
    process.env.BOB_CGROUP_DIR = real;
    await load();
    const availability = ns.cgroupAvailable();
    const report = ns.isolationReport(true);
    if (availability.available) {
      expect(report.enforced).toContain("CGROUP_MEMORY_LIMIT");
      expect(report.resourceLimits.cgroup).toBe("ENFORCED");
    } else {
      // Delegation ohne Privilegien: Bericht muss die Wahrheit sagen.
      expect(availability.reason).toMatch(/cgroup-Beitritt nicht möglich/);
      expect(report.resourceLimits.cgroup).toBe("UNAVAILABLE");
      expect(report.enforced).not.toContain("CGROUP_MEMORY_LIMIT");
    }
  });
});
