import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import {observe} from "./observability";
import {recordAudit} from "./audit";

/**
 * ============================================================================
 * Kontrollierter Ausgangsverkehr (Egress) — ALLOWLIST statt fail closed
 * ============================================================================
 *
 * Bisher war `network: ALLOWLIST` überall fail closed, weil es keine
 * kontrollierte Schicht gab: Eine Sandbox mit erlaubten Zielen hätte direkt ins
 * Netz gekonnt. Dieser Proxy ist diese Schicht.
 *
 * Regeln:
 *
 *  1. **Keine Allowlist, kein Ausgang.** Ohne konfigurierte Ziele verweigert der
 *     Proxy alles (fail closed) — auch dann, wenn er läuft.
 *  2. **DNS-Pinning.** Der Name wird **einmal** aufgelöst; verbunden wird nur zu
 *     einer der dabei ermittelten Adressen. Danach wird die tatsächlich
 *     verbundene Adresse gegen die gepinnte Menge geprüft. Damit schlägt
 *     DNS-Rebinding fehl: Ein zweiter Lookup mit anderer Antwort hat keine
 *     Wirkung.
 *  3. **Nur CONNECT (TLS-Tunnel) und einfache HTTP-GET/HEAD-Proxyanfragen.**
 *     Alles andere wird verweigert; der Proxy ist kein offener Proxy.
 *  4. **Private Adressen sind nie erreichbar**, auch nicht über einen
 *     erlaubten Namen (kein Weg ins interne Netz über einen öffentlichen Namen).
 *  5. **Jede Entscheidung wird auditiert** — Erlaubtes wie Verweigertes.
 *
 * Ehrliche Grenze: Der Proxy sieht bei TLS nur den Zielnamen (SNI/Host), nicht
 * den Inhalt. Tiefenprüfung (TLS-Inspektion) ist bewusst **nicht** eingebaut:
 * Sie würde Zertifikate brechen und geschützte Daten lesbar machen.
 */

export type EgressRule = {host: string; port: number};

export type EgressStatus = {
  configured: boolean;
  running: boolean;
  listeningPort: number | null;
  rules: EgressRule[];
  /** Begründung, warum nichts erlaubt ist (nie leer, wenn `configured` falsch). */
  reason: string;
  deniedRequests: number;
  allowedRequests: number;
};

const DEFAULT_PORT = 8888;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_HEADER_BYTES = 16 * 1024;

let server: http.Server | null = null;
let listeningPort: number | null = null;
let deniedRequests = 0;
let allowedRequests = 0;

/**
 * Erlaubte Ziele aus der Serverumgebung.
 *
 * Format: `host:port[,host:port…]`, z. B. `registry.npmjs.org:443,example.com:443`.
 * Nur wohlgeformte Einträge werden übernommen; ein Eintrag ohne Port gilt nicht
 * (kein stiller Default auf 443 — das wäre eine unausgesprochene Freigabe).
 */
export function egressRules(): EgressRule[] {
  const raw = (process.env.BOB_EGRESS_ALLOWLIST ?? "").trim();
  if (raw.length === 0) return [];
  const rules: EgressRule[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (entry.length === 0) continue;
    const match = /^([a-z0-9][a-z0-9.-]{0,253}):(\d{1,5})$/i.exec(entry);
    if (!match) continue;
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    rules.push({host: match[1].toLowerCase(), port});
  }
  return rules;
}

/** Ist eine Allowlist konfiguriert? Ohne sie bleibt Ausgangsverkehr verboten. */
export function egressAvailable(): boolean {
  return egressRules().length > 0;
}

export function egressStatus(): EgressStatus {
  const rules = egressRules();
  return {
    configured: rules.length > 0,
    running: server !== null && listeningPort !== null,
    listeningPort,
    rules,
    reason: rules.length > 0 ? `${rules.length} Ziel(e) freigegeben` : "BOB_EGRESS_ALLOWLIST ist leer — jeder Ausgangsverkehr wird verweigert (fail closed).",
    deniedRequests,
    allowedRequests
  };
}

