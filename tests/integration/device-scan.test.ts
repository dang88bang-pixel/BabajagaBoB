import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Geräte-Netz-Scan + Attestierung gegen die echte Umgebung (Phase 4 / 7.3):
 * Der Scan liest die tatsächliche ARP-Nachbartabelle des Kernels; mDNS wird
 * ehrlich als verfügbar/nicht verfügbar gemeldet. Vertrauen entsteht nur
 * durch ausdrückliche Attestierung.
 */

isolatedStorageRoot("device-scan-int");

let scan: typeof import("../../lib/device-scan");
let bootstrap: typeof import("../../lib/bootstrap");
let audit: typeof import("../../lib/audit");
let provenance: typeof import("../../lib/provenance");

beforeAll(async () => {
  vi.resetModules();
  scan = await import("../../lib/device-scan");
  bootstrap = await import("../../lib/bootstrap");
  audit = await import("../../lib/audit");
  provenance = await import("../../lib/provenance");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Test Creator"});
});

describe("Netz-Scan gegen die echte Umgebung", () => {
  it("scan oder ehrliche Verweigerung — beides auditiert, nie erfundene Ergebnisse", () => {
    const availability = scan.probeAvailabilityMatrix();
    const arp = availability.find(entry => entry.method === "ARP");
    expect(arp).toBeDefined();

    if (arp?.available) {
      const result = scan.runDeviceScan({requestedBy: "CREATOR"});
      expect(result.availability.some(entry => entry.method === "ARP" && entry.available)).toBe(true);
      // Jeder Kandidat ist Discovery ohne Autorisierung.
      for (const candidate of scan.listScanCandidates()) {
        expect(candidate.status).toBe("PENDING_ATTESTATION");
      }
      expect(scan.trustedCandidates()).toEqual([]);

      // Provenance: Kandidaten hängen am Scan-Ereignis.
      const graph = provenance.listProvenance();
      expect(graph.nodes.some(node => node.id === result.scanId && node.kind === "EVENT")).toBe(true);
      for (const candidateId of result.candidateIds) {
        expect(graph.edges.some(edge => edge.from === candidateId && edge.to === result.scanId && edge.relation === "OBSERVED")).toBe(true);
      }
    } else {
      expect(() => scan.runDeviceScan({requestedBy: "CREATOR"})).toThrow(/no scan probe available|refused/);
    }

    const actions = audit.auditSnapshot().map(record => record.action);
    expect(actions).toContain("device:scan");
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("mDNS wird ehrlich gemeldet — verfügbar oder UNAVAILABLE mit Grund", () => {
    const mdns = scan.probeAvailabilityMatrix().find(entry => entry.method === "MDNS");
    expect(mdns).toBeDefined();
    if (!mdns?.available) {
      expect(mdns?.reason).toMatch(/mDNS|avahi|dns-sd/);
    }
  });

  it("Attestierung macht den Unterschied zwischen Discovery und Vertrauen", () => {
    const candidates = scan.listScanCandidates();
    if (candidates.length === 0) {
      // Leere Nachbartabelle ist ein ehrliches Ergebnis — nichts zu attestieren.
      expect(scan.trustedCandidates()).toEqual([]);
      return;
    }
    const candidate = candidates[0];
    scan.attestScanCandidate({candidateId: candidate.candidateId, verdict: "TRUSTED", reason: "Integrationstest: ausdrücklich attestiert", attestedBy: "CREATOR"});
    expect(scan.trustedCandidates().map(entry => entry.candidateId)).toContain(candidate.candidateId);

    const graph = provenance.listProvenance();
    expect(graph.edges.some(edge => edge.from === candidate.candidateId && edge.relation === "AUTHORIZED_BY")).toBe(true);
    expect(audit.auditSnapshot().map(record => record.action)).toContain("device:attest");
  });
});
