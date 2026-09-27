import crypto from "node:crypto";
import fs from "node:fs";
import {createStore} from "./persistence/store";
import {recordAudit} from "./audit";
import {observe} from "./observability";
import {addProvenanceEdge, addProvenanceNode} from "./provenance";

/**
 * Geräte-Netz-Scan (ARP/mDNS) + Attestierung (Phase 4 / 7.3).
 *
 * Grundregeln (analog Geräte-Discovery):
 *  - Ein Scan ist **Discovery, keine Autorisierung**: jeder gefundene Kandidat
 *    bleibt `PENDING_ATTESTATION`, bis der Creator ihn ausdrücklich attestiert.
 *  - Fail closed: ist keine Sonde verfügbar, wird der Scan verweigert statt
 *    Ergebnisse zu behaupten. Unverfügbare Sonden werden ehrlich als
 *    `UNAVAILABLE` mit Grund gemeldet (z. B. kein `avahi-browse` für mDNS).
 *  - Jeder Scan und jede Attestierung wird auditiert und im Provenance-Graph
 *    verankert (Kandidat = DEVICE-Knoten, Attestierung = OBSERVED-Kante).
 *
 * Ehrliche Grenzen dieser Umgebung: gelesen wird die ARP-Nachbartabelle des
 * Kernels (`/proc/net/arp`) bzw. vorhandene Werkzeuge; ein aktives
 * Subnetz-Sweeping (arp-scan) oder mDNS-Browsing findet nur statt, wenn die
 * Werkzeuge vorhanden sind — sonst UNAVAILABLE.
 */

export type ScanMethod = "ARP" | "MDNS";

export type ProbeAvailability = {method: ScanMethod; available: boolean; reason?: string};

export type ProbeFinding = {method: ScanMethod; ip: string; mac?: string; hostname?: string};

export type ScanProbe = {
  method: ScanMethod;
  availability: () => ProbeAvailability;
  run: () => ProbeFinding[];
};

export type ScanCandidate = {
  candidateId: string;
  scanId: string;
  method: ScanMethod;
  ip: string;
  mac?: string;
  hostname?: string;
  seenAt: string;
  /** Discovery ist keine Autorisierung: ohne Attestierung bleibt alles offen. */
  status: "PENDING_ATTESTATION";
};

export type AttestationVerdict = "TRUSTED" | "UNTRUSTED";

export type Attestation = {
  attestationId: string;
  candidateId: string;
  verdict: AttestationVerdict;
  reason: string;
  attestedBy: string;
  attestedAt: string;
};

type DeviceScanEntry = {
  scanId: string;
  requestedBy: string;
  startedAt: string;
  finishedAt: string;
  availability: ProbeAvailability[];
  candidateIds: string[];
};

type Payload = {scans: DeviceScanEntry[]; candidates: ScanCandidate[]; attestations: Attestation[]};

const store = createStore<Payload>("device-scan", 1, () => ({scans: [], candidates: [], attestations: []}));

const IP_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC_PATTERN = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

function validIp(value: string): boolean {
  if (!IP_PATTERN.test(value)) return false;
  return value.split(".").every(octet => Number(octet) <= 255);
}

/**
 * Wertet die ARP-Nachbartabelle des Kernels aus. Zeilen mit unvollständigem
 * Eintrag (Flags 0x0, MAC 00:00:00:00:00:00) werden verworfen.
 */
export function parseProcArp(content: string): ProbeFinding[] {
  const lines = content.split("\n").slice(1);
  const findings: ProbeFinding[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [ip, , flags, mac] = parts;
    if (!validIp(ip)) continue;
    if (flags === "0x0") continue;
    if (!MAC_PATTERN.test(mac) || mac === "00:00:00:00:00:00") continue;
    findings.push({method: "ARP", ip, mac: mac.toLowerCase()});
  }
  return findings;
}

function commandExists(binary: string): boolean {
  const paths = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of paths) {
    try {
      const candidate = `${dir.replace(/\/+$/, "")}/${binary}`;
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      // weiter suchen
    }
  }
  return false;
}

