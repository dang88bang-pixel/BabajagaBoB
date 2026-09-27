// TEMPORÄRE DIAGNOSEDATEI — zerlegt die Prüfung t13
// („führt einen begrenzten Scan aus, legt aber kein Gerät an und autorisiert
// nichts") in einzelne Behauptungen. Die CI-Matrix fährt jede als eigenen Job;
// der Jobstatus nennt dann die Zeile, weil die Protokolle nicht lesbar sind.
// Wird mit der Ursache entfernt.
import {beforeAll, describe, expect, it} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

const ENROLLMENT_SECRET = "enrollment-secret-0123456789abcdef";
const root = isolatedStorageRoot("diag-t13");
void root;

const BASE = "http://localhost:3000";
const DEVICE_ID = "DEV-ATTEST-1";

let devices: typeof import("../../lib/devices");
let scan: typeof import("../../lib/device-scan");
let route: typeof import("../../app/api/devices/route");
let audit: typeof import("../../lib/audit");
let cookie = "";

const identity = {
  id: DEVICE_ID,
  name: "Attestierungs-Host",
  os: "linux",
  arch: "x64",
  cpu: 4,
  ramMb: 8192,
  gpu: "none",
  network: "LAN",
  trust: "EPHEMERAL",
  capabilities: ["node"]
};

const post = (payload: Record<string, unknown>, authenticated = false) =>
  route.POST(
    new Request(`${BASE}/api/devices`, {
      method: "POST",
      headers: {"content-type": "application/json", ...(authenticated ? {cookie} : {})},
      body: JSON.stringify(payload)
    })
  );

/** Einmal gemessen, von allen Prüfungen geteilt — wie im Original. */
let report: Awaited<ReturnType<typeof scan.scanDevices>>;
let before = 0;

beforeAll(async () => {
  devices = await import("../../lib/devices");
  scan = await import("../../lib/device-scan");
  route = await import("../../app/api/devices/route");
  audit = await import("../../lib/audit");
  const auth = await import("../../app/api/auth/route");
  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Diagnose"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  process.env.BOB_DEVICE_ENROLLMENT_SECRET = ENROLLMENT_SECRET;
  const enrolled = await post({action: "enroll", secret: ENROLLMENT_SECRET, device: identity});
  expect(enrolled.status).toBe(201);

  before = devices.listDevices().length;
  report = await scan.scanDevices({active: false, maxTargets: 4, concurrency: 2, timeoutMs: 300});
});

describe("t13 zerlegt", () => {
  it("a01_scanId", () => {
    expect(report.scanId).toMatch(/^SCAN-/);
  });

  it("a02_neighborTable", () => {
    expect(["READ", "UNAVAILABLE"]).toContain(report.neighborTable);
  });

  it("a03_durationMs", () => {
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("a04_maxTargets", () => {
    expect(report.limits.maxTargets).toBe(4);
  });

  it("a05_probed", () => {
    expect(report.probed).toBe(0);
  });

  it("a06_reason", () => {
    expect(report.limits.reason).toMatch(/aktive Auflösung abgeschaltet/);
  });

  it("a07_deviceCountUnchanged", () => {
    expect(devices.listDevices()).toHaveLength(before);
  });

  it("a08_authorizedIsOne", () => {
    expect(devices.deviceSummary().authorized).toBe(1);
  });

  it("a09_seedDevicePresent", () => {
    // Was die Flotte tatsächlich enthält — der Wert hinter a08.
    expect(devices.listDevices().map(device => `${device.id}:${device.authorized}`).join(",")).toBe("DEV-LOCAL:true,DEV-ATTEST-1:false");
  });

  it("a10_totalIsTwo", () => {
    expect(devices.deviceSummary().total).toBe(2);
  });

  it("a11_auditChainValid", () => {
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});