/** Prüft, ob ein Ziel in der Allowlist liegt. */
export function isAllowed(target: {host: string; port: number}): {allowed: false; reason: string} | {allowed: true; rule: EgressRule} {
  const rules = egressRules();
  if (rules.length === 0) {
    return {allowed: false, reason: "keine Allowlist konfiguriert (fail closed)"};
  }
  const host = String(target.host ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  const port = Number(target.port);
  if (!host || !Number.isInteger(port)) return {allowed: false, reason: "Ziel unvollständig"};
  const rule = rules.find(entry => entry.host === host && entry.port === port);
  if (!rule) return {allowed: false, reason: `${host}:${port} ist nicht freigegeben`};
  return {allowed: true, rule};
}

/**
 * Ist die Adresse privat/link-lokal? Solche Ziele sind nie erlaubt — auch nicht,
 * wenn ein öffentlicher Name darauf auflöst (Schutz vor internem Zugriff).
 */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) return true; // IPv6 wird nicht freigegeben
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true; // Multicast/Broadcast
  return false;
}

/**
 * Löst einen Namen auf und **pinnt** die Adressen.
 *
 * Zurückgegeben werden die Adressen plus ein Digest der Menge: Der Aufrufer
 * verbindet ausschließlich zu einer Adresse aus dieser Menge und prüft danach
 * die tatsächliche Gegenstelle. Ein späterer, anderer Lookup hat damit keine
 * Wirkung (DNS-Rebinding).
 */
export async function resolvePinned(host: string): Promise<{addresses: string[]; digest: string; reason?: string}> {
  try {
    const records = await dns.promises.lookup(host, {all: true, verbatim: true, family: 4});
    const addresses = records.map(record => record.address).filter(address => !isPrivateAddress(address));
    if (addresses.length === 0) {
      return {addresses: [], digest: "", reason: "Name löst nicht auf eine erlaubte öffentliche Adresse auf"};
    }
    return {addresses, digest: crypto.createHash("sha256").update(addresses.slice().sort().join(",")).digest("hex")};
  } catch (error) {
    return {addresses: [], digest: "", reason: `Namensauflösung fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`};
  }
}

function auditDecision(decision: "ALLOW" | "DENY", target: string, reason: string, extra: Record<string, unknown> = {}): void {
  if (decision === "DENY") deniedRequests += 1;
  else allowedRequests += 1;
  observe({
    type: decision === "ALLOW" ? "egress.allowed" : "egress.denied",
    message: decision === "ALLOW" ? `Egress freigegeben: ${target}` : `Egress verweigert: ${target} (${reason})`,
    status: decision === "ALLOW" ? "COMPLETED" : "BLOCKED",
    actor: "SYSTEM-EGRESS",
    action: "egress.connect",
    resource: target.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 120),
    decision,
    argumentsValue: {target, reason, ...extra}
  });
  recordAudit({actor: "SYSTEM-EGRESS", action: "egress.connect", resource: target.slice(0, 120), decision}, {reason, ...extra});
}

/**
 * Verbindet zu einer **gepinnten** Adresse und prüft die Gegenstelle.
 *
 * Die Prüfung ist der Kern des DNS-Pinnings: `net.connect` bekommt die
 * Adresse, nicht den Namen, und die tatsächlich verbundene Adresse muss in der
 * gepinnten Menge liegen.
 */