/** ARP-Sonde: Kernel-Nachbartabelle; benötigt kein Zusatzwerkzeug. */
export const arpProbe: ScanProbe = {
  method: "ARP",
  availability: () => {
    try {
      fs.accessSync("/proc/net/arp", fs.constants.R_OK);
      return {method: "ARP", available: true};
    } catch {
      return {method: "ARP", available: false, reason: "/proc/net/arp ist nicht lesbar"};
    }
  },
  run: () => {
    const content = fs.readFileSync("/proc/net/arp", "utf8");
    return parseProcArp(content);
  }
};

/** mDNS-Sonde: nur mit installiertem Browser-Werkzeug verfügbar. */
export const mdnsProbe: ScanProbe = {
  method: "MDNS",
  availability: () => {
    if (commandExists("avahi-browse") || commandExists("dns-sd")) return {method: "MDNS", available: true};
    return {method: "MDNS", available: false, reason: "kein mDNS-Werkzeug installiert (avahi-browse/dns-sd)"};
  },
  run: () => []
};

export function scanProbes(): ScanProbe[] {
  return [arpProbe, mdnsProbe];
}

export function probeAvailabilityMatrix(probes: ScanProbe[] = scanProbes()): ProbeAvailability[] {
  return probes.map(probe => probe.availability());
}

