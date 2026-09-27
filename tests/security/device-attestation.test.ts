import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Geräte-Attestierung und aktiver Netz-Scan.
 *
 * Kernaussagen:
 *  - Attestierung beweist die Identität, **autorisiert aber nichts** —
 *    `authorized` bleibt `false` und ein attestiertes Gerät ist nicht zuteilbar.
 *  - Jede Nonce ist einmalig: Replay → 409, auch mit korrekter Quittung.
 *  - Abgelaufene Herausforderungen sind wertlos (410).
 *  - Falsche Quittungen werden gezählt und sperren nach `MAX_FAILURES` (423).
 *  - Ohne konfiguriertes Geheimnis ist Attestierung fail closed (503).
 *  - Unbekannte Geräte erhalten keine Herausforderung (kein Phantomgerät).
 *  - Der Scan meldet, was gemessen wurde, und legt kein Gerät an.
 */

const ENROLLMENT_SECRET = "enrollment-secret-0123456789abcdef";
const root = isolatedStorageRoot("device-attestation");
void root;

const BASE = "http://localhost:3000";
const DEVICE_ID = "DEV-ATTEST-1";

let devices: typeof import("../../lib/devices");
let attestation: typeof import("../../lib/device-attestation");
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

beforeAll(async () => {
  vi.resetModules();
  devices = await import("../../lib/devices");
  attestation = await import("../../lib/device-attestation");
  scan = await import("../../lib/device-scan");
  route = await import("../../app/api/devices/route");
  audit = await import("../../lib/audit");
  const auth = await import("../../app/api/auth/route");
  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Attestierungs-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  process.env.BOB_DEVICE_ENROLLMENT_SECRET = ENROLLMENT_SECRET;

  // Das Gerät muss registriert sein, bevor es attestiert werden kann.
  const enrolled = await post({action: "enroll", secret: ENROLLMENT_SECRET, device: identity});
  expect(enrolled.status).toBe(201);
});

beforeEach(() => {
  process.env.BOB_DEVICE_ENROLLMENT_SECRET = ENROLLMENT_SECRET;
});

