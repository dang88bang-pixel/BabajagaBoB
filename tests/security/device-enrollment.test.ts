import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Geräte-Registrierung (Enrollment) als eigenständiger, minimal berechtigter Weg.
 *
 * Kernaussagen der Prüfung:
 *  - ohne konfiguriertes Geheimnis **fail closed** (kein stiller „erlaubt"-Pfad),
 *  - falsches Geheimnis → Verweigerung ohne Datensatz, mit Audit-DENY,
 *  - gültiges Geheimnis → Discovery **ohne** Autorisierung (auch wenn das Gerät
 *    `authorized: true` behauptet),
 *  - das Enrollment-Geheimnis kann **nicht** autorisieren, reservieren oder
 *    freigeben (kein Selbst-Grant),
 *  - Heartbeat ändert nur `lastSeen`/gemeldete Fähigkeiten, nicht `authorized`.
 */

const ENROLLMENT_SECRET = "enrollment-secret-0123456789abcdef";
const root = isolatedStorageRoot("device-enrollment");
void root;

const BASE = "http://localhost:3000";
let devices: typeof import("../../lib/devices");
let route: typeof import("../../app/api/devices/route");
let audit: typeof import("../../lib/audit");
let cookie = "";

const identity = {
  id: "DEV-AGENT-1",
  name: "Discovery Host",
  os: "linux",
  arch: "x64",
  cpu: 4,
  ramMb: 8192,
  gpu: "none",
  network: "NONE",
  trust: "EPHEMERAL",
  capabilities: ["node", "python"]
};

function enroll(overrides: Record<string, unknown> = {}) {
  return route.POST(
    new Request(`${BASE}/api/devices`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "enroll", secret: ENROLLMENT_SECRET, device: {...identity, ...overrides}})
    })
  );
}

beforeAll(async () => {
  vi.resetModules();
  devices = await import("../../lib/devices");
  route = await import("../../app/api/devices/route");
  audit = await import("../../lib/audit");
  const auth = await import("../../app/api/auth/route");
  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Enrollment-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  process.env.BOB_DEVICE_ENROLLMENT_SECRET = ENROLLMENT_SECRET;
});

beforeEach(() => {
  process.env.BOB_DEVICE_ENROLLMENT_SECRET = ENROLLMENT_SECRET;
});

