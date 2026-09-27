import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot} from "../helpers/runtime";

/**
 * Geräte-Netz-Scan + Attestierung (Phase 4 / 7.3):
 * Discovery ist keine Autorisierung — Kandidaten bleiben ohne ausdrückliche
 * Attestierung offen; ohne verfügbare Sonde wird fail closed verweigert.
 */

isolatedStorageRoot("device-scan-unit");

let scan: typeof import("../../lib/device-scan");
let bootstrap: typeof import("../../lib/bootstrap");
let audit: typeof import("../../lib/audit");
import {TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

const FIXTURE_ARP = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.10     0x1         0x2         aa:bb:cc:dd:ee:10     *        eth0
192.168.1.11     0x1         0x0         00:00:00:00:00:00     *        eth0
192.168.1.12     0x1         0x2         AA:BB:CC:DD:EE:12     *        eth0
`;

function fakeProbe(findings: Array<{method: "ARP" | "MDNS"; ip: string; mac?: string}>, available = true) {
  return {
    method: "ARP" as const,
    availability: () => ({method: "ARP" as const, available, ...(available ? {} : {reason: "Sonde deaktiviert"})}),
    run: () => findings
  };
}

beforeAll(async () => {
  vi.resetModules();
  scan = await import("../../lib/device-scan");
  bootstrap = await import("../../lib/bootstrap");
  audit = await import("../../lib/audit");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("ARP-Nachbartabelle auswerten", () => {
  it("übernimmt nur vollständige Einträge und normalisiert MAC-Adressen", () => {
    const findings = scan.parseProcArp(FIXTURE_ARP);
    expect(findings.map(finding => finding.ip)).toEqual(["192.168.1.10", "192.168.1.12"]);
    expect(findings[1].mac).toBe("aa:bb:cc:dd:ee:12");
  });

  it("verwirft ungültige Adressen", () => {
    const content = `IP address       HW type     Flags       HW address            Mask     Device
999.168.1.10     0x1         0x2         aa:bb:cc:dd:ee:10     *        eth0
192.168.1.13     0x1         0x2         zz:bb:cc:dd:ee:13     *        eth0
`;
    expect(scan.parseProcArp(content)).toEqual([]);
  });
});

describe("Scan-Verhalten", () => {
  it("erzeugt Kandidaten ausschließlich als PENDING_ATTESTATION", () => {
    const result = scan.runDeviceScan({requestedBy: "CREATOR", probes: [fakeProbe([{method: "ARP", ip: "10.0.0.5", mac: "aa:bb:cc:dd:ee:05"}])] });
    expect(result.candidateIds).toHaveLength(1);
    const candidates = scan.listScanCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("PENDING_ATTESTATION");
    expect(scan.trustedCandidates()).toEqual([]);
  });

  it("verweigert den Scan fail closed, wenn keine Sonde verfügbar ist", () => {
    expect(() => scan.runDeviceScan({requestedBy: "CREATOR", probes: [fakeProbe([], false)]})).toThrow(/no scan probe available/);
  });

  it("meldet unverfügbare Sonden ehrlich statt Ergebnisse zu behaupten", () => {
    const matrix = scan.probeAvailabilityMatrix([
      fakeProbe([], false),
      {method: "MDNS" as const, availability: () => ({method: "MDNS" as const, available: false, reason: "kein mDNS-Werkzeug installiert"}), run: () => []}
    ]);
    expect(matrix.every(entry => entry.available === false)).toBe(true);
    expect(matrix[1].reason).toMatch(/mDNS/);
  });

  it("führt wiederholte Funde desselben Geräts nicht doppelt", () => {
    const before = scan.listScanCandidates().length;
    scan.runDeviceScan({requestedBy: "CREATOR", probes: [fakeProbe([{method: "ARP", ip: "10.0.0.5", mac: "aa:bb:cc:dd:ee:05"}])] });
    expect(scan.listScanCandidates()).toHaveLength(before);
  });
});

describe("Attestierung", () => {
  it("vertraut nur ausdrücklich attestierten Kandidaten (TRUSTED)", () => {
    const candidate = scan.listScanCandidates()[0];
    expect(() => scan.attestScanCandidate({candidateId: candidate.candidateId, verdict: "TRUSTED", reason: "", attestedBy: "CREATOR"})).toThrow(/reason/);
    scan.attestScanCandidate({candidateId: candidate.candidateId, verdict: "TRUSTED", reason: "bekanntes Laborgerät", attestedBy: "CREATOR"});
    expect(scan.trustedCandidates().map(entry => entry.candidateId)).toEqual([candidate.candidateId]);
  });

  it("eine spätere UNTRUSTED-Entscheidung überstimmt das Vertrauen", () => {
    const candidate = scan.trustedCandidates()[0];
    scan.attestScanCandidate({candidateId: candidate.candidateId, verdict: "UNTRUSTED", reason: "MAC gewechselt", attestedBy: "CREATOR"});
    expect(scan.trustedCandidates()).toEqual([]);
    const summary = scan.deviceScanSummary();
    expect(summary.candidates.untrusted).toBe(1);
    expect(summary.candidates.trusted).toBe(0);
  });

  it("Attestierung eines unbekannten Kandidaten wird verweigert", () => {
    expect(() => scan.attestScanCandidate({candidateId: "DEVC-UNBEKANNT", verdict: "TRUSTED", reason: "x", attestedBy: "CREATOR"})).toThrow(/not found/);
  });

  it("Scan und Attestierung stehen in der Audit-Kette", () => {
    const actions = audit.auditSnapshot().map(record => record.action);
    expect(actions).toContain("device:scan");
    expect(actions).toContain("device:attest");
    expect(audit.verifyAuditChain().valid).toBe(true);
  });
});
