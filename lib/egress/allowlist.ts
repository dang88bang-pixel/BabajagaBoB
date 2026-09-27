import {createStore} from "../persistence/store";

/**
 * Egress-Allowlist (Phase 4 / 7.1, MASTER §10).
 *
 * Vorgabe ist und bleibt DENY. Die Allowlist nennt ausschließlich Hostnamen —
 * keine IP-Literale: Eine IP würde das DNS-Pinning umgehen und ist deshalb
 * ausdrücklich nicht erlaubt (fail closed). Wildcards sind nur als führendes
 * `*.` für Subdomains zulässig, niemals als Suffix- oder Teilstring-Muster.
 */

export type EgressEntry = {
  host: string;
  ports: number[];
  addedBy: string;
  addedAt: string;
  reason?: string;
};

type Payload = {entries: EgressEntry[]};

const store = createStore<Payload>("egress-allowlist", 1, () => ({entries: []}));

// Hostnamen (auch einzelne Labels wie `localhost` oder interne Dienstenamen);
// IP-Literale sind strukturell ausgeschlossen (Punkte/Kolonne passen nicht).
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export function isValidEgressHost(host: string): boolean {
  if (typeof host !== "string" || host.length === 0 || host.length > 253) return false;
  if (!HOST_PATTERN.test(host)) return false;
  // IP-Literale sind ausgeschlossen: rein numerische Label-Ketten sind
  // IPv4-Adressen (z. B. `10.0.0.1`); IPv6 enthält Doppelpunkte und passt
  // ohnehin nicht ins Muster.
  if (host.split(".").every(label => /^\d+$/.test(label))) return false;
  return true;
}

/** Normiert einen Host (klein, ohne Port/Schema/Trailing-Dot). */
export function normalizeEgressHost(input: string): string {
  let host = String(input).trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split("/")[0];
  host = host.replace(/:\d+$/, "");
  return host.replace(/\.$/, "");
}

export function listEgressEntries(): EgressEntry[] {
  return store.read().entries.map(entry => ({...entry, ports: [...entry.ports]}));
}

export function addEgressEntry(input: {host: string; ports?: number[]; addedBy: string; reason?: string}): EgressEntry {
  const host = normalizeEgressHost(input.host);
  if (!isValidEgressHost(host)) throw new Error(`egress host is invalid (hostname required, no IP literals): ${input.host}`);
  const ports = (input.ports ?? [80, 443]).map(port => Number(port));
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`egress port is invalid: ${port}`);
  }
  store.update(payload => {
    const existing = payload.entries.find(entry => entry.host === host);
    if (existing) {
      existing.ports = [...new Set([...existing.ports, ...ports])];
      existing.reason = input.reason ?? existing.reason;
      return;
    }
    payload.entries.push({host, ports: [...new Set(ports)], addedBy: input.addedBy, addedAt: new Date().toISOString(), reason: input.reason});
  });
  const persisted = store.read().entries.find(entry => entry.host === host);
  if (!persisted) throw new Error("egress entry could not be persisted");
  return {...persisted, ports: [...persisted.ports]};
}

export function removeEgressEntry(host: string): boolean {
  const normalized = normalizeEgressHost(host);
  let removed = false;
  store.update(payload => {
    const before = payload.entries.length;
    payload.entries = payload.entries.filter(entry => entry.host !== normalized);
    removed = payload.entries.length < before;
  });
  return removed;
}

/** Deckt die Allowlist den Host ab (unabhängig vom Port)? Die
 * Port-Granularität erzwingt der Proxy je Anfrage. */
export function egressCoversHost(host: string): boolean {
  const normalized = normalizeEgressHost(host);
  if (!isValidEgressHost(normalized)) return false;
  const entries = store.read().entries;
  return entries.some(entry => entry.host === normalized || (entry.host.startsWith("*.") && normalized.endsWith(entry.host.slice(1)) && normalized !== entry.host.slice(2)));
}

/** Prüft eine Zielangabe (`host` + Port) gegen die Allowlist. */
export function egressAllows(host: string, port: number): {allowed: boolean; reason: string} {
  const normalized = normalizeEgressHost(host);
  if (!isValidEgressHost(normalized)) return {allowed: false, reason: `host is not a valid hostname: ${host}`};
  const entries = store.read().entries;
  const exact = entries.find(entry => entry.host === normalized);
  if (exact) {
    return exact.ports.includes(port)
      ? {allowed: true, reason: `allowlist entry ${exact.host}`}
      : {allowed: false, reason: `port ${port} is not allowed for ${exact.host}`};
  }
  const wildcard = entries.find(entry => entry.host.startsWith("*.") && normalized.endsWith(entry.host.slice(1)) && normalized !== entry.host.slice(2));
  if (wildcard) {
    return wildcard.ports.includes(port)
      ? {allowed: true, reason: `allowlist wildcard ${wildcard.host}`}
      : {allowed: false, reason: `port ${port} is not allowed for ${wildcard.host}`};
  }
  return {allowed: false, reason: `no allowlist entry for ${normalized}`};
}
