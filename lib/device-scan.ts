import dgram from "node:dgram";
import fs from "node:fs";
import os from "node:os";
import {observe} from "./observability";
import {recordAudit} from "./audit";

/**
 * ============================================================================
 * Aktiver Netz-Scan (Device Fabric) — Discovery ≠ Autorisierung
 * ============================================================================
 *
 * Bisher konnten sich Geräte nur **selbst melden** (`lib/device-enrollment.ts`).
 * Das ist sicher, findet aber kein Gerät, das keinen Agenten ausführt. Dieser
 * Scan ergänzt die aktive Sicht — mit denselben Grenzen:
 *
 *  - **Discovery erzeugt keinen Zugriff.** Ein gefundener Eintrag ist ein
 *    Kandidat ohne Rechte; Autorisierung bleibt ein Creator-Akt.
 *  - **Kein Shell-Aufruf.** Die Nachbartabelle wird aus `/proc/net/arp` gelesen
 *    (Kernel-Datei, kein `exec`); die aktive Auflösung nutzt UDP-Sockets aus
 *    Node, nie eine Kommandozeile.
 *  - **Begrenzt.** Höchstens ein /24 pro Schnittstelle, begrenzte Nebenläufigkeit
 *    und eine harte Zeitgrenze. Ein Scan darf das Netz nicht fluten.
 *  - **Ehrlich.** Was nicht messbar ist, wird als `UNAVAILABLE` gemeldet —
 *    nicht als „leer" und schon gar nicht als Erfolg.
 *
 * Die aktive Auflösung funktioniert so: Ein UDP-Paket an eine geschlossene Port
 * erzwingt eine ARP-Auflösung des Ziels; der Kernel legt daraufhin einen
 * Nachbareintrag an, der gelesen wird. Das ist eine passive Beobachtung des
 * eigenen Nachbarschaftscaches, keine Portabfrage fremder Dienste.
 */

export type ScanEntry = {
  address: string;
  interface: string;
  macAddress: string | null;
  state: string;
  /** Quelle des Eintrags: Kernel-Nachbartabelle oder aktive Auflösung. */
  source: "NEIGHBOR_TABLE" | "ACTIVE_PROBE";
};

export type ScanReport = {
  scanId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  interfaces: Array<{name: string; address: string; netmask: string; family: "IPv4"}>;
  probed: number;
  entries: ScanEntry[];
  /** Was gemessen wurde und was nicht — keine stillschweigende Leerheit. */
  limits: {maxTargets: number; concurrency: number; timeoutMs: number; reason?: string};
  neighborTable: "READ" | "UNAVAILABLE";
};

const ARP_FILE = "/proc/net/arp";
const DEFAULT_MAX_TARGETS = 256;
const DEFAULT_CONCURRENCY = 32;
const DEFAULT_TIMEOUT_MS = 4_000;
const PROBE_PORT = 1;

const isIpv4 = (value: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(value);

/** Liest die Kernel-Nachbartabelle. Fehlt sie, ist das ein Zustand, kein Erfolg. */
export function readNeighborTable(): {available: boolean; detail: string; entries: ScanEntry[]} {
  if (!fs.existsSync(ARP_FILE)) {
    return {available: false, detail: `${ARP_FILE} ist in dieser Umgebung nicht vorhanden`, entries: []};
  }
  let text: string;
  try {
    text = fs.readFileSync(ARP_FILE, "utf8");
  } catch (error) {
    return {available: false, detail: `Nachbartabelle nicht lesbar: ${error instanceof Error ? error.message : "unbekannt"}`, entries: []};
  }
  const [header, ...rows] = text.trim().split("\n");
  const columns = (header ?? "").toLowerCase().split(/\s+/);
  const addressIndex = columns.indexOf("ip");
  const hwIndex = columns.indexOf("hw");
  const deviceIndex = columns.indexOf("device");
  if (addressIndex < 0 || deviceIndex < 0) {
    return {available: false, detail: "Nachbartabelle hat kein erkennbares Format", entries: []};
  }
  const entries: ScanEntry[] = [];
  for (const row of rows) {
    const fields = row.trim().split(/\s+/);
    if (fields.length < Math.max(addressIndex, deviceIndex) + 1) continue;
    const address = fields[addressIndex];
    if (!isIpv4(address)) continue;
    // Eintrag ohne Hardware-Adresse ist ein fehlgeschlagener Auflösungsversuch:
    // er wird gemeldet, aber nicht als gefunden gezählt.
    const raw = hwIndex >= 0 ? fields[hwIndex] : "";
    const mac = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(raw) && raw !== "00:00:00:00:00:00" ? raw.toLowerCase() : null;
    entries.push({
      address,
      interface: fields[deviceIndex],
      macAddress: mac,
      state: mac ? "RESOLVED" : "INCOMPLETE",
      source: "NEIGHBOR_TABLE"
    });
  }
  return {available: true, detail: `${entries.length} Nachbareinträge gelesen`, entries};
}

/** Lokale IPv4-Netze der Schnittstellen (ohne Loopback). */
export function localSubnets(): Array<{name: string; address: string; netmask: string; prefix: number}> {
  const result: Array<{name: string; address: string; netmask: string; prefix: number}> = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4") continue;
      if (info.address.startsWith("127.")) continue;
      const mask = info.netmask;
      if (!isIpv4(mask)) continue;
      const prefix = mask.split(".").reduce((sum, octet) => sum + (Number(octet).toString(2).match(/1/g)?.length ?? 0), 0);
      result.push({name, address: info.address, netmask: mask, prefix});
    }
  }
  return result;
}

/**
 * Adressen eines /24 um eine eigene Adresse herum (begrenzt auf `maxTargets`).
 * Die eigene Adresse selbst ist kein Scan-Ziel.
 */