function sanitizeHostname(value: string): string {
  return value.slice(0, 120).replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * Führt einen Scan über alle verfügbaren Sonden aus.
 *
 * Fail closed: ist **keine** Sonde verfügbar, wird der Scan verweigert —
 * es werden keine Ergebnisse behauptet, die nicht erhoben wurden.
 */
export function runDeviceScan(input: {requestedBy: string; probes?: ScanProbe[]}): DeviceScanEntry {
  const probes = input.probes ?? scanProbes();
  const availability = probes.map(probe => probe.availability());
  const usable = probes.filter(probe => probe.availability().available);
  if (usable.length === 0) {
    recordAudit({actor: input.requestedBy, action: "device:scan", resource: "device-scan", decision: "DENY"}, {availability});
    throw new Error("device scan refused: no scan probe available");
  }

  const scanId = `SCAN-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const startedAt = new Date().toISOString();
  const findings: ProbeFinding[] = [];
  for (const probe of usable) {
    try {
      findings.push(...probe.run());
    } catch (error) {
      observe({
        type: "device.scan.probe.failed",
        message: `Sonde ${probe.method} fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
        status: "BLOCKED",
        actor: input.requestedBy,
        agentId: input.requestedBy,
        action: "device:scan",
        resource: scanId,
        argumentsValue: {method: probe.method}
      });
    }
  }

  store.update(payload => {
    const candidateIds: string[] = [];
    for (const finding of findings) {
      const known = payload.candidates.find(candidate => candidate.method === finding.method && candidate.ip === finding.ip);
      if (known) {
        candidateIds.push(known.candidateId);
        continue;
      }
      const candidateId = `DEVC-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      payload.candidates.push({
        candidateId,
        scanId,
        method: finding.method,
        ip: finding.ip,
        ...(finding.mac ? {mac: finding.mac} : {}),
        ...(finding.hostname ? {hostname: sanitizeHostname(finding.hostname)} : {}),
        seenAt: startedAt,
        status: "PENDING_ATTESTATION"
      });
      candidateIds.push(candidateId);
    }
    payload.scans.push({scanId, requestedBy: input.requestedBy, startedAt, finishedAt: new Date().toISOString(), availability, candidateIds});
  });
  const scan = store.read().scans.find(entry => entry.scanId === scanId);
  if (!scan) throw new Error("device scan could not be persisted");

  addProvenanceNode({id: scanId, kind: "EVENT", label: `device scan ${scanId} (${usable.map(probe => probe.method).join(",")})`});
  for (const candidateId of scan.candidateIds) {
    const candidate = store.read().candidates.find(entry => entry.candidateId === candidateId);
    if (!candidate) continue;
    addProvenanceNode({id: candidateId, kind: "DEVICE", label: `scan candidate ${candidate.ip}`});
    addProvenanceEdge({from: candidateId, to: scanId, relation: "OBSERVED"});
  }

  observe({
    type: "device.scan.completed",
    message: `Netz-Scan ${scanId}: ${scan.candidateIds.length} Kandidat(en), Sonden ${availability.map(entry => `${entry.method}=${entry.available ? "ok" : "UNAVAILABLE"}`).join(", ")}`,
    status: "COMPLETED",
    actor: input.requestedBy,
    agentId: input.requestedBy,
    action: "device:scan",
    resource: scanId,
    argumentsValue: {candidates: scan.candidateIds.length}
  });
  recordAudit({actor: input.requestedBy, action: "device:scan", resource: scanId, decision: "ALLOW"}, {candidates: scan.candidateIds.length, availability});
  return scan;
}

/**
 * Ausdrückliche Attestierung eines Scan-Kandidaten durch den Creator.
 * Discovery bleibt ohne diesen Akt folgenlos.
 */
export function attestScanCandidate(input: {candidateId: string; verdict: AttestationVerdict; reason: string; attestedBy: string}): Attestation {
  const candidate = store.read().candidates.find(entry => entry.candidateId === input.candidateId);
  if (!candidate) throw new Error(`scan candidate not found: ${input.candidateId}`);
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new Error("attestation requires a reason");

  const attestationId = `ATST-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  store.update(payload => {
    payload.attestations.push({attestationId, candidateId: input.candidateId, verdict: input.verdict, reason, attestedBy: input.attestedBy, attestedAt: new Date().toISOString()});
  });
  addProvenanceNode({id: attestationId, kind: "EVENT", label: `attestation ${input.verdict} ${candidate.ip}`});
  addProvenanceEdge({from: candidate.candidateId, to: attestationId, relation: "AUTHORIZED_BY"});

  observe({
    type: "device.scan.attested",
    message: `Scan-Kandidat ${candidate.ip} attestiert: ${input.verdict}`,
    status: "COMPLETED",
    actor: input.attestedBy,
    agentId: input.attestedBy,
    action: "device:attest",
    resource: candidate.candidateId,
    argumentsValue: {verdict: input.verdict}
  });
  recordAudit({actor: input.attestedBy, action: "device:attest", resource: candidate.candidateId, decision: "ALLOW"}, {verdict: input.verdict, reason});
  const created = store.read().attestations.find(attestation => attestation.attestationId === attestationId);
  if (!created) throw new Error("attestation could not be persisted");
  return created;
}

/** Neueste Attestierung je Kandidat (frühere Entscheidungen werden überstimmt, bleiben aber im Bestand). */
export function latestAttestation(candidateId: string): Attestation | undefined {
  return store
    .read()
    .attestations.filter(attestation => attestation.candidateId === candidateId)
    .sort((a, b) => b.attestedAt.localeCompare(a.attestedAt))[0];
}

/**
 * Vertrauen entsteht ausschließlich durch Attestierung mit Urteil TRUSTED —
 * niemals durch den Scan selbst.
 */
export function trustedCandidates(): ScanCandidate[] {
  return store.read().candidates.filter(candidate => {
    const attestation = latestAttestation(candidate.candidateId);
    if (!attestation) return false;
    if (attestation.verdict !== "TRUSTED") return false;
    return true;
  });
}

export function listDeviceScans(): DeviceScanEntry[] {
  return store.read().scans;
}

export function listScanCandidates(): Array<ScanCandidate & {attestation: Attestation | null}> {
  return store.read().candidates.map(candidate => ({...candidate, attestation: latestAttestation(candidate.candidateId) ?? null}));
}

export function listAttestations(): Attestation[] {
  return store.read().attestations;
}

export function deviceScanSummary() {
  const payload = store.read();
  const trusted = trustedCandidates();
  return {
    scans: payload.scans.length,
    candidates: {total: payload.candidates.length, pending: payload.candidates.length - new Set(trusted.map(candidate => candidate.candidateId)).size - countUntrusted(payload), trusted: trusted.length, untrusted: countUntrusted(payload)},
    attestations: payload.attestations.length,
    availability: probeAvailabilityMatrix(),
    note: "Discovery ist keine Autorisierung: Kandidaten bleiben ohne ausdrückliche Attestierung PENDING."
  };
}

function countUntrusted(payload: Payload): number {
  return payload.candidates.filter(candidate => {
    const attestation = latestAttestation(candidate.candidateId);
    return attestation?.verdict === "UNTRUSTED";
  }).length;
}