describe("Enrollment (Discovery ≠ Autorisierung)", () => {
  it("ist ohne konfiguriertes Geheimnis fail closed", async () => {
    delete process.env.BOB_DEVICE_ENROLLMENT_SECRET;
    const response = await enroll();
    expect(response.status).toBe(503);
    const body = (await response.json()) as {error: string};
    expect(body.error).toBe("ENROLLMENT_DISABLED");
    expect(devices.listDevices().some(device => device.id === identity.id)).toBe(false);
  });

  it("verweigert ein falsches oder fehlendes Geheimnis und auditiert die Verweigerung", async () => {
    const before = audit.auditSnapshot(200).filter(record => record.action === "device.enroll" && record.decision === "DENY").length;
    const wrong = await route.POST(
      new Request(`${BASE}/api/devices`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "enroll", secret: "falsch-aber-lang-genug-000", device: identity})
      })
    );
    expect(wrong.status).toBe(403);
    const missing = await route.POST(
      new Request(`${BASE}/api/devices`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "enroll", device: identity})
      })
    );
    expect(missing.status).toBe(403);
    expect(devices.listDevices().some(device => device.id === identity.id)).toBe(false);
    const after = audit.auditSnapshot(200).filter(record => record.action === "device.enroll" && record.decision === "DENY").length;
    expect(after).toBeGreaterThan(before);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("nimmt eine gültige Meldung an — aber ohne Autorisierung, auch bei Behauptung", async () => {
    const response = await enroll({authorized: true, state: "AUTHORIZED"});
    expect(response.status).toBe(201);
    const body = (await response.json()) as {device: {id: string; authorized: boolean; state: string}};
    expect(body.device.id).toBe(identity.id);
    expect(body.device.authorized).toBe(false);
    expect(body.device.state).toBe("DISCOVERED");
    // Reservieren ist damit unmöglich (Authorization ist ein Creator-Akt).
    expect(() => devices.allocateDevice(identity.id, "TASK-ENROLL")).toThrow(/not authorized/);
  });

  it("erlaubt Heartbeat, ohne die Autorisierung zu verändern", async () => {
    const before = devices.listDevices().find(device => device.id === identity.id);
    expect(before?.authorized).toBe(false);
    const response = await route.POST(
      new Request(`${BASE}/api/devices`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "heartbeat", secret: ENROLLMENT_SECRET, device: {...identity, capabilities: ["node", "python", "busybox"]}})
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {device: {authorized: boolean; capabilities: string[]; lastSeen: string}; authorized: boolean};
    expect(body.authorized).toBe(false);
    expect(body.device.authorized).toBe(false);
    expect(body.device.capabilities).toContain("busybox");
    expect(new Date(body.device.lastSeen).getTime()).toBeGreaterThanOrEqual(new Date(before?.lastSeen ?? 0).getTime());

    // Die Domänenfunktion kann ebenfalls keine Autorisierung setzen.
    const heartbeat = devices.heartbeatDevice(identity.id, {network: "LAN"});
    expect(heartbeat.authorized).toBe(false);
    expect(heartbeat.state).toBe("DISCOVERED");
  });

  it("kann mit dem Enrollment-Geheimnis nicht autorisieren, reservieren oder freigeben", async () => {
    for (const action of ["authorize", "allocate", "release"]) {
      const response = await route.POST(
        new Request(`${BASE}/api/devices`, {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({action, secret: ENROLLMENT_SECRET, id: identity.id, authorized: true, taskId: "TASK-ENROLL"})
        })
      );
      expect([401, 403, 428]).toContain(response.status);
    }
    const device = devices.listDevices().find(entry => entry.id === identity.id);
    expect(device?.authorized).toBe(false);
    expect(device?.state).toBe("DISCOVERED");
  });

  it("bleibt für den Creator-Weg unverändert (Session autorisiert weiterhin)", async () => {
    const authorized = await route.POST(
      new Request(`${BASE}/api/devices`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "authorize", id: identity.id, authorized: true})
      })
    );
    expect(authorized.status).toBe(200);
    expect(devices.listDevices().find(entry => entry.id === identity.id)?.authorized).toBe(true);
    const allocated = await route.POST(
      new Request(`${BASE}/api/devices`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "allocate", id: identity.id, taskId: "TASK-ENROLL"})
      })
    );
    expect(allocated.status).toBe(200);
  });

  it("weist unvollständige Identität und überlange Felder zurück", async () => {
    const incomplete = await route.POST(
      new Request(`${BASE}/api/devices`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "enroll", secret: ENROLLMENT_SECRET, device: {id: "DEV-X", name: "", os: "linux", arch: "x64"}})
      })
    );
    expect(incomplete.status).toBe(400);
    const oversized = await enroll({id: "X".repeat(500)});
    expect(oversized.status).toBe(400);
    // Die Verweigerung selbst bleibt intakt, auch wenn die gemeldete Kennung
    // unbrauchbar ist (Protokollierung darf keinen 500er erzeugen).
    const hostile = await enroll({id: "!!! unbrauchbar !!!", name: "Hostil"});
    expect(hostile.status).toBe(400);
    expect(devices.listDevices().some(device => device.name === "Discovery Host" && !device.id)).toBe(false);
  });

  it("liefert das Geheimnis niemals in Antworten oder Ereignissen", async () => {
    const list = await route.GET(new Request(`${BASE}/api/devices`, {headers: {cookie}}));
    const text = await list.text();
    expect(text).not.toContain(ENROLLMENT_SECRET);
    expect(text).toContain("enrollment");
    const events = await import("../../lib/events/log");
    const dump = JSON.stringify(events.listDomainEvents({limit: 200}));
    expect(dump).not.toContain(ENROLLMENT_SECRET);
  });
});