export function subnetTargets(local: {address: string; prefix: number}, maxTargets = DEFAULT_MAX_TARGETS): string[] {
  const octets = local.address.split(".").map(Number);
  if (octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return [];
  // Nur /24 wird aktiv gescannt: größere Netze wären eine Netzflutung.
  if (local.prefix < 24) {
    return [];
  }
  const base = `${octets[0]}.${octets[1]}.${octets[2]}`;
  const targets: string[] = [];
  for (let last = 1; last <= 254 && targets.length < maxTargets; last += 1) {
    const address = `${base}.${last}`;
    if (address === local.address) continue;
    targets.push(address);
  }
  return targets;
}

/**
 * Erzeugt einen Nachbareintrag, indem das Ziel über UDP aufgelöst wird.
 *
 * Es wird **kein** Dienst abgefragt: Ein Paket an Port 1 erzwingt nur die
 * ARP-Auflösung. Antworten werden verworfen; Fehler sind erwartbar und kein
 * Ergebnis (ein geschlossener Port ist normal).
 */
function probe(address: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = dgram.createSocket({type: "udp4", reuseAddr: false});
    let settled = false;
    const finish = (found: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* Socket war bereits zu — das Ergebnis zählt unabhängig davon. */
      }
      resolve(found);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on("error", () => finish(false));
    socket.once("message", () => finish(true));
    socket.send(Buffer.from([0]), PROBE_PORT, address, error => {
      // Ein Sendefehler (z. B. EPERM ohne Netzwerkrecht) ist kein Fund.
      if (error) finish(false);
    });
  });
}

/**
 * Führt einen begrenzten aktiven Scan aus und meldet, was gemessen wurde.
 *
 * Der Scan legt Kandidaten an, autorisiert aber nichts. `actor` erscheint im
 * Ereignis und im Audit, damit die Aktion nachvollziehbar bleibt.
 */
export async function scanDevices(options: {
  maxTargets?: number;
  concurrency?: number;
  timeoutMs?: number;
  interfaces?: string[];
  active?: boolean;
} = {}): Promise<ScanReport> {
  const maxTargets = Math.min(DEFAULT_MAX_TARGETS, Math.max(1, Math.trunc(options.maxTargets ?? DEFAULT_MAX_TARGETS)));
  const concurrency = Math.min(64, Math.max(1, Math.trunc(options.concurrency ?? DEFAULT_CONCURRENCY)));
  const timeoutMs = Math.min(30_000, Math.max(250, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)));
  const active = options.active !== false;
  const startedAt = new Date().toISOString();
  const started = Date.now();

  const subnets = localSubnets().filter(entry => !options.interfaces || options.interfaces.includes(entry.name));
  const wanted = subnets.map(entry => ({entry, targets: subnetTargets(entry, maxTargets)}));
  const skipped = subnets.filter(entry => entry.prefix < 24);

  let probed = 0;
  const found = new Map<string, ScanEntry>();
  if (active) {
    for (const {entry, targets} of wanted) {
      for (let offset = 0; offset < targets.length; offset += concurrency) {
        const batch = targets.slice(offset, offset + concurrency);
        const results = await Promise.all(batch.map(address => probe(address, timeoutMs)));
        probed += batch.length;
        results.forEach((answered, index) => {
          if (!answered) return;
          const address = batch[index];
          found.set(address, {address, interface: entry.name, macAddress: null, state: "ANSWERED", source: "ACTIVE_PROBE"});
        });
      }
    }
  }

  const table = readNeighborTable();
  for (const entry of table.entries) {
    const existing = found.get(entry.address);
    // Die Nachbartabelle liefert die Hardware-Adresse; der aktive Fund die
    // Zuordnung zur Schnittstelle. Beides zusammen ist der vollständigste Stand.
    found.set(entry.address, {
      address: entry.address,
      interface: entry.interface || existing?.interface || "",
      macAddress: entry.macAddress ?? existing?.macAddress ?? null,
      state: entry.state,
      source: existing ? "ACTIVE_PROBE" : "NEIGHBOR_TABLE"
    });
  }

  const entries = [...found.values()]
    .filter(entry => entry.macAddress !== null || entry.state === "ANSWERED")
    .sort((a, b) => a.address.localeCompare(b.address, "en", {numeric: true}));

  const report: ScanReport = {
    scanId: `SCAN-${Date.now().toString(36).toUpperCase()}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    interfaces: subnets.map(entry => ({name: entry.name, address: entry.address, netmask: entry.netmask, family: "IPv4"})),
    probed,
    entries,
    limits: {
      maxTargets,
      concurrency,
      timeoutMs,
      ...(active ? {} : {reason: "aktive Auflösung abgeschaltet — nur die Kernel-Nachbartabelle wurde gelesen"}),
      ...(skipped.length > 0
        ? {reason: `Netze mit Präfix < /24 wurden nicht aktiv gescannt: ${skipped.map(entry => `${entry.name}/${entry.prefix}`).join(", ")}`}
        : {})
    },
    neighborTable: table.available ? "READ" : "UNAVAILABLE"
  };

  observe({
    type: "device.scan.completed",
    message: `Netz-Scan abgeschlossen: ${report.entries.length} Kandidaten (${probed} Ziele geprüft) — Discovery ≠ Autorisierung`,
    status: "WAITING",
    actor: "CREATOR",
    action: "device.scan",
    resource: report.scanId,
    argumentsValue: {probed, found: report.entries.length, neighborTable: report.neighborTable, interfaces: report.interfaces.length}
  });
  recordAudit({actor: "CREATOR", action: "device.scan", resource: report.scanId, decision: "ALLOW"}, {
    probed,
    found: report.entries.length,
    active,
    neighborTable: report.neighborTable
  });

  return report;
}
