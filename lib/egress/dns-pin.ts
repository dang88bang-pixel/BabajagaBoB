import dns from "node:dns/promises";

/**
 * DNS-Pinning gegen Rebinding (Phase 4 / 7.1).
 *
 * Ein Host wird einmal aufgelöst und die Adressmenge wird für die TTL
 * festgeschrieben. Der Egress-Proxy verbindet sich ausschließlich mit den
 * gepinnten Adressen — nicht mit dem Namen — damit zwischen Prüfung und
 * Verbindung kein anderer Datensatz unterschieben werden kann (TOCTOU).
 * Nach Ablauf der TTL wird neu gepinnt; schlägt die Auflösung fehl, bleibt
 * der Egress für diesen Host fail closed.
 */

export type DnsPin = {host: string; addresses: string[]; pinnedAt: number; ttlMs: number};

const pins = new Map<string, DnsPin>();
const DEFAULT_TTL_MS = 60_000;

/** Test-/Steuerungshilfe: leert alle Pins. */
export function clearDnsPins(): void {
  pins.clear();
}

export function getDnsPin(host: string): DnsPin | undefined {
  const pin = pins.get(host);
  if (!pin) return undefined;
  if (Date.now() - pin.pinnedAt > pin.ttlMs) return undefined;
  return pin;
}

/**
 * Pinnt einen Host: löst auf und schreibt die Adressmenge fest.
 * Wirft, wenn der Host nicht aufgelöst werden kann (fail closed).
 */
export async function pinHost(host: string, ttlMs: number = DEFAULT_TTL_MS): Promise<DnsPin> {
  const existing = getDnsPin(host);
  if (existing) return existing;
  const records = await dns.lookup(host, {all: true, verbatim: true});
  const addresses = [...new Set(records.map(record => record.address))];
  if (addresses.length === 0) throw new Error(`dns pinning failed: no addresses for ${host}`);
  const pin: DnsPin = {host, addresses, pinnedAt: Date.now(), ttlMs};
  pins.set(host, pin);
  return pin;
}

/**
 * Liefert die gepinnten Adressen eines Hosts; pinnt bei Bedarf neu.
 * Wirft bei Auflösungsfehlern — der Proxy darf dann nicht verbinden.
 */
export async function pinnedAddresses(host: string, ttlMs: number = DEFAULT_TTL_MS): Promise<string[]> {
  const pin = await pinHost(host, ttlMs);
  return [...pin.addresses];
}

export function isPinnedAddress(host: string, address: string): boolean {
  const pin = getDnsPin(host);
  return Boolean(pin?.addresses.includes(address));
}