describe("Attestierung (Identität ≠ Autorisierung)", () => {
  it("ist ohne konfiguriertes Geheimnis fail closed", async () => {
    delete process.env.BOB_DEVICE_ENROLLMENT_SECRET;
    const response = await post({action: "attest.challenge", id: DEVICE_ID}, true);
    expect(response.status).toBe(503);
    expect(((await response.json()) as {error: string}).error).toBe("ATTESTATION_DISABLED");
    expect(attestation.attestationAvailable()).toBe(false);
  });

  it("verweigert eine Herausforderung für ein unbekanntes Gerät", async () => {
    const response = await post({action: "attest.challenge", id: "DEV-PHANTOM-9"}, true);
    expect(response.status).toBe(404);
    expect(((await response.json()) as {error: string}).error).toBe("DEVICE_NOT_FOUND");
  });

  it("weist eine unzulässige Gerätekennung ab", async () => {
    const response = await post({action: "attest.challenge", id: "böse:kennung"}, true);
    expect(response.status).toBe(400);
  });

  it("verlangt eine Creator-Session für die Herausforderung", async () => {
    const response = await post({action: "attest.challenge", id: DEVICE_ID});
    expect([401, 428]).toContain(response.status);
  });

  it("attestiert mit korrekter Quittung — ohne zu autorisieren", async () => {
    const issued = await post({action: "attest.challenge", id: DEVICE_ID}, true);
    expect(issued.status).toBe(200);
    const {challenge} = (await issued.json()) as {challenge: {challengeId: string; nonce: string}};
    expect(challenge.nonce.length).toBeGreaterThanOrEqual(24);

    const proof = attestation.signAttestation(DEVICE_ID, challenge.nonce, ENROLLMENT_SECRET);
    const verified = await post({action: "attest", device: {id: DEVICE_ID}, challengeId: challenge.challengeId, proof});
    expect(verified.status).toBe(200);
    const body = (await verified.json()) as {attestationId: string; authorized: boolean};
    expect(body.attestationId).toMatch(/^ATT-/);
    expect(body.authorized).toBe(false);

    // Der Kernnachweis: attestiert, aber unautorisiert und nicht zuteilbar.
    const device = devices.listDevices().find(entry => entry.id === DEVICE_ID);
    expect(device?.authorized).toBe(false);
    expect(() => devices.allocateDevice(DEVICE_ID, "TASK-ATTEST")).toThrow(/not authorized/);

    const summary = attestation.attestationSummary();
    expect(summary.verified).toBeGreaterThanOrEqual(1);
    expect(summary.attestedDevices).toBeGreaterThanOrEqual(1);
  });

  it("verweigert Replay: dieselbe Nonce gilt nur einmal", async () => {
    const issued = await post({action: "attest.challenge", id: DEVICE_ID}, true);
    const {challenge} = (await issued.json()) as {challenge: {challengeId: string; nonce: string}};
    const proof = attestation.signAttestation(DEVICE_ID, challenge.nonce, ENROLLMENT_SECRET);

    const first = await post({action: "attest", device: {id: DEVICE_ID}, challengeId: challenge.challengeId, proof});
    expect(first.status).toBe(200);
    const second = await post({action: "attest", device: {id: DEVICE_ID}, challengeId: challenge.challengeId, proof});
    expect(second.status).toBe(409);
    expect(((await second.json()) as {error: string}).error).toBe("ATTESTATION_REPLAY");
  });

  it("verweigert eine falsche Quittung und eine fremde Kennung", async () => {
    const issued = await post({action: "attest.challenge", id: DEVICE_ID}, true);
    const {challenge} = (await issued.json()) as {challenge: {challengeId: string; nonce: string}};

    const wrong = await post({action: "attest", device: {id: DEVICE_ID}, challengeId: challenge.challengeId, proof: "a".repeat(64)});
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as {error: string}).error).toBe("ATTESTATION_PROOF");

    // Richtige Quittung, aber für eine andere Kennung gerechnet: ebenfalls nein.
    const other = await post({action: "attest.challenge", id: DEVICE_ID}, true);
    const otherChallenge = ((await other.json()) as {challenge: {challengeId: string; nonce: string}}).challenge;
    const crossProof = attestation.signAttestation("DEV-ANDERES-GERAET", otherChallenge.nonce, ENROLLMENT_SECRET);
    const cross = await post({action: "attest", device: {id: DEVICE_ID}, challengeId: otherChallenge.challengeId, proof: crossProof});
    expect(cross.status).toBe(403);
  });

  it("lehnt eine unbekannte Herausforderung ab", async () => {
    const response = await post({action: "attest", device: {id: DEVICE_ID}, challengeId: "CHL-UNBEKANNT", proof: "a".repeat(64)});
    expect(response.status).toBe(404);
    expect(((await response.json()) as {error: string}).error).toBe("ATTESTATION_CHALLENGE");
  });

  it("sperrt nach zu vielen Fehlversuchen", async () => {
    // Eigenes Gerät: die vorherigen Tests haben für DEV-ATTEST-1 bereits
    // Fehlversuche erzeugt. Die Schwelle (MAX_FAILURES) ist nur an einem
    // unbelasteten Gerät exakt prüfbar.
    const lockedDevice = "DEV-ATTEST-LOCK";
    const enrolled = await post({
      action: "enroll",
      secret: ENROLLMENT_SECRET,
      device: {...identity, id: lockedDevice, name: "Sperre-Host"}
    });
    expect(enrolled.status).toBe(201);
    expect(attestation.attestationSummary().lockedDevices).not.toContain(lockedDevice);

    const statuses: number[] = [];
    let challengeBlocked = false;
    for (let attempt = 0; attempt < 8 && !challengeBlocked; attempt += 1) {
      const issued = await post({action: "attest.challenge", id: lockedDevice}, true);
      if (issued.status === 423) {
        // Nach der Sperre wird schon die Ausstellung verweigert — genau das ist
        // der Sinn: Es gibt dann keine neue Nonce mehr, die man raten könnte.
        expect(((await issued.json()) as {error: string}).error).toBe("ATTESTATION_LOCKED");
        challengeBlocked = true;
        statuses.push(issued.status);
        break;
      }
      const {challenge} = (await issued.json()) as {challenge: {challengeId: string; nonce: string}};
      const response = await post({
        action: "attest",
        device: {id: lockedDevice},
        challengeId: challenge.challengeId,
        proof: `${attempt}${"b".repeat(63)}`
      });
      statuses.push(response.status);
    }
    expect(challengeBlocked).toBe(true);
    // Fünf Fehlversuche wurden als 403 gezählt, danach greift die Sperre.
    expect(statuses.filter(status => status === 403)).toHaveLength(5);
    expect(attestation.attestationSummary().lockedDevices).toContain(lockedDevice);
  });

  it("protokolliert Attestierungen und Verweigerungen in der Audit-Kette", () => {
    const records = audit.auditSnapshot(500).filter(entry => entry.action.startsWith("device.attest"));
    expect(records.length).toBeGreaterThan(2);
    expect(records.some(entry => entry.decision === "DENY")).toBe(true);
    expect(records.some(entry => entry.decision === "ALLOW")).toBe(true);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});

