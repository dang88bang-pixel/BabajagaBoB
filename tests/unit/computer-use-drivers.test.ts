import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Computer-Use-Treiber (MASTER §24 / CU-001, Phase 4 / 7.2):
 * Treiber melden Verfügbarkeit ehrlich, Aktionen laufen nur über den
 * autorisierten Systempfad, nicht autorisierte Instanzen bleiben gesperrt.
 */

isolatedStorageRoot("cu-drivers-unit");

let drivers: typeof import("../../lib/computer-use-drivers");
let cu: typeof import("../../lib/computer-use");
let bootstrap: typeof import("../../lib/bootstrap");
let audit: typeof import("../../lib/audit");

beforeAll(async () => {
  vi.resetModules();
  drivers = await import("../../lib/computer-use-drivers");
  cu = await import("../../lib/computer-use");
  bootstrap = await import("../../lib/bootstrap");
  audit = await import("../../lib/audit");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

function makeCliInstance(taskId: string) {
  const instance = cu.registerComputer({
    name: "CLI-Testinstanz",
    kind: "CLI",
    os: "linux",
    arch: "x64",
    network: "DENY",
    capabilities: [{kind: "CLI", actions: ["PROCESS_READ", "FILE_READ", "TERMINAL_EXECUTE"], environments: ["test"], network: "DENY", risk: "LOW"}],
    authorized: true // wird verworfen: Discovery ist keine Autorisierung
  });
  expect(instance.authorized).toBe(false);
  cu.authorizeComputer(instance.id, true);
  return cu.allocateComputer(instance.id, taskId, "SB-CU-UNIT");
}

describe("Treiber-Verfügbarkeit", () => {
  it("meldet je Treiber ehrlich verfügbar oder UNAVAILABLE mit Grund", () => {
    const matrix = drivers.cuDriverAvailabilityMatrix();
    expect(matrix.map(entry => entry.kind).sort()).toEqual(["BROWSER", "CLI", "DESKTOP"]);
    for (const entry of matrix) {
      if (!entry.available) expect(entry.reason).toBeTruthy();
    }
    expect(matrix.find(entry => entry.kind === "CLI")?.available).toBe(true);
  });

  it("Browser-Treiber verweigert fremde Protokolle", () => {
    const availability = drivers.browserDriver.availability();
    if (!availability.available) return; // ohne Chromium ehrlich nicht verfügbar
    expect(() => drivers.browserDriver.buildAction("NAVIGATE", {url: "ftp://example.com"})).toThrow(/protocol/);
  });

  it("CLI-Treiber baut Shell-freie argv für Prozess-Lesezugriff", () => {
    const argv = drivers.cliDriver.buildAction("PROCESS_READ", {});
    expect(argv[0]).toBe(process.execPath);
    expect(argv.join(" ")).not.toMatch(/[;&|`$><]/);
  });

  it("FILE_READ verweigert unsichere Pfade", () => {
    expect(() => drivers.cliDriver.buildAction("FILE_READ", {path: "../../etc/passwd"})).toThrow(/safe/);
    expect(() => drivers.cliDriver.buildAction("FILE_READ", {path: "/tmp/ok.txt"})).not.toThrow();
  });

  it("TERMINAL_EXECUTE verlangt ein nicht-leeres argv", () => {
    expect(() => drivers.cliDriver.buildAction("TERMINAL_EXECUTE", {argv: []})).toThrow(/argv/);
    expect(drivers.cliDriver.buildAction("TERMINAL_EXECUTE", {argv: ["node", "--version"]})).toEqual(["node", "--version"]);
  });
});

describe("Ausführungsgrenzen", () => {
  it("nicht autorisierte Instanzen können nichts ausführen", async () => {
    const instance = cu.registerComputer({
      name: "Unautorisiert",
      kind: "CLI",
      os: "linux",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "CLI", actions: ["PROCESS_READ"], environments: ["test"], network: "DENY", risk: "LOW"}],
      authorized: false
    });
    await expect(drivers.executeCuAction({instanceId: instance.id, action: "PROCESS_READ", sandboxId: "SB-X", requestedBy: "CREATOR"})).rejects.toThrow(/not authorized/);
  });

  it("nicht allokierte Instanzen können nichts ausführen", async () => {
    const instance = cu.registerComputer({
      name: "Nicht-Allokiert",
      kind: "CLI",
      os: "linux",
      arch: "x64",
      network: "DENY",
      capabilities: [{kind: "CLI", actions: ["PROCESS_READ"], environments: ["test"], network: "DENY", risk: "LOW"}],
      authorized: false
    });
    cu.authorizeComputer(instance.id, true);
    await expect(drivers.executeCuAction({instanceId: instance.id, action: "PROCESS_READ", sandboxId: "SB-X", requestedBy: "CREATOR"})).rejects.toThrow(/allocated/);
  });

  it("ein unavailable gemeldeter Treiber verweigert fail closed und auditiert DENY", async () => {
    const instance = makeCliInstance("TASK-CU-1");
    const blockedDriver = {
      driverId: "cli-blocked",
      kind: "CLI" as const,
      supports: ["PROCESS_READ" as const],
      availability: () => ({driverId: "cli-blocked", kind: "CLI" as const, available: false, reason: "Werkzeug fehlt (Test)"}),
      buildAction: () => ["node", "--version"]
    };
    await expect(
      drivers.executeCuAction({instanceId: instance.id, action: "PROCESS_READ", sandboxId: "SB-CU-UNIT", requestedBy: "CREATOR"}, [blockedDriver])
    ).rejects.toThrow(/Werkzeug fehlt/);
    const denies = audit.auditSnapshot().filter(record => record.action === "computer-use:action" && record.decision === "DENY");
    expect(denies.length).toBeGreaterThan(0);
  });

  it("unbekannte Instanz wird verweigert", async () => {
    await expect(drivers.executeCuAction({instanceId: "CMP-UNBEKANNT", action: "PROCESS_READ", sandboxId: "SB-X", requestedBy: "CREATOR"})).rejects.toThrow(/not found/);
  });
});
