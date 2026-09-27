import http from "node:http";
import net from "node:net";
import {egressAllows, listEgressEntries} from "./allowlist";
import {pinnedAddresses} from "./dns-pin";
import {recordAudit} from "../audit";
import {observe} from "../observability";
import {isShuttingDown} from "../shutdown";
import {isKilled} from "../governance";

/**
 * Kontrollierter Egress-Proxy (Phase 4 / 7.1, MASTER §10).
 *
 * Vorgabe ist DENY. Dieser Proxy ist die einzige kontrollierte Egress-Schicht:
 *  - Nur Hosts/Ports der Allowlist werden vermittelt, alles andere ist fail closed.
 *  - Jede Verbindung geht an eine **gepinnte** Adresse (DNS-Pinning), nicht an
 *    den Namen — Rebinding zwischen Prüfung und Verbindung ist damit ausgeschlossen.
 *  - Jede Entscheidung (ALLOW und DENY) wird auditiert und beobachtbar gemeldet.
 *  - Während Drainage oder bei aktivem Kill-Switch vermittelt der Proxy nichts.
 *
 * Der Proxy bindet ausschließlich auf Loopback; Sandbox-Prozesse erhalten ihn
 * über `HTTP_PROXY`/`HTTPS_PROXY`. TLS wird nicht aufgebrochen (kein MITM):
 * CONNECT-Tunnel werden nur zu erlaubten Hosts aufgebaut und ebenfalls gepinnt.
 */

export type EgressProxyHandle = {
  port: number;
  host: string;
  url: string;
  startedAt: string;
  close: () => Promise<void>;
};

const CONNECT_TIMEOUT_MS = 10_000;

function auditEgress(decision: "ALLOW" | "DENY", detail: {host: string; port: number; method?: string; reason?: string; code?: string}) {
  recordAudit(
    {actor: "SANDBOX", action: "egress:request", decision, resource: `${detail.host}:${detail.port}`},
    {host: detail.host, port: detail.port, method: detail.method, reason: detail.reason, code: detail.code}
  );
}

function egressDecision(host: string, port: number): {allowed: boolean; reason: string; code: string} {
  if (isShuttingDown()) return {allowed: false, reason: "server is draining; egress is closed", code: "SHUTTING_DOWN"};
  if (isKilled("SYSTEM", "SYSTEM")) return {allowed: false, reason: "system kill switch is active", code: "SYSTEM_KILL_SWITCH"};
  const decision = egressAllows(host, port);
  return decision.allowed
    ? {allowed: true, reason: decision.reason, code: "ALLOWLIST"}
    : {allowed: false, reason: decision.reason, code: "EGRESS_DENIED"};
}

function denyResponse(response: http.ServerResponse, status: number, code: string, message: string) {
  response.writeHead(status, {"content-type": "application/json", "cache-control": "no-store"});
  response.end(JSON.stringify({error: code, message}));
}

function splitAuthority(authority: string): {host: string; port: number} | null {
  const match = /^([^:]+)(?::(\d+))?$/.exec(authority.trim());
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {host: match[1], port};
}

/**
 * Verbindet zu den gepinnten Adressen (der Reihe nach). Es wird niemals der
 * Name erneut aufgelöst — nur die gepinnte Menge zählt (Anti-Rebinding).
 */
function connectPinned(addresses: string[], port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let index = 0;
    const attempt = () => {
      if (index >= addresses.length) {
        reject(new Error("no pinned address could be connected"));
        return;
      }
      const socket = net.connect({host: addresses[index], port, timeout: CONNECT_TIMEOUT_MS});
      socket.once("connect", () => resolve(socket));
      socket.once("timeout", () => {
        socket.destroy();
        index += 1;
        attempt();
      });
      socket.once("error", () => {
        socket.destroy();
        index += 1;
        attempt();
      });
    };
    attempt();
  });
}