describe("Aktiver Netz-Scan", () => {
  it("liest die Kernel-Nachbartabelle oder meldet sie als nicht verfügbar", () => {
    const table = scan.readNeighborTable();
    expect(["READ", "UNAVAILABLE"]).toContain(table.available ? "READ" : "UNAVAILABLE");
    expect(table.detail.length).toBeGreaterThan(0);
    if (table.available) {
      for (const entry of table.entries) {
        expect(entry.address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
        expect(["RESOLVED", "INCOMPLETE"]).toContain(entry.state);
      }
    }
  });

  it("begrenzt aktive Scans auf /24-Netze", () => {
    expect(scan.subnetTargets({address: "10.0.0.5", prefix: 24}, 8)).toHaveLength(8);
    expect(scan.subnetTargets({address: "10.0.0.5", prefix: 16}, 8)).toEqual([]);
    // Die eigene Adresse ist kein Ziel.
    const targets = scan.subnetTargets({address: "192.168.1.7", prefix: 24}, 254);
    expect(targets).not.toContain("192.168.1.7");
    expect(targets.length).toBeLessThanOrEqual(253);
  });

  it("führt einen begrenzten Scan aus, legt aber kein Gerät an und autorisiert nichts", async () => {
    const before = devices.listDevices().length;
    const report = await scan.scanDevices({active: false, maxTargets: 4, concurrency: 2, timeoutMs: 300});

    expect(report.scanId).toMatch(/^SCAN-/);
    expect(["READ", "UNAVAILABLE"]).toContain(report.neighborTable);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.limits.maxTargets).toBe(4);
    // Passive Variante: nichts aktiv geprüft.
    expect(report.probed).toBe(0);
    expect(report.limits.reason).toMatch(/aktive Auflösung abgeschaltet/);

    // Discovery ≠ Autorisierung: kein neues Gerät, keine Autorisierung.
    expect(devices.listDevices()).toHaveLength(before);
    expect(devices.deviceSummary().authorized).toBe(1);
  });

  it("scannt aktiv nur /24-Netze — Zielmenge und Prüfzahl folgen der Schnittstellenmaske", async () => {
    // Die Regel hängt **nicht** von der Netzmaske des Testrechners ab: Ein CI-Runner
    // liegt oft in einem breiteren Netz (/16, /20), dann gibt es bewusst keine
    // aktiven Ziele. Geprüft wird beides — und zwar gegen die gemessene Maske.
    const subnets = scan.localSubnets();
    const scannable = subnets.filter(entry => entry.prefix >= 24);
    const report = await scan.scanDevices({active: true, maxTargets: 4, concurrency: 4, timeoutMs: 250});

    expect(report.limits.maxTargets).toBe(4);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    if (scannable.length > 0) {
      expect(report.probed).toBeGreaterThan(0);
      expect(report.probed).toBeLessThanOrEqual(4 * scannable.length);
    } else {
      // Kein /24 am Rechner → kein einziges Paket, und der Bericht verschweigt das nicht.
      expect(report.probed).toBe(0);
      expect(subnets.length).toBe(0);
    }

    // Kein Fund wird zu einem Gerät: die Flotte bleibt unverändert.
    expect(devices.listDevices().some(device => device.id.startsWith("SCAN-"))).toBe(false);
    const records = audit.auditSnapshot(200).filter(entry => entry.action === "device.scan");
    expect(records.length).toBeGreaterThan(0);
    expect(records.every(entry => entry.decision === "ALLOW")).toBe(true);
  });

  it("erzeugt ohne /24-Ziel kein Paket und meldet das im Bericht", async () => {
    // Deterministischer Fall unabhängig von der Umgebung: eine Schnittstelle, die
    // es nicht gibt, filtert jedes Netz heraus — der aktive Scan läuft ins Leere.
    const report = await scan.scanDevices({active: true, maxTargets: 4, concurrency: 4, timeoutMs: 250, interfaces: ["bob-keine-solche-schnittstelle"]});
    expect(report.interfaces).toHaveLength(0);
    expect(report.probed).toBe(0);
    expect(report.entries).toHaveLength(0);
    // Kein Fund, keine Zielmenge — und trotzdem kein Gerät und keine Autorisierung.
    expect(devices.listDevices().some(device => device.id.startsWith("SCAN-"))).toBe(false);
  });

  it("verweigert den Scan ohne Creator-Session", async () => {
    const response = await post({action: "scan", confirm: true});
    expect([401, 428]).toContain(response.status);
  });

  it("führt einen Scan nur mit expliziter Bestätigung aus (kein stiller Erfolg)", async () => {
    const withoutConfirm = await post({action: "scan"}, true);
    expect(withoutConfirm.status).toBe(400);
    expect(((await withoutConfirm.json()) as {error: string}).error).toBe("SCAN_CONFIRM_REQUIRED");

    const confirmed = await post({action: "scan", confirm: true, active: false}, true);
    expect(confirmed.status).toBe(200);
    const body = (await confirmed.json()) as {scan: {scanId: string; probed: number}};
    expect(body.scan.scanId).toMatch(/^SCAN-/);
    expect(body.scan.probed).toBe(0);
  });
});
