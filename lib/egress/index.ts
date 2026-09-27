import {listEgressEntries, type EgressEntry} from "./allowlist";
import {startEgressProxy, type EgressProxyHandle} from "./proxy";

/**
 * Egress-Schicht: Lebenszyklus und Status (Phase 4 / 7.1).
 *
 * Der Proxy ist eine Operator-Entscheidung: ohne `BOB_EGRESS_PROXY=1` beim
 * Start bleibt es bei der Vorgabe DENY und ALLOWLIST ist weiterhin fail closed.
 * Es gibt genau eine Proxy-Instanz (Singleton), damit Allowlist, DNS-Pins und
 * Audit-Pfad nicht auseinanderlaufen.
 */

let handle: EgressProxyHandle | null = null;

export async function ensureEgressProxy(options: {port?: number} = {}): Promise<EgressProxyHandle> {
  if (handle) return handle;
  handle = await startEgressProxy(options);
  return handle;
}

export function egressProxy(): EgressProxyHandle | null {
  return handle;
}

export function egressProxyUrl(): string | null {
  return handle?.url ?? null;
}

export async function stopEgressProxy(): Promise<void> {
  const current = handle;
  handle = null;
  if (current) await current.close();
}

export function egressStatus(): {
  enabled: boolean;
  running: boolean;
  url: string | null;
  startedAt: string | null;
  entries: EgressEntry[];
  defaultPolicy: "DENY";
} {
  return {
    enabled: process.env.BOB_EGRESS_PROXY === "1" || handle !== null,
    running: handle !== null,
    url: handle?.url ?? null,
    startedAt: handle?.startedAt ?? null,
    entries: listEgressEntries(),
    defaultPolicy: "DENY"
  };
}

export {addEgressEntry, removeEgressEntry, listEgressEntries, egressAllows, egressCoversHost, isValidEgressHost, normalizeEgressHost} from "./allowlist";
export {clearDnsPins, getDnsPin, pinHost, pinnedAddresses, isPinnedAddress} from "./dns-pin";
export {startEgressProxy, type EgressProxyHandle} from "./proxy";