export function connectPinned(host: string, port: number, addresses: string[]): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const pinned = new Set(addresses);
    const target = addresses[0];
    if (!target) {
      reject(new Error("keine gepinnte Adresse"));
      return;
    }
    const socket = net.connect({host: target, port, family: 4, timeout: CONNECT_TIMEOUT_MS});
    socket.once("connect", () => {
      const remote = socket.remoteAddress ?? "";
      const normalized = remote.replace(/^::ffff:/, "");
      if (!pinned.has(normalized)) {
        socket.destroy();
        reject(new Error(`verbundene Adresse ${normalized} weicht von der gepinnten Auflösung ab`));
        return;
      }
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Zeitüberschreitung beim Verbindungsaufbau (${CONNECT_TIMEOUT_MS}ms)`));
    });
    socket.once("error", error => {
      socket.destroy();
      reject(error);
    });
  });
}

/**
 * Startet den Proxy. Ohne Allowlist läuft er zwar, verweigert aber alles —
 * der Zustand ist damit eindeutig und nicht „offen, weil nicht konfiguriert".
 */
export function startEgressProxy(options: {port?: number} = {}): Promise<{port: number}> {
  if (server) return Promise.resolve({port: listeningPort ?? DEFAULT_PORT});
  return new Promise((resolve, reject) => {
    const instance = http.createServer({maxHeaderSize: MAX_HEADER_BYTES}, (request, response) => {
      response.setHeader("Server", "babajagabob-egress");
      response.statusCode = 403;
      response.end("only CONNECT tunnelling is allowed\n");
      auditDecision("DENY", String(request.url ?? ""), "nur CONNECT ist erlaubt");
    });

    instance.on("connect", (request: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
      const [host, rawPort] = String(request.url ?? "").split(":");
      const port = Number(rawPort);
      const target = `${host}:${rawPort}`;
      const verdict = isAllowed({host, port});
      if (!verdict.allowed) {
        clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        clientSocket.end();
        auditDecision("DENY", target, verdict.reason);
        return;
      }
      void (async () => {
        const pinned = await resolvePinned(host);
        if (pinned.addresses.length === 0) {
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.end();
          auditDecision("DENY", target, pinned.reason ?? "keine Adresse");
          return;
        }
        try {
          const upstream = await connectPinned(host, port, pinned.addresses);
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
          const close = () => {
            upstream.destroy();
            clientSocket.destroy();
          };
          upstream.once("error", close);
          clientSocket.once("error", close);
          upstream.once("close", close);
          clientSocket.once("close", close);
          auditDecision("ALLOW", target, "Tunnel aufgebaut", {pinned: pinned.digest, addresses: pinned.addresses.length});
        } catch (error) {
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.end();
          auditDecision("DENY", target, error instanceof Error ? error.message : "Verbindung fehlgeschlagen", {pinned: pinned.digest});
        }
      })();
    });

    instance.once("error", reject);
    instance.listen(options.port ?? DEFAULT_PORT, "127.0.0.1", () => {
      const address = instance.address();
      listeningPort = typeof address === "object" && address ? address.port : options.port ?? DEFAULT_PORT;
      server = instance;
      observe({
        type: "egress.proxy.started",
        message: `Egress-Proxy auf 127.0.0.1:${listeningPort} gestartet (${egressRules().length} freigegebene Ziele)`,
        status: "RUNNING",
        actor: "SYSTEM-EGRESS",
        action: "egress.start",
        resource: `PORT-${listeningPort}`,
        argumentsValue: {port: listeningPort, rules: egressRules().length, configured: egressAvailable()}
      });
      resolve({port: listeningPort});
    });
  });
}

/** Beendet den Proxy (für Tests und geordnetes Herunterfahren). */
export function stopEgressProxy(): Promise<void> {
  return new Promise(resolve => {
    if (!server) {
      listeningPort = null;
      resolve();
      return;
    }
    const instance = server;
    server = null;
    instance.close(() => {
      listeningPort = null;
      observe({
        type: "egress.proxy.stopped",
        message: "Egress-Proxy beendet",
        status: "COMPLETED",
        actor: "SYSTEM-EGRESS",
        action: "egress.stop",
        resource: "EGRESS"
      });
      resolve();
    });
    // Offene Tunnel dürfen das Beenden nicht blockieren.
    instance.closeAllConnections?.();
  });
}