export async function startEgressProxy(options: {port?: number; host?: string} = {}): Promise<EgressProxyHandle> {
  const server = http.createServer((request, response) => {
    void (async () => {
      let target: URL;
      try {
        target = new URL(request.url ?? "");
      } catch {
        denyResponse(response, 400, "BAD_EGRESS_URL", "egress request URL is not parseable");
        return;
      }
      if (target.protocol !== "http:") {
        auditEgress("DENY", {host: target.hostname, port: target.port ? Number(target.port) : 0, method: request.method, reason: `protocol ${target.protocol} is not proxied`, code: "EGRESS_PROTOCOL"});
        denyResponse(response, 403, "EGRESS_PROTOCOL", "only plain http is proxied; use CONNECT for tls");
        return;
      }
      const port = target.port ? Number(target.port) : 80;
      const decision = egressDecision(target.hostname, port);
      if (!decision.allowed) {
        auditEgress("DENY", {host: target.hostname, port, method: request.method, reason: decision.reason, code: decision.code});
        observe({
          type: "egress.denied",
          message: `Egress verweigert: ${target.hostname}:${port} (${decision.reason})`,
          status: "BLOCKED",
          actor: "SANDBOX",
          action: "egress:request",
          resource: `${target.hostname}:${port}`,
          decision: "DENY",
          argumentsValue: {reason: decision.reason, code: decision.code}
        });
        denyResponse(response, 403, decision.code, decision.reason);
        return;
      }
      let addresses: string[];
      try {
        addresses = await pinnedAddresses(target.hostname);
      } catch (error) {
        auditEgress("DENY", {host: target.hostname, port, method: request.method, reason: `dns pinning failed: ${error instanceof Error ? error.message : String(error)}`, code: "DNS_PIN_FAILED"});
        denyResponse(response, 502, "DNS_PIN_FAILED", "host could not be pinned; egress stays closed");
        return;
      }
      const headers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        if (key.toLowerCase() === "proxy-connection") continue;
        headers[key] = value;
      }
      headers.host = target.host;
      let socket: net.Socket;
      try {
        socket = await connectPinned(addresses, port);
      } catch (error) {
        auditEgress("DENY", {host: target.hostname, port, method: request.method, reason: `upstream connect failed: ${error instanceof Error ? error.message : String(error)}`, code: "EGRESS_UPSTREAM"});
        denyResponse(response, 502, "EGRESS_UPSTREAM", "upstream connection failed");
        return;
      }
      const upstream = http.request(
        {
          host: addresses[0],
          port,
          path: `${target.pathname}${target.search}`,
          method: request.method,
          headers,
          timeout: CONNECT_TIMEOUT_MS,
          createConnection: () => socket
        },
        upstreamResponse => {
          auditEgress("ALLOW", {host: target.hostname, port, method: request.method, reason: decision.reason});
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        }
      );
      upstream.on("error", error => {
        auditEgress("DENY", {host: target.hostname, port, method: request.method, reason: `upstream failed: ${error.message}`, code: "EGRESS_UPSTREAM"});
        if (!response.headersSent) denyResponse(response, 502, "EGRESS_UPSTREAM", "upstream connection failed");
        else response.end();
      });
      upstream.on("timeout", () => upstream.destroy(new Error("egress upstream timeout")));
      request.pipe(upstream);
    })();
  });

  server.on("connect", (request, clientSocket, head) => {
    void (async () => {
      const authority = splitAuthority(request.url ?? "");
      if (!authority) {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        clientSocket.destroy();
        return;
      }
      const decision = egressDecision(authority.host, authority.port);
      if (!decision.allowed) {
        auditEgress("DENY", {host: authority.host, port: authority.port, method: "CONNECT", reason: decision.reason, code: decision.code});
        observe({
          type: "egress.denied",
          message: `Egress-Tunnel verweigert: ${authority.host}:${authority.port} (${decision.reason})`,
          status: "BLOCKED",
          actor: "SANDBOX",
          action: "egress:request",
          resource: `${authority.host}:${authority.port}`,
          decision: "DENY",
          argumentsValue: {reason: decision.reason, code: decision.code}
        });
        clientSocket.write(`HTTP/1.1 403 Forbidden\r\n\r\n`);
        clientSocket.destroy();
        return;
      }
      let addresses: string[];
      try {
        addresses = await pinnedAddresses(authority.host);
      } catch (error) {
        auditEgress("DENY", {host: authority.host, port: authority.port, method: "CONNECT", reason: `dns pinning failed: ${error instanceof Error ? error.message : String(error)}`, code: "DNS_PIN_FAILED"});
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.destroy();
        return;
      }
      let upstream: net.Socket;
      try {
        upstream = await connectPinned(addresses, authority.port);
      } catch {
        auditEgress("DENY", {host: authority.host, port: authority.port, method: "CONNECT", reason: "upstream connect failed", code: "EGRESS_UPSTREAM"});
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.destroy();
        return;
      }
      auditEgress("ALLOW", {host: authority.host, port: authority.port, method: "CONNECT", reason: decision.reason});
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    })();
  });

  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const handle: EgressProxyHandle = {
    port,
    host,
    url: `http://${host}:${port}`,
    startedAt: new Date().toISOString(),
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      })
  };
  observe({
    type: "egress.started",
    message: `Egress-Proxy aktiv auf ${handle.url} (Allowlist: ${listEgressEntries().length} Einträge, Vorgabe DENY)`,
    status: "RUNNING",
    actor: "SYSTEM",
    action: "egress.start",
    resource: handle.url
  });
  return handle;
}
